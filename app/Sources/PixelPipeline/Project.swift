import Foundation
import SwiftUI

// One item = one folder with item.json, videos/ and (after a build) build/<id>/.
@MainActor
final class Project: ObservableObject {
  @Published var folder: URL?
  @Published var spec = ItemSpec() { didSet { if spec != oldValue { scheduleSave() } } }
  @Published var log: [String] = []
  @Published var busy: String?
  @Published var error: String?
  @Published var report: BuildReport?
  @Published var inspections: [String: Inspection] = [:] // by video path
  @Published var startFrame: URL?

  var itemURL: URL? { folder?.appendingPathComponent("item.json") }
  private var saveTask: Task<Void, Never>?

  // MARK: files

  func create(at folder: URL) {
    try? FileManager.default.createDirectory(at: folder.appendingPathComponent("videos"), withIntermediateDirectories: true)
    var s = ItemSpec()
    let slug = folder.lastPathComponent.lowercased().replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    s.id = "pet.\(slug.isEmpty ? "new-item" : slug)"
    s.name.tr = folder.lastPathComponent
    s.name.en = folder.lastPathComponent
    reset(folder)
    spec = s
    save()
  }

  func open(_ item: URL) {
    do {
      let s = try JSONDecoder().decode(ItemSpec.self, from: Data(contentsOf: item))
      reset(item.deletingLastPathComponent())
      spec = s
      saveTask?.cancel()
    } catch { self.error = "item.json okunamadı: \(error.localizedDescription)" }
  }

  private func reset(_ folder: URL) {
    self.folder = folder
    report = nil; inspections = [:]; log = []; error = nil; startFrame = nil
  }

  func save() {
    guard let url = itemURL else { return }
    let enc = JSONEncoder()
    enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    do { try enc.encode(spec).write(to: url) } catch { self.error = "Kaydedilemedi: \(error.localizedDescription)" }
  }

  private func scheduleSave() {
    saveTask?.cancel()
    saveTask = Task { try? await Task.sleep(for: .milliseconds(400)); if !Task.isCancelled { save() } }
  }

  // Copies a video into videos/ and returns its path relative to the item folder.
  func importVideo(_ url: URL) -> String? {
    guard let folder else { return nil }
    let dir = folder.appendingPathComponent("videos")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let dest = dir.appendingPathComponent(url.lastPathComponent)
    if url.standardizedFileURL != dest.standardizedFileURL {
      try? FileManager.default.removeItem(at: dest)
      do { try FileManager.default.copyItem(at: url, to: dest) } catch { self.error = "Video kopyalanamadı: \(error.localizedDescription)"; return nil }
    }
    return "videos/\(url.lastPathComponent)"
  }

  func absolute(_ relative: String) -> URL? { folder?.appendingPathComponent(relative) }

  // MARK: core commands

  private func runCore(_ title: String, _ args: [String]) async -> [String: Any]? {
    busy = title; error = nil
    log.append("▶︎ \(title)")
    defer { busy = nil }
    do {
      return try await Core.run(args) { [weak self] line in self?.log.append(line) }
    } catch {
      self.error = error.localizedDescription
      log.append("✕ \(error.localizedDescription)")
      return nil
    }
  }

  func inspect(_ pose: PoseSpec) async {
    guard let rel = pose.video, let video = absolute(rel), let folder else { return }
    if let r = await runCore("İnceleniyor: \(pose.name)", ["inspect", video.path, "--cache", folder.appendingPathComponent(".pixel-cache").path]) {
      inspections[rel] = Inspection(r)
    }
  }

  func build() async {
    save()
    guard let item = itemURL else { return }
    if let r = await runCore("Paket oluşturuluyor", ["make", item.path]) { report = BuildReport(r) }
  }

  func prepStart(_ image: URL) async {
    guard let folder else { return }
    let dir = folder.appendingPathComponent("start-frames")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let out = dir.appendingPathComponent(image.deletingPathExtension().lastPathComponent + "-16x9.png")
    if await runCore("Başlangıç karesi hazırlanıyor", ["prep-start", image.path, out.path]) != nil { startFrame = out }
  }
}

struct Inspection {
  var contactSheet: URL?
  var frames: Int
  var width: Int
  var height: Int
  var loop: (start: Int, length: Int, score: Double)?
  var transition: (start: Int, end: Int)
  var reaction: (start: Int, end: Int, score: Double)

  init(_ r: [String: Any]) {
    contactSheet = (r["contactSheet"] as? String).map { URL(fileURLWithPath: $0) }
    frames = r["frames"] as? Int ?? 0
    let info = r["info"] as? [String: Any] ?? [:]
    width = info["width"] as? Int ?? 0
    height = info["height"] as? Int ?? 0
    let s = r["suggestions"] as? [String: Any] ?? [:]
    if let l = s["loop"] as? [String: Any] { loop = (l["start"] as? Int ?? 0, l["length"] as? Int ?? 0, l["score"] as? Double ?? 0) }
    let t = s["transition"] as? [String: Any] ?? [:]
    transition = (t["start"] as? Int ?? 0, t["end"] as? Int ?? 0)
    let re = s["reaction"] as? [String: Any] ?? [:]
    reaction = (re["start"] as? Int ?? 0, re["end"] as? Int ?? 0, re["returnScore"] as? Double ?? 0)
  }
}

struct BuildReport {
  var output: URL
  var preview: URL
  var packageKB: Double
  var budgetKB: Double
  var atlas: String
  var memoryMB: Double
  var size: String
  var locomotion: String?
  var poses: [(name: String, line: String)]
  var warnings: [String]

  init(_ r: [String: Any]) {
    output = URL(fileURLWithPath: r["output"] as? String ?? "/")
    preview = URL(fileURLWithPath: r["preview"] as? String ?? "/")
    packageKB = r["packageKB"] as? Double ?? 0
    budgetKB = r["budgetKB"] as? Double ?? 0
    let a = r["atlas"] as? [String: Any] ?? [:]
    atlas = "\(a["w"] as? Int ?? 0)×\(a["h"] as? Int ?? 0) · \(a["kb"] as? Double ?? 0) KB"
    memoryMB = a["memoryMB"] as? Double ?? 0
    let s = r["size"] as? [String: Any] ?? [:]
    size = "\(s["width"] as? Int ?? 0)×\(s["height"] as? Int ?? 0) pt"
    if let l = r["locomotion"] as? [String: Any] { locomotion = "adım \(l["strideLength"] ?? 0) pt · hız \(l["speed"] ?? 0) pt/sn" }
    let p = r["poses"] as? [String: Any] ?? [:]
    poses = p.keys.sorted().map { k in
      let v = p[k] as? [String: Any] ?? [:]
      var line = "\(v["kind"] ?? "") · \(v["frames"] ?? 0) kare · \(v["fps"] ?? 12) fps"
      if let r = v["range"] as? [Int], r.count == 2 { line += " · kaynak \(r[0])–\(r[1])" }
      return (k, line)
    }
    warnings = r["warnings"] as? [String] ?? []
  }
}
