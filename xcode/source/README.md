# vbt2fbpatch

> **Intel Video BIOS Table (VBT) Parser, iGPU Compatibility Engine & WhateverGreen Framebuffer Patcher for macOS**  
> *Author: 5T33Z0 · Version: 3.4.0 · License: MIT*

`vbt2fbpatch` is a zero-dependency, cross-platform Python 3 command-line utility and web application designed for Intel-based Hackintosh configurations. It parses dumped Intel Video BIOS Tables (`vbt.bin`), checks Intel integrated graphics (iGPU) Device-ID compatibility against the official WhateverGreen documentation, and automatically generates matching OpenCore `DeviceProperties` patches (`PciRoot(0x0)/Pci(0x2,0x0)`) for macOS.

---

## Table of Contents
1. [Introduction: Why This Tool Exists](#1-introduction-why-this-tool-exists)
2. [How It Works: Technical Architecture](#2-how-it-works-technical-architecture)
3. [Intel iGPU Compatibility & WhateverGreen Spoofing Guide](#3-intel-igpu-compatibility--whatevergreen-spoofing-guide)
4. [User Instructions](#4-user-instructions)
   - [Step 1: Obtaining `vbt.bin` from Live Linux](#step-1-obtaining-vbtbin-from-live-linux)
   - [Step 2: Alternative Extraction via UEFI Firmware](#step-2-alternative-extraction-via-uefi-firmware)
   - [Step 3: Running `vbt2fbpatch.py`](#step-3-running-vbt2fbpatchpy)
   - [Step 4: Merging into OpenCore `config.plist`](#step-4-merging-into-opencore-configplist)
5. [CLI Flags & Options Reference](#5-cli-flags--options-reference)
6. [Building a Native macOS (Intel) Standalone Binary](#6-building-a-native-macos-intel-standalone-binary)
7. [Credits & Attributions](#7-credits--attributions)
8. [License](#8-license)

---

## 1. Introduction: Why This Tool Exists

When running macOS on non-Apple PC hardware (Hackintosh), display outputs frequently fail with:
- **Black screens** on boot or after waking from sleep.
- Displays only functioning on one port (e.g. DisplayPort works, but HDMI is black).
- Inverted backlight controls or broken brightness sliders on laptops.
- Lack of hardware acceleration (Metal / Quartz Extreme) on 10th Gen Comet Lake, Whiskey Lake, or Kaby Lake Refresh iGPUs.

### The Problem
Apple's graphics drivers (`AppleIntelFramebuffer*` / `AppleIntelKBLGraphicsFramebuffer`, `AppleIntelCFLGraphicsFramebuffer`, etc.) contain hardcoded connector tables tailored exclusively to genuine Mac hardware (iMac, Mac mini, MacBook Pro). For example, a genuine iMac might route DDI B to DisplayPort with Apple Bus ID `0x05`, while your PC motherboard routes DDI B to an HDMI port or uses DDI C for DisplayPort. When there is a mismatch between physical motherboard routing and macOS framebuffer expectations, the display engine cannot negotiate the connection, resulting in a black screen.

Furthermore, many popular Intel CPUs (such as 10th Gen Comet Lake Desktop `0x9BC8` / `0x9BC5` and Mobile `0x9B41`) share the Gen9.5 graphics microarchitecture with 8th/9th Gen Coffee Lake, but their native Device IDs are absent from Apple's driver kexts. Without injecting a compatible `device-id` spoof via WhateverGreen, macOS fails to attach the graphics acceleration driver.

### The Solution: `vbt2fbpatch`
Your computer's motherboard UEFI firmware contains a standardized data structure created by the Intel GOP (Graphics Output Protocol) driver called the **Video BIOS Table (VBT)**. The VBT defines the exact physical wiring of every display port on your motherboard or laptop:
- Which physical DDI lane is connected (DDI A, B, C, D, E, F).
- The connector type (eDP, DisplayPort, HDMI, DVI-D).
- DDC / AUX communication channels and Hot-Plug Detect (HPD) pins.
- Whether an onboard Level Shifter / Protocol Converter (LSPCON) chip is present for HDMI 2.0 (4K@60Hz).

`vbt2fbpatch` parses this raw binary table and acts as a **Rosetta Stone**, translating motherboard-specific physical ports directly into the corresponding Apple Framebuffer Bus IDs, connector types, pipes, and WhateverGreen flags, outputting a copy-paste ready OpenCore `DeviceProperties` snippet or directly patching your `config.plist`.

---

## 2. How It Works: Technical Architecture

`vbt2fbpatch.py` is written in Python 3.8+ using **only the Python standard library** (zero `pip` dependencies). It performs the following sequence:

### A. VBT & BDB Header Traversal
1. Scans the binary for the `$VBT` signature at byte offset `0x00` (or embedded inside a PCIR Option ROM).
2. Reads the 2-byte little-endian pointer to the BIOS Data Block (BDB) at offset `0x1A`.
3. Validates the BDB block header (signature `$BDB` or `BIOS_DATA_BLOCK`) and checks the BDB version.
4. Walks the BDB block linked list until it locates Block ID `0x28` (`BDB_CHILD_DEVICE_CONFIG` / Child Devices).

### B. Child Device Config Parsing (Block 0x28)
- Intel has revised the child device entry structure across VBT versions:
  - Legacy VBTs: 33-byte stride.
  - VBT version 196–216: 37-byte or 38-byte stride.
  - VBT version 221+: 40-byte stride.
- `vbt2fbpatch` dynamically calculates the stride from the block header or entry count, decoding for each device:
  - `device_type` flags (filters out inactive or non-display devices).
  - `dvo_port`: Physical transmitter output (DDI A through DDI F).
  - `ddc_pin` / `aux_channel`: Display Data Channel / AUX communication routing.
  - `hpd_status` / `hpd_invert`: Hot-plug detect pin and inverted polarity flags.
  - `flags`: LSPCON protocol converter indicators (for HDMI 2.0).

### C. The Rosetta Stone Translation Engine
The parser maps physical Intel DVO ports to Apple Framebuffer Bus IDs:

| Physical Intel Port | Intel DVO Port | Apple Framebuffer Bus ID | OpenCore Hex (LE) | OpenCore Base64 |
| :--- | :--- | :--- | :--- | :--- |
| **DDI A / eDP** (Internal Panel) | `0x00` / `0x0A` | `0x00` | `<00000000>` | `AAAAAA==` |
| **DDI B** (External Port 1) | `0x01` / `0x07` | `0x05` | `<05000000>` | `BQAAAA==` |
| **DDI C** (External Port 2) | `0x02` / `0x08` | `0x04` | `<04000000>` | `BAAAAA==` |
| **DDI D** (External Port 3) | `0x03` / `0x09` | `0x06` | `<06000000>` | `BgAAAA==` |
| **DDI E / F** (External Port 4/5) | `0x0B` .. `0x0E` | `0x01` or `0x02` | `<01000000>` | `AQAAAA==` |

Physical connector types are translated to macOS Framebuffer Connector Types:
- **eDP / LVDS (Internal Laptop Panel)**: `0x00020000` &rarr; Base64 `AgAAAA==`
- **DisplayPort (DP)**: `0x00040000` &rarr; Base64 `AAQAAA==`
- **HDMI / DVI-D (TMDS)**: `0x00080000` &rarr; Base64 `AAgAAA==`

### D. WhateverGreen Compatibility & Spoof Resolution
`vbt2fbpatch` contains a comprehensive database derived from WhateverGreen's official documentation (`FAQ.IntelHD.en.md`):
- Cross-references the iGPU Device ID (passed via `-d`, auto-detected via PCIR, or probed from Linux/Windows sysfs).
- Evaluates target macOS version rules (e.g. 9th Gen Coffee Lake-R `0x3E98` requires spoofing below macOS 10.14.4, but is native in 10.14.4+; Skylake requires Kaby Lake spoofing on macOS 13+ Ventura).
- Automatically selects the optimal `AAPL,ig-platform-id` matching the detected form factor (Desktop vs Mobile).
- Generates exact Little-Endian 4-byte values using `struct.pack('<I', val)` (e.g. `0x3E9B` &rarr; `9B 3E 00 00` / Base64 `mz4AAA==`).

### E. Advanced Hardware Flags
- **LSPCON Detection**: If the VBT indicates an LSPCON chip on a port, the tool automatically injects `enable-lspcon-support = 1` and `framebuffer-conX-has-lspcon = 1`. `--lspcon-mode pcon` sets DP-to-HDMI 2.0 PCON mode.
- **Backlight PWM Fix**: `--backlight-fix` injects `enable-backlight-registers-fix` on macOS &le; 13.3 or `enable-backlight-registers-alternative-fix` on macOS 13.4+ (Ventura 13.4, Sonoma, Sequoia).
- **IntelFramebuffer.bt Flags**: Evaluates connector flags (e.g. `0x3C7`) and framebuffer flags against the `IntelFramebuffer.bt` template to inspect power well and aperture settings.

---

## 3. Intel iGPU Compatibility & WhateverGreen Spoofing Guide

| Generation | iGPU Model | Native Device ID | macOS Support | Spoof Target | Recommended `AAPL,ig-platform-id` | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Comet Lake Desktop** | UHD 630 | `0x9BC8`, `0x9BC5` | **Needs Spoof** | `0x3E9B` | `3E9B0007` (`07009B3E`) | Native starting macOS 10.15.4 for some models; spoof recommended for Sonoma/Sequoia. |
| **Comet Lake Mobile** | UHD 620 / 630 | `0x9B41`, `0x9BA4` | **Needs Spoof** | `0x3E9B` | `3EA50009` (`0900A53E`) | Working community patch. |
| **Coffee Lake Desktop** | UHD 630 | `0x3E9B`, `0x3E92`, `0x3E91` | **Native** | None | `3E9B0007` (`07009B3E`) | Full native support across macOS Mojave through Sequoia. |
| **Coffee Lake-R** | UHD 630 | `0x3E98` | **Conditional** | `0x3E92` (if &lt;10.14.4) | `3E9B0007` (`07009B3E`) | Natively supported in macOS 10.14.4 and newer. |
| **Whiskey Lake Mobile** | UHD 620 | `0x3EA0` | **Needs Spoof** | `0x3EA5` | `3EA50009` (`0900A53E`) | Fakes Coffee Lake Iris Plus 655. |
| **Kaby Lake Desktop** | HD 630 | `0x5912`, `0x591B` | **Native** | None | `59120000` (`00001259`) | Native in High Sierra through Monterey; legacy on Ventura+. |
| **Kaby Lake Refresh** | UHD 620 | `0x5917` | **Needs Spoof** | `0x5916` | `59160000` (`00001659`) | Needs spoof to KBL mobile HD 620. |
| **Skylake Desktop** | HD 530 | `0x1912` | **Conditional** | `0x5912` (if &ge;13.0) | `19120000` / `59120000` | Native up to Monterey (12.x). macOS 13+ requires Kaby Lake spoof and `-igfxsklaskbl`. |
| **Ice Lake Mobile** | Iris Plus G7 | `0x8A52`, `0x8A53` | **Native** | None | `8A520000` (`0000528A`) | Native in Catalina 10.15.4 through Sequoia. |
| **Haswell Desktop** | HD 4400 | `0x041E` | **Needs Spoof** | `0x0412` | `0D220003` (`0300220D`) | Needs spoof to HD 4600. |
| **11th–14th Gen Xe** | Rocket/Tiger/Alder/Raptor | `0x4C8A`, `0x4680` | **UNSUPPORTED** | None | N/A | **No macOS drivers exist.** Requires a compatible AMD discrete GPU. |

---

## 4. User Instructions

### Step 1: Obtaining `vbt.bin` from Live Linux
The most reliable way to dump your motherboard's active VBT is through the Linux kernel's `i915` DRM debugfs interface.

1. Boot your target PC with any Linux Live USB (Ubuntu, Fedora, Arch, Linux Mint).
2. Open a terminal and verify `debugfs` is mounted:
   ```bash
   sudo mount -t debugfs none /sys/kernel/debug
   ```
3. Dump the active VBT to `vbt.bin`:
   ```bash
   sudo cat /sys/kernel/debug/dri/0/i915_vbt > vbt.bin
   ```
   *(Note: If your system has both an iGPU and an AMD/NVIDIA dGPU, the Intel graphics controller may be at `dri/1/i915_vbt`).*
4. Verify the dump starts with `$VBT`:
   ```bash
   head -c 4 vbt.bin
   # Output must be: $VBT
   ```
5. Copy `vbt.bin` to a flash drive or upload it to the `vbt2fbpatch` web app.

### Step 2: Alternative Extraction via UEFI Firmware
If Linux cannot be booted, you can extract the VBT directly from your motherboard's BIOS ROM:
1. Download your motherboard manufacturer's BIOS update file.
2. Open the BIOS file in **UEFITool**.
3. Press `Ctrl + F`, choose the **Text** tab, and search for `Intel(R) Video BIOS` or GUID `878AC2CC-5343-46F2-B5CE-E78E3001E601`.
4. Extract the raw section/body to `vbt.bin`.

### Step 3: Running `vbt2fbpatch.py`
`vbt2fbpatch.py` requires Python 3.8+ and no external packages.

```bash
# Basic run with your dumped VBT and iGPU Device ID:
python3 vbt2fbpatch.py -i vbt.bin -d 3E9B

# Comet Lake Desktop (0x9BC8) targeting macOS 14 Sonoma:
python3 vbt2fbpatch.py -i vbt.bin -d 9BC8 -t 14.0

# Laptop with eDP panel and Backlight Fix:
python3 vbt2fbpatch.py -i vbt.bin -d 3E9B --mobile --backlight-fix

# HDMI 2.0 4K@60Hz with LSPCON PCON mode:
python3 vbt2fbpatch.py -i vbt.bin -d 3E9B --lspcon-mode pcon
```

### Step 4: Merging into OpenCore `config.plist`
You can merge the generated patch directly into your existing `config.plist` without manually editing XML. `vbt2fbpatch` creates an automatic backup (`config.plist.bak`) before writing:

```bash
python3 vbt2fbpatch.py -i vbt.bin -d 9BC8 -p 07009B3E -m /Volumes/EFI/EFI/OC/config.plist
```

---

## 5. CLI Flags & Options Reference

```
usage: vbt2fbpatch [-h] -i INPUT [-d DEVICE_ID] [--detect-device-id]
                   [-p PLATFORM_ID] [-t TARGET_MACOS]
                   [-f {desktop,mobile,headless}] [--spoof-id SPOOF_ID]
                   [--unifiedmem] [--rps-control] [--backlight-fix] [--mobile]
                   [--first-con N] [--bus-id-source {ddi,ddc}] [--pipe N]
                   [--con-flags HEX] [--fb-flags HEX]
                   [--lspcon-mode {pcon,ls}] [--verbose] [-m MERGE]
                   [-o OUTPUT] [--json] [-v]

Parse an Intel VBT dump and generate a WhateverGreen/OpenCore framebuffer patch.

options:
  -h, --help            show this help message and exit
  -i INPUT, --input INPUT
                        VBT dump or option ROM containing a VBT (required)
  -d DEVICE_ID, --device-id DEVICE_ID
                        iGPU PCI device-id in hex (e.g. 3E9B, 9BC8, 0412).
                        Read from PCIR header if present.
  --detect-device-id    Read iGPU device-id from the current machine (Linux, Windows).
                        Not available on macOS (to prevent reading existing spoofs).
  -p PLATFORM_ID, --platform-id PLATFORM_ID
                        AAPL,ig-platform-id in FAQ notation (e.g. 3E9B0007).
                        Overrides automatic choice.
  -t TARGET_MACOS, --target-macos TARGET_MACOS
                        Target macOS version for compatibility check (default: 14.0).
  -f {desktop,mobile,headless}, --form-factor {desktop,mobile,headless}
                        Framebuffer type. Default: mobile if VBT has an internal panel,
                        else desktop.
  --spoof-id SPOOF_ID   Inject this device-id instead of the FAQ value (hex, e.g. 3E9B).
  --unifiedmem          Add framebuffer-unifiedmem (2048MB DVMT workaround).
  --rps-control         Add rps-control (RPS power control fix).
  --backlight-fix       Add backlight register fix for KBL/CFL/ICL laptops
                        (automatically uses alternative fix on macOS 13.4+).
  --mobile              Laptop mode: enforces mobile framebuffer, max 3 connectors
                        (con0..con2) and framebuffer-portcount = 3.
  --first-con N         Index of first framebuffer-conN patch (default: 0 with internal
                        panel, otherwise 1).
  --bus-id-source {ddi,ddc}
                        Bus-ID source for HDMI/DVI ports: from DDI (default) or from
                        VBT ddc_pin (experimental legacy GMBUS pins 4, 5, 6).
  --pipe N              Override pipe for every connector patch (e.g. 18).
  --con-flags HEX       Set framebuffer-conN-flags on external connectors (e.g. 0x3C7).
  --fb-flags HEX        Set framebuffer-flags (e.g. 0xE30B0A).
  --lspcon-mode {pcon,ls}
                        Set framebuffer-conN-preferred-lspcon-mode on ports marked
                        as LSPCON (pcon = DP to HDMI 2.0, ls = HDMI 1.4).
  --verbose             Display detailed parser notes.
  -m MERGE, --merge MERGE
                        Path to config.plist to merge into (.bak copy written first).
  -o OUTPUT, --output OUTPUT
                        Write generated OpenCore XML snippet to file.
  --json                Print machine-readable JSON output for scripting/automation.
  -v, --version         Show program's version number and exit.
```

---

## 6. Building a Native macOS (Intel) Standalone Binary

You can package `vbt2fbpatch.py` into a self-contained, native executable for macOS on Intel x86_64 architectures so it runs on any Mac without needing Python installed.

### Method 1: Using PyInstaller (Recommended)
PyInstaller bundles the script and standard runtime into a single, standalone Unix binary.

1. Install PyInstaller:
   ```bash
   pip3 install pyinstaller
   ```
2. Build the Intel x86_64 standalone binary:
   ```bash
   pyinstaller --onefile \
               --name vbt2fbpatch \
               --target-arch x86_64 \
               --clean \
               vbt2fbpatch.py
   ```
3. The executable will be generated at `dist/vbt2fbpatch`.
4. Test and install:
   ```bash
   # Check version and architecture
   file dist/vbt2fbpatch
   # Output: Mach-O 64-bit executable x86_64

   ./dist/vbt2fbpatch --version
   # Output: vbt2fbpatch 3.4.0

   # Install system-wide to /usr/local/bin
   sudo cp dist/vbt2fbpatch /usr/local/bin/
   ```

### Method 2: Using Nuitka (Ahead-of-Time C Compilation)
Nuitka translates the Python code into C, compiling it into a true native Mach-O binary for maximum execution speed:

1. Install Nuitka:
   ```bash
   pip3 install nuitka
   ```
2. Compile to native Intel x86_64 binary:
   ```bash
   python3 -m nuitka --standalone \
                     --onefile \
                     --macos-target-arch=x86_64 \
                     --output-filename=vbt2fbpatch \
                     vbt2fbpatch.py
   ```
3. The compiled binary `vbt2fbpatch` will be created in the current directory.

### Gatekeeper Note on macOS
If you distribute the compiled binary to another Mac and encounter a Gatekeeper warning (`"vbt2fbpatch" cannot be opened because the developer cannot be verified`), remove the quarantine extended attribute:
```bash
xattr -cr /path/to/vbt2fbpatch
chmod +x /path/to/vbt2fbpatch
```

---

## 7. Credits & Attributions

The author gratefully acknowledges the following authors and open-source resources that made this project possible:

- **5T33Z0**: Author and creator of `vbt2fbpatch`.
- **Acidanthera / WhateverGreen Team**:
  - The [WhateverGreen Intel HD FAQ (`FAQ.IntelHD.en.md`)](https://github.com/acidanthera/WhateverGreen/blob/master/Manual/FAQ.IntelHD.en.md), which serves as the primary hardware compatibility database, connector dump reference, bus ID translation matrix, and documentation for LSPCON and backlight register fixes.
- **Intel Corporation & Linux Kernel Developers**:
  - `drivers/gpu/drm/i915/display/intel_vbt_defs.h` and `intel_bios.c` (Copyright &copy; Intel Corporation, MIT license) for VBT and BDB layout specifications, child device structures, DVO port mappings, and device-type definitions.
- **Eric Anholt / igt-gpu-tools**:
  - `tools/intel_vbt_decode.c` (Copyright &copy; 2006 Intel Corporation, MIT license) for BDB version gates (AUX 155, LSPCON 192, Type-C 195, HPD invert 196, Thunderbolt 209) and connector decoding routines.
- **OC-Little-Translated**:
  - `IntelFramebuffer.bt` 010 Editor binary template for macOS framebuffer and connector flag bitmask definitions.

---

## 8. License

Copyright &copy; 2026 5T33Z0.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
