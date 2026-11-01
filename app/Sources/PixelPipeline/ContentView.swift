import SwiftUI

enum Section: Hashable {
  case item, pose(UUID), behavior, build, prep
}

struct ContentView: View {
  @EnvironmentObject var project: Project
  @State private var selection: Section? = .item

  var body: some View {
    Group {
      if project.folder == nil { Welcome() } else { editor }
    }
    .alert("Hata", isPresented: Binding(get: { project.error != nil }, set: { if !$0 { project.error = nil } })) {
      Button("Tamam") { project.error = nil }
    } message: { Text(project.error ?? "") }
  }

  private var editor: some View {
    NavigationSplitView {
      List(selection: $selection) {
        Label("Öğe", systemImage: "square.and.pencil").tag(Section.item)
        SwiftUI.Section("Pozlar") {
          ForEach(project.spec.poses) { pose in
            Label(pose.name, systemImage: icon(pose.kind)).tag(Section.pose(pose.id))
              .contextMenu { Button("Sil", role: .destructive) { remove(pose.id) } }
          }
          Button { addPose() } label: { Label("Poz ekle", systemImage: "plus") }.buttonStyle(.borderless)
        }
        SwiftUI.Section("Sonuç") {
          Label("Davranış", systemImage: "arrow.triangle.branch").tag(Section.behavior)
          Label("Paket ve önizleme", systemImage: "shippingbox").tag(Section.build)
        }
        SwiftUI.Section("Araçlar") {
          Label("Başlangıç karesi", systemImage: "photo.on.rectangle").tag(Section.prep)
        }
      }
      .navigationSplitViewColumnWidth(min: 200, ideal: 230)
    } detail: {
      ScrollView {
        Group {
          switch selection {
          case .item, .none: ItemView()
          case .pose(let id):
            if let i = project.spec.poses.firstIndex(where: { $0.id == id }) { PoseView(pose: $project.spec.poses[i]) }
          case .behavior: BehaviorView()
          case .build: BuildView()
          case .prep: PrepView()
          }
        }
        .padding(24)
        .frame(maxWidth: 860, alignment: .leading)
      }
    }
    .navigationTitle(project.spec.name.tr.isEmpty ? project.spec.id : project.spec.name.tr)
    .navigationSubtitle(project.folder?.path ?? "")
    .toolbar {
      ToolbarItem {
        if let busy = project.busy { HStack(spacing: 6) { ProgressView().controlSize(.small); Text(busy).font(.callout) } }
      }
      ToolbarItem {
        Button { Task { await project.build(); selection = .build } } label: { Label("Paketi oluştur", systemImage: "hammer") }
          .disabled(project.busy != nil || project.spec.poses.isEmpty)
      }
    }
  }

  private func icon(_ k: PoseKind) -> String {
    switch k {
    case .locomotion: "figure.walk"
    case .loop: "repeat"
    case .transition: "arrow.right"
    case .reaction: "hand.tap"
    case .still: "photo"
    }
  }

  private func addPose() {
    var p = PoseSpec()
    p.name = "pose_\(project.spec.poses.count + 1)"
    p.kind = project.spec.poses.isEmpty ? .locomotion : .transition
    project.spec.poses.append(p)
    selection = .pose(p.id)
  }

  private func remove(_ id: UUID) {
    project.spec.poses.removeAll { $0.id == id }
    if case .pose(id) = selection { selection = .item }
  }
}

struct Welcome: View {
  @EnvironmentObject var project: Project
  var body: some View {
    VStack(spacing: 18) {
      Image(systemName: "square.grid.3x3.square").font(.system(size: 54)).foregroundStyle(.secondary)
      Text("Pixel Pipeline").font(.largeTitle.bold())
      Text("Yandan çekilmiş videolardan pixel art öğe paketi (atlas + manifest) üretir.")
        .foregroundStyle(.secondary)
      HStack {
        Button("Yeni öğe…") { NewItem.run(project) }.keyboardShortcut("n").buttonStyle(.borderedProminent)
        Button("Öğe aç…") { OpenItem.run(project) }.keyboardShortcut("o")
      }
      if Core.rootDir == nil || Core.nodePath == nil {
        Text(Core.nodePath == nil ? CoreError.nodeNotFound.localizedDescription : CoreError.coreNotFound.localizedDescription)
          .foregroundStyle(.red).font(.callout)
      }
    }
    .padding(40)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
