import AVKit
import SwiftUI
import UniformTypeIdentifiers

struct PoseView: View {
  @EnvironmentObject var project: Project
  @Binding var pose: PoseSpec

  private var others: [String] { project.spec.poses.filter { $0.id != pose.id }.map(\.name) }
  private var inspection: Inspection? { pose.video.flatMap { project.inspections[$0] } }

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text("Poz: \(pose.name)").font(.title2.bold())
      Form {
        TextField("Ad", text: $pose.name, prompt: Text("walk, curl_up, idle, wave…"))
        Picker("Tür", selection: $pose.kind) {
          ForEach(PoseKind.allCases) { Text($0.title).tag($0) }
        }
        if pose.kind.needsVideo {
          Picker("Hız", selection: $pose.fps) {
            Text("12 fps").tag(12)
            Text("8 fps (yavaş pozlar için)").tag(8)
          }
          if pose.kind != .locomotion {
            Picker("Başladığı yer", selection: Binding(get: { pose.startsFrom ?? "anchor" }, set: { pose.startsFrom = $0 == "anchor" ? nil : $0 })) {
              Text("Çapa görseli").tag("anchor")
              ForEach(others, id: \.self) { Text("\($0) pozunun son karesi").tag($0) }
            }
          }
        } else {
          Picker("Kaynak poz", selection: Binding(get: { pose.from ?? "" }, set: { pose.from = $0.isEmpty ? nil : $0 })) {
            Text("Seçin").tag("")
            ForEach(others, id: \.self) { Text($0).tag($0) }
          }
          Picker("Kare", selection: Binding(get: { pose.frame ?? "first" }, set: { pose.frame = $0 })) {
            Text("İlk kare").tag("first")
            Text("Son kare").tag("last")
          }
        }
      }
      .formStyle(.grouped)
      .onChange(of: pose.name) { old, new in rename(old, new) }

      if pose.kind.needsVideo { videoSection }
      Text(help).font(.callout).foregroundStyle(.secondary)
    }
  }

  @ViewBuilder private var videoSection: some View {
    Text("Video").font(.headline)
    DropZone(title: pose.video ?? "Videoyu buraya bırakın veya seçin", types: [.movie, .mpeg4Movie]) { url in
      if let rel = project.importVideo(url) { pose.video = rel; pose.range = nil; Task { await project.inspect(pose) } }
    }
    if let rel = pose.video, let url = project.absolute(rel) {
      VideoPlayer(player: AVPlayer(url: url)).frame(height: 260).clipShape(RoundedRectangle(cornerRadius: 8)).id(rel)
      HStack {
        Button("İncele") { Task { await project.inspect(pose) } }.disabled(project.busy != nil)
        if inspection == nil { Text("Kareleri ve önerilen aralığı görmek için inceleyin.").font(.caption).foregroundStyle(.secondary) }
      }
      if let ins = inspection { rangeSection(ins) }
    }
  }

  @ViewBuilder private func rangeSection(_ ins: Inspection) -> some View {
    let suggested = suggestion(ins)
    Text("Aralık (24 fps kaynak kareleri)").font(.headline)
    VStack(alignment: .leading, spacing: 8) {
      Text("\(ins.frames) kare · \(ins.width)×\(ins.height) · önerilen: \(suggested.0)–\(suggested.1)\(suggestionNote(ins))")
        .font(.callout.monospacedDigit())
      Toggle("Aralığı elle belirle", isOn: Binding(get: { pose.range != nil }, set: { pose.range = $0 ? [suggested.0, suggested.1] : nil }))
      if let r = pose.range, r.count == 2 {
        HStack {
          Text("Başlangıç \(r[0])").monospacedDigit().frame(width: 110, alignment: .leading)
          Slider(value: Binding(get: { Double(r[0]) }, set: { pose.range = [min(Int($0), r[1] - 2), r[1]] }), in: 0...Double(max(1, ins.frames - 1)), step: 1)
        }
        HStack {
          Text("Bitiş \(r[1])").monospacedDigit().frame(width: 110, alignment: .leading)
          Slider(value: Binding(get: { Double(r[1]) }, set: { pose.range = [r[0], max(Int($0), r[0] + 2)] }), in: 0...Double(max(1, ins.frames - 1)), step: 1)
        }
        if pose.kind == .locomotion || pose.kind == .loop {
          Text("Döngüde bitiş karesi başlangıç karesine denk gelmeli; bitiş karesi döngüye dahil edilmez.").font(.caption).foregroundStyle(.secondary)
        }
      }
      if let sheet = ins.contactSheet, let img = NSImage(contentsOf: sheet) {
        Text("Kare sayfası (soldan sağa, yukarıdan aşağı; satır başına 12 kare)").font(.caption).foregroundStyle(.secondary)
        Image(nsImage: img).resizable().interpolation(.none).scaledToFit().clipShape(RoundedRectangle(cornerRadius: 6))
      }
    }
  }

  private func suggestion(_ ins: Inspection) -> (Int, Int) {
    switch pose.kind {
    case .locomotion, .loop: ins.loop.map { ($0.start, $0.start + $0.length) } ?? (0, ins.frames - 1)
    case .transition: (ins.transition.start, ins.transition.end)
    case .reaction: (ins.reaction.start, ins.reaction.end)
    case .still: (0, 0)
    }
  }

  private func suggestionNote(_ ins: Inspection) -> String {
    switch pose.kind {
    case .locomotion, .loop: ins.loop.map { " (döngü farkı \($0.score), düşük iyi)" } ?? ""
    case .reaction: " (başa dönüş farkı \(ins.reaction.score), düşük iyi)"
    default: ""
    }
  }

  private var help: String {
    switch pose.kind {
    case .locomotion: "Takip eden kamerayla çekilmiş yürüyüş. Araç en temiz kapanan döngüyü seçer, adım uzunluğunu ve hızı yere basan ayağın kaymasından ölçer."
    case .loop: "Sabit kamerada yerinde tekrar eden hareket (boşta durma, nefes). Araç en temiz kapanan döngüyü seçer."
    case .transition: "Sabit kamerada bir duruştan diğerine geçiş (kıvrılma, oturma, açılış animasyonu). Araç hareketin başladığı ve durduğu kareleri bulur."
    case .reaction: "Dokunma tepkisi: başlangıç duruşuna geri döner (kuyruk sallama, el sallama). Genellikle önceki pozun son karesinden başlayan bir videodur."
    case .still: "Tek kare: başka bir pozun ilk ya da son karesi (ör. uyku)."
    }
  }

  // Keep references to this pose valid when it is renamed.
  private func rename(_ old: String, _ new: String) {
    guard old != new else { return }
    for i in project.spec.poses.indices {
      if project.spec.poses[i].startsFrom == old { project.spec.poses[i].startsFrom = new }
      if project.spec.poses[i].from == old { project.spec.poses[i].from = new }
    }
    var b = project.spec.behavior
    if b.enter == old { b.enter = new }
    if b.onPress == old { b.onPress = new }
    b.arrive = b.arrive.map { $0 == old ? new : $0 }
    project.spec.behavior = b
  }
}

struct DropZone: View {
  var title: String
  var types: [UTType]
  var onFile: (URL) -> Void
  @State private var targeted = false

  var body: some View {
    HStack {
      Image(systemName: "tray.and.arrow.down")
      Text(title).lineLimit(1).truncationMode(.middle)
      Spacer()
      Button("Seç…") {
        let p = NSOpenPanel(); p.allowedContentTypes = types
        if p.runModal() == .OK, let u = p.url { onFile(u) }
      }
    }
    .padding(14)
    .background(RoundedRectangle(cornerRadius: 8).strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [6])).foregroundStyle(targeted ? Color.accentColor : .secondary))
    .onDrop(of: [.fileURL], isTargeted: $targeted) { providers in
      _ = providers.first?.loadObject(ofClass: URL.self) { url, _ in
        if let url { DispatchQueue.main.async { onFile(url) } }
      }
      return true
    }
  }
}
