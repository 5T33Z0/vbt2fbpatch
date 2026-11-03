import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @StateObject private var vm = Workbench()
    @State private var advancedShown = false
    @State private var dropTarget = false

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            Rectangle().fill(ThemeColor.stroke).frame(width: 1)
            ScrollView {
                VStack(alignment: .leading, spacing: 19) {
                    heading
                    sourceControls
                    if advancedShown { advancedSettings }
                    if let error = vm.parseError {
                        warningBox(error, critical: true)
                    } else if let error = vm.patchError {
                        warningBox(error, critical: true)
                    }
                    WorkspaceContent(vm: vm)
                    Text("VBT2FBPatch 3.4.0  ·  Native macOS / SwiftUI  ·  Based on vbt2fbpatch by 5T33Z0")
                        .font(.system(size: 10)).foregroundStyle(ThemeColor.muted.opacity(0.65))
                        .frame(maxWidth: .infinity, alignment: .center).padding(.top, 12)
                }
                .padding(27)
                .frame(maxWidth: 1350, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(ThemeColor.canvas)
        }
        .frame(minWidth: 1080, minHeight: 720)
        .preferredColorScheme(.dark)
        .tint(ThemeColor.teal)
        .onDrop(of: [UTType.fileURL.identifier], isTargeted: $dropTarget) { providers in
            guard let provider = providers.first else { return false }
            _ = provider.loadObject(ofClass: NSURL.self) { object, _ in
                guard let url = object as? URL, let bytes = try? Data(contentsOf: url) else { return }
                Task { @MainActor in
                    vm.selectedSample = ""
                    vm.setVBT(bytes, name: url.lastPathComponent)
                }
            }
            return true
        }
        .overlay {
            if dropTarget {
                RoundedRectangle(cornerRadius: 15)
                    .strokeBorder(ThemeColor.teal, style: StrokeStyle(lineWidth: 4, dash: [12, 8]))
                    .background(ThemeColor.teal.opacity(0.07))
                    .allowsHitTesting(false).padding(6)
            }
        }
        .alert("VBT2FBPatch", isPresented: Binding(
            get: { vm.error != nil },
            set: { if !$0 { vm.error = nil } }
        )) {
            Button("OK", role: .cancel) { vm.error = nil }
        } message: { Text(vm.error ?? "") }
        .overlay(alignment: .bottom) {
            if let notice = vm.notice {
                HStack(spacing: 9) {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(ThemeColor.green)
                    Text(notice).font(.system(size: 12)).foregroundStyle(.white)
                    Button {
                        vm.notice = nil
                    } label: { Image(systemName: "xmark").font(.system(size: 10)) }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(ThemeColor.panel, in: Capsule())
                .overlay(Capsule().stroke(ThemeColor.stroke))
                .shadow(radius: 20).padding(.bottom, 18)
            }
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(spacing: 11) {
                Image(systemName: "cpu.fill")
                    .font(.system(size: 19))
                    .foregroundStyle(ThemeColor.teal)
                    .frame(width: 40, height: 40)
                    .background(ThemeColor.teal.opacity(0.1), in: RoundedRectangle(cornerRadius: 11))
                VStack(alignment: .leading, spacing: 3) {
                    Text("VBT2FBPatch").font(.system(size: 17, weight: .bold)).foregroundStyle(.white)
                    Text("INTEL FRAMEBUFFER TOOL")
                        .font(.system(size: 8.5, weight: .semibold, design: .monospaced))
                        .tracking(0.7).foregroundStyle(ThemeColor.muted)
                }
            }
            .padding(.horizontal, 11).padding(.top, 22)

            VStack(alignment: .leading, spacing: 7) {
                FieldLabel(text: "Arbeitsbereich").padding(.horizontal, 13).padding(.bottom, 6)
                ForEach(WorkspacePage.allCases) { section in
                    Button {
                        vm.page = section
                    } label: {
                        HStack(spacing: 11) {
                            Image(systemName: section.icon)
                                .font(.system(size: 14))
                                .frame(width: 20)
                            Text(section.rawValue)
                                .font(.system(size: 12.5, weight: vm.page == section ? .semibold : .medium))
                            Spacer(minLength: 0)
                            if vm.page == section { Circle().fill(ThemeColor.teal).frame(width: 5, height: 5) }
                        }
                        .foregroundStyle(vm.page == section ? ThemeColor.teal : ThemeColor.muted)
                        .padding(.horizontal, 13).padding(.vertical, 11)
                        .background(vm.page == section ? ThemeColor.teal.opacity(0.10) : .clear,
                                    in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10)
                            .stroke(vm.page == section ? ThemeColor.teal.opacity(0.20) : .clear))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 10)

            Spacer()

            VStack(alignment: .leading, spacing: 12) {
                FieldLabel(text: "Aktuelle VBT")
                Text(vm.sourceName.isEmpty ? "Keine Datei" : vm.sourceName)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white).lineLimit(2)
                HStack {
                    Label("\(vm.parsed?.connectors.count ?? 0) Ports", systemImage: "display")
                    Spacer()
                    Text(vm.sourceData.isEmpty ? "—" : "\(vm.sourceData.count) B")
                }
                .font(.system(size: 10)).foregroundStyle(ThemeColor.muted)
                Button { vm.openVBT() } label: {
                    Label("VBT importieren", systemImage: "square.and.arrow.down")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered).controlSize(.small)
            }
            .padding(14)
            .background(ThemeColor.sunken, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(ThemeColor.stroke))
            .padding(.horizontal, 12).padding(.bottom, 20)
        }
        .frame(width: 230)
        .frame(maxHeight: .infinity)
        .background(ThemeColor.sidebar)
    }

    private var heading: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 10) {
                    Text(vm.page.rawValue)
                        .font(.system(size: 27, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    StatusTag(text: "NATIVE", color: ThemeColor.teal)
                }
                Text("Intel Video BIOS Table  →  WhateverGreen  →  OpenCore DeviceProperties")
                    .font(.system(size: 12)).foregroundStyle(ThemeColor.muted)
            }
            Spacer()
            if vm.parsed != nil {
                IconAction(title: "XML exportieren", icon: "square.and.arrow.up", prominent: true) { vm.saveXML() }
            }
            IconAction(title: "Öffnen", icon: "folder", action: { vm.openVBT() })
        }
    }

    private var sourceControls: some View {
        VStack(spacing: 15) {
            HStack(alignment: .top, spacing: 15) {
                Panel(title: "Intel VBT Binary", subtitle: "Sample auswählen oder eigenen VBT/ROM laden", icon: "doc.binary") {
                    Picker("Beispieldatei", selection: Binding(
                        get: { vm.selectedSample },
                        set: { vm.loadSample($0) }
                    )) {
                        if vm.selectedSample.isEmpty { Text("Eigene Datei").tag("") }
                        ForEach(VBTSample.all) { s in
                            Text(s.title).tag(s.filename)
                        }
                    }
                    .labelsHidden()
                    .frame(maxWidth: .infinity)
                    HStack(spacing: 9) {
                        Image(systemName: "doc.zipper").foregroundStyle(ThemeColor.teal)
                        Text(vm.sourceName.isEmpty ? "Noch keine VBT" : vm.sourceName)
                            .lineLimit(1).truncationMode(.middle)
                        Spacer(minLength: 0)
                        Text("\(vm.sourceData.count) Bytes")
                            .foregroundStyle(ThemeColor.muted)
                    }
                    .font(.system(size: 11, design: .monospaced))
                    Button { vm.openVBT() } label: {
                        Label("Eigene vbt.bin oder ROM laden / Datei hierher ziehen",
                              systemImage: "arrow.down.doc")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                Panel(title: "Intel iGPU / macOS", subtitle: "Device-ID und Zielsystem", icon: "cpu") {
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 6) {
                            FieldLabel(text: "Device-ID (HEX)")
                            TextField("3E9B", text: $vm.deviceID)
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 12, design: .monospaced))
                                .onChange(of: vm.deviceID) { _, value in
                                    let clean = String(value.uppercased().filter(\.isHexDigit).prefix(4))
                                    if clean != value { vm.deviceID = clean }
                                }
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            FieldLabel(text: "macOS Target")
                            TextField("14.0", text: $vm.targetMacOS)
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 12, design: .monospaced))
                        }
                    }
                    HStack(spacing: 8) {
                        Text(vm.analysis.model.name)
                            .font(.system(size: 11)).foregroundStyle(ThemeColor.muted)
                            .lineLimit(2)
                        Spacer(minLength: 0)
                    }
                }
                Panel(title: "Apple Framebuffer", subtitle: "AAPL,ig-platform-id (Little-Endian)", icon: "display") {
                    Menu {
                        Button("Coffee Lake Desktop · 07009B3E") { vm.platformID = "07009B3E" }
                        Button("Coffee/Comet Lake Laptop · 00009B3E") { vm.platformID = "00009B3E" }
                        Button("Coffee Lake Headless · 0000923E") { vm.platformID = "0000923E" }
                        Button("Kaby Lake Desktop · 00001659") { vm.platformID = "00001659" }
                        Button("Kaby Lake Laptop · 00001B59") { vm.platformID = "00001B59" }
                        Button("Comet Lake Desktop · 0000A53E") { vm.platformID = "0000A53E" }
                        Button("Ice Lake Laptop · 0000528A") { vm.platformID = "0000528A" }
                        Button("Skylake Desktop · 00001619") { vm.platformID = "00001619" }
                        Button("Haswell Desktop · 0300220D") { vm.platformID = "0300220D" }
                    } label: {
                        Label("Framebuffer-Preset wählen", systemImage: "square.stack.3d.down.right")
                            .font(.system(size: 11))
                    }
                    .menuStyle(.borderlessButton)
                    TextField("07009B3E", text: $vm.platformID)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 12, design: .monospaced))
                        .onChange(of: vm.platformID) { _, value in
                            let clean = String(value.uppercased().filter(\.isHexDigit).prefix(8))
                            if clean != value { vm.platformID = clean }
                        }
                    HStack {
                        Text("Empfohlen: \(vm.analysis.model.recommendedPlatformId)")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(ThemeColor.muted)
                        Spacer()
                        Button("Übernehmen") {
                            if vm.analysis.model.recommendedPlatformId != "UNSUPPORTED" {
                                vm.platformID = vm.analysis.model.recommendedPlatformId
                            }
                        }
                        .buttonStyle(.borderless).font(.system(size: 11))
                    }
                }
            }
            HStack(spacing: 11) {
                Label("Spoofing", systemImage: "shield.lefthalf.filled")
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(ThemeColor.muted)
                Picker("Spoofing", selection: $vm.spoofMode) {
                    Text("Auto").tag("auto")
                    Text("An").tag("on")
                    Text("Aus").tag("off")
                }
                .labelsHidden().pickerStyle(.segmented).frame(width: 185)
                TextField("Spoof Device-ID (HEX)", text: $vm.customSpoofID)
                    .font(.system(size: 11, design: .monospaced))
                    .textFieldStyle(.roundedBorder).frame(width: 160)
                    .onChange(of: vm.customSpoofID) { _, value in
                        let clean = String(value.uppercased().filter(\.isHexDigit).prefix(4))
                        if clean != value { vm.customSpoofID = clean }
                    }
                Text(vm.isSpoofActive ? "Effektiv: 0x\(vm.effectiveSpoof ?? "—")" : "Kein device-id Spoof")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(vm.isSpoofActive ? ThemeColor.amber : ThemeColor.green)
                Spacer()
                Toggle("Erweitert", isOn: $advancedShown)
                    .toggleStyle(.switch).controlSize(.small)
                    .font(.system(size: 11))
            }
            .padding(12)
            .background(ThemeColor.panel, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(ThemeColor.stroke))
        }
    }

    private var advancedSettings: some View {
        Panel(title: "Advanced Framebuffer & Hardware Tuning",
              subtitle: "LSPCON, Backlight, Bus-ID, Framebuffer-Flags und Connector-Index",
              icon: "slider.horizontal.3") {
            VStack(alignment: .leading, spacing: 15) {
                HStack(spacing: 24) {
                    Toggle("Unified Memory 2048 MB", isOn: $vm.unifiedMemory)
                    Toggle("RPS Control", isOn: $vm.rpsControl)
                    Toggle("Backlight Fix", isOn: $vm.backlightFix)
                    Toggle("Laptop / max. 3 Ports", isOn: $vm.mobileMode)
                }
                .font(.system(size: 12))
                Divider().overlay(ThemeColor.stroke)
                HStack(spacing: 14) {
                    VStack(alignment: .leading, spacing: 7) {
                        FieldLabel(text: "Formfaktor")
                        Picker("Formfaktor", selection: $vm.formFactor) {
                            Text("Auto").tag("auto"); Text("Desktop").tag("desktop")
                            Text("Mobile").tag("mobile"); Text("Headless").tag("headless")
                        }.labelsHidden()
                    }
                    VStack(alignment: .leading, spacing: 7) {
                        FieldLabel(text: "Bus-ID Quelle")
                        Picker("Bus-ID Quelle", selection: $vm.busIDSource) {
                            Text("DDI (Standard)").tag("ddi"); Text("DDC / GMBUS").tag("ddc")
                        }.labelsHidden()
                    }
                    VStack(alignment: .leading, spacing: 7) {
                        FieldLabel(text: "LSPCON Mode")
                        Picker("LSPCON Mode", selection: $vm.lspconMode) {
                            Text("Auto").tag(""); Text("PCON (4K 60Hz)").tag("pcon")
                            Text("Level Shifter").tag("ls")
                        }.labelsHidden()
                    }
                    VStack(alignment: .leading, spacing: 7) {
                        FieldLabel(text: "Erster Connector")
                        Picker("Erster Connector", selection: $vm.firstConnector) {
                            Text("Auto").tag("auto"); Text("con0").tag("0")
                            Text("con1").tag("1"); Text("con2").tag("2"); Text("con3").tag("3")
                        }.labelsHidden()
                    }
                    VStack(alignment: .leading, spacing: 7) {
                        FieldLabel(text: "Pipe Override")
                        TextField("z.B. 18", text: $vm.pipeOverride)
                            .textFieldStyle(.roundedBorder).frame(width: 95)
                    }
                }
                HStack(spacing: 15) {
                    VStack(alignment: .leading, spacing: 7) {
                        FieldLabel(text: "Framebuffer Flags (Hex)")
                        TextField("0xE30B0A", text: $vm.framebufferFlags).textFieldStyle(.roundedBorder)
                    }
                    VStack(alignment: .leading, spacing: 7) {
                        FieldLabel(text: "Connector Flags (Hex)")
                        TextField("0x3C7", text: $vm.connectorFlags).textFieldStyle(.roundedBorder)
                    }
                }
                Text("Achtung: Diese Werte hängen vom Mainboard und geladenen macOS-Treiber ab. EFI-Backups bleiben Pflicht.")
                    .font(.system(size: 11)).foregroundStyle(ThemeColor.amber)
            }
        }
    }

    private func warningBox(_ text: String, critical: Bool) -> some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: critical ? "exclamationmark.triangle.fill" : "info.circle")
                .foregroundStyle(critical ? .red : ThemeColor.amber)
            Text(text).font(.system(size: 12))
                .foregroundStyle(critical ? Color(red: 1, green: 0.72, blue: 0.72) : ThemeColor.amber)
            Spacer()
        }
        .padding(15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.red.opacity(critical ? 0.12 : 0.05), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.red.opacity(0.2)))
    }
}
