# WMatch — Pazarlama Paketi

Bu klasör, **mevcut ürünü doğru anlatmak** için vardır. Ürüne yeni özellik, ekran veya davranış eklemez.

**Candidate:** `1.0.51` · iOS build `55` · Android versionCode `53`
**Son gözden geçirme:** 2026-09-04

---

## Okuma sırası

| # | Dosya | Ne işe yarar |
|---|---|---|
| 1 | [`claims-register.md`](claims-register.md) | **Önce bu.** Hangi iddianın kanıtı var, hangisi yasak. Diğer bütün dosyalar buraya bağlı. |
| 2 | [`positioning-and-messaging.md`](positioning-and-messaging.md) | Tek cümlelik konum, mesaj hiyerarşisi, segmentler, marka sesi, uyum oranını anlatma protokolü. |
| 3 | [`store-listing-tr.md`](store-listing-tr.md) | App Store ve Play için birebir kullanılacak metinler, karakter sayıları, gizlilik beyanı tabloları. |
| 4 | [`screenshot-storyboard.md`](screenshot-storyboard.md) | 6 store karesi, hangi ekran, hangi başlık, hangi durum, export adları. |
| 5 | [`ad-creative-briefs.md`](ad-creative-briefs.md) | 3 doğrulanabilir reklam angle'ı; 6 sn hook, 15 sn akış, static varyant, ölçülecek metrik. |
| 6 | [`go-to-market-plan.md`](go-to-market-plan.md) | Kanal önceliği, aşamalar, çıkış kriterleri, risk tablosu. |
| 7 | [`measurement-plan.md`](measurement-plan.md) | Funnel, olay tanımları, attribution, karar eşikleri. Yeni SDK eklenmiyor. |
| 8 | [`pitch-deck-outline-tr.md`](pitch-deck-outline-tr.md) | 10 slaytlık sunum iskeleti ve deck tasarım sistemi. |

---

## Değişmez kurallar

1. **Kaydı olmayan iddia yayınlanmaz.** Her cümle `claims-register.md`'de bir satıra bağlıdır.
2. **Her ekran gerçektir.** Store, reklam ve deck'te görünen her arayüz candidate build'de vardır. Mockup'ta arayüz çizilmez.
3. **Sayı uydurulmaz.** Kullanıcı sayısı, eşleşme oranı, kapasite iddiası ölçülmeden söylenmez. Ölçülmemişse "henüz ölçülmedi" yazılır.
4. **Uyum oranı bir ölçüm, tahmin değil.** "Bilimsel uyum", "yapay zekâ", ilişki vaadi hiçbir materyalde geçmez.
5. **Dark pattern yok.** Sahte aciliyet, sahte sosyal kanıt, zorunlu davet, korku/yalnızlık sömürüsü, yanıltıcı bildirim.
6. **Materyal, ürün değişikliği gerekçesi değildir.** Bir reklam fikri için üretim arayüzü değiştirilmez.

---

## Yayın öncesi kapatılması gerekenler

| # | Madde | Engellediği şey |
|---|---|---|
| P-05 | Hesap silme akışının candidate build'de doğrulanması | Play Data Safety formu tamamlanamıyor → gönderim yapılamaz |
| — | Ekran görüntülerinin `1.0.51` build'inden alınması | Store görselleri üretilemiyor |
| — | Sentry'nin canlı olay aldığının doğrulanması | Baseline ölçümü başlayamıyor |

Ayrıntı: [`../MANUAL_STEPS.md`](../MANUAL_STEPS.md)

---

## İlgili denetimler

| Dosya | İlişki |
|---|---|
| [`../audit/ui-ux-contrast-audit.md`](../audit/ui-ux-contrast-audit.md) | Deck ve store görsellerinde kullanılan renk kontrastlarının ölçümü |
| [`../existing-feature-contract.md`](../existing-feature-contract.md) | Materyalde anlatılabilecek yüzeyin sınırı |
| [`../../quality/feature-surface.snapshot.json`](../../quality/feature-surface.snapshot.json) | İddiaların makine tarafından doğrulanabilir kaynağı |
