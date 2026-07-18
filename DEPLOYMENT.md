# WMatch Deployment

## 1. Supabase migration

En güvenli yol:

1. Supabase Dashboard'a git: `https://supabase.com/dashboard/project/eaggwbuvpfzrejamwqry`
2. `SQL Editor` ekranını aç.
3. [`supabase/migrations/20260608012707_initial_schema.sql`](./supabase/migrations/20260608012707_initial_schema.sql) dosyasının tamamını çalıştır.

CLI ile yapmak istersen:

```bash
npx supabase link --project-ref eaggwbuvpfzrejamwqry
npx supabase db push --linked --include-all
```

## 2. Edge Function deploy

```bash
npx supabase functions deploy make-server-d962235e --project-ref eaggwbuvpfzrejamwqry
```

## 3. Health check

Fonksiyon anon JWT beklediği için health çağrısını header ile test et:

```powershell
$headers = @{ Authorization = "Bearer <PUBLIC_ANON_KEY>" }
Invoke-WebRequest `
  -Uri "https://eaggwbuvpfzrejamwqry.supabase.co/functions/v1/make-server-d962235e/health" `
  -Headers $headers
```

Beklenen cevap:

```json
{"status":"ok"}
```

## 4. Android developer build

```bash
npm install
npx expo install expo-image-picker expo-dev-client
npm run android
npm run dev
```

## 5. iOS developer build

macOS + Xcode ortamında:

```bash
npm install
npx expo install expo-image-picker expo-dev-client
npm run ios
npm run dev
```

## 6. Kontrol listesi

- Kayıt olma çalışıyor.
- Fotoğraf ekleme ve canlı sürükle-bırak sıralama çalışıyor.
- Giriş ve çıkış çalışıyor.
- Şifre sıfırlama akışı açılıyor.
- Match, Uyum, Beğeni, Mesaj ve Profil ekranları native mobil bileşenlerle açılıyor.
- Metro açıkken değişiklikler cihaza hot reload ile yansıyor.
