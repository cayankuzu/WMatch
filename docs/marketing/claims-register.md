# WMatch — İddia Kayıt Defteri (Claims Register)

**Kapsam:** Store listing, reklam, sunum ve basın materyallerinde kullanılabilecek her iddia.
**Kural:** Bu dosyada kaydı olmayan iddia yayınlanmaz. Kanıt sütunu boş olan satır `TASLAK` kalır ve dışarı çıkmaz.
**Son gözden geçirme:** 2026-09-04 · **Sahip:** Cayan Kuzu
**Bağlı candidate:** `app.json` version `1.0.51`, iOS build `55`, Android versionCode `53`

---

## Nasıl okunur

| Sütun | Anlamı |
|---|---|
| Durum | `ONAYLI` = yayınlanabilir · `TASLAK` = kanıt bekliyor · `YASAK` = kullanılamaz |
| Kanıt | Repository'deki dosya/fonksiyon veya çalıştırılmış ölçüm. "Öyle hissettiriyor" kanıt değildir. |
| İzin verilen ifade | Birebir kullanılacak Türkçe cümle. Kelime değiştirmek yeni bir kayıt gerektirir. |

---

## 1. Ürün işlevi iddiaları

| # | İddia | Durum | Destekleyen yüzey | Kanıt | İzin verilen ifade | Yasak abartı |
|---|---|---|---|---|---|---|
| F-01 | Uygulama, kullanıcının favori ve izlediği film/dizileri kaydetmesine izin verir. | ONAYLI | `WatchScreen.tsx`, `MovieDetailModal.tsx`, `public.user_movies` tablosu (`type` = `favorite` \| `watched`) | `quality/feature-surface.snapshot.json` → `screenEntrypoints`, `modalEntrypoints` | "Favorilerini ve izlediklerini işaretle." | "Tüm izleme geçmişini otomatik içe aktarır." (İçe aktarma yok.) |
| F-02 | Profiller, ortak film/dizi oranına göre sıralanabilir. | ONAYLI | `CompatibilityScreen.tsx`, `CompatibilitySheet.tsx` | `public.calculate_discovery_compatibility_score` — ağırlıklı Jaccard: `0.65 × (ortak favori / favori birleşimi) + 0.35 × (ortak izlenen / izlenen birleşimi)` | "Profiller, seninle ortak favori ve izlenen içerik oranına göre sıralanır." | "Sana en uygun kişiyi bulur." · "Kişilik analizi yapar." |
| F-03 | Uyum yüzdesi, iki kullanıcının listelerinin kesişim oranıdır. | ONAYLI | `CompatibilitySheet.tsx` → ortak favori / ortak izlenen listesi | `calculate_discovery_compatibility_score` gövdesi; `getCompatibilityStyle()` eşikleri 85 / 70 / 55 / 35 | "Uyum oranı, listelerinizin ne kadar örtüştüğünü gösterir." | "Bilimsel uyumluluk skoru." · "İlişki başarısını öngörür." |
| F-04 | Kart akışında beğen / geç hareketi ve geri alma vardır. | ONAYLI | `SwipeModal.tsx`, `SwipeActionRail.tsx`, `SwipeUndoPlaceholder.tsx` | `quality/feature-surface.snapshot.json` | "Beğen, geç, yanlışlıkla kaydırdıysan geri al." | "Sınırsız kaydırma." (Kota var — bkz. F-09.) |
| F-05 | Karşılıklı beğeni eşleşme üretir ve sohbeti açar. | ONAYLI | `MatchScreen.tsx`, `MatchSuccessModal.tsx`, `ChatScreen.tsx`, `ChatModal.tsx` | `notificationTypes` → `match`, `message`; like→match trigger migration'ı | "Karşılıklı beğendiğinizde sohbet açılır." | "Garantili eşleşme." · "Her gün yeni eşleşme." |
| F-06 | Keşif filtreleri yaş, mesafe, cinsiyet tercihi ve uyum aralığı içerir. | ONAYLI | `DiscoveryFiltersModal.tsx` | `feature-surface.snapshot.json` → `discoveryFilterFields` (7 alan), `discoveryGenderFilters` (4 değer) | "Yaş, mesafe, cinsiyet tercihi ve uyum aralığına göre filtrele." | "Yüzlerce filtre." (7 alan var.) |
| F-07 | Kullanıcı, başka bir kullanıcıyı engelleyebilir ve şikâyet edebilir. | ONAYLI | `BlockedUsersModal.tsx`, `ChatSettingsModal.tsx`, `ProfileViewer.tsx` | `notificationTypes` → `chat_blocked`, `chat_unblocked`; `domains/moderation.ts` | "Rahatsız eden bir hesabı engelle veya şikâyet et." | "Tamamen güvenli." · "Sahte hesap yoktur." |
| F-08 | Sohbet çevrimdışıyken yazılan mesaj kuyruğa alınır ve bağlantı dönünce gönderilir. | ONAYLI | `ChatModal.tsx` outbox | `tests/components/chat-outbox.test.tsx` (PASS) | "İnternet gidip geldiğinde mesajın kaybolmaz." | "Her koşulda anında teslim." |
| F-09 | Günlük kaydırma kotası vardır ve kalan hak ekranda gösterilir. | ONAYLI | `SwipeQuotaBar.tsx` | `20260609024500_swipe_quotas.sql`, `20260611120000_swipe_quota_atomic_functions.sql` | "Günlük kaydırma hakkın ekranda görünür." | Kotayı gizlemek veya "sınırsız" demek. |

## 2. Gizlilik ve veri iddiaları

| # | İddia | Durum | Kanıt | İzin verilen ifade | Yasak abartı |
|---|---|---|---|---|---|
| P-01 | Konum yalnızca mesafe filtresi için ve yalnız uygulama kullanılırken istenir. | ONAYLI | `app.json` → `NSLocationWhenInUseUsageDescription`; `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION`; arka plan konum izni **yok** | "Konumunu yalnızca mesafe filtresi için, yalnız uygulamayı kullanırken isteriz." | "Konumunu hiç kullanmıyoruz." |
| P-02 | Kesin konum başka kullanıcılara açılmaz; ayrı bir özel tabloda tutulur. | ONAYLI | `20260714120000_profile_private_location_boundary.sql` → `profiles_private` | "Kesin konumun diğer kullanıcılara gösterilmez." | "Konumun hiçbir yerde saklanmaz." |
| P-03 | Profil fotoğrafları özel Storage'da tutulur ve kısa ömürlü imzalı bağlantıyla sunulur. | ONAYLI | `20260714103000_public_api_security_and_storage_hardening.sql`; `AppImage.tsx` cache policy | "Fotoğrafların herkese açık bir adreste durmaz." | "Fotoğrafların hiç kimseye gösterilmez." |
| P-04 | Bildirim izni, kullanıcının kendi eylemi sonrası istenir. | ONAYLI | `POST_NOTIFICATIONS`; `docs/push-current-contract.md` | "Bildirim iznini sen açana kadar istemiyoruz." | Otomatik izin baskısı ima etmek. |
| P-05 | Hesap silme desteklenir. | TASLAK | `test:edge:account-deletion` var; kullanıcıya görünen akışın candidate build'de doğrulanması gerekiyor | — (doğrulanana kadar yayınlanmaz) | — |

## 3. Ölçüm ve büyüklük iddiaları

| # | İddia | Durum | Neden |
|---|---|---|---|
| M-01 | Kullanıcı sayısı, indirme sayısı, aktif kullanıcı | **YASAK** | Ölçülmüş veri yok. Store'da yayın öncesi hiçbir sayı söylenmez. |
| M-02 | "Binlerce film severe katıl" / "X kişi seni beğendi" | **YASAK** | Sahte sosyal kanıt. Prompt'un dark-pattern yasağı kapsamında. |
| M-03 | Eşleşme başarı oranı, sohbete dönüşüm oranı | **YASAK** (şimdilik) | Ölçüm altyapısı için bkz. `measurement-plan.md`. D1/D7 gerçek veriyle ölçülene kadar hiçbir oran söylenemez. |
| M-04 | Kilitlenmesiz oturum oranı (crash-free) | TASLAK | Sentry bağlı; yayından sonra 14 gün veri birikince `ONAYLI`ya çekilir, sayı yazılır. |
| M-05 | "10.000 eşzamanlı kullanıcı destekler" | **YASAK** | Deterministik mock üzerindeki k6 sonucu kapasite kanıtı değildir. Hosted staging ölçümü olmadan söylenmez. |

## 4. Kesin yasaklar (hiçbir koşulda kullanılmaz)

- "En iyi", "Türkiye'nin ilk/tek", "%X daha fazla eşleşme" — karşılaştırmalı kanıt yok.
- "Yapay zekâ destekli" — uyum skoru bir küme kesişim oranıdır, model değildir.
- "Bilimsel olarak kanıtlanmış uyum" — F-03'ün doğrudan ihlali.
- "Güvenli", "%100 güvenli", "sahte hesap yok" — engelleme/şikâyet vardır, garanti yoktur.
- Sahte ekran görüntüsü, sahte sohbet, sahte profil fotoğrafı, sahte puan/yorum.
- Sahte aciliyet ("son 3 saat"), sahte kıtlık, yalnızlık üzerinden korku mesajı.
- Rakip uygulama adı üzerinden karşılaştırma veya karalama.

## 5. Gözden geçirme ritmi

| Ne zaman | Ne yapılır |
|---|---|
| Her release candidate | Tüm `ONAYLI` satırların kanıt yolu hâlâ var mı — `quality/feature-surface.snapshot.json` ile karşılaştır. |
| Kanıt dosyası taşındı/silindi | İddia otomatik `TASLAK`a düşer, materyalden çıkarılır. |
| Yeni iddia talebi | Önce bu tabloya satır eklenir, kanıt bağlanır, sonra tasarıma girer. |

> Bu defterin amacı pazarlamayı kısıtlamak değil: kanıtı olan iddiayı çekinmeden, yüksek sesle söyleyebilmek. Kanıtlı üç cümle, kanıtsız on cümleden daha çok satar ve store reddi getirmez.
