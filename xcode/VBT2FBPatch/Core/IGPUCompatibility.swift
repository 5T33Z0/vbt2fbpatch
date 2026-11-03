import Foundation

struct IGPUModel: Codable, Identifiable {
    let deviceId: String
    let name: String
    let generation: String
    let series: String
    let architecture: String
    var status: String
    var statusDescription: String
    let recommendedPlatformId: String
    var recommendedSpoofDeviceId: String?
    var recommendedBootArgs: String?
    let notes: String
    let macosVersionSupport: String

    var id: String { deviceId }
    var statusLabel: String {
        switch status {
        case "native": return "NATIV"
        case "needs_spoof": return "SPOOF NÖTIG"
        case "legacy_ventura": return "LEGACY"
        case "unsupported": return "NICHT UNTERSTÜTZT"
        default: return status.uppercased()
        }
    }
}

struct IGPUAnalysis {
    let model: IGPUModel
    let recommendedSpoof: String?
    let bootArgs: String?
    let warnings: [String]
    var needsSpoof: Bool { model.status == "needs_spoof" || model.status == "legacy_ventura" }
}

enum IGPUCompatibility {
    static let database: [String: IGPUModel] = {
        guard let url = Bundle.main.url(forResource: "igpu-database", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let result = try? JSONDecoder().decode([String: IGPUModel].self, from: data) else { return [:] }
        return result
    }()

    static func analyze(deviceID raw: String, macOS: String) -> IGPUAnalysis {
        let id = String(raw.uppercased().filter { $0.isHexDigit }.suffix(4))
        let padded = String(repeating: "0", count: max(0, 4-id.count)) + id
        var model = database[padded] ?? IGPUModel(
            deviceId: padded,
            name: "Intel Graphics Controller (0x\(padded))",
            generation: "Unbekannte Intel iGPU",
            series: "desktop", architecture: "Intel Graphics",
            status: "needs_spoof",
            statusDescription: "Unbekannte Device-ID. Spoof nur nach Prüfung der GPU-Generation!",
            recommendedPlatformId: "07009B3E",
            recommendedSpoofDeviceId: "3E9B",
            recommendedBootArgs: nil, notes: "Unbekannte Hardware sollte nicht blind gepatcht werden.",
            macosVersionSupport: "Ungeprüft"
        )
        if padded == "3E98" {
            if version(macOS, atLeast: "10.14.4") {
                model.status = "native"; model.recommendedSpoofDeviceId = nil
                model.statusDescription = "Nativ ab macOS 10.14.4 unterstützt."
            } else {
                model.status = "needs_spoof"; model.recommendedSpoofDeviceId = "3E92"
            }
        } else if padded == "5917" {
            if version(macOS, atLeast: "10.13.6") {
                model.status = "native"; model.recommendedSpoofDeviceId = nil
                model.statusDescription = "Nativ ab macOS 10.13.6 unterstützt."
            } else {
                model.status = "needs_spoof"; model.recommendedSpoofDeviceId = "5916"
            }
        } else if ["1912", "1916", "191B"].contains(padded) {
            if version(macOS, atLeast: "13.0") {
                model.status = "needs_spoof"
                model.recommendedSpoofDeviceId = padded == "1912" ? "5912" : "5916"
                model.recommendedBootArgs = "-igfxsklaskbl"
                model.statusDescription = "Skylake-Treiber fehlen ab Ventura. Kaby-Lake-Spoof + Boot-Argument notwendig."
            } else {
                model.status = "native"
                model.recommendedSpoofDeviceId = nil
                model.recommendedBootArgs = nil
                model.statusDescription = "Nativ unterstützt bis einschließlich Monterey."
            }
        }
        var warnings: [String] = []
        if model.status == "unsupported" {
            warnings.append("Diese iGPU besitzt keinen macOS-Grafiktreiber. Ein Spoof allein kann keine Beschleunigung ermöglichen.")
        } else if model.status == "needs_spoof" || model.status == "legacy_ventura" {
            if let spoof = model.recommendedSpoofDeviceId {
                warnings.append("WhateverGreen device-id 0x\(spoof) für Device 0x\(padded) empfohlen.")
            }
        }
        if let arg = model.recommendedBootArgs, !arg.isEmpty { warnings.append("Boot-Argument erforderlich: \(arg)") }
        if database[padded] == nil { warnings.append("Nicht katalogisierte iGPU: Generation und Plattform-ID selbst prüfen.") }
        return IGPUAnalysis(model: model, recommendedSpoof: model.recommendedSpoofDeviceId,
                            bootArgs: model.recommendedBootArgs, warnings: warnings)
    }

    static func version(_ raw: String, atLeast reference: String) -> Bool {
        func parts(_ text: String) -> [Int] {
            var result = text.split(separator: ".").prefix(3).map { Int($0) ?? 0 }
            while result.count < 3 { result.append(0) }
            return result
        }
        let a = parts(raw), b = parts(reference)
        for i in 0..<3 {
            if a[i] > b[i] { return true }
            if a[i] < b[i] { return false }
        }
        return true
    }
}
