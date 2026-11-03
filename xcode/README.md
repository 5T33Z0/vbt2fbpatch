# VBT2FBPatch Native (macOS)

The web app from `source/` has been integrated into the existing Xcode project as a **native SwiftUI application**. Normal operation does **not require WebView, Node.js, Vite, Express, or Python**.

## Getting Started

1. Open `VBT2FBPatch.xcodeproj` in Xcode.
2. Select the **VBT2FBPatch** scheme and **My Mac** as the run destination.
3. Press **⌘R** to launch the application.

Minimum requirement: **macOS 14.0**. Both Intel x86_64 and Apple Silicon arm64 are supported.

## Interface

- **Routing:** Open a VBT or select one of the five built-in examples to inspect DDI routing and Apple framebuffers.
- **iGPU Database:** 41 models from the TypeScript database, including macOS versions, spoof IDs, and boot arguments.
- **Connector Table:** VBT Device Type, DVO, DDC, AUX, macOS Connector Type, and Bus ID.
- **OpenCore XML:** Generate, copy, and export `DeviceProperties` snippets with Base64 data and byte comments.
- **config.plist Merge:** Load an existing XML or binary plist and export the patched file separately, or modify the original directly **after confirmation and backup**.
- **Terminal:** Display hardware and connector summaries as text.
- **Hex Inspector:** Inspect BDB blocks and hexadecimal dumps.
- **CLI & Guide:** Run the original Python engine (requires a separately available `/usr/bin/python3`), view JSON output, export the CLI source code, and access the VBT dump guide.

The **Advanced** section provides options for configuring LSPCON (PCON / LS), Backlight Fix, DDC/DDI Bus IDs, laptop port count, pipe, connector index, Unifiedmem, RPS, and hexadecimal flags.

Custom VBT files can also be loaded into the application using drag and drop.

## Technical Structure

| File/Directory | Purpose |
| --- | --- |
| `VBT2FBPatch/ContentView.swift` | Main window, sidebar, and settings |
| `VBT2FBPatch/Core/WorkspaceContent.swift` | The eight workspaces |
| `VBT2FBPatch/Core/VBTParser.swift` | Native VBT/BDB/Child Device parser |
| `VBT2FBPatch/Core/IGPUCompatibility.swift` | iGPU compatibility versions and spoofing analysis |
| `VBT2FBPatch/Core/PatchGenerator.swift` | OpenCore properties, XML, and safe plist merge operations |
| `VBT2FBPatch/Core/Workbench.swift` | App state, file dialogs, exports, and optional Python runner |
| `VBT2FBPatch/Resources/` | iGPU database, five VBT dumps, and original Python CLI |
| `source/` | Unmodified reference implementation |

The Xcode target is **not sandboxed** because this local developer utility needs to create backups alongside selected EFI files and, when necessary, launch the original Python CLI.

The tool operates offline for analysis and export. Direct modification of an existing `config.plist` requires explicit user confirmation.

## Testing

```bash
./Tests/run-smoke-tests.sh
```

The test compiles the native Swift engine and validates all five VBT dumps for:

- VBT/BDB parsing
- Active connectors
- Little-endian `device-id`
- Platform ID
- XML plist syntax
- Merging into an existing OpenCore `config.plist`

## Notes

- The native engine follows the React/TypeScript implementation. For comparison with the more comprehensive Python reference implementation, the additional CLI mode can be used.
- Apple framebuffer patches are hardware- and macOS-dependent. Verify the generated EFI configuration before using it for a production boot.
- Spoofing an unsupported Intel Xe model does **not** make its iGPU supported by an unsupported version of macOS.
- Existing plist entries are preserved during merging. When exporting, the file is serialized as XML, so purely cosmetic XML comments from the original file are not retained.
