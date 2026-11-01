# vbt2fbpatch

Generate OpenCore framebuffer patches for Intel iGPUs from your machine's own firmware data.

`vbt2fbpatch` reads the display connector table from a dumped Intel Video BIOS Table (VBT), checks your iGPU against the [WhateverGreen Intel HD manual](https://github.com/acidanthera/WhateverGreen/blob/master/Manual/FAQ.IntelHD.en.md), and prints a ready-to-use `DeviceProperties` snippet for your `config.plist`.

> [!NOTE]
> Treat this as a proof of concept. The original web app, built in Google AI Studio, has a GUI with more manual settings, but I haven't managed to turn it into a native macOS app yet.
>
> The command-line tool is tested against the example values in the WhateverGreen manual and synthetic VBT files, not yet on a wide range of real boards. Treat the output as a well-informed starting point, not a guaranteed working patch.

---

## About

Getting Intel graphics to work on a Hackintosh usually means answering three questions:

1. Does macOS support this iGPU natively, or does its device-id have to be spoofed?
2. Which `AAPL,ig-platform-id` fits my machine?
3. Which physical ports (eDP, HDMI, DisplayPort) does my board actually have, and how do they map to Apple's framebuffer connectors?

The answers are spread across the manual, the framebuffer lists and your board's firmware. This tool combines them in one step.

**What it does**

- Reads the connectors your firmware defines (internal panel, HDMI, DisplayPort, DVI).
- Tells you whether your iGPU needs a device-id spoof for your target macOS version, and which one.
- Suggests a platform-id for desktop, mobile or headless (compute-only) setups.
- Generates `framebuffer-conN-*` patches that match your real ports.
- Outputs an XML snippet, JSON, or merges directly into a `config.plist` (with a backup).

**What it does not do**

- It does not replace the WhateverGreen manual. Read the section for your iGPU generation.
- It does not support Sandy Bridge or Ivy Bridge, and Intel Xe (11th gen and newer) has no macOS graphics driver at all.
- It does not touch BIOS settings. Follow the manual's firmware requirements (for example DVMT pre-allocation).

Single file, Python 3.8+, no external dependencies. Works on macOS, Linux and Windows.

---

## How it works

```
 VBT dump ──▶ 1. Read ──▶ 2. Identify ──▶ 3. Choose ──▶ 4. Map ──▶ 5. Output
                          the iGPU         framebuffer    connectors
```

1. **Read the VBT.** The tool locates the Video BIOS Table in your dump, checks its checksum and reads the list of display connectors the firmware defines: handle (LFP1, EFP1, ...), port, connector type, AUX channel, DDC pin and hot-plug flags, plus USB-C/Thunderbolt markers on newer VBTs. Which fields are valid depends on the BDB version, so the tool takes that into account. Empty and unusable entries (analog VGA, MIPI) are ignored.
2. **Identify the iGPU.** Using the device-id you provide (or one found in the file), the tool looks it up in a table built from the WhateverGreen manual. For your target macOS version the result is one of: native, needs a device-id spoof, unsupported macOS version, unsupported hardware, or unknown.
3. **Choose a framebuffer.** Based on the result and the form factor (desktop, mobile or headless), the tool picks a platform-id from the manual's framebuffer lists. You can override it.
4. **Map the connectors.** Each connector from the VBT is translated into Apple's framebuffer terms: connector type, bus ID and display pipe. macOS framebuffers hold at most four connectors (`con0` to `con3`), so the internal panel is kept first and any excess ports are reported.
5. **Write the output.** Everything is serialized in the byte order OpenCore expects and printed as an XML snippet, as JSON, or merged into your `config.plist`.

If the device-id is not in the table, the tool stops and asks you to supply values yourself. It does not guess.

---

## Requirements

- Python 3.8 or newer
- A VBT dump from the machine you are patching (see below)
- The iGPU's PCI device-id

---

## Usage

### 1. Get your VBT

The easiest way is from Linux (a live USB is enough), as root (&rarr; [**Detailed Instructions**](/docs/dump_vbt.md)):

```bash
sudo cat /sys/kernel/debug/dri/0/i915_vbt > vbt.bin
```

The path can differ if you have more than one GPU (`dri/1`, and so on). Alternatively, extract the VBT from a dump of your BIOS image with a firmware tool such as UEFITool.

### 2. Find your device-id

**Intel ARK:** look up your CPU on [ark.intel.com](https://ark.intel.com). The *Processor Graphics* section lists the iGPU's device ID, for example `0x3E9B`. Some CPUs list more than one ID. If yours does, confirm the right one with one of the methods below.

**On Linux:**

```bash
lspci -nn | grep -i vga
```

The device-id is the second half of the `[8086:xxxx]` pair, for example `3E9B`.

**On Windows:**

1. Open Device Manager (right-click the Start button).
2. Expand **Display adapters** and right-click your Intel graphics entry, then choose **Properties**.
3. Open the **Details** tab and pick **Hardware Ids** in the *Property* dropdown.
4. Read the value after `DEV_` in the first line, for example `PCI\VEN_8086&DEV_3E9B&...` means `3E9B`.

### 3. Run the tool

```bash
python3 vbt2fbpatch.py -i vbt.bin -d 3E9B -t 14.0
```

The output contains a summary (status, spoof, platform-id), a connector table and the XML snippet. Copy the snippet into `DeviceProperties > Add` of your `config.plist`, or let the tool do it:

```bash
python3 vbt2fbpatch.py -i vbt.bin -d 3E9B -t 14.0 -m /path/to/config.plist
```

`--merge` keeps your existing keys and writes a `config.plist.bak` backup first. Plist comments are not preserved.

### Options

| Option | Description |
|---|---|
| `-i`, `--input` | VBT dump or option ROM (required) |
| `-d`, `--device-id` | iGPU device-id in hex, e.g. `3E9B` (read from the file if it contains a PCIR header) |
| `-t`, `--target-macos` | Target macOS version, default `14.0` |
| `-f`, `--form-factor` | `desktop`, `mobile` or `headless`. Default: mobile if the VBT has an internal panel, otherwise desktop |
| `-p`, `--platform-id` | Override the platform-id, written as in the manual's framebuffer lists, e.g. `3E9B0007` |
| `--spoof-id` | Use your own device-id spoof, e.g. `3EA5` |
| `--unifiedmem` | Add `framebuffer-unifiedmem` (DVMT workaround) |
| `--rps-control` | Add `rps-control` |
| `--mobile` | Laptop mode: mobile framebuffer, at most 3 connectors (`con0` to `con2`) and `framebuffer-portcount` = 3 |
| `--first-con N` | Index of the first `framebuffer-conN` patch. Default: 0 with an internal panel, otherwise 1, like the FAQ framebuffers |
| `--bus-id-source ddi\|ddc` | Bus-ID of HDMI/DVI ports: from the DDI (default) or from the VBT's `ddc_pin` (experimental, only valid for legacy GMBUS pins 4, 5 and 6) |
| `--pipe N` | Override the pipe of every connector patch, for example `18` (some community laptop patches use it) |
| `--lspcon-mode pcon\|ls` | Also set `framebuffer-conN-preferred-lspcon-mode` on ports the VBT marks as LSPCON |
| `--verbose` | Show parser notes |
| `--backlight-fix` | Add the backlight register fix for Kaby Lake, Coffee Lake and Ice Lake laptops. Uses `enable-backlight-registers-alternative-fix` on macOS 13.4 and newer, otherwise `enable-backlight-registers-fix` |
| `-m`, `--merge` | Merge the patch into this `config.plist` |
| `-o`, `--output` | Save the XML snippet to a file |
| `--json` | Machine-readable output |

### Reading the status

| Status | Meaning |
|---|---|
| `NATIVE` | Works with the device-id as it is. No spoof. |
| `NEEDS_SPOOF` | A device-id spoof is part of the patch. |
| `UNSUPPORTED_OS` | The manual documents no driver for this iGPU on your macOS version. Older generations need OpenCore Legacy Patcher on newer macOS. |
| `UNSUPPORTED` | No macOS driver exists (Intel Xe and newer). Disable the iGPU and use a supported AMD GPU. |
| `UNKNOWN` | Device-id not in the table. Pass `-p` (and `--spoof-id` if needed) yourself. |

Exit codes: `0` success, `1` file or parse error, `2` missing or invalid input, `3` unsupported iGPU.

---

## Notes and limitations

- **Verify on your hardware.** Connector indices, pipes and bus IDs follow the patterns in the manual's connector dumps. If a port stays black, compare against the framebuffer you ended up with.
- **Skylake on macOS 13 and newer** needs a Kaby Lake spoof. The pairing the tool uses is the closest match, and the manual recommends experimenting if it does not fit.
- **DisplayPort++ ports** are patched as HDMI. DDI E and F connectors are skipped and reported.
- **Backlight fixes are opt-in.** The VBT does not say whether a laptop needs them, so the tool only adds the property if you pass `--backlight-fix`. The manual documents it for Kaby Lake, Coffee Lake and Ice Lake graphics only.
- **LSPCON ports are detected from the VBT** (BDB 192 and newer). For those ports the tool adds `framebuffer-conN-has-lspcon` and `enable-lspcon-support`. The FAQ says the driver is only needed when HDMI 2.0 is routed to the iGPU.
- **Comet Lake U laptops (9B41, 9BCA, 9BCC)** are not in the FAQ. The spoof to 0x3E9B and the `3E9B0000` framebuffer come from a working community patch.
- **Bus IDs are the weak spot.** For HDMI and DVI ports the Apple bus-ID corresponds to the DDC (GMBUS) pin on older platforms. The tool derives it from the DDI by default and warns when the VBT's `ddc_pin` disagrees. Newer VBTs store the pin in a different encoding, which the tool cannot translate, so those values are shown but not used.
- **Back up first.** Keep a working EFI around before testing a new patch.

---

## Tests

```bash
python3 -m unittest -v test_vbt2fbpatch
```

The tests check the byte values against the examples in the WhateverGreen manual, the compatibility rules for each iGPU generation, VBT parsing on a synthetic table, and the command line.

---

## Development notes

This project was written entirely with AI. The first version came from Google AI Studio. It was then reviewed against the WhateverGreen manual and the Linux i915 driver sources, and the script, tests and this README were rewritten with Claude. Entries that could not be sourced were removed rather than guessed. The tests check the generated bytes against the manual's examples, but they use synthetic data, and the tool has not yet been verified on a wide range of real hardware. Bug reports and corrections to the data are welcome.

---

## Credits

- [WhateverGreen](https://github.com/acidanthera/WhateverGreen) and the Acidanthera team for the Intel HD manual this tool is built on
- The Linux i915 driver and igt-gpu-tools (Intel Corporation, MIT) for the public VBT format definitions

## License

MIT. The VBT format definitions follow the Linux i915 driver (Intel Corporation, MIT). See `LICENSE`.
