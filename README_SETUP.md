# WMatch Supabase Kurulumu

## 1. Database migration

Supabase Dashboard > SQL Editor içinde `supabase/migrations/20260608012707_initial_schema.sql` dosyasını çalıştır.

CLI kullanacaksan:

```bash
npx supabase link --project-ref eaggwbuvpfzrejamwqry
npx supabase db push --linked --include-all
```

Bu migration şunları kurar:

- `profiles`
- `user_movies`
- `currently_watching`
- `likes`
- `matches`
- `messages`
- RLS policy'leri
- otomatik profil ve match trigger'ları

## 2. Edge Function deploy

```bash
npx supabase functions deploy make-server-d962235e --project-ref eaggwbuvpfzrejamwqry
```

## 3. Mobil uygulama

```bash
npm install
npx expo install expo-image-picker expo-dev-client
npm run typecheck
npm run android
npm run dev
```

`npm run android` developer build'i cihaza/emulator'e kurar. Sonrasında `npm run dev` Metro'yu dev-client modunda açar ve kod değişiklikleri telefona anında düşer.
