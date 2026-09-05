# WMatch — Docker Validation Tekrarlanabilirlik Engeli

**Tarih:** 2026-09-05 · **Durum:** AÇIK, ürün sahibi kararı bekliyor
**Etkilenen gate:** `Docker validation` → `reproducibilityAndSmoke`
**Yeniden üretim:** Bu belgedeki her ölçüm yerel Docker 29.6.2 (containerd image store) üzerinde alındı.

---

## 1. Kısa hâli

Docker validation workflow'u aynı kaynaktan iki kez imaj kuruyor ve image ID'lerinin **birebir aynı** olmasını şart koşuyor:

```bash
test "$IMAGE_A_ID" = "$IMAGE_B_ID"
```

Bu koşul, mevcut Dockerfile ile **hiçbir zaman sağlanamaz**. Sebep imaj kurulumunda ya da workflow'da değil, Deno'nun modül cache formatında.

Bu engel bugüne kadar görünmüyordu çünkü workflow daha önceki bir adımda — var olmayan bir Buildx sürümünü indirmeye çalışırken — kırılıyordu ve tekrarlanabilirlik adımı hiç çalışmıyordu. Buildx pin'i `da6cc16` ile düzeltilince bu engel ortaya çıktı.

---

## 2. Kök sebep

`Dockerfile.tooling` içindeki şu adım, edge testlerinin ağsız çalışabilmesi için Deno modüllerini imaja gömüyor:

```dockerfile
ENV DENO_DIR=/opt/wmatch-deno-cache
RUN ./node_modules/.bin/deno cache --frozen --node-modules-dir=manual ...
```

Deno, indirdiği her modülü `$DENO_DIR/remote/https/jsr.io/<url-hash>` altına yazarken dosyanın **sonuna, HTTP yanıtının tüm başlıklarını içeren bir JSON kuyruğu** ekliyor.

Aynı modülün iki ayrı build'deki kuyruğu:

```
A: ..."content-encoding":"identity","cf-ray":"a363f4a13b8b1e43-FCO","age":"131517",
      "content-type":"text/typescript"},"url":"https://jsr.io/@supabase/supabase-js/
      2.107.0/src/_internal/tracing/index.ts","time":1788596833}

B: ..."cf-ray":"a363fbd38e24ea5f-FCO","cf-cache-status":"HIT","x-jsr-backend":"modules",
      "x-robots-tag":"noindex","age":"131812"},"url":"https://jsr.io/@supabase/supabase-js/
      2.107.0/src/_internal/tracing/index.ts","time":1788597107}
```

Modül gövdesi baytı baytına aynı. Değişen, yalnız kuyruk:

| Alan | Neden her istekte farklı |
|---|---|
| `cf-ray` | Cloudflare'in istek başına ürettiği benzersiz kimlik |
| `age` | CDN'deki nesnenin o andaki yaşı, saniye cinsinden |
| `cf-cache-status` | `HIT`/`MISS`, edge durumuna göre |
| `x-jsr-backend`, `x-robots-tag`, `content-encoding` | Yanıttan yanıta bulunup bulunmaması değişiyor |
| `time` | Deno'nun fetch zaman damgası |

**Ölçüm:** 77 cache dosyasının **18'i** yalnız bu sebeple farklı.

---

## 3. Denenen ve yetmeyen çözüm

`time` alanını sabit 10 haneli bir değere çekmeyi denedim (bayt uzunluğu korunacak şekilde). 18 dosyanın 18'i de normalize oldu, **ama imajlar hâlâ farklı çıktı** — çünkü `cf-ray` ve `age` kalıyor.

Bunları da silmek, Deno'nun sakladığı yanıt başlıklarının neredeyse tamamını atmak demek; cache doğrulamasını Deno sürümüne sıkı sıkıya bağlı, kırılgan bir sed zincirine emanet eder. Yapmadım.

### Denenip **tutulan** kısım

SQLite'ın `*-wal` ve `*-shm` dosyaları siliniyor. Bunlar geçici sayfa durumu tutuyor, iki çalıştırmada asla aynı olmuyor ve deno çıktıktan sonra cache'in ihtiyacı olan bir şey taşımıyorlar.

Farkı 22 dosyadan 18'e indiriyor — tek başına yetmiyor ama doğru bir temizlik ve imajdan geçici çöp çıkarıyor.

**Doğrulandı:** silme sonrası edge test paketi **ağ kapalıyken** geçiyor:

```
docker run --rm --network none ... npm run test:edge:hmac
ok | 9 passed | 0 failed
```

---

## 4. Seçenekler

Bu bir ürün/altyapı kararı; tek taraflı seçilmemeli.

| # | Seçenek | Artı | Eksi |
|---|---|---|---|
| A | **Deno bağımlılıklarını repoya vendor'la** (`deno vendor`) | Gerçek tekrarlanabilirlik; HTTP metadata'sı hiç oluşmaz; ağsız çalışır | Repoya vendor'lanmış kaynak girer; güncelleme akışı değişir |
| B | **`DENO_DIR`'i imajdan çıkar**, cache'i container başlangıcında kur | Dockerfile sadeleşir | Test zamanı ağ gerekir; determinizm ve offline garantisi kaybolur |
| C | **Tekrarlanabilirlik karşılaştırmasını `DENO_DIR` hariç yap** | Gate yeşile döner | **Gate'i zayıflatır.** Prompt'un "threshold düşürme yok" kuralına aykırı; önerilmez |
| D | **Kuyruktaki oynak başlıkları agresif normalize et** | Dockerfile'da kalır | Deno sürümüne sıkı bağlı, kırılgan; cache doğrulamasını bozma riski |

**Öneri: A.** Tek gerçek çözüm bu; diğerleri ya kanıtı zayıflatıyor ya da kırılgan.

---

## 5. Bu arada Docker validation ne durumda

| Gate | Durum |
|---|---|
| Buildx/BuildKit kurulumu | ✅ `da6cc16` ile düzeldi (`v0.36.1`, BuildKit `v0.32.2` digest doğrulandı) |
| Builder driver/attestation kanıtı | ✅ Eklendi, bootstrap ediliyor ve doğrulanıyor |
| `provenance` / `sbom` | ✅ Açık, kapatılmadı |
| Manifest gate assertion | ✅ Eklendi; `skipped`/`failure` artık PASS sayılmıyor |
| **`reproducibilityAndSmoke`** | ❌ **Bu belgedeki engel** |
| Sonraki gate'ler | ⏸ Yukarıdaki kırıldığı için çalışmıyor |

Docker validation, bu karar verilip uygulanana kadar **kırmızı kalacak**. Prompt'un kuralı gereği bu, merge için NO-GO demek.

---

## 6. Not

Bu engeli "geçici olarak" kapatmak için tekrarlanabilirlik karşılaştırmasını gevşetmek cazip görünebilir. Gevşetilirse, gate'in ölçtüğü tek şey — aynı kaynağın aynı imajı ürettiği — ortadan kalkar ve geriye yeşil bir rozetten başka bir şey kalmaz. Kırmızı bırakıp sebebini yazmak, yeşil yapıp anlamını boşaltmaktan iyidir.
