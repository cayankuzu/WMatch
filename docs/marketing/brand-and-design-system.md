# WMatch — Marka ve Tasarım Sistemi (Dış Yüzeyler)

**Amaç:** Store görselleri, reklam, sunum ve basın materyalinin, uygulamanın **kendi** tasarım sistemiyle aynı dili konuşması.
**Kural:** Pazarlama için ayrı bir görsel kimlik üretilmez. Tek kaynak `src/shared/theme/index.ts`.
**Doğrulama:** Buradaki bütün kontrast oranları `npm run check:contrast` çıktısıdır — göz kararı değil, ölçüm.

---

## 1. Neden ayrı bir pazarlama kimliği yok

Bir kullanıcı reklamda gördüğü rengi ve tipografiyi uygulamada bulamazsa, store sayfasından uygulamaya geçişte bir kopukluk yaşar. Bu kopukluk ölçülebilir bir maliyet: reklamı hatırlayan kullanıcı, açtığı uygulamanın aynı ürün olduğunu yeniden doğrulamak zorunda kalır.

Ayrıca pratik bir sebep: ayrı bir pazarlama paleti, uygulamanın paleti değiştiğinde sessizce eskir. Materyal ile ürün arasındaki tutarsızlık bir bakım borcudur; hiç açmamak en ucuzu.

**Sonuç:** Bu belge yeni hiçbir renk, punto veya kural tanımlamıyor. Var olanı dış yüzeyler için okunur hâle getiriyor.

---

## 2. Renk

### Marka

| Rol | Değer | Nerede kullanılır |
|---|---|---|
| `primary` | `#d90416` | Birincil eylem dolgusu, marka vurgusu, seçim kenarlığı |
| `primaryStrong` | `#a90010` | Basılı hâl, gölge rengi |
| `primarySoft` / `accentText` | `#ff5a64` | Koyu zeminde marka **metni**; odak kenarlığı |
| `onAccent` | `#ffffff` | Marka dolgusu üstündeki etiket |

**Tek kırmızı kuralı.** Bütün marka tonlamaları (`brand12` … `brand26`) `#d90416` tabanından türetilir. Materyalde marka kırmızısı gerektiğinde **yalnız** bu değer kullanılır. Daha önce palette üç farklı kırmızı dolaşıyordu ve bu düzeltildi (`docs/audit/ui-ux-contrast-audit.md`); materyalde aynı hatayı tekrar açmayın.

### Zemin

| Rol | Değer | Not |
|---|---|---|
| `background` | `#08090d` | Uygulamanın ana zemini. Store/deck arka planı budur. |
| `backgroundElevated` | `#11131a` | Yükseltilmiş bölge |
| `surface` | `#171922` | Kart |
| `surfaceMuted` | `#1d202a` | İkincil kart |
| `surfaceStrong` | `#242836` | En yoğun yüzey |
| `gradients.appBackground` | `#07080c → #11141d → #090b10` | Play feature graphic ve deck kapağı |

### Metin — ölçülmüş kontrast

Dış materyalde metin rengi seçerken bu tabloyu kullanın. Sayılar `npm run check:contrast` çıktısıdır.

| Metin | Değer | `background` | `surface` | `surfaceStrong` |
|---|---|---:|---:|---:|
| `textPrimary` | `#f6f7fb` | 18.59:1 | 16.37:1 | 13.70:1 |
| `textSecondary` | `#9ea6bb` | 8.17:1 | 7.20:1 | 6.02:1 |
| `textTertiary` | `#8990a0` | 6.22:1 | 5.47:1 | 4.58:1 |
| `accentText` | `#ff5a64` | — | — | `primarySurface` üstünde 6.06:1 |

**Dolgu üstü etiket:**

| Çift | Oran |
|---|---:|
| beyaz / `primary` `#d90416` | 5.28:1 |
| beyaz / `primaryStrong` `#a90010` | 7.79:1 |
| beyaz / `danger` `#b91c2b` | 6.43:1 |
| beyaz / `notificationAccent` `#e10613` | 4.96:1 |

**Materyalde yasak:** `colors.primary` `#d90416` düz zemin üstünde **metin rengi olarak** kullanılamaz — `background` üstünde 3.77:1, AA metin eşiğinin altında. Kırmızı metin gerekiyorsa `accentText` `#ff5a64` kullanın. `primary` bir **dolgu** rengidir.

---

## 3. Tipografi

Tek aile: **Inter**. Materyalde başka bir yazı tipi kullanılmaz.

| Rol | Punto / satır | Ağırlık | Dış yüzeyde karşılığı |
|---|---|---|---|
| `display` | 26 / 31 | ExtraBold | Deck kapak başlığı |
| `screenTitle` | 20 / 25 | ExtraBold | Slayt başlığı |
| `sectionTitle` | 16 / 21 | Bold | Alt başlık |
| `cardTitle` | 14 / 19 | Bold | Kart / kutu başlığı |
| `body` | 13 / 19 | Regular | Gövde |
| `control` | 13 / 18 | SemiBold | Düğme etiketi |
| `label` · `meta` · `micro` | 12 / 16–17 | SemiBold–Medium | Etiket, meta, dipnot |

**Merdiven:** 12 → 13 → 14 → 16 → 20 → 26. Her basamak ayrı bir seviyedir; ara punto uydurulmaz.

**Store görsellerinde farklı ölçek kullanılır** — 1320 × 2868 px bir tuvalde 20 px başlık okunmaz. `screenshot-storyboard.md` başlık için 64 px, açıklama için 40 px veriyor. Bu bir istisna değil, ölçek dönüşümü: **oranlar** korunur (başlık ≈ açıklamanın 1.6 katı), mutlak değerler tuvale göre büyür.

---

## 4. Boşluk, köşe ve gölge

| | Değer |
|---|---|
| Boşluk merdiveni | 3 · 6 · 9 · 12 · 16 · 20 · 24 · 28 · 34 |
| Köşe | `control`/`poster` 10 · `card` 14 · `personCard` 16 · `modal` 18 · `pill` 999 |
| Ekran kenar boşluğu | dar 12 · orta 20 · geniş 28 |
| Kart gölgesi | opaklık 0.16, yarıçap 8, ofset (0, 4) |
| Yüzen gölge | opaklık 0.24, yarıçap 11, ofset (0, 5) |

**Materyalde:** kart köşesi 14, düğme köşesi 10, rozet/pill 999. Uygulamada olmayan bir köşe değeri kullanılmaz.

---

## 5. Hareket

| Rol | Süre |
|---|---|
| `fast` | 140 ms |
| `normal` | 220 ms |
| `emphasized` | 320 ms |

**Reklam videolarında:** geçişler 140–320 ms bandında kalır. Uygulama hızlı ve sakin hissettiriyor; reklamın onu hızlı kesme ve zoom'la "enerjik" göstermesi, ilk açılışta beklenti uyuşmazlığı yaratır. `ad-creative-briefs.md` kare süreleri buna göre kurulu.

Ayrıca uygulama `reduce-motion`'a saygı duyuyor (`useReducedMotion`, `TabScene`). Materyal, üründe olmayan bir hareket dili dayatmamalı.

---

## 6. İkonografi

`@expo/vector-icons` / MaterialCommunityIcons. Boyut merdiveni: 14 · 16 · 18 · 20 · 24.

Materyalde ikon gerekiyorsa uygulamada gerçekten kullanılan glif seçilir. Stok ikon seti karıştırılmaz — iki farklı ikon dili tek karede görünürse ürün derli toplu görünmez.

---

## 7. Logo

| Varlık | Dosya |
|---|---|
| Dikey kilit | `assets/branding/logo-wm-stacked.png` |
| Splash | `assets/branding/splash-logo-main.png` |

Her ikisi de `check:visual-regression` tarafından byte düzeyinde dondurulmuş. **Materyal için yeniden çizilmez, rengi değiştirilmez, efekt eklenmez.** Boş alan: logo yüksekliğinin en az yarısı kadar.

---

## 8. Dış yüzey kontrol listesi

Bir store görseli, reklam karesi veya slayt teslim edilmeden önce:

- [ ] Kullanılan her renk yukarıdaki tablolardan mı
- [ ] Marka kırmızısı `#d90416` mı (başka bir kırmızı değil)
- [ ] Kırmızı, düz zemin üstünde metin olarak kullanılmış mı (kullanılmamalı — `#ff5a64` kullan)
- [ ] Metin/zemin çifti ≥ 4.5:1 mi (tablodan doğrula)
- [ ] Yazı tipi Inter mi
- [ ] Punto oranları merdivene uyuyor mu
- [ ] Köşe yarıçapları uygulamadaki değerlerden mi
- [ ] Logo değiştirilmemiş mi, boş alanı korunmuş mu
- [ ] Gösterilen ekran candidate build'de gerçekten var mı (`screenshot-storyboard.md`)
- [ ] Metin `claims-register.md`'de bir satıra bağlı mı

---

## 9. Bu belge ne değildir

- Yeni bir tasarım sistemi değil. Yeni token tanımlamıyor.
- Uygulama içi tasarım rehberi değil — o `src/shared/theme/index.ts` ve `docs/audit/ui-*` denetimleridir.
- Rebrand önerisi değil. Prompt'un ürün dondurma sözleşmesi köklü görsel dil değişimini yasaklıyor.

Palet veya tipografi değişirse **bu belge de aynı PR'da güncellenir**. Materyal ile ürünün ayrışması, bu belgenin önlemek için var olduğu tek şeydir.
