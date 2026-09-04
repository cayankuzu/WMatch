# Manual release steps

Bu adımlar repository'den yapılamayan provider, signing, cihaz, store ve production işlemleridir.
Hiçbiri tamamlanmış işaretlenmemiştir. Secret değerini bu dosyaya, Git'e, issue'ya veya release
artifact'ine yazmayın. Bütün kanıtlar aynı immutable candidate SHA altında tutulur.

## 1. Cloudflare account, zone, domain ve API token

- **Mevcut dış durum (2026-08-31):** GitHub `development`, `preview`, `production`,
  `cloudflare-preview` ve `cloudflare-production` environment'ları oluşturuldu;
  `production`/`cloudflare-production` için `cayankuzu` required reviewer ve protected-branch policy
  etkin. `main` strict `CI verify` + `Quality verify` required checks, admin enforcement,
  conversation resolution ve force-push/delete engeliyle korunur. Environment secrets/vars ve
  Cloudflare provider kurulumu eksik; adım **PENDING** kalır.

- **Durum:** [ ] Bekliyor.
- **Neden:** Seçici edge deployment'ın doğru hesap/zone ve minimum yetkiyle yapılması gerekir.
- **Nerede:** Cloudflare Dashboard; GitHub `preview`/`production` protected environments.
- **Değer adları:** `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, zone ID, root domain.
- **Doğrulama:** `npx wrangler whoami` ve ilgili infra dizininde `npx wrangler deploy --dry-run`;
  token permission özetini ayrıca inceleyin.
- **Güvenli sonuç:** Token yalnız gerekli Worker/zone yetkilerine sahip; preview/prod secret'ları ayrı;
  hesap/zone beklenen WMatch kaydıdır.
- **Rollback:** Token'ı revoke edin, workflow environment secret'ını kaldırın; deploy yapıldıysa son
  known-good Worker version'a dönün.
- **Owner/evidence:** Platform owner (atanmadı), `release-evidence/<SHA>/manual/cloudflare-account/`.

## 2. DNS ve stable `api.*` host

- **Durum:** [ ] Bekliyor.
- **Neden:** Binary/update içindeki API base, origin/Worker değişse de sabit ve HTTPS olmalıdır.
- **Nerede:** Cloudflare DNS/zone; EAS/GitHub environment vars.
- **Değer adları:** `ROOT_DOMAIN`, `API_HOST`, `EXPO_PUBLIC_API_BASE_URL`.
- **Doğrulama:** `nslookup "$API_HOST"`; `curl --fail-with-body --proto '=https' \
"https://$API_HOST/health"` ve response release/schema/request-ID kontrolü.
- **Güvenli sonuç:** TLS geçerli; host yalnız beklenen Worker/origin'e gider; `/health` PII içermez;
  preview ve production hostları karışmaz.
- **Rollback:** DNS'i doğrulanmış previous target'a alın veya seçili mobil yolların geriye uyumlu
  direct Supabase origin davranışını koruyun. Old-binary adoption ölçülmeden origin'i kapatmayın.
- **Owner/evidence:** Platform + release owner (atanmadı), `release-evidence/<SHA>/manual/dns/`.

## 3. WAF, rate-limit ve gerekiyorsa Access

- **Durum:** [ ] Bekliyor.
- **Neden:** Yalnız seçili mevcut auth/report/upload/TMDB yollarının abuse/schema/origin sınırı
  provider katmanında uygulanmalıdır.
- **Nerede:** Cloudflare WAF/Rate Limiting/Access ve Worker deployment config.
- **Değer adları:** Rule IDs, route allowlist, rate-limit key/window, origin HMAC secret adı.
- **Doğrulama:** Preview fixture ile allowed, malformed, oversized, replay ve rate-limit istekleri;
  response status/request-ID/cf-ray kaydı. Gerçek kullanıcı verisi kullanmayın.
- **Güvenli sonuç:** Allowlist trafik geçer; abuse bounded 4xx/429; auth user data cache'lenmez;
  doğrudan origin bypass ölçülür.
- **Rollback:** Yeni rule'u disable edin, known-good ruleset/version'a dönün; auth/RLS'yi gevşetmeyin.
- **Owner/evidence:** Security + platform owner (atanmadı), `release-evidence/<SHA>/manual/waf/`.

## 4. Supabase project secrets ve origin HMAC

- **Durum:** [ ] Bekliyor.
- **Neden:** Edge Function/internal workers minimum yetkili secret'larla çalışmalıdır.
- **Nerede:** Supabase project secrets; GitHub protected environments; Cloudflare Worker secrets.
- **Değer adları:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `ACCOUNT_DELETION_WORKER_SECRET`, `NOTIFICATION_WORKER_SECRET`,
  `REQUIRE_CLOUDFLARE_ORIGIN_HMAC`, `ORIGIN_HMAC_KEY_ID`, `ORIGIN_HMAC_SECRET`,
  `ORIGIN_HMAC_PREVIOUS_KEY_ID`, `ORIGIN_HMAC_PREVIOUS_SECRET`, `ORIGIN_HMAC_MAX_SKEW_SECONDS`.
- **Doğrulama:** `npx supabase@2.109.1 secrets list --project-ref "$SUPABASE_PROJECT_REF"` yalnız adları
  kontrol eder; preview `/health`, deletion worker 401/404 ve origin replay testlerini çalıştırın.
  Rotation/cutover sırası `docs/operations/origin-hmac-cutover.md` ile aynı olmalıdır.
- **Güvenli sonuç:** Service role mobil/OTA/Cloudflare public env'de yok; worker secret query/logda
  yok; missing secret fail-closed 503/401 üretir.
- **Rollback:** Etkilenen secret'ı rotate/revoke edin ve önceki deployment'a dönün; eski secret'ı
  yeniden etkinleştirmeyin.
- **Owner/evidence:** Supabase/security owner (atanmadı), `release-evidence/<SHA>/manual/supabase-secrets/`.

## 5. EAS owner, project, channel ve environment

- **Mevcut dış durum (2026-08-31):** Gerekli GitHub environment adları oluşturuldu ve production
  reviewer/policy etkin. Expo/EAS environment değerleri, channel bağlantıları, secrets ve gerçek
  approval/publish run'ı doğrulanmadı; adım **PENDING** kalır.

- **Durum:** [ ] Bekliyor.
- **Neden:** `development`, `preview`, `production` bundle'ları ve public env değerleri karışmamalıdır.
- **Nerede:** Expo/EAS project `cayann/wmatch`, EAS Environments ve GitHub environments.
- **Değer adları:** `EXPO_TOKEN`, `EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_RELEASE_SHA`, Supabase public
  values, `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SENTRY_DSN`, sample-rate adı.
- **Doğrulama:** `npx eas-cli@22.0.0 project:info`; `npx eas-cli@22.0.0 channel:list --json \
--non-interactive`; preview/production env name ve project ID'yi dashboard'da karşılaştırın.
- **Güvenli sonuç:** Project ID app config ile aynı; üç channel/profile bire bir; production approval
  zorunlu; preview secret'ı production bundle'a girmez.
- **Rollback:** Yanlış publish'i `docs/ota-rollback-runbook.md` ile geri alın; yanlış env token'ını
  revoke edin. Channel'ı uyumsuz runtime branch'ine zorlamayın.
- **Owner/evidence:** Release owner (atanmadı), `release-evidence/<SHA>/manual/eas-environments/`.

## 6. OTA code-signing plan, key ve certificate

- **Durum:** [ ] Bekliyor; **şu anda etkin değil**.
- **Neden:** EAS Update code signing desteklenen Production/Enterprise plan ve binary'ye gömülü public
  certificate gerektirir; repository account planını kanıtlayamaz.
- **Nerede:** Expo account plan/EAS Update config; production protected secret store; native build.
- **Değer adları:** `EAS_UPDATE_CODE_SIGNING_ENABLED`, `EAS_UPDATE_PRIVATE_KEY_PEM`, certificate path/
  metadata. Private key değeri kaydedilmez.
- **Doğrulama:** Önce account plan desteğini resmi Expo dashboard'da doğrulayın. Etkinleştirilirse
  Android 53/iOS 55 artifact içindeki certificate'i ve ayrı izole signing fixture'ında invalid-
  signature rejection'ı gerçek cihazda kanıtlayın.
- **Güvenli sonuç:** Preview workflow unsigned'dır ve production private key'ini içermez; production
  private key yalnız protected environment job'unda geçici dosyaya yazılır/silinir; public
  certificate iki yeni binary'de eşleşir.
- **Rollback:** Şüphede key'i revoke/rotate edin, production OTA'yı durdurun. Certificate değişikliği
  yeni binary/runtime review ister; signing'i uygulanmış gibi işaretlemeyin.
- **Owner/evidence:** Security + release owner (atanmadı), `release-evidence/<SHA>/manual/ota-signing/`.

## 7. Android ve iOS signing

- **Durum:** [ ] Bekliyor.
- **Neden:** İlk OTA-capable Android 53 AAB ve iOS 55 build mevcut store identity ile imzalanmalıdır.
- **Nerede:** Local/EAS credentials store, Play App Signing ve App Store Connect.
- **Değer adları:** Android keystore alias/certificate fingerprints; Apple team, distribution cert,
  provisioning profile; değer/anahtar dosyası değil.
- **Doğrulama:** `npm run check:signing`; `npm run check:native-parity`; Android için `jarsigner \
-verify -verbose -certs "$AAB_PATH"`; EAS build JSON ve Apple processing state kontrolü.
- **Güvenli sonuç:** `com.wmatch.app`, version `1.0.51`, Android 53, iOS 55, beklenen certificate ve
  candidate SHA aynı artifact kaydındadır.
- **Rollback:** Store rollout'u durdurun; previous signed store artifact'i koruyun. Yeni signing
  identity üretmeyin veya package/bundle ID değiştirmeyin.
- **Owner/evidence:** Mobile release owner (atanmadı), `release-evidence/<SHA>/manual/native-signing/`.

## 8. Sentry token, project ve alert

- **Durum:** [ ] Bekliyor.
- **Neden:** Source-map/native symbol, release cohort, redaction ve alert delivery olmadan canary
  sağlığı ölçülemez.
- **Nerede:** Sentry project/releases/alerts; EAS/GitHub protected environments.
- **Değer adları:** `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, org/project adları, traces sample
  rate, on-call destination.
- **Doğrulama:** Candidate release/dist/runtime/update tags ile test exception gönderin; source map/
  symbolication ve delivered test alert'i provider ekranında kontrol edin.
- **Güvenli sonuç:** Stack symbolicated; release `com.wmatch.app@1.0.51`, dist 53/55, SHA/runtime/channel/
  update ID doğru; PII/redaction canary görünmüyor; alert gerçek hedefe ulaşıyor.
- **Rollback:** Token'ı revoke edin, alert'i disable/previous config'e döndürün; telemetry yokken
  rollout'u ilerletmeyin.
- **Owner/evidence:** Observability/on-call owner (atanmadı), `release-evidence/<SHA>/manual/sentry/`.

## 9. Provider credentials

- **Durum:** [ ] Bekliyor.
- **Neden:** Mevcut TMDB, push (FCM/APNs) ve moderation SMTP akışlarının secret/lifecycle ve fail-closed
  davranışı doğrulanmalıdır.
- **Nerede:** Provider consoles, Supabase Function secrets, EAS credentials.
- **Değer adları:** `TMDB_API_KEY`, FCM V1 service credential adı, APNs key/cert kimliği,
  `MODERATION_SMTP_*` ve moderation from/to adları.
- **Doğrulama:** Preview TMDB allowlist/cache testi; iki platform push ticket+receipt; sanitized test
  report email. Secret'ın mobile export/log/SBOM'da olmadığını kontrol edin.
- **Güvenli sonuç:** TMDB secret yalnız server; push receipt healthy; moderation email yalnız vaka
  metadata'sı taşır; provider failure kullanıcı verisi sızdırmadan degraded/fail-closed olur.
- **Rollback:** Tek provider credential'ını rotate/revoke edin; stale push'ları toplu replay etmeyin;
  önceki known-good adapter config'e dönün.
- **Owner/evidence:** Provider + security owner (atanmadı), `release-evidence/<SHA>/manual/providers/`.

## 10. Staging deploy

- **Durum:** [ ] Bekliyor.
- **Neden:** DB/RLS, edge, API/schema ve OTA aynı SHA'da production öncesi izole doğrulanmalıdır.
- **Nerede:** İzole Supabase staging, Cloudflare preview, EAS preview environment.
- **Değer adları:** Candidate SHA, staging project ref, preview host/channel, fixture namespace.
- **Doğrulama:** `npm run verify:release`; DB replay/RLS; preview `/health`; EAS preview update JSON;
  clean-tree ve checksum manifest.
- **Mevcut kanıt sınırı:** Dirty working tree'de 45/45 ilk apply ve ikinci full replay, boş
  `public,storage,realtime` diff, source/restored pgTAP dört dosya/`166/166`, warn-level advisor sıfır
  issue ve atomic nonce concurrency 32/32 geçmiştir. Bunlar staging attack matrix, deploy veya
  immutable same-SHA evidence değildir.
- **Güvenli sonuç:** Migration iki kez replay, schema diff temiz, attack matrix expected, preview group
  SHA/runtime doğru; production kullanıcı/verisi/provider delivery kullanılmaz.
- **Rollback:** Preview deployments'ı known-good version'a alın ve fixture project'i izole edin;
  production migration/history'ye dokunmayın.
- **Owner/evidence:** QA/platform/release owner (atanmadı), `release-evidence/<SHA>/manual/staging/`.

## 11. Gerçek cihaz matrisi

- **Durum:** [ ] Bekliyor.
- **Neden:** UI/accessibility/performance/offline/OTA davranışı simulator ve repo testinden kanıtlanamaz.
- **Nerede:** Android düşük/orta cihaz + küçük/büyük ekran; iPhone küçük/büyük + iPad destek matrisi.
- **Değer adları:** Device model/OS, build ID, SHA, runtime/channel/update ID, locale/font scale.
- **Doğrulama:** Mevcut Maestro journeys + manual auth/profile/discovery/like/match/chat/block-report/
  deletion; cold/warm, offline/reconnect/kill, push/deep-link, VoiceOver/TalkBack ve performance capture.
- **Güvenli sonuç:** P0 akışlar iki platformda geçer; cross-user veri yok; embedded/preview/rollback
  güvenli; ölçümler baseline ve hedefle kayıtlıdır.
- **Rollback:** Test rollout'unu durdurun, known-good update/binary'ye dönün; failing artifact'i store'a
  taşımayın.
- **Owner/evidence:** QA + accessibility + performance owner (atanmadı),
  `release-evidence/<SHA>/manual/devices/`.

## 12. TestFlight ve Internal Track

- **Durum:** [ ] Bekliyor.
- **Neden:** Store-distributed signing/entitlement/update davranışı gerçek dağıtım kanalında
  doğrulanmalıdır.
- **Nerede:** App Store Connect TestFlight ve Google Play Internal/Closed testing.
- **Değer adları:** EAS build/submission ID, ASC build 55, Play release Android 53, tester cohort.
- **Doğrulama:** Store processing state, artifact install ve `docs/ota-runtime-and-release.md` cihaz
  matrisi; build metadata/SHA checksum eşliği.
- **Güvenli sonuç:** İki store candidate'ı doğru ID/version/build ile install olur; startup, push,
  link ve OTA preview/production sözleşmesi geçer.
- **Rollback:** Submission/rollout'u durdurun; previous store production artifact'i koruyun.
- **Owner/evidence:** Store release owner (atanmadı), `release-evidence/<SHA>/manual/store-beta/`.

## 13. Store privacy ve UGC formları

- **Durum:** [ ] Bekliyor.
- **Neden:** Location, profile photo, chat/report/block, account deletion ve moderation davranışı store
  beyanlarıyla eşleşmelidir.
- **Nerede:** App Store Connect App Privacy/Review ve Play Console Data Safety/Content/UGC.
- **Değer adları:** Privacy policy/terms URLs, data categories/purposes/retention, account deletion,
  UGC report/block/moderation response bilgileri.
- **Doğrulama:** Form export/screenshot'u current app data inventory ve `docs/network-and-data-inventory.md`
  ile iki kişi karşılaştırır.
- **Güvenli sonuç:** Beyan ile gerçek toplama/paylaşım/retention aynı; yeni özellik/panel iddiası yok;
  deletion ve report yolları reviewer tarafından erişilebilir.
- **Rollback:** Submission'ı durdurun ve formu düzeltin; uyumsuz binary'yi review'a göndermeyin.
- **Owner/evidence:** Privacy/legal + store owner (atanmadı), `release-evidence/<SHA>/manual/store-privacy/`.

## 14. Backup/PITR ve restore drill

- **Durum:** [ ] Bekliyor.
- **Neden:** RPO/RTO ve database + private Storage toparlama kanıtlanmalıdır.
- **Nerede:** Supabase Backups/PITR ve izole restore-to-new-project; ayrı Storage backup alanı.
- **Değer adları:** Source/target project ref, backup/restore point UTC, retention, RPO/RTO, object
  inventory/checksum; connection/secret değerleri değil.
- **Doğrulama:** `docs/backup-restore-runbook.md` matrisini izole target'ta uygulayın; migration/RLS/
  Auth/Storage/Realtime/Function/deletion sonuçlarını ve süreyi kaydedin.
- **Güvenli sonuç:** Production ref hedef değildir; DB ve object inventory beklenen; gerçekleşen RPO/
  RTO owner hedefini karşılar; backup dosyası Git/artifact'e girmez.
- **Rollback:** Drill target'ını izole edin; production'a write/cutover yapmayın. Production in-place
  restore yalnız ayrı P0 incident ve iki kişilik onaydır.
- **Owner/evidence:** Data/DR owner (atanmadı), `release-evidence/<SHA>/manual/restore/`.

## 15. Canary ve rollback onayı

- **Durum:** [ ] Bekliyor.
- **Neden:** Production binary/OTA/edge/migration bağımsız, ölçümlü ve geri alınabilir olmalıdır.
- **Nerede:** Protected production environments, EAS/Cloudflare/Supabase/store dashboards.
- **Değer adları:** Candidate SHA, good/bad group ID veya Worker version ID, OTA rollout
  `5/20/50/100`, Worker rollout `5/25/50/100`, observation window, baseline/stop thresholds,
  approver/incident ID.
- **Doğrulama:** Preview same-SHA; OTA ve Worker için kendi sıralarındaki her aşamada dashboard query;
  previous/embedded OTA, Worker known-good version, Function, store ve restore tabletop/drill kayıtları.
- **Güvenli sonuç:** Nicel baseline/hedef mevcut; hard-stop yok; her aşama ayrı onaylı; rollback group/
  embedded bundle iki platformda doğrulanmış.
- **Rollback:** OTA için `docs/ota-rollback-runbook.md`, Worker için
  `docs/cloudflare-architecture.md` içindeki version rollback modelini ve ilgili bağımsız component
  rollback'ini çalıştırın; production DB migration history'yi resetlemeyin.
- **Owner/evidence:** Incident commander + release owner (atanmadı),
  `release-evidence/<SHA>/manual/canary-approval/`.

## 16. Store görselleri ve pazarlama materyali

- **Durum:** [ ] Bekliyor.
- **Neden:** Store ve reklamda gösterilen her ekranın candidate build'de gerçekten bulunduğu, repo
  tarafından kanıtlanamaz; ekran görüntüsü gerçek cihazdan alınır ve gösterilen kontrol ile
  `quality/feature-surface.snapshot.json` elle karşılaştırılır.
- **Nerede:** Gerçek cihaz (simulator kabul edilmez: status bar ve font render'ı farklıdır),
  App Store Connect Media Manager, Play Console Store listing.
- **Değer adları:** Candidate SHA, build 55 / Android 53, cihaz modeli, ekran boyutu sınıfı,
  `docs/marketing/screenshot-storyboard.md` içindeki export adları.
- **Doğrulama:** Altı karenin her biri storyboard'daki ekran, başlık ve durumla eşleşir;
  `docs/marketing/claims-register.md` içindeki her kullanılan iddia `ONAYLI`;
  `docs/marketing/brand-and-design-system.md` §8 kontrol listesi geçilir.
- **Güvenli sonuç:** Sahte sayı, sahte sohbet, sahte profil, var olmayan kontrol yok; kota çubuğu
  kırpılmamış; ilk üç kare birbirini tekrar etmiyor.
- **Bloke eden:** `claims-register.md` P-05 — hesap silme akışının candidate build'de doğrulanması.
  Bu kapanmadan Play Data Safety formu tamamlanamaz ve gönderim yapılamaz.
- **Rollback:** Store listing'i önceki sürüme döndürün; yayımlanmış reklam setini durdurun.
- **Owner/evidence:** Store release owner + marketing owner (atanmadı),
  `release-evidence/<SHA>/manual/store-assets/`.

## Final kontrol

Tüm checkbox'lar evidence path, owner, UTC zaman ve candidate SHA ile tamamlanmadan release kararı:

`IMPLEMENTATION COMPLETE, RELEASE NO-GO UNTIL LISTED MANUAL/RUNTIME EVIDENCE IS ATTACHED TO THE SAME COMMIT SHA.`
