# WMatch Mobile

React Native + Expo tabanli mobil eslesme uygulamasi.

## Continuity

- Bu repo kaynak kodu ve secret olmayan dosyalari tutar.
- Tum build-critical secretlar ve signing materyali sadece yerelde ve `C:\Users\Cayan\Desktop\WMatch_secrests` klasorunde tutulur.
- USB yedegini yenilemek icin `powershell -ExecutionPolicy Bypass -File .\scripts\export-wmatch-secrests.ps1` calistir.
- Yeni bir makinede repo clone ettikten sonra `WMatch_secrests\RESTORE-TO-PROJECT.ps1` ile secret dosyalari geri yukle.
- Ayrintili model ve adimlar icin `PRIVATE_REPO_BOOTSTRAP.md` dosyasini kullan.

## Kurulum

```bash
npm install
npx expo install expo-image-picker expo-dev-client
npm run typecheck
```

## Telefonda gelistirme

Developer build kurulduktan sonra Metro'yu su komutla baslat:

```bash
npm run dev
```

Android cihaz veya emulator icin:

```bash
npm run android
```

Expo Go ile hizli deneme yapmak istersen:

```bash
npm run android:expo-go
```

Kod degisiklikleri Metro acikken cihaza aninda yansir. Android native loglari icin ayrica `adb logcat` takip edebilirsin.
