import AppKit
import SwiftUI

@main
struct PixelPipelineApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
  @StateObject private var project = Project()

  var body: some Scene {
    WindowGroup("Pixel Pipeline") {
      ContentView()
        .environmentObject(project)
        .frame(minWidth: 980, minHeight: 640)
    }
    .commands {
      CommandGroup(replacing: .newItem) {
        Button("Yeni öğe…") { NewItem.run(project) }.keyboardShortcut("n")
        Button("Öğe aç…") { OpenItem.run(project) }.keyboardShortcut("o")
      }
    }
    Settings { SettingsView() }
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  // Needed when started with `swift run` (no .app bundle): become a regular foreground app.
  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
  }
  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@MainActor
enum NewItem {
  static func run(_ project: Project) {
    let panel = NSSavePanel()
    panel.title = "Yeni öğe klasörü"
    panel.prompt = "Oluştur"
    panel.nameFieldStringValue = "yeni-karakter"
    panel.canCreateDirectories = true
    if panel.runModal() == .OK, let url = panel.url { project.create(at: url) }
  }
}

@MainActor
enum OpenItem {
  static func run(_ project: Project) {
    let panel = NSOpenPanel()
    panel.title = "item.json seç"
    panel.allowedContentTypes = [.json]
    panel.allowsMultipleSelection = false
    if panel.runModal() == .OK, let url = panel.url { project.open(url) }
  }
}

struct SettingsView: View {
  @AppStorage("nodePath") private var nodePath = ""
  @AppStorage("rootDir") private var rootDir = ""
  var body: some View {
    Form {
      TextField("Node yolu", text: $nodePath, prompt: Text(Core.nodePath ?? "/opt/homebrew/bin/node"))
      HStack {
        TextField("pixel-pipeline klasörü", text: $rootDir, prompt: Text(Core.rootDir?.path ?? "seçilmedi"))
        Button("Seç…") {
          let p = NSOpenPanel(); p.canChooseDirectories = true; p.canChooseFiles = false
          if p.runModal() == .OK, let u = p.url { rootDir = u.path }
        }
      }
      Text("Boş bırakılırsa otomatik bulunur.").font(.caption).foregroundStyle(.secondary)
    }
    .padding(20)
    .frame(width: 560)
  }
}
