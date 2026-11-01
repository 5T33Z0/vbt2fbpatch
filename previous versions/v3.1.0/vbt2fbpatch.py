#!/usr/bin/env python3
"""
vbt2fbpatch - Intel VBT parser and WhateverGreen/OpenCore framebuffer patch generator

Reads the connector table of a dumped Intel Video BIOS Table (VBT), checks the iGPU
Device-ID against the WhateverGreen manual and prints an OpenCore DeviceProperties
snippet: AAPL,ig-platform-id, an optional device-id spoof and framebuffer-conN-*
connector patches.

Single file, Python 3.8+, standard library only.

Data sources
  * iGPU support, device-id spoofs, platform-IDs:
      WhateverGreen/Manual/FAQ.IntelHD.en.md
      https://github.com/acidanthera/WhateverGreen/blob/master/Manual/FAQ.IntelHD.en.md
  * VBT / BDB layout, device-type bits, DVO-port mapping:
      Linux i915 driver (intel_vbt_defs.h, intel_bios.c)
  * Connector type values and bus IDs: the connector dumps in the FAQ

Byte order
  OpenCore stores DeviceProperties values as little-endian bytes. Every value in this
  file is kept as a plain integer and converted exactly once with struct.pack('<I', v):
      AAPL,ig-platform-id  0x0166000B  ->  0B 00 66 01
      device-id            0x1E3A      ->  3A 1E 00 00
      connector type DP    0x400       ->  00 04 00 00
  The FAQ prints device-ids and connector types as the final byte string (3A1E0000,
  00040000) and framebuffer IDs in integer notation (0x0166000B).

Attribution
  The VBT/BDB structure definitions, device-type bits and DVO/DDI/AUX mappings follow the
  Linux i915 driver (drivers/gpu/drm/i915/display/intel_vbt_defs.h and intel_bios.c,
  Copyright (c) Intel Corporation, MIT license). The same format is decoded by
  igt-gpu-tools' tools/intel_vbt_decode.c (Copyright (c) Intel Corporation, MIT license),
  a good reference decoder to compare against. No code was copied from either project.

License: MIT

Copyright (c) 2026 vbt2fbpatch contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this
software and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
"""

import argparse
import base64
import json
import os
import plistlib
import shutil
import struct
import sys
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Tuple, Union

__version__ = "3.1.0"
PROG_NAME = "vbt2fbpatch"
FAQ_URL = "https://github.com/acidanthera/WhateverGreen/blob/master/Manual/FAQ.IntelHD.en.md"
IGPU_PCI_PATH = "PciRoot(0x0)/Pci(0x2,0x0)"


# ==============================================================================
# Enums
# ==============================================================================

class CompatibilityStatus(str, Enum):
    NATIVE = "NATIVE"                  # driver matches the device-id, no spoof needed
    NEEDS_SPOOF = "NEEDS_SPOOF"        # device-id has to be faked
    UNSUPPORTED = "UNSUPPORTED"        # no macOS graphics driver exists
    UNSUPPORTED_OS = "UNSUPPORTED_OS"  # target macOS outside the range the FAQ documents
    UNKNOWN = "UNKNOWN"                # device-id is not in the FAQ-derived table


class FormFactor(str, Enum):
    DESKTOP = "desktop"
    MOBILE = "mobile"
    HEADLESS = "headless"              # "empty framebuffer": 0 connectors, IQSV only


# ==============================================================================
# Integers -> bytes
# ==============================================================================

def pack_u32_le(value: int) -> bytes:
    """Serialize an unsigned 32-bit integer as little-endian bytes."""
    if not 0 <= value <= 0xFFFFFFFF:
        raise ValueError(f"value out of 32-bit range: {value!r}")
    return struct.pack("<I", value)


def _clean_hex(text: str) -> str:
    clean = text.strip().replace("<", "").replace(">", "").replace(" ", "")
    if clean[:2].lower() == "0x":
        clean = clean[2:]
    return clean


def parse_device_id(raw: Union[int, str]) -> int:
    """Parse a PCI device-id such as 0x9BC8, '9bc8' or '9BC8' into an int (<= 0xFFFF)."""
    if isinstance(raw, int):
        value = raw
    else:
        clean = _clean_hex(raw)
        if not clean or len(clean) > 4 or any(c not in "0123456789abcdefABCDEF" for c in clean):
            raise ValueError(f"invalid device-id {raw!r}: expected 1-4 hex digits, e.g. 3E9B")
        value = int(clean, 16)
    if not 0 <= value <= 0xFFFF:
        raise ValueError(f"device-id out of range: {raw!r}")
    return value


def parse_platform_id(raw: Union[int, str]) -> int:
    """
    Parse an AAPL,ig-platform-id in the integer notation used by the FAQ's framebuffer
    lists and by the igfxframe boot-arg (e.g. 0x3E9B0007). Exactly 8 hex digits.
    """
    if isinstance(raw, int):
        value = raw
    else:
        clean = _clean_hex(raw)
        if len(clean) != 8 or any(c not in "0123456789abcdefABCDEF" for c in clean):
            raise ValueError(
                f"invalid platform-id {raw!r}: expected 8 hex digits in the notation of "
                f"the FAQ framebuffer lists, e.g. 3E9B0007"
            )
        value = int(clean, 16)
    if not 0 <= value <= 0xFFFFFFFF:
        raise ValueError(f"platform-id out of range: {raw!r}")
    return value


def serialize_device_id(device_id: Union[int, str]) -> bytes:
    """0x1E3A -> 3A 1E 00 00 (the bytes the FAQ prints as 3A1E0000)."""
    return pack_u32_le(parse_device_id(device_id))


def serialize_platform_id(platform_id: Union[int, str]) -> bytes:
    """0x0166000B -> 0B 00 66 01 (the bytes the FAQ prints as 0B006601)."""
    return pack_u32_le(parse_platform_id(platform_id))


def byteswap32(value: int) -> int:
    return struct.unpack("<I", struct.pack(">I", value))[0]


# Apple framebuffer connector types (values from the FAQ connector dumps)
CON_TYPE_LVDS = 0x00000002   # internal panel (LVDS and eDP both use this value)
CON_TYPE_DVI = 0x00000004
CON_TYPE_DP = 0x00000400
CON_TYPE_HDMI = 0x00000800


# ==============================================================================
# macOS version helpers
# ==============================================================================

def parse_macos_version(text: str) -> Tuple[int, int, int]:
    """'10.14.4' -> (10, 14, 4); '13' -> (13, 0, 0)."""
    parts: List[int] = []
    for chunk in text.strip().split("."):
        try:
            parts.append(int(chunk))
        except ValueError:
            break
    if not parts:
        raise ValueError(f"invalid macOS version {text!r}")
    while len(parts) < 3:
        parts.append(0)
    return (parts[0], parts[1], parts[2])


# ==============================================================================
# iGPU knowledge base
# Everything below comes from FAQ.IntelHD.en.md unless a comment says otherwise.
# Entries the FAQ does not cover are deliberately absent: an unknown device-id gets
# status UNKNOWN instead of a guessed spoof.
# ==============================================================================

SEC_HSW = "Intel HD Graphics 4200-5200 (Haswell processors)"
SEC_BDW = "Intel HD Graphics 5300-6300 (Broadwell processors)"
SEC_SKL = "Intel HD Graphics 510-580 (Skylake processors)"
SEC_KBL = "Intel (U)HD Graphics 610-650 (Kaby Lake and Amber Lake Y processors)"
SEC_CFL = "Intel UHD Graphics 610-655 (Coffee Lake and Comet Lake processors)"
SEC_ICL = "Intel Iris Plus Graphics (Ice Lake processors)"

DESKTOP, MOBILE, HEADLESS = FormFactor.DESKTOP, FormFactor.MOBILE, FormFactor.HEADLESS


@dataclass(frozen=True)
class PlatformProfile:
    """A framebuffer from the FAQ's framebuffer lists, in integer notation (0x3E9B0007)."""
    platform_id: int
    form_factor: FormFactor
    description: str

    @property
    def platform_id_str(self) -> str:
        return f"{self.platform_id:08X}"


def _p(hex_id: str, form_factor: FormFactor, description: str) -> PlatformProfile:
    return PlatformProfile(int(hex_id, 16), form_factor, description)


@dataclass(frozen=True)
class SpoofMapping:
    """A device-id the iGPU has to present to macOS."""
    target_id: int                          # e.g. 0x3E92
    faq_section: str
    reason: str
    required_from: Optional[str] = None     # spoof needed on macOS >= this
    required_below: Optional[str] = None    # spoof needed on macOS < this
    extends_max_macos: bool = False         # spoof makes macOS above macos_max usable
    extra_properties: Tuple[Tuple[str, int], ...] = ()

    @property
    def target_id_str(self) -> str:
        return f"{self.target_id:04X}"

    @property
    def faq_notation(self) -> str:
        """The byte string as the FAQ prints it, e.g. 923E0000."""
        return serialize_device_id(self.target_id).hex().upper()

    def active_on(self, macos: Tuple[int, int, int]) -> bool:
        if self.required_from and macos < parse_macos_version(self.required_from):
            return False
        if self.required_below and macos >= parse_macos_version(self.required_below):
            return False
        return True


@dataclass
class IGPUDevice:
    device_id: int
    model_name: str
    architecture: str
    form_factor: FormFactor                  # typical form factor, used when the VBT is silent
    supported: bool = True
    macos_min: Optional[str] = None          # first macOS that has a driver for this id / spoof target
    macos_max: Optional[str] = None          # last supported series ("12.99" = any 12.x); None = no known limit
    spoof: Optional[SpoofMapping] = None
    profiles: List[PlatformProfile] = field(default_factory=list)
    spoofed_profiles: List[PlatformProfile] = field(default_factory=list)  # used while the DB spoof is active
    faq_section: str = ""
    notes: str = ""


# --- spoofs documented in the FAQ ---------------------------------------------

SPOOF_HASWELL = SpoofMapping(
    0x0412, SEC_HSW,
    "Desktop HD4400 and mobile HD4200/HD4400/HD4600 need device-id 12040000 (0x0412).")

SPOOF_COFFEE_LAKE_REFRESH = SpoofMapping(
    0x3E92, SEC_CFL,
    "9th gen Coffee Lake Refresh needs device-id 923E0000 (0x3E92); "
    "not needed from macOS 10.14.4 on.",
    required_below="10.14.4")

SPOOF_WHISKEY_LAKE = SpoofMapping(
    0x3EA5, SEC_CFL,
    "Whiskey Lake UHD620 needs device-id A53E0000 (0x3EA5).")

SPOOF_KABY_LAKE_REFRESH = SpoofMapping(
    0x5916, SEC_KBL,
    "Kaby Lake Refresh UHD620 needs device-id 16590000 (0x5916).")

_SKL_REASON = (
    "Skylake is not supported natively on macOS 13+; the FAQ says to fake a Kaby Lake "
    "device-id and use a Kaby Lake platform-id. The pairing chosen here (same low byte) is "
    "the closest match; the FAQ says to experiment if it does not fit.")
_SKL_EXTRA = (("AAPL,GfxYTile", 1),)   # FAQ: may be injected with the platform-id to avoid glitches

SPOOF_SKL_1912 = SpoofMapping(0x5912, SEC_SKL, _SKL_REASON, required_from="13.0",
                              extends_max_macos=True, extra_properties=_SKL_EXTRA)
SPOOF_SKL_1916 = SpoofMapping(0x5916, SEC_SKL, _SKL_REASON, required_from="13.0",
                              extends_max_macos=True, extra_properties=_SKL_EXTRA)
SPOOF_SKL_191B = SpoofMapping(0x591B, SEC_SKL, _SKL_REASON, required_from="13.0",
                              extends_max_macos=True, extra_properties=_SKL_EXTRA)


# --- database -------------------------------------------------------------------

INTEL_IGPU_DATABASE: Dict[int, IGPUDevice] = {}


def _register(dev: IGPUDevice) -> None:
    INTEL_IGPU_DATABASE[dev.device_id] = dev


# Haswell: OS X 10.9.x to macOS 12.x
_HSW_PROFILES = [
    _p("0D220003", DESKTOP, "FAQ default desktop framebuffer"),
    _p("0A260006", MOBILE, "FAQ recommended laptop framebuffer"),
    _p("04120004", HEADLESS, "FAQ empty framebuffer"),
]
_register(IGPUDevice(0x0412, "Intel HD Graphics 4600 (Haswell desktop)", "Haswell", DESKTOP,
                     macos_min="10.9", macos_max="12.99", profiles=_HSW_PROFILES, faq_section=SEC_HSW))
_register(IGPUDevice(0x041E, "Intel HD Graphics 4400 (Haswell desktop)", "Haswell", DESKTOP,
                     macos_min="10.9", macos_max="12.99", spoof=SPOOF_HASWELL,
                     profiles=_HSW_PROFILES, faq_section=SEC_HSW))
_register(IGPUDevice(0x0416, "Intel HD Graphics 4600 (Haswell mobile)", "Haswell", MOBILE,
                     macos_min="10.9", macos_max="12.99", spoof=SPOOF_HASWELL,
                     profiles=_HSW_PROFILES, faq_section=SEC_HSW))
_register(IGPUDevice(0x0A16, "Intel HD Graphics 4400 (Haswell ULT mobile)", "Haswell", MOBILE,
                     macos_min="10.9", macos_max="12.99", spoof=SPOOF_HASWELL,
                     profiles=_HSW_PROFILES, faq_section=SEC_HSW))

# Broadwell: OS X 10.10.2 to macOS 12.x (the FAQ lists no empty framebuffer)
_register(IGPUDevice(0x1616, "Intel HD Graphics 5500 (Broadwell mobile)", "Broadwell", MOBILE,
                     macos_min="10.10.2", macos_max="12.99",
                     profiles=[_p("16260006", MOBILE, "FAQ default laptop framebuffer")],
                     faq_section=SEC_BDW))
_register(IGPUDevice(0x1622, "Intel Iris Pro Graphics 6200 (Broadwell desktop)", "Broadwell", DESKTOP,
                     macos_min="10.10.2", macos_max="12.99",
                     profiles=[_p("16220007", DESKTOP, "FAQ default desktop framebuffer")],
                     faq_section=SEC_BDW))

# Skylake: OS X 10.11.4 to macOS 12.x natively; macOS 13+ via Kaby Lake spoof
_SKL_NOTE_13 = ("macOS 13+ needs a Kaby Lake device-id spoof; the FAQ names no pairing for this "
                "id. Pass --spoof-id with a Kaby Lake id and -p with a matching Kaby Lake platform-id.")
_register(IGPUDevice(
    0x1912, "Intel HD Graphics 530 (Skylake desktop)", "Skylake", DESKTOP,
    macos_min="10.11.4", macos_max="12.99", spoof=SPOOF_SKL_1912,
    profiles=[_p("19120000", DESKTOP, "FAQ default desktop framebuffer"),
              _p("19160000", MOBILE, "FAQ default laptop framebuffer"),
              _p("19120001", HEADLESS, "FAQ empty framebuffer")],
    spoofed_profiles=[_p("59120000", DESKTOP, "Kaby Lake desktop framebuffer"),
                      _p("59160000", MOBILE, "Kaby Lake laptop framebuffer"),
                      _p("59120003", HEADLESS, "Kaby Lake empty framebuffer")],
    faq_section=SEC_SKL))
_register(IGPUDevice(
    0x1916, "Intel HD Graphics 520 (Skylake mobile)", "Skylake", MOBILE,
    macos_min="10.11.4", macos_max="12.99", spoof=SPOOF_SKL_1916,
    profiles=[_p("19160000", MOBILE, "FAQ default laptop framebuffer"),
              _p("19120000", DESKTOP, "FAQ default desktop framebuffer"),
              _p("19120001", HEADLESS, "FAQ empty framebuffer")],
    spoofed_profiles=[_p("59160000", MOBILE, "Kaby Lake laptop framebuffer"),
                      _p("59120000", DESKTOP, "Kaby Lake desktop framebuffer"),
                      _p("59120003", HEADLESS, "Kaby Lake empty framebuffer")],
    faq_section=SEC_SKL))
_register(IGPUDevice(
    0x191B, "Intel HD Graphics 530 (Skylake mobile)", "Skylake", MOBILE,
    macos_min="10.11.4", macos_max="12.99", spoof=SPOOF_SKL_191B,
    profiles=[_p("191B0000", MOBILE, "FAQ mobile framebuffer"),
              _p("19120000", DESKTOP, "FAQ default desktop framebuffer"),
              _p("19120001", HEADLESS, "FAQ empty framebuffer")],
    spoofed_profiles=[_p("591B0000", MOBILE, "Kaby Lake laptop framebuffer"),
                      _p("59120000", DESKTOP, "Kaby Lake desktop framebuffer"),
                      _p("59120003", HEADLESS, "Kaby Lake empty framebuffer")],
    faq_section=SEC_SKL))
_register(IGPUDevice(
    0x1902, "Intel HD Graphics 510 (Skylake GT1)", "Skylake", DESKTOP,
    macos_min="10.11.4", macos_max="12.99",
    profiles=[_p("19120000", DESKTOP, "FAQ default desktop framebuffer"),
              _p("19120001", HEADLESS, "FAQ empty framebuffer")],
    faq_section=SEC_SKL, notes=_SKL_NOTE_13))

# Kaby Lake: since macOS 10.12.6
_register(IGPUDevice(
    0x5912, "Intel HD Graphics 630 (Kaby Lake desktop)", "Kaby Lake", DESKTOP, macos_min="10.12.6",
    profiles=[_p("59120000", DESKTOP, "FAQ recommended desktop framebuffer"),
              _p("59120003", HEADLESS, "FAQ empty framebuffer")],
    faq_section=SEC_KBL))
_register(IGPUDevice(
    0x5916, "Intel HD Graphics 620 (Kaby Lake mobile)", "Kaby Lake", MOBILE, macos_min="10.12.6",
    profiles=[_p("591B0000", MOBILE, "FAQ default laptop framebuffer"),
              _p("59160000", MOBILE, "FAQ framebuffer assumed when none is set"),
              _p("59120000", DESKTOP, "FAQ recommended desktop framebuffer"),
              _p("59120003", HEADLESS, "FAQ empty framebuffer")],
    faq_section=SEC_KBL))
_register(IGPUDevice(
    0x591B, "Intel HD Graphics 630 (Kaby Lake mobile)", "Kaby Lake", MOBILE, macos_min="10.12.6",
    profiles=[_p("591B0000", MOBILE, "FAQ default laptop framebuffer"),
              _p("59120000", DESKTOP, "FAQ recommended desktop framebuffer"),
              _p("59120003", HEADLESS, "FAQ empty framebuffer")],
    faq_section=SEC_KBL))
_register(IGPUDevice(
    0x5917, "Intel UHD Graphics 620 (Kaby Lake Refresh)", "Kaby Lake Refresh", MOBILE,
    macos_min="10.12.6", spoof=SPOOF_KABY_LAKE_REFRESH,
    profiles=[_p("591B0000", MOBILE, "FAQ default laptop framebuffer"),
              _p("59160000", MOBILE, "FAQ framebuffer assumed when none is set"),
              _p("59120000", DESKTOP, "FAQ recommended desktop framebuffer"),
              _p("59120003", HEADLESS, "FAQ empty framebuffer")],
    faq_section=SEC_KBL))
_register(IGPUDevice(
    0x5926, "Intel Iris Plus Graphics 640 (Kaby Lake)", "Kaby Lake", MOBILE, macos_min="10.12.6",
    profiles=[_p("59260002", MOBILE, "FAQ Iris Plus 640 laptop framebuffer")], faq_section=SEC_KBL))
_register(IGPUDevice(
    0x5927, "Intel Iris Plus Graphics 650 (Kaby Lake)", "Kaby Lake", MOBILE, macos_min="10.12.6",
    profiles=[_p("59270004", MOBILE, "FAQ Iris Plus 650 laptop framebuffer")], faq_section=SEC_KBL))


# Coffee Lake / Whiskey Lake / Comet Lake
def _cfl_profiles(headless_id: str) -> List[PlatformProfile]:
    return [_p("3E9B0007", DESKTOP, "FAQ recommended desktop framebuffer"),
            _p("3EA50009", MOBILE, "FAQ default laptop framebuffer"),
            _p(headless_id, HEADLESS, "FAQ empty framebuffer")]


_register(IGPUDevice(0x3E9B, "Intel UHD Graphics 630 (Coffee Lake)", "Coffee Lake", DESKTOP,
                     macos_min="10.14", profiles=_cfl_profiles("3E910003"), faq_section=SEC_CFL))
_register(IGPUDevice(0x3E92, "Intel UHD Graphics 630 (Coffee Lake desktop)", "Coffee Lake", DESKTOP,
                     macos_min="10.14", profiles=_cfl_profiles("3E920003"), faq_section=SEC_CFL))
_register(IGPUDevice(0x3E91, "Intel UHD Graphics 630 (Coffee Lake desktop)", "Coffee Lake", DESKTOP,
                     macos_min="10.14", profiles=_cfl_profiles("3E910003"), faq_section=SEC_CFL))
_register(IGPUDevice(0x3E98, "Intel UHD Graphics 630 (Coffee Lake Refresh desktop)", "Coffee Lake Refresh",
                     DESKTOP, macos_min="10.14", spoof=SPOOF_COFFEE_LAKE_REFRESH,
                     profiles=_cfl_profiles("3E980003"),
                     spoofed_profiles=_cfl_profiles("3E920003"), faq_section=SEC_CFL))
_register(IGPUDevice(
    0x3EA5, "Intel Iris Plus Graphics 655 (Coffee Lake)", "Coffee Lake", MOBILE, macos_min="10.14",
    profiles=[_p("3EA50009", MOBILE, "FAQ default laptop framebuffer"),
              _p("3EA50004", MOBILE, "FAQ Iris Plus 655 laptop framebuffer")],
    faq_section=SEC_CFL))
_register(IGPUDevice(
    0x3EA0, "Intel UHD Graphics 620 (Whiskey Lake)", "Whiskey Lake", MOBILE, macos_min="10.14",
    spoof=SPOOF_WHISKEY_LAKE, profiles=[_p("3EA50009", MOBILE, "FAQ default laptop framebuffer")],
    faq_section=SEC_CFL))
_register(IGPUDevice(0x9BC8, "Intel UHD Graphics 630 (Comet Lake)", "Comet Lake", DESKTOP,
                     macos_min="10.15.4", profiles=_cfl_profiles("9BC80003"), faq_section=SEC_CFL,
                     notes="Native since macOS 10.15.4 (FAQ recommends 10.15.5)."))
_register(IGPUDevice(0x9BC5, "Intel UHD Graphics 630 (Comet Lake)", "Comet Lake", DESKTOP,
                     macos_min="10.15.4", profiles=_cfl_profiles("9BC50003"), faq_section=SEC_CFL,
                     notes="Native since macOS 10.15.4 (FAQ recommends 10.15.5)."))
_register(IGPUDevice(0x9BC4, "Intel UHD Graphics 630 (Comet Lake)", "Comet Lake", DESKTOP,
                     macos_min="10.15.4", profiles=_cfl_profiles("9BC40003"), faq_section=SEC_CFL,
                     notes="Native since macOS 10.15.4 (FAQ recommends 10.15.5)."))

# Ice Lake: since macOS 10.15.4
_register(IGPUDevice(0x8A52, "Intel Iris Plus Graphics G7 (Ice Lake)", "Ice Lake", MOBILE,
                     macos_min="10.15.4", profiles=[_p("8A520000", MOBILE, "FAQ laptop framebuffer")],
                     faq_section=SEC_ICL))
_register(IGPUDevice(0x8A53, "Intel Iris Plus Graphics G7 (Ice Lake)", "Ice Lake", MOBILE,
                     macos_min="10.15.4", profiles=[_p("8A530000", MOBILE, "FAQ laptop framebuffer")],
                     faq_section=SEC_ICL))

# Xe-LP (Gen12) and newer: no macOS graphics driver exists (general knowledge, not from the FAQ)
for _did, _name, _arch in (
    (0x9A49, "Intel Iris Xe Graphics (Tiger Lake)", "Tiger Lake"),
    (0x4C8A, "Intel UHD Graphics 750 (Rocket Lake)", "Rocket Lake"),
    (0x4680, "Intel UHD Graphics 770 (Alder Lake)", "Alder Lake"),
    (0xA780, "Intel UHD Graphics 770 (Raptor Lake)", "Raptor Lake"),
):
    _register(IGPUDevice(_did, _name, _arch, DESKTOP, supported=False,
                         notes="No macOS graphics driver exists for Intel Xe (Gen12) graphics. "
                               "Disable the iGPU and use a supported AMD GPU."))

KNOWN_PLATFORM_IDS = {p.platform_id
                      for d in INTEL_IGPU_DATABASE.values()
                      for p in d.profiles + d.spoofed_profiles}


# ==============================================================================
# Compatibility resolution
# ==============================================================================

@dataclass
class ResolutionResult:
    device_id: int
    model: Optional[IGPUDevice]
    status: CompatibilityStatus
    form_factor: FormFactor
    target_macos: str
    spoof_target: Optional[int]
    spoof_is_manual: bool
    platform_id: Optional[int]
    platform_profile: Optional[PlatformProfile]
    extra_properties: Dict[str, bytes]
    reason: str
    notes: str
    warnings: List[str]

    @property
    def device_id_str(self) -> str:
        return f"{self.device_id:04X}"

    @property
    def is_spoof_needed(self) -> bool:
        return self.spoof_target is not None

    @property
    def spoof_bytes(self) -> Optional[bytes]:
        return serialize_device_id(self.spoof_target) if self.spoof_target is not None else None

    @property
    def platform_id_bytes(self) -> Optional[bytes]:
        return serialize_platform_id(self.platform_id) if self.platform_id is not None else None


def coerce_form_factor(value: Optional[Union[str, FormFactor]]) -> Optional[FormFactor]:
    if value is None or isinstance(value, FormFactor):
        return value
    return FormFactor(str(value).lower())


def resolve_igpu(
    device_id_raw: Union[int, str],
    target_macos: str = "14.0",
    form_factor: Optional[Union[str, FormFactor]] = None,
    platform_id_override: Optional[Union[int, str]] = None,
    spoof_id_override: Optional[Union[int, str]] = None,
) -> ResolutionResult:
    """Decide whether an iGPU works as-is, needs a device-id spoof, or is unusable."""
    dev_id = parse_device_id(device_id_raw)
    target = parse_macos_version(target_macos)
    dev = INTEL_IGPU_DATABASE.get(dev_id)
    ff = coerce_form_factor(form_factor) or (dev.form_factor if dev else FormFactor.DESKTOP)
    warnings: List[str] = []

    spoof_target: Optional[int] = None
    spoof_is_manual = False
    extras: Dict[str, bytes] = {}
    db_spoof_active = False

    # --- status ---------------------------------------------------------------
    if dev is None:
        status = CompatibilityStatus.UNKNOWN
        reason = (f"Device-ID 0x{dev_id:04X} is not in the table derived from the FAQ, so no "
                  f"compatibility statement is possible.")
    elif not dev.supported:
        status = CompatibilityStatus.UNSUPPORTED
        reason = dev.notes
    else:
        sp = dev.spoof
        db_spoof_active = sp is not None and sp.active_on(target)
        if dev.macos_min and target < parse_macos_version(dev.macos_min):
            status = CompatibilityStatus.UNSUPPORTED_OS
            reason = f"macOS {target_macos} is older than the first release with a driver ({dev.macos_min})."
        elif (dev.macos_max and target > parse_macos_version(dev.macos_max)
              and not (db_spoof_active and sp.extends_max_macos)):
            status = CompatibilityStatus.UNSUPPORTED_OS
            reason = (f"The FAQ documents support up to macOS {int(dev.macos_max.split('.')[0])}.x; "
                      f"macOS {target_macos} needs OpenCore Legacy Patcher or a different GPU.")
        elif db_spoof_active:
            status = CompatibilityStatus.NEEDS_SPOOF
            reason = sp.reason
        else:
            status = CompatibilityStatus.NATIVE
            reason = f"Natively supported on macOS {target_macos}; no device-id spoof needed."

    # --- spoof ----------------------------------------------------------------
    if spoof_id_override is not None:
        if status == CompatibilityStatus.UNSUPPORTED:
            warnings.append("--spoof-id ignored: this iGPU generation has no macOS driver.")
        else:
            spoof_target = parse_device_id(spoof_id_override)
            spoof_is_manual = True
            status = CompatibilityStatus.NEEDS_SPOOF
            reason = f"device-id spoof to 0x{spoof_target:04X} set manually (--spoof-id)."
            warnings.append("Spoof target set manually: make sure the platform-id belongs to the "
                            "spoofed generation (use -p).")
    elif db_spoof_active:
        spoof_target = dev.spoof.target_id

    if dev is not None and dev.spoof is not None and dev.spoof.active_on(target):
        for key, value in dev.spoof.extra_properties:
            extras[key] = pack_u32_le(value)

    # --- platform-id ------------------------------------------------------------
    platform_id: Optional[int] = None
    profile: Optional[PlatformProfile] = None
    if platform_id_override is not None:
        platform_id = parse_platform_id(platform_id_override)
        if dev is not None:
            for p in dev.profiles + dev.spoofed_profiles:
                if p.platform_id == platform_id:
                    profile = p
                    break
    elif dev is not None and dev.supported:
        use_spoofed = bool(dev.spoofed_profiles) and db_spoof_active and not spoof_is_manual
        pool = dev.spoofed_profiles if use_spoofed else dev.profiles
        profile = next((p for p in pool if p.form_factor == ff), None)
        if profile is None and ff != FormFactor.HEADLESS and pool:
            profile = pool[0]
            warnings.append(f"The FAQ lists no {ff.value} framebuffer for this iGPU; "
                            f"using {profile.platform_id_str} ({profile.form_factor.value}).")
        elif profile is None:
            warnings.append("The FAQ lists no empty (headless) framebuffer for this iGPU.")
        if profile is not None:
            platform_id = profile.platform_id

    return ResolutionResult(
        device_id=dev_id, model=dev, status=status, form_factor=ff, target_macos=target_macos,
        spoof_target=spoof_target, spoof_is_manual=spoof_is_manual,
        platform_id=platform_id, platform_profile=profile, extra_properties=extras,
        reason=reason, notes=dev.notes if dev else "", warnings=warnings,
    )


# ==============================================================================
# VBT / BDB parsing
# Layout verified against Linux i915 (intel_vbt_defs.h, intel_bios.c) and checked
# on real VBT files (Skylake BDB 209, Tiger Lake BDB 240).
#   vbt_header : "$VBT ..."[20] u16 version (not the BDB version!), u16 header_size,
#                u16 vbt_size, u8 checksum, u8 reserved, u32 bdb_offset, u32 aim_offset[4]
#   bdb_header : "BIOS_DATA_BLOCK"[16] u16 version, u16 header_size, u16 bdb_size
#   blocks     : u8 id, u16 size, data[size]
#   block 2    : General Definitions = crt_ddc_gmbus_pin, dpms bits,
#                boot_display[2], child_dev_size, then child_device_config[]
# The BDB version (not the VBT header version) decides which child fields are valid.
# ==============================================================================

VBT_SIGNATURE = b"$VBT"
BDB_SIGNATURE = b"BIOS_DATA_BLOCK"
VBT_HEADER_SIZE = 48
BDB_HEADER_MIN_SIZE = 22
BDB_GENERAL_DEFINITIONS = 2
BDB_MIPI_SEQUENCE = 53                    # v3+ blocks carry a 32-bit size
GENERAL_DEFINITIONS_HEADER_SIZE = 5
LEGACY_CHILD_DEVICE_CONFIG_SIZE = 33      # smallest child_device_config i915 accepts

# child_device_config field offsets (computed from the i915 struct with gcc)
CHILD_OFF_HANDLE = 0
CHILD_OFF_DEVICE_TYPE = 2
CHILD_OFF_DVO_PORT = 16
CHILD_OFF_I2C_PIN = 17
CHILD_OFF_DDC_PIN = 19
CHILD_OFF_FLAGS = 23                      # bit 4 = hpd_invert (BDB 196+)
CHILD_OFF_AUX_CHANNEL = 25                # valid from BDB 158; older VBTs hold dvo2 data here
CHILD_OFF_CAPS = 27                       # bits 3-4 = hpd_status
CHILD_OFF_TYPEC = 33                      # bit 0 = dp_usb_type_c (195+), bit 1 = tbt (209+)

BDB_VER_AUX_CHANNEL = 158
BDB_VER_TYPEC = 195
BDB_VER_HPD_INVERT = 196
BDB_VER_TBT = 209

# device_type bits (intel_vbt_defs.h)
DT_ANALOG_OUTPUT = 1 << 0
DT_DIGITAL_OUTPUT = 1 << 1
DT_DISPLAYPORT_OUTPUT = 1 << 2
DT_TMDS_DVI_SIGNALING = 1 << 4
DT_LVDS_SIGNALING = 1 << 5
DT_MIPI_OUTPUT = 1 << 10
DT_NOT_HDMI_OUTPUT = 1 << 11
DT_INTERNAL_CONNECTOR = 1 << 12
DT_HOTPLUG_SIGNALING = 1 << 13

# DVO port value -> DDI letter (i915 dvo_port_to_port table; E also takes DVO_PORT_CRT)
DVO_PORT_TO_DDI: Dict[int, str] = {
    0: "A", 10: "A",
    1: "B", 7: "B",
    2: "C", 8: "C",
    3: "D", 9: "D",
    12: "E", 11: "E", 6: "E",
    14: "F", 13: "F",
    16: "G", 15: "G",
    18: "H", 17: "H",
    20: "I", 19: "I",
}

# AUX channel byte -> DDI letter (DP_AUX_* in intel_vbt_defs.h)
DP_AUX_TO_DDI = {0x40: "A", 0x10: "B", 0x20: "C", 0x30: "D", 0x50: "E",
                 0x60: "F", 0x70: "G", 0x80: "H", 0x90: "I"}

# Legacy GMBUS pins (intel_gmbus.h): DPC = 4, DPB = 5, DPD = 6. On older platforms the VBT
# ddc_pin holds this number directly, and it equals the Apple bus-id used for DDI C/B/D.
LEGACY_GMBUS_PINS = (4, 5, 6)

# Apple bus IDs seen in the FAQ connector dumps: internal panel 0x00, DDI B/C/D = 5/4/6.
INTERNAL_BUS_ID = 0x00
EXTERNAL_BUS_ID_BY_DDI = {"B": 0x05, "C": 0x04, "D": 0x06}
# Pipes seen in the FAQ dumps: internal panel on pipe 8, externals on 9, 10, 8.
INTERNAL_PIPE = 8
EXTERNAL_PIPES_WITH_PANEL = [9, 10]
EXTERNAL_PIPES_NO_PANEL = [9, 10, 8]

MAX_CONNECTORS = 4          # con0 .. con3
MOBILE_MAX_CONNECTORS = 3   # con0 .. con2


def expected_child_size(bdb_version: int) -> Optional[int]:
    """child_device_config size i915 expects for a BDB version (None = unknown version)."""
    if bdb_version > 264:
        return None
    for minimum, size in ((263, 44), (256, 40), (216, 39), (196, 38), (195, 37), (111, 33), (106, 27)):
        if bdb_version >= minimum:
            return size
    return 22


def handle_name(handle: int, bdb_version: int) -> str:
    """Device handle -> LFP1/LFP2/EFP1... (some values were reused by newer BDB versions)."""
    fixed = {0x0008: "LFP1", 0x0080: "LFP2", 0x0004: "EFP1", 0x0040: "EFP2",
             0x0020: "EFP3", 0x0010: "EFP4"}
    if handle in fixed:
        return fixed[handle]
    if handle == 0x0002:
        return "EFP5" if bdb_version >= 215 else "TV"
    if handle == 0x0001:
        return "EFP6" if bdb_version >= 217 else "CRT"
    if handle in (0x0100, 0x0200) and bdb_version >= 217:
        return "EFP7" if handle == 0x0100 else "EFP8"
    return f"0x{handle:04X}"


def classify_device_type(device_type: int) -> str:
    """Connector kind from the device_type bits, using the same tests as i915."""
    if device_type & DT_MIPI_OUTPUT:
        return "MIPI"
    is_dp = bool(device_type & DT_DISPLAYPORT_OUTPUT)
    is_tmds = bool(device_type & DT_TMDS_DVI_SIGNALING)
    internal = bool(device_type & DT_INTERNAL_CONNECTOR)
    if is_dp and internal:
        return "eDP"
    if internal:
        return "LVDS"
    if is_dp and is_tmds:
        return "DP++"
    if is_dp:
        return "DP"
    if is_tmds:
        return "DVI" if device_type & DT_NOT_HDMI_OUTPUT else "HDMI"
    if device_type & DT_ANALOG_OUTPUT and not device_type & DT_DIGITAL_OUTPUT:
        return "Analog"
    return "Unknown"


@dataclass
class ChildDevice:
    slot: int
    device_type: int
    dvo_port: int
    i2c_pin: int
    ddc_pin: int
    aux_channel: int
    raw: bytes
    handle: int = 0
    bdb_version: int = 0

    @property
    def kind(self) -> str:
        return classify_device_type(self.device_type)

    @property
    def ddi(self) -> Optional[str]:
        return DVO_PORT_TO_DDI.get(self.dvo_port)

    @property
    def is_internal_panel(self) -> bool:
        return self.kind in ("eDP", "LVDS")

    @property
    def handle_label(self) -> str:
        return handle_name(self.handle, self.bdb_version)

    @property
    def aux_valid(self) -> bool:
        return self.bdb_version >= BDB_VER_AUX_CHANNEL

    @property
    def aux_ddi(self) -> Optional[str]:
        return DP_AUX_TO_DDI.get(self.aux_channel) if self.aux_valid else None

    @property
    def hpd_status(self) -> int:
        return (self.raw[CHILD_OFF_CAPS] >> 3) & 0x3 if len(self.raw) > CHILD_OFF_CAPS else 0

    @property
    def hpd_invert(self) -> Optional[bool]:
        if self.bdb_version < BDB_VER_HPD_INVERT or len(self.raw) <= CHILD_OFF_FLAGS:
            return None
        return bool(self.raw[CHILD_OFF_FLAGS] & 0x10)

    @property
    def usb_type_c(self) -> Optional[bool]:
        if self.bdb_version < BDB_VER_TYPEC or len(self.raw) <= CHILD_OFF_TYPEC:
            return None
        return bool(self.raw[CHILD_OFF_TYPEC] & 0x01)

    @property
    def tbt(self) -> Optional[bool]:
        if self.bdb_version < BDB_VER_TBT or len(self.raw) <= CHILD_OFF_TYPEC:
            return None
        return bool(self.raw[CHILD_OFF_TYPEC] & 0x02)


def extract_pcir_device_id(data: bytes) -> Optional[int]:
    """Find the Intel (0x8086) PCI device-id in an option ROM / GOP image, if present."""
    if len(data) < 32:
        return None
    if data[0] == 0x55 and data[1] == 0xAA:
        ptr = struct.unpack_from("<H", data, 0x18)[0]
        if 0 < ptr and ptr + 8 <= len(data) and data[ptr:ptr + 4] == b"PCIR":
            vendor, device = struct.unpack_from("<HH", data, ptr + 4)
            if vendor == 0x8086:
                return device
    pos = 0
    while True:
        pos = data.find(b"PCIR", pos)
        if pos == -1 or pos + 8 > len(data):
            return None
        vendor, device = struct.unpack_from("<HH", data, pos + 4)
        if vendor == 0x8086:
            return device
        pos += 4


class VBTParser:
    def __init__(self, data: bytes):
        self.data = data
        self.vbt_offset = 0
        self.bdb_offset = 0
        self.vbt_version = 0          # VBT header version (usually 100)
        self.bdb_version = 0          # BDB version: decides which fields are valid
        self.vbt_size = 0
        self.vbt_checksum = 0
        self.checksum_ok: Optional[bool] = None
        self.child_size = 0
        self.detected_pcir_device_id: Optional[int] = extract_pcir_device_id(data)
        self.blocks: Dict[int, bytes] = {}
        self.child_devices: List[ChildDevice] = []
        self.warnings: List[str] = []
        self.notes: List[str] = []    # informational, shown with --verbose
        self._parse()

    @property
    def display_devices(self) -> List[ChildDevice]:
        """Child devices that can become a framebuffer connector."""
        return [d for d in self.child_devices if d.kind not in ("Analog", "MIPI", "Unknown")]

    def _parse(self) -> None:
        data = self.data
        vbt_pos = data.find(VBT_SIGNATURE)
        if vbt_pos == -1:
            raise ValueError("'$VBT' signature not found in input")
        if vbt_pos + VBT_HEADER_SIZE > len(data):
            raise ValueError("truncated VBT header")
        self.vbt_offset = vbt_pos
        (self.vbt_version, _hdr_size, self.vbt_size, self.vbt_checksum, _res,
         bdb_rel) = struct.unpack_from("<HHHBBI", data, vbt_pos + 20)
        self._verify_checksum(vbt_pos)

        bdb_pos = vbt_pos + bdb_rel
        if data[bdb_pos:bdb_pos + len(BDB_SIGNATURE)] != BDB_SIGNATURE:
            found = data.find(BDB_SIGNATURE, vbt_pos)
            if found == -1:
                raise ValueError("'BIOS_DATA_BLOCK' header not found")
            self.warnings.append("bdb_offset in the VBT header is wrong; located the BDB by signature.")
            bdb_pos = found
        if bdb_pos + BDB_HEADER_MIN_SIZE > len(data):
            raise ValueError("truncated BDB header")
        self.bdb_offset = bdb_pos
        self.bdb_version, header_size, bdb_size = struct.unpack_from("<HHH", data, bdb_pos + 16)

        total = bdb_size
        if bdb_pos + total > len(data):
            self.warnings.append("BDB is larger than the file; the dump looks truncated.")
            total = len(data) - bdb_pos

        index = header_size
        while index + 3 < total:
            block_id = data[bdb_pos + index]
            size = struct.unpack_from("<H", data, bdb_pos + index + 1)[0]
            if block_id == BDB_MIPI_SEQUENCE and bdb_pos + index + 8 <= len(data) \
                    and data[bdb_pos + index + 3] >= 3:
                size = struct.unpack_from("<I", data, bdb_pos + index + 4)[0]
            index += 3
            if index + size > total:
                self.notes.append(f"BDB block {block_id} runs past the end of the BDB; blocks after it are ignored.")
                break
            self.blocks.setdefault(block_id, data[bdb_pos + index:bdb_pos + index + size])
            index += size

        self._parse_child_devices()

    def _verify_checksum(self, vbt_pos: int) -> None:
        """All vbt_size bytes (checksum byte included) add up to 0 mod 256 (checked on real VBTs)."""
        if self.vbt_size < VBT_HEADER_SIZE or vbt_pos + self.vbt_size > len(self.data):
            self.warnings.append(f"VBT size field ({self.vbt_size}) does not fit the file; checksum not verified.")
            return
        total = sum(self.data[vbt_pos:vbt_pos + self.vbt_size]) & 0xFF
        self.checksum_ok = total == 0
        if not self.checksum_ok:
            self.warnings.append(f"VBT checksum mismatch: the {self.vbt_size} bytes sum to 0x{total:02X}, "
                                 f"expected 0x00. The dump may be modified or incomplete.")

    def _parse_child_devices(self) -> None:
        defs = self.blocks.get(BDB_GENERAL_DEFINITIONS)
        if defs is None:
            raise ValueError("VBT has no General Definitions block (2), so no display devices are defined")
        if len(defs) < GENERAL_DEFINITIONS_HEADER_SIZE:
            raise ValueError("General Definitions block is too small")
        child_size = defs[4]
        if child_size < LEGACY_CHILD_DEVICE_CONFIG_SIZE:
            raise ValueError(f"child device size {child_size} is smaller than the minimum "
                             f"{LEGACY_CHILD_DEVICE_CONFIG_SIZE}")
        self.child_size = child_size
        expected = expected_child_size(self.bdb_version)
        if expected is not None and expected != child_size:
            self.notes.append(f"child device size {child_size} differs from the size i915 expects for "
                              f"BDB {self.bdb_version} ({expected}); parsing continues like i915 does.")
        count = (len(defs) - GENERAL_DEFINITIONS_HEADER_SIZE) // child_size
        for slot in range(count):
            start = GENERAL_DEFINITIONS_HEADER_SIZE + slot * child_size
            chunk = defs[start:start + child_size]
            device_type = struct.unpack_from("<H", chunk, CHILD_OFF_DEVICE_TYPE)[0]
            if device_type in (0x0000, 0xFFFF):          # empty slot
                continue
            self.child_devices.append(ChildDevice(
                slot=slot,
                device_type=device_type,
                dvo_port=chunk[CHILD_OFF_DVO_PORT],
                i2c_pin=chunk[CHILD_OFF_I2C_PIN],
                ddc_pin=chunk[CHILD_OFF_DDC_PIN],
                aux_channel=chunk[CHILD_OFF_AUX_CHANNEL],
                raw=bytes(chunk),
                handle=struct.unpack_from("<H", chunk, CHILD_OFF_HANDLE)[0],
                bdb_version=self.bdb_version,
            ))


# ==============================================================================
# Framebuffer connector patches
# ==============================================================================

CONNECTOR_TYPE_BY_KIND = {
    "eDP": CON_TYPE_LVDS,
    "LVDS": CON_TYPE_LVDS,
    "DVI": CON_TYPE_DVI,
    "DP": CON_TYPE_DP,
    "DP++": CON_TYPE_HDMI,     # dual-mode port: patched as HDMI
    "HDMI": CON_TYPE_HDMI,
}
EXTERNAL_KINDS = ("DP", "DP++", "HDMI", "DVI")
DDC_KINDS = ("HDMI", "DVI", "DP++")      # connectors that talk DDC over a GMBUS pin


@dataclass
class ConnectorPatch:
    index: int          # N in framebuffer-conN-*
    bus_id: int
    con_type: int
    pipe: int
    source: ChildDevice

    @property
    def type_bytes(self) -> bytes:
        return pack_u32_le(self.con_type)


def _external_bus_id(dev: ChildDevice, bus_source: str, warnings: List[str]) -> Optional[int]:
    """Apple bus-id for an external connector: from its DDI (default) or from the VBT ddc_pin."""
    by_ddi = EXTERNAL_BUS_ID_BY_DDI.get(dev.ddi or "")
    legacy_ddc = dev.ddc_pin if dev.ddc_pin in LEGACY_GMBUS_PINS else None
    if dev.kind in DDC_KINDS:
        if bus_source == "ddc":
            if legacy_ddc is not None:
                return legacy_ddc
            warnings.append(f"Slot {dev.slot} ({dev.kind}): ddc_pin 0x{dev.ddc_pin:02X} is not a legacy GMBUS "
                            f"pin (4, 5 or 6); using the DDI-derived bus-id instead.")
        elif legacy_ddc is not None and by_ddi is not None and legacy_ddc != by_ddi:
            warnings.append(f"Slot {dev.slot} ({dev.kind}, DDI {dev.ddi}): the VBT ddc_pin 0x{legacy_ddc:02X} "
                            f"differs from the DDI-derived bus-id {by_ddi}. If this port stays dark, "
                            f"try --bus-id-source ddc.")
    return by_ddi


def build_connector_patches(
    devices: List[ChildDevice],
    first_index: Optional[int] = None,
    max_connectors: int = MAX_CONNECTORS,
    bus_source: str = "ddi",
) -> Tuple[List[ConnectorPatch], List[str]]:
    """
    Turn VBT connectors into framebuffer-conN-* patches.

    Analog, MIPI and unknown devices are skipped. macOS framebuffers hold at most four
    connectors (con0..con3), so the internal panel (LFP1 first) is kept before external
    ports (ordered by DDI) and the rest is reported. Index, bus-id and pipe follow the
    FAQ dumps: with an internal panel the panel is con0 (bus 0, pipe 8) and externals follow;
    without one the externals start at con1, like the FAQ's desktop framebuffers. Use
    first_index to override.
    """
    warnings: List[str] = []
    for d in devices:
        if d.kind in ("Analog", "MIPI", "Unknown"):
            warnings.append(f"Ignored VBT slot {d.slot} ({d.kind}, device_type 0x{d.device_type:04X}).")

    internals = sorted((d for d in devices if d.is_internal_panel),
                       key=lambda d: (d.handle != 0x0008, d.slot))
    externals = sorted((d for d in devices if d.kind in EXTERNAL_KINDS),
                       key=lambda d: (d.ddi or "~", d.slot))
    if len(internals) > 1:
        warnings.append("More than one internal panel in the VBT; only the first is patched.")
    if first_index is None:
        first_index = 0 if internals else 1
    limit = max(0, min(max_connectors, MAX_CONNECTORS - first_index))

    # (device, bus-id, internal?) in priority order
    candidates: List[Tuple[ChildDevice, int, bool]] = []
    if internals:
        candidates.append((internals[0], INTERNAL_BUS_ID, True))
    used_bus_ids = {INTERNAL_BUS_ID} if internals else set()
    for d in externals:
        bus_id = _external_bus_id(d, bus_source, warnings)
        if bus_id is None:
            warnings.append(f"Ignored VBT slot {d.slot} ({d.kind}): DVO port 0x{d.dvo_port:02X} "
                            f"(DDI {d.ddi or '?'}) has no verified Apple bus-id; patch it by hand.")
            continue
        if bus_id in used_bus_ids:
            warnings.append(f"Ignored VBT slot {d.slot} ({d.kind}): bus-id {bus_id} is already used by another connector.")
            continue
        used_bus_ids.add(bus_id)
        candidates.append((d, bus_id, False))

    kept, dropped = candidates[:limit], candidates[limit:]
    if dropped:
        warnings.append(f"macOS supports at most {limit} connector(s) here (con{first_index}..con{first_index + limit - 1}); "
                        f"not patched: " + ", ".join(f"{d.handle_label} ({d.kind}, DDI {d.ddi or '?'})"
                                                   for d, _, _ in dropped) + ".")

    has_panel = bool(kept) and kept[0][2]
    pipes = EXTERNAL_PIPES_WITH_PANEL if has_panel else EXTERNAL_PIPES_NO_PANEL
    patches: List[ConnectorPatch] = []
    ext_count = 0
    for offset, (d, bus_id, internal) in enumerate(kept):
        if internal:
            pipe = INTERNAL_PIPE
        else:
            pipe = pipes[ext_count % len(pipes)]
            ext_count += 1
        patches.append(ConnectorPatch(first_index + offset, bus_id, CONNECTOR_TYPE_BY_KIND[d.kind], pipe, d))
    return patches, warnings


# ==============================================================================
# Backlight register fix (FAQ.IntelHD.en.md)
#   * Certain mobile Kaby Lake, Coffee Lake and Ice Lake laptops need the backlight
#     registers fix: property enable-backlight-registers-fix on IGPU (-igfxblr).
#   * On macOS 13.4+ the Kaby/Coffee Lake drivers need the alternative fix instead:
#     enable-backlight-registers-alternative-fix (-igfxblt). Ice Lake is not affected.
# ==============================================================================

BACKLIGHT_FIX_PROPERTY = "enable-backlight-registers-fix"
BACKLIGHT_ALT_FIX_PROPERTY = "enable-backlight-registers-alternative-fix"
BACKLIGHT_ALT_FIX_MIN_MACOS = (13, 4, 0)
_KBL_CFL_DRIVER_ARCHS = {"Kaby Lake", "Kaby Lake Refresh", "Coffee Lake", "Coffee Lake Refresh",
                         "Whiskey Lake", "Comet Lake"}


def select_backlight_property(res: ResolutionResult) -> Tuple[Optional[str], List[str]]:
    """Pick the backlight register fix property for this iGPU and macOS version (opt-in)."""
    arch = res.model.architecture if res.model else None
    if res.spoof_target is not None and res.spoof_target in INTEL_IGPU_DATABASE:
        arch = INTEL_IGPU_DATABASE[res.spoof_target].architecture     # the driver that actually loads
    if arch in _KBL_CFL_DRIVER_ARCHS:
        if parse_macos_version(res.target_macos) >= BACKLIGHT_ALT_FIX_MIN_MACOS:
            return BACKLIGHT_ALT_FIX_PROPERTY, [
                "Backlight: using the alternative fix (macOS 13.4+). Remove -igfxblr and the property "
                f"{BACKLIGHT_FIX_PROPERTY} if you have them; add -igfxbls as well if you use the "
                "Backlight Smoother."]
        return BACKLIGHT_FIX_PROPERTY, []
    if arch == "Ice Lake":
        return BACKLIGHT_FIX_PROPERTY, []
    return None, ["The FAQ documents the backlight register fix only for Kaby Lake, Coffee Lake and "
                  "Ice Lake graphics; --backlight-fix was ignored for this iGPU."]


# ==============================================================================
# OpenCore DeviceProperties generation
# ==============================================================================

def generate_opencore_patch(
    platform_id_bytes: bytes,
    spoof_bytes: Optional[bytes] = None,
    extra_properties: Optional[Dict[str, bytes]] = None,
    connectors: Optional[List[ConnectorPatch]] = None,
    unifiedmem: bool = False,
    rps_control: bool = False,
    portcount: Optional[int] = None,
) -> Dict[str, bytes]:
    """Ordered DeviceProperties for PciRoot(0x0)/Pci(0x2,0x0). All integers go through pack_u32_le."""
    props: Dict[str, bytes] = {"AAPL,ig-platform-id": platform_id_bytes}
    if spoof_bytes is not None:
        props["device-id"] = spoof_bytes
    props.update(extra_properties or {})
    if connectors or unifiedmem or portcount is not None:
        props["framebuffer-patch-enable"] = pack_u32_le(1)
    if portcount is not None:
        props["framebuffer-portcount"] = pack_u32_le(portcount)
    for c in connectors or []:
        props[f"framebuffer-con{c.index}-enable"] = pack_u32_le(1)
        props[f"framebuffer-con{c.index}-busid"] = pack_u32_le(c.bus_id)
        props[f"framebuffer-con{c.index}-type"] = pack_u32_le(c.con_type)
        props[f"framebuffer-con{c.index}-pipe"] = pack_u32_le(c.pipe)
    if unifiedmem:
        props["framebuffer-unifiedmem"] = pack_u32_le(0x80000000)
    if rps_control:
        props["rps-control"] = pack_u32_le(1)
    return props


def render_opencore_xml(props: Dict[str, bytes]) -> str:
    from xml.sax.saxutils import escape
    lines = [
        "<key>DeviceProperties</key>",
        "<dict>",
        "\t<key>Add</key>",
        "\t<dict>",
        f"\t\t<key>{IGPU_PCI_PATH}</key>",
        "\t\t<dict>",
    ]
    for key, value in props.items():
        lines.append(f"\t\t\t<key>{escape(key)}</key>")
        lines.append(f"\t\t\t<data>{base64.b64encode(value).decode('ascii')}</data>  <!-- {value.hex().upper()} -->")
    lines += ["\t\t</dict>", "\t</dict>", "</dict>"]
    return "\n".join(lines)


def merge_into_plist(plist_path: str, props: Dict[str, bytes]) -> str:
    """Merge props into config.plist (existing keys are kept). Returns the backup path."""
    if not os.path.exists(plist_path):
        raise FileNotFoundError(f"config.plist not found: {plist_path}")
    with open(plist_path, "rb") as f:
        config = plistlib.load(f)
    backup = plist_path + ".bak"
    shutil.copy2(plist_path, backup)
    igpu = config.setdefault("DeviceProperties", {}).setdefault("Add", {}).setdefault(IGPU_PCI_PATH, {})
    igpu.update(props)
    with open(plist_path, "wb") as f:
        plistlib.dump(config, f, fmt=plistlib.FMT_XML, sort_keys=False)
    return backup


# ==============================================================================
# Text rendering
# ==============================================================================

def render_summary(res: ResolutionResult, pcir: Optional[int]) -> str:
    lines = []
    src = " (read from the file's PCIR header)" if pcir is not None and pcir == res.device_id else ""
    lines.append(f"Device-ID    : 0x{res.device_id_str}{src}")
    if res.model:
        lines.append(f"iGPU         : {res.model.model_name}")
    lines.append(f"Status       : {res.status.value} (target macOS {res.target_macos})")
    lines.append(f"Reason       : {res.reason}")
    if res.is_spoof_needed:
        origin = "manual" if res.spoof_is_manual else "FAQ"
        lines.append(f"device-id    : <{res.spoof_bytes.hex().upper()}>  (spoof to 0x{res.spoof_target:04X}, {origin})")
    else:
        lines.append("device-id    : not injected")
    if res.platform_id is not None:
        desc = f" - {res.platform_profile.description}" if res.platform_profile else ""
        lines.append(f"ig-platform  : {res.platform_id:08X} -> <{res.platform_id_bytes.hex().upper()}>"
                     f" [{res.form_factor.value}]{desc}")
    for key, value in res.extra_properties.items():
        lines.append(f"{key:<13}: <{value.hex().upper()}>")
    if res.model and res.model.faq_section:
        lines.append(f"FAQ section  : {res.model.faq_section}")
    if res.notes:
        lines.append(f"Note         : {res.notes}")
    return "\n".join(lines)


def _ascii_table(headers: List[str], rows: List[List[str]]) -> str:
    widths = [max([len(h)] + [len(r[i]) for r in rows]) for i, h in enumerate(headers)]
    sep = "+" + "+".join("-" * (w + 2) for w in widths) + "+"
    out = [sep, "| " + " | ".join(h.ljust(widths[i]) for i, h in enumerate(headers)) + " |", sep]
    for r in rows:
        out.append("| " + " | ".join(r[i].ljust(widths[i]) for i in range(len(r))) + " |")
    out.append(sep)
    return "\n".join(out)


def render_port_summary(vbt: VBTParser) -> str:
    """One row per VBT child device: the physical ports the firmware defines."""
    headers = ["Slot", "Handle", "DVO", "DDI", "Type", "dev_type", "AUX", "DDC", "I2C", "HPD", "Notes"]
    rows = []
    for d in vbt.child_devices:
        if not d.aux_valid:
            aux = "n/a"
        elif d.aux_channel:
            aux = f"{d.aux_ddi or '?'} (0x{d.aux_channel:02X})"
        else:
            aux = "-"
        notes = []
        if d.usb_type_c:
            notes.append("USB-C")
        if d.tbt:
            notes.append("TBT")
        if d.kind in ("Analog", "MIPI", "Unknown"):
            notes.append(f"ignored ({d.kind})")
        rows.append([
            str(d.slot), d.handle_label, f"0x{d.dvo_port:02X}", d.ddi or "-", d.kind,
            f"0x{d.device_type:04X}", aux,
            f"0x{d.ddc_pin:02X}" if d.ddc_pin else "-", f"0x{d.i2c_pin:02X}" if d.i2c_pin else "-",
            f"st={d.hpd_status}" + (",inv" if d.hpd_invert else ""),
            ", ".join(notes) or "-",
        ])
    return _ascii_table(headers, rows) if rows else "(no display devices in the VBT)"


def render_connector_table(patches: List[ConnectorPatch]) -> str:
    headers = ["Property", "DDI", "DVO", "Connector", "Bus ID", "Type bytes", "Pipe"]
    rows = [[f"con{c.index}", c.source.ddi or "-", f"0x{c.source.dvo_port:02X}", c.source.kind,
             f"0x{c.bus_id:02X}", c.type_bytes.hex().upper(), str(c.pipe)]
            for c in patches]
    widths = [max(len(h), *(len(r[i]) for r in rows)) if rows else len(h) for i, h in enumerate(headers)]
    sep = "+" + "+".join("-" * (w + 2) for w in widths) + "+"
    out = [sep, "| " + " | ".join(h.ljust(widths[i]) for i, h in enumerate(headers)) + " |", sep]
    if not rows:
        out.append("| no connector patches generated".ljust(sum(widths) + 3 * len(widths) - 1) + " |")
    for r in rows:
        out.append("| " + " | ".join(r[i].ljust(widths[i]) for i in range(len(r))) + " |")
    out.append(sep)
    return "\n".join(out)


# ==============================================================================
# CLI
# ==============================================================================

def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog=PROG_NAME,
        description="Parse an Intel VBT dump and generate a WhateverGreen/OpenCore framebuffer patch.",
        epilog=f"Compatibility data: {FAQ_URL}",
    )
    p.add_argument("-i", "--input", required=True, help="VBT dump or option ROM containing a VBT")
    p.add_argument("-d", "--device-id", help="iGPU PCI device-id (hex, e.g. 3E9B). Read from a PCIR header if present.")
    p.add_argument("-p", "--platform-id",
                   help="AAPL,ig-platform-id in the notation of the FAQ framebuffer lists "
                        "(e.g. 3E9B0007). Overrides the automatic choice.")
    p.add_argument("-t", "--target-macos", default="14.0", help="target macOS version (default: 14.0)")
    p.add_argument("-f", "--form-factor", choices=[f.value for f in FormFactor],
                   help="framebuffer type. Default: mobile if the VBT has an internal panel, else desktop.")
    p.add_argument("--spoof-id", help="inject this device-id instead of the FAQ value (hex, e.g. 3E9B)")
    p.add_argument("--unifiedmem", action="store_true", help="add framebuffer-unifiedmem (DVMT workaround)")
    p.add_argument("--rps-control", action="store_true", help="add rps-control")
    p.add_argument("--backlight-fix", action="store_true",
                   help="add the backlight register fix for KBL/CFL/ICL laptops "
                        "(alternative fix on macOS 13.4+, per the FAQ)")
    p.add_argument("--mobile", action="store_true",
                   help="laptop mode: mobile framebuffer, at most 3 connectors (con0..con2) "
                        "and framebuffer-portcount = 3")
    p.add_argument("--first-con", type=int, choices=range(0, 4), metavar="N",
                   help="index of the first framebuffer-conN patch (default: 0 with an internal panel, "
                        "otherwise 1, like the FAQ framebuffers)")
    p.add_argument("--bus-id-source", choices=("ddi", "ddc"), default="ddi",
                   help="bus-id of HDMI/DVI ports: from the DDI (default) or from the VBT ddc_pin "
                        "(experimental; only valid for legacy GMBUS pins 4, 5, 6)")
    p.add_argument("--verbose", action="store_true", help="show parser notes")
    p.add_argument("-m", "--merge", help="merge the patch into this config.plist (a .bak copy is written first)")
    p.add_argument("-o", "--output", help="write the XML snippet to this file")
    p.add_argument("--json", action="store_true", help="print machine-readable output")
    p.add_argument("-v", "--version", action="version", version=f"%(prog)s {__version__}")
    return p


def _fail(message: str, code: int) -> int:
    print(f"[!] {message}", file=sys.stderr)
    return code


def main(argv: Optional[List[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)

    try:
        with open(args.input, "rb") as f:
            raw = f.read()
    except OSError as exc:
        return _fail(f"cannot read '{args.input}': {exc}", 1)
    try:
        vbt = VBTParser(raw)
    except ValueError as exc:
        return _fail(f"cannot parse VBT: {exc}", 1)

    if args.mobile and args.form_factor not in (None, FormFactor.MOBILE.value):
        return _fail("--mobile cannot be combined with -f " + args.form_factor, 2)
    if args.mobile:
        form_factor = FormFactor.MOBILE
    elif args.form_factor:
        form_factor = FormFactor(args.form_factor)
    else:
        has_panel = any(d.is_internal_panel for d in vbt.display_devices)
        form_factor = FormFactor.MOBILE if has_panel else FormFactor.DESKTOP

    pcir = vbt.detected_pcir_device_id
    try:
        if args.device_id:
            device_id = parse_device_id(args.device_id)
        elif pcir is not None:
            device_id = pcir
        else:
            return _fail("no device-id found in the file; pass it with -d (e.g. -d 3E9B).", 2)

        if args.platform_id:
            pid = parse_platform_id(args.platform_id)
            if pid not in KNOWN_PLATFORM_IDS and byteswap32(pid) in KNOWN_PLATFORM_IDS:
                return _fail(f"-p {args.platform_id} looks like raw bytes. Use the FAQ notation "
                             f"{byteswap32(pid):08X} instead.", 2)

        res = resolve_igpu(device_id, args.target_macos, form_factor, args.platform_id, args.spoof_id)
    except ValueError as exc:
        return _fail(str(exc), 2)

    connectors: List[ConnectorPatch] = []
    conn_warnings: List[str] = []
    if res.form_factor != FormFactor.HEADLESS:
        connectors, conn_warnings = build_connector_patches(
            vbt.child_devices, first_index=args.first_con,
            max_connectors=MOBILE_MAX_CONNECTORS if args.mobile else MAX_CONNECTORS,
            bus_source=args.bus_id_source)
    extras = dict(res.extra_properties)
    backlight_warnings: List[str] = []
    if args.backlight_fix:
        backlight_prop, backlight_warnings = select_backlight_property(res)
        if backlight_prop:
            extras[backlight_prop] = pack_u32_le(1)
    all_warnings = vbt.warnings + res.warnings + conn_warnings + backlight_warnings

    props: Optional[Dict[str, bytes]] = None
    exit_code = 0
    problem = None
    if res.status == CompatibilityStatus.UNSUPPORTED:
        exit_code, problem = 3, "This iGPU has no macOS driver; no patch generated."
    elif res.platform_id is None:
        exit_code, problem = 2, ("No platform-id could be chosen for this device. "
                                 "Pass one with -p (and --spoof-id if the device-id needs a spoof).")
    else:
        props = generate_opencore_patch(res.platform_id_bytes, res.spoof_bytes, extras,
                                        connectors, args.unifiedmem, args.rps_control,
                                        portcount=MOBILE_MAX_CONNECTORS if args.mobile else None)

    if args.json:
        out = {
            "app": PROG_NAME, "version": __version__, "target_macos": args.target_macos,
            "vbt_version": vbt.vbt_version, "bdb_version": vbt.bdb_version,
            "checksum": {"value": vbt.vbt_checksum, "ok": vbt.checksum_ok},
            "child_device_size": vbt.child_size,
            "ports": [{"slot": d.slot, "handle": d.handle_label, "dvo_port": d.dvo_port, "ddi": d.ddi,
                       "type": d.kind, "device_type": d.device_type, "aux_channel": d.aux_channel if d.aux_valid else None,
                       "ddc_pin": d.ddc_pin, "i2c_pin": d.i2c_pin, "hpd_status": d.hpd_status,
                       "hpd_invert": d.hpd_invert, "usb_type_c": d.usb_type_c, "tbt": d.tbt}
                      for d in vbt.child_devices],
            "device_id": f"0x{res.device_id_str}", "status": res.status.value, "reason": res.reason,
            "form_factor": res.form_factor.value,
            "spoof_device_id": f"0x{res.spoof_target:04X}" if res.spoof_target is not None else None,
            "platform_id": f"{res.platform_id:08X}" if res.platform_id is not None else None,
            "connectors": [{"property": f"con{c.index}", "ddi": c.source.ddi, "kind": c.source.kind,
                            "dvo_port": c.source.dvo_port, "bus_id": c.bus_id,
                            "type_bytes": c.type_bytes.hex().upper(), "pipe": c.pipe} for c in connectors],
            "properties": {k: {"hex": v.hex().upper(), "base64": base64.b64encode(v).decode("ascii")}
                           for k, v in (props or {}).items()},
            "warnings": all_warnings, "error": problem,
        }
        print(json.dumps(out, indent=2))
        return exit_code

    print(f"{PROG_NAME} {__version__}")
    print(f"Input        : {args.input} ({len(raw)} bytes), VBT header version {vbt.vbt_version}, BDB {vbt.bdb_version}")
    state = {True: "OK", False: "MISMATCH", None: "not verified"}[vbt.checksum_ok]
    print(f"VBT checksum : 0x{vbt.vbt_checksum:02X} ({state}), child device size {vbt.child_size}\n")
    print("Display devices defined in the VBT:")
    print(render_port_summary(vbt))
    if args.verbose:
        for note in vbt.notes:
            print(f"[i] {note}")
    print()
    print(render_summary(res, pcir))
    print()
    for w in all_warnings:
        print(f"[!] {w}")
    if all_warnings:
        print()
    if problem:
        return _fail(problem, exit_code)

    if connectors or res.form_factor != FormFactor.HEADLESS:
        print(render_connector_table(connectors))
        print()
    xml = render_opencore_xml(props)
    print("OpenCore DeviceProperties:")
    print(xml)

    if args.output:
        try:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(xml + "\n")
            print(f"\n[+] wrote {args.output}")
        except OSError as exc:
            return _fail(f"cannot write '{args.output}': {exc}", 1)
    if args.merge:
        try:
            backup = merge_into_plist(args.merge, props)
            print(f"\n[+] merged into {args.merge} (backup: {backup}); plist comments are not preserved")
        except Exception as exc:  # plist errors are varied
            return _fail(f"merge into '{args.merge}' failed: {exc}", 1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
