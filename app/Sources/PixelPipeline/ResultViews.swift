import SwiftUI
import WebKit

struct BehaviorView: View {
  @EnvironmentObject var project: Project
  private var names: [String] { project.spec.poses.map(\.name) }

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text("Davranış").font(.title2.bold())
      Form {
        Picker("Giriş (yürüyerek gelir)", selection: optional($project.spec.behavior.enter)) {
          Text("Yok").tag("")
          ForEach(project.spec.poses.filter { $0.kind == .locomotion }.map(\.name), id: \.self) { Text($0).tag($0) }
        }
        LabeledContent("Varış sırası") {
          VStack(alignment: .trailing) {
            ForEach(Array(project.spec.behavior.arrive.enumerated()), id: \.offset) { i, name in
              HStack { Text("\(i + 1). \(name)"); Button { project.spec.behavior.arrive.remove(at: i) } label: { Image(systemName: "minus.circle") }.buttonStyle(.borderless) }
            }
            Menu("Poz ekle") { ForEach(names, id: \.self) { n in Button(n) { project.spec.behavior.arrive.append(n) } } }.fixedSize()
          }
        }
        Text("Varış sırasının son pozu dinlenme pozudur (ör. curl_up → sleep, intro → idle).").font(.caption).foregroundStyle(.secondary)
        Picker("Dokununca", selection: optional($project.spec.behavior.onPress)) {
          Text("Yok").tag("")
          ForEach(names, id: \.self) { Text($0).tag($0) }
        }
      }
      .formStyle(.grouped)
    }
  }

  private func optional(_ b: Binding<String?>) -> Binding<String> {
    Binding(get: { b.wrappedValue ?? "" }, set: { b.wrappedValue = $0.isEmpty ? nil : $0 })
  }
}

struct BuildView: View {
  @EnvironmentObject var project: Project
  @State private var showLog = false

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      HStack {
        Text("Paket ve önizleme").font(.title2.bold())
        Spacer()
        Button { Task { await project.build() } } label: { Label("Paketi oluştur", systemImage: "hammer") }
          .buttonStyle(.borderedProminent).disabled(project.busy != nil || project.spec.poses.isEmpty)
      }
      if let r = project.report {
        Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 6) {
          row("Paket", "\(fmt(r.packageKB)) KB / \(fmt(r.budgetKB)) KB", bad: r.packageKB > r.budgetKB)
          row("Atlas", r.atlas)
          row("Bellek", "\(fmt(r.memoryMB)) MB")
          row("Tuval", r.size)
          if let l = r.locomotion { row("Yürüyüş", l) }
          ForEach(r.poses, id: \.name) { p in row(p.name, p.line) }
        }
        .font(.callout.monospacedDigit())
        if !r.warnings.isEmpty {
          VStack(alignment: .leading, spacing: 4) {
            Text("Uyarılar").font(.headline)
            ForEach(r.warnings, id: \.self) { Label($0, systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
          }
        }
        HStack {
          Button("Finder'da göster") { NSWorkspace.shared.activateFileViewerSelecting([r.output]) }
          Button("Önizlemeyi tarayıcıda aç") { NSWorkspace.shared.open(r.preview) }
        }
        PreviewWeb(url: r.preview).frame(height: 560).clipShape(RoundedRectangle(cornerRadius: 8))
      } else if project.busy == nil {
        Text("Henüz paket oluşturulmadı.").foregroundStyle(.secondary)
      }
      DisclosureGroup("Günlük", isExpanded: $showLog) {
        Text(project.log.joined(separator: "\n")).font(.caption.monospaced()).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }

  private func row(_ k: String, _ v: String, bad: Bool = false) -> some View {
    GridRow { Text(k).foregroundStyle(.secondary); Text(v).foregroundStyle(bad ? .orange : .primary) }
  }
  private func fmt(_ v: Double) -> String { String(format: "%.1f", v) }
}

struct PrepView: View {
  @EnvironmentObject var project: Project
  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text("Başlangıç karesi").font(.title2.bold())
      Text("Çapa görselini video modeline verilecek 16:9 kareye dönüştürür: arka plan tek renge eşitlenir, figür ortalanır ve altında %20 boşluk bırakılır.")
        .foregroundStyle(.secondary)
      DropZone(title: "Çapa görselini buraya bırakın veya seçin", types: [.image]) { url in Task { await project.prepStart(url) } }
      if let out = project.startFrame, let img = NSImage(contentsOf: out) {
        Image(nsImage: img).resizable().interpolation(.none).scaledToFit().clipShape(RoundedRectangle(cornerRadius: 8))
        HStack {
          Text(out.lastPathComponent).font(.callout.monospaced())
          Button("Finder'da göster") { NSWorkspace.shared.activateFileViewerSelecting([out]) }
        }
      }
    }
  }
}

// Shows the generated preview.html (self-contained, so file access to its folder is enough).
struct PreviewWeb: NSViewRepresentable {
  var url: URL
  func makeNSView(context: Context) -> WKWebView { WKWebView() }
  func updateNSView(_ view: WKWebView, context: Context) {
    // Reload after every build: the file name stays the same.
    view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
  }
}
