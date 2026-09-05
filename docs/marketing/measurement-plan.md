# WMatch — Ölçüm Planı

**Kısıt:** Uygulamaya yeni kullanıcı özelliği, yeni ekran veya yeni A/B framework'ü eklenmez. Ölçüm, **mevcut** araçlarla yapılır.

**Mevcut araç envanteri (doğrulanmış):**

| Araç | Sürüm | Durum |
|---|---|---|
| `@sentry/react-native` | `~7.11.0` | Kurulu — çökme ve performans |
| App Store Connect Analytics | — | Store tarafı, SDK gerektirmez |
| Google Play Console | — | Store tarafı, SDK gerektirmez |
| Supabase | — | Sunucu tarafı sayımlar |
| Cloudflare | — | Edge istek/gecikme (bkz. `docs/cloudflare-route-matrix.md`) |

**Eklenmeyen:** Amplitude, Mixpanel, Firebase Analytics, Segment, PostHog. Yalnız pazarlama ölçümü için ağır bir vendor SDK'sı eklemek, uygulama boyutunu, başlangıç süresini ve gizlilik yüzeyini büyütür; store gizlilik beyanını da genişletir. Aşağıdaki plan mevcut araçlarla kapanıyor.

---

## 1. Funnel

```
Gösterim (reklam / organik)
   │  ölçüm: kanal platformu
   ▼
Store sayfası görüntüleme
   │  ölçüm: App Store Connect · Play Console
   ▼
Yükleme
   │  ölçüm: App Store Connect · Play Console
   ▼
İlk açılış
   │  ölçüm: Sentry oturum sayısı
   ▼
Onboarding tamamlama  ── mevcut kayıt akışının bitişi
   │  ölçüm: Supabase — profiles satırı oluşumu
   ▼
İLK DEĞER: ilk favori/izlenen işaretleme
   │  ölçüm: Supabase — user_movies ilk satır
   ▼
Uyum listesinin dolması
   │  ölçüm: Supabase — compatibility endpoint çağrısı (Cloudflare log)
   ▼
İlk beğeni → İlk eşleşme → İlk mesaj
   │  ölçüm: Supabase — likes / matches / messages ilk satır
   ▼
D1 / D7 dönüş
      ölçüm: Sentry oturum + Supabase son aktivite
```

**Kritik nokta:** Bu ürünün gerçek "aha" anı eşleşme değil, **ilk favori işaretleme**dir. Liste boşken uyum sayfası boş kalır ve ürün hiçbir şey gösteremez. Bütün kampanya optimizasyonu yükleme yerine bu adıma bakar.

---

## 2. Olay tanımları

Hepsi **sunucu tarafında zaten var olan satırlardan** türetilir. İstemciye yeni izleme kodu eklenmez.

| Olay | Türetim kaynağı | Gizlilik notu |
|---|---|---|
| `install` | Store konsolu | Kişiye bağlı değil |
| `first_open` | Sentry oturum | Cihaz ID'si Sentry'nin kendi anonim ID'si |
| `onboarding_complete` | `profiles` satırı `created_at` | Kullanıcı ID'si hash'lenerek raporlanır |
| `first_value_action` | `user_movies` ilk satır (`type` ∈ {favorite, watched}) | İçerik adı raporlanmaz, yalnız sayım |
| `compatibility_viewed` | `/discovery/compatibility` istek sayısı (Cloudflare) | Yalnız toplam sayı |
| `first_like` | `likes` ilk satır | Hedef kullanıcı raporlanmaz |
| `first_match` | `matches` ilk satır | Taraf kimlikleri raporlanmaz |
| `first_message` | `messages` ilk satır | **Mesaj içeriği asla raporlanmaz** |
| `d1_return` / `d7_return` | Son aktivite zaman damgası | Toplu kohort, birey değil |
| `crash_free_sessions` | Sentry | — |
| `screen_ready_p95` | Sentry performans | — |

### Kesinlikle raporlanmayan

- Mesaj içeriği (tam veya kısmi)
- E-posta adresi
- Kesin konum veya koordinat
- Profil fotoğrafı URL'i veya imzalı bağlantı
- Access/refresh token veya bunların herhangi bir parçası
- Kimin kimi beğendiği / kimin kiminle eşleştiği

Bu liste `docs/security-incident-response.md` ve store gizlilik beyanıyla tutarlıdır.

---

## 3. Kampanya adlandırma ve attribution

**Adlandırma şeması** (store bağlantılarında):

```
wm_<kanal>_<angle>_<varyant>_<yyyymm>

örnek:  wm_reels_angle1_hook6s_202609
        wm_creator_angle2_static_202609
        wm_organic_angle3_storeimg_202609
```

| Store | Parametre | Not |
|---|---|---|
| App Store | `pt` / `ct` / `mt` (Apple Campaign Link) | `ct` alanına yukarıdaki şema yazılır |
| Google Play | `utm_source`, `utm_medium`, `utm_campaign` | `utm_campaign` alanına yukarıdaki şema |

**Gizlilik-güvenli attribution:** Cihaz düzeyinde reklam kimliği (IDFA / GAID) **kullanılmaz**. Ölçüm kampanya→yükleme düzeyinde toplu kalır. Bu, App Tracking Transparency istemini gereksiz kılıyor ve store gizlilik beyanındaki "Takip için kullanılıyor: Hayır" satırını doğru tutuyor. Kişi düzeyinde attribution'ın getireceği kesinlik, bu ölçekte ATT izin oranı düşüklüğü nedeniyle zaten elde edilemiyor.

---

## 4. Karar eşikleri

**Yeterli örneklem olmadan karar verilmez.** Aşağıdaki eşiklerin altında hiçbir kanal "kazandı/kaybetti" ilan edilmez.

| Karar | Minimum örneklem | Bekleme süresi |
|---|---|---|
| Kanal karşılaştırması | Kanal başına ≥ 300 store görüntüleme | ≥ 14 gün |
| Store görsel testi | ≥ 1000 store görüntüleme / varyant | ≥ 7 gün, tam hafta |
| Creative karşılaştırması | ≥ 200 yükleme / creative | ≥ 14 gün |
| Retention yorumu | ≥ 100 kullanıcılık kohort | D7 için ≥ 14 gün |

**Kalite freni:** Bir kanal yüklemeyi artırırken `first_value_action` oranını düşürüyorsa **kazanan sayılmaz**. Ürün için değersiz yükleme, maliyetli yüklemedir.

---

## 5. Store deneyleri

| Kural | |
|---|---|
| Baseline yoksa deney yok | En az 4 haftalık baseline dönüşüm oranı ölçülmeden test başlatılmaz. |
| Tek hipotez | Bir testte tek bir asset ailesi değişir (yalnız ilk 3 görsel **veya** yalnız subtitle). |
| Nerede | App Store Product Page Optimization; Play store-listing experiments. |
| Nerede değil | Uygulama içinde. Feature flag veya in-app A/B sistemi **eklenmez**. |
| Kazanan ilanı | Güven aralığı + downstream `first_value_action` karşılaştırması olmadan uygulanmaz. |

**İlk test önerisi (baseline oluştuktan sonra):** Kare 3 ("Ortak noktanızı gör") ile Kare 2'nin sırasını değiştirmek. Hipotez: farklılaştırıcıyı 2. sıraya almak store dönüşümünü artırır. Tek değişken, ölçülebilir, ürüne dokunmuyor.

---

## 6. Raporlama ritmi

| Sıklık | İçerik | Kaynak |
|---|---|---|
| Haftalık | Yükleme, store dönüşümü, `first_value_action` oranı, crash-free | Store konsolları + Supabase + Sentry |
| İki haftada bir | Kanal karşılaştırması (eşik dolduysa), D1/D7 kohort | Yukarıdakiler |
| Release başına | Funnel'ın tamamı, `claims-register.md` M-04 güncellemesi | Yukarıdakiler |

**Kural:** Rapordaki hiçbir sayı, ölçülmeden `claims-register.md`'ye `ONAYLI` olarak geçmez ve hiçbir pazarlama materyaline girmez.
