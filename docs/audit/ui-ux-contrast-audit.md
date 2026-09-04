# WMatch — UI/UX Kontrast ve Token Tutarlılığı Denetimi

**Candidate:** `1.0.51` · **Denetim tarihi:** 2026-09-04
**Yöntem:** Ölçüm, göz kararı değil. Bütün oranlar WCAG 2.2 bağıl parlaklık formülüyle hesaplandı; alfa kanallı her renk, ölçümden önce kendi taban yüzeyine kompozit edildi.
**Yeniden üretim:** `npm run check:contrast`

---

## 1. Neden ölçüm

Statik lint ve token guard'ı tek başına UI/UX kanıtı değildir: token kullanmak, token'ın **değerinin doğru olduğunu** göstermez. Bu denetim, token sisteminin kendisini ölçtü.

Kompozit kuralı önemli: `rgba(34, 197, 94, 0.16)` gibi bir yüzeyi tek başına ölçmek anlamsızdır — kullanıcı onu her zaman bir taban yüzeyin üstünde görür. Guard, her alfa değerini önce `theme.colors.background` üstüne düzleştirir, sonra ön planı o sonucun üstüne düzleştirir.

---

## 2. Bulgular

### P1 — Üçüncül metin AA eşiğinin altındaydı

| | |
|---|---|
| **Dosya** | `src/shared/theme/index.ts` — `textSoft`, `textTertiary` |
| **Ölçüm** | `#7f8698`: `surfaceMuted` üstünde **4.46:1**, `surfaceStrong` üstünde **4.03:1** |
| **Eşik** | WCAG 2.2 SC 1.4.3 — normal metin için 4.5:1 |
| **Kullanıcı etkisi** | Yardımcı metin, meta bilgi ve zaman damgaları en yoğun iki yüzeyde okunabilirlik eşiğinin altında kalıyordu. Düşük parlaklıkta veya güneş altında en önce kaybolan katman bu. |
| **Kök neden** | Değer, koyu tema için göz kararı seçilmiş; en açık iki yüzeye karşı hiç ölçülmemiş. |
| **Minimum çözüm** | `#7f8698` → `#8990a0` |
| **Neden bu çözüm** | Ton ve doygunluk korunuyor, yalnız parlaklık %8 artıyor. 4.5:1'i her yüzeyde geçen **en küçük** adım (en kötü durum 4.57:1). Daha açık bir değer, üçüncül metni ikincil metinden ayırt edilemez hâle getirir ve hiyerarşiyi bozardı. |
| **Doğrulama** | `npm run check:contrast` |

**Sonuç ölçümleri:**

| Yüzey | Önce | Sonra |
|---|---|---|
| `background` | 5.46:1 | 6.20:1 |
| `backgroundElevated` | 5.09:1 | 5.78:1 |
| `surface` | 4.81:1 | 5.46:1 |
| `surfaceMuted` | **4.46:1** ❌ | **5.07:1** ✅ |
| `surfaceStrong` | **4.03:1** ❌ | **4.57:1** ✅ |

### P1 — Marka kırmızısı üç ayrı değere ayrışmıştı

| | |
|---|---|
| **Dosya** | `src/shared/theme/index.ts` — `alpha` bloğu; `src/app/components/EmptyState.tsx` |
| **Bulgu** | Palette dört farklı kırmızı taşıyordu: `#d90416` (`colors.primary`), `#e10613` (`brand*` alfaları), `#e5484d` (`primary12`/`primary18`), `#d81421` (`brand88`) |
| **Kullanıcı etkisi** | `EmptyState` — uygulamanın **her boş durumunda** görünen bileşen — kendini `#e5484d` ile tonluyordu. Bu renk paletin başka hiçbir yerinde yok. Boş durumlar, markanın en sık görüldüğü ama en az incelenen yüzeyi; sessizce yanlış kırmızıyla çiziliyordu. |
| **Kök neden** | `primarySurface: rgba(217, 4, 22, 0.16)` doğru şekilde `colors.primary`'den türetilmiş; alfa merdiveni ise zamanla ayrı ayrı, elle eklenmiş. |
| **Minimum çözüm** | Bütün marka yıkamaları `colors.primary` `#d90416` tabanına alındı. `primary12`/`primary18` → `brand12`/`brand18` olarak merdivene katıldı. Hiçbir bileşenin referans vermediği `brand88` ve `success84` kaldırıldı. |
| **Neden bu çözüm** | Yeni token üretmiyor, mevcut ve zaten doğru olan `primarySurface` türetimini tek kaynak yapıyor. %12–26 alfa aralığında iki kırmızı arasındaki fark algı eşiğinin altında — düzeltme görsel dili değiştirmiyor, tutarlı hâle getiriyor. |
| **Doğrulama** | `npm run check:visual-regression` (normalize edilmiş, gerekçesi kayıtlı) |

### Kayıt altında — dekoratif kenarlıklar

| | |
|---|---|
| **Ölçüm** | `border` yüzey üstünde **1.25:1**; `borderStrong` yüzey üstünde **1.64:1**, arka plan üstünde **1.52:1** |
| **Karar** | Zorunlu tutulmadı, ölçülüp kaydedildi. |
| **Gerekçe** | SC 1.4.11, bir bileşeni **tanımlamak için gerekli** görsel bilgiyi kapsar. Bu saç teli kenarlıklar, zaten kendi dolgusu, ikonu ve metin etiketiyle tanımlanan bir kabı inceltiyor; tek başına affordance taşımıyorlar. Koyu temada bunları 3:1'e çıkarmak (alfa 0.16 → 0.33 gerekiyordu) bütün arayüzü sertleştirir ve ürün dondurma sözleşmesinin yasakladığı bir görsel dil değişikliği olurdu. |
| **Nasıl korunuyor** | Guard bu üç oranı **her çalışmada yazdırıyor**. İleride bir değişiklik bu kenarlıklardan birini bir kontrolün tek affordance'ı hâline getirirse, sayı ekranda hazır — silinmiş bir assertion'ın arkasında saklı değil. |

### Kayıt altında — seçim kenarlığı 3:1 sınırına yakın

| | |
|---|---|
| **Ölçüm** | `colors.primary` seçim kenarlığı olarak: `background` 3.77:1 · `backgroundElevated` 3.52:1 · `surface` 3.32:1 · `surfaceMuted` 3.08:1 |
| **Durum** | Hepsi SC 1.4.11 eşiğini (3:1) geçiyor — guard'da zorunlu. |
| **Not** | `surfaceMuted` üstünde 3.08:1 ile sınıra yakın. `surfaceStrong` üstünde 2.78:1 olurdu; bugün hiçbir seçilebilir kontrol o yüzeyde durmuyor, bu yüzden guard o çifti kapsamıyor. Bir seçim kontrolü `surfaceStrong`'a taşınırsa `theme.colors.borderFocus` (`#ff5a64`, 4.82:1) kullanılmalı. |

### Not — uyum katmanı 5 aşama tanımlıyor, 3 renk gösteriyor

| | |
|---|---|
| **Dosya** | `src/shared/theme/compatibility.ts` |
| **Bulgu** | `getCompatibilityStyle()` beş eşik ayırıyor (85 / 70 / 55 / 35 / altı) ama `excellent` ile `strong` aynı yeşili, `good` ile `developing` aynı turuncuyu paylaşıyor. Görsel olarak üç bant var. |
| **Karar** | **Değiştirilmedi.** Beş semantik aşamayı üç renk bandına indirmek makul bir tasarım kararı: her eşiğe ayrı renk vermek, oranı olduğundan daha kesin gösterir — `positioning-and-messaging.md` §5'teki ölçülülük ilkesiyle çelişirdi. |
| **Kayıt sebebi** | Kod okuyan birinin "eksik renk" sanıp doldurmaması için. |

---

## 3. Kalıcı guard

`scripts/guards/check-contrast.mjs` — `npm run check:contrast`, `npm run check` zincirine bağlı.

| | |
|---|---|
| **Kapsam** | 32 gerçek semantik çift |
| **Eşikler** | Metin 4.5:1 (SC 1.4.3) · büyük metin ve UI bileşeni 3:1 (SC 1.4.11) |
| **Kapsanan roller** | Gövde/ikincil/üçüncül metin × 5 yüzey · durum metni kendi tonlu yüzeyinde · dolgu üstü etiket rengi · odak kenarlığı · seçim kenarlığı · devre dışı metin |
| **Kompozit** | Alfa ön plan ve alfa yüzeyler ölçümden önce tabana düzleştirilir |
| **Muafiyet politikası** | Muaf çiftler silinmez; oranı ve yazılı gerekçesiyle `INFO` satırı olarak basılır |

**Neden token guard'ı yetmiyordu:** Mevcut `check:visual-regression` guard'ı token dosyasını baseline'a karşı byte düzeyinde donduruyor — yani *değişmediğini* kanıtlıyor. `check:contrast` ise değerlerin *doğru olduğunu* kanıtlıyor. İkisi farklı soruya cevap veriyor; ikisi de gerekli.

---

## 4. Görsel regresyon guard'ı ile ilişki

Palet değişikliği `check:visual-regression` guard'ını haklı olarak kırdı — amacı tam olarak bu.

Baseline sıfırlanmadı. Bunun yerine guard'a dar bir normalizasyon eklendi: yukarıda gerekçelendirilen **iki boyut** (üçüncül metin rengi ve marka yıkama merdiveni) kanonik hâle getiriliyor, token dosyasının **diğer her byte'ı** baseline'a karşı donmuş kalıyor. Palette gözden geçirilmemiş bir düzenleme yapılırsa guard yine kırılır.

Normalizasyon her iki tarafa da uygulandığından tek yönlü bir çeviri değil, kanonik bir eşleme olarak yazıldı — aksi hâlde baseline'ı da bozardı.

---

## 5. Feature-surface etkisi

**Yok.** Denetim sonrası doğrulandı:

```
tabs=6 screens=13 modals=12 sheets=2 apiRoutes=41 databaseTables=28
```

Yeni ekran, sekme, modal, sheet, CTA, ayar grubu, bildirim türü veya izin eklenmedi.

---

## 6. Doğrulama kaydı

| Komut | Sonuç |
|---|---|
| `npm run typecheck` | PASS |
| `npm test` | PASS — 9 suite, 29 test |
| `npm run check:contrast` | PASS — 32 çift |
| `npm run check:touch` | PASS |
| `npm run check:i18n` | PASS — 537 anahtar |
| `npm run check:architecture` | PASS — 193 dosya, 788 kenar |
| `npm run check:feature-surface` | PASS — yüzey değişmedi |
| `npm run check:visual-regression` | PASS — 31 tam eşleşme, 3 normalize |

---

## 7. Bu denetimin kapsamadıkları

Dürüstlük gereği açıkça yazılıyor. Aşağıdakiler **repository'den kanıtlanamaz** ve gerçek cihaz gerektirir:

- VoiceOver ve TalkBack ile kritik yolculuk
- Font ölçeği 1.0 / 1.3 / 1.5 altında metin kırpılması
- Gerçek cihazda safe-area, klavye ve gesture bar çakışması
- Küçük / standart / büyük telefon sınıflarında düzen
- Reduce-motion davranışı

Bunlar `docs/MANUAL_STEPS.md` kapsamındadır ve tamamlanmadan UI/UX alanı için 9.80 verilemez. Bu denetim o puanın **statik ayağını** kapatıyor, tamamını değil.
