#!/usr/bin/env python3
"""
Tests for vbt2fbpatch. Run:  python3 -m unittest -v test_vbt2fbpatch

The expected byte strings are the ones printed in WhateverGreen's FAQ.IntelHD.en.md.
The synthetic VBT follows the struct layout from Linux i915 (intel_vbt_defs.h).
"""

import contextlib
import io
import json
import os
import plistlib
import struct
import tempfile
import unittest

import vbt2fbpatch as v
from vbt2fbpatch import CompatibilityStatus as S, FormFactor as FF


# ---------------------------------------------------------------- VBT builder

def child(device_type, dvo_port, aux=0, ddc=0, size=40, handle=0, flags=0, caps=0, typec=0):
    c = bytearray(size)
    struct.pack_into("<HH", c, 0, handle, device_type)
    c[16], c[19], c[23], c[25], c[27] = dvo_port, ddc, flags, aux, caps
    if size > 33:
        c[33] = typec
    return bytes(c)


def build_vbt(children, child_size=40, bdb_version=230, lfp_block=True, with_general_defs=True):
    def block(block_id, payload):
        return bytes([block_id]) + struct.pack("<H", len(payload)) + payload

    blocks = b""
    if lfp_block:   # block 40 = LFP options; a parser that treats it as child devices gets garbage
        blocks += block(40, bytes(range(1, 80)))
    if with_general_defs:
        blocks += block(2, bytes([0, 0, 0, 0, child_size]) + b"".join(children))
    bdb = (b"BIOS_DATA_BLOCK".ljust(16, b"\0")
           + struct.pack("<HHH", bdb_version, 22, 22 + len(blocks)) + blocks)
    header = (b"$VBT SKYLAKE".ljust(20, b"\0")
              + struct.pack("<HHHBBI", 100, 48, 48 + len(bdb), 0, 0, 48) + b"\0" * 16)
    blob = bytearray(header + bdb)
    blob[26] = (-sum(blob)) & 0xFF          # checksum byte: all vbt_size bytes add up to 0 mod 256
    return bytes(blob)


EDP = child(0x78C6, 10, aux=0x10)       # DDI A eDP
DP_B = child(0x68C6, 7)                 # DDI B DisplayPort
DP_C = child(0x68C6, 8)                 # DDI C DisplayPort
HDMI_D = child(0x60D2, 3)               # DDI D HDMI
CRT = child(0x0001, 6)                  # analog
EMPTY = child(0x0000, 0)


# ---------------------------------------------------------------- tests

class ByteOrder(unittest.TestCase):
    def test_faq_examples(self):
        # FAQ: "framebuffer 0x0166000B would be put in as 0B006601, DevID 0x1E3A as 3A1E0000"
        self.assertEqual(v.serialize_platform_id("0166000B").hex(), "0b006601")
        self.assertEqual(v.serialize_device_id(0x1E3A).hex(), "3a1e0000")

    def test_platform_ids(self):
        self.assertEqual(v.serialize_platform_id("3E9B0007").hex(), "07009b3e")
        self.assertEqual(v.serialize_platform_id("0x3EA50009").hex(), "0900a53e")
        self.assertEqual(v.serialize_platform_id("04120004").hex(), "04001204")   # was mangled before

    def test_connector_types(self):
        self.assertEqual(v.pack_u32_le(v.CON_TYPE_LVDS).hex(), "02000000")
        self.assertEqual(v.pack_u32_le(v.CON_TYPE_DVI).hex(), "04000000")
        self.assertEqual(v.pack_u32_le(v.CON_TYPE_DP).hex(), "00040000")
        self.assertEqual(v.pack_u32_le(v.CON_TYPE_HDMI).hex(), "00080000")

    def test_input_validation(self):
        with self.assertRaises(ValueError):
            v.parse_platform_id("3E9B")        # not 8 digits
        with self.assertRaises(ValueError):
            v.parse_device_id("12345")


class SpoofData(unittest.TestCase):
    def test_spoof_bytes_match_faq_strings(self):
        expected = {
            v.SPOOF_COFFEE_LAKE_REFRESH: "923E0000",
            v.SPOOF_WHISKEY_LAKE: "A53E0000",
            v.SPOOF_KABY_LAKE_REFRESH: "16590000",
            v.SPOOF_HASWELL: "12040000",
        }
        for spoof, faq in expected.items():
            self.assertEqual(spoof.faq_notation, faq)

    def test_comet_lake_is_native_in_the_faq(self):
        for dev_id in (0x9BC8, 0x9BC5, 0x9BC4):
            self.assertIsNone(v.INTEL_IGPU_DATABASE[dev_id].spoof)

    def test_entries_not_in_the_faq_are_absent(self):
        for dev_id in (0x9B41, 0x9BA4, 0x9BA5, 0x9BC6, 0x9BA8, 0x041A, 0x0402):
            self.assertNotIn(dev_id, v.INTEL_IGPU_DATABASE)


class Resolver(unittest.TestCase):
    def test_comet_lake_native_no_spoof(self):
        r = v.resolve_igpu("9BC8", "14.0")
        self.assertEqual(r.status, S.NATIVE)
        self.assertIsNone(r.spoof_bytes)
        self.assertEqual(r.platform_id, 0x3E9B0007)
        self.assertEqual(v.resolve_igpu("9BC8", form_factor="headless").platform_id, 0x9BC80003)
        self.assertEqual(v.resolve_igpu("9BC8", form_factor="mobile").platform_id, 0x3EA50009)
        self.assertEqual(v.resolve_igpu("9BC8", "10.14").status, S.UNSUPPORTED_OS)

    def test_coffee_lake_refresh_depends_on_macos(self):
        old = v.resolve_igpu("3E98", "10.14.3")
        self.assertEqual(old.status, S.NEEDS_SPOOF)
        self.assertEqual(old.spoof_bytes.hex().upper(), "923E0000")
        self.assertEqual(v.resolve_igpu("3E98", "10.14.3", "headless").platform_id, 0x3E920003)
        new = v.resolve_igpu("3E98", "10.14.4")
        self.assertEqual(new.status, S.NATIVE)
        self.assertIsNone(new.spoof_bytes)

    def test_whiskey_lake(self):
        r = v.resolve_igpu("3EA0", "14.0")
        self.assertEqual(r.status, S.NEEDS_SPOOF)
        self.assertEqual(r.spoof_bytes.hex().upper(), "A53E0000")
        self.assertEqual(r.platform_id, 0x3EA50009)

    def test_kaby_lake_refresh_always_spoofs(self):
        for macos in ("10.15", "14.0"):
            r = v.resolve_igpu("5917", macos)
            self.assertEqual(r.status, S.NEEDS_SPOOF)
            self.assertEqual(r.spoof_bytes.hex().upper(), "16590000")

    def test_skylake(self):
        new = v.resolve_igpu("1912", "13.0")
        self.assertEqual(new.status, S.NEEDS_SPOOF)
        self.assertEqual(new.spoof_bytes.hex().upper(), "12590000")
        self.assertEqual(new.platform_id, 0x59120000)       # Kaby Lake framebuffer, not 19120000
        self.assertEqual(new.extra_properties, {"AAPL,GfxYTile": bytes.fromhex("01000000")})
        old = v.resolve_igpu("1912", "12.6")
        self.assertEqual(old.status, S.NATIVE)
        self.assertEqual(old.platform_id, 0x19120000)
        self.assertEqual(old.extra_properties, {})
        self.assertEqual(v.resolve_igpu("191B", "14.0").platform_id, 0x591B0000)

    def test_skylake_gt1_is_native_and_needs_manual_spoof_on_13(self):
        self.assertEqual(v.resolve_igpu("1902", "12.0").status, S.NATIVE)
        r = v.resolve_igpu("1902", "14.0")
        self.assertEqual(r.status, S.UNSUPPORTED_OS)
        self.assertIn("--spoof-id", r.notes)
        manual = v.resolve_igpu("1902", "14.0", spoof_id_override="5912", platform_id_override="59120000")
        self.assertEqual(manual.status, S.NEEDS_SPOOF)
        self.assertTrue(manual.spoof_is_manual)

    def test_haswell_mobile_needs_spoof_and_new_macos_is_flagged(self):
        r = v.resolve_igpu("0416", "12.0")
        self.assertEqual(r.status, S.NEEDS_SPOOF)
        self.assertEqual(r.spoof_bytes.hex().upper(), "12040000")
        late = v.resolve_igpu("0416", "14.0")
        self.assertEqual(late.status, S.UNSUPPORTED_OS)
        self.assertEqual(late.spoof_target, 0x0412)
        self.assertEqual(v.resolve_igpu("0412", "14.0").status, S.UNSUPPORTED_OS)

    def test_broadwell_has_no_headless_framebuffer(self):
        r = v.resolve_igpu("1622", "12.0", "headless")
        self.assertIsNone(r.platform_id)
        self.assertTrue(r.warnings)

    def test_unsupported_and_unknown(self):
        self.assertEqual(v.resolve_igpu("4680").status, S.UNSUPPORTED)
        unknown = v.resolve_igpu("BEEF")
        self.assertEqual(unknown.status, S.UNKNOWN)
        self.assertIsNone(unknown.platform_id)
        self.assertIsNone(unknown.spoof_bytes)

    def test_manual_spoof_warns(self):
        r = v.resolve_igpu("3E9B", spoof_id_override="3EA5")
        self.assertEqual(r.status, S.NEEDS_SPOOF)
        self.assertEqual(r.spoof_bytes.hex().upper(), "A53E0000")
        self.assertTrue(r.warnings)


class Parser(unittest.TestCase):
    def test_classification_matches_i915_constants(self):
        expect = {0x78C6: "eDP", 0x68C6: "DP", 0x60D6: "DP++", 0x60D2: "HDMI",
                  0x68D2: "DVI", 0x1022: "LVDS", 0x0001: "Analog"}
        for dt, kind in expect.items():
            self.assertEqual(v.classify_device_type(dt), kind, hex(dt))

    def test_children_come_from_block_2_not_block_40(self):
        p = v.VBTParser(build_vbt([EMPTY, EDP, DP_B, HDMI_D, CRT]))
        self.assertEqual([d.kind for d in p.child_devices], ["eDP", "DP", "HDMI", "Analog"])
        self.assertEqual([d.kind for d in p.display_devices], ["eDP", "DP", "HDMI"])
        self.assertEqual([d.ddi for d in p.display_devices], ["A", "B", "D"])
        self.assertEqual(p.display_devices[0].aux_channel, 0x10)
        self.assertEqual(p.bdb_version, 230)

    def test_legacy_child_size(self):
        p = v.VBTParser(build_vbt([child(0x68C6, 7, size=33)], child_size=33, bdb_version=155))
        self.assertEqual(len(p.display_devices), 1)

    def test_errors(self):
        with self.assertRaises(ValueError):
            v.VBTParser(b"\0" * 200)
        with self.assertRaises(ValueError):
            v.VBTParser(build_vbt([], with_general_defs=False))

    def test_pcir_detection(self):
        blob = b"\0" * 64 + b"PCIR" + struct.pack("<HH", 0x8086, 0x9BC8) + b"\0" * 32
        self.assertEqual(v.extract_pcir_device_id(blob), 0x9BC8)
        self.assertIsNone(v.extract_pcir_device_id(b"\0" * 64))


class Patch(unittest.TestCase):
    def test_mobile_layout(self):
        p = v.VBTParser(build_vbt([EDP, DP_B, HDMI_D]))
        patches, warnings = v.build_connector_patches(p.display_devices)
        self.assertEqual(warnings, [])
        props = v.generate_opencore_patch(v.serialize_platform_id("3EA50009"), None, None, patches)
        self.assertEqual(props["AAPL,ig-platform-id"].hex(), "0900a53e")
        self.assertEqual(props["framebuffer-con0-type"].hex(), "02000000")
        self.assertEqual(props["framebuffer-con0-pipe"].hex(), "08000000")
        self.assertEqual(props["framebuffer-con1-busid"].hex(), "05000000")
        self.assertEqual(props["framebuffer-con1-type"].hex(), "00040000")
        self.assertEqual(props["framebuffer-con1-pipe"].hex(), "09000000")
        self.assertEqual(props["framebuffer-con2-busid"].hex(), "06000000")
        self.assertEqual(props["framebuffer-con2-type"].hex(), "00080000")
        self.assertEqual(props["framebuffer-con2-pipe"].hex(), "0a000000")
        self.assertEqual(props["framebuffer-patch-enable"].hex(), "01000000")
        self.assertNotIn("framebuffer-unifiedmem", props)
        self.assertNotIn("rps-control", props)

    def test_desktop_layout_matches_faq_3E9B0007(self):
        # FAQ dump: con1 bus 5 pipe 9, con2 bus 4 pipe 10, con3 bus 6 pipe 8
        p = v.VBTParser(build_vbt([HDMI_D, DP_C, DP_B]))
        patches, _ = v.build_connector_patches(p.display_devices)
        self.assertEqual([(c.index, c.bus_id, c.pipe) for c in patches], [(1, 5, 9), (2, 4, 10), (3, 6, 8)])

    def test_spoof_and_optional_properties(self):
        res = v.resolve_igpu("3E98", "10.14.3")
        props = v.generate_opencore_patch(res.platform_id_bytes, res.spoof_bytes, res.extra_properties,
                                          [], unifiedmem=True, rps_control=True)
        self.assertEqual(props["device-id"].hex().upper(), "923E0000")
        self.assertEqual(props["framebuffer-unifiedmem"].hex(), "00000080")
        self.assertEqual(props["rps-control"].hex(), "01000000")
        self.assertIn("framebuffer-patch-enable", props)

    def test_unusable_connectors_are_reported(self):
        ddi_e = child(0x68C6, 11)
        p = v.VBTParser(build_vbt([ddi_e, CRT]))
        patches, warnings = v.build_connector_patches(p.display_devices + [p.child_devices[1]])
        self.assertEqual(patches, [])
        self.assertEqual(len(warnings), 2)


class Backlight(unittest.TestCase):
    ALT = "enable-backlight-registers-alternative-fix"
    BLR = "enable-backlight-registers-fix"

    def pick(self, dev_id, macos):
        return v.select_backlight_property(v.resolve_igpu(dev_id, macos))

    def test_whiskey_lake_uses_coffee_lake_driver_after_spoof(self):
        self.assertEqual(self.pick("3EA0", "14.0")[0], self.ALT)      # macOS 13.4+: alternative fix
        self.assertEqual(self.pick("3EA0", "13.4")[0], self.ALT)
        self.assertEqual(self.pick("3EA0", "13.3")[0], self.BLR)      # before 13.4: classic fix
        self.assertEqual(self.pick("3EA0", "12.0")[0], self.BLR)

    def test_other_generations(self):
        self.assertEqual(self.pick("8A52", "14.0")[0], self.BLR)      # Ice Lake is not affected by the 13.4 change
        self.assertEqual(self.pick("5917", "12.0")[0], self.BLR)      # KBL-R, spoofed to Kaby Lake
        self.assertEqual(self.pick("1912", "13.4")[0], self.ALT)      # Skylake spoofed to Kaby Lake runs its driver
        self.assertEqual(self.pick("1912", "13.0")[0], self.BLR)      # ... but the alternative fix starts at 13.4
        self.assertIsNone(self.pick("1912", "12.0")[0])               # native Skylake: not in the FAQ
        self.assertIsNone(self.pick("0412", "12.0")[0])               # Haswell
        self.assertTrue(self.pick("0412", "12.0")[1])                 # ... and the user is told

    def test_cli_is_opt_in(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "vbt.bin")
            with open(path, "wb") as f:
                f.write(build_vbt([EDP, DP_B, HDMI_D]))

            def run(*extra):
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    code = v.main(["-i", path, "-d", "3EA0", "--json", *extra])
                return code, json.loads(out.getvalue())

            code, data = run()
            self.assertNotIn(self.ALT, data["properties"])
            code, data = run("--backlight-fix")
            self.assertEqual(code, 0)
            self.assertEqual(data["properties"][self.ALT]["hex"], "01000000")
            self.assertNotIn(self.BLR, data["properties"])
            self.assertTrue(any("-igfxblr" in w for w in data["warnings"]))


class Spec(unittest.TestCase):
    """Behaviour requested for the VBT parser and the connector limits."""

    def test_checksum(self):
        good = build_vbt([EDP])
        self.assertTrue(v.VBTParser(good).checksum_ok)
        bad = bytearray(good)
        bad[-1] ^= 0xFF
        p = v.VBTParser(bytes(bad))
        self.assertFalse(p.checksum_ok)
        self.assertTrue(any("checksum" in w for w in p.warnings))

    def test_handles_depend_on_bdb_version(self):
        self.assertEqual(v.handle_name(0x0008, 155), "LFP1")
        self.assertEqual(v.handle_name(0x0080, 155), "LFP2")
        self.assertEqual(v.handle_name(0x0004, 155), "EFP1")
        self.assertEqual(v.handle_name(0x0002, 155), "TV")
        self.assertEqual(v.handle_name(0x0002, 215), "EFP5")
        self.assertEqual(v.handle_name(0x0001, 155), "CRT")
        self.assertEqual(v.handle_name(0x0001, 217), "EFP6")

    def test_fields_are_gated_by_bdb_version(self):
        kids = [child(0x78C6, 10, aux=0x40, handle=0x0008, flags=0x10, typec=0x03)]
        new = v.VBTParser(build_vbt(kids, bdb_version=230)).child_devices[0]
        self.assertEqual((new.handle_label, new.aux_ddi, new.hpd_invert, new.usb_type_c, new.tbt),
                         ("LFP1", "A", True, True, True))
        old = v.VBTParser(build_vbt(kids, child_size=33, bdb_version=155)).child_devices[0]
        self.assertFalse(old.aux_valid)
        self.assertIsNone(old.aux_ddi)          # before BDB 158 these bytes hold dvo2 data
        self.assertIsNone(old.hpd_invert)       # 196+
        self.assertIsNone(old.usb_type_c)       # 195+
        mid = v.VBTParser(build_vbt(kids, bdb_version=200)).child_devices[0]
        self.assertTrue(mid.usb_type_c)
        self.assertIsNone(mid.tbt)              # 209+

    def test_expected_child_sizes_follow_i915(self):
        sizes = {110: 27, 111: 33, 194: 33, 195: 37, 196: 38, 215: 38, 216: 39, 255: 39, 256: 40, 263: 44}
        for version, size in sizes.items():
            self.assertEqual(v.expected_child_size(version), size, version)
        self.assertIsNone(v.expected_child_size(265))

    def test_four_connector_limit_keeps_the_internal_panel(self):
        p = v.VBTParser(build_vbt([HDMI_D, DP_C, DP_B, EDP]))
        patches, warnings = v.build_connector_patches(p.child_devices, first_index=1)   # con1..con3
        self.assertEqual([c.source.kind for c in patches], ["eDP", "DP", "DP"])
        self.assertTrue(any("not patched" in w and "HDMI" in w for w in warnings))
        self.assertEqual([c.index for c in patches], [1, 2, 3])

    def test_mobile_limit_is_three_connectors(self):
        p = v.VBTParser(build_vbt([EDP, DP_B, DP_C, HDMI_D]))
        patches, warnings = v.build_connector_patches(p.child_devices, max_connectors=v.MOBILE_MAX_CONNECTORS)
        self.assertEqual([c.index for c in patches], [0, 1, 2])
        self.assertTrue(any("at most 3" in w for w in warnings))

    def test_analog_devices_are_excluded(self):
        p = v.VBTParser(build_vbt([EDP, CRT]))
        patches, warnings = v.build_connector_patches(p.child_devices)
        self.assertEqual(len(patches), 1)
        self.assertTrue(any("Analog" in w for w in warnings))

    def test_bus_id_source(self):
        hdmi_b_ddc6 = child(0x60D2, 1, ddc=6)       # HDMI on DDI B whose VBT ddc_pin says GMBUS pin 6
        p = v.VBTParser(build_vbt([EDP, hdmi_b_ddc6]))
        by_ddi, warn = v.build_connector_patches(p.child_devices)
        self.assertEqual(by_ddi[1].bus_id, 5)
        self.assertTrue(any("--bus-id-source ddc" in w for w in warn))
        by_ddc, _ = v.build_connector_patches(p.child_devices, bus_source="ddc")
        self.assertEqual(by_ddc[1].bus_id, 6)
        enum_style = v.VBTParser(build_vbt([EDP, child(0x60D2, 1, ddc=1)]))     # newer VBTs: enum, not a GMBUS pin
        patches, warn = v.build_connector_patches(enum_style.child_devices, bus_source="ddc")
        self.assertEqual(patches[1].bus_id, 5)
        self.assertTrue(any("not a legacy GMBUS pin" in w for w in warn))

    def test_portcount_property(self):
        props = v.generate_opencore_patch(v.serialize_platform_id("3EA50009"), portcount=3)
        self.assertEqual(props["framebuffer-portcount"].hex(), "03000000")
        self.assertIn("framebuffer-patch-enable", props)

    def test_cli_mobile_flag(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "vbt.bin")
            with open(path, "wb") as f:
                f.write(build_vbt([EDP, DP_B, DP_C, HDMI_D]))
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = v.main(["-i", path, "-d", "3EA0", "--mobile", "--json"])
            data = json.loads(out.getvalue())
            self.assertEqual(code, 0)
            self.assertEqual(data["properties"]["framebuffer-portcount"]["hex"], "03000000")
            self.assertEqual([c["property"] for c in data["connectors"]], ["con0", "con1", "con2"])
            self.assertTrue(data["checksum"]["ok"])
            self.assertEqual(len(data["ports"]), 4)
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(v.main(["-i", path, "-d", "3EA0", "--mobile", "-f", "desktop"]), 2)


class CLI(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.vbt = os.path.join(self.dir.name, "vbt.bin")
        with open(self.vbt, "wb") as f:
            f.write(build_vbt([EDP, DP_B, HDMI_D]))

    def run_cli(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = v.main(list(args))
        return code, out.getvalue(), err.getvalue()

    def test_json_output(self):
        code, out, _ = self.run_cli("-i", self.vbt, "-d", "9BC8", "--json")
        data = json.loads(out)
        self.assertEqual(code, 0)
        self.assertEqual(data["status"], "NATIVE")
        self.assertEqual(data["form_factor"], "mobile")             # VBT has an eDP panel
        self.assertEqual(data["properties"]["AAPL,ig-platform-id"]["hex"], "0900A53E")
        self.assertNotIn("device-id", data["properties"])

    def test_text_output_runs(self):
        code, out, _ = self.run_cli("-i", self.vbt, "-d", "3EA0")
        self.assertEqual(code, 0)
        self.assertIn("NEEDS_SPOOF", out)
        self.assertIn("<A53E0000>", out)

    def test_error_paths(self):
        self.assertEqual(self.run_cli("-i", self.vbt, "--json")[0], 2)                 # no device-id anywhere
        self.assertEqual(self.run_cli("-i", self.vbt, "-d", "BEEF", "--json")[0], 2)   # unknown, no -p
        self.assertEqual(self.run_cli("-i", self.vbt, "-d", "4680", "--json")[0], 3)   # Xe
        self.assertEqual(self.run_cli("-i", self.vbt, "-d", "9BC8", "-p", "07009B3E")[0], 2)  # raw bytes
        self.assertEqual(self.run_cli("-i", "/nonexistent")[0], 1)

    def test_unknown_device_with_manual_ids(self):
        code, out, _ = self.run_cli("-i", self.vbt, "-d", "BEEF", "-p", "3EA50009", "--spoof-id", "3EA5", "--json")
        data = json.loads(out)
        self.assertEqual(code, 0)
        self.assertEqual(data["properties"]["device-id"]["hex"], "A53E0000")

    def test_merge_keeps_existing_keys_and_writes_backup(self):
        plist_path = os.path.join(self.dir.name, "config.plist")
        with open(plist_path, "wb") as f:
            plistlib.dump({"DeviceProperties": {"Add": {v.IGPU_PCI_PATH: {"keep-me": b"\x01"}}}, "Other": 1}, f)
        code, _, _ = self.run_cli("-i", self.vbt, "-d", "9BC8", "-m", plist_path)
        self.assertEqual(code, 0)
        self.assertTrue(os.path.exists(plist_path + ".bak"))
        with open(plist_path, "rb") as f:
            cfg = plistlib.load(f)
        igpu = cfg["DeviceProperties"]["Add"][v.IGPU_PCI_PATH]
        self.assertEqual(igpu["keep-me"], b"\x01")
        self.assertEqual(igpu["AAPL,ig-platform-id"].hex(), "0900a53e")
        self.assertEqual(cfg["Other"], 1)


if __name__ == "__main__":
    unittest.main()
