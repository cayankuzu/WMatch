# WMatch — Ekran / Durum Matrisi

**Candidate:** `1.0.51` · **Denetim tarihi:** 2026-09-04
**Kapsam:** `quality/feature-surface.snapshot.json` içindeki **13 ekran, 12 modal, 2 sheet** — yani makine tarafından doğrulanmış ürün yüzeyinin tamamı.
**Kaynak:** Kod okuması. Her satır bir dosyaya ve o dosyadaki bir mekanizmaya dayanıyor.

> **Bu matrisin sınırı.** Buradaki her şey **statik** kanıttır: kod bu durumu ele alıyor mu, hangi bileşenle ele alıyor. Bu, gerçek cihazda test edildiği anlamına **gelmez**. Cihaz ayağı `docs/MANUAL_STEPS.md` kapsamındadır ve §6'da ayrıca listelenmiştir. Statik kanıt tek başına UI/UX alanına 9.80 verdirmez.

---

## 1. Durum mimarisi

Uygulama durumları tek bir yerde tanımlıyor: `src/app/components/ui/DataState.tsx`, on durumlu bir birleşim tipiyle.

```
initial-loading · cached-stale · refreshing · loading-more · ready
empty · search-empty · partial-error · fatal-error · offline
```

`DataState` `ready`, `refreshing`, `cached-stale` ve `loading-more` durumlarında `children`'ı geçirir; kalanlarda ikon + başlık + açıklama + eylem çizer. Erişilebilirlik davranışı bileşenin kendisinde: yükleme için `accessibilityLiveRegion="polite"`, diğerlerinde `assertive`, hata durumlarında `accessibilityRole="alert"`, ikon `accessible={false}`.

Bu, matrisi okurken kritik: **bir ekranın kendi dosyasında `accessibilityLiveRegion` bulunmaması eksiklik değildir** — `DataState` render ettiği anda o davranışı devralır.

### Durumu taşıyan diğer paylaşılan bileşenler

| Bileşen | Sorumluluk | Kullanan |
|---|---|---|
| `DataState` | Boş / hata / yükleme yüzeyi | 5 veri sekmesi + `ChatThreadList`, `ProfileMediaLibrary` |
| `EmptyState` | Sekme içi boş durum kartı | 7 dosya |
| `Skeleton` (`SwipeDeckSkeleton`, `ChatListSkeleton`, `UserGridSkeleton`, `SkeletonBlock`) | İlk yükleme iskeleti | 6 dosya + `App.tsx` Suspense fallback'i |
| `DataWarningBanner` | Bayat veri uyarısı + yeniden dene | 6 dosya |
| `AppRefreshControl` | Aşağı çekip yenile | 6 dosya |
| `ConnectivityBanner` | Çevrimdışı bildirimi | `App.tsx` — **global, tek yerde** |
| `ErrorBoundary` | Sekme çökmesi yakalama | `App.tsx`, sekme başına `surface={'tab:' + tab}` |
| `TransientPopup` | Geçici geri bildirim | 4 dosya |
| `AccessibleModal` | Modal odak kapsama | 12 modal + 2 sheet |

---

## 2. Sekme ekranları

Beş veri sekmesi ve profil sekmesi. `pri̇maryJob` = ekranın kullanıcıya yaptırdığı tek asıl iş.

| Ekran | Birincil iş | Kaydırma | İlk yükleme | Yenileme | Boş | Hata | Yeniden dene | Bayat | Kanıt |
|---|---|---|---|---|---|---|---|---|---|
| `WatchScreen` | İçerik işaretle | Scroll + satırlar | `MovieRow` `SkeletonBlock`; arama için `DataState initial-loading` | `AppRefreshControl` | `DataState` + `watch.screen.searchEmpty` | `fatal-error` (ana), `partial-error` (arama) | `data.action.retry` | `DataWarningBanner` | `WatchScreen.tsx`, `MovieRow.tsx` |
| `MatchScreen` | İzlenenden eşleşme | Inline `SwipeModal` | `SwipeDeckSkeleton` | `AppRefreshControl` | `EmptyState` (iki varyant: aktif içerik var / yok) | `fatal-error` | `data.action.retry` | `DataWarningBanner` → `SwipeModal banner` | `MatchScreen.tsx` |
| `CompatibilityScreen` | Uyuma göre eşleşme | Inline `SwipeModal` | `SwipeDeckSkeleton` | `AppRefreshControl` | `EmptyState` | `fatal-error` | `data.action.retry` | `DataWarningBanner` → `SwipeModal banner` | `CompatibilityScreen.tsx` |
| `LikesScreen` | Beğenileri incele | `FlatList` sayfalayıcı + ızgara | `UserGridSkeleton` | `AppRefreshControl` (`LikesGridPage` içinde) | `likes.empty.*` | `fatal-error` | `data.action.retry` | `DataWarningBanner` | `LikesScreen.tsx`, `likes/LikesGridPage.tsx` |
| `ChatScreen` | Sohbete devam | `ChatThreadList` | `ChatListSkeleton` | `AppRefreshControl` | `ChatThreadList` `DataState` | `fatal-error` (yalnız liste boş **ve** bayat değilken) | `data.action.retry` | `DataWarningBanner` | `ChatScreen.tsx`, `chat/ChatThreadList.tsx` |
| `ProfileScreen` | Profili yönet | Scroll | — | `AppRefreshControl` | — | `DataState` | `data.action.retry` | `DataWarningBanner` | `ProfileScreen.tsx` |

### Doğrulanmış negatifler (eksik sanılıp eksik olmayanlar)

Bu satırlar, yüzeysel bir taramanın kusur sanacağı ama kodda doğru çözülmüş noktalardır. Kayda geçiriliyorlar ki bir dahaki denetimde tekrar araştırılmasın.

| Görünen eksik | Gerçek |
|---|---|
| `LikesScreen`'de `AppRefreshControl` yok | `LikesGridPage.tsx:54` içinde var; ekran `refreshing`/`onRefresh` prop'larını aşağı geçiriyor. |
| `WatchScreen`'de `Skeleton` yok | `MovieRow.tsx:88` `loading && uniqueMovies.length === 0` iken `SkeletonBlock` çiziyor. |
| `CompatibilityScreen`, `MatchScreen`, `ProfileScreen`'de `SafeAreaView` yok | `App.tsx:652` kökte `paddingTop: resolveDeviceEdgeInset(insets.top)` uyguluyor. Sekme ekranlarının tekrar uygulaması, prompt'un yasakladığı **çift safe-area** olurdu. Doğru olan bu. |
| Veri ekranlarında `accessibilityLiveRegion` yok | `DataState.tsx:57` taşıyor; ekranlar onu render ediyor. |
| Ekranlarda odak yönetimi yok | Odak kapsama bir modal sorunudur. 12 modalın ve 2 sheet'in tamamı `AccessibleModal` kullanıyor. |
| Neredeyse hiçbir yerde `hitSlop` yok | `check:touch` geçiyor: açık etkileşimli boyutlar zaten 48 dp. `hitSlop` yalnız boyut yetmediğinde gerekli. |
| `ChatScreen`'de klavye yönetimi yok | `ChatScreen` sohbet **listesi**. Kompozisyon `ChatModal` içinde ve orada klavye yönetimi var. |

---

## 3. Modallar ve sheet'ler

Ondördünün tamamı `AccessibleModal` üzerinden odak kapsama alıyor.

| Yüzey | Birincil iş | Klavye | Meşgul/devre dışı | Erişilebilirlik | Not |
|---|---|---|---|---|---|
| `ChatModal` | Mesaj yaz/gönder | ✓ | ✓ | odak kapsama | Outbox + iyimser gönderim; `tests/components/chat-outbox.test.tsx` |
| `SwipeModal` | Kart kaydır | — | ✓ | odak kapsama | Kota, geri alma, iyimser geri alma; `presentation="inline"` ile sekmeye de gömülüyor |
| `EditProfileModal` | Profili düzenle | ✓ | — | etiket + rol | Fotoğraf yükleme `SortablePhotoGrid` |
| `DiscoveryFiltersModal` | Filtre uygula | — | ✓ | etiket + rol; slider track ağaçtan gizli | İki `adjustable` thumb değeri ve artış eylemini taşıyor |
| `SettingsModal` | Ayar değiştir | — | — | etiket + rol | |
| `ChatSettingsModal` | Sohbet ayarı | — | ✓ | etiket + rol + **durum** | |
| `BlockedUsersModal` | Engeli kaldır | — | ✓ | etiket + rol + **durum** | Kendi `DataState`'i var |
| `ProfileModal` | Profili görüntüle | — | ✓ | etiket + rol + **durum** | İyimser aksiyon |
| `MovieDetailModal` | İçerik detayı | — | — | etiket + rol | Hero fotoğraf açıcı `eddbc55`'te adlandırıldı |
| `MatchSuccessModal` | Eşleşmeyi kutla | — | — | etiket + rol | |
| `ResetPasswordModal` | Şifre sıfırla | — | — | etiket + rol | |
| `ImagePreviewModal` | Fotoğrafı büyüt | — | — | etiket + rol | |
| `CompatibilitySheet` | Ortak içeriği gör | — | — | etiket + rol | Uyum oranını bağlamlandıran yüzey |
| `MatchContextSheet` | Eşleşme bağlamı | — | — | etiket + rol + **canlı bölge** | Kendi hata + yeniden dene yolu |

---

## 4. Kimlik doğrulama ekranları

Altısı da `ui/Screen.tsx` sarmalayıcısını kullanıyor: safe-area insetleri, `KeyboardAvoidingView`, içerik genişlik sınırı ve arka plan gradyanı tek yerden geliyor.

| Ekran | Klavye | Meşgul | Canlı duyuru | Kanıt |
|---|---|---|---|---|
| `LoginScreen` | ✓ | ✓ | ✓ | `Screen mode`, `returnKeyType`, `onSubmitEditing` |
| `SignUpScreen` | ✓ | ✓ | ✓ | Çok adımlı; `SignUpProgress` |
| `ForgotPasswordScreen` | ✓ | ✓ | ✓ | |
| `PasswordRecoveryScreen` | ✓ | ✓ | ✓ | |
| `VerifyEmailScreen` | — | ✓ | ✓ | |
| `LoadingScreen` / `SplashScreen` | — | — | ✓ | Geçiş yüzeyleri |

`Screen.tsx` klavye davranışını merkezîleştiriyor: `keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}` — bu `tests/production-guards.test.ts` tarafından sabitlenmiş.

---

## 5. Bu denetimde bulunan ve düzeltilen kusurlar

| # | Bulgu | Düzeltme | Commit |
|---|---|---|---|
| 1 | Üçüncül metin iki yüzeyde AA altında (4.46:1 / 4.03:1) | `#7f8698` → `#8990a0` | `5c4b4e2` |
| 2 | Marka kırmızısı dört değere ayrışmış; her boş durum palette olmayan bir kırmızıyla tonlanıyor | Tüm yıkamalar `colors.primary` tabanına | `5c4b4e2` |
| 3 | Birincil CTA etiketi sistemin en küçük yazısı (12px) | `roles.control` → 13px | `5d35ef2` |
| 4 | Kart başlığı kendi gövde metniyle aynı punto | `roles.cardTitle` → 14px | `5d35ef2` |
| 5 | Bölüm başlığı iki farklı puntoda (15 / 16) | `typography.section` → 16 | `5d35ef2` |
| 6 | Bayat veri bandı iki kardeş ekranda iki ayrı uygulama; biri dokunuşları yutuyor | `SwipeModal banner` prop'una tek sahiplik | `09d06ce` |

---

## 6. Cihazda doğrulanması gerekenler

Bu matris statik ayağı kapatıyor. Aşağıdakiler **repository'den kanıtlanamaz**:

| # | İş | Neden statik olarak kapatılamıyor |
|---|---|---|
| D-1 | VoiceOver ve TalkBack ile kritik yolculuk (kayıt → işaretle → uyum → eşleş → sohbet) | Odak sırası ve okuma yalnız çalışma zamanında gözlenir |
| D-2 | Font ölçeği 1.0 / 1.3 / 1.5 altında kırpılma | Statik tarama sabit yükseklikli metin kabı **bulamadı** (§ `ui-typography-hierarchy-audit.md` §3), ama satır kırılması ölçülmedi |
| D-3 | Notch / Dynamic Island / gesture bar çakışması | `App.tsx` kökte inset uyguluyor; gerçek cihazda görülmeli |
| D-4 | 360 dp / ~390–412 dp / 480 dp Android ve küçük–standart–Pro Max iPhone sınıfları | `useWindowClass` sınıfları var, render doğrulanmadı |
| D-5 | Reduce-motion | `useReducedMotion` `TabScene`'de bağlı, cihazda görülmeli |
| D-6 | Çevrimdışı → çevrimiçi geçişi, outbox teslimi | Birim testi var (`chat-outbox`), uçtan uca cihaz akışı yok |
| D-7 | Görsel regresyon ekran görüntüleri | Repo guard'ı kaynak altınıdır; piksel kanıtı cihazdan gelir |

---

## 7. Doğrulama kaydı

| Komut | Sonuç |
|---|---|
| `npm run typecheck` | PASS |
| `npm test` | PASS — 9 suite, 29 test |
| `npm run test:vitest` | PASS — 10 dosya, 164 test |
| `npm run check:contrast` | PASS — 32 semantik çift |
| `npm run check:touch` | PASS |
| `npm run check:i18n` | PASS — 538 anahtar |
| `npm run check:architecture` | PASS — 193 dosya, 788 kenar |
| `npm run check:feature-surface` | PASS — 6 sekme, 13 ekran, 12 modal, 2 sheet, 41 route, 28 tablo |
| `npm run check:visual-regression` | PASS — 28 tam + 6 gözden geçirilmiş yüzey |
