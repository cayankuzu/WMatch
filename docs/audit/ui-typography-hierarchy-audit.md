# WMatch — Tipografi Hiyerarşisi Denetimi

**Candidate:** `1.0.51` · **Denetim tarihi:** 2026-09-04
**Yöntem:** Bütün `src/` ağacında `theme.typography.roles.*` ve `theme.typography.*` kullanımları sayıldı, punto başına dağılıma çevrildi.
**Kapsam dışı:** Yeni ekran, yeni bileşen, yeni tipografi sistemi. Yalnız mevcut token'ların değeri ve tutarlılığı.

---

## 1. Ölçüm — başlangıç durumu

Uygulamadaki 264 tipografi kullanımının punto dağılımı:

| Punto | Kullanım | Oran | |
|---:|---:|---:|---|
| 12 | 175 | **66.3%** | `████████████████████████████████████████` |
| 13 | 66 | 25.0% | `███████████████` |
| 15 | 6 | 2.3% | `█` |
| 16 | 8 | 3.0% | `██` |
| 18 | 4 | 1.5% | `█` |
| 20 | 4 | 1.5% | `█` |
| 26 | 1 | 0.4% | |

**Metnin %91.3'ü 12–13 punto aralığında.** 15 punto ve üzeri yalnız %8.7.

### Rol bazında

| Rol | Punto | Kullanım |
|---|---:|---:|
| `meta` | 12 | 119 |
| `body` | 13 | 26 |
| `micro` | 12 | 22 |
| `cardTitle` | 13 | 15 |
| `sectionTitle` | 16 | 8 |
| `control` | 12 | 7 |
| `screenTitle` | 20 | 4 |
| `label` | 12 | 4 |
| `display` | 26 | 1 |
| `bodyStrong` | 13 | **0** |

| Eski skaler | Punto | Kullanım |
|---|---:|---:|
| `typography.body` | 13 | 25 |
| `typography.caption` | 12 | 23 |
| `typography.section` | 15 | 6 |
| `typography.title` | 18 | 4 |
| `typography.display` | 24 | **0** |
| `typography.tiny` | 12 | **0** |

---

## 2. Bulgular

### P1 — Birincil CTA etiketi sistemin en küçük yazısıydı

| | |
|---|---|
| **Bulgu** | `roles.control` 12 punto ile `meta`, `micro`, `label` ve `caption` ile aynı bantta duruyordu. |
| **Tüketiciler** | `AppButton` (uygulamanın birincil düğmesi), `OptionChips`, `SegmentedControl`, `LoginScreen`, `SignUpScreen`, `EditProfileModal`, `LoadingScreen` |
| **Kullanıcı etkisi** | Kullanıcının **yapması gereken** işin etiketi, ekrandaki yardımcı metinle aynı puntodaydı. Görsel ağırlık sıralaması, prompt'un istediği "her ekranda birincil işin görsel ağırlığı net" ilkesinin tersine çalışıyordu. |
| **Kök neden** | Rol adları semantik ama değerler zamanla aynı tabana çökmüş. Altı farklı rol tek puntoya inince rol ayrımı yalnız isimde kalmış. |
| **Minimum çözüm** | `control` 12/17 → **13/18** |
| **Neden bu çözüm** | Tek adım. Etiketi caption bandından çıkarıyor, `body` (13) ile eşitliyor — düğme etiketi en azından gövde metni kadar okunur oluyor. 14'e çıkarmak `cardTitle` tierine girer ve düğmeyi başlık gibi gösterirdi. |
| **Risk** | 7 çağrı yeri. Hepsi esnek yükseklikli (`AppButton` `minHeight` kullanıyor, chip'ler `minHeight: 48`). Sabit yükseklikli metin kabı yok — bkz. §3. |

### P1 — Kart başlığı kendi gövde metniyle aynı puntodaydı

| | |
|---|---|
| **Bulgu** | `roles.cardTitle` 13 punto = `roles.body` 13 punto. Fark yalnız kalınlıkta (Bold vs Regular). |
| **Tüketiciler** | 15 yer: `ChatListItem`, `UserMiniCard`, `EmptyState`, `ProfileTopBar`, `SettingsModal`, `SwipeQuotaBar`, `CurrentMovieBar`, `BlockedUsersModal`, `DiscoveryFiltersModal`, `ChatSettingsModal`, `ProfileCompatibilityCard`, `ChatThreadList` |
| **Kullanıcı etkisi** | Kart içi hiyerarşi yok. Sohbet listesinde kişi adı ile son mesaj, profil kartında ad ile açıklama aynı puntoda; ayrım yalnız kalınlık ve renkle taşınıyordu. Yoğun listelerde tarama zorlaşıyor. |
| **Minimum çözüm** | `cardTitle` 13/18 → **14/19** |
| **Neden bu çözüm** | Başlığı gövdeden ayırıyor, `sectionTitle` (16) tierine girmiyor. Üç kademeli net bir kart içi hiyerarşi kuruyor: başlık 14 → gövde 13 → meta 12. |

### P2 — Bölüm başlığı iki farklı puntoda çiziliyordu

| | |
|---|---|
| **Bulgu** | Ortak `AppModal` kabuğu başlığını `roles.sectionTitle` (16) ile çiziyor. Beş elle yazılmış başlık ise `typography.section` (15) skaleri kullanıyor **ve hiç `lineHeight` vermiyordu**. |
| **Nerede** | `BlockedUsersModal`, `EditProfileModal`, `ResetPasswordModal` başlıkları; `ForgotPasswordScreen.successTitle`; `SignUpReview.name` |
| **Kullanıcı etkisi** | Aynı hiyerarşi seviyesindeki modal başlıkları, hangi modalı açtığına göre 15 veya 16 punto. `lineHeight` verilmediği için satır aralığı da platform varsayılanına düşüyordu. |
| **Minimum çözüm** | `typography.section` **15 → 16** |
| **Neden bu çözüm** | Bu ekran ve modal dosyaları `check:visual-regression` tarafından **byte düzeyinde dondurulmuş** durumda. Skaleri rolün puntosuna çekmek, altı başlığı da tek boya getiriyor ve dondurulmuş hiçbir dosyaya dokunmuyor. Çağrı yerlerini role taşımak dört ayrı muafiyet gerektirirdi — bir başlık hizalaması için dondurma sözleşmesini aşındırmaya değmez. |
| **Kalan borç** | `typography.section` ile `roles.sectionTitle.fontSize` artık aynı değeri iki yerde tutuyor. Feature freeze kalktığında altı çağrı yeri role taşınıp skaler silinmeli. Bu, `visual-regression.snapshot.json` içindeki gerekçeye yazıldı. |

### P3 — Ölü token'lar

| Token | Kullanım | İşlem |
|---|---:|---|
| `typography.display` (24) | 0 | Kaldırıldı — `roles.display` (26) bu tieri zaten taşıyor |
| `typography.tiny` (12) | 0 | Kaldırıldı — `caption` ile aynı değerin ikinci adıydı |
| `roles.bodyStrong` (13) | 0 | **Bırakıldı** — geçerli bir rol; silmek yerine kullanılması doğru olan. Kaldırmak, ileride 13 punto yarı-kalın metin gerektiğinde ham `fontSize` yazılmasına yol açar. |

---

## 3. Font ölçeği güvenliği — doğrulanmış negatif

Ölçek değişikliğinin en büyük riski, büyütülen metnin sabit yükseklikli bir kapta kırpılmasıdır. İki AST taraması yapıldı:

| Tarama | Sonuç |
|---|---|
| Hem `height` hem tipografi taşıyan stil nesneleri | **0** |
| Sabit `height` taşıyan ve içinde `<Text>`/`<AppText>` render eden JSX kabı | **0** |

Kod tabanında metin taşıyan sabit yükseklikli kap **yok**; sabit yükseklikler ikon düğmeleri ve boşluk tutucularda, metin kapları ise `minHeight` kullanıyor (`premiumNotice`, `OptionChips` vb.). Bu, 1 puntoluk artışların kırpma üretmeyeceğini statik olarak gösteriyor.

Ayrıca: kod tabanında `allowFontScaling` veya `maxFontSizeMultiplier` **hiç kullanılmıyor**. Bu doğru varsayılan — kullanıcının OS font ölçeği ayarı hiçbir yerde susturulmuyor.

---

## 4. Sonuç dağılımı

| Punto | Önce | Sonra | Rol |
|---:|---:|---:|---|
| 12 | 175 | 168 | `label`, `meta`, `micro`, `caption` — yardımcı metin |
| 13 | 66 | 73 | `body`, `bodyStrong`, **`control`** — gövde ve kontrol etiketi |
| 14 | 0 | 15 | **`cardTitle`** — kart başlığı |
| 15 | 6 | 0 | — |
| 16 | 8 | 14 | `sectionTitle`, `section` — bölüm başlığı |
| 18 | 4 | 4 | `title` |
| 20 | 4 | 4 | `screenTitle` |
| 26 | 1 | 1 | `display` |

Merdiven artık **12 → 13 → 14 → 16 → 18 → 20 → 26**; her basamak ayrı bir semantik seviyeye karşılık geliyor. Aynı işi yapan iki farklı punto kalmadı.

---

## 5. Yapılmayanlar ve nedeni

### 12 punto bandının tamamı yükseltilmedi

`meta` (119 kullanım) ve `micro` (22) 12 puntoda kaldı. iOS HIG gövde metni için 17pt, Material 14sp öneriyor; bu ürün ikisinin de altında. Ama:

- `meta` ve `micro` gerçekten ikincil metin: zaman damgası, sayaç, yardımcı etiket. 12 punto bu roller için savunulabilir.
- 119 çağrı yerini gerçek cihazda doğrulamadan büyütmek, ölçemediğim bir düzen riskini repoya yazmak olurdu.
- Asıl kusur "12 küçük" değil, "altı rol tek puntoya çökmüş"tü. Bu düzeltildi.

**`body` 13 → 14 önerisi ayrı bir karardır** ve gerçek cihazda font ölçeği 1.0/1.3/1.5 ile doğrulanmadan yapılmamalıdır. Bu denetim öneriyi kayda geçiriyor, uygulamıyor.

### Rol birleştirmesi yapılmadı

`control` ve `label` başlangıçta birebir aynı değerleri taşıyordu (12/17 SemiBold). `control` 13'e çıkınca ayrıştılar. `label` ve `meta` hâlâ aynı puntoda ama farklı kalınlıkta — bu meşru: roller değer paylaşabilir, rol adı niyeti taşır.

---

## 6. Doğrulama kaydı

| Komut | Sonuç |
|---|---|
| `npm run typecheck` | PASS |
| `npm test` | PASS — 9 suite, 29 test |
| `npm run test:vitest` | PASS — 10 dosya, 164 test |
| `npm run check:contrast` | PASS — 32 çift |
| `npm run check:touch` | PASS |
| `npm run check:i18n` | PASS — 538 anahtar |
| `npm run check:architecture` | PASS — 193 dosya |
| `npm run check:feature-surface` | PASS — yüzey değişmedi |

`tests/production-guards.test.ts` içindeki `control` token assertion'ı 12'den 13'e güncellendi. **Gevşetilmedi** — hâlâ tam değeri sabitliyor, yalnız gözden geçirilmiş değeri sabitliyor.

## 7. Bu denetimin kapsamadıkları

- Gerçek cihazda font ölçeği 1.3 / 1.5 altında kırpılma
- VoiceOver / TalkBack okuma sırası
- Küçük / standart / büyük telefon sınıflarında satır kırılması

Bunlar `docs/MANUAL_STEPS.md` kapsamındadır. Bu denetim statik ayağı kapatıyor, cihaz ayağını değil.
