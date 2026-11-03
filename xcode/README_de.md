# VBT2FBPatch Native (macOS)

Die Web-App aus `source/` wurde als **native SwiftUI-Anwendung** in das bestehende Xcode-Projekt übernommen. Für die normale Nutzung werden **kein WebView, Node.js, Vite, Express oder Python** benötigt.

## Start

1. `VBT2FBPatch.xcodeproj` in Xcode öffnen.
2. Das Scheme **VBT2FBPatch** und als Ziel **My Mac** wählen.
3. Mit **⌘R** starten. Mindestversion: **macOS 14.0**; Intel x86_64 und Apple Silicon arm64 werden unterstützt.

## Oberfläche

- **Routing:** VBT öffnen oder eines der fünf integrierten Beispiele auswählen, DDI-Routing und Apple-Framebuffer ansehen.
- **iGPU Datenbank:** 41 Modelle aus der TypeScript-Datenbank mit macOS-Versionen, Spoof-IDs und Boot-Argumenten.
- **Connector-Tabelle:** VBT Device Type, DVO, DDC, AUX, macOS Connector Type und Bus-ID.
- **OpenCore XML:** `DeviceProperties`-Snippet mit Base64-Data und Byte-Kommentaren erzeugen, kopieren und exportieren.
- **config.plist Merge:** bestehende XML-/Binär-Plist einlesen, gepatchte Datei separat exportieren oder **nach Bestätigung und Backup** direkt ändern.
- **Terminal:** Hardware- und Connector-Zusammenfassung als Text.
- **Hex-Inspector:** BDB-Blöcke und Hex-Dump.
- **CLI & Guide:** originale Python-Engine ausführen (benötigt separat vorhandenes `/usr/bin/python3`), JSON-Ausgabe und Export des CLI-Quellcodes, VBT-Dump-Anleitung.

Über **Erweitert** lassen sich LSPCON (PCON / LS), Backlight Fix, DDC-/DDI-Bus-IDs, Laptop-Portcount, Pipe, Connector-Index, Unifiedmem, RPS und Hex-Flags setzen. Ein eigener VBT kann auch per Drag & Drop in das Fenster geladen werden.

## Technische Struktur

| Datei/Ordner | Aufgabe |
| --- | --- |
| `VBT2FBPatch/ContentView.swift` | Hauptfenster, Sidebar und Einstellungen |
| `VBT2FBPatch/Core/WorkspaceContent.swift` | Die acht Arbeitsbereiche |
| `VBT2FBPatch/Core/VBTParser.swift` | Nativer VBT-/BDB-/Child-Device-Parser |
| `VBT2FBPatch/Core/IGPUCompatibility.swift` | iGPU-Versionen und Spoofing-Auswertung |
| `VBT2FBPatch/Core/PatchGenerator.swift` | OpenCore-Properties, XML, sichere Plist-Merge-Operation |
| `VBT2FBPatch/Core/Workbench.swift` | App-State, Datei-Dialoge, Exporte und optionaler Python-Runner |
| `VBT2FBPatch/Resources/` | iGPU-Datenbank, fünf VBT-Dumps, Original-Python-CLI |
| `source/` | Unveränderte Referenzimplementation |

Der Xcode-Target ist **nicht sandboxed**, weil diese lokale Developer-Utility neben den ausgewählten EFI-Dateien Backups erstellen und bei Bedarf das Original-Python-CLI starten können muss. Das Tool arbeitet für Analyse und Export offline; die direkte Änderung einer bestehenden `config.plist` erfordert eine explizite Bestätigung.

## Testen

```bash
./Tests/run-smoke-tests.sh
```

Der Test kompiliert die native Swift-Engine und prüft für alle fünf VBT-Dumps:
VBT/BDB-Parsing, aktive Connectoren, Little-Endian-`device-id`, Platform-ID, XML-Plist-Syntax sowie das Zusammenführen in eine bestehende OpenCore-`config.plist`.

## Hinweise

- Die native Engine orientiert sich an der React-/TypeScript-Implementierung. Für den Vergleich mit der umfassenderen Python-Referenz kann der zusätzliche CLI-Modus benutzt werden.
- Apple-Framebuffer-Patches sind hardware- und macOS-abhängig. Die erzeugte EFI-Konfiguration vor dem produktiven Boot prüfen.
- Ein macOS-ununterstütztes Intel-Xe-Modell wird durch Spoofing **nicht** zu einer unterstützten iGPU.
- Beim Merge werden vorhandene Plist-Einträge behalten. Beim Export wird die Datei als XML serialisiert, weshalb rein kosmetische XML-Kommentare des Originals nicht erhalten bleiben.
