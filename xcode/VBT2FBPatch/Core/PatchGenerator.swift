import Foundation

struct PatchSettings {
    var platformID: String = "07009B3E"
    var spoofID: String? = nil
    var targetMacOS: String = "14.0"
    var unifiedMemory = true
    var rpsControl = true
    var backlightFix = false
    var mobile = false
    var firstConnector: Int? = nil
    var busIDSource: String = "ddi"
    var pipeOverride: Int? = nil
    var connectorFlags: String = ""
    var framebufferFlags: String = ""
    var lspconMode: String = ""
}

struct PatchProperty: Identifiable {
    var id: String { key }
    let key: String
    let value: Data
}

struct PatchOutput {
    let properties: [PatchProperty]
    let warnings: [String]

    var dictionary: [String: Data] {
        Dictionary(uniqueKeysWithValues: properties.map { ($0.key, $0.value) })
    }

    var xml: String {
        var lines = [
            "<key>DeviceProperties</key>", "<dict>", "\t<key>Add</key>", "\t<dict>",
            "\t\t<key>PciRoot(0x0)/Pci(0x2,0x0)</key>", "\t\t<dict>"
        ]
        for property in properties {
            lines.append("\t\t\t<key>\(property.key)</key>")
            lines.append("\t\t\t<data>\(property.value.base64EncodedString())</data> <!-- <\(property.value.hexString)> -->")
        }
        lines += ["\t\t</dict>", "\t</dict>", "</dict>"]
        return lines.joined(separator: "\n")
    }
}

enum PatchError: LocalizedError {
    case badPlatform
    case badSpoof
    case badNumber(String)
    case invalidPlist
    case invalidStructure(String)

    var errorDescription: String? {
        switch self {
        case .badPlatform: return "Platform-ID muss aus genau 8 Hex-Zeichen bestehen (z.B. 07009B3E)."
        case .badSpoof: return "Spoof Device-ID muss aus genau 4 Hex-Zeichen bestehen (z.B. 3E9B)."
        case .badNumber(let label): return "Ungültige Zahl/Hex-Wert: \(label)."
        case .invalidPlist: return "Die ausgewählte Datei ist keine gültige XML- oder Binär-Plist."
        case .invalidStructure(let detail): return "config.plist enthält einen unerwarteten Wert: \(detail)."
        }
    }
}

enum PatchGenerator {
    static let pciPath = "PciRoot(0x0)/Pci(0x2,0x0)"

    static func make(from vbt: ParsedVBT, settings s: PatchSettings) throws -> PatchOutput {
        let pid = s.platformID.uppercased()
        guard pid.count == 8, pid.allSatisfy(\.isHexDigit),
              let pidData = Data(hex: pid) else { throw PatchError.badPlatform }
        var list: [PatchProperty] = []
        func add(_ key: String, _ data: Data) { list.append(PatchProperty(key: key, value: data)) }
        func add32(_ key: String, _ value: UInt32) { add(key, .le32(value)) }

        add("AAPL,ig-platform-id", pidData)
        if let spoof = s.spoofID, !spoof.isEmpty {
            let id = spoof.uppercased()
            guard id.count == 4, id.allSatisfy(\.isHexDigit),
                  let numeric = UInt32(id, radix: 16) else { throw PatchError.badSpoof }
            add32("device-id", numeric)
        }
        add32("framebuffer-patch-enable", 1)
        if s.mobile { add32("framebuffer-portcount", 3) }
        if !s.framebufferFlags.trimmingCharacters(in: .whitespaces).isEmpty {
            add32("framebuffer-flags", try flag(s.framebufferFlags, name: "Framebuffer Flags"))
        }

        let sorted = vbt.connectors.sorted {
            if $0.isInternal != $1.isInternal { return $0.isInternal }
            return $0.intelPort < $1.intelPort
        }
        let hasPanel = sorted.contains(where: \.isInternal)
        let start = s.firstConnector ?? (hasPanel ? 0 : 1)
        guard (0...3).contains(start) else { throw PatchError.badNumber("First Connector con0...con3") }
        let count = min(s.mobile ? 3 : 4, 4 - start)
        let kept = Array(sorted.prefix(max(0, count)))
        var warnings: [String] = []
        if sorted.count > kept.count {
            warnings.append("\(sorted.count - kept.count) Anschluss/Anschlüsse passen nicht in con0...con3 und werden nicht gepatcht.")
        }
        if sorted.filter(\.isInternal).count > 1 {
            warnings.append("Mehrere interne Panels gefunden. Connector-Zuordnung bitte manuell prüfen.")
        }
        if let pipe = s.pipeOverride, !(0...255).contains(pipe) {
            throw PatchError.badNumber("Pipe (0...255)")
        }

        let cFlags = s.connectorFlags.trimmingCharacters(in: .whitespaces)
        let conFlags = cFlags.isEmpty ? nil : try flag(cFlags, name: "Connector Flags")
        var anyLSPCON = false
        var externalIndex = 0
        for (i, con) in kept.enumerated() {
            let n = start + i
            let prefix = "framebuffer-con\(n)-"
            var bus = con.appleBusId
            if s.busIDSource == "ddc" && !con.isInternal && ["HDMI", "DVI-D", "DP++"].contains(con.kind) {
                if [4, 5, 6].contains(con.ddcPin) { bus = con.ddcPin }
                else { warnings.append("DDI \(con.intelPort): DDC-Pin \(con.ddcPin) nicht 4/5/6, verwende DDI-Bus-ID.") }
            }
            // FAQ: internal panel pipe 8, external ports 9, 10, 7 (desktop: 9,10,8,7).
            let defaultPipes = hasPanel ? [9, 10, 7] : [9, 10, 8, 7]
            let pipe: Int
            if con.isInternal { pipe = 8 }
            else {
                pipe = defaultPipes[externalIndex % defaultPipes.count]
                externalIndex += 1
            }
            add32(prefix + "enable", 1)
            add32(prefix + "busid", UInt32(bus))
            add32(prefix + "type", con.appleType)
            add32(prefix + "pipe", UInt32(s.pipeOverride ?? pipe))
            if let conFlags, !con.isInternal { add32(prefix + "flags", conFlags) }
            if con.isLSPCON {
                anyLSPCON = true
                add32(prefix + "has-lspcon", 1)
                if s.lspconMode == "pcon" { add32(prefix + "preferred-lspcon-mode", 1) }
                if s.lspconMode == "ls" { add32(prefix + "preferred-lspcon-mode", 0) }
            }
        }
        if anyLSPCON { add32("enable-lspcon-support", 1) }
        if s.backlightFix {
            let isNew = IGPUCompatibility.version(s.targetMacOS, atLeast: "13.4")
            add32(isNew ? "enable-backlight-registers-alternative-fix" : "enable-backlight-registers-fix", 1)
        }
        if s.unifiedMemory { add32("framebuffer-unifiedmem", 0x80000000) }
        if s.rpsControl { add32("rps-control", 1) }

        return PatchOutput(properties: list, warnings: warnings)
    }

    private static func flag(_ raw: String, name: String) throws -> UInt32 {
        let hex = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "0x", with: "", options: [.caseInsensitive])
        guard !hex.isEmpty, hex.allSatisfy(\.isHexDigit),
              let value = UInt32(hex, radix: 16) else { throw PatchError.badNumber(name) }
        return value
    }

    static func mergedPlist(original: Data, patch: PatchOutput) throws -> Data {
        var format = PropertyListSerialization.PropertyListFormat.xml
        guard let obj = try? PropertyListSerialization.propertyList(from: original, options: [], format: &format),
              var root = obj as? [String: Any] else { throw PatchError.invalidPlist }

        var deviceProperties = (root["DeviceProperties"] as? [String: Any]) ?? [:]
        if let old = root["DeviceProperties"], !(old is [String: Any]) { throw PatchError.invalidStructure("DeviceProperties") }
        var add = (deviceProperties["Add"] as? [String: Any]) ?? [:]
        if let old = deviceProperties["Add"], !(old is [String: Any]) { throw PatchError.invalidStructure("DeviceProperties/Add") }
        var igpu = (add[pciPath] as? [String: Any]) ?? [:]
        if let old = add[pciPath], !(old is [String: Any]) { throw PatchError.invalidStructure(pciPath) }
        for p in patch.properties { igpu[p.key] = p.value }
        add[pciPath] = igpu
        deviceProperties["Add"] = add
        root["DeviceProperties"] = deviceProperties
        return try PropertyListSerialization.data(fromPropertyList: root, format: .xml, options: 0)
    }

    static func terminalTable(_ vbt: ParsedVBT, first: Int?) -> String {
        let rows = vbt.connectors.enumerated().map { i, c in
            [
                "con\((first ?? (vbt.connectors.contains { $0.isInternal } ? 0 : 1)) + i)",
                c.intelPort, String(format:"0x%02X",c.dvoPort),c.kind,
                String(format:"0x%02X",c.appleBusId),c.typeHex,
                String(format:"0x%02X",c.pipe)
            ]
        }
        let headers = ["CON", "INTEL PORT", "DVO", "TYPE", "BUS ID", "TYPE (LE)", "PIPE"]
        let widths = headers.indices.map { idx in max(headers[idx].count, rows.map { $0[idx].count }.max() ?? 0) }
        let border = "+" + widths.map { String(repeating: "-", count: $0 + 2) }.joined(separator: "+") + "+"
        func line(_ row: [String]) -> String {
            "| " + row.enumerated().map { i, v in v.padding(toLength: widths[i], withPad: " ", startingAt: 0) }.joined(separator: " | ") + " |"
        }
        return ([border, line(headers), border] + rows.map(line) + [border]).joined(separator: "\n")
    }

    static func hexDump(_ bytes: Data, maxBytes: Int = 16_384) -> String {
        let b = [UInt8](bytes.prefix(maxBytes))
        var lines: [String] = []
        for offset in stride(from: 0, to: b.count, by: 16) {
            let slice = Array(b[offset..<min(offset + 16, b.count)])
            let hex = slice.map { String(format: "%02X", $0) }.joined(separator: " ")
            let ascii = slice.map { (32...126).contains(Int($0)) ? String(UnicodeScalar(Int($0))!) : "." }.joined()
            lines.append(String(format: "%08X  ",offset) + hex.padding(toLength: 47, withPad: " ", startingAt: 0) + "  " + ascii)
        }
        if bytes.count > maxBytes { lines.append("… \(bytes.count - maxBytes) weitere Bytes") }
        return lines.joined(separator: "\n")
    }
}

extension Data {
    init?(hex: String) {
        guard hex.count.isMultiple(of: 2), hex.allSatisfy(\.isHexDigit) else { return nil }
        var result = [UInt8]()
        for i in stride(from: 0, to: hex.count, by: 2) {
            let start = hex.index(hex.startIndex, offsetBy: i)
            let end = hex.index(start, offsetBy: 2)
            guard let b = UInt8(hex[start..<end], radix: 16) else { return nil }
            result.append(b)
        }
        self.init(result)
    }
}
