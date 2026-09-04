# WMatch — Go-to-Market ve Kanal Planı

**Durum:** Yayın öncesi. Ölçülmüş traction **yok**. Bu plandaki hiçbir sayı tahmin değil, eşik tanımıdır.

---

## 1. Kanal önceliği

Kanallar, bu ürünün gerçek dağıtım avantajına göre sıralanmıştır — genel "best practice" listesi değil.

### Öncelik 1 — Store search (ASO)

| | |
|---|---|
| **Neden birinci** | Maliyeti sıfır, sürekli çalışır, bütçe onayına bağlı değil. Kategori araması ("film", "dizi", "tanışma") zaten var olan bir talep. |
| **Ne yapılır** | `store-listing-tr.md` uygulanır; ilk üç görsel `screenshot-storyboard.md`'ye göre üretilir. |
| **Ölçüm** | Store görüntüleme → yükleme dönüşümü |
| **Bağımlılık** | Yalnız candidate build ve ekran görüntüleri |

### Öncelik 2 — Film/dizi micro-creator'ları

| | |
|---|---|
| **Neden ikinci** | Ürünün farklılaştırıcısı içerik zevki; bu creator'ların kitlesi tam olarak Segment B. Takipçi başına maliyeti düşük, güveni yüksek. |
| **Hedef profil** | 1K–20K takipçili, film/dizi içeriği üreten, izleme listesi paylaşan hesaplar |
| **Teklif** | Erken erişim + ürün ekibiyle doğrudan geri bildirim hattı. Ödeme yapılıyorsa açıkça "iş birliği" etiketlenir. |
| **Sınır** | Creator ürünü **gerçekten kullanmadan** deneyim anlatmaz. Senaryo yazıp okutmak yok. |
| **Ölçüm** | Creator başına UTM'li bağlantı → yükleme → `first_value_action` |

### Öncelik 3 — Topluluk sayfaları

| | |
|---|---|
| **Neden üçüncü** | Yüksek niyet, düşük hacim. Doğru yerde tek bir gönderi, yanlış yerde yüz gönderiden değerli. |
| **Hedef** | Dizi/film odaklı forum, grup ve topluluk sayfaları |
| **Kural** | Reklam gibi değil, ürünün ne yaptığını anlatan tek gönderi. Grup kurallarına uyulur. Spam yapılmaz, çoklu hesap kullanılmaz. |
| **Ölçüm** | Topluluk başına UTM |

### Öncelik 4 — Ücretli sosyal (yalnız bütçe onaylanırsa)

| | |
|---|---|
| **Neden son** | Bütçe onayına bağlı, öğrenme maliyeti yüksek, baseline olmadan optimize edilemez. |
| **Ön koşul** | Öncelik 1–3'ten en az 4 haftalık baseline; `measurement-plan.md` eşikleri |
| **Başlangıç** | Tek angle (Angle 1), tek kanal, küçük kontrollü kohort. Aynı anda üç angle test edilmez — hangisinin çalıştığı ayırt edilemez. |
| **Durdurma kuralı** | `first_value_action` oranı organik ortalamanın %60'ının altına düşerse kanal durdurulur. |

---

## 2. Aşamalar

### Aşama 0 — Yayın öncesi (candidate hazır olduğunda)

- [ ] `store-listing-tr.md` uygulandı
- [ ] Ekran görüntüleri `1.0.51` build'inden alındı ve doğrulandı
- [ ] `claims-register.md` P-05 (hesap silme) kapatıldı — Data Safety formu buna bağlı
- [ ] TestFlight / Internal Track ile son duman testi
- [ ] Sentry canlı ve olay alıyor

**Çıkış kriteri:** Store sayfası, hiç reklam olmadan, kendi başına ürünü doğru anlatıyor.

### Aşama 1 — Sessiz yayın (0.–4. hafta)

Amaç: **baseline ölçmek**, hacim değil.

- Ücretli bütçe **yok**.
- Öncelik 1 (ASO) ve Öncelik 3 (2–3 topluluk gönderisi) aktif.
- Her hafta: store dönüşümü, `first_value_action` oranı, crash-free oturum.

**Çıkış kriteri:** 4 haftalık baseline dönüşüm oranı ve `first_value_action` oranı elde.
**Çıkmama kriteri:** crash-free oturum düşükse veya funnel'da ürün kaynaklı bir kopma varsa Aşama 2'ye geçilmez — reklam, bozuk bir funnel'ı büyütmekten başka işe yaramaz.

### Aşama 2 — Creator dalgası (4.–10. hafta)

- Öncelik 2 devreye girer: 3–5 micro-creator, farklı angle'larla.
- Her creator ayrı UTM.
- Aşama 1 baseline'ı ile karşılaştırılır.

**Çıkış kriteri:** En az iki creator'da yükleme **ve** `first_value_action` oranı baseline'ın üstünde.

### Aşama 3 — Kontrollü ücretli test (bütçe onaylanırsa)

- Tek angle, tek kanal, `measurement-plan.md` eşikleriyle.
- 14 gün, örneklem dolmadan karar yok.

---

## 3. Zamanlama notu

Kampanya yoğunluğu **release takvimine bağlıdır, tersi değil.** Kritik bir OTA veya native build yayındayken creator dalgası başlatılmaz: yeni kullanıcı, en kırılgan anda gelir.

`docs/ota-runtime-and-release.md` ve `docs/release-readiness.md` NO-GO diyorsa pazarlama takvimi ertelenir.

---

## 4. Riskler

| Risk | Etki | Azaltım |
|---|---|---|
| Soğuk başlangıç: az kullanıcı → boş uyum listesi → bırakma | Yüksek | Coğrafi/topluluk odaklı yoğunlaşma. Dağınık ülke geneli yükleme yerine, tek bir topluluk içinde yoğunluk. |
| Kullanıcı listesini doldurmadan uyum sayfasına gidiyor, boş görüyor | Yüksek | Tüm creative'lerde "önce listeni işaretle" adımı görünür (Angle 2 buna göre kurulu). Ürün içinde yeni onboarding adımı **eklenmez**. |
| Uyum oranının abartılı anlaşılması | Orta | `store-listing-tr.md`'deki "Uyum oranı hakkında" bölümü ve `positioning-and-messaging.md` §5 protokolü. |
| Creator ürünü kullanmadan içerik üretiyor | Orta | Sözleşmede açık şart; kullanmadan deneyim anlatan içerik yayınlanmaz. |
| Ücretli kanal ucuz ama değersiz yükleme getiriyor | Orta | Durdurma kuralı (Öncelik 4). |
| Store reddi (gizlilik beyanı uyuşmazlığı) | Yüksek | `store-listing-tr.md` gizlilik tabloları `app.json` ile birebir; P-05 kapatılmadan gönderim yok. |

---

## 5. Yapılmayacaklar

- Kullanıcı sayısı, indirme sayısı veya eşleşme sayısı açıklamak (M-01, M-03).
- Sahte hesaplarla topluluk hacmi izlenimi yaratmak.
- Zorunlu davet, davet duvarı veya paylaşım karşılığı özellik açma.
- Bildirimleri kampanya aracı olarak kullanmak — mevcut bildirim türleri (`match`, `message`, `like`, `chat_*`) dışında hiçbir şey gönderilmez.
- Sahte aciliyet, geri sayım, "son X kişi" mesajı.
- Yeni ürün özelliği vaat ederek yükleme toplamak.
