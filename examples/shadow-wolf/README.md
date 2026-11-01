# Örnek: Gölge Kurdu

`item.json`, kurt testinde üretilen gölge kurdunu tanımlar (yürüyüş, kıvrılma, kuyruk sallama, uyku).

Videolar depoda yoktur (`videos/` git dışında). Denemek için üç videoyu `videos/` içine şu adlarla koyun:

- `pixel-wolf-walk-360p-1.mp4`: takip eden kamera, sola yürüyüş
- `pixel-wolf-curl-up-360p-1.mp4`: sabit kamera, ayakta duruştan kıvrılıp uyuma
- `pixel-wolf-tail-wag-360p-1.mp4`: sabit kamera, kıvrılma videosunun son karesinden başlayan kuyruk sallama

```bash
node ../../core/cli.mjs make item.json
```

Kurt testindeki elle ayarlanmış sonuçla karşılaştırma: yürüyüş 16 kare (kaynak 42–74), adım ≈ 81 pt, paket ≈ 415 KB.
