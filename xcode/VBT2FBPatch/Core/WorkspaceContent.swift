import SwiftUI

struct WorkspaceContent: View {
    @ObservedObject var vm: Workbench

    var body: some View {
        VStack(alignment: .leading, spacing: 17) {
            if let vbt = vm.parsed {
                HStack(spacing: 0) {
                    headerValue("VBT OFFSET", String(format: "0x%04X", vbt.vbtOffset))
                    headerValue("VBT VERSION", "\(vbt.version)")
                    headerValue("BDB VERSION", "\(vbt.bdbVersion)")
                    headerValue("CHILD STRIDE", "\(vbt.stride) B")
                    headerValue("AKTIVE PORTS", "\(vbt.connectors.count)", color: ThemeColor.green)
                    if let pci = vbt.pciDeviceID { headerValue("PCI DEVICE", "0x\(pci)") }
                }
                .padding(13)
                .background(ThemeColor.panel, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(ThemeColor.stroke))
            }
            switch vm.page {
            case .overview: overview
            case .compatibility: compatibility
            case .connectors: connectors
            case .xml: xml
            case .merge: merge
            case .terminal: terminal
            case .hex: hex
            case .cli: cli
            }
        }
    }

    private func headerValue(_ label: String, _ value: String, color: Color = .white) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            FieldLabel(text: label)
            Text(value).font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundStyle(color).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var overview: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 13) {
                MiniMetric(label: "Device-ID", value: "0x\(vm.analysis.model.deviceId)")
                MiniMetric(label: "STATUS", value: vm.analysis.model.statusLabel,
                           color: statusColor(vm.analysis.model.status))
                MiniMetric(label: "FRAMEBUFFER", value: "<\(vm.platformID)>", color: ThemeColor.green)
                MiniMetric(label: "OUTPUTS", value: "\(vm.parsed?.connectors.count ?? 0) Ports")
            }
            Panel(title: "Rosetta Stone: Intel Hardware → Apple Framebuffer",
                  subtitle: "Physische DDI-Verkabelung aus dem BIOS und WhateverGreen-Zuordnung",
                  icon: "point.3.connected.trianglepath.dotted") {
                if let vbt = vm.parsed, !vbt.connectors.isEmpty {
                    VStack(spacing: 11) {
                        HStack {
                            FieldLabel(text: "INTEL VBT / HARDWARE")
                            Spacer()
                            FieldLabel(text: "APPLE FRAMEBUFFER / DEVICEPROPERTIES")
                        }
                        ForEach(Array(vbt.connectors.enumerated()), id: \.element.id) { i, con in
                            routingRow(con, index: i, hasPanel: vbt.connectors.contains(where: \.isInternal))
                        }
                    }
                } else {
                    empty("Keine aktiven Connectoren gefunden", "Versuche eine andere VBT-Datei.")
                }
            }
            if !vm.analysis.warnings.isEmpty || !(vm.currentPatch?.warnings.isEmpty ?? true) {
                Panel(title: "Wichtige Hinweise", subtitle: "Aus Kompatibilitätsdatenbank und Patch-Limitierungen",
                      icon: "exclamationmark.triangle") {
                    ForEach(vm.analysis.warnings + (vm.currentPatch?.warnings ?? []), id: \.self) { warning in
                        Label(warning, systemImage: "exclamationmark.triangle.fill")
                            .font(.system(size: 12)).foregroundStyle(ThemeColor.amber)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private func routingRow(_ con: VBTConnector, index: Int, hasPanel: Bool) -> some View {
        let offset = Int(vm.firstConnector) ?? (hasPanel ? 0 : 1)
        return HStack(spacing: 13) {
            HStack(spacing: 12) {
                Image(systemName: con.isInternal ? "laptopcomputer" : (con.kind == "HDMI" ? "display" : "cable.connector"))
                    .font(.system(size: 21))
                    .foregroundStyle(ThemeColor.teal)
                    .frame(width: 40, height: 42)
                    .background(ThemeColor.teal.opacity(0.09), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 4) {
                    Text(con.intelPort).font(.system(size: 14, weight: .bold))
                    Text(String(format:"DVO 0x%02X · DDC %d · AUX %d", con.dvoPort, con.ddcPin, con.auxChannel))
                        .font(.system(size: 10, design: .monospaced)).foregroundStyle(ThemeColor.muted)
                }
                Spacer()
                StatusTag(text: con.kind, color: con.isInternal ? ThemeColor.amber : ThemeColor.green)
            }
            .padding(12).frame(maxWidth: .infinity)
            .background(ThemeColor.sunken, in: RoundedRectangle(cornerRadius: 12))

            VStack(spacing: 4) {
                Image(systemName: "arrow.right").font(.system(size: 20, weight: .bold)).foregroundStyle(ThemeColor.teal)
                Text("ROSETTA").font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .foregroundStyle(ThemeColor.muted)
            }.frame(width: 78)

            HStack(spacing: 13) {
                Image(systemName: "square.stack.3d.up")
                    .font(.system(size: 20)).foregroundStyle(ThemeColor.green)
                    .frame(width: 40, height: 42)
                    .background(ThemeColor.green.opacity(0.09), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 5) {
                    Text("framebuffer-con\(offset + index)")
                        .font(.system(size: 12, weight: .bold, design: .monospaced))
                    HStack(spacing: 15) {
                        Text(String(format:"BUS 0x%02X", con.appleBusId))
                        Text("<\(con.typeHex)>")
                    }.font(.system(size: 10, design: .monospaced)).foregroundStyle(ThemeColor.muted)
                }
                Spacer()
                if con.isLSPCON { StatusTag(text: "LSPCON", color: ThemeColor.amber) }
            }
            .padding(12).frame(maxWidth: .infinity)
            .background(ThemeColor.sunken, in: RoundedRectangle(cornerRadius: 12))
        }
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(ThemeColor.stroke))
    }

    private var compatibility: some View {
        VStack(alignment: .leading, spacing: 17) {
            Panel(title: "WhateverGreen iGPU Compatibility",
                  subtitle: "Intel iGPU Modelldaten, Spoof-Empfehlungen und macOS-Versionen", icon: "cpu") {
                HStack(spacing: 14) {
                    Image(systemName: "cpu.fill").font(.system(size: 30))
                        .foregroundStyle(statusColor(vm.analysis.model.status))
                        .frame(width: 54, height: 54)
                        .background(statusColor(vm.analysis.model.status).opacity(0.10),
                                    in: RoundedRectangle(cornerRadius: 12))
                    VStack(alignment: .leading, spacing: 5) {
                        Text(vm.analysis.model.name).font(.system(size: 18, weight: .semibold))
                        Text(vm.analysis.model.generation + "  ·  " + vm.analysis.model.architecture)
                            .font(.system(size: 12)).foregroundStyle(ThemeColor.muted)
                        Text(vm.analysis.model.statusDescription)
                            .font(.system(size: 11)).foregroundStyle(ThemeColor.muted)
                    }
                    Spacer()
                    StatusTag(text: vm.analysis.model.statusLabel, color: statusColor(vm.analysis.model.status))
                }
                HStack(spacing: 13) {
                    MiniMetric(label:"PCI DEVICE", value:"0x" + vm.deviceID)
                    MiniMetric(label:"RECOMMENDED PLATFORM", value:vm.analysis.model.recommendedPlatformId)
                    MiniMetric(label:"SPOOF TARGET", value:vm.analysis.recommendedSpoof.map { "0x" + $0 } ?? "Keiner")
                }
                Text("macOS: \(vm.analysis.model.macosVersionSupport)\n\(vm.analysis.model.notes)")
                    .font(.system(size: 12)).foregroundStyle(ThemeColor.muted)
                    .textSelection(.enabled)
                if let args = vm.analysis.bootArgs {
                    Label("Boot-Argument: " + args, systemImage: "terminal")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(ThemeColor.amber)
                }
                ForEach(vm.analysis.warnings, id: \.self) { w in
                    Label(w, systemImage: "exclamationmark.triangle")
                        .font(.system(size: 11)).foregroundStyle(ThemeColor.amber)
                }
            }
            Panel(title: "Intel iGPU Datenbank",
                  subtitle: "\(IGPUCompatibility.database.count) portierte Modelle aus der React-Datenbank. Eintrag anklicken, um Device-ID zu übernehmen.",
                  icon: "list.bullet.rectangle") {
                TextField("Suche nach Device-ID, Architektur oder GPU-Modell", text: $vm.searchQuery)
                    .textFieldStyle(.roundedBorder)
                VStack(spacing: 0) {
                    ForEach(vm.filteredGPUs) { gpu in
                        Button {
                            vm.deviceID = gpu.deviceId
                            if gpu.recommendedPlatformId.count == 8 { vm.platformID = gpu.recommendedPlatformId }
                            vm.spoofMode = "auto"
                            vm.customSpoofID = ""
                        } label: {
                            HStack(spacing: 13) {
                                Text("0x" + gpu.deviceId)
                                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                                    .foregroundStyle(ThemeColor.teal).frame(width: 68, alignment: .leading)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(gpu.name).font(.system(size: 12, weight: .medium)).foregroundStyle(.white)
                                    Text(gpu.generation + " · " + gpu.macosVersionSupport)
                                        .font(.system(size: 10)).foregroundStyle(ThemeColor.muted)
                                }
                                Spacer(minLength: 6)
                                StatusTag(text: gpu.statusLabel, color: statusColor(gpu.status))
                            }
                            .padding(.vertical, 10)
                            .contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        Divider().overlay(ThemeColor.stroke)
                    }
                }
            }
        }
    }

    private var connectors: some View {
        Panel(title: "Connector Summary Table",
              subtitle: "Child Device Config aus Block 0x02 / 0x28 · Originalhardware und Apple-Typen",
              icon: "list.bullet.rectangle") {
            if let vbt = vm.parsed {
                HStack {
                    MiniMetric(label:"BDB Version", value:"\(vbt.bdbVersion)")
                    MiniMetric(label:"Stride", value:"\(vbt.stride) Bytes")
                    MiniMetric(label:"Alle Devices", value:"\(vbt.allDevices.count)")
                    MiniMetric(label:"Aktive", value:"\(vbt.connectors.count)", color: ThemeColor.green)
                }
                connectorHeader
                ForEach(vbt.allDevices) { con in connectorRow(con) }
            }
        }
    }

    private var connectorHeader: some View {
        HStack(spacing: 8) {
            col("SLOT", 42); col("PORT", 80); col("DVO", 45); col("TYPE", 65)
            col("DEVICE-TYPE", 90); col("DDC", 38); col("AUX", 38)
            col("BUS-ID", 53); col("macOS TYPE (LE)", 115)
            Spacer()
            col("STATUS", 68)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(ThemeColor.sunken, in: RoundedRectangle(cornerRadius: 8))
    }

    private func col(_ s: String, _ width: CGFloat) -> some View {
        Text(s).font(.system(size: 10, weight: .medium, design: .monospaced))
            .foregroundStyle(ThemeColor.muted).frame(width: width, alignment: .leading)
    }

    private func connectorRow(_ con: VBTConnector) -> some View {
        HStack(spacing: 8) {
            col("\(con.slot)", 42); col(con.intelPort, 80)
            col(String(format:"%02X",con.dvoPort),45); col(con.kind,65)
            col(String(format:"0x%04X",con.deviceType),90)
            col("\(con.ddcPin)",38); col("\(con.auxChannel)",38)
            col(String(format:"0x%02X",con.appleBusId),53)
            col(con.typeHex,115)
            Spacer()
            StatusTag(text: con.active ? "AKTIV" : "INAKTIV",
                      color: con.active ? ThemeColor.green : ThemeColor.muted)
                .frame(width: 68)
        }
        .padding(.horizontal, 12).padding(.vertical, 7)
        .background(con.active ? Color.clear : ThemeColor.sunken.opacity(0.3))
    }

    private var xml: some View {
        Panel(title: "OpenCore DeviceProperties XML",
              subtitle: "Native Swift-Generierung · Base64 <data> und Hex-Kommentare",
              icon: "chevron.left.forwardslash.chevron.right") {
            HStack {
                StatusTag(text: "\(vm.currentPatch?.properties.count ?? 0) PROPERTIES", color: ThemeColor.teal)
                Text(PatchGenerator.pciPath)
                    .font(.system(size: 11, design: .monospaced)).foregroundStyle(ThemeColor.muted)
                Spacer()
                IconAction(title:"Kopieren",icon:"doc.on.doc") { vm.copy(vm.xml) }
                IconAction(title:"Als XML sichern",icon:"square.and.arrow.up",prominent:true) { vm.saveXML() }
            }
            MonospaceBox(text: vm.xml, minHeight: 450)
            Text("Der XML-Auszug ist ein DeviceProperties-Dictionary. Für eine vollständige OpenCore config.plist bitte den Merge-Bereich verwenden.")
                .font(.system(size: 11)).foregroundStyle(ThemeColor.muted)
            if let patch = vm.currentPatch {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(patch.properties) { prop in
                        HStack {
                            Text(prop.key).font(.system(size: 11, design: .monospaced))
                            Spacer()
                            Text(prop.value.hexString).foregroundStyle(ThemeColor.teal)
                            Text(prop.value.base64EncodedString()).foregroundStyle(ThemeColor.muted)
                        }
                        .font(.system(size: 11, design: .monospaced))
                        Divider().overlay(ThemeColor.stroke)
                    }
                }
            }
        }
    }

    private var merge: some View {
        Panel(title: "Merge in OpenCore config.plist",
              subtitle: "Bestehende DeviceProperties bleiben erhalten · XML- und Binary-Plist-Import",
              icon: "square.on.square") {
            HStack(spacing: 12) {
                IconAction(title:"config.plist auswählen",icon:"folder.badge.plus",prominent:true) { vm.openPlist() }
                if let url = vm.plistURL {
                    Image(systemName:"checkmark.circle.fill").foregroundStyle(ThemeColor.green)
                    Text(url.lastPathComponent).font(.system(size: 12, design: .monospaced))
                    Text("\(vm.plistSource.count) Bytes").font(.system(size: 11)).foregroundStyle(ThemeColor.muted)
                } else {
                    Text("Noch keine config.plist ausgewählt").foregroundStyle(ThemeColor.muted)
                        .font(.system(size: 12))
                }
                Spacer()
            }
            HStack(spacing: 10) {
                IconAction(title: "Gepatchte Plist sichern", icon: "square.and.arrow.up",
                           prominent: true) { vm.exportMergedPlist() }
                IconAction(title: "Original mit Backup patchen", icon:"externaldrive.badge.checkmark",
                           destructive:true) { vm.applyMergeInPlace() }
            }
            .disabled(vm.mergedPlistData == nil)
            Label("Beim direkten Patch wird zuerst eine Zeitstempel-Backup-Datei neben der Originaldatei erzeugt. Änderungen an Boot-Konfigurationen unbedingt testen.",
                  systemImage: "exclamationmark.shield")
                .font(.system(size: 11)).foregroundStyle(ThemeColor.amber)
            MonospaceBox(text: vm.mergedPlistText.isEmpty ?
                         "config.plist laden, um den nativen Merge anzuzeigen." : vm.mergedPlistText,
                         minHeight: 350)
        }
    }

    private var terminal: some View {
        Panel(title: "ASCII Terminal Output",
              subtitle: "Connector-Matrix, Status und Hardware-Header für Diagnose und Dokumentation",
              icon: "terminal") {
            HStack {
                StatusTag(text: "TEXT", color: ThemeColor.green)
                Spacer()
                IconAction(title:"Kopieren",icon:"doc.on.doc") { vm.copy(terminalText) }
                IconAction(title:"TXT exportieren",icon:"square.and.arrow.up") {
                    vm.save(data: Data(terminalText.utf8), suggested: "vbt2fbpatch-report.txt")
                }
            }
            MonospaceBox(text: terminalText, minHeight: 380)
        }
    }

    private var terminalText: String {
        let vbt = vm.parsed
        let fields = [
            "VBT2FBPatch v3.4.0  |  Native macOS Edition",
            String(repeating: "=", count: 60),
            "File       : \(vm.sourceName)",
            "Device-ID  : 0x\(vm.deviceID)",
            "iGPU       : \(vm.analysis.model.name)",
            "Support    : \(vm.analysis.model.statusLabel)",
            "macOS      : \(vm.targetMacOS)",
            "Platform-ID: <\(vm.platformID)>",
            "Spoof ID   : \(vm.effectiveSpoof ?? "none")",
            "VBT        : v\(vbt?.version ?? 0) / BDB \(vbt?.bdbVersion ?? 0)",
            "Connectors : \(vbt?.connectors.count ?? 0)",
            "",
            vm.ascii,
            "",
            "Warnings:",
            (vm.analysis.warnings + (vm.currentPatch?.warnings ?? [])).joined(separator: "\n")
        ]
        return fields.joined(separator: "\n")
    }

    private var hex: some View {
        VStack(spacing: 16) {
            Panel(title: "BDB Block Inspector", subtitle: "VBT-Offset, BDB-Blöcke und Größen",
                  icon: "square.stack.3d.up") {
                if let vbt = vm.parsed {
                    ForEach(vbt.blocks) { b in
                        HStack {
                            Text(String(format:"0x%02X",b.id))
                                .font(.system(size: 12, weight: .bold, design: .monospaced))
                                .foregroundStyle(ThemeColor.teal).frame(width: 55, alignment: .leading)
                            Text(b.name).font(.system(size: 12))
                            Spacer()
                            Text(String(format:"offset 0x%04X",b.offset))
                            Text("\(b.size) Bytes")
                        }
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(ThemeColor.muted)
                        Divider().overlay(ThemeColor.stroke)
                    }
                }
            }
            Panel(title: "Hex Viewer", subtitle: "Hex/ASCII Ansicht der ersten 16 KiB des VBT-Images",
                  icon: "number") {
                HStack {
                    Text("\(vm.sourceData.count) Bytes total")
                        .font(.system(size: 11, design: .monospaced)).foregroundStyle(ThemeColor.muted)
                    Spacer()
                    IconAction(title:"Hex kopieren",icon:"doc.on.doc") {
                        vm.copy(PatchGenerator.hexDump(vm.sourceData))
                    }
                }
                MonospaceBox(text: PatchGenerator.hexDump(vm.sourceData), minHeight: 360)
            }
        }
    }

    private var cli: some View {
        VStack(spacing: 16) {
            Panel(title: "Original Python CLI Runner",
                  subtitle: "Das unveränderte vbt2fbpatch.py v3.4.0 wird separat mit Python 3 ausgeführt, falls lokal verfügbar.",
                  icon: "apple.terminal") {
                HStack(spacing: 10) {
                    IconAction(title:"CLI ausführen",icon:"play.fill",prominent:true) { vm.runCLI() }
                    IconAction(title:"JSON-Ausgabe",icon:"curlybraces") { vm.runCLI(json:true) }
                    IconAction(title:"Python Script exportieren",icon:"square.and.arrow.up") { vm.exportCLI() }
                    Spacer()
                    if vm.cliRunning { ProgressView().controlSize(.small); Text("Läuft…").font(.system(size: 11)) }
                }
                .disabled(vm.cliRunning)
                Text("CLI-Command").font(.system(size: 11, weight: .semibold)).foregroundStyle(ThemeColor.muted)
                MonospaceBox(text: vm.cliCommand(), minHeight: 90)
                MonospaceBox(text: vm.cliOutput.isEmpty ? "CLI noch nicht ausgeführt. Die native SwiftUI-Patch-Engine benötigt kein Python.": vm.cliOutput,
                             minHeight: 290)
            }
            Panel(title: "VBT extrahieren", subtitle: "Kurzanleitung: Intel BIOS Dump unter Linux / UEFI",
                  icon: "book.closed") {
                VStack(alignment: .leading, spacing: 9) {
                    Text("Linux i915 DRM debugfs").font(.system(size: 12, weight: .semibold))
                    MonospaceBox(text: "sudo mount -t debugfs none /sys/kernel/debug\nsudo cat /sys/kernel/debug/dri/0/i915_vbt > vbt.bin",
                                 minHeight: 75)
                    Text("Falls die iGPU unter dri/1 liegt, /dri/0/ entsprechend ersetzen. Alternativ über UEFITool die Intel Video BIOS Table aus der Firmware extrahieren.")
                        .font(.system(size: 11)).foregroundStyle(ThemeColor.muted)
                    Text("Hinweis: Intel Xe-Grafik (11. Generation+) besitzt keinen nativen macOS-Treiber. Ein Device-ID-Spoof kann fehlende Hardware-Beschleunigung nicht ersetzen.")
                        .font(.system(size: 11)).foregroundStyle(ThemeColor.amber)
                }
            }
        }
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "native": return ThemeColor.green
        case "needs_spoof", "legacy_ventura": return ThemeColor.amber
        case "unsupported": return Color.red
        default: return ThemeColor.muted
        }
    }

    private func empty(_ title: String, _ detail: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName:"tray").font(.system(size: 25)).foregroundStyle(ThemeColor.muted)
            Text(title).font(.system(size: 14, weight: .semibold))
            Text(detail).font(.system(size: 12)).foregroundStyle(ThemeColor.muted)
        }
        .frame(maxWidth: .infinity).padding(25)
    }
}
