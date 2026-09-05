# WMatch — Aktivasyon ve İlk Değer Analizi

**Candidate:** `1.0.51` · **Tarih:** 2026-09-04
**Kapsam:** Mevcut akışın dönüşüm analizi. **Yeni özellik, yeni ekran, yeni onboarding adımı önerilmiyor.**
**Yöntem:** Kod okuması + davranışsal tasarım ilkeleri. Her bulgu bir dosyaya dayanıyor; hiçbir oran uydurulmuyor.

> **Bu belgede hiçbir sayı ölçüm değildir.** Ürün yayın öncesi. Buradaki tespitler mekanizma analizidir; oranlar ölçülünce `measurement-plan.md` üzerinden doğrulanacak.

---

## 1. Neden bu analiz

Bu ürünün değeri, kullanıcı **listesini doldurana kadar görünmez**. Uyum oranı iki listenin kesişimidir (`calculate_discovery_compatibility_score`); bir taraf boşsa kesişim sıfırdır ve Uyum sekmesi boş kalır.

Yani WMatch'te asıl "aha" anı eşleşme değil, **ilk favori/izlenen işaretleme**. Bütün aktivasyon analizi bu tek adımın etrafında kurulmalı. `go-to-market-plan.md` ve `measurement-plan.md` bu tanımı zaten kullanıyor; bu belge o adıma giden yolu inceliyor.

---

## 2. Gerçek akış

```
Kayıt (4 adım)                          SignUpScreen.tsx
  1  Hesabını oluştur      e-posta, şifre           step === 1
  2  Seni tanıyalım        ad, yaş, cinsiyet, @kullanıcı adı   step === 2
  3  Profilini hazırla     EN AZ 3 FOTOĞRAF         step === 3, MIN_PROFILE_PHOTOS
  4  Kontrol et ve tamamla                          step === 4
        │
        ▼
Uygulama "watch" sekmesinde açılıyor    App.tsx:117  useState<AppTab>('watch')
        │
        ▼
İLK DEĞER: favori / izlenen işaretle    user_movies ilk satır
        │
        ▼
Uyum listesi dolar                      CompatibilityScreen
        │
        ▼
Beğen → Eşleş → Sohbet
```

### Doğru kurulmuş olan: açılış sekmesi

Uygulama, girişten sonra **`watch` sekmesinde** açılıyor (`App.tsx:117`). Bu, ilk değer eyleminin yapıldığı ekranın ta kendisi.

Bu önemli çünkü alternatifi çok daha kötü olurdu: kullanıcıyı Uyum veya Eşleş sekmesinde karşılamak, listesi boş olduğu için **boş bir ekranla** karşılamak demektir. Ürün ilk saniyesinde hiçbir şey gösteremezdi. Mevcut karar doğru; **değiştirilmemeli**.

---

## 3. Sürtünme noktaları

### F-1 — Üç fotoğraf zorunluluğu, ilk değerden **önce**

| | |
|---|---|
| **Nerede** | `src/shared/constants/index.ts` → `MIN_PROFILE_PHOTOS = 3`; `SignUpScreen.tsx:515` kapısı |
| **Ne oluyor** | Kullanıcı, ürünün ne yaptığını **hiç görmeden** üç fotoğraf yüklemek zorunda. |
| **Neden önemli** | Bu, akıştaki en pahalı tek adım: galeriye çıkmak, seçmek, sıralamak, yüklemenin bitmesini beklemek. Ve karşılığında kullanıcı henüz hiçbir değer görmemiş durumda. Maliyetin değerden önce geldiği her adım, bırakma riskinin yoğunlaştığı yerdir. |
| **Neden yine de savunulabilir** | Eşleşme ürünlerinde fotoğrafsız profil, karşı taraf için değersizdir. Fotoğrafı sonraya bırakmak, kart akışını boş profillerle doldurup **diğer** kullanıcıların deneyimini bozar. Bu bir ürün kararıdır, kusur değil. |
| **Öneri** | **Kod değişikliği yok.** Bunun yerine: store ve reklam materyalinde beklenti önceden kurulur. `screenshot-storyboard.md` Kare 1 zaten "Listeni işaretle" diyor; kayıt öncesi kullanıcı ne için kaydolduğunu biliyorsa üç fotoğrafı vermeye daha istekli olur. Sürtünmeyi kaldıramıyorsan, gerekçesini önceden anlat. |
| **Ölçüm** | `measurement-plan.md` → `onboarding_complete` ile `install` arasındaki düşüş. Bu adım şüpheli ise düşüş burada yoğunlaşır. |

### F-2 — Uyum sekmesinin soğuk başlangıcı

| | |
|---|---|
| **Nerede** | `CompatibilityScreen.tsx` boş durumu |
| **Ne oluyordu** | Boş durum açıklaması: *"Ortak favori veya ortak izlenen içeriği olan yeni profiller burada görünecek."* |
| **Sorun** | Cümle **ne olacağını** anlatıyor, **kullanıcının ne yapabileceğini** değil. Oysa kullanıcı burada gerçekten harekete geçebilir: İzle sekmesine gidip işaretlemeye başlayabilir. Ürünün farklılaştırıcısını taşıyan ekran, yeni kullanıcıya çıkışsız bir cümleyle karşılık veriyordu. |
| **Düzeltme** | Açıklama, uygulamanın **kendi mevcut desenine** çekildi: *"Ortak favori veya ortak izlenen içeriği olan profiller burada görünür. İzle sekmesinden favori ve izlediklerini işaretledikçe liste dolar."* |
| **Neden bu çözüm** | Yeni ekran, yeni CTA, yeni yönlendirme bileşeni yok — yalnız copy. Aynı desen `match.screen.empty.watchMissing.description` içinde zaten var ve orada doğru çalışıyor. |

### F-3 — Profil kartındaki boş listeler de çıkışsızdı

| | |
|---|---|
| **Nerede** | `profile.card.empty.favorites.own`, `profile.card.empty.watched.own` |
| **Ne oluyordu** | *"Henüz favori içerik eklemedin."* — durum tespiti, yol yok. |
| **Düzeltme** | *"Henüz favori içerik eklemedin. İzle sekmesinden ekleyebilirsin."* |
| **Neden önemli** | Kullanıcı kendi profilini gördüğünde listesinin boş olduğunu fark ediyor. Bu, işaretlemeye başlamak için doğal bir an — ve tam o anda yol gösterilmiyordu. |

---

## 4. Boş durum denetimi — tam tablo

Uygulamada 13 boş durum metni var. İkiye ayrılıyorlar: kullanıcının **harekete geçebildiği** durumlar ve **bekleyebildiği** durumlar. İkincisinde pasif dil doğrudur; birincisinde değildir.

| Metin | Kullanıcı harekete geçebilir mi | Dil | Durum |
|---|:---:|---|---|
| `watch.current.empty.description` | Evet | *"...diyerek bu alanı doldurabilirsin."* | ✅ Zaten doğru |
| `match.screen.empty.watchMissing.description` | Evet | *"...önce üst çubuktan bir içeriği seç."* | ✅ Zaten doğru |
| `match.screen.empty.noPeers.description` | Evet (yenile) | *"İstersen aşağı kaydırıp yenileyebilirsin."* | ✅ Zaten doğru |
| `chat.modal.empty.description.start` | Evet | *"İlk mesajı göndererek sohbeti başlat."* | ✅ Zaten doğru |
| `blocked.empty.description` | Evet | *"İstersen buradan engeli kaldırabilirsin."* | ✅ Zaten doğru |
| `compatibility.empty.description` | **Evet** | Pasifti | 🔧 **Düzeltildi** |
| `profile.card.empty.favorites.own` | **Evet** | Pasifti | 🔧 **Düzeltildi** |
| `profile.card.empty.watched.own` | **Evet** | Pasifti | 🔧 **Düzeltildi** |
| `chat.screen.empty.description` | Hayır | *"Yeni bir eşleşme oluştuğunda..."* | ✅ Pasif doğru |
| `likes.empty.likedBy.title` | Hayır | *"Henüz seni beğenen yok"* | ✅ Pasif doğru |
| `profile.card.empty.other.description` | Hayır | Başkasının profili | ✅ Pasif doğru |
| `profile.card.empty.favorites.other` | Hayır | Başkasının profili | ✅ Pasif doğru |
| `profile.card.empty.watched.other` | Hayır | Başkasının profili | ✅ Pasif doğru |

**Sonuç:** Uygulamanın deseni zaten doğruydu, sadece üç yerde uygulanmamıştı. Yeni bir dil sistemi kurulmadı; var olan tutarlı hâle getirildi.

### Açık kalan: `likes.empty.description` tek anahtar, iki farklı durum

`LikesScreen` iki sekme gösteriyor — "Beğendiklerim" ve "Beni beğenenler" — ama ikisi de **aynı** açıklama anahtarını kullanıyor:

> *"Eşleşme akışında beğeniler oluştuğunda burada görünecek."*

Bu metin "Beni beğenenler" için doğru (kullanıcı bunu zorlayamaz), "Beğendiklerim" için eksik (kullanıcı gidip kaydırabilir).

**Düzeltilmedi, çünkü:** `LikesScreen.tsx` `check:visual-regression` tarafından byte düzeyinde dondurulmuş bir ekran girişi. İki ayrı anahtar, ekran dosyasında koşullu seçim gerektirir. Bir copy iyileştirmesi için dondurma sözleşmesine muafiyet açmak doğru takas değil.

**Feature freeze kalktığında yapılacak:** `likes.empty.liked.description` (yönlendirici) ve `likes.empty.likedBy.description` (pasif) olarak ayır.

---

## 5. Kullanılmayan davranışsal taktikler ve **neden kullanılmadıkları**

Bu bölüm, "neden şunu da yapmadınız" sorusuna önden cevaptır. Aşağıdakiler bilinen dönüşüm taktikleridir ve bilinçli olarak **reddedilmiştir**.

| Taktik | Neden reddedildi |
|---|---|
| İlerleme çubuğuna sahte tamamlanma yüzdesi ("Profilin %60 hazır") | Ürün dondurma sözleşmesi yeni bileşen yasaklıyor. Ayrıca %'yi keyfi belirlemek yanıltıcı. |
| "Şu an 128 kişi çevrimiçi" | Sahte sosyal kanıt. `claims-register.md` M-02 kapsamında **yasak**. |
| Boş Uyum ekranında sahte profil kartları göstermek | Sahte içerik. Ürünün en temel güven vaadini kırar. |
| İlk açılışta bildirim izni istemek | Prompt'un açık kuralı: izin yalnız kullanıcı-initiated bağlamda. Mevcut davranış zaten doğru. |
| "Devam etmek için arkadaş davet et" | Zorunlu davet — dark pattern yasağı. |
| Kayıt sırasında geri sayım / kıtlık | Sahte aciliyet — dark pattern yasağı. |
| Yeni bir "hoş geldin turu" ekranı | Yeni ekran/onboarding adımı yasak. Boş durumlar zaten yönlendiriyor. |
| Uyum oranını daha etkileyici göstermek için eğri uygulamak | Skoru olduğundan kesin göstermek. `positioning-and-messaging.md` §5'in doğrudan ihlali. |

**İlke:** Bu üründe dönüşümü artırmanın meşru yolu, kullanıcıya **daha erken gerçek değer göstermek**tir — ona baskı yapmak değil. Yukarıdaki taktiklerin hepsi kısa vadede sayı yükseltir, hepsi de retention ve store puanı pahasına.

---

## 6. Ölçüldüğünde bakılacaklar

`measurement-plan.md` funnel'ının bu analizle kesişen noktaları:

| Adım | Şüphe | Doğrulayacak sinyal |
|---|---|---|
| `install` → `onboarding_complete` | F-1: üç fotoğraf kapısı | Bu aralıktaki düşüş, diğer adımların hepsinden belirgin şekilde büyükse F-1 gerçek darboğazdır |
| `onboarding_complete` → `first_value_action` | Kullanıcı İzle sekmesinde ne yapacağını anlıyor mu | İlk oturumda en az 3 içerik işaretleyen kullanıcı oranı |
| `first_value_action` → `compatibility_viewed` | F-2 düzeltmesi işe yaradı mı | Uyum sekmesini açıp geri dönen ama işaretleme yapmayan kullanıcı oranı |
| `compatibility_viewed` → `first_like` | Liste yeterince doldu mu | Uyum listesi boş dönen istek oranı |

**Karar eşiği:** `measurement-plan.md` §4. Örneklem dolmadan hiçbiri hakkında karar verilmez.

---

## 7. Bu analizin sınırı

- Buradaki hiçbir oran ölçülmedi; ürün yayın öncesi.
- F-1 (üç fotoğraf) hakkındaki değerlendirme mekanizma analizidir, ölçüm değil. Gerçek düşüş verisi gelmeden kapı gevşetilmemeli — ve gevşetilmesi zaten ürün kararıdır, UX önerisi değil.
- Boş durum düzeltmelerinin etkisi ancak `first_value_action` oranı ölçülmeye başlayınca görülür.
- Gerçek cihazda VoiceOver/TalkBack ile bu akışın yürünmesi ayrı bir iştir; bkz. `../audit/ui-screen-state-matrix.md` §6.
