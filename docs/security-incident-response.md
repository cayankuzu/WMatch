# Security incident response

Bu runbook WMatch'in mevcut auth, profile/private media, discovery/match/chat, report/block, push,
Supabase ve OTA sınırlarını korur. Yeni kullanıcı güvenlik merkezi veya admin paneli oluşturmaz.

## Roller ve durum

| Rol | Sorumluluk | Mevcut atama |
|---|---|---|
| Incident commander | Severity, containment, rollback ve kapanış kararı | Repository'de atanmadı |
| Security owner | Scope, evidence preservation, credential/RLS analizi | Repository'de atanmadı |
| Supabase/data owner | DB/Auth/Storage/Realtime containment ve recovery | Repository'de atanmadı |
| Mobile/release owner | Store/OTA durdurma, binary/update rollback | Repository'de atanmadı |
| Communications/privacy owner | Kullanıcı/provider/yasal bildirim kararı | Repository'de atanmadı |

Owner ve 7/24 escalation hedefi `docs/MANUAL_STEPS.md` üzerinden tamamlanmadan operasyon olgunluğu
kapısı `NO-GO`dur.

## Severity

- **P0:** aktif secret/signing-key sızıntısı; RLS/IDOR veya cross-user message/photo/location erişimi;
  auth takeover; kötü niyetli imzalı OTA; geri döndürülemez veri kaybı; hesap silme/privacy ihlali.
- **P1:** sınırlı ama doğrulanmış abuse, block/report bypass, provider credential hatası, geniş auth/
  push/upload kesintisi veya tekrarlanabilir güvenlik kontrolü zayıflığı.
- **P2:** kullanıcı verisine erişim kanıtı olmayan düşük etkili güvenlik/config sapması.

Şüphe P0 ise kapsam bilinmese bile fail-closed containment uygulanır; `kanıt yok` ifadesi temiz
telemetry/evidence olmadan severity düşürme gerekçesi değildir.

## İlk 30 dakika

1. Incident ID, UTC başlangıç, bildiren kaynak, etkilenen environment/project/release/SHA/runtime/
   channel ve bilinen göstergeleri kaydedin.
2. Logları silmeden erişimi sınırlandırın; provider audit log, workflow run, update/build ID ve DB
   timestamp'lerini immutable evidence alanına alın. Ham PII'yi ticket'a kopyalamayın.
3. İlgili deployment/rollout'u durdurun. Yanlış update için `docs/ota-rollback-runbook.md`, veri kaybı
   için `docs/backup-restore-runbook.md` kullanılır.
4. Sızan credential'ı önce revoke/rotate edin; yeni değeri yalnız ilgili protected secret store'a
   koyun. Repository'ye veya chat/ticket'a yazmayın.
5. RLS/IDOR/cross-user şüphesinde riskli route'u/edge girişini kapatın veya direct origin'i güvenli
   sözleşmeye alın; Auth/Postgres source of truth'u kopyalamayın.
6. Legal/privacy owner'a severity ve muhtemel veri sınıfını iletin; bildirim süresini tahmin etmeyin,
   geçerli mevzuat ve gerçek scope'a göre karar verin.

## Playbook'lar

### Supabase token, service role veya DB credential

1. Etkilenen key/token'ı revoke/rotate edin; GitHub/EAS/Cloudflare/Supabase secret sınırlarını ayrı
   tutun.
2. Audit loglarda key kullanım zamanı, IP/actor, route ve write/read kapsamını inceleyin.
3. RLS'yi bypass eden service-role işlemlerinde moderation, account deletion, message ve private
   Storage tablolarını önceliklendirin.
4. `npm run check:secrets`, full-history gitleaks ve SAST sonuçlarını aynı SHA evidence'a ekleyin.
5. Mobilde gömülü public anon/publishable key secret değildir; buna rağmen RLS/route abuse'u test
   edilir. Service role hiçbir mobil/OTA bundle'da bulunamaz.

### RLS/IDOR, Realtime veya private photo sızıntısı

1. Etkilenen table/bucket/topic/route'u belirleyip riskli access path'i durdurun.
2. anon, user-A, user-B, blocked ve service-role matrisini izole staging'de yeniden üretin.
3. `profile-photos` bucket public olamaz; yalnız owner-scoped managed object key ve kısa ömürlü signed
   URL kabul edilir. External non-managed URL bulgusu P0 kabul edilir.
4. Conversation/presence Realtime topic'i active canonical match ve bilateral no-block koşulu olmadan
   okunup yazılamaz.
5. Forward-only minimum migration/fix kullanın; production migration history reset/rewrite etmeyin.

### Account deletion/privacy talebi

1. `account_deletion_jobs` stage, `updated_at` ve sanitized `last_error` değerini restricted erişimle
   kontrol edin.
2. Mevcut job varsa `docs/operations/account-deletion.md` ile saved stage'den resume edin; job veya
   `photo_paths` yeniden yaratılmaz.
3. Auth silinmiş ama profile cleanup bekliyorsa kullanıcıyı geri açmayın; saga'yı tamamlayın ve
   sonuçta Auth/profile/Storage object kalmadığını doğrulayın.
4. Notification ve moderation related-data cleanup ile local logout/cache/outbox purge kanıtını
   ayrı kaydedin.

### OTA/update signing veya supply-chain

1. Production rollout'u durdurun, bad group/build/SHA/runtime/channel'ı sabitleyin.
2. Private update key veya native signing credential sızdıysa revoke/rotate edin. Update certificate
   değişikliği yeni Android/iOS binary ve runtime değerlendirmesi gerektirir.
3. Bilinen güvenli update/embedded bundle'a resmi Expo CLI rollback uygulayın; update silmeyin.
4. Workflow action pinleri, lockfile, SBOM, dependency audit/license/provenance ve artifact checksum/
   signature doğrulamasını yeniden çalıştırın.

### TMDB, push, SMTP, Sentry veya Cloudflare credential

1. Yalnız etkilenen provider credential'ını revoke/rotate edin; blast radius'i ayrı tutun.
2. TMDB secret mobil bundle/logda bulunamaz. Moderation SMTP e-postası report details/snapshot
   içeremez. Push provider credential hatasında eski notification'ları körlemesine replay etmeyin.
3. Provider unavailable ise mevcut akış fail-closed/degraded davranır; yeni alternatif product
   surface açılmaz.

## Evidence ve gizlilik

Toplanacaklar: immutable SHA, clean-tree durumu, provider audit export, workflow/build/update IDs,
checksum/imza, normalized route/status/request ID/cf-ray, migration/schema sürümü ve UTC timeline.
Toplanmayacaklar: access/refresh token, DB password, private key, email, message/report details,
precise location, signed URL, profile photo veya raw request body.

Evidence read-only tutulur; erişen kişi ve export checksum kaydedilir. Secret içeren dosya yanlışlıkla
artifact'e girdiyse artifact erişimi derhal kapatılır ve secret rotate edilir.

## Recovery ve kapanış

- Fix/rollback önce preview/staging'de aynı saldırı senaryosunu kapatır, regression ve feature-freeze
  guard'ı geçer.
- Production yeniden açma IC + security + data/release owner onayı gerektirir.
- En az scope, etkilenen veri/hesap sayısı, root cause, containment, credential rotasyonu, restore/
  rollback sonucu ve kalan risk yazılır.
- Required external/user/regulatory communication yalnız privacy/legal owner'ın gerçek scope ve
  geçerli süreleri doğrulamasından sonra yapılır.
- Post-incident action yeni ürün yüzeyi eklemeden guard, test, runbook veya mevcut akış hardening'i
  olarak uygulanır.
