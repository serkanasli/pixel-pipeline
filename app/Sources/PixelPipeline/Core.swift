import Foundation

// Runs the Node core (core/cli.mjs) as a child process. Progress arrives on stderr as JSON lines,
// the result on stdout as one JSON object.
enum CoreError: LocalizedError {
  case nodeNotFound, coreNotFound, failed(String)
  var errorDescription: String? {
    switch self {
    case .nodeNotFound: "Node bulunamadı. Ayarlar'dan node yolunu girin (ör. /opt/homebrew/bin/node)."
    case .coreNotFound: "Çekirdek (core/cli.mjs) bulunamadı. Ayarlar'dan pixel-pipeline klasörünü seçin."
    case .failed(let m): m
    }
  }
}

enum Core {
  static var nodePath: String? {
    if let p = UserDefaults.standard.string(forKey: "nodePath"), FileManager.default.isExecutableFile(atPath: p) { return p }
    for p in ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"] where FileManager.default.isExecutableFile(atPath: p) { return p }
    // Apps started from Finder do not get the shell PATH: ask a login shell.
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/bin/zsh")
    task.arguments = ["-lc", "command -v node"]
    let pipe = Pipe()
    task.standardOutput = pipe
    try? task.run()
    task.waitUntilExit()
    let out = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    return out?.isEmpty == false ? out : nil
  }

  // Repository root: settings, then the path baked in by scripts/build-app.sh, then a search
  // upwards from the executable (running from app/.build during development).
  static var rootDir: URL? {
    let fm = FileManager.default
    let has = { (u: URL) in fm.fileExists(atPath: u.appendingPathComponent("core/cli.mjs").path) }
    if let p = UserDefaults.standard.string(forKey: "rootDir") { let u = URL(fileURLWithPath: p); if has(u) { return u } }
    if let p = Bundle.main.object(forInfoDictionaryKey: "PPRootDir") as? String { let u = URL(fileURLWithPath: p); if has(u) { return u } }
    var u = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().deletingLastPathComponent()
    for _ in 0..<8 { if has(u) { return u }; u.deleteLastPathComponent() }
    return nil
  }

  static func run(_ args: [String], progress: @escaping (String) -> Void) async throws -> [String: Any] {
    guard let node = nodePath else { throw CoreError.nodeNotFound }
    guard let root = rootDir else { throw CoreError.coreNotFound }
    let task = Process()
    task.executableURL = URL(fileURLWithPath: node)
    task.arguments = [root.appendingPathComponent("core/cli.mjs").path] + args + ["--json"]
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:" + (env["PATH"] ?? "") // swiftc for the frame extractor
    task.environment = env
    let out = Pipe(), err = Pipe()
    task.standardOutput = out
    task.standardError = err

    err.fileHandleForReading.readabilityHandler = { h in
      let data = h.availableData
      guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
      for line in text.split(separator: "\n") {
        if let obj = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any], let step = obj["progress"] as? String {
          let detail = obj["detail"] as? String ?? ""
          DispatchQueue.main.async { progress(detail.isEmpty ? step : "\(step) — \(detail)") }
        } else {
          let s = String(line)
          DispatchQueue.main.async { progress(s) }
        }
      }
    }
    return try await withCheckedThrowingContinuation { cont in
      task.terminationHandler = { _ in
        err.fileHandleForReading.readabilityHandler = nil
        let data = out.fileHandleForReading.readDataToEndOfFile()
        let last = String(data: data, encoding: .utf8)?.split(separator: "\n").last.map(String.init) ?? ""
        guard let obj = try? JSONSerialization.jsonObject(with: Data(last.utf8)) as? [String: Any] else {
          cont.resume(throwing: CoreError.failed("Çekirdekten geçersiz yanıt: \(last.prefix(300))")); return
        }
        if let e = obj["error"] as? String { cont.resume(throwing: CoreError.failed(e)) } else { cont.resume(returning: obj) }
      }
      do { try task.run() } catch { cont.resume(throwing: error) }
    }
  }
}
