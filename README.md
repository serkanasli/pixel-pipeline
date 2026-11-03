# Pixel Pipeline

Yandan çekilmiş videolardan **pixel art öğe paketi** (atlas + manifest) üreten yerel web arayüzü ve komut satırı aracı.

*Turns side-view videos of a character, pet or object into a pixel art sprite package (one atlas + a manifest) with one palette, measured walk speed and ready-to-play poses. A local web UI and a CLI over the same core; Node + ffmpeg, runs on macOS and Linux. No AI service is called: the tool prepares the start frame and the prompt for each video, any video model can make the video.*

Uçtan uca bir üretim denemesinden ("kurt testi") çıktı: video modelinden alınan doğal hareket, ortak piksel ızgarasına ve ortak palete indirilerek küçük ve tutarlı bir pakete dönüştürülür. Araç öğeden bağımsızdır. Yürüyen bir hayvan, yerinde duran bir karakter ya da başka bir öğe aynı kodla, yalnızca planı değişerek üretilir.

Aynı öğe klasörleri üzerinde iki taraf çalışır: bir kişi tarayıcıdaki arayüzden, bir yapay zekâ ajanı komut satırından. Ortak gerçek kaynak, klasördeki dosyalardır.

## Ne verirsin, ne alırsın

**Girdi:** bir çapa görseli, bir poz planı (şablondan) ve her poz için bir video.

**Çıktı:** öğe klasöründe `build/<id>/` altında
- `manifest.json`: pozlar, kare listeleri, fps, adım uzunluğu, hız, çapa noktası, davranış
- `<ad>-atlas.webp` + `<ad>-atlas.json`: tek atlas, kayıpsız, ortak palet
- `preview.html`: öğeyi sahnede oynatan, tek dosyalık önizleme
- `report.json`: ölçümler, paket boyutu, bellek, uyarılar

## Kurulum

Gerekenler: **Node 20+** ve **ffmpeg** (ffprobe ile birlikte gelir).

```bash
brew install ffmpeg          # macOS
sudo apt install ffmpeg      # Debian / Ubuntu
```

```bash
git clone <repo> pixel-pipeline
cd pixel-pipeline
npm install
npm start                    # http://127.0.0.1:4317/
```

Sunucu yalnızca `127.0.0.1`'e bağlanır. Port: `npm start -- --port 5000` ya da `PORT=5000 npm start`. İlk açılışta arayüz **çalışma klasörünü** sorar (öğelerin bulunduğu klasör). Bu ayar depo dışındaki `config.local.json` dosyasında tutulur.

Tek bağımlılık `sharp`'tır. Yerel ikili dosyası olmayan platformlarda `@img/sharp-wasm32` yedeğiyle çalışır.

## Öğe klasörü

```
<çalışma klasörü>/
  shadow-wolf/
    item.json          öğe ve poz planı
    anchor.png         çapa görseli
    start-frames/      video modeline verilecek başlangıç kareleri (<poz>.png + <poz>.json)
    videos/            pozların videoları (<poz>.mp4 adıyla kaydetmek yeterli)
    build/<id>/        paket
    logs/              günlük log dosyaları (YYYY-MM-DD.log)
    .pixel-cache/      çıkarılmış kareler ve ölçümler
```

Bir pozun videosu `item.json`'daki `video` alanıdır. Alan yoksa `videos/<poz adı>.<mp4|mov|m4v|webm>` kullanılır. Bu yüzden videoyu o adla kaydetmek yeterlidir: arayüz, komut satırı ya da Finder ile eklenen dosya hemen görünür.

## Akış

Her pozun videosu, aracın o poz için hazırladığı **başlangıç karesinden** üretilir. Zincirdeki bir poz, bağlı olduğu pozun seçilen karesinden başlar. Bu nedenle videolar sırayla gelir:

1. **Yeni öğe:** kimlik, çapa görseli, plan şablonu ve pozlar, prompt alanları (öğe tarifi, kalıcı detaylar, stil cümlesi). Elde hazır video varsa burada bırakılabilir.
2. **Her poz için, zincir sırasıyla:**
   1. *Başlangıç karesi:* çapadan (`below`, `maxFigure` ayarlarıyla) ya da bağlı pozun seçilen karesinden hazırlanır.
   2. *Video promptu:* öğeden doldurulmuş hazır metin.
   3. *Video:* başlangıç karesi ve promptla üretilip bırakılır.
   4. *Aralık:* kare sayfasında önerilen aralık işaretlidir. Başlangıç ve bitiş tıklanarak seçilir; seçim pozun fps'iyle canlı oynar. Yürüme pozlarında adım uzunluğu ve hız gösterilir.
3. **Paket:** rapor, uyarılar, bütçe ve sayfa içinde önizleme.

Arayüzde her sayfanın üstünde adım çubuğu ve tek bir "Sıradaki adım" bandı, altında canlı log paneli bulunur. Bağlı pozun aralığı değişirse sonraki pozun başlangıç karesi **eski** olarak işaretlenir. Paket oluşturulduktan sonra `item.json` ya da videolar değişirse paket de eski görünür.

## Komut satırı

Arayüzün yaptığı her iş komut satırından da yapılır. İkisi aynı çekirdek fonksiyonlarını çağırır ve aynı log dosyasına yazar.

```bash
node core/cli.mjs templates                                          # plan şablonları
node core/cli.mjs init items/fox --template walking-pet --anchor fox.png [--id pet.fox]
node core/cli.mjs status items/fox/item.json                         # her pozun aşaması ve sıradaki adım
node core/cli.mjs start-frame items/fox/item.json walk               # start-frames/walk.png
node core/cli.mjs prompt items/fox/item.json walk                    # video promptu
node core/cli.mjs inspect items/fox/item.json walk                   # kareler, kare sayfası, önerilen aralık
node core/cli.mjs inspect any-video.mp4                              # öğe dışında bir videoyu incele
node core/cli.mjs set-range items/fox/item.json walk 42 74           # aralığı seç (24 fps kaynak kareleri)
node core/cli.mjs make items/fox/item.json                           # paket + preview.html + report.json
```

`--json` ile sonuç stdout'a JSON olarak yazılır, ilerleme stderr'e JSON satırları olarak gider. Bir ajan için döngü şudur: `status` ile sıradaki adımı oku, onu yap (başlangıç karesi, prompt, videoyu `videos/<poz>.mp4` olarak kaydet, `set-range`), tekrar `status`.

## item.json

```json
{
  "schemaVersion": 2,
  "id": "pet.shadow-wolf",
  "name": { "en": "Shadow Wolf", "tr": "Gölge Kurdu" },
  "type": "pet",
  "facing": "left",
  "template": "walking-pet",
  "anchor": "anchor.png",
  "subject": "a slate-grey shadow wolf with a shaggy dark mane, amber eyes and dark smoke wisps",
  "persistentDetails": ["the dark smoke wisps trailing from the mane, back and tail", "the amber eyes"],
  "style": "Pixel art, crisp square pixels, no anti-aliasing, no blur, no gradients, limited palette.",
  "pixelWidth": 172,
  "ptPerPixel": 1,
  "colors": 24,
  "poses": [
    { "name": "walk", "kind": "locomotion", "fps": 12, "startsFrom": "anchor", "motion": "It walks at a calm, steady pace…", "range": [42, 74] },
    { "name": "curl_up", "kind": "transition", "fps": 12, "startsFrom": { "pose": "walk", "frame": "first" }, "motion": "It stops walking, lies down…" },
    { "name": "tail_wag", "kind": "reaction", "fps": 12, "startsFrom": { "pose": "curl_up", "frame": "last" }, "motion": "Still curled up…" },
    { "name": "sleep", "kind": "still", "startsFrom": { "pose": "tail_wag", "frame": "first" } }
  ],
  "behavior": { "enter": "walk", "arrive": ["curl_up", "sleep"], "onPress": "tail_wag" }
}
```

| Alan | Anlamı |
|---|---|
| `id`, `type` | `id` = `<type>.<kebab-case>`; ikisinin türü aynı olmalı. |
| `facing` | Figürün baktığı yön: `left` ya da `right`. |
| `anchor` | Çapa görseli (öğe klasöründe PNG ya da JPG). |
| `subject` | Öğenin kısa İngilizce tarifi; her video promptuna girer. |
| `persistentDetails` | Videonun sonuna kadar kalması gereken detaylar (duman, saç, göz rengi). |
| `style` | Öğenin sabit stil cümlesi; bütün promptlarında aynen kullanılır. |
| `pixelWidth` | Referans pozun ilk oynatılan karesindeki figürün sanat pikseli cinsinden genişliği. Izgara bundan hesaplanır. |
| `ptPerPixel` | 1 sanat pikseli kaç pt (1 = ince detay, 2 = kalın piksel). |
| `colors` | Ortak paletteki renk sayısı (bütün pozlar). |
| `referencePose` | İsteğe bağlı: ızgaranın ölçüldüğü poz. Verilmezse videosu olan ilk poz. |

**Poz alanları**

| Alan | Anlamı |
|---|---|
| `kind` | `locomotion`, `loop`, `transition`, `reaction` ya da `still`. |
| `fps` | 12, 8, 6 ya da 24. Kaynak her zaman 24 fps okunur; poz her 2., 3. ya da 4. kareyi alır. |
| `startsFrom` | `"anchor"` ya da `{ "pose": "<ad>", "frame": "first" \| "last" \| <kaynak kare> }`. Hem başlangıç karesini hem de pakette yerleşimi belirler: poz, o karenin konumundan devam eder. |
| `motion` | Hareketin kısa İngilizce tarifi; video promptuna girer. |
| `video` | İsteğe bağlı; verilmezse `videos/<ad>.mp4` (ya da `.mov`, `.m4v`, `.webm`). |
| `range` | `[başlangıç, bitiş]`, 24 fps kaynak kare indeksleri. Döngülerde bitiş, başlangıçla eşleşen karedir (oynatılmaz) ve aralık adım sayısının katıdır. Verilmezse paket önerilen aralıkla yapılır. |
| `start` | Başlangıç karesi: `below` (altta boşluk, 0–0,6), `maxFigure` (figürün en büyük yüksekliği, 0,1–1), `width`, `height` (varsayılan 1600×900). `below` ve `maxFigure` yalnızca çapadan başlayan pozlarda geçerlidir. |

**Davranış (`behavior`)**

| Alan | Anlamı |
|---|---|
| `enter` | Giriş: öğe bu yürüme pozuyla gelir. |
| `arrive` | Varış sırası; sonuncusu dinlenme pozudur. |
| `onPress` | Dokunma tepkisi; oynar ve dinlenme pozuna döner. |
| `occasional` | Dinlenirken arada oynayan pozlar: `"blink"` ya da `{ "pose": "blink", "weight": 1, "wait": [5, 12] }` (bekleme saniye cinsinden). Manifest'e her zaman tam nesne olarak yazılır. |

Doğrulayıcı bilinmeyen alanları reddeder ve hangi alanın neden yanlış olduğunu söyler.

### Poz türleri

| Tür | Kamera | Otomatik öneri |
|---|---|---|
| `locomotion` | Takip eden | En temiz kapanan döngü; adım uzunluğu ve hız yere basan ayağın geri kaymasından ölçülür. |
| `loop` | Sabit | En temiz kapanan döngü (boşta durma, nefes). |
| `transition` | Sabit | Hareketin başladığı kareden durduğu kareye (kıvrılma, oturma, açılış). |
| `reaction` | Sabit | İlk kareden, ilk duruşa en çok benzeyen kareye kadar (kuyruk sallama, el sallama, göz kırpma). |
| `still` | — | Başka bir pozun ilk, son ya da belirli bir karesi (uyku). |

## Plan şablonları

`templates/plans/*.json` dosyalarında veri olarak durur. Kodda öğeye ya da şablona özel bir kural yoktur. Yeni bir şablon için bir JSON dosyası eklemek yeterlidir.

- **walking-pet:** `walk` (çapadan) → `curl_up` (walk'un ilk karesinden) → `tail_wag` (curl_up'ın son karesinden) → `sleep` (tail_wag'ın ilk karesi). Giriş `walk`, varış `curl_up` → `sleep`, dokunma `tail_wag`.
- **character:** `idle` döngüsü (çapadan), `blink` (idle'ın ilk karesinden), `open_app` (çapadan), `on_press` (idle'ın ilk karesinden). Varış `open_app` → `idle`, ara hareket `blink`, dokunma `on_press`.

Şablon seçildikten sonra pozlar eklenip çıkarılabilir, sıraları ve alanları değiştirilebilir.

## Video promptu

`templates/video-prompt.json` genel şablondur. Yer tutucular: `{{style}}`, `{{subject}}`, `{{motion}}`, `{{camera}}`, `{{facing}}`, `{{details}}`, `{{background}}`. Kamera cümlesi poz türünden gelir (`locomotion`: takip eden kamera, figür yerinde yürür; diğerleri: sabit kamera). Kalıcı detay cümlesi zorunludur: *"These details stay in every frame until the very end, never fading or disappearing: …"*. Arka plan rengi başlangıç karesinden ölçülür.

Not: Video modellerinin güvenlik filtreleri bazı masum kalıplarda isteği reddedebiliyor ("toward the camera", "below the paws" gibi). Şablon bu kalıplardan kaçınır; şablonu ya da `motion` metinlerini düzenlerken de bunlardan kaçının.

## Videoların uyması gereken kurallar

- Düz, tek renk, açık arka plan; yandan görünüm; figür `facing` yönüne bakar; zemin gölgesi yok.
- Yürüyüşte **takip eden kamera** (figür kadrajın ortasında yerinde yürür); diğer pozlarda **sabit kamera**.
- Her video, aracın hazırladığı başlangıç karesinden başlar (boyut ve konum tutarlılığı).
- Figürün altında ve çevresinde boşluk kalmalı; kuyruk ya da kol savrulabilir.
- Ayırt edici detaylar (duman, saç) videonun sonuna kadar kalmalı. Prompttaki kalıcı detay cümlesi bunun içindir.
- 360p yeterlidir; figür zaten düşük piksel çözünürlüğüne indirilir.

## Nasıl çalışır

1. ffmpeg videodan 24 fps, tam çözünürlükte PNG kareler çıkarır. Renk matrisi ve aralığı açıkça ayarlanır; böylece aynı video her platformda aynı kareleri verir. Kare sayfası sharp ile yapılır.
2. Arka plan kenardan taşma doldurmayla temizlenir; koyu kontur dolguyu durdurur.
3. Kareler ölçülür: döngü noktası, hareket aralığı, yere basan ayağın hızı. Ölçümler video başına önbelleğe yazılır.
4. Bütün pozların seçilen kareleri **tek piksel ızgarasına** ve **tek k-means paletine** indirilir (dithering yok, kırıntılar silinir).
5. Her kare çapa noktası ve zemin hattına göre yerleştirilir. Takip eden kamerada zemin her karenin en alt pikselidir; sabit kamerada kameranın zeminidir. `startsFrom` ile pozlar birbirinin devamı olur.
6. Kareler kırpılır, tek atlasa paketlenir (kayıpsız WebP), manifest ve önizleme yazılır.

Bütçe: kare dizili öğeler için paket ≤500 KB, atlas kenarı ≤2048 piksel. Aşılırsa rapor uyarır.

## Loglar

Her işlem ve hata (beklenmeyen hatalarda tam yığın iziyle) hem terminale hem `<öğe>/logs/YYYY-MM-DD.log` dosyasına yazılır. Arayüzün log paneli aynı dosyayı gösterir ve yeni satırları canlı akıtır.

## Klasörler

```
core/        Node çekirdeği: cli.mjs, server.mjs, lib/
web/         arayüz (düz HTML, CSS, JS; derleme adımı yok)
templates/   plan şablonları (plans/) ve video promptu şablonu
examples/    örnek item.json (gölge kurdu)
```
