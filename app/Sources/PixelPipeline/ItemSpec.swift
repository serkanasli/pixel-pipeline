import Foundation

// Mirrors item.json (see README "item.json"). Unknown keys are not preserved.
struct ItemSpec: Codable, Equatable {
  var id: String = "pet.new-item"
  var name: LocalizedName = LocalizedName()
  var type: String = "pet"
  var facing: String = "left"
  var pixelWidth: Int = 170
  var ptPerPixel: Int = 1
  var colors: Int = 24
  var poses: [PoseSpec] = []
  var behavior: Behavior = Behavior()

  init() {}
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    name = try c.decodeIfPresent(LocalizedName.self, forKey: .name) ?? LocalizedName()
    type = try c.decodeIfPresent(String.self, forKey: .type) ?? "pet"
    facing = try c.decodeIfPresent(String.self, forKey: .facing) ?? "left"
    pixelWidth = try c.decodeIfPresent(Int.self, forKey: .pixelWidth) ?? 170
    ptPerPixel = try c.decodeIfPresent(Int.self, forKey: .ptPerPixel) ?? 1
    colors = try c.decodeIfPresent(Int.self, forKey: .colors) ?? 24
    poses = try c.decodeIfPresent([PoseSpec].self, forKey: .poses) ?? []
    behavior = try c.decodeIfPresent(Behavior.self, forKey: .behavior) ?? Behavior()
  }
}

struct LocalizedName: Codable, Equatable {
  var en: String = ""
  var tr: String = ""

  init() {}
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    en = try c.decodeIfPresent(String.self, forKey: .en) ?? ""
    tr = try c.decodeIfPresent(String.self, forKey: .tr) ?? ""
  }
}

struct Behavior: Codable, Equatable {
  var enter: String?
  var arrive: [String] = []
  var onPress: String?

  init() {}
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    enter = try c.decodeIfPresent(String.self, forKey: .enter)
    arrive = try c.decodeIfPresent([String].self, forKey: .arrive) ?? []
    onPress = try c.decodeIfPresent(String.self, forKey: .onPress)
  }
}

enum PoseKind: String, Codable, CaseIterable, Identifiable {
  case locomotion, loop, transition, reaction, still
  var id: String { rawValue }
  var title: String {
    switch self {
    case .locomotion: "Yürüyüş (takip eden kamera, döngü)"
    case .loop: "Yerinde döngü (boşta, nefes)"
    case .transition: "Geçiş (kıvrılma, açılış)"
    case .reaction: "Tepki (dokununca, başa döner)"
    case .still: "Tek kare (uyku, duruş)"
    }
  }
  var needsVideo: Bool { self != .still }
}

struct PoseSpec: Codable, Equatable, Identifiable {
  var id = UUID()
  var name: String = "pose"
  var kind: PoseKind = .transition
  var video: String?
  var fps: Int = 12
  var startsFrom: String?
  var from: String?
  var frame: String?
  var range: [Int]?

  enum CodingKeys: String, CodingKey { case name, kind, video, fps, startsFrom, from, frame, range }

  init() {}
  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    name = try c.decode(String.self, forKey: .name)
    kind = try c.decode(PoseKind.self, forKey: .kind)
    video = try c.decodeIfPresent(String.self, forKey: .video)
    fps = try c.decodeIfPresent(Int.self, forKey: .fps) ?? 12
    startsFrom = try c.decodeIfPresent(String.self, forKey: .startsFrom)
    from = try c.decodeIfPresent(String.self, forKey: .from)
    // "frame" is "first", "last" or an index in item.json.
    if let s = try? c.decodeIfPresent(String.self, forKey: .frame) { frame = s }
    else if let i = try? c.decodeIfPresent(Int.self, forKey: .frame) { frame = String(i) }
    range = try c.decodeIfPresent([Int].self, forKey: .range)
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(name, forKey: .name)
    try c.encode(kind, forKey: .kind)
    if kind.needsVideo {
      try c.encodeIfPresent(video, forKey: .video)
      try c.encode(fps, forKey: .fps)
      if let s = startsFrom, s != "anchor", kind != .locomotion { try c.encode(s, forKey: .startsFrom) }
      try c.encodeIfPresent(range, forKey: .range)
    } else {
      try c.encodeIfPresent(from, forKey: .from)
      if let f = frame { if let i = Int(f) { try c.encode(i, forKey: .frame) } else { try c.encode(f, forKey: .frame) } }
    }
  }
}
