# OTA runtime and release contract

Bu belge WMatch'in mevcut EAS Update sözleşmesini tanımlar. Bir yayın kanıtı değildir. Komut çıktısı,
imzalı artifact ve cihaz sonucu aynı immutable commit SHA'ya bağlanmadıkça OTA hazır veya production
`GO` sayılmaz.

## Repository'deki runtime kimliği

| Alan | Repository değeri | Operasyon anlamı |
|---|---|---|
| Uygulama sürümü | `1.0.51` | Bare Android için elle tanımlanan `runtimeVersion=1.0.51` ile OTA uyumluluğu açıkça sabitlenir |
| Android | `versionCode 53` | İlk OTA-capable Android binary adayıdır; henüz imzalı build/cihaz kanıtı yoktur |
| iOS | `buildNumber 55` | İlk OTA-capable iOS binary adayıdır; repository'de `ios/` ağacı yoktur ve EAS build kanıtı gerekir |
| Update URL | `https://u.expo.dev/5aab8659-db24-4152-aa79-142f210e16d1` | EAS project ID ile native Android config aynı değeri taşır |
| Kanallar | `development`, `preview`, `production` | `eas.json` içindeki build profile, environment ve channel adları bire bir eşleşir |
| Embedded update | açık | Ağ yokken veya uygun update yokken binary içindeki bundle güvenli tabandır |

`expo-updates` bu değişiklik setinde native dependency/config olarak etkinleştirildi. Bu nedenle daha
önce yayınlanan Android `versionCode 51` ve iOS `buildNumber 53` artifact'leri bu yeni update
sözleşmesine göre OTA-capable kabul edilemez. **İlk OTA yayını öncesinde aynı commit'ten imzalı
Android 53 AAB ve iOS 55 build üretilmeli, kurulmalı ve her iki platformda embedded/preview update
testleri tamamlanmalıdır.** `app.json` veya EAS dashboard ayarı eski kurulu binary'leri geriye dönük
olarak OTA-capable yapmaz.

## Uyumluluk ve sınıflandırma

`scripts/guards/classify-ota-change.mjs` değişen yolları fail-closed sınıflandırır:

| Sonuç | Örnek | İzin verilen işlem |
|---|---|---|
| `OTA_SAFE` | Mevcut runtime ile uyumlu `src/`, `utils/` veya branding dışı asset değişikliği | Aynı runtime'ın preview kanalına aday olabilir |
| `NATIVE_BUILD_REQUIRED` | `android/`, `ios/`, `app.json`, `eas.json`, dependency/lockfile, Firebase/native config, branding asset | Yeni version/build ve yeni imzalı binary gerekir; production OTA workflow'u durur |
| `MANUAL_REVIEW_REQUIRED` | Bundle/toolchain config'i veya bilinmeyen yol | Açık runtime incelemesi yapılmadan OTA yoktur |

Yerel sınıflandırma:

```sh
node scripts/guards/classify-ota-change.mjs --base "$LAST_BINARY_SHA" --head "$CANDIDATE_SHA"
node scripts/guards/classify-ota-change.mjs --base "$LAST_BINARY_SHA" --head "$CANDIDATE_SHA" --assert-ota-safe
```

Sınıflandırıcı yalnız dosya yolu etkisini kanıtlar; native uyumluluğun cihaz kanıtı değildir. Native
SDK/dependency, permission/entitlement, scheme/associated domain, Firebase config veya update
certificate değişikliğinde runtime aynı görünse bile yeni binary zorunludur.

## İlk OTA-capable binary yayın sırası

1. Temiz ve immutable candidate SHA seçilir; dirty tree çıktısı kanıt olarak kullanılmaz.
2. `npm ci` ve `npm run verify:release` aynı SHA'da geçer; çıktı ve checksum saklanır.
3. `npm run check:native-parity` ile runtime `1.0.51`, Android `53`, iOS `55`, update URL ve kanal
   eşliği doğrulanır.
4. Candidate'tan preview Android/iOS binary üretilir. Embedded bundle çevrim dışı cold start,
   auth, profile, discovery, like/match, chat, block/report ve hesap silme akışlarında test edilir.
5. Aynı candidate SHA, runtime ve preview environment ile **unsigned** preview update yayınlanır.
   Preview workflow production signing key'i almaz. Update ID/group ID, platform, channel, runtime
   ve artifact checksum kaydedilir.
6. Preview update iki platformda foreground/background/terminated, ağ kesintisi, runtime mismatch
   ve process-kill koşullarında doğrulanır.
7. Aynı SHA'dan production Android 53 AAB ve iOS 55 build oluşturulur; imza/kimlik ve store beta
   kurulumu doğrulanır. İlk production binary'nin embedded update'i bilinen güvenli tabandır.
8. Production workflow preview group içinde aynı SHA'yı doğrular; preview bundle'ını republish etmez.
   Aynı SHA'yı production environment değerleriyle yeniden bundle/publish eder. Binary adoption ve
   sağlık sinyalleri ölçülmeden rollout başlatılmaz; protected environment onayıyla
   `5% -> 20% -> 50% -> 100%` ilerler.
9. Her aşamada EAS adoption/update yükleme, Sentry crash-free/startup, auth ve kritik mutation hata
   oranı aynı release/runtime/channel boyutlarında incelenir. Nicel baseline yoksa aşama ilerlemez.

Preview workflow'u `.github/workflows/eas-update-preview.yml`; production same-SHA publish, rollout
advance ve yalnız daha önce production branch'inde yayınlanmış known-good group republish akışı
`.github/workflows/eas-update-production.yml` içindedir. İki akış da exact full SHA, clean tree ve aynı
SHA'da başarılı `ci.yml` + `quality.yml` run'ı arar. Production ayrıca control commit'in `main`
geçmişinde olmasını ve protected environment onayını zorunlu tutar. Workflow dosyasının varlığı bir
EAS yayınının yapıldığını kanıtlamaz.

2026-08-31 GitHub control-plane durumunda `development`, `preview` ve `production` environment'ları
oluşturulmuş; `production` reviewer `cayankuzu` ve protected-branch policy ile korunmuştur. Gerekli
secrets/vars, Expo/EAS environment/channel doğrulaması ve gerçek approval/publish run'ı bulunmadığı
için OTA provider durumu yine **NO-GO**'dur.

## Environment ve API cutover

- Preview update yalnız preview environment değerlerini; production yalnız production protected
  environment değerlerini kullanır. Public değişkenler bundle'a gömülebilir, secret değildir.
- `EXPO_PUBLIC_API_BASE_URL` mutlak HTTPS URL olmalıdır. Repository örneğinde değer bilinçli olarak
  boştur; gerçek stable `api.*` host manuel olarak sağlanmadan edge-enabled production artifact yoktur.
- Seçili `/health`, auth availability/reset, `/reports` ve `/tmdb/*` yolları gateway mevcutsa edge'e
  gider. Diğer mevcut HTTP sözleşmesi ve doğrudan Auth/Postgres/RLS/Realtime/Storage Supabase'te kalır.
- Gateway değeri yokken mevcut seçili çağrılar doğrudan Supabase Function origin'e döner. Eski
  binary adoption ölçülmeden bu geriye uyumlu origin sözleşmesi kapatılmaz.
- Yanlış/broken API base URL native bir zorunluluk doğurmuyorsa aynı runtime'da bilinen güvenli
  update yeniden yayınlanabilir. Uygun bilinen güvenli update yoksa fix-forward gerekir.

## Code signing

EAS Update code signing **şu anda etkin değildir**. Resmi plan desteği Production/Enterprise
hesabına bağlıdır ve repository EAS account planını doğrulayamaz. Preview workflow unsigned'dır ve
production private key'ini almaz. Production workflow plan kararı açıkça
`EAS_UPDATE_CODE_SIGNING_ENABLED=true|false` olarak belgelenmeden durur. Yalnız manuel
plan/certificate kurulumu tamamlandıktan sonra değer `true` olduğunda private PEM ayrı bir adımda,
production secret store'dan geçici runner dosyasına yazılır; publish adımı secret değerini ortam
değişkeni olarak almaz ve cleanup adımı her durumda çalışır. Public certificate'in Android 53/iOS 55 binary'lerine
gömüldüğü ve invalid-signature testinin geçtiği ayrıca kanıtlanmalıdır. Plan desteklemiyorsa sonuç
`NOT_SUPPORTED` olarak provider kanıtıyla kaydedilir, flag kapalı kalır ve code-signed OTA uygulanmış
gibi gösterilmez. Plan kararı belgelenene kadar bu manuel kapı `NO-GO`dur.

Expo Doctor'ın generic CNG app-config sync kontrolü checked-in native Android proje için bilinçli
olarak kapalıdır; bu bir bypass değildir. `npm run check:native-parity` app version/runtime/update
URL, embedded/anti-bricking politikası, Android permission/deep-link/notification metadata'sı ve EAS
channel/environment parity'sini fail-closed doğrular. Bu guard `verify:release` içinde release-blocking
olmadan Doctor kontrolünün kapatılması da fail eder. Doctor sonucu bu özel guard'ın yerine geçmez.

## Zorunlu evidence

Her build/update kaydı en az candidate SHA, clean-tree sonucu, app/runtime/build kimliği, EAS build
ve update group ID'leri, environment/channel, checksum, imza doğrulaması, cihaz matrisi, rollout
yüzdesi, gözlem penceresi ve rollback sonucunu içermelidir. Şablon `release-evidence/manifest.template.json`
içindedir. Geri alma işlemleri `docs/ota-rollback-runbook.md` sözleşmesine uyar.

## Açık release blokları

- Android 53 ve iOS 55 imzalı artifact'leri henüz aynı candidate SHA'da üretilip kurulmadı.
- Preview/production channel ve runtime davranışı gerçek cihazda kanıtlanmadı.
- EAS plan desteği/code-signing kararı bilinmiyor; destek varsa certificate/private-key zinciri ve
  invalid-signature testi kanıtlanmadı.
- `EXPO_PUBLIC_API_BASE_URL` stable production değeri, dashboard environment'ları ve protected
  approvals repository dışındadır.
- Rollout, previous-update/embedded rollback ve offline embedded startup tatbikatı yapılmadı.

Resmi komut/sözleşme kaynakları: [Expo CLI reference](https://docs.expo.dev/eas/cli/),
[EAS Update rollbacks](https://docs.expo.dev/eas-update/rollbacks/) ve
[EAS Update rollouts](https://docs.expo.dev/eas-update/rollouts/).
