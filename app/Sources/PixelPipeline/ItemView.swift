import SwiftUI

struct ItemView: View {
  @EnvironmentObject var project: Project

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text("Öğe").font(.title2.bold())
      Form {
        TextField("Kimlik (id)", text: $project.spec.id, prompt: Text("pet.shadow-wolf"))
        TextField("Ad (Türkçe)", text: $project.spec.name.tr)
        TextField("Ad (İngilizce)", text: $project.spec.name.en)
        Picker("Tür", selection: $project.spec.type) {
          Text("Evcil hayvan (pet)").tag("pet")
          Text("Karakter (character)").tag("character")
        }
        Picker("Bakış yönü", selection: $project.spec.facing) {
          Text("Sola").tag("left")
          Text("Sağa").tag("right")
        }
      }
      .formStyle(.grouped)

      Text("Piksel").font(.headline)
      Form {
        LabeledContent("Genişlik (sanat pikseli)") {
          HStack {
            Slider(value: intBinding($project.spec.pixelWidth), in: 48...320, step: 2)
            Text("\(project.spec.pixelWidth) px").monospacedDigit().frame(width: 64, alignment: .trailing)
          }
        }
        Text("Referans pozun ilk karesindeki figürün genişliği. Kurt testinde 170 piksel kullanıldı.")
          .font(.caption).foregroundStyle(.secondary)
        Picker("1 sanat pikseli", selection: $project.spec.ptPerPixel) {
          Text("1 pt (ince detay)").tag(1)
          Text("2 pt (kalın piksel)").tag(2)
        }
        LabeledContent("Renk sayısı") {
          HStack {
            Slider(value: intBinding($project.spec.colors), in: 8...48, step: 1)
            Text("\(project.spec.colors)").monospacedDigit().frame(width: 64, alignment: .trailing)
          }
        }
        Text("Tüm pozlar tek ortak palete indirilir.").font(.caption).foregroundStyle(.secondary)
      }
      .formStyle(.grouped)
    }
  }
}

func intBinding(_ b: Binding<Int>) -> Binding<Double> {
  Binding(get: { Double(b.wrappedValue) }, set: { b.wrappedValue = Int($0.rounded()) })
}
