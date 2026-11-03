import SwiftUI

enum ThemeColor {
    static let canvas = Color(red: 0.035, green: 0.060, blue: 0.101)
    static let sidebar = Color(red: 0.047, green: 0.077, blue: 0.126)
    static let panel = Color(red: 0.071, green: 0.113, blue: 0.171)
    static let sunken = Color(red: 0.044, green: 0.077, blue: 0.126)
    static let stroke = Color.white.opacity(0.09)
    static let teal = Color(red: 0.25, green: 0.83, blue: 0.89)
    static let green = Color(red: 0.28, green: 0.85, blue: 0.64)
    static let amber = Color(red: 1.0, green: 0.72, blue: 0.31)
    static let muted = Color(red: 0.60, green: 0.68, blue: 0.77)
}

struct Panel<Content: View>: View {
    let title: String
    var subtitle: String = ""
    var icon: String = "square.grid.2x2"
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 17) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(ThemeColor.teal)
                    .frame(width: 32, height: 32)
                    .background(ThemeColor.teal.opacity(0.10), in: RoundedRectangle(cornerRadius: 9))
                VStack(alignment: .leading, spacing: 4) {
                    Text(tr(title)).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                    if !subtitle.isEmpty {
                        Text(tr(subtitle)).font(.system(size: 11)).foregroundStyle(ThemeColor.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ThemeColor.panel, in: RoundedRectangle(cornerRadius: 15))
        .overlay(RoundedRectangle(cornerRadius: 15).stroke(ThemeColor.stroke, lineWidth: 1))
    }
}

struct FieldLabel: View {
    let text: String
    var body: some View {
        Text(tr(text.uppercased()))
            .font(.system(size: 10, weight: .semibold, design: .rounded))
            .tracking(1.3)
            .foregroundStyle(ThemeColor.muted)
    }
}

struct MiniMetric: View {
    let label: String
    let value: String
    var color = ThemeColor.teal
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            FieldLabel(text: label)
            Text(tr(value)).font(.system(size: 18, weight: .bold, design: .monospaced))
                .foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(15).frame(maxWidth: .infinity, alignment: .leading)
        .background(ThemeColor.sunken, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(ThemeColor.stroke))
    }
}

struct StatusTag: View {
    let text: String
    let color: Color
    var body: some View {
        Text(tr(text)).font(.system(size: 10, weight: .bold, design: .monospaced))
            .tracking(0.5)
            .padding(.horizontal, 9).padding(.vertical, 5)
            .foregroundStyle(color)
            .background(color.opacity(0.12), in: Capsule())
            .overlay(Capsule().stroke(color.opacity(0.25)))
    }
}

struct MonospaceBox: View {
    let text: String
    var minHeight: CGFloat = 200
    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            Text(text.isEmpty ? tr("(Keine Daten)") : text)
                .font(.system(size: 11.5, weight: .regular, design: .monospaced))
                .foregroundStyle(Color(red: 0.79, green: 0.91, blue: 0.96))
                .lineSpacing(4)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .padding(17)
        }
        .frame(minHeight: minHeight)
        .background(ThemeColor.sunken, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(ThemeColor.stroke))
    }
}

struct IconAction: View {
    let title: String
    let icon: String
    var prominent = false
    var destructive = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(tr(title), systemImage: icon)
                .font(.system(size: 12, weight: .semibold))
                .padding(.vertical, 5)
        }
        .buttonStyle(.borderedProminent)
        .tint(destructive ? ThemeColor.amber : (prominent ? ThemeColor.teal : ThemeColor.panel))
    }
}
