// Extracts frames from a video as PNG files and writes a contact sheet.
// Usage: frames <video> <outDir> <sampleFps> <sheetCols>
// Prints one JSON line: {"duration":…,"fps":…,"width":…,"height":…,"frames":…}
import AVFoundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 5 else {
  FileHandle.standardError.write("usage: frames <video> <outDir> <sampleFps> <sheetCols>\n".data(using: .utf8)!)
  exit(2)
}
let url = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2])
let sampleFps = Double(args[3])!
let cols = Int(args[4])!
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let asset = AVURLAsset(url: url)
let sem = DispatchSemaphore(value: 0)
var duration = 0.0
var nominalFps: Float = 0
var natSize = CGSize.zero
Task {
  duration = (try? await asset.load(.duration).seconds) ?? 0
  if let track = try? await asset.loadTracks(withMediaType: .video).first {
    nominalFps = (try? await track.load(.nominalFrameRate)) ?? 0
    natSize = (try? await track.load(.naturalSize)) ?? .zero
  }
  sem.signal()
}
sem.wait()
guard duration > 0 else {
  FileHandle.standardError.write("cannot read video: \(args[1])\n".data(using: .utf8)!)
  exit(1)
}

let gen = AVAssetImageGenerator(asset: asset)
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero

func writePNG(_ img: CGImage, _ path: URL) {
  let dest = CGImageDestinationCreateWithURL(path as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, img, nil)
  CGImageDestinationFinalize(dest)
}

var images: [CGImage] = []
var i = 0
var t = 0.0
while t < duration - 0.001 {
  let time = CMTime(seconds: t, preferredTimescale: 600)
  if let img = try? gen.copyCGImage(at: time, actualTime: nil) {
    images.append(img)
    writePNG(img, outDir.appendingPathComponent(String(format: "f%03d.png", images.count - 1)))
  }
  i += 1
  t = Double(i) / sampleFps
}
guard let first = images.first else { exit(1) }

// Contact sheet at half size.
let w = first.width / 2, h = first.height / 2
let rows = (images.count + cols - 1) / cols
let ctx = CGContext(data: nil, width: w * cols, height: h * rows, bitsPerComponent: 8, bytesPerRow: 0,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
ctx.fill(CGRect(x: 0, y: 0, width: w * cols, height: h * rows))
for (k, img) in images.enumerated() {
  let c = k % cols, r = k / cols
  ctx.draw(img, in: CGRect(x: c * w, y: (rows - 1 - r) * h, width: w, height: h))
}
writePNG(ctx.makeImage()!, outDir.appendingPathComponent("sheet.png"))

print("{\"duration\":\(duration),\"fps\":\(nominalFps),\"width\":\(Int(natSize.width)),\"height\":\(Int(natSize.height)),\"frames\":\(images.count)}")
