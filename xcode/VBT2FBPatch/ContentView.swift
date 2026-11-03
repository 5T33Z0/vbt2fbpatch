import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @StateObject private var vm = Workbench()
    @State private var advancedShown = false
    @State private var dropTarget = false
    @AppStorage(AppLocalization.settingKey) private var interfaceLanguage = "system"

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
        .environment(\.locale, Locale(identifier: AppLocalization.effectiveLanguage(interfaceLanguage)))
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
                FieldLabel(text: tr("Arbeitsbereich")).padding(.horizontal, 13).padding(.bottom, 6)
                ForEach(WorkspacePage.allCases) { section in
                    Button {
                        vm.page = section
                    } label: {
                        HStack(spacing: 11) {
                            Image(systemName: section.icon)
                                .font(.system(size: 14))
                                .frame(width: 20)
                            Text(tr(section.rawValue))
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

            VStack(alignment: .leading, spacing: 7) {
                FieldLabel(text: "Sprache")
                Picker(tr("Sprache"), selection: $interfaceLanguage) {
                    Text(tr("System")).tag("system")
                    Text(tr("Deutsch")).tag("de")
                    Text(tr("English")).tag("en")
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 13)

            VStack(alignment: .leading, spacing: 12) {
                FieldLabel(text: tr("Aktuelle VBT"))
                Text(vm.sourceName.isEmpty ? tr("Keine Datei") : vm.sourceName)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(.white).lineLimit(2)
                HStack {
                    Label(AppLocalization.format("%d Ports", vm.parsed?.connectors.count ?? 0), systemImage: "display")
                    Spacer()
                    Text(vm.sourceData.isEmpty ? "—" : "\(vm.sourceData.count) B")
                }
                .font(.system(size: 10)).foregroundStyle(ThemeColor.muted)
                Button { vm.openVBT() } label: {
                    Label(tr("VBT importieren"), systemImage: "square.and.arrow.down")
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
                    Text(tr(vm.page.rawValue))
                        .font(.system(size: 27, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    StatusTag(text: "NATIVE", color: ThemeColor.teal)
                }
                Text("Intel Video BIOS Table  →  WhateverGreen  →  OpenCore DeviceProperties")
                    .font(.system(size: 12)).foregroundStyle(ThemeColor.muted)
            }
            Spacer()
            if vm.parsed != nil {
                IconAction(title: tr("XML exportieren"), icon: "square.and.arrow.up", prominent: true) { vm.saveXML() }
            }
            IconAction(title: tr("Öffnen"), icon: "folder", action: { vm.openVBT() })
        }
    }

    private var sourceControls: some View {
        VStack(spacing: 15) {
            HStack(alignment: .top, spacing: 15) {
                Panel(title: "Intel VBT Binary", subtitle: tr("Sample auswählen oder eigenen VBT/ROM laden"), icon: "doc.binary") {
                    Picker(tr("Beispieldatei"), selection: Binding(
                        get: { vm.selectedSample },
                        set: { vm.loadSample($0) }
                    )) {
                        if vm.selectedSample.isEmpty { Text(tr("Eigene Datei")).tag("") }
                        ForEach(VBTSample.all) { s in
                            Text(s.title).tag(s.filename)
                        }
                    }
                    .labelsHidden()
                    .frame(maxWidth: .infinity)
                    HStack(spacing: 9) {
                        Image(systemName: "doc.zipper").foregroundStyle(ThemeColor.teal)
                        Text(vm.sourceName.isEmpty ? tr("Noch keine VBT") : vm.sourceName)
                            .lineLimit(1).truncationMode(.middle)
                        Spacer(minLength: 0)
                        Text("\(vm.sourceData.count) " + tr("Bytes"))
                            .foregroundStyle(ThemeColor.muted)
                    }
                    .font(.system(size: 11, design: .monospaced))
                    Button { vm.openVBT() } label: {
                        Label(tr("Eigene vbt.bin oder ROM laden / Datei hierher ziehen"),
                              systemImage: "arrow.down.doc")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                Panel(title: "Intel iGPU / macOS", subtitle: tr("Device-ID und Zielsystem"), icon: "cpu") {
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 6) {
                            FieldLabel(text: tr("Device-ID (HEX)"))
                            TextField("3E9B", text: $vm.deviceID)
                                .textFieldStyle(.roundedBorder)
                                .font(.system(size: 12, design: .monospaced))
                                .onChange(of: vm.deviceID) { _, value in
                                    let clean = String(value.uppercased().filter(\.isHexDigit).prefix(4))
                                    if clean != value { vm.deviceID = clean }
                                }
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            FieldLabel(text: tr("macOS Target"))
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
                Panel(title: "Apple Framebuffer", subtitle: tr("AAPL,ig-platform-id (Little-Endian)"), icon: "display") {
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
                        Label(tr("Framebuffer-Preset wählen"), systemImage: "square.stack.3d.down.right")
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
                        Text(tr("Empfohlen:") + " \(vm.analysis.model.recommendedPlatformId)")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(ThemeColor.muted)
                        Spacer()
                        Button(tr("Übernehmen")) {
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
                    Text(tr("Auto")).tag("auto")
                    Text(tr("An")).tag("on")
                    Text(tr("Aus")).tag("off")
                }
                .labelsHidden().pickerStyle(.segmented).frame(width: 185)
                TextField("Spoof Device-ID (HEX)", text: $vm.customSpoofID)
                    .font(.system(size: 11, design: .monospaced))
                    .textFieldStyle(.roundedBorder).frame(width: 160)
                    .onChange(of: vm.customSpoofID) { _, value in
                        let clean = String(value.uppercased().filter(\.isHexDigit).prefix(4))
                        if clean != value { vm.customSpoofID = clean }
                    }
                Text(vm.isSpoofActive ? tr("Effektiv:") + " 0x\(vm.effectiveSpoof ?? "—")" : tr("Kein device-id Spoof"))
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(vm.isSpoofActive ? ThemeColor.amber : ThemeColor.green)
                Spacer()
                Toggle(tr("Erweitert"), isOn: $advancedShown)
                    .toggleStyle(.switch).controlSize(.small)
                    .font(.system(size: 11))
            }
            .padding(12)
            .background(ThemeColor.panel, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(ThemeColor.stroke))
        }
    }

    private var advancedSettings: some View {
        Panel(title: tr("Advanced Framebuffer & Hardware Tuning"),
              subtitle: tr("LSPCON, Backlight, Bus-ID, Framebuffer-Flags und Connector-Index"),
              icon: "slider.horizontal.3") {
            VStack(alignment: .leading, spacing: 15) {
                HStack(spacing: 24) {
                    Toggle(tr("Unified Memory 2048 MB"), isOn: $vm.unifiedMemory)
                    Toggle(tr("RPS Control"), isOn: $vm.rpsControl)
                    Toggle(tr("Backlight Fix"), isOn: $vm.backlightFix)
                    Toggle(tr("Laptop / max. 3 Ports"), isOn: $vm.mobileMode)
                }
                .font(.system(size: 12))
                Divider().overlay(ThemeColor.stroke)
                HStack(spacing: 14) {
                    VStack(alignment: .leading, spacing: 7) {
                        FieldLabel(text: tr("Formfaktor"))
                        Picker(tr("Formfaktor"), selection: $vm.formFactor) {
                            Text(tr("Auto")).tag("auto"); Text(tr("Desktop")).tag("desktop")
                            Text(tr("Mobile")).tag("mobile"); Text(tr("Headless")).tag("headless")
                        }.labelsHidden()
                    }
                    VStack(alignment: .leading, spacing: 7) {
                        FieldLabel(text: tr("Bus-ID Quelle"))
                        Picker(tr("Bus-ID Quelle"), selection: $vm.busIDSource) {
                            Text(tr("DDI (Standard)")).tag("ddi"); Text(tr("DDC / GMBUS")).tag("ddc")
                        }.labelsHidden()
                    }
                    VStack(alignment: .leading, spacing: 7) {
                        FieldLabel(text: tr("LSPCON Mode"))
                        Picker(tr("LSPCON Mode"), selection: $vm.lspconMode) {
                            Text(tr("Auto")).tag(""); Text(tr("PCON (4K 60Hz)")).tag("pcon")
                            Text(tr("Level Shifter")).tag("ls")
                        }.labelsHidden()
                    }
                    VStack(alignment: .leading, spacing: 7) {
                        FieldLabel(text: tr("Erster Connector"))
                        Picker(tr("Erster Connector"), selection: $vm.firstConnector) {
                            Text(tr("Auto")).tag("auto"); Text("con0").tag("0")
                            Text("con1").tag("1"); Text("con2").tag("2"); Text("con3").tag("3")
                        }.labelsHidden()
                    }
                    VStack(alignment: .leading, spacing: 7) {
                        FieldLabel(text: tr("Pipe Override"))
                        TextField(tr("z.B. 18"), text: $vm.pipeOverride)
                            .textFieldStyle(.roundedBorder).frame(width: 95)
                    }
                }
                HStack(spacing: 15) {
                    VStack(alignment: .leading, spacing: 7) {
                        FieldLabel(text: tr("Framebuffer Flags (Hex)"))
                        TextField("0xE30B0A", text: $vm.framebufferFlags).textFieldStyle(.roundedBorder)
                    }
                    VStack(alignment: .leading, spacing: 7) {
                        FieldLabel(text: tr("Connector Flags (Hex)"))
                        TextField("0x3C7", text: $vm.connectorFlags).textFieldStyle(.roundedBorder)
                    }
                }
                Text(tr("Achtung: Diese Werte hängen vom Mainboard und geladenen macOS-Treiber ab. EFI-Backups bleiben Pflicht."))
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
