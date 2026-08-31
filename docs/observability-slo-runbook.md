# Observability and SLO runbook

Bu runbook repository'deki sinyalleri release ve incident kararına bağlar. Dashboard, alert delivery,
gerçek trafik baseline'ı veya provider ekran görüntüsü repository'de olmadığı için hiçbir SLO
sağlanmış sayılmaz.

## Release kimliği ve korelasyon

Mobil telemetry aşağıdaki boyutları üretir:

- `release`: `com.wmatch.app@<native-version>`;
- `dist`: native Android versionCode veya iOS buildNumber;
- `app.commit_sha`: `EXPO_PUBLIC_RELEASE_SHA`;
- `app.runtime_version`: Expo Updates runtime;
- `app.update_channel` ve `app.update_id`;
- `environment`: development/preview/production.

Mobil API transport her isteğe client request ID ekler ve response `x-request-id` değerini hata
nesnesine taşır. Edge logu normalized route, method, status, duration ve request ID içermelidir.
Cloudflare kullanılan seçili yollarda `cf-ray`, upstream Supabase Function request ID ve mobil
request ID aynı incident kaydında ilişkilendirilir. Repository telemetry'si `cf-ray`/provider
dashboard korelasyonunun canlıda çalıştığını tek başına kanıtlamaz.

## Sinyal envanteri

| Katman | Mevcut sinyal | Beklenen boyut | Kanıt durumu |
|---|---|---|---|
| Mobil | Sentry exception/session/app-start, startup milestones, task span ve duration | release, dist, SHA, runtime, channel, update ID, environment | Kod var; dashboard/source-map/test-alert kanıtı yok |
| API client | route/method/status/outcome/duration/request ID ve retry sınıfı | normalized route, release cohort | Test asset'i var; production paneli yok |
| Supabase Function | JSON request logu ve `/health` schema/release contract'ı | request ID, route, status, duration, actor safe-ref | Önceki release kanıtı var; yeni migration/candidate SHA için canlı kanıt yok |
| Database | migration/schema contract, push health read model | project, schema version, lock/pool/slow query | Repo SQL'i var; yeni candidate staging/production metriği yok |
| Push | outbox/ticket/receipt retry, dead ve stalled sayıları | provider/platform/status | Önceki production olayı belgeli; yeni candidate aynı-SHA koşusu yok |
| Cloudflare | request/origin/cache/rate-limit logları | cf-ray, route class, status, cache outcome | Infra tanımı olabilir; deployment/dashboard/alert kanıtı yok |

## SLO durumu

`docs/operations/observability.md` daha eski bir çalışma kapsamında 99.9% API availability, 600 ms
p95 API, 99.5% crash-free session ve 1.8 s cold useful-content gibi **öneri** değerleri taşır. Bu
değerlerin current candidate cihaz/trafik baseline'ından türetildiğine dair aynı-SHA artifact yoktur;
bu nedenle aktif SLO veya `PASS` olarak kopyalanmaz.

| SLI | Candidate baseline | Onaylı hedef | Release durumu |
|---|---|---|---|
| Critical API availability/error ratio | Ölçülmedi | Belirlenmedi | `NO-GO` |
| API p50/p95/p99 ve payload/request count | Ölçülmedi | Belirlenmedi | `NO-GO` |
| Cold/warm start ve first useful content | Ölçülmedi | Belirlenmedi | `NO-GO` |
| Crash-free session/user | Ölçülmedi | Belirlenmedi | `NO-GO` |
| Realtime reconnect/gap | Ölçülmedi | Belirlenmedi | `NO-GO` |
| Upload throughput/failure/orphan | Ölçülmedi | Belirlenmedi | `NO-GO` |
| Push ticket/receipt/dead/stalled | Yeni SHA'da ölçülmedi | Belirlenmedi | `NO-GO` |
| Worker origin/cache/rate-limit | Ölçülmedi | Belirlenmedi | `NO-GO` |
| DB pool/lock/slow query | Ölçülmedi | Belirlenmedi | `NO-GO` |

Baseline preview'da, production ile eşdeğer fixture ve aynı candidate SHA üzerinde ölçülür. Owner,
örnek hacmi, pencere, percentile yöntemi ve hedefi manifest'e yazmadan production rollout başlamaz.

## Sayısal baseline'dan bağımsız hard-stop kapıları

Aşağıdakilerden biri görüldüğünde alarm eşiği beklenmeden rollout durur:

- P0 security/privacy, RLS/IDOR, başka kullanıcı verisi veya secret/PII log sızıntısı;
- hesap silme saga'sının auth silindikten sonra kalıcı olarak tamamlanamaması;
- yanlış runtime/channel/environment, invalid update signature veya update/embedded startup failure;
- auth akışının cohort genelinde kullanılamaması;
- block/report bypass'ı, duplicate message/match veya veri kaybı;
- telemetry/dashboard erişilemediği için sağlık kararı verilememesi.

Bu hard-stop'lar SLO yerine geçmez; yalnız güvenli fail-closed davranıştır.

## Dashboard ve alert kurulumu

1. Sentry'de environment + release + dist + runtime + update ID filtreli mobil dashboard oluşturun.
2. Supabase'te Function status/latency, database pool/lock/slow query ve push health panellerini açın.
3. Seçici edge yolları için Cloudflare request/origin/cache/rate-limit panelini oluşturun.
4. Preview baseline'ını aynı SHA ve fixture ile ölçüp SLI tablosuna ekleyin; sample size ve pencereyi
   kaydedin.
5. Hedef/alert'i baseline ve kullanıcı etkisine göre release owner + on-call onayıyla belirleyin.
6. Her provider'da sentetik test alarmı üretin; gerçek on-call hedefine ulaştığını timestamp ile
   kanıtlayın. Alarm yalnız dashboard'da görünüyorsa alert delivery tamam değildir.
7. Dashboard URL'leri ve ekran görüntülerinde kullanıcı ID, email, message, location, token veya
   signed URL olmadığını kontrol edip evidence'a ekleyin.

## Triage akışı

1. Etkilenen SHA, release/dist, runtime, channel, update ID, platform ve ilk/son zamanı sabitleyin.
2. Mobil request ID'den edge/Supabase loguna; Cloudflare yolunda ayrıca `cf-ray` üzerinden origin
   kaydına gidin. ID yoksa correlation gap olarak kaydedin.
3. Sorunu auth, API/schema, Realtime, upload, push, OTA veya provider sınıfına ayırın.
4. P0/hard-stop ise rollout'u durdurun ve ilgili rollback/incident runbook'unu çalıştırın.
5. Kullanıcı içeriğini ticket'a kopyalamayın; yalnız opaque ID, normalized route, status ve safe
   cohort metadata kullanın.
6. İyileşme sonrası aynı query/window ile karşılaştırın; gözlem penceresi dolmadan incident kapatmayın.

## PII redaction sözleşmesi

Email, access/refresh token, authorization header, password/secret, mesaj/report ayrıntısı, precise
location, profile photo/signed URL, medya içeriği ve raw request/response body loglanmaz. Sentry
`sendDefaultPii=false` kullanır ve nested key/text redaction uygular. Redaction unit testi ile birlikte
provider ingest ekranında canary PII'nin görünmediği manuel olarak doğrulanır.

## Evidence

`release-evidence/<SHA>/observability/` altında dashboard bağlantıları, export edilmiş query tanımı,
baseline CSV/JSON, alert kuralı, test-alert teslim kaydı, source-map/symbol upload sonucu ve redaction
kanıtı tutulur. Secret veya ham kullanıcı verisi artifact'e eklenmez.
