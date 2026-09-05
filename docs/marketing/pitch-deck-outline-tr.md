# WMatch — Sunum İskeleti (Türkçe)

**Format:** 10 slayt. Her slaytta **tek mesaj**. Yüksek boşluk. Gerçek ekran görüntüsü.
**Kural:** Sahte pazar büyüklüğü, sahte gelir, sahte büyüme, sahte testimonial **yok**. Ölçülmemiş şey "henüz ölçülmedi" diye yazılır — boş bırakılmaz, uydurulmaz.

---

## Tasarım sistemi (deck)

Deck, uygulamanın kendi token'larını kullanır — ayrı bir sunum kimliği üretilmez.

| Öğe | Değer | Kaynak |
|---|---|---|
| Arka plan | `#08090d` | `theme.colors.background` |
| Yüzey / kart | `#171922` | `theme.colors.surface` |
| Başlık rengi | `#f6f7fb` | `theme.colors.text` — arka planda 18.59:1 |
| Gövde rengi | `#9ea6bb` | `theme.colors.textMuted` — arka planda 8.17:1 |
| Vurgu | `#d90416` | `theme.colors.primary` |
| Vurgu üstü metin | `#ffffff` | `theme.colors.onAccent` — 5.28:1 |
| Başlık fontu | Inter ExtraBold | `theme.fonts.extraBold` |
| Gövde fontu | Inter Regular | `theme.fonts.regular` |

**Slayt ızgarası:** 16:9, kenar boşluğu %8. Başlık üst üçte birde. Görsel sağda veya altta, hiçbir zaman metnin arkasında.
**Metin bütçesi:** Slayt başına en fazla 40 kelime. Aşan slayt ikiye bölünür, font küçültülmez.

---

## Slayt 1 — Problem

> **Eşleşiyorsun. Sonra ne yazacağını bilmiyorsun.**

Eşleşme uygulamalarında kopma noktası genellikle eşleşmenin kendisi değil, eşleşmeden sonraki sessizliktir. Profillerde konuşulacak somut bir şey yoktur.

*Görsel:* Boş bir sohbet giriş alanı — gerçek ekran görüntüsü.

*Not:* Bu slaytta hiçbir sektör istatistiği verilmiyor. Kaynaklandırılamayan "kullanıcıların %70'i…" tipi rakam kullanılmaz.

---

## Slayt 2 — Kim, hangi durumda

Üç segment, tek satırla (`positioning-and-messaging.md` §3):

| Segment | Durum |
|---|---|
| Sohbeti başlatamayan | Eşleşiyor, ilk mesajda tıkanıyor |
| Zevkine göre insan arayan | Film/dizi hayatının merkezinde; boş profillerle konuşmak istemiyor |
| Temkinli kullanan | Konum ve fotoğrafın nereye gittiğini bilmiyor |

*Görsel:* Yok. Bu slayt yalnız metin — kalabalık görsel üç segmenti okunmaz yapıyor.

---

## Slayt 3 — Ürünün mevcut çözümü

> **Ortak film ve dizi zevki, konuşacak konuyu hazır getirir.**

Kullanıcı favori ve izlediklerini işaretler. Profiller listelerin örtüşme oranına göre sıralanır. Eşleşme olduğunda ortak içerikler zaten oradadır.

*Görsel:* Uyum ekranı — gerçek görüntü (`screenshot-storyboard.md` Kare 2).

---

## Slayt 4 — Gerçek kullanıcı yolculuğu

Beş adım, uygulamadaki gerçek sırayla, her adımın altında gerçek ekran görüntüsü:

```
İzle sekmesi   →   Uyum listesi   →   Uyum detayı   →   Kart akışı   →   Sohbet
işaretle           sıralanır          ortak içerik      beğen/geç       açılır
```

*Not:* Bu, store description'ındaki akışın aynısıdır. Deck, store ve ürün aynı sırayı anlatır.

---

## Slayt 5 — Mevcut farklılaştırıcı

> **Uyum oranı bir tahmin değil, bir ölçüm.**

Uyum oranı = `0.65 × (ortak favori / favori birleşimi) + 0.35 × (ortak izlenen / izlenen birleşimi)`

Deterministik, sürümlenmiş ve sunucu tarafında hesaplanıyor. Aynı iki liste her zaman aynı oranı verir.

Kullanıcı, oranın nereden geldiğini tek tek görebiliyor — hangi film, hangi dizi.

*Görsel:* Uyum detay sheet'i — ortak içerik listesi görünür.

*Sınır — slaytta açıkça yazılır:* Bu bir kişilik testi veya ilişki tahmini değildir. Kısa listelerde oran oynaktır.

*Not:* Bu slayt "AI destekli" demiyor. Formülü göstermek, "yapay zekâ" demekten daha inandırıcı: doğrulanabilir.

---

## Slayt 6 — Güvenlik, gizlilik ve teknik kalite

Dört madde, her biri kanıta bağlı:

| | Kanıt |
|---|---|
| Kesin konum ayrı bir özel tabloda; diğer kullanıcılara açılmıyor | `profiles_private` migration'ı |
| Profil fotoğrafları özel Storage, kısa ömürlü imzalı bağlantı | Storage hardening migration'ı |
| Tüm kullanıcı tabloları satır düzeyi güvenlikle (RLS) korunuyor | `npm run test:rls` |
| Kontrast, dokunma hedefi, mimari ve ürün yüzeyi CI'da denetleniyor | `npm run check` |

*Görsel:* Yok. Kanıtlı dört satır, dekoratif bir mimari şemasından daha güçlü.

---

## Slayt 7 — Traction

> **Henüz ölçülmedi.**

Ürün yayın öncesi. Ölçüm altyapısı hazır ve neyi ölçeceği tanımlı (`measurement-plan.md`):

- Store görüntüleme → yükleme dönüşümü
- Onboarding tamamlama
- İlk değer anı: ilk favori işaretleme
- D1 / D7 dönüş
- Crash-free oturum oranı

*Not:* Bu slayt boş bırakılmaz ve doldurulmak için uydurulmaz. Yatırımcı ortamında "henüz ölçmedik ama neyi ölçeceğimizi biliyoruz" ifadesi, şişirilmiş bir sayıdan daha güvenilirdir ve ilk due diligence'ta çökmez.

---

## Slayt 8 — Go-to-market

Dört kanal, öncelik sırasıyla (`go-to-market-plan.md`):

1. **Store search (ASO)** — maliyeti sıfır, bütçeye bağlı değil
2. **Film/dizi micro-creator'ları** — kitle tam olarak hedef segment
3. **Topluluk sayfaları** — yüksek niyet, düşük hacim
4. **Ücretli sosyal** — yalnız baseline ölçüldükten sonra

*Görsel:* Basit dört kademeli sütun. Yüzde veya bütçe rakamı **yok** — ölçülmedi.

---

## Slayt 9 — İş modeli

**Yalnız repository'de tanımlıysa doldurulur.**

Şu an kodda ücretlendirme, abonelik, satın alma veya reklam envanteri **yoktur**. Bu slayt ya "henüz tanımlanmadı" der ya da tamamen çıkarılır.

*Yasak:* Var olmayan bir premium katmanı veya gelir projeksiyonu çizmek. Kodda karşılığı olmayan iş modeli slaydı, ilk teknik incelemede güveni bitirir.

---

## Slayt 10 — Sonraki adım

Kanıta bağlı, uydurma roadmap değil:

| Adım | Kanıt/kapı |
|---|---|
| Yayın öncesi kalan maddelerin kapatılması | `docs/MANUAL_STEPS.md` · `docs/release-readiness.md` |
| Store gönderimi | Hesap silme akışının doğrulanması (`claims-register.md` P-05) |
| İlk 4 hafta: baseline ölçümü | `measurement-plan.md` |
| Creator dalgası | Aşama 1 çıkış kriteri karşılandığında |

*Yasak:* "Q2'de video sohbet, Q3'te grup eşleşme" tipi, kodda karşılığı olmayan özellik takvimi. Ürün dondurma sözleşmesi gereği yeni özellik zaten planlanmıyor.

---

## Üretim notları

**Editable kaynak:** Deck, düzenlenebilir formatta tutulur (Figma / Keynote / Google Slides). PDF yalnız çıktıdır; kaynak dosya sürümlenir.

**Ekran görüntüsü kaynağı:** Yalnız `screenshot-storyboard.md`'de tanımlı, candidate build'den alınmış kareler. Deck için ayrı, "daha güzel" bir mockup üretilmez.

**Sunum öncesi kontrol:**

- [ ] Her slaytta tek mesaj var mı
- [ ] Slayt başına 40 kelime sınırı aşılmış mı
- [ ] Her sayının kaynağı var mı — kaynaksız sayı var mı
- [ ] Slayt 7'de uydurma traction var mı (olmamalı)
- [ ] Slayt 9'da kodda karşılığı olmayan iş modeli var mı (olmamalı)
- [ ] Slayt 5'te "yapay zekâ", "bilimsel uyum" ifadesi var mı (olmamalı)
- [ ] Kullanılan her ekran candidate build'de var mı
- [ ] Kontrast: metin renkleri yukarıdaki tabloya uyuyor mu
