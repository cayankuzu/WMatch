# WMatch Sorun Giderme

## Kayıt veya giriş hatası

- [`supabase/migrations/20260608012707_initial_schema.sql`](./supabase/migrations/20260608012707_initial_schema.sql) çalıştırıldı mı?
- Edge Function deploy edildi mi?
- Health check anon header ile başarılı mı?

```powershell
$headers = @{ Authorization = "Bearer <PUBLIC_ANON_KEY>" }
Invoke-WebRequest `
  -Uri "https://eaggwbuvpfzrejamwqry.supabase.co/functions/v1/make-server-d962235e/health" `
  -Headers $headers
```

## Fotoğraf seçilemiyor

- Uygulama developer build olarak mı kuruldu?
- Cihazda galeri izni verildi mi?
- `expo-image-picker` kurulu mu?

```bash
npx expo install expo-image-picker
```

## Android cihaz görünmüyor

```bash
adb devices
```

Cihaz listede yoksa USB debugging'i aç, kabloyu çıkarıp tak ve telefondaki RSA iznini onayla.

## Kod değişikliği cihaza düşmüyor

```bash
npm run dev
```

Metro terminalinde `r` ile reload, `m` ile menü açabilirsin. Developer build kullanıyorsan uygulamanın aynı network'te Metro'ya bağlı olduğundan emin ol.
