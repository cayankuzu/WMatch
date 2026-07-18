# WMatch Push Notifications Setup

## Gerekli migration

Supabase migration akisini guncellerken su dosyanin da deploy edildiginden emin ol:

- `supabase/migrations/20260609000500_push_notifications_and_chat_settings.sql`

Bu migration su tabloları ekler:

- `chat_settings`
- `device_push_tokens`

## Expo project ID

Push bildirimlerinin gercek cihazda token alabilmesi icin uygulamanin Expo project ID ile build edilmesi gerekir.

- EAS kullaniyorsan bu bilgi genelde otomatik gelir.
- EAS kullanmiyorsan `app.json > expo.extra.projectId` alanina kendi Expo project ID degerini eklemelisin.

## Paketler

Guncel native paket seti:

```bash
npx expo install expo-image-picker expo-dev-client expo-device expo-notifications
```

## Beklenen davranis

- Kullanici giris yaptiginda bildirim izni istenir.
- Izin verilirse Expo push token otomatik kaydedilir.
- Yeni mesajlar aliciya push olarak gider.
- Yeni eslesmeler her iki tarafa da push olarak gider.
- Sohbet bazli `Bildirimler` ayari kapatilirsa o sohbet icin push gonderilmez.
