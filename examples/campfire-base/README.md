# Örnek: Kamp Ateşi Tabanı

Videosuz, tek katmanlı statik bir öğe: taş halkası ve çapraz kütükler. Alevi uygulamanın motoru çizer; bu yüzden paket yalnızca saydam taban görselini ve manifest'i içerir. `item.json`'daki `manifest` nesnesi (alev efekti, dokunma tepkisi, ses girişi) pakete olduğu gibi eklenir; araç bu alanları yorumlamaz.

Görsel depoda yoktur (`base.png` git dışında). Sentetik bir test görseli üretip paketlemek için:

```bash
cd examples/campfire-base
node make-test-image.mjs                   # base.png: düz açık arka plan üzerinde taşlar ve kütükler
node ../../core/cli.mjs status item.json
node ../../core/cli.mjs make item.json
node ../../core/cli.mjs export item.json --to /tmp/assets/items   # isteğe bağlı: <hedef>/fire.campfire-base/
```

Beklenen sonuç: tek katman `base` (arka planı temizlenmiş), `anchor.y` 1; görselin üst, sol ve sağ kenarı saydam, alt satırı taşların zemine değen satırı, paket 150 KB bütçesinin çok altında (yaklaşık 1,4 KB). `build/fire.campfire-base/preview.html` katmanı dama deseni üzerinde gösterir.

Kendi görselinle denemek için `base.png`'yi değiştir: yandan ya da hafif üstten, düz açık arka plan üzerinde, koyu bir dış hatla.
