import AppKit
import Combine
import Foundation
import SwiftUI

enum WorkspacePage: String, CaseIterable, Identifiable {
    case overview = "Routing"
    case compatibility = "iGPU Datenbank"
    case connectors = "Connector-Tabelle"
    case xml = "OpenCore XML"
    case merge = "config.plist Merge"
    case terminal = "Terminal"
    case hex = "Hex-Inspector"
    case cli = "CLI & Guide"

    var id: String { rawValue }
    var icon: String {
        switch self {
        case .overview: return "point.3.connected.trianglepath.dotted"
        case .compatibility: return "cpu"
        case .connectors: return "list.bullet.rectangle"
        case .xml: return "chevron.left.forwardslash.chevron.right"
        case .merge: return "square.on.square"
        case .terminal: return "terminal"
        case .hex: return "number"
        case .cli: return "apple.terminal"
        }
    }
}

struct VBTSample: Identifiable {
    let filename: String
    let title: String
    let detail: String
    let deviceID: String
    let platformID: String
    var id: String { filename }

    static let all = [
        VBTSample(filename:"cfl_desktop_vbt.bin", title:"Coffee Lake Desktop",
                  detail:"Z390 · UHD 630 · HDMI + 2x DP", deviceID:"3E9B", platformID:"07009B3E"),
        VBTSample(filename:"cml_laptop_vbt.bin", title:"Comet Lake Laptop",
                  detail:"UHD 630 · eDP + HDMI 2.0", deviceID:"9BC4", platformID:"00009B3E"),
        VBTSample(filename:"kbl_nuc_vbt.bin", title:"Kaby Lake NUC",
                  detail:"Iris Plus 650 · HDMI + USB-C DP", deviceID:"5926", platformID:"00001659"),
        VBTSample(filename:"block28_direct_vbt.bin", title:"Direct Block 0x28",
                  detail:"DDI B DisplayPort + DDI C DVI-D", deviceID:"3E9B", platformID:"07009B3E"),
        VBTSample(filename:"oem_checksum_dc_vbt.bin", title:"OEM BIOS Dump",
                  detail:"Intel BIOS Data Block · Checksum 0xDC", deviceID:"3E98", platformID:"07009B3E")
    ]
}

@MainActor
final class Workbench: ObservableObject {
    @Published var page: WorkspacePage = .overview
    @Published var selectedSample: String = VBTSample.all[0].filename
    @Published var sourceName = ""
    @Published var sourceData = Data()
    @Published var parsed: ParsedVBT?
    @Published var parseError: String?
    @Published var deviceID = "3E9B"
    @Published var platformID = "07009B3E"
    @Published var targetMacOS = "14.0"
    @Published var formFactor = "auto"
    @Published var spoofMode = "auto"
    @Published var customSpoofID = ""
    @Published var unifiedMemory = true
    @Published var rpsControl = true
    @Published var backlightFix = false
    @Published var mobileMode = false
    @Published var firstConnector = "auto"
    @Published var busIDSource = "ddi"
    @Published var pipeOverride = ""
    @Published var connectorFlags = ""
    @Published var framebufferFlags = ""
    @Published var lspconMode = ""
    @Published var searchQuery = ""
    @Published var plistURL: URL?
    @Published var plistSource = Data()
    @Published var cliOutput = ""
    @Published var cliRunning = false
    @Published var notice: String?
    @Published var error: String?

    init() { loadSample(VBTSample.all[0].filename) }

    var analysis: IGPUAnalysis { IGPUCompatibility.analyze(deviceID: deviceID, macOS: targetMacOS) }
    var isSpoofActive: Bool {
        switch spoofMode {
        case "on": return true
        case "off": return false
        default: return analysis.needsSpoof && analysis.model.status != "unsupported"
        }
    }
    var effectiveSpoof: String? {
        guard isSpoofActive else { return nil }
        return customSpoofID.isEmpty ? (analysis.recommendedSpoof ?? "3E9B") : customSpoofID
    }

    var settings: PatchSettings {
        PatchSettings(platformID: platformID, spoofID: effectiveSpoof, targetMacOS: targetMacOS,
                      unifiedMemory: unifiedMemory, rpsControl: rpsControl, backlightFix: backlightFix,
                      mobile: mobileMode, firstConnector: Int(firstConnector), busIDSource: busIDSource,
                      pipeOverride: Int(pipeOverride), connectorFlags: connectorFlags,
                      framebufferFlags: framebufferFlags, lspconMode: lspconMode)
    }

    var currentPatch: PatchOutput? {
        guard let parsed else { return nil }
        return try? PatchGenerator.make(from: parsed, settings: settings)
    }

    var patchError: String? {
        guard let parsed else { return nil }
        do { _ = try PatchGenerator.make(from: parsed, settings: settings); return nil }
        catch { return error.localizedDescription }
    }

    var xml: String { currentPatch?.xml ?? "" }
    var ascii: String {
        guard let parsed else { return "" }
        return PatchGenerator.terminalTable(parsed, first: Int(firstConnector))
    }

    var mergedPlistData: Data? {
        guard let patch = currentPatch, !plistSource.isEmpty else { return nil }
        return try? PatchGenerator.mergedPlist(original: plistSource, patch: patch)
    }
    var mergedPlistText: String {
        guard let data = mergedPlistData else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }

    var filteredGPUs: [IGPUModel] {
        let list = Array(IGPUCompatibility.database.values).sorted { $0.deviceId < $1.deviceId }
        guard !searchQuery.isEmpty else { return list }
        return list.filter {
            $0.deviceId.localizedCaseInsensitiveContains(searchQuery) ||
            $0.name.localizedCaseInsensitiveContains(searchQuery) ||
            $0.generation.localizedCaseInsensitiveContains(searchQuery)
        }
    }

    func loadSample(_ filename: String) {
        guard let sample = VBTSample.all.first(where: { $0.filename == filename }) else { return }
        let stem = (filename as NSString).deletingPathExtension
        guard let file = Bundle.main.url(forResource: stem, withExtension: "bin", subdirectory: "Samples")
                ?? Bundle.main.url(forResource: stem, withExtension: "bin", subdirectory: "Resources/Samples")
                ?? Bundle.main.url(forResource: stem, withExtension: "bin") else {
            error = "Sample \(filename) nicht im App-Bundle gefunden."
            return
        }
        do {
            let data = try Data(contentsOf: file)
            selectedSample = filename
            deviceID = sample.deviceID
            platformID = sample.platformID
            spoofMode = "auto"
            customSpoofID = ""
            setVBT(data, name: filename)
        } catch { self.error = error.localizedDescription }
    }

    func setVBT(_ data: Data, name: String) {
        sourceData = data
        sourceName = name
        parseError = nil
        do {
            let result = try VBTParser.parse(data)
            parsed = result
            if let detected = result.pciDeviceID {
                deviceID = detected
                spoofMode = "auto"
            }
        } catch {
            parsed = nil
            parseError = error.localizedDescription
        }
    }

    func openVBT() {
        let panel = NSOpenPanel()
        panel.title = "Intel Video BIOS Table öffnen"
        panel.prompt = "VBT laden"
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.begin { [weak self] result in
            guard result == .OK, let url = panel.url else { return }
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            do {
                let data = try Data(contentsOf: url)
                self?.selectedSample = ""
                self?.setVBT(data, name: url.lastPathComponent)
            } catch { self?.error = error.localizedDescription }
        }
    }

    func openPlist() {
        let panel = NSOpenPanel()
        panel.title = "OpenCore config.plist auswählen"
        panel.prompt = "config.plist laden"
        panel.canChooseDirectories = false
        panel.begin { [weak self] result in
            guard result == .OK, let url = panel.url else { return }
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            do {
                let data = try Data(contentsOf: url)
                var fmt = PropertyListSerialization.PropertyListFormat.xml
                guard (try? PropertyListSerialization.propertyList(from: data, options: [], format: &fmt)) is [String: Any] else {
                    throw PatchError.invalidPlist
                }
                self?.plistSource = data
                self?.plistURL = url
                self?.page = .merge
                self?.notice = "config.plist geladen. Merge-Vorschau verfügbar."
            } catch { self?.error = error.localizedDescription }
        }
    }

    func saveXML() {
        guard let patch = currentPatch else { error = patchError ?? "Kein VBT geladen."; return }
        save(data: Data(patch.xml.utf8), suggested: "OpenCore_Framebuffer_\(platformID).xml")
    }

    func exportMergedPlist() {
        guard let data = mergedPlistData else {
            error = "Zuerst eine config.plist und eine gültige VBT laden."
            return
        }
        save(data: data, suggested: "config-patched.plist")
    }

    func save(data: Data, suggested: String) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggested
        panel.canCreateDirectories = true
        if panel.runModal() == .OK, let url = panel.url {
            do {
                try data.write(to: url, options: .atomic)
                notice = "Exportiert: \(url.lastPathComponent)"
            } catch { self.error = error.localizedDescription }
        }
    }

    // The in-place action is explicit, and a separate timestamped backup is created first.
    func applyMergeInPlace() {
        guard let url = plistURL, let data = mergedPlistData else {
            error = "Bitte gültige config.plist laden und einen Patch erzeugen."
            return
        }
        let alert = NSAlert()
        alert.messageText = "OpenCore config.plist wirklich ändern?"
        alert.informativeText = "Die Datei wird nach einem Backup überschrieben. EFI vor dem Booten prüfen. Unbekannte Keys bleiben erhalten."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Backup + Patch anwenden")
        alert.addButton(withTitle: "Abbrechen")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let bak = URL(fileURLWithPath: url.path + ".\(stamp).bak")
        do {
            try FileManager.default.copyItem(at: url, to: bak)
            try data.write(to: url, options: .atomic)
            plistSource = data
            notice = "config.plist gepatcht. Backup: \(bak.lastPathComponent)"
        } catch {
            self.error = "Patch abgebrochen. \(error.localizedDescription)"
        }
    }

    func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        notice = "In die Zwischenablage kopiert."
    }

    func cliCommand() -> String {
        var args = ["python3 vbt2fbpatch.py", "-i \(sourceName.isEmpty ? "vbt.bin" : sourceName)", "-d \(deviceID)",
                    "-p \(platformID)", "-t \(targetMacOS)"]
        if let spoof = effectiveSpoof { args.append("--spoof-id \(spoof)") }
        if formFactor != "auto" { args.append("-f \(formFactor)") }
        if unifiedMemory { args.append("--unifiedmem") }
        if rpsControl { args.append("--rps-control") }
        if backlightFix { args.append("--backlight-fix") }
        if mobileMode { args.append("--mobile") }
        if let index = Int(firstConnector) { args.append("--first-con \(index)") }
        if busIDSource != "ddi" { args.append("--bus-id-source \(busIDSource)") }
        if let pipe = Int(pipeOverride) { args.append("--pipe \(pipe)") }
        if !connectorFlags.isEmpty { args.append("--con-flags \(connectorFlags)") }
        if !framebufferFlags.isEmpty { args.append("--fb-flags \(framebufferFlags)") }
        if !lspconMode.isEmpty { args.append("--lspcon-mode \(lspconMode)") }
        return args.joined(separator: " \\\n  ")
    }

    func exportCLI() {
        guard let file = Bundle.main.url(forResource: "vbt2fbpatch", withExtension: "py"),
              let data = try? Data(contentsOf: file) else {
            error = "CLI-Quellcode nicht im Bundle gefunden."
            return
        }
        save(data: data, suggested: "vbt2fbpatch.py")
    }

    func runCLI(json: Bool = false) {
        guard !sourceData.isEmpty else { error = "Erst VBT laden."; return }
        guard let script = Bundle.main.url(forResource: "vbt2fbpatch", withExtension: "py") else {
            error = "Python-CLI nicht im App-Bundle gefunden."; return
        }
        cliRunning = true
        let bytes = sourceData
        let options = settings
        let dev = deviceID
        let factor = formFactor
        let pythonScript = script
        DispatchQueue.global(qos: .userInitiated).async {
            let dir = FileManager.default.temporaryDirectory
                .appendingPathComponent("vbt2fbpatch-\(UUID().uuidString)", isDirectory: true)
            var result = ""
            do {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                defer { try? FileManager.default.removeItem(at: dir) }
                let input = dir.appendingPathComponent("vbt.bin")
                try bytes.write(to: input)
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
                var argv = [pythonScript.path, "-i", input.path, "-d", dev, "-p", options.platformID,
                            "-t", options.targetMacOS, "--verbose"]
                if let spoof = options.spoofID { argv += ["--spoof-id", spoof] }
                if factor != "auto" { argv += ["-f", factor] }
                if options.unifiedMemory { argv.append("--unifiedmem") }
                if options.rpsControl { argv.append("--rps-control") }
                if options.backlightFix { argv.append("--backlight-fix") }
                if options.mobile { argv.append("--mobile") }
                if let first = options.firstConnector { argv += ["--first-con", String(first)] }
                if options.busIDSource != "ddi" { argv += ["--bus-id-source", options.busIDSource] }
                if let pipe = options.pipeOverride { argv += ["--pipe", String(pipe)] }
                if !options.connectorFlags.isEmpty { argv += ["--con-flags", options.connectorFlags] }
                if !options.framebufferFlags.isEmpty { argv += ["--fb-flags", options.framebufferFlags] }
                if !options.lspconMode.isEmpty { argv += ["--lspcon-mode", options.lspconMode] }
                if json { argv.append("--json") }
                process.arguments = argv
                let output = Pipe()
                process.standardOutput = output
                process.standardError = output
                try process.run()
                let collected = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                result = String(data: collected, encoding: .utf8) ?? "(Keine Ausgabe)"
                if process.terminationStatus != 0 {
                    result = "[CLI exit \(process.terminationStatus)]\n" + result
                }
            } catch {
                result = "Python-CLI konnte nicht gestartet werden: \(error.localizedDescription)\nDie native Swift-Patch-Engine ist weiterhin nutzbar."
            }
            DispatchQueue.main.async {
                self.cliOutput = result
                self.cliRunning = false
            }
        }
    }
}
