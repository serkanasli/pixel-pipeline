# CLAUDE.md

Pixel Pipeline: side-view videos and images → pixel art package (atlas and/or layer images + manifest) for a 2D app engine that plays frame sequences from an atlas and draws image layers. Born from an end-to-end production test (the shadow wolf example). Generic: an item (pet, character, fire, telescope, background, sky theme…) is a folder with an item.json plan; nothing in the code is specific to an item, a type or a template.

Used two ways on the same item folders: by a person through the local web UI, and by an AI agent through the CLI (on Linux, without macOS tools). Both call the same core functions and write the same logs.

Local, unshared instructions live in `CLAUDE.local.md` (git-ignored).

## Working with the owner
- Talk to the user in Turkish. Discuss before generating media, writing files, sending prompts or adding packages; produce after a decision.
- No new npm, Homebrew or Python packages without asking. The core uses only `sharp` plus ffmpeg/ffprobe on PATH; the server uses only Node built-ins; the UI is plain HTML/CSS/JS with no build step.
- The repository is public: no app-specific names or personal paths in tracked files.

## Layout
- `core/cli.mjs`: `init`, `templates`, `status`, `start-frame`, `prompt`, `inspect`, `set-range`, `make`, `export`. `--json` → result JSON on stdout, progress JSON lines on stderr.
- `core/server.mjs` (`npm start`): 127.0.0.1 only, JSON API + static `web/`, SSE at `/api/events`.
- `core/lib/`:
  - `schema.mjs`: item.json v2, validator (rejects unknown fields, keeps `manifest` off generated fields), save with stable formatting
  - `plan.mjs`: plan templates, `createItem`; `types.mjs`: item types (defaults only)
  - `poses.mjs`: per-pose video or image, clip, effective range, played frames, grid and image factors, stride, `packageDir`
  - `images.mjs`: still and layer images (background removal or own alpha), cached
  - `frames.mjs`: ffmpeg extraction + cache in `<item>/.pixel-cache`
  - `analyze.mjs`: measurements and suggestions, cached as `analysis.json`
  - `key.mjs`, `pixelize.mjs`, `pack.mjs`: background removal, shared grid + palette, atlas
  - `make.mjs`, `preview.mjs` + `preview.html`: the package (atlas, layer images, manifest passthrough, canvas warnings)
  - `export.mjs`: copies a made package to `<target>/<id>/`
  - `prep.mjs`, `startframe.mjs`: start frames, from the anchor or chained
  - `prompt.mjs`: video prompt
  - `status.mjs`: stages and next step
  - `inspect.mjs`: inspect and set-range
  - `log.mjs`: terminal + `<item>/logs/YYYY-MM-DD.log`, AsyncLocalStorage context
  - `workspace.mjs`, `events.mjs`, `watch.mjs`: server side
- `web/`: `app.js` (routes, step bar, next band, log drawer, SSE), `views/*.js`, `plan-editor.js`, `layer-editor.js`, `item-form.js`, `ui.js` (widgets and all Turkish state texts), `api.js`.
- `templates/plans/*.json`: plan templates (data), with poses or layers. `templates/types/*.json`: item types (default `key`, `anchor`). `templates/video-prompt.json`: the prompt template.
- `config.local.json` (git-ignored): the UI's working folder.

## Commands
```bash
npm install
npm start                                                # http://127.0.0.1:4317/
node core/cli.mjs status examples/shadow-wolf/item.json
node core/cli.mjs make examples/shadow-wolf/item.json    # needs the example media locally (git-ignored)
node core/cli.mjs export <item.json> --to <dir>          # copy the package to <dir>/<id>/
```

## Conventions and invariants
- Source frames are always sampled at 24 fps; a pose's fps picks every 2nd (12), 3rd (8) or 4th (6) frame. `range` values are 24 fps source indices. For looping kinds the range end is the frame that matches the start (not played) and the span is a multiple of the step.
- ffmpeg decoding is deterministic: explicit YUV matrix and range (tags, else BT.709 from 720 lines, BT.601 below; limited range), bitexact flags. Cache layout: `<item>/.pixel-cache/<video>-<hash>/src|key|info.json|analysis.json`.
- One pixel grid and one palette per item, across all poses and layers. Never quantise per frame (colour flicker). Video frames are downscaled with a cubic kernel, images with nearest.
- Images (still `image`, layers next to poses) are at the anchor's scale: the anchor's figure is `pixelWidth` art px wide. Without videos the grid comes from the images. Layers share one scale: a full (`key: false`) layer fits `canvas.width` when given, else the first layer's figure is `pixelWidth` wide.
- Layers are cropped to their common box; all-sprite items keep a 1 px transparent margin (no opaque edge pixel). `canvas` only warns, it never crops or scales.
- Item types (`templates/types/`) only give defaults; no code branches on a type. Budget follows content: frame sequences ≤500 KB, otherwise ≤150 KB.
- `manifest` in item.json is copied into the package manifest uninterpreted; generated fields cannot be set there (`assets` may only gain entries such as `sounds`).
- Locomotion = tracking camera: anchor x = mean centroid, ground = each frame's lowest pixel; stride = ground speed × loop length / factor × ptPerPixel.
- Fixed-camera poses: anchor and ground from the first frame, or continued from the `startsFrom` frame of the source pose; transitions ease the ground to the final lowest pixel.
- `startsFrom` drives both the start frame for the video model and the placement in the package. Start frame sidecars (`start-frames/<pose>.json`) record their source; a mismatch means stale.
- A pose's video defaults to `videos/<pose>.<mp4|mov|m4v|webm>`, so saving a file there is enough.
- `status` never extracts frames (it reads cached analysis only); it must stay cheap.
- Atlas: lossless WebP, `meta.scale` = atlas px per pt, `filter: "nearest"`. Budget: ≤500 KB for animated items, ≤2048 px atlas side.
- Every path from a request or item.json is resolved inside its item folder (`resolveInside`, symlinks included). The one exception is the export target (`export` / `--to`): `make` writes only inside the item folder, `export` copies to `<target>/<id>/` and there only writes or removes files of an earlier package of the same id, refusing a non-empty folder that holds none.
- User-fixable problems throw `UserError` (message only); anything else logs the full stack.
- Code comments explain why, briefly; match the density of the surrounding code. Identifiers in English, UI text in Turkish.

## Verifying changes
- Core: delete `examples/shadow-wolf/.pixel-cache`, run `make` and compare with the hand-tuned wolf test numbers (walk 16 frames from source 42–74, stride ≈ 81 pt, curl_up 2–93, tail_wag 0–86, package ≈ 415 KB). `inspect` must suggest the same ranges. Open `build/<id>/preview.html`.
- Static items: `examples/campfire-base` (`node make-test-image.mjs`, then `make`): one keyed layer, package ≤150 KB, edge pixels transparent. Also try an image-only character (`character-still`) and a background with a `key: false` and a `key: true` layer.
- CLI without macOS tools: run with a PATH that holds only node, ffmpeg and ffprobe.
- UI: run `npm start`, go through new item → start frame → prompt → video → range → package in a browser, and new item → layers → package → export, including a video or image added from outside the UI and a broken item.json.
