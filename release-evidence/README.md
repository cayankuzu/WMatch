# Release evidence contract

Bu dizin evidence şemasını taşır; mevcut bir production release'in geçtiğini iddia etmez.
`manifest.template.json` içindeki `pending`, `null` veya placeholder değerler kanıt değildir.

## Tek SHA kuralı

Her release adayı için immutable 40 karakter commit SHA seçilir ve bütün repository, build, deploy,
runtime, provider ve manuel kanıtları aynı SHA altında tutulur:

```text
release-evidence/<SHA>/
  manifest.json
  repository/
  database/
  edge/
  ota/
  artifacts/android/
  artifacts/ios/
  devices/
  load/
  accessibility/
  observability/
  moderation/
  restore/
  store/
  manual/
```

Farklı commit'lere ait test, AAB/IPA, migration, Worker, Function veya ekran görüntüsü tek release
kanıtı olarak birleştirilemez. Dirty tree'den üretilen çıktı production evidence değildir.

## Manifest oluşturma

1. `manifest.template.json` dosyasını değiştirmeden
   `release-evidence/<SHA>/manifest.json` olarak kopyalayın.
2. Candidate identity'yi repository ve native config'den doldurun. WMatch current target'ı version
    `1.0.51`, runtime `1.0.51`, Android `53`, iOS `55`'tür.
3. Her komut için exact command, tool version, UTC start/end, exit code, log path ve SHA-256 yazın.
4. Artifact için build/update/deploy ID, platform/environment/channel/runtime, source SHA, size,
   SHA-256 ve signature/certificate sonucu ekleyin.
5. Runtime/manual maddesini yalnız gerçek cihaz/provider/drill kanıtı mevcutsa `passed` yapın.
6. Manifest ve bağlı dosyaların son checksum listesini üretip read-only artifact olarak saklayın.

Örnek checksum komutu:

```sh
find "release-evidence/$CANDIDATE_SHA" -type f ! -name manifest.sha256 -print0 \
  | sort -z \
  | xargs -0 sha256sum > "release-evidence/$CANDIDATE_SHA/manifest.sha256"
```

`.github/workflows/release-evidence.yml` clean immutable checkout üzerinde repository gates, Expo
export, SBOM ve checksum artifact'i üretir. Workflow tanımı veya eski successful run yeni candidate
kanıtı değildir.

`docs/release-readiness.md` içinde listelenen iki yerel PostgreSQL 17 replay'i, final source DB pgTAP
üç dosya/`117/117`, DB lint/advisor, atomic nonce pgbench ve boş schema diff gerçek yerel
sonuçlardır; working tree dirty olduğu için template alanları yine `pending` kalır. Aynı kontroller
clean immutable candidate SHA'da checksum'lı loglara bağlanmadan manifest'te `passed` yapılmaz.

Aynı sınır, SHA-256 değeri
`f96ca69d2e264e045dc0ab53996589c4b9369ce8eeb1f45d5eec4be9002ea095` olan yerel custom dump'ın
owner-preserving restore'u ve restored DB pgTAP üç dosya/`117/117` sonucu için de geçerlidir. Bu
gerçek local drill sonucu provider PITR, Storage object restore, ölçülmüş RPO/RTO veya candidate
manifest `restoreDrillStatus=passed` kanıtı değildir.

## Kabul edilen evidence

- CI/provider tarafından üretilmiş machine-readable JSON/log ve checksum;
- signed AAB/IPA metadata'sı, certificate fingerprint ve store build/submission ID;
- EAS update group/runtime/channel/SHA JSON'u ve rollout/rollback sonucu;
- staging DB migration replay, RLS/IDOR attack output, schema diff ve health response;
- atomic concurrency için transaction/failure dağılımı, beklenen tek-winner invariant'ı ve DB row
  sayımı taşıyan pgbench çıktısı;
- Cloudflare Worker version/source SHA, traffic split, budget/health gate ve known-good rollback kaydı;
- model/OS/build/SHA içeren cihaz logu, screenshot/video ve test sonucu;
- Sentry/Cloudflare/Supabase dashboard query export'u ve delivered test-alert kaydı;
- sanitized backup inventory, izole restore validation ve ölçülmüş RPO/RTO;
- logical restore için dump checksum'u, owner/grant integrity sonucu, restored schema sayımları ve
  restore sonrası pgTAP çıktısı;
- owner/approver, UTC zamanı ve rollback referansı taşıyan manuel karar.

## Kabul edilmeyen evidence

- dosyanın/testin yalnız repository'de bulunması;
- local dirty-tree çıktısı, elle yazılmış `PASS`, mock screenshot veya checksum'suz artifact;
- başka SHA/sürüm/build/runtime/channel/environment sonucu;
- secret, access token, private key, DB dump, ham kullanıcı verisi veya PII içeren dosya;
- eski Android 51/iOS 53 artifact'ini yeni OTA-capable Android 53/iOS 55 kanıtı olarak kullanmak;
- dirty-tree local DB replay/pgTAP/lint/schema-diff sonucunu immutable same-SHA repository artifact'i,
  staging attack matrix'i veya staging/production deploy'u yerine kullanmak;
- dirty-tree local logical restore'u provider backup/PITR, Storage object restore, ölçülmüş RPO/RTO
  veya immutable same-SHA restore evidence yerine kullanmak;
- dashboard linki olmadan iddia edilen deployment/alert/backup/store durumu.

## Redaction ve saklama

Evidence'ta email, token, password/secret/private key, message/report details, precise location,
signed URL, profile photo ve raw body bulunmaz. Opaque ID gerekiyorsa salted hash veya provider-safe
reference kullanılır. DB dump/backup ayrı şifreli restricted alanda tutulur; bu dizine eklenmez.

## Karar

Manifest ancak bütün P0 kapıları ve 35 alanın aynı-SHA kanıtı tamamlandığında `GO` olabilir. Şu anki
zorunlu karar metni:

`IMPLEMENTATION COMPLETE, RELEASE NO-GO UNTIL LISTED MANUAL/RUNTIME EVIDENCE IS ATTACHED TO THE SAME COMMIT SHA.`
