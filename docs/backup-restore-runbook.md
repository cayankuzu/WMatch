# Backup and restore runbook

Bu belge production verisini resetlemek veya migration geçmişini yeniden yazmak için kullanılamaz.
Yerel custom-format logical restore drill'i tamamlanmıştır; bu, gerçek provider backup/PITR restore'u
değildir. Release candidate için provider backup/PITR durumu, kabul edilmiş RPO ve ölçülmüş RTO
repository'den doğrulanamamaktadır; bu dış kapılar tamamlanana kadar dayanıklılık kararı `NO-GO`dur.

## Kapsam ve mevcut gerçek

| Katman                                | Backup gerçeği                                                              | Restore gereksinimi                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Supabase PostgreSQL/Auth              | Plan ve dashboard ayarına bağlı daily physical backup/PITR; repo kanıtı yok | Önce izole yeni projeye restore, schema/RLS/auth doğrulaması                          |
| Storage `profile-photos` object'leri  | Database backup yalnız metadata'yı kapsar; object bytes dahil değildir      | Ayrı object inventory/backup ve owner/path/checksum doğrulaması gerekir               |
| Edge Function ve secrets              | Database backup'a dahil değildir                                            | Aynı SHA source deploy; secret değerleri güvenli secret store'dan geri yüklenir       |
| Realtime/Auth/provider ayarları       | Yeni projeye restore sonrası eksik veya manuel olabilir                     | Publication, auth URLs/providers, API keys ve network restrictions yeniden doğrulanır |
| EAS/Cloudflare/Sentry/provider config | Supabase backup'a dahil değildir                                            | İlgili IaC/workflow ve provider runbook'u kullanılır                                  |

Kabul edilmiş `RPO`: **belirlenmedi**. Ölçülmüş `RTO`: **yok**. Owner bu değerleri gerçek backup
frekansı, veri büyüklüğü ve drill süresinden türetip manifest'e eklemeden `GO` verilemez.

### Tamamlanan yerel logical restore drill'i

Dirty working tree'deki izole PostgreSQL 17 stack'inde:

- full custom-format dump'ın SHA-256 değeri drill sırasında hesaplanıp evidence'a yazıldı; `pg_dump`
  custom formatı çalışma zamanı metadata'sı taşıdığı için bu digest run'a özgüdür ve iki farklı
  drill'de aynı çıkması beklenmez, bu yüzden sabit bir beklenen değer olarak kullanılmaz;
- dump temiz `template0` tabanlı hedef DB'ye `supabase_admin` ile, OWNER metadata'sı korunarak full
  `pg_restore` edildi;
- restored schema contract `20260831153000`, public tablo sayısı 28, public index sayısı 89 ve RLS
  açık public tablo sayısı 27 olarak doğrulandı;
- restored DB üzerinde dört pgTAP dosyasındaki `166/166` test geçti.

İlk denemede `postgres --no-owner` kullanılması managed Realtime/Vault privilege ve owner
semantiğini bozdu; sonraki pgTAP read-model kontrolleri `permission denied` verdi. Bu başarısız
deneme kabul edilen restore değildir. Başarılı tekrar owner metadata'sını korudu ve `supabase_admin`
ile çalıştırıldı.

Bu yerel drill logical dump/restore bütünlüğünü kanıtlar; Supabase provider backup/PITR job'ını, Auth
encryption root key'ini, Storage object bytes'ı, external provider config'ini, gerçek RPO/RTO'yu veya
immutable same-SHA release artifact'ini kanıtlamaz.

## Güvenlik kapıları

- Drill hedefi production project ref veya production connection string olamaz.
- Hedef project ref ve region iki kişi tarafından doğrulanır; production restore ayrı incident/change
  onayı ve planlı downtime gerektirir.
- `supabase db reset --linked` ve production URL ile `db reset` yasaktır.
- Backup, dump, log ve evidence şifreli/erişim kontrollü tutulur; kullanıcı verisi Git'e, CI public
  artifact'ine veya ticket'a konmaz.
- Restore öncesi target default privileges ve RLS davranışı doğrulanır. Service role/DB password
  komut satırına gömülmez.
- Managed Supabase schema'larında OWNER metadata'sı ve grant zinciri korunur. `pg_restore --no-owner`
  kullanılmaz; restore aynı Supabase major/template rol grafiğine sahip izole hedefte
  `supabase_admin` ile çalıştırılır.
- Restore noktası, timezone ve olay cutoff'u yazılı olarak onaylanır. Yanlış PITR zamanı veri kaybıdır.

## Tercih edilen izole restore drill'i

Supabase Dashboard `Database > Backups > Restore to a New Project` akışı, uygun planda database,
Auth users ve encryption root key ile izole kopya üretmek için tercih edilir. Bu yine Storage object
bytes, Edge Functions, Auth ayarları, Realtime ayarları, API key'leri ve external provider config'ini
kopyalamaz.

1. Source project ref, mevcut backup türü, earliest/latest restore point ve backup timestamp'ini
   kaydedin.
2. Owner-approved restore point'i source timezone ve UTC ile kaydedin.
3. Yeni, boş ve yalnız drill için ayrılmış project oluşturun; adında production kelimesi olsa bile
   ref'i production ref ile eşleşemez.
4. Dashboard üzerinden backup/PITR'ı yeni projeye restore edin; başlangıç/bitiş timestamp'ini yazın.
5. Edge Function'ı candidate SHA'dan hedefe deploy edin ve yalnız drill secret setini yükleyin.
6. Gerekli Realtime publication, Auth URL/provider ve network restrictions'ı production değerlerini
   dışarı sızdırmadan yeniden yapılandırın.
7. Ayrı Storage backup'ından `profile-photos` object'lerini owner-scoped key ve checksum ile geri
   yükleyin. Database metadata ile object inventory farkını sıfır olmadan drill tamamlamayın.
8. Aşağıdaki doğrulama matrisi geçtikten sonra ölçülen RTO ve gerçekleşen RPO'yu kaydedin.
9. Drill project'inin saklama/silme kararı data owner tarafından onaylanır; evidence'ta yalnız
   sanitized sonuçlar tutulur.

## Mantıksal dump: kısmi ve taşınabilirlik amaçlı

Physical restore-to-new-project mevcut değilse aşağıdaki resmi Supabase CLI biçimiyle schema/role/
data dump alınabilir. Bu yöntem Supabase managed `auth`/`storage` kapsamını ve Storage object bytes'ı
tek başına tam geri getirmez; dolayısıyla full DR kanıtı sayılmaz.

### Custom-format full logical restore

İzole target aynı Supabase/PostgreSQL template ve managed role grafiğine sahipse custom-format dump,
OWNER/grant metadata'sını koruyarak restore edilir. Password/URL shell history'ye yazılmaz:

```sh
pg_dump "$SOURCE_DB_URL" --format=custom --file "$DUMP_FILE"
sha256sum "$DUMP_FILE" > "$DUMP_FILE.sha256"
pg_restore --dbname "$DRILL_DB_URL" --role=supabase_admin --single-transaction --exit-on-error \
  --verbose "$DUMP_FILE"
```

`pg_restore` komutuna **`--no-owner` eklenmez**. Managed Realtime/Vault nesnelerinin owner ve grant
semantiğini generic `postgres` rolüne zorlamak kabul edilmez. Target boş değilse cleanup bayrağı
eklemek yerine yeni `template0` tabanlı izole DB hazırlanır. Restore başarılı exit code verse bile
aşağıdaki owner/grant kontrolleri ve dört dosya/166 pgTAP testi geçmeden drill tamamlanmış sayılmaz.

Custom dump role tanımlarını tek başına taşımaz. Hedefte gerekli Supabase managed rollerinin aynı
stack/template tarafından oluşturulmuş olması zorunludur; eksik rolü geniş yetkili bir substitute'a
map etmek güvenli restore değildir.

### Supabase CLI ile ayrık SQL fallback'i

```sh
npx supabase@2.109.1 db dump --db-url "$SOURCE_DB_URL" --file roles.sql --role-only
npx supabase@2.109.1 db dump --db-url "$SOURCE_DB_URL" --file schema.sql
npx supabase@2.109.1 db dump --db-url "$SOURCE_DB_URL" --file data.sql --use-copy --data-only \
  --exclude "storage.buckets_vectors" --exclude "storage.vector_indexes"
npx supabase@2.109.1 db dump --db-url "$SOURCE_DB_URL" --file history-schema.sql \
  --schema supabase_migrations
npx supabase@2.109.1 db dump --db-url "$SOURCE_DB_URL" --file history-data.sql --use-copy \
  --data-only --schema supabase_migrations
sha256sum roles.sql schema.sql data.sql history-schema.sql history-data.sql > backup.sha256
```

Restore yalnız doğrulanmış izole `$DRILL_DB_URL` hedefine yapılır. Önce target default privileges
daraltılır; ardından tek transaction ve `ON_ERROR_STOP` kullanılır:

```sh
test "$DRILL_PROJECT_REF" != "$PRODUCTION_PROJECT_REF"
printf '%s' "$DRILL_DB_URL" | grep -F "$DRILL_PROJECT_REF" >/dev/null
if printf '%s' "$DRILL_DB_URL" | grep -F "$PRODUCTION_PROJECT_REF" >/dev/null; then exit 1; fi
psql "$DRILL_DB_URL" --set ON_ERROR_STOP=1 \
  --command 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;'
psql "$DRILL_DB_URL" --single-transaction --set ON_ERROR_STOP=1 \
  --file roles.sql \
  --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --file history-schema.sql \
  --file history-data.sql
```

Dump dosyaları kullanıcı verisi içerir; repository'ye eklenmez ve drill sonrası retention kararına
göre güvenli biçimde imha edilir.

## Restore doğrulama matrisi

| Kontrol                   | Beklenen sonuç                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Migration/schema contract | History local migration setiyle uyumlu; `20260831153000` yalnız gerçekten uygulanmışsa current                      |
| Owner/grant bütünlüğü     | Managed Realtime/Vault ve application object owner/grant'ları kaynak contract ile eşleşir; `--no-owner` kullanılmaz |
| Restored schema sayımları | Beklenen candidate için public tables `28`, public indexes `89`, RLS-enabled public tables `27`                     |
| pgTAP                     | Restored DB üzerinde dört dosyanın tüm `166/166` testi geçer; permission-denied kabul edilmez                       |
| RLS/IDOR                  | anon, user-A, user-B, blocked ve service-role attack matrix beklenen deny/allow sonuçlarını verir                   |
| Auth                      | Test hesaplarıyla session/refresh/logout; production kullanıcıya mail/push gönderilmez                              |
| Profile/private media     | Yalnız owner-scoped object path; eksik/orphan object inventory raporlanır                                           |
| Discovery/like/match/chat | Mevcut atomic invariant'lar ve read model contract testleri geçer                                                   |
| Moderation                | Report service boundary/audit erişimi anon/auth için kapalıdır                                                      |
| Account deletion          | İzole fixture saga `requested -> ... -> completed`; Auth/profile/storage temizliği doğrulanır                       |
| Realtime                  | Yalnız active match + no-block conversation/presence topic erişimi                                                  |
| Push                      | Provider send kapalı fixture; outbox/receipt state query edilir, gerçek kullanıcıya teslimat yok                    |
| Edge health               | Candidate release, required schema, schema-ready ve request ID beklenen değerdedir                                  |

## Production PITR acil durumu

1. Incident commander yazmaları durdurma/cutover kararını verir; exact UTC recovery point onaylanır.
2. Realtime dışındaki subscription/replication slotları ve downtime etkisi provider yönergesine göre
   değerlendirilir.
3. Mümkünse önce restore-to-new-project ile doğrulanır. In-place production restore yalnız son çare,
   iki kişilik onay ve verified recent backup ile yapılır.
4. Dashboard/API restore boyunca proje erişilemez olabilir. Başlangıç/bitiş ve provider job ID kaydı
   tutulur.
5. Restore sonrası secrets/keys, Auth, Realtime, Functions, Storage object inventory ve tüm matris
   yeniden doğrulanmadan trafik açılmaz.
6. Veri kaybı penceresi gerçekleşen RPO olarak; trafik geri dönüş süresi RTO olarak kaydedilir.

## Evidence ve karar

`release-evidence/<SHA>/restore/` altında sanitized backup inventory, restore point, source/target ref
hashleri, komut sürümleri, checksum manifest, başlangıç/bitiş, validation sonuçları, object inventory
farkı, onaylayanlar ve cleanup kaydı tutulur. Backup dosyalarının kendisi Git artifact'i değildir.
Yerel dirty-tree drill'in dump hash'i ve sanitized sonucu referans olabilir, ancak clean immutable
candidate SHA'da yeniden üretilmeden ve provider PITR drill'iyle tamamlanmadan release manifest'inde
`restoreDrillStatus=passed` yapılamaz.

Resmi kapsam ve komut kaynakları: [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups),
[Restore to a new project](https://supabase.com/docs/guides/platform/clone-project) ve
[CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
