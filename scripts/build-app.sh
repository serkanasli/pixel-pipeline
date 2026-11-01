#!/bin/zsh
# Builds "Pixel Pipeline.app" into dist/ (release build of app/ + core dependencies + frame extractor).
# The app finds core/cli.mjs through the repository path written into its Info.plist (PPRootDir),
# so keep the repository where it is or change the path in the app's Settings.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "• core dependencies"
(cd "$ROOT/core" && npm install --no-audit --no-fund --silent)

echo "• frame extractor"
mkdir -p "$ROOT/native/bin"
swiftc -O -suppress-warnings "$ROOT/native/frames.swift" -o "$ROOT/native/bin/frames"

echo "• app"
(cd "$ROOT/app" && swift build -c release)
BIN="$(cd "$ROOT/app" && swift build -c release --show-bin-path)/PixelPipeline"

APP="$ROOT/dist/Pixel Pipeline.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/PixelPipeline"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Pixel Pipeline</string>
  <key>CFBundleDisplayName</key><string>Pixel Pipeline</string>
  <key>CFBundleIdentifier</key><string>dev.pixel-pipeline.app</string>
  <key>CFBundleExecutable</key><string>PixelPipeline</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>PPRootDir</key><string>$ROOT</string>
</dict>
</plist>
PLIST
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "✓ $APP"
