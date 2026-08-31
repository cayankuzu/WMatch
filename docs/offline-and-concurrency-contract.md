# Offline and concurrency contract

Bu sözleşme yalnız mevcut WMatch akışlarının çevrim dışı davranışını tanımlar. Yeni offline ekranı,
yeni mutation veya genel amaçlı sync sistemi eklemez. Cache/outbox verisi server source of truth'un
yerini almaz.

## Veri sınıfları ve gerçek sınırlar

| Veri/akış | Saklama ve scope | TTL/sınır | Offline davranışı | Temizleme |
|---|---|---|---|---|
| Genel API read cache | Process memory, auth token/user scope | 3.5 saniye, 128 entry | Yalnız kısa tekrarları birleştirir; kalıcı offline veri değildir | Mutation invalidation ve auth/session purge |
| Chat list/thread cache | Process memory, user ve peer scope | Liste 5 dk, thread 15 dk; 4/12 entry | Mevcut cache gösterilebilir, server doğruluğu sayılmaz | Logout/delete/block ve session cache generation değişimi |
| Chat outbox | `SecureStore`, owner user ID + client message ID | Schema v1, 40 mesaj, en fazla 7 gün | FIFO replay; server `clientMessageId`/idempotency ile dedupe | Başarılı gönderim, expiry, logout veya hesap silme |
| Film/dizi library snapshot | `AsyncStorage`, owner user ID | 24 saat | Mevcut favori/izlenen içeriğini gösterebilir | Auth purge veya TTL/invalid schema |
| Library/watch sync outbox | `AsyncStorage`, owner user ID | Mevcut kodda max-age/retry/dead-letter sınırı yok | Idempotency key ile sırayla replay, ilk başarısızlıkta durur | Başarılı sync veya auth purge |
| Watch home/TMDB metadata | Public metadata, global local cache | Fresh 30 dk; stale en fazla 7 gün; 220 memory/64 persistent | Stale public metadata gösterilebilir ve background refresh denenir | TTL/LRU maintenance; kullanıcı PII'si yazılmaz |
| Watch home snapshot | Public movie/TV metadata | En fazla 7 gün | Offline başlangıçta mevcut içerik gösterilebilir | Invalid/expired payload silinir |
| Screen/tab/recent-search state | `AsyncStorage`, owner user ID | Ekran state schema v1; diğer alanlar repository contract'ına göre | Yalnız mevcut UI konumunu geri getirir | Logout/hesap silme owner anahtarlarını toplu siler |
| Auth session | `SecureStore`, device-only keychain service | Supabase session ömrü | Cached session cold start'ı ağdan ayırır; yetki server'da doğrulanır | Sign-out/delete; SecureStore yoksa fail-closed |
| Profil fotoğrafları | `expo-image` memory cache | Process ömrü | Diskte signed private foto cache'i tutulmaz | Auth değişimi/logout/delete ile memory cache temizlenir |
| Push outbox/receipts | Supabase service-only tablolar | DB retry/dead state; receipt terminal satırları 7 gün sonra temizlenir | Mobil outbox değildir; scheduler teslimatı sürdürür | Service RPC'leri ve retention SQL'i |

TMDB public metadata dışındaki kullanıcı verisi shared cache'e veya Cloudflare cache'e girmez. Signed
profile URL, precise location, match/like/chat/report/notification verisi `no-store` kabul edilir.

## Mutation kuralları

- GET/HEAD/OPTIONS bounded retry alabilir. Mutation ancak `Idempotency-Key`/client ID veya atomik DB
  invariant'ı varsa otomatik retry alır.
- Her request timeout ve `AbortController` kullanır; 429 için bounded `Retry-After`, transient ağ/5xx
  için bounded backoff uygulanır.
- Aynı process içindeki duplicate tap `runSingleFlight`/mutation lock ile birleştirilir. Bu yalnız
  cihaz içi korumadır; iki cihaz için DB unique constraint, idempotency record veya atomik RPC gerekir.
- Optimistic UI, server cevabı başarısız olduğunda önceki snapshot'ı geri koyar. Realtime olayı aynı
  mutation sonucunu getirdiğinde ID/version ile dedupe edilir; arrival order source of truth değildir.
- Block, logout ve hesap silme sırasında yeni replay başlatılmaz; owner cache/outbox/subscription
  temizliği yapılır. Bir in-flight cevap eski owner generation'ına aitse state'e commit edilmez.
- Chat replay FIFO'dur ve ilk başarısız mesajda durur; sonraki mesajların sırası atlanmaz.
- Watch/library replay `watchingVersion` conflict'ini server state ile karşılaştırır. Eş durum
  idempotent başarı sayılabilir; farklı stale state sessizce overwrite edilmez.
- Upload cancel/abort, finalize öncesi owner-scoped managed object key'i dışında URL/object kabul
  etmez. Yarım upload/finalize-cleanup yarışının cihaz ve storage kanıtı release kapısıdır.

## Process kill, reconnect ve kullanıcı değişimi

1. Cold start'ta yalnız schema/TTL kontrolünden geçen owner verisi hydrate edilir.
2. Ağ erişilebilir olduğunda chat ve library outbox tek flush flight ile başlar.
3. Process kill, outbox kaydını kaybetmemeli; tekrar açılış aynı idempotency key ile replay etmelidir.
4. User A'dan çıkıp User B'ye girildiğinde A'nın profile/library/chat/screen/search/outbox verisi B'ye
   gösterilemez. Public TMDB cache'i kullanıcı verisi içermediği için paylaşılabilir.
5. Hesap silme başarı cevabından sonra Supabase sign-out, push state reset, owner AsyncStorage,
   SecureStore chat outbox ve private image memory cache temizliği tamamlanır.

## Beklenen test matrisi

| Senaryo | Otomatik/repo kanıtı | Zorunlu runtime kanıtı |
|---|---|---|
| GET timeout/abort/429/jitter | `tests/network-retry.test.ts` | Proxy fault injection ve gerçek cihaz logu |
| Duplicate tap/idempotency | API/unit/DB contract testleri | İki cihazdan aynı like/report/message |
| Chat process kill/replay | Chat outbox component/unit testleri | Gönderim sırasında kill, relaunch, FIFO/dedupe |
| Owner isolation | Session/cache testleri ve key contract'ı | A -> logout -> B cihaz akışı |
| Offline embedded/content | Snapshot/cache kodu | Airplane-mode cold start ve stale sınırı |
| Block/delete sırasında in-flight | Contract/RLS varlıkları | İki cihaz + Realtime yarış testi |
| Upload cancel/finalize | Storage/server validation testleri | Ağ kesintisi, cancel, orphan kontrolü |
| 24 saat replay/dead-letter | Kısmi asset | Zaman hızlandırmalı/gerçek fixture kanıtı yok |

## Bilinen açıklar

- Library/watch sync outbox'ta max age, retry count, next-attempt ve dead-letter alanı yoktur.
- Chat outbox 7 günlük expiry ve sınır içerir fakat retry sayısı/next-attempt/dead-letter kaydetmez.
- 24 saat replay, iki cihaz concurrency, process-kill ve upload yarışları aynı candidate SHA'da gerçek
  cihazla kanıtlanmamıştır.
- Bu açıklar ölçülmeden Offline, State, Dayanıklılık veya Test edilebilirlik alanına `9.80` verilemez.
