# WMatch — Konumlandırma ve Mesaj Hiyerarşisi

**Kaynak:** Yalnızca `quality/feature-surface.snapshot.json`, `src/shared/i18n/locales/tr.ts` ve çalışan kod.
**Kural:** Buradaki her cümle `claims-register.md`'de bir satıra bağlıdır. Bağlanmayan cümle yayınlanmaz.

---

## 1. Tek cümlelik konum

> **Ortak film ve dizi zevki, ilk mesajı yazmayı kolaylaştıran bir başlangıç noktası verir.**

Bu cümle neden bu şekilde kurulu:

- **"Ortak film ve dizi zevki"** — ürünün gerçekten ölçtüğü şey (F-02, F-03). Kişilik, değer, ilişki uyumu değil.
- **"ilk mesajı yazmayı kolaylaştıran"** — çözülen gerçek sorun. Eşleşme uygulamalarında bırakılma noktası genellikle eşleşme değil, eşleşme sonrası sessizliktir. WMatch'in elindeki koz burada.
- **"başlangıç noktası"** — sonuç garantisi vermeyen, geri alınabilir bir vaat. "Bulur", "sağlar", "garantiler" demiyoruz.

**Söylemediğimiz ve neden:**

| Cazip ama yasak | Neden |
|---|---|
| "Film zevkine göre ruh eşini bul" | İlişki sonucu vaadi. Kanıt yok, store riski var. |
| "Yapay zekâ ortak zevkinizi analiz eder" | Skor bir kesişim oranı; model değil (M yasakları). |
| "Binlerce film severe katıl" | Sahte sosyal kanıt (M-02). |

---

## 2. Mesaj hiyerarşisi

Her materyalde sıra **her zaman** budur. Baştaki cümle değişmez; alttakiler kanala göre kısalabilir.

```
1. ANA VAAT      Ortak film ve dizi zevki, sohbeti daha kolay başlatır.
                 ↓
2. KANIT ÜÇLÜSÜ  a) Listeni işaretle          (F-01)
                 b) Ortaklığa göre sıralanır  (F-02, F-03)
                 c) Eşleşince sohbet açılır   (F-05)
                 ↓
3. GÜVEN         Konum yalnız mesafe filtresi için, yalnız kullanırken. (P-01, P-02)
                 Engelle ve şikâyet et.                                  (F-07)
                 ↓
4. CTA           "İndir ve listeni oluştur."
```

**Kanıt üçlüsü neden bu sırada:** kullanıcının uygulamada yaptığı işlerin gerçek sırası bu. Store görselleri, reklam ve deck aynı sırayı izler; farklı sıra kullanmak, kullanıcının uygulamayı açtığında gördüğü akışla materyali çelişkiye düşürür.

---

## 3. Segmentler ve JTBD

Segmentler ürün belgelerinden ve mevcut copy'den türetilmiştir; varsayılan persona uydurulmamıştır.

### Segment A — "Sohbeti başlatamayan"

| | |
|---|---|
| **Durum** | Eşleşme uygulamalarında eşleşiyor ama ilk mesajda tıkanıyor. "Selam" dışında yazacak bir şey bulamıyor. |
| **Motivasyon** | Zorlamadan, doğal bir konu açmak. |
| **Engel** | Profilde konuşacak somut bir şey yok. |
| **Mevcut çözüm** | Uyum sayfası ve `CompatibilitySheet` ortak favori/izlenen listesini adıyla gösterir (F-03). Konu hazır. |
| **İlk anlamlı değer anı** | Bir profilin uyum kartına dokunup ortak diziyi görmek. |
| **Mesaj** | "Ne yazacağını bilmiyorsan, ortak izlediğiniz diziden başla." |

### Segment B — "Zevkine göre insan arayan"

| | |
|---|---|
| **Durum** | Film/dizi hayatının merkezinde; boş profillerle konuşmak istemiyor. |
| **Motivasyon** | Aynı şeyleri seven insanlarla karşılaşmak. |
| **Engel** | Diğer uygulamalarda zevk sinyali profil metnine gömülü ve aranamıyor. |
| **Mevcut çözüm** | Uyum filtresi + uyum aralığı ile sıralı keşif (F-02, F-06). |
| **İlk anlamlı değer anı** | Favorileri işaretledikten sonra uyum listesinin dolması. |
| **Mesaj** | "Favorilerini işaretle; liste ortak zevke göre sıralansın." |

### Segment C — "Temkinli kullanan"

| | |
|---|---|
| **Durum** | Eşleşme uygulamalarında mahremiyet ve taciz konusunda tedirgin. |
| **Motivasyon** | Kontrolü elinde tutmak. |
| **Engel** | Konum ve fotoğrafın nereye gittiğini bilmemek. |
| **Mevcut çözüm** | Konum yalnız mesafe filtresi için, kesin konum özel tabloda (P-01, P-02); fotoğraflar özel Storage'da (P-03); engelle/şikâyet (F-07). |
| **İlk anlamlı değer anı** | İzin ekranında ne için istendiğini net okumak. |
| **Mesaj** | "Konumun mesafe filtresinden başka bir yere gitmiyor." |

---

## 4. Marka sesi

| Yap | Yapma |
|---|---|
| Kısa, düz Türkçe cümle. Ortalama 8–12 kelime. | Devrik, süslü, "keşfin kapılarını arala" tonu. |
| Uygulamadaki terimi aynen kullan: **Uyum**, **Eşleşme**, **Keşif**, **İzlenenler**, **Favoriler** | Materyalde "Skor", "Match", "Feed" gibi uygulamada olmayan terim. |
| Kullanıcıyı özne yap: "Favorilerini işaretle." | Ürünü özne yapıp abartma: "WMatch senin için en uygun kişiyi bulur." |
| Sonucu değil işi anlat. | Duygu vaadi satma ("yalnız kalma"). |
| İkinci tekil şahıs, samimi ama ölçülü. | Aşırı samimiyet, emoji yığını, ünlem zinciri. |

**Terim sözlüğü — UI ile materyal aynı kelimeyi kullanır** (kaynak `src/shared/i18n/locales/tr.ts`):

| UI'deki karşılık | Materyalde | Kullanma |
|---|---|---|
| `nav.compatibility` = "Uyum" | Uyum | Skor, puan, uyumluluk endeksi |
| `compatibility.subtitle` = "Favori ve izlenen ortaklığına göre sıralı profiller" | ortak favori ve izlenen | zevk analizi, algoritma |
| `profile.card.compatibility.label` = "Uyum oranı" | Uyum oranı | Uyum yüzdesi/skoru |
| Eşleşme | Eşleşme | Match |

---

## 5. Uyum oranını anlatma protokolü

Bu ürünün en yanlış anlatılabilecek parçası. Kural şu:

**Doğru:**
> "Uyum oranı, senin ve karşı tarafın favori ve izlenen listelerinin ne kadar örtüştüğünü gösterir. Ortak favoriler daha ağır sayılır."

Bu cümle formülün birebir karşılığıdır: `0.65 × (ortak favori / favori birleşimi) + 0.35 × (ortak izlenen / izlenen birleşimi)`.

**Yanlış — hiçbir materyalde geçmez:**
- "Bilimsel uyum analizi"
- "Yapay zekâ destekli eşleştirme"
- "%92 uyum = %92 ihtimalle anlaşırsınız"
- "Uyumu yüksek olanlar daha çok konuşuyor" (ölçülmedi — M-03)

**Neden bu kadar katı:** oran, listeleri kısa olan kullanıcılarda çok oynaktır (iki ortak favorisi olan iki kişi %100 görebilir). Bunu kesin gerçek gibi sunmak hem yanıltıcı hem de ilk kullanımda güven kırıcıdır. Ürün içinde de aynı ölçülülük korunur; `CompatibilitySheet` zaten ortak içerikleri listeleyerek oranı bağlamlandırıyor — materyal bu bağlamı bozmaz.

---

## 6. Kanal başına mesaj kısaltması

| Kanal | Karakter bütçesi | Kullanılacak cümle |
|---|---|---|
| App Store subtitle | 30 | "Ortak film zevkiyle tanış" |
| Play short description | 80 | "Favori ve izlediğin dizilere göre sıralanan profillerle sohbete başla." |
| Reklam ana başlık | ~40 | "Ne yazacağını bilemiyorsan…" |
| Store ilk görsel başlığı | ~35 | "Listeni işaretle" |
| Deck kapak | — | "Ortak film zevki, ilk mesajı kolaylaştırır." |

Hepsi aynı ana vaadin farklı uzunluktaki hâlidir. Kanaldan kanala yeni bir vaat icat edilmez.
