# WMatch — Store Ekran Görüntüsü ve Önizleme Storyboard'u

**Mutlak kural:** Her kare, `1.0.51` candidate build'inden alınmış **gerçek** ekran görüntüsüdür. Var olmayan kontrol, sahte kullanıcı sayısı, sahte sohbet, sahte puan veya mockup'ta çizilmiş arayüz **yoktur**.

**Fixture politikası:** Demo hesaplarındaki profil fotoğrafları ve isimler sentetiktir ve store metninde de böyle olduğu ima edilmez (sosyal sayı, "1.000 kişi" gibi ifade kullanılmaz). Film/dizi posterleri TMDB kaynaklıdır; TMDB atıf yükümlülüğü için bkz. `ATTRIBUTIONS.md`.

---

## Teknik özellikler

| Store | Zorunlu boyut | Adet | Not |
|---|---|---|---|
| App Store — 6.9" (iPhone 16 Pro Max) | 1320 × 2868 px | 6 | Apple bunu diğer boyutlara ölçekler; birincil set budur. |
| App Store — 6.5" (iPhone 11 Pro Max) | 1242 × 2688 px | 6 | Eski cihaz sınıfı için ayrı çekim (ölçekleme değil). |
| Google Play — telefon | 1080 × 1920 px min. | 6 | 16:9 veya 9:16. |
| Play — feature graphic | 1024 × 500 px | 1 | Metinsiz; ürün adı + tek cümle. |

**Metin yerleşimi (her karede aynı):**

```
┌──────────────────────────┐  ← üst güvenli alan: 220 px (6.9")
│                          │     status bar ve Dynamic Island'ın altı
│   BAŞLIK                 │  ← 64 px, Inter ExtraBold, tek satır
│   alt açıklama           │  ← 40 px, Inter Regular, en fazla iki satır
│                          │
│  ┌────────────────────┐  │
│  │                    │  │
│  │   GERÇEK EKRAN     │  │  ← cihaz çerçevesi içinde, kırpılmadan
│  │                    │  │
│  └────────────────────┘  │
│                          │  ← alt güvenli alan: 120 px
└──────────────────────────┘
```

**Neden bu yerleşim:** Store arama sonucunda ilk üç görselin yalnızca üst ~%40'ı görünür. Başlık üstte olmazsa tarama sırasında hiç okunmaz. Başlık 64 px'in altına düşmez — küçük önizlemede okunamaz hâle gelir.

---

## Kare sırası — ilk üç kare kararı verir

Store analitiğinde kullanıcıların büyük çoğunluğu ilk üç görselin ötesine kaydırmıyor. Bu yüzden **1–3 arası kareler birbirini tekrar etmez** ve her biri farklı bir kullanıcı işini anlatır.

### Kare 1 — Listeni işaretle

| | |
|---|---|
| **Başlık** | Listeni işaretle |
| **Alt açıklama** | Sevdiğin filmleri ve dizileri favorilerine ekle. |
| **Ekran** | `WatchScreen.tsx` — "İzle" sekmesi, "Popüler filmler" / "Popüler diziler" satırları dolu |
| **Kanıt** | F-01 |
| **Export adı** | `appstore-69-01-listeni-isaretle.png` |
| **Durum** | Populated. Arama boş, öneri satırları görünür. |
| **Dikkat** | Boş liste hâli gösterilmez — ilk kare ürünün dolu hâlini göstermeli. |

### Kare 2 — Ortak zevke göre sıralansın

| | |
|---|---|
| **Başlık** | Ortak zevke göre sıralansın |
| **Alt açıklama** | Profiller, listelerinizin örtüşme oranına göre gelir. |
| **Ekran** | `CompatibilityScreen.tsx` — "Uyum" sekmesi, uyum oranı rozetleri görünür profil listesi |
| **Kanıt** | F-02, F-03 |
| **Export adı** | `appstore-69-02-uyum-siralamasi.png` |
| **Durum** | Populated, en az 4 profil kartı görünür. |
| **Dikkat** | Görünen oranlar **gerçek fixture verisinden hesaplanmış** olmalı. Görsele elle %98 yazılmaz. Tek bir kartta %100 görünmesin — kısa listede oluşan uç değer yanıltıcı beklenti yaratır. |

### Kare 3 — Ortak noktanızı gör

| | |
|---|---|
| **Başlık** | Ortak noktanızı gör |
| **Alt açıklama** | Hangi film ve dizilerde buluştuğunuzu tek tek görürsün. |
| **Ekran** | `CompatibilitySheet.tsx` — açık sheet, "Ortak favoriler" ve "Ortak izlenenler" listesi dolu |
| **Kanıt** | F-03 |
| **Export adı** | `appstore-69-03-ortak-icerik.png` |
| **Durum** | Populated sheet. |
| **Neden 3. sırada** | 1 ve 2 "ne yapıyorsun"u anlatır; 3 farklılaştırıcıyı gösterir. Rakiplerde olmayan tek somut şey bu ekran — ilk üçün içinde olmak zorunda. |

### Kare 4 — Beğen, geç, geri al

| | |
|---|---|
| **Başlık** | Beğen, geç, geri al |
| **Alt açıklama** | Yanlışlıkla kaydırdıysan geri alabilirsin. Günlük hakkın ekranda. |
| **Ekran** | `SwipeModal.tsx` + `SwipeActionRail.tsx` + `SwipeQuotaBar.tsx` görünür |
| **Kanıt** | F-04, F-09 |
| **Export adı** | `appstore-69-04-kart-akisi.png` |
| **Dikkat** | Kota çubuğu **görünür bırakılır**, kırpılmaz. Kotayı gizleyip "sınırsız" izlenimi vermek dark pattern. |

### Kare 5 — Eşleşince sohbet açılır

| | |
|---|---|
| **Başlık** | Eşleşince sohbet açılır |
| **Alt açıklama** | Konuşacak konu zaten listeninizde. |
| **Ekran** | `ChatScreen.tsx` — sohbet listesi, birkaç thread |
| **Kanıt** | F-05 |
| **Export adı** | `appstore-69-05-sohbet.png` |
| **Dikkat** | Sahte mesaj içeriği yazılmaz; fixture hesapların ürettiği nötr metin kullanılır. Romantik/cinsel içerikli sahte mesaj kesinlikle yok — hem yalan hem store riski. |

### Kare 6 — Kontrol sende

| | |
|---|---|
| **Başlık** | Kontrol sende |
| **Alt açıklama** | Engelle, şikâyet et, filtrelerini daralt. |
| **Ekran** | `DiscoveryFiltersModal.tsx` (yaş / mesafe / uyum aralığı görünür) |
| **Kanıt** | F-06, F-07 |
| **Export adı** | `appstore-69-06-kontrol.png` |
| **Neden son** | Güven mesajı, ilgi oluştuktan sonra en çok işe yarar. Baştaki karelerde yer kaplarsa değer anlatımını yer. |

---

## App Preview videosu (isteğe bağlı, 15–30 sn)

Yalnız gerçek ekran kaydı. Ses yok (App Store önizlemeleri sessiz başlar), altyazı var.

| Süre | Görüntü | Altyazı |
|---|---|---|
| 0–4 sn | İzle sekmesi, bir dizi favorilere ekleniyor | Listeni işaretle. |
| 4–9 sn | Uyum sekmesi doluyor, oranlar görünüyor | Profiller ortak zevkine göre sıralansın. |
| 9–15 sn | Bir karta dokunma → uyum sheet'i açılıyor, ortak diziler | Nerede buluştuğunuzu gör. |
| 15–21 sn | Kart akışı, beğeni, eşleşme ekranı | Karşılıklı beğendiğinizde eşleşin. |
| 21–26 sn | Sohbet açılıyor | Sohbet açılsın. |
| 26–30 sn | Logo + tek cümle | Ortak film zevki, ilk mesajı kolaylaştırır. |

**İlk 4 saniye kuralı:** Önizleme otomatik oynuyor ve ilk saniyelerde ürün ekranı görünmezse izleyici kaydırıyor. Logo/intro animasyonu **başa konmaz**, sona konur.

---

## Play feature graphic (1024 × 500)

| Öğe | İçerik |
|---|---|
| Sol %55 | `WMatch` wordmark (`assets/branding/logo-wm-stacked.png`) + "Ortak film zevkiyle tanış" |
| Sağ %45 | Uyum ekranının kırpılmış gerçek görüntüsü, hafif açıyla |
| Arka plan | `theme.gradients.appBackground` (`#07080c → #11141d → #090b10`) |
| Metin rengi | `theme.colors.text` `#f6f7fb` — arka planda 18.59:1 kontrast (ölçüm: `npm run check:contrast`) |

Feature graphic'e **buton, ödül rozeti, yıldız puanı veya "Editörün seçimi" benzeri işaret konmaz** — Play bunu politika ihlali sayıyor.

---

## Üretim akışı

1. `1.0.51` candidate build'i gerçek cihaza kur (simülatör görüntüsü kabul edilmez — durum çubuğu ve font render'ı farklı).
2. Deterministik fixture hesabıyla giriş yap (`docs/testing/`).
3. Durum çubuğunu temizle: tam pil, tam sinyal, saat `09:41` (Apple konvansiyonu), bildirim rozeti yok.
4. Her kare için ekranı yukarıdaki `Durum` sütununa getir, ham PNG al.
5. Kareleri şablona yerleştir, başlıkları ekle, yukarıdaki `Export adı` ile kaydet.
6. **Doğrulama:** her karedeki her kontrolün candidate build'de var olduğunu `quality/feature-surface.snapshot.json` ile karşılaştır.
7. Küçük önizleme testi: her kareyi 200 px genişliğe küçült; başlık okunmuyorsa başlık kısaltılır (görsel değiştirilmez).

## Yasaklar

- Var olmayan bir düğme, sekme veya ekranı çizmek.
- Uygulamada olmayan bir sayı veya rozet eklemek ("4,8 ★", "10B+ kullanıcı").
- Sahte eşleşme bildirimi veya "Seni 12 kişi beğendi" tarzı bir ekran kurgulamak.
- Bir kareyi başka bir uygulamanın ekranından üretmek.
- Ekran görüntüsünü, gerçekte yapamadığı bir şeyi vaat eden başlıkla eşleştirmek.
