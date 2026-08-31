# OTA rollback runbook

Bu runbook EAS Update için kullanıcı ekranı eklemeden geri alma yapar. Komut sözleşmesi güncel Expo
CLI adları olan `update:rollback`, `update:republish`, `update:edit` ve
`update:roll-back-to-embedded` üzerine kuruludur. Repository production workflow'u ayrıca onaylı
known-good grubu `update:republish` ile production kanalına taşıyabilir.

## Başlatma koşulları

Aşağıdakilerden biri varsa rollout hemen durdurulur ve incident açılır:

- startup/crash, auth veya kritik mevcut akışlarda preview baseline'a göre bozulma;
- yanlış channel/runtime/environment, eksik asset veya invalid signature;
- broken API base URL, schema/API uyumsuzluğu ya da veri izolasyonu şüphesi;
- P0 güvenlik/gizlilik, RLS/IDOR, block/report veya hesap silme hatası;
- ölçüm/dashboards erişilemiyor ya da candidate SHA/update group doğrulanamıyor.

Yeni rollout aşamasına geçmeyin. Bad group ID, production channel/branch, runtime, commit SHA,
platform, rollout yüzdesi ve ilk hata zamanını `release-evidence/<SHA>/ota/incident.md` içine yazın.
Update'i silmek rollback değildir ve olay kanıtını yok eder; `eas update:delete` kullanmayın.

## Ön kontrol

```sh
npx eas-cli@22.0.0 channel:view production --json --non-interactive
npx eas-cli@22.0.0 update:view "$BAD_GROUP_ID" --json
npx eas-cli@22.0.0 update:list --branch "$PRODUCTION_BRANCH" --runtime-version 1.0.51 \
  --json --non-interactive
```

`$PRODUCTION_BRANCH`, ilk `channel:view` çıktısında production channel'ın bağlı olduğu branch'tir;
tahmin edilmez. Çıktıda project `wmatch`, channel `production`, beklenen runtime `1.0.51` ve olay
SHA'sı eşleşmiyorsa komut çalıştırmayın. Production protected environment onayı ve Expo token'ı
gereklidir. Code signing şu an etkin değildir. Daha sonra desteklenen planla etkinleştirilirse
aşağıdaki komutlara yalnız geçici dosyadaki `--private-key-path` eklenir; anahtar repo, terminal
geçmişi veya artifact içine yazılmaz.

## Senaryo A: En son bad group'u bir önceki update'e geri al

Expo CLI'nin non-interactive sözleşmesinde group ID en son update group olmalı ve aynı branch/runtime
için önceki grup varsa onu yeniden yayınlar; yoksa embedded rollback üretir:

```sh
npx eas-cli@22.0.0 update:rollback "$BAD_GROUP_ID" \
  --message "rollback incident=$INCIDENT_ID bad_group=$BAD_GROUP_ID" \
  --platform all \
  --non-interactive \
  --json > eas-rollback.json
```

Komut öncesinde önceki grubun aynı runtime ve API/schema sözleşmesiyle güvenli olduğu preview/cihaz
kanıtından doğrulanmalıdır. Sonucu ve `sha256sum eas-rollback.json` çıktısını saklayın.

## Senaryo B: Açıkça seçilmiş known-good group'u yeniden yayınla

Bir önceki grup güvenli değilse ve doğrulanmış group ID biliniyorsa:

```sh
npx eas-cli@22.0.0 update:republish \
  --group "$GOOD_GROUP_ID" \
  --destination-channel production \
  --rollout-percentage 100 \
  --message "rollback incident=$INCIDENT_ID good_group=$GOOD_GROUP_ID" \
  --platform all \
  --non-interactive \
  --json > eas-republish.json
```

Repository workflow'u kullanılacaksa `operation=rollback`, `rollback_group_id`, immutable `main`
control `commit_sha` ve `rollout_percentage=100` ile production approval üzerinden çalıştırılır;
rollback için `base_ref` gerekmez. Workflow kaynak grubun iki platformu, runtime'ı, git SHA'sı ve
branch'inin `production` olduğunu server JSON'undan doğrular. Böylece preview environment ile
bundle'lanmış bir grup production'a republish edilemez. Known-good grubun runtime'ı hedef binary ile
uyuşmuyorsa republish güvenli değildir.

## Senaryo C: Embedded update'e dön

Önceki OTA'ların hiçbiri güvenli değilse ve Android 53/iOS 55 embedded bundle'ı aynı schema/API ile
cihazda doğrulandıysa:

```sh
npx eas-cli@22.0.0 update:roll-back-to-embedded \
  --channel production \
  --runtime-version 1.0.51 \
  --message "embedded rollback incident=$INCIDENT_ID" \
  --platform all \
  --non-interactive \
  --json > eas-embedded-rollback.json
```

Embedded rollback runtime'a özeldir. Eski Android 51/iOS 53 binary'leri yeni OTA-capable contract'ın
parçası değildir; bu komut onları yeni binary'ye yükseltmez.

## Senaryo D: Kısmi rollout'u ilerletme veya iptal etme

Sağlıklı rollout yalnız `5 -> 20 -> 50 -> 100` yönünde ilerletilir:

```sh
npx eas-cli@22.0.0 update:edit "$PRODUCTION_GROUP_ID" \
  --rollout-percentage "$NEXT_PERCENTAGE" \
  --non-interactive \
  --json
```

Repository workflow'u server'daki mevcut rollout yüzdesini ve production channel'ın en güncel group
bağını kontrol eder; atlanan, tekrarlanan veya geriye giden yüzdeyi yayınlamadan önce reddeder.

Hata halinde yüzdeyi keyfi olarak düşürmeyin veya yeni update ile aktif rollout'u ezmeyin. Senaryo
A ile `update:rollback` çalıştırın ya da Expo'nun rollout revert akışını onaylı operatör olarak
kullanın. Aynı branch/runtime üzerinde aktif rollout bitmeden yeni production update yayınlamayın.

## Yanlış channel, runtime veya API base URL

- **Yanlış channel:** Yanlış kanaldaki grubu silmeyin. Production etkilenmediyse incident/evidence
  kaydı açıp kanalı doğrulayın. Production yanlış gruba bağlıysa yalnız aynı runtime'daki known-good
  grup production'a republish edilir.
- **Yanlış runtime:** Runtime eşleşmesi zorlanamaz. Uyumlu update yayınlayın veya yeni native binary
  üretin. Channel'ı uyumsuz branch'e yönlendirmek çözüm değildir.
- **Broken API URL:** Önce origin/gateway sağlık ve schema contract'ını kontrol edin. Aynı runtime için
  doğrulanmış direct-origin/known-good bundle varsa republish edin; yoksa preview'da doğrulanmış
  fix-forward update kullanın. Eski origin, minimum binary adoption ölçülmeden kapatılmaz.
- **Invalid signature/certificate:** Yayını durdurun, signing key'i rotate/revoke edin, certificate
  binary uyumluluğunu doğrulayın. Certificate native değişikliği yeni binary gerektirir.

## Geri alma sonrası doğrulama

1. Yeni rollback group'un `production`, runtime `1.0.51` ve beklenen kaynak grup olduğunu doğrulayın.
2. Android 53 ve iOS 55 cihazlarında update indirimi sonrası iki cold start yapın; embedded/rollback
   update ID ve channel telemetrisini doğrulayın.
3. Auth, profile, discovery, like/match, chat send/replay, block/report ve hesap silme smoke testlerini
   çalıştırın; offline açılışı ayrıca doğrulayın.
4. Crash/startup/API/auth sinyallerini release/runtime/channel/update ID boyutunda izleyin. Önceden
   tanımlı gözlem penceresi ve baseline yoksa incident kapanmaz.
5. API/schema/storage migration etkisi varsa bağımsız Supabase/edge rollback veya fix-forward
   runbook'unu çalıştırın; OTA veritabanını geri almaz.
6. Komut JSON'u, checksum, dashboard ekranı/linki, cihaz logları ve karar sahibini aynı SHA evidence
   dizinine ekleyin.

Rollback indirme garantisi değildir: çevrim dışı veya update'i daha önce almış kullanıcılar bad
bundle'ı bir süre çalıştırabilir. Hata kuyruğunun uzun kuyruğu izlenir; kritik durumda store rollout'u
durdurulur ve doğrulanmış yeni binary hazırlanır.

Komutlar repository'nin pinned `eas-cli@22.0.0` sürümünün `--help` çıktısıyla doğrulanmıştır ve
güncel resmi [Expo CLI reference](https://docs.expo.dev/eas/cli/) ile
[rollback sözleşmesini](https://docs.expo.dev/eas-update/rollbacks/) izler.
