# Changelog

All notable changes to vbt2fbpatch are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [3.3.1] - 2026-11-02

### Fixed
- `--detect-device-id` is refused on macOS. macOS reports the device-id that `config.plist` injects, so on a machine that already spoofs its id the tool saw the spoofed value, treated the iGPU as native and generated a patch without the spoof. The error tells you to pass the real id with `-d`. The missing-id error on macOS no longer suggests the flag.

### Removed
- The macOS `ioreg` parser.

## [3.3.0] - 2026-11-02

### Added
- `--detect-device-id`: reads the iGPU device-id from the machine running the script when `-d` is not given and the file has no PCIR header. Linux reads sysfs, Windows reads the video controller's PNP id through PowerShell, and macOS parses `ioreg`. The output names the source and warns that this assumes the VBT comes from the same machine (and, on macOS, that an injected spoof shows up as the spoofed id). `-d` and a PCIR header still take priority.
- `device_id_source` (`argument`, `pcir` or `system`) in the JSON output.
- Tests for the detection with a fake sysfs tree and sample Windows and macOS output.

### Changed
- The error for a missing device-id now points to `--detect-device-id`.

## [3.2.1] - 2026-11-02

Fixes found by cross-checking the decoder against igt-gpu-tools' `intel_vbt_decode.c`. The handle names and the BDB-version gates for LSPCON (192), Type-C (195), hot-plug invert (196) and Thunderbolt (209) already agreed with it.

### Fixed
- AUX channel decoding starts at BDB 155, as in igt. It started at 158 in 3.1.0 and 3.2.0, which hid the AUX channel on VBTs with BDB 155 to 157 (Haswell era).
- Device handles with several bits set show all names (`LFP1,LFP2`) instead of the raw value.

### Changed
- Child entries smaller than 33 bytes (old BDB versions) are decoded with zero padding, as igt does, instead of being rejected. A note is shown with `--verbose`. Entries below 22 bytes are still rejected.

## [3.2.0] - 2026-11-01

### Added
- Comet Lake U (mobile, UHD 630) device-ids 9B41, 9BCA and 9BCC (i915's "CML U GT2" list). They are spoofed to 0x3E9B with platform-id `3E9B0000`, taken from a working community patch. The FAQ does not document these, and the tool labels them as community-reported.
- LSPCON detection from the VBT (BDB 192 and newer). Ports with the flag get `framebuffer-conN-has-lspcon`, and `enable-lspcon-support` is added. A note explains that the FAQ only requires the driver when HDMI 2.0 is routed to the iGPU. The port table shows an `LSPCON` marker.
- `--lspcon-mode pcon|ls` to also set `framebuffer-conN-preferred-lspcon-mode`.
- `--pipe N` to override the pipe of every connector patch. Working community patches for laptops use pipe 18 (`0x12`) where the FAQ framebuffers use 8, 9 and 10.

## [3.1.0] - 2026-11-01

### Added
- VBT checksum verification. All `vbt_size` bytes, including the checksum byte, must add up to 0 mod 256. A mismatch is reported as a warning. Checked against two real VBT files.
- Per-port table of everything the VBT defines: handle (LFP1, EFP1, ...), DVO port, DDI, connector type, device type, AUX channel, DDC pin, I2C pin, hot-plug status and invert flag, and USB-C / Thunderbolt markers.
- Version-aware decoding of the child device fields. Fields are only read from the BDB version in which they exist: AUX channel from 158, USB-C from 195, hot-plug invert from 196, Thunderbolt from 209. Handle names that changed between BDB versions are resolved accordingly.
- Note when the child device size differs from the size i915 expects for the BDB version.
- `--mobile`: mobile framebuffer, at most three connectors (`con0` to `con2`) and `framebuffer-portcount` = 3.
- `--first-con N`: choose the index of the first `framebuffer-conN` patch.
- `--bus-id-source ddi|ddc` (experimental): take the bus-ID of HDMI/DVI ports from the DDI or from the VBT's `ddc_pin`. Only valid for legacy GMBUS pins 4, 5 and 6.
- Warning when an HDMI/DVI port's `ddc_pin` disagrees with the DDI-derived bus-ID.
- `--backlight-fix`: adds the backlight register fix documented in the WhateverGreen FAQ for Kaby Lake, Coffee Lake and Ice Lake laptops. It uses `enable-backlight-registers-alternative-fix` on macOS 13.4 and newer, and `enable-backlight-registers-fix` before that.
- `--verbose` to show parser notes.
- Port summary, VBT checksum and child device size in the text output. Checksum, ports and child device size in the JSON output.
- `LICENSE` file and README sections for the new options.

### Changed
- At most four connectors (`con0` to `con3`) are patched. The internal panel (LFP1 first) is kept before external ports, and dropped ports are listed in a warning.
- Connector numbering: with an internal panel it is `con0` and the external ports follow. Without a panel the external ports start at `con1`, as in the FAQ's desktop framebuffers.
- License changed from Apache-2.0 to MIT, with attribution to the Linux i915 driver and igt-gpu-tools.
- The VBT header version is shown in decimal.
- "BDB block runs past the end of the BDB" is now a note (`--verbose`) and no longer a warning.

## [3.0.0] - 2026-11-01

Rewrite after checking the script against the WhateverGreen Intel HD FAQ and the Linux i915 sources.

### Fixed
- Byte order of `device-id` and connector types. Values were swapped twice, so the generated bytes were wrong (for example `00 00 3E 9B` instead of `9B 3E 00 00`). All values are now stored as integers and converted once with `struct.pack('<I')`.
- Platform-ID handling. The guess based on the first byte is gone, so IDs such as `04120004` are no longer mangled. `-p` takes the FAQ notation (`3E9B0007`) and rejects raw bytes with a hint.
- Compatibility data, now matching the FAQ:
  - Comet Lake 9BC8, 9BC5 and 9BC4 are native from macOS 10.15.4 and no longer get a spoof.
  - Whiskey Lake 3EA0 spoofs to 0x3EA5 (`A53E0000`), not 0x3E9B.
  - Kaby Lake Refresh 5917 always needs the spoof to 0x5916 (`16590000`).
  - Skylake 1902 is native.
  - Mobile Haswell 0416 and 0A16 need the spoof to 0x0412 (`12040000`).
  - The Broadwell "headless" entry was removed.
  - Skylake on macOS 13+ now uses the matching Kaby Lake framebuffer and adds `AAPL,GfxYTile`. The `-igfxsklaskbl` boot-arg is not suggested any more, because the WhateverGreen README lists it as not required on macOS 13 and above.
- VBT parser. Child devices are read from block 2 (General Definitions), no longer from block 0x28, which is the LFP options block. Field offsets, device-type bits and the DVO-to-DDI mapping now follow the i915 driver.
- No more silent guessing. An unknown device-id gets the status `UNKNOWN`, and a missing device-id is an error instead of falling back to 9BC8.
- macOS version checks. Generations outside the documented range (for example Haswell and Broadwell on macOS 13+) are reported as `UNSUPPORTED_OS`.
- Connector pipes: the internal panel uses pipe 8 and external ports use 9, 10 and 8, as in the FAQ dumps.

### Changed
- `framebuffer-unifiedmem` and `rps-control` are opt-in (`--unifiedmem`, `--rps-control`) instead of always added.
- Form factor is taken from the VBT: mobile if there is an internal panel, otherwise desktop.
- `--merge` writes a `.bak` copy of the `config.plist` first.
- Exit codes: 1 file or parse error, 2 missing or invalid input, 3 unsupported iGPU.

### Removed
- Entries that the FAQ does not document (9B41, 9BA4, 9BA5, 9BC6, 9BA8, 041A, 0402), together with their CPU lists and the citations to FAQ sections that do not exist.
- `--force-spoof` and the backward-compatibility wrappers.

### Added
- Unit tests that check the generated bytes against the examples in the FAQ, the rules per iGPU generation, parsing of a synthetic VBT and the command line.
- README.

## [2.1.0]

Initial version, generated in Google AI Studio.
