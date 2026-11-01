# Pixel Pipeline

Yandan çekilmiş videolardan **pixel art öğe paketi** (atlas + manifest) üreten Mac uygulaması ve komut satırı aracı.

*Turns side-view videos of a character or pet into a pixel art sprite package (one atlas + a manifest) with consistent palette, measured walk speed and ready-to-play poses. macOS app (SwiftUI) + Node CLI. No AI service is called: any video that follows the input rules works.*

Bir mobil uygulama için yapılan uçtan uca üretim denemesinden ("kurt testi") çıktı: video modelinden alınan doğal hareket, ortak piksel ızgarası ve ortak palete indirilerek küçük ve tutarlı bir pakete dönüştürülür.

## Ne verirsin, ne alırsın

**Girdi:** Her poz için bir video (mp4) ve pozun türü.

**Çıktı:** `build/<id>/` klasöründe
- `manifest.json`: pozlar, kare listeleri, fps, adım uzunluğu, hız, çapa noktası
- `<ad>-atlas.webp` + `<ad>-atlas.json`: tek atlas, kayıpsız, ortak palet
- `preview.html`: öğeyi sahnede oynatan, tek dosyalık önizleme
- `report.json`: ölçümler, paket boyutu, bellek, uyarılar

## Kurulum

Gerekenler: macOS 14+, Xcode (veya Command Line Tools), Node 20+.

```bash
git clone <repo> pixel-pipeline
cd pixel-pipeline
./scripts/build-app.sh
open "dist/Pixel Pipeline.app"
```

`build-app.sh` çekirdeğin bağımlılığını (`sharp`) kurar, video kare çıkarıcısını derler ve uygulamayı `dist/` içine paketler. Uygulama çekirdeği depo klasöründen çalıştırır; depoyu taşırsan uygulamanın Ayarlar penceresinden yeni yolu seç.

## Mac uygulaması

1. **Yeni öğe…** ile bir klasör oluştur (içine `item.json` ve `videos/` açılır).
2. **Öğe:** kimlik, ad, tür (pet / character), piksel genişliği, renk sayısı.
3. **Poz ekle:** her poz için videoyu sürükle-bırak, türünü seç, **İncele** ile kare sayfasını ve önerilen aralığı gör. Gerekirse aralığı elle ayarla.
4. **Davranış:** giriş (yürüyüş), varış sırası, dokunma tepkisi.
5. **Paketi oluştur:** rapor, uyarılar ve uygulama içinde canlı önizleme.

**Başlangıç karesi** aracı, çapa görselini video modeline verilecek 16:9 kareye dönüştürür.

## Komut satırı

```bash
cd core && npm install
node core/cli.mjs prep-start anchor.png start-16x9.png     # video modeli için başlangıç karesi
node core/cli.mjs inspect walk.mp4                         # kareler, kare sayfası, önerilen aralıklar
node core/cli.mjs make examples/shadow-wolf/item.json      # paket + preview.html + report.json
```

`--json` ile sonuç stdout'a JSON olarak yazılır, ilerleme stderr'e JSON satırları olarak gider (uygulama bunu kullanır).

## item.json

```json
{
  "id": "pet.shadow-wolf",
  "name": { "en": "Shadow Wolf", "tr": "Gölge Kurdu" },
  "type": "pet",
  "facing": "left",
  "pixelWidth": 172,
  "ptPerPixel": 1,
  "colors": 24,
  "poses": [
    { "name": "walk", "kind": "locomotion", "video": "videos/walk.mp4", "fps": 12 },
    { "name": "curl_up", "kind": "transition", "video": "videos/curl-up.mp4", "fps": 12 },
    { "name": "tail_wag", "kind": "reaction", "video": "videos/tail-wag.mp4", "startsFrom": "curl_up" },
    { "name": "sleep", "kind": "still", "from": "tail_wag", "frame": "first" }
  ],
  "behavior": { "enter": "walk", "arrive": ["curl_up", "sleep"], "onPress": "tail_wag" }
}
```

| Alan | Anlamı |
|---|---|
| `pixelWidth` | Referans pozun (ilk videolu poz) ilk karesindeki figürün sanat pikseli cinsinden genişliği. Izgara bundan hesaplanır. |
| `ptPerPixel` | 1 sanat pikseli kaç pt (1 = ince detay, 2 = kalın piksel). |
| `colors` | Ortak paletteki renk sayısı (tüm pozlar). |
| `fps` | 12 veya 8 (yavaş pozlar), ayrıca 6 ve 24. Kaynak her zaman 24 fps okunur. |
| `range` | İsteğe bağlı `[başlangıç, bitiş]`, 24 fps kaynak kare indeksleri. Verilmezse otomatik seçilir. |
| `startsFrom` | Sabit kameralı pozun başladığı poz. O pozun son karesinin konumundan devam eder. |

### Poz türleri

| Tür | Kamera | Otomatik seçim |
|---|---|---|
| `locomotion` | Takip eden | En temiz kapanan döngü; adım uzunluğu ve hız yere basan ayağın geri kaymasından ölçülür |
| `loop` | Sabit | En temiz kapanan döngü (boşta durma, nefes) |
| `transition` | Sabit | Hareketin başladığı kareden durduğu kareye (kıvrılma, oturma, açılış) |
| `reaction` | Sabit | İlk kareden, ilk duruşa en çok benzeyen kareye kadar (kuyruk/el sallama) |
| `still` | — | Başka bir pozun ilk ya da son karesi (uyku) |

## Videoların uyması gereken kurallar

- Düz, tek renk, açık arka plan; yandan görünüm; figür `facing` yönüne bakar; zemin gölgesi yok.
- Yürüyüşte **takip eden kamera** (figür kadrajın ortasında yerinde yürür); diğer pozlarda **sabit kamera**.
- Tüm videolar aynı başlangıç karesinden ya da bir önceki pozun son karesinden başlar (boyut ve konum tutarlılığı).
- Figürün altında ve çevresinde boşluk (kuyruk, kol savrulabilir).
- Ayırt edici detaylar (duman, saç) videonun sonuna kadar kalmalı. Video modeli promptuna bunu açıkça yazın.
- 360p yeterlidir; figür zaten düşük piksel çözünürlüğüne indirilir.

## Nasıl çalışır

1. `native/frames.swift` (AVFoundation) videodan 24 fps kare çıkarır ve kare sayfası yapar.
2. Arka plan kenardan taşma doldurmayla temizlenir; koyu kontur dolguyu durdurur.
3. Kareler ölçülür: döngü noktası, hareket aralığı, yere basan ayağın hızı.
4. Tüm pozların seçilen kareleri **tek piksel ızgarasına** ve **tek k-means paletine** indirilir (dithering yok, kırıntılar silinir).
5. Her kare çapa noktası ve zemin hattına göre yerleştirilir: takip eden kamerada her karenin en alt pikseli, sabit kamerada kameranın zemini; `startsFrom` ile pozlar birbirinin devamı olur.
6. Kareler kırpılır, tek atlasa paketlenir (kayıpsız WebP), manifest ve önizleme yazılır.

Bütçe: kare dizili öğeler için paket ≤500 KB, atlas kenarı ≤2048 piksel. Aşılırsa rapor uyarır.

## Klasörler

```
core/        Node çekirdeği (cli.mjs, lib/)
native/      Swift kare çıkarıcı (ilk kullanımda derlenir)
app/         SwiftUI Mac uygulaması (Swift Package)
scripts/     build-app.sh
examples/    örnek item.json (gölge kurdu)
```
