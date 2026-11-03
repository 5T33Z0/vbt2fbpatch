#!/usr/bin/env python3
"""
Generates realistic sample Intel VBT binaries for testing vbt2opencore.
Creates:
- samples/cfl_desktop_vbt.bin: Coffee Lake Desktop (DDI B HDMI, DDI C DP, DDI D DP)
- samples/cml_laptop_vbt.bin: Comet Lake Laptop (DDI A eDP, DDI B HDMI)
- samples/kbl_nuc_vbt.bin: Kaby Lake Mini-PC / NUC (DDI B HDMI, DDI C DP)
- samples/block28_direct_vbt.bin: VBT with direct Block 0x28 child devices
- samples/sample_config.plist: Sample OpenCore config.plist for merge testing
"""

import os
import plistlib
import struct

os.makedirs("samples", exist_ok=True)


def build_child_device_entry(
    handle: int,
    device_type: int,
    dvo_port: int,
    aux_channel: int = 0,
    ddc_pin: int = 0,
    hpd_pin: int = 0,
    stride: int = 40,
) -> bytes:
    buf = bytearray(stride)
    struct.pack_into("<H", buf, 0, handle)
    struct.pack_into("<H", buf, 2, device_type)
    buf[16] = dvo_port
    buf[17] = ddc_pin  # i2c_pin
    buf[18] = 0xA0  # slave_addr
    buf[19] = ddc_pin  # ddc_pin
    buf[22] = 0x01  # dvo_cfg
    buf[23] = aux_channel
    buf[27] = hpd_pin
    buf[28] = 0x01  # flags
    return bytes(buf)


def create_vbt(
    filename: str,
    vbt_version: int,
    bdb_version: int,
    use_block_28: bool,
    devices: list,
    stride: int = 40,
    legacy_bdb_sig: bool = False,
    simulate_checksum_dc: bool = False,
):
    vbt_hdr = bytearray(0x40)
    vbt_hdr[0:4] = b"$VBT"
    struct.pack_into("<H", vbt_hdr, 0x14, vbt_version)
    struct.pack_into("<H", vbt_hdr, 0x16, 0x0030)  # header size
    struct.pack_into("<I", vbt_hdr, 0x1C, 0x0040)  # Standard bdb_offset at 0x1C (uint32)

    if simulate_checksum_dc:
        vbt_hdr[0x1A] = 0xDC  # Checksum 0xDC which caused 0xDC lookup in old parser
        # Put "HIBI" at offset 0xDC (e.g. part of OEM string in padding)
        extra_padding = bytearray(0x100)
        extra_padding[0xDC - 0x40 : 0xDC - 0x40 + 4] = b"HIBI"
    else:
        struct.pack_into("<H", vbt_hdr, 0x1A, 0x0040)  # Legacy bdb offset pointer

    if legacy_bdb_sig:
        bdb_hdr = bytearray(0x10)
        bdb_hdr[0:4] = b"$BDB"
        struct.pack_into("<H", bdb_hdr, 4, bdb_version)
        struct.pack_into("<H", bdb_hdr, 6, 0x0010)  # header size 16 bytes
    else:
        # Standard Intel specification: BIOS_DATA_BLOCK header (22 bytes)
        bdb_hdr = bytearray(22)
        bdb_hdr[0:15] = b"BIOS_DATA_BLOCK"
        struct.pack_into("<H", bdb_hdr, 16, bdb_version)
        struct.pack_into("<H", bdb_hdr, 18, 22)  # header size 22 bytes

    # Build payload
    dev_bytes = b"".join(devices)
    if not use_block_28:
        # Block 0x02: 5-byte header + dev_bytes
        block_id = 0x02
        block_body = bytearray(5)
        block_body[0] = 0x01  # crt_ddc
        block_body[4] = stride  # child_dev_size
        block_payload = bytes(block_body) + dev_bytes
    else:
        # Block 0x28: Child devices block
        block_id = 0x28
        block_payload = dev_bytes

    block_hdr = bytearray(3)
    block_hdr[0] = block_id
    struct.pack_into("<H", block_hdr, 1, len(block_payload))

    # Add general features block 0x01 just to have realistic multiple blocks
    feat_payload = b"\x00" * 8
    feat_hdr = bytearray(3)
    feat_hdr[0] = 0x01
    struct.pack_into("<H", feat_hdr, 1, len(feat_payload))

    total_bdb_body = bytes(feat_hdr) + feat_payload + bytes(block_hdr) + block_payload
    if legacy_bdb_sig:
        struct.pack_into("<H", bdb_hdr, 8, len(bdb_hdr) + len(total_bdb_body))
    else:
        struct.pack_into("<H", bdb_hdr, 20, len(bdb_hdr) + len(total_bdb_body))

    full_vbt = bytes(vbt_hdr) + bytes(bdb_hdr) + total_bdb_body
    with open(filename, "wb") as f:
        f.write(full_vbt)
    print(f"Created {filename} ({len(full_vbt)} bytes)")


# 1. Coffee Lake Desktop: DDI B (HDMI), DDI C (DP), DDI D (DP)
cfl_devs = [
    build_child_device_entry(0x01, 0x60D2, 0x01, aux_channel=0x00, ddc_pin=0x02, hpd_pin=0x02),  # DDI B HDMI
    build_child_device_entry(0x02, 0x68C6, 0x08, aux_channel=0x02, ddc_pin=0x03, hpd_pin=0x03),  # DDI C DP
    build_child_device_entry(0x03, 0x68C6, 0x09, aux_channel=0x03, ddc_pin=0x04, hpd_pin=0x04),  # DDI D DP
    build_child_device_entry(0x00, 0x0000, 0x00),  # Inactive
]
create_vbt("samples/cfl_desktop_vbt.bin", 0x0216, 221, False, cfl_devs)

# 2. Comet Lake Laptop: DDI A (eDP native panel), DDI B (HDMI)
cml_devs = [
    build_child_device_entry(0x01, 0x78C6, 0x0A, aux_channel=0x01, ddc_pin=0x01, hpd_pin=0x01),  # DDI A eDP
    build_child_device_entry(0x02, 0x60D2, 0x01, aux_channel=0x00, ddc_pin=0x02, hpd_pin=0x02),  # DDI B HDMI
    build_child_device_entry(0x00, 0x0000, 0x00),
]
create_vbt("samples/cml_laptop_vbt.bin", 0x0218, 228, False, cml_devs)

# 3. Kaby Lake NUC: DDI B (HDMI 2.0), DDI C (DP)
kbl_devs = [
    build_child_device_entry(0x01, 0x60D2, 0x01, aux_channel=0x00, ddc_pin=0x02, hpd_pin=0x02),  # DDI B HDMI
    build_child_device_entry(0x02, 0x68C6, 0x08, aux_channel=0x02, ddc_pin=0x03, hpd_pin=0x03),  # DDI C DP
]
create_vbt("samples/kbl_nuc_vbt.bin", 0x0200, 209, False, kbl_devs)

# 4. Block 0x28 child device config direct test
b28_devs = [
    build_child_device_entry(0x01, 0x68C6, 0x07, aux_channel=0x01, ddc_pin=0x01, hpd_pin=0x01),  # DDI B DP
    build_child_device_entry(0x02, 0x68D2, 0x02, aux_channel=0x00, ddc_pin=0x02, hpd_pin=0x02),  # DDI C DVI-D
]
create_vbt("samples/block28_direct_vbt.bin", 0x0216, 218, True, b28_devs, legacy_bdb_sig=True)

# 5. OEM Hardware VBT with Checksum 0xDC and "HIBI" string at 0xDC
create_vbt("samples/oem_checksum_dc_vbt.bin", 0x0216, 221, False, cfl_devs, simulate_checksum_dc=True)

# 6. Create sample OpenCore config.plist for merge testing
sample_plist = {
    "ACPI": {"Add": []},
    "Booter": {"Quirks": {}},
    "DeviceProperties": {
        "Add": {
            "PciRoot(0x0)/Pci(0x1b,0x0)": {"layout-id": bytes.fromhex("01000000")}
        }
    },
    "Kernel": {"Add": []},
    "Misc": {},
    "NVRAM": {"Add": {}},
    "PlatformInfo": {},
    "UEFI": {},
}
with open("samples/sample_config.plist", "wb") as f:
    plistlib.dump(sample_plist, f, fmt=plistlib.FMT_XML)
print("Created samples/sample_config.plist")
