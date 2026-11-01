# CLAUDE.md

Pixel Pipeline: side-view videos → pixel art package (atlas + manifest) for a 2D app engine that plays frame sequences from an atlas. Born from an end-to-end production test (the shadow wolf example).

Local, unshared instructions live in `CLAUDE.local.md` (git-ignored).

## Working with the owner
- Talk to the user in Turkish. Discuss before generating media, writing files, sending prompts or adding packages; produce after a decision.
- No new npm, Homebrew or Python packages without asking. The core uses only `sharp`; the app uses only Apple frameworks.

## Layout
- `core/cli.mjs`: commands `prep-start`, `inspect`, `make`. `--json` → result JSON on stdout, progress JSON lines on stderr (the app parses both).
- `core/lib/`: `frames.mjs` (native extractor + cache in `<item>/.pixel-cache`), `key.mjs` (background removal), `analyze.mjs` (loop / range / ground speed), `pixelize.mjs` (shared grid + k-means palette), `pack.mjs` (placement + atlas), `make.mjs` (orchestration, manifest, report), `preview.mjs` + `preview.html` (self-contained preview), `prep.mjs` (16:9 start frame).
- `native/frames.swift`: compiled on first use to `native/bin/frames` (git-ignored).
- `app/`: SwiftUI, Swift Package, Swift 5 language mode (tools 5.10). `Core.swift` finds node and the repo root (Settings → Info.plist `PPRootDir` → search upwards from the executable).

## Commands
```bash
cd core && npm install
node core/cli.mjs make examples/shadow-wolf/item.json   # needs the example videos locally (git-ignored)
cd app && swift build                                    # dev build; swift run to start
./scripts/build-app.sh                                   # dist/Pixel Pipeline.app
```

## Conventions and invariants
- Source frames are always sampled at 24 fps; a pose's fps picks every 2nd (12), 3rd (8) or 4th (6) frame. `range` values are 24 fps source indices.
- One pixel grid and one palette per item, across all poses. Never quantise per frame (colour flicker).
- Locomotion = tracking camera: anchor x = mean centroid, ground = each frame's lowest pixel; stride = ground speed × loop length / factor × ptPerPixel.
- Fixed-camera poses: anchor and ground from the first frame, or continued from `startsFrom`'s last frame; transitions ease the ground to the final lowest pixel.
- Atlas: lossless WebP, `meta.scale` = atlas px per pt, `filter: "nearest"`. Manifest format: see README. Budget: ≤500 KB for animated items, ≤2048 px atlas side.
- macOS cannot encode WebP natively; that is why encoding stays in the Node core (sharp).
- Code comments explain why, briefly; match the density of the surrounding code. Identifiers in English, UI text in Turkish.

## Verifying changes
- Core: run `make` on the example and compare with the hand-tuned wolf test numbers (walk 16 frames from source 42–74, stride ≈ 81 pt, curl_up 2–93, tail_wag 0–86, package ≈ 415 KB). Open `build/<id>/preview.html`.
- App: `swift build` must stay warning-free; UI changes need a manual look (no screenshot permission in automated sessions).
