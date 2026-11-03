# Örnek: Gölge Kurdu

`item.json`, kurt testinde üretilen gölge kurdunu tanımlar: `walking-pet` şablonu (yürüyüş, kıvrılma, kuyruk sallama, uyku), seçilmiş aralıklar ve video promptu alanlarıyla.

Görseller ve videolar depoda yoktur (`anchor.png`, `videos/`, `start-frames/` git dışında). Denemek için:

- `anchor.png`: kurdun çapa görseli (düz açık arka plan, yandan, sola bakan)
- `videos/pixel-wolf-walk-360p-1.mp4`: takip eden kamera, sola yürüyüş (çapadan)
- `videos/pixel-wolf-curl-up-360p-1.mp4`: sabit kamera, yürüyüşteki ayakta duruş karesinden kıvrılıp uyuma
- `videos/pixel-wolf-tail-wag-360p-1.mp4`: sabit kamera, kıvrılma videosunun son karesinden kuyruk sallama

```bash
node ../../core/cli.mjs status item.json
node ../../core/cli.mjs make item.json
```

Kurt testindeki elle ayarlanmış sonuçla karşılaştırma: yürüyüş 16 kare (kaynak 42–74), adım ≈ 81 pt, `curl_up` 2–93, `tail_wag` 0–86, paket ≈ 415 KB.
