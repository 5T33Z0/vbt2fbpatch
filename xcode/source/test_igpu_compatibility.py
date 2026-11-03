#!/usr/bin/env python3
"""
Unit Test Suite for vbt2fbpatch (v3.4.0).

Validates:
  1. Intel iGPU Database coverage & generation classification.
  2. WhateverGreen spoof resolution, macOS version conditionality, and form-factor awareness.
  3. Little-Endian struct.pack('<I', val) serialization & exact byte sequence verification:
      * device-id 0x3E9B -> bytes 9B 3E 00 00
      * AAPL,ig-platform-id 0x3E9B0007 -> bytes 07 00 9B 3E
      * framebuffer-con0-type 0x00020000 -> bytes 00 00 02 00
      * framebuffer-con-type DP 0x00040000 -> bytes 00 04 00 00
      * framebuffer-con-type HDMI 0x00080000 -> bytes 00 08 00 00
  4. Plist merging into config.plist without destroying existing properties.
  5. Backlight fix property selection (standard vs macOS 13.4+ alternative fix).
  6. Flags breakdown using IntelFramebuffer.bt bitmask definitions.
  7. Unsupported 11th+ Gen Intel Xe diagnostics.
"""

import os
import plistlib
import struct
import tempfile
import unittest

import vbt2fbpatch
from vbt2fbpatch import (
    CompatibilityStatus,
    FormFactor,
    IGPUDevice,
    INTEL_IGPU_DATABASE,
    KNOWN_PLATFORM_IDS,
    FRAMEBUFFER_DUMPS,
    FRAMEBUFFER_FLAG_NAMES,
    CONNECTOR_FLAG_NAMES,
    parse_device_id,
    parse_platform_id,
    resolve_igpu,
    pack_u32_le,
    byteswap32,
    generate_opencore_patch,
    merge_into_plist,
    select_backlight_property,
    describe_flags,
)


class TestDatabaseAndGenerations(unittest.TestCase):
    """Tests Intel iGPU database coverage and generation accuracy."""

    def test_database_contains_major_generations(self):
        # Haswell
        self.assertIn(0x0412, INTEL_IGPU_DATABASE)
        self.assertIn(0x0416, INTEL_IGPU_DATABASE)
        self.assertIn(0x041E, INTEL_IGPU_DATABASE)
        # Broadwell
        self.assertIn(0x1616, INTEL_IGPU_DATABASE)
        self.assertIn(0x1622, INTEL_IGPU_DATABASE)
        # Skylake
        self.assertIn(0x1912, INTEL_IGPU_DATABASE)
        self.assertIn(0x1916, INTEL_IGPU_DATABASE)
        # Kaby Lake & KBL-R
        self.assertIn(0x5912, INTEL_IGPU_DATABASE)
        self.assertIn(0x5916, INTEL_IGPU_DATABASE)
        self.assertIn(0x5917, INTEL_IGPU_DATABASE)
        # Coffee Lake & CFL-R
        self.assertIn(0x3E9B, INTEL_IGPU_DATABASE)
        self.assertIn(0x3E92, INTEL_IGPU_DATABASE)
        self.assertIn(0x3E98, INTEL_IGPU_DATABASE)
        # Comet Lake
        self.assertIn(0x9BC8, INTEL_IGPU_DATABASE)
        self.assertIn(0x9BC5, INTEL_IGPU_DATABASE)
        self.assertIn(0x9BC4, INTEL_IGPU_DATABASE)
        self.assertIn(0x9B41, INTEL_IGPU_DATABASE)
        # Ice Lake
        self.assertIn(0x8A52, INTEL_IGPU_DATABASE)
        self.assertIn(0x8A53, INTEL_IGPU_DATABASE)
        # Unsupported Xe
        self.assertIn(0x9A49, INTEL_IGPU_DATABASE)
        self.assertIn(0x4680, INTEL_IGPU_DATABASE)
        self.assertIn(0xA780, INTEL_IGPU_DATABASE)
        self.assertIn(0x4C8A, INTEL_IGPU_DATABASE)

    def test_architecture_classification(self):
        self.assertEqual(INTEL_IGPU_DATABASE[0x9BC8].architecture, "Comet Lake")
        self.assertEqual(INTEL_IGPU_DATABASE[0x8A52].architecture, "Ice Lake")
        self.assertEqual(INTEL_IGPU_DATABASE[0x3E9B].architecture, "Coffee Lake")
        self.assertEqual(INTEL_IGPU_DATABASE[0x5912].architecture, "Kaby Lake")
        self.assertEqual(INTEL_IGPU_DATABASE[0x1912].architecture, "Skylake")
        self.assertEqual(INTEL_IGPU_DATABASE[0x0412].architecture, "Haswell")
        self.assertEqual(INTEL_IGPU_DATABASE[0x4680].architecture, "Alder Lake")


class TestWhateverGreenResolution(unittest.TestCase):
    """Tests WhateverGreen spoof resolution and macOS version boundary rules."""

    def test_comet_lake_mobile_spoof(self):
        # 0x9B41 is Comet Lake U (mobile) which needs spoof to 0x3E9B
        res = resolve_igpu(0x9B41, "14.0", FormFactor.MOBILE)
        self.assertEqual(res.status, CompatibilityStatus.NEEDS_SPOOF)
        self.assertEqual(res.spoof_target, 0x3E9B)
        self.assertEqual(res.spoof_bytes, struct.pack('<I', 0x3E9B))

    def test_coffee_lake_refresh_version_boundary(self):
        # 0x3E98 requires spoof below 10.14.4
        res_old = resolve_igpu(0x3E98, "10.14.3", FormFactor.DESKTOP)
        self.assertEqual(res_old.status, CompatibilityStatus.NEEDS_SPOOF)
        self.assertEqual(res_old.spoof_target, 0x3E92)

        # 0x3E98 is native on 10.14.4+
        res_new = resolve_igpu(0x3E98, "10.14.4", FormFactor.DESKTOP)
        self.assertEqual(res_new.status, CompatibilityStatus.NATIVE)
        self.assertIsNone(res_new.spoof_target)

    def test_kaby_lake_refresh_spoof(self):
        # 0x5917 requires spoof to 0x5916
        res = resolve_igpu(0x5917, "14.0", FormFactor.MOBILE)
        self.assertEqual(res.status, CompatibilityStatus.NEEDS_SPOOF)
        self.assertEqual(res.spoof_target, 0x5916)

    def test_skylake_ventura_boundary(self):
        # Skylake 0x1912 native on Monterey (12.6)
        res_monterey = resolve_igpu(0x1912, "12.6", FormFactor.DESKTOP)
        self.assertEqual(res_monterey.status, CompatibilityStatus.NATIVE)

        # Skylake on Ventura 13.0+ requires Kaby Lake spoof + AAPL,GfxYTile
        res_ventura = resolve_igpu(0x1912, "13.0", FormFactor.DESKTOP)
        self.assertEqual(res_ventura.status, CompatibilityStatus.NEEDS_SPOOF)
        self.assertEqual(res_ventura.spoof_target, 0x5912)
        self.assertIn("AAPL,GfxYTile", res_ventura.extra_properties)

    def test_haswell_desktop_hd4400_spoof(self):
        res = resolve_igpu(0x041E, "12.0", FormFactor.DESKTOP)
        self.assertEqual(res.status, CompatibilityStatus.NEEDS_SPOOF)
        self.assertEqual(res.spoof_target, 0x0412)


class TestSerializationAndEndianness(unittest.TestCase):
    """Tests Little-Endian struct.pack('<I', val) exact byte sequences."""

    def test_device_id_endianness(self):
        # 0x3E9B -> 9B 3E 00 00
        b = pack_u32_le(0x3E9B)
        self.assertEqual(b, b"\x9B\x3E\x00\x00")
        self.assertEqual(b.hex(), "9b3e0000")

    def test_platform_id_endianness(self):
        # CFL desktop platform-id: 3E9B0007 (FAQ notation) -> bytes 07 00 9B 3E
        pid = parse_platform_id("3E9B0007")
        self.assertEqual(pid, 0x3E9B0007)
        b = pack_u32_le(pid)
        self.assertEqual(b, b"\x07\x00\x9B\x3E")
        self.assertEqual(b.hex(), "07009b3e")

    def test_connector_type_constants(self):
        self.assertEqual(pack_u32_le(0x00040000), b"\x00\x00\x04\x00")
        self.assertEqual(pack_u32_le(0x00080000), b"\x00\x00\x08\x00")
        self.assertEqual(pack_u32_le(0x00020000), b"\x00\x00\x02\x00")


class TestOpenCorePlistMerge(unittest.TestCase):
    """Tests OpenCore config.plist non-destructive merging."""

    def test_merge_preserves_existing_keys(self):
        initial_plist = {
            "DeviceProperties": {
                "Add": {
                    "PciRoot(0x0)/Pci(0x1F,0x3)": {
                        "layout-id": bytes([1, 0, 0, 0]),
                    },
                    "PciRoot(0x0)/Pci(0x2,0x0)": {
                        "hda-gfx": "onboard-1".encode("utf-8"),
                        "custom-user-flag": bytes([0xFF, 0x00, 0x00, 0x00]),
                    },
                }
            }
        }

        with tempfile.NamedTemporaryFile(suffix=".plist", delete=False) as tf:
            temp_path = tf.name
            plistlib.dump(initial_plist, tf)

        try:
            res = resolve_igpu(0x9B41, "14.0", FormFactor.MOBILE)
            patch_dict = generate_opencore_patch(
                platform_id_bytes=res.platform_id_bytes,
                spoof_bytes=res.spoof_bytes,
                extra_properties=dict(res.extra_properties),
                connectors=[],
                unifiedmem=True,
            )

            merge_into_plist(temp_path, patch_dict)

            with open(temp_path, "rb") as f:
                merged = plistlib.load(f)

            igpu_props = merged["DeviceProperties"]["Add"]["PciRoot(0x0)/Pci(0x2,0x0)"]
            audio_props = merged["DeviceProperties"]["Add"]["PciRoot(0x0)/Pci(0x1F,0x3)"]

            self.assertEqual(audio_props["layout-id"], bytes([1, 0, 0, 0]))
            self.assertEqual(igpu_props["hda-gfx"], "onboard-1".encode("utf-8"))
            self.assertEqual(igpu_props["custom-user-flag"], bytes([0xFF, 0x00, 0x00, 0x00]))
            self.assertEqual(igpu_props["device-id"], b"\x9B\x3E\x00\x00")
            self.assertEqual(igpu_props["framebuffer-patch-enable"], b"\x01\x00\x00\x00")
            self.assertEqual(igpu_props["framebuffer-unifiedmem"], b"\x00\x00\x00\x80")
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)


class TestBacklightFixAndFlags(unittest.TestCase):
    """Tests Backlight register fix selection and IntelFramebuffer.bt flags decoding."""

    def test_backlight_fix_selection_by_macos_version(self):
        # On macOS 13.0 (Ventura below 13.4): standard fix
        res_old = resolve_igpu(0x3E9B, "13.0", FormFactor.MOBILE)
        prop_old, _ = select_backlight_property(res_old)
        self.assertEqual(prop_old, "enable-backlight-registers-fix")

        # On macOS 13.4+ (Sonoma 14.0): alternative fix
        res_new = resolve_igpu(0x3E9B, "14.0", FormFactor.MOBILE)
        prop_new, _ = select_backlight_property(res_new)
        self.assertEqual(prop_new, "enable-backlight-registers-alternative-fix")

    def test_flags_decoding(self):
        # 0x3C7 connector flags
        names = describe_flags(0x3C7, CONNECTOR_FLAG_NAMES)
        self.assertIn("CNAlterAppertureRequirements", names)
        self.assertIn("CNUsePowerWell2", names)

        # 0x00801302 framebuffer flags
        fb_names = describe_flags(0x00801302, FRAMEBUFFER_FLAG_NAMES)
        self.assertIn("FBFramebufferCommonMemory", fb_names)
        self.assertIn("FBSupport5KSourceSize", fb_names)


class TestUnsupportedXeDiagnostics(unittest.TestCase):
    """Tests Diagnostics and warnings for unsupported Intel Xe graphics."""

    def test_intel_xe_flagged_as_unsupported(self):
        for dev_id in (0x9A49, 0x4680, 0xA780, 0x4C8A):
            res = resolve_igpu(dev_id, "14.0", FormFactor.DESKTOP)
            self.assertEqual(res.status, CompatibilityStatus.UNSUPPORTED)
            self.assertIn("NO MACOS GRAPHICS DRIVER", res.reason.upper())


if __name__ == "__main__":
    unittest.main()
