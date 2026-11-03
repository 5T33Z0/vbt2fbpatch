import Foundation

// Native port of src/vbtParser.ts. No browser, Node server or Python required to inspect VBTs.
struct VBTBlock: Identifiable {
    let id: Int
    let name: String
    let size: Int
    let offset: Int
}

struct VBTConnector: Identifiable {
    let id: Int
    let slot: Int
    let handle: Int
    let deviceType: Int
    let dvoPort: Int
    let auxChannel: Int
    let ddcPin: Int
    let hpdPin: Int
    let flags: Int
    let intelPort: String
    let kind: String
    let active: Bool
    let appleBusId: Int
    let appleType: UInt32
    let pipe: Int

    var isInternal: Bool { kind == "eDP" }
    var isLSPCON: Bool { flags & 0x04 != 0 }
    var typeData: Data { Data.le32(appleType) }
    var typeHex: String { typeData.hexString }
}

struct ParsedVBT {
    let vbtOffset: Int
    let version: Int
    let bdbOffset: Int
    let bdbVersion: Int
    let stride: Int
    let blocks: [VBTBlock]
    let allDevices: [VBTConnector]
    let connectors: [VBTConnector]
    let pciDeviceID: String?
}

enum VBTError: LocalizedError {
    case missingVBT
    case missingBDB
    case missingConnectors
    case invalidData(String)

    var errorDescription: String? {
        switch self {
        case .missingVBT: return "Keine $VBT-Signatur gefunden. Bitte eine Intel VBT .bin/.rom auswählen."
        case .missingBDB: return "Kein gültiger BIOS Data Block ($BDB / BIOS_DATA_BLOCK) gefunden."
        case .missingConnectors: return "Weder BDB-Block 0x02 noch Block 0x28 mit Child Devices gefunden."
        case .invalidData(let detail): return "Ungültige VBT: \(detail)"
        }
    }
}

extension Data {
    static func le32(_ value: UInt32) -> Data {
        Data((0..<4).map { UInt8((value >> ($0 * 8)) & 0xFF) })
    }
    var hexString: String { map { String(format: "%02X", $0) }.joined() }
}

enum VBTParser {
    static let pipes = [0x09, 0x0A, 0x08, 0x07]

    private static let blockNames: [Int: String] = [
        1: "General Features", 2: "General Definitions", 3: "Display Toggle",
        4: "Mode Support List", 5: "Generic Mode Table", 6: "Extended MMIO",
        0x14: "Driver Persistence", 0x28: "Child Device Config",
        0x29: "LFP Data Pointers", 0x2A: "LFP Data", 0x2B: "LFP Backlight"
    ]

    static func parse(_ data: Data) throws -> ParsedVBT {
        let bytes = [UInt8](data)
        func u16(_ i: Int) -> Int? {
            guard i >= 0, i + 1 < bytes.count else { return nil }
            return Int(bytes[i]) | Int(bytes[i + 1]) << 8
        }
        func u32(_ i: Int) -> Int? {
            guard let lo = u16(i), let hi = u16(i + 2) else { return nil }
            return lo | hi << 16
        }
        func find(_ pattern: [UInt8]) -> Int? {
            guard bytes.count >= pattern.count else { return nil }
            return (0...(bytes.count - pattern.count)).first {
                bytes[$0..<$0 + pattern.count].elementsEqual(pattern)
            }
        }
        guard let vbt = find(Array("$VBT".utf8)) else { throw VBTError.missingVBT }
        let version = u16(vbt + 0x14) ?? 0

        func signature(at off: Int) -> String? {
            guard off >= 0, off + 4 <= bytes.count else { return nil }
            if off + 15 <= bytes.count,
               bytes[off..<off + 15].elementsEqual(Array("BIOS_DATA_BLOCK".utf8)) {
                return "BIOS_DATA_BLOCK"
            }
            if bytes[off..<off + 4].elementsEqual(Array("$BDB".utf8)) { return "$BDB" }
            if off + 10 <= bytes.count, bytes[off..<off + 3].elementsEqual(Array("BDB".utf8)) { return "BDB" }
            return nil
        }
        var candidates: [Int] = []
        if let n = u32(vbt + 0x1C), n > 0, vbt + n < bytes.count { candidates.append(vbt + n) }
        if let n = u16(vbt + 0x1A), n > 0, vbt + n < bytes.count { candidates.append(vbt + n) }
        if let n = u16(vbt + 0x16), n > 0, vbt + n < bytes.count { candidates.append(vbt + n) }
        var bdb = candidates.first { signature(at: $0) != nil }
        if bdb == nil { bdb = find(Array("BIOS_DATA_BLOCK".utf8)) }
        if bdb == nil { bdb = find(Array("$BDB".utf8)) }
        guard let bdb, let sig = signature(at: bdb) else { throw VBTError.missingBDB }

        let longHeader = sig == "BIOS_DATA_BLOCK"
        let bdbVersion = u16(bdb + (longHeader ? 16 : 4)) ?? 0
        let rawHeader = u16(bdb + (longHeader ? 18 : 6)) ?? (longHeader ? 22 : 16)
        let headerSize = (longHeader ? 16...64 : 4...64).contains(rawHeader) ? rawHeader : (longHeader ? 22 : 16)
        let rawSize = u16(bdb + (longHeader ? 20 : 8)) ?? (bytes.count - bdb)
        let totalSize = rawSize > headerSize ? rawSize : bytes.count - bdb
        let end = min(bytes.count, bdb + totalSize)
        var index = bdb + headerSize
        var blocks: [VBTBlock] = []
        var blockData: [Int: [UInt8]] = [:]
        while index + 3 <= end {
            guard let size = u16(index + 1), size > 0 else { break }
            let id = Int(bytes[index])
            let start = index + 3
            guard start + size <= end else { break }
            blockData[id] = Array(bytes[start..<start + size])
            blocks.append(VBTBlock(id: id, name: blockNames[id] ?? String(format: "Block 0x%02X", id),
                                   size: size, offset: index))
            index = start + size
        }

        let general = blockData[0x02]
        let direct = blockData[0x28]
        let knownStrides = [33, 37, 38, 39, 40]
        func estimate(_ b: [UInt8]?, generalHeader: Bool) -> Int {
            guard let b else { return 0 }
            let stride = generalHeader && b.count >= 5 && knownStrides.contains(Int(b[4])) ? Int(b[4]) : 40
            return max(0, b.count - (generalHeader ? 5 : 0)) / stride
        }
        let useGeneral = (general != nil && estimate(general, generalHeader: true) > 0) ||
            (general != nil && estimate(direct, generalHeader: false) == 0)
        guard let selected = useGeneral ? general : direct else { throw VBTError.missingConnectors }
        var payload = selected
        var stride = 40
        if useGeneral, selected.count >= 5 {
            if knownStrides.contains(Int(selected[4])) { stride = Int(selected[4]) }
            payload = Array(selected.dropFirst(5))
        } else if selected.count >= 5, knownStrides.contains(Int(selected[4])),
                  (selected.count - 5) % Int(selected[4]) == 0 {
            stride = Int(selected[4])
            payload = Array(selected.dropFirst(5))
        } else {
            stride = detectStride(selected)
        }
        guard stride > 0 else { throw VBTError.invalidData("Ungültige Child-Device-Größe") }

        var all: [VBTConnector] = []
        var active: [VBTConnector] = []
        for slot in 0..<(payload.count / stride) {
            let start = slot * stride
            let entry = Array(payload[start..<start + stride])
            guard entry.count >= 20 else { continue }
            let handle = Int(entry[0]) | Int(entry[1]) << 8
            let type = Int(entry[2]) | Int(entry[3]) << 8
            let port = Int(entry[16])
            let ddc = Int(entry[19])
            let aux = entry.count > 23 ? Int(entry[23]) : 0
            let hpd = entry.count > 27 ? Int(entry[27]) : 0
            let flags = entry.count > 28 ? Int(entry[28]) : 0
            let name = intelPort(port)
            let kind = connectorType(type, port)
            let enabled = type != 0 && type != 0xFFFF && port != 0xFF && (port != 6 || type & 0x20 != 0)
            let con = VBTConnector(id: slot, slot: slot, handle: handle, deviceType: type,
                                   dvoPort: port, auxChannel: aux, ddcPin: ddc, hpdPin: hpd,
                                   flags: flags, intelPort: name, kind: kind, active: enabled,
                                   appleBusId: appleBus(name), appleType: appleType(kind),
                                   pipe: pipes[min(active.count, pipes.count - 1)])
            all.append(con)
            if enabled { active.append(con) }
        }
        return ParsedVBT(vbtOffset: vbt, version: version, bdbOffset: bdb,
                         bdbVersion: bdbVersion, stride: stride, blocks: blocks,
                         allDevices: all, connectors: active, pciDeviceID: pciID(bytes))
    }

    private static func detectStride(_ b: [UInt8]) -> Int {
        var best = 40, bestScore = -1
        let knownPorts: Set<Int> = Set(0...14)
        for stride in [40, 37, 38, 33] where b.count >= stride {
            var score = 0
            for i in 0..<min(8, b.count / stride) {
                let off = i * stride
                let dtype = Int(b[off + 2]) | Int(b[off + 3]) << 8
                if dtype != 0 && dtype != 0xFFFF { score += 2 }
                if knownPorts.contains(Int(b[off + 16])) { score += 3 }
            }
            if score > bestScore { best = stride; bestScore = score }
        }
        return best
    }

    private static func intelPort(_ p: Int) -> String {
        switch p {
        case 0, 10: return "DDI A"
        case 1, 7: return "DDI B"
        case 2, 8: return "DDI C"
        case 3, 9: return "DDI D"
        case 5, 11, 12: return "DDI E"
        case 13, 14: return "DDI F"
        case 4: return "LVDS"
        case 6: return "CRT"
        default: return String(format: "Port 0x%02X", p)
        }
    }

    private static func connectorType(_ dt: Int, _ p: Int) -> String {
        if [0x78C6, 0x78D6, 0x1806, 0x0400, 0x0100].contains(dt) ||
            (dt & 0x0100 != 0 && dt & 0x1800 != 0) ||
            ([4, 10].contains(p) && dt & 0x1900 != 0) { return "eDP" }
        if [0x68C6, 0x1404, 0x1406, 0x1804].contains(dt) || dt & 0x1000 != 0 { return "DP" }
        if [0x60D2, 0x60D6, 0x68D2, 0x1004, 0x1006, 0x1202].contains(dt) || dt & 0x0400 != 0 {
            if dt == 0x68D2 { return "DVI-D" }
            if dt == 0x60D6 { return "DP++" }
            return "HDMI"
        }
        if [7, 8, 9, 11, 13].contains(p) { return "DP" }
        return "HDMI"
    }

    private static func appleBus(_ name: String) -> Int {
        switch name {
        case "DDI B": return 5
        case "DDI C": return 4
        case "DDI D": return 6
        case "DDI E": return 1
        case "DDI F": return 2
        default: return 0
        }
    }

    private static func appleType(_ kind: String) -> UInt32 {
        if kind == "eDP" { return 0x00020000 }
        if ["HDMI", "DVI-D", "DP++"].contains(kind) { return 0x00080000 }
        return 0x00040000
    }

    private static func pciID(_ b: [UInt8]) -> String? {
        guard b.count >= 32 else { return nil }
        func parse(at i: Int) -> String? {
            guard i + 16 <= b.count, b[i..<i+4].elementsEqual(Array("PCIR".utf8)) else { return nil }
            let vendor = Int(b[i+4]) | Int(b[i+5]) << 8
            let device = Int(b[i+6]) | Int(b[i+7]) << 8
            return vendor == 0x8086 ? String(format: "%04X", device) : nil
        }
        if b[0] == 0x55 && b[1] == 0xAA {
            let ptr = Int(b[0x18]) | Int(b[0x19]) << 8
            if let result = parse(at: ptr) { return result }
        }
        for i in 0...(b.count - 16) {
            if let result = parse(at: i) { return result }
        }
        return nil
    }
}
