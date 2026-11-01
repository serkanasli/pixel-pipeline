// swift-tools-version:5.10
import PackageDescription

let package = Package(
  name: "PixelPipeline",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(name: "PixelPipeline", path: "Sources/PixelPipeline")
  ]
)
