"""
igpu_database.py - Compatibility bridge mapping to vbt2fbpatch (v3.4.0)

Maintains full backward-compatibility for test suites and existing consumers
while routing to the authoritative vbt2fbpatch implementation.
"""

import struct
from typing import Dict, Optional, Tuple, Any
import vbt2fbpatch
from vbt2fbpatch import (
    CompatibilityStatus,
    FormFactor,
    PlatformProfile,
    SpoofMapping,
    IGPUDevice,
    INTEL_IGPU_DATABASE,
    KNOWN_PLATFORM_IDS,
    FRAMEBUFFER_DUMPS,
    FRAMEBUFFER_FLAG_NAMES,
    CONNECTOR_FLAG_NAMES,
    VBTParser,
    resolve_igpu,
    pack_u32_le,
    byteswap32,
    parse_device_id,
    parse_platform_id,
    parse_macos_version,
    generate_opencore_patch,
    merge_into_plist,
)

# Alias for byte packing
def pack_uint32_le(val: int) -> bytes:
    return struct.pack('<I', val)

def is_version_ge(v1: str, v2: str) -> bool:
    return parse_macos_version(v1) >= parse_macos_version(v2)

def is_version_le(v1: str, v2: str) -> bool:
    return parse_macos_version(v1) <= parse_macos_version(v2)

def pci_id_to_doc_hex(pci_hex: str) -> str:
    val = int(pci_hex, 16)
    return f"{(val & 0xFF):02X}{(val >> 8):02X}0000"

def serialize_doc_hex(doc_hex: str) -> bytes:
    val = int(doc_hex, 16)
    return struct.pack('<I', val)

def serialize_pci_device_id(pci_hex: str) -> bytes:
    val = int(pci_hex, 16)
    return struct.pack('<I', val)

def serialize_platform_id(platform_hex: str) -> bytes:
    val = int(platform_hex, 16)
    return struct.pack('<I', val)

CON_TYPE_BYTES = {
    "eDP": bytes.fromhex("00020000"),
    "DP": bytes.fromhex("00040000"),
    "HDMI": bytes.fromhex("00080000"),
    "DVI": bytes.fromhex("00080000"),
    "LVDS": bytes.fromhex("02000000"),
}

CON_TYPE_EDP_DOC = "00020000"
CON_TYPE_DP_DOC = "00040000"
CON_TYPE_HDMI_DOC = "00080000"
CON_TYPE_LVDS_DOC = "02000000"

class ResolutionResultBridge:
    def __init__(self, res: Any):
        self._res = res
        self.status = res.status
        self.is_spoof_needed = (res.status == CompatibilityStatus.NEEDS_SPOOF)
        self.target_spoof_pci_id = f"{res.spoof_target:04X}" if res.spoof_target else None
        self.doc_spoof_hex = pci_id_to_doc_hex(self.target_spoof_pci_id) if self.target_spoof_pci_id else None
        self.effective_platform_id_le_hex = f"{res.platform_id_bytes.hex().upper()}" if res.platform_id_bytes else None
        self.effective_platform_id_bytes = res.platform_id_bytes
        self.spoof_bytes = res.spoof_bytes
        self.recommended_boot_args = "-igfxsklaskbl" if (res.model and "Skylake" in res.model.architecture and res.spoof_target) else None

def resolve_igpu_compatibility(
    device_id_str: str,
    target_macos: str = "14.0",
    form_factor_str: str = "desktop",
    platform_id_str: Optional[str] = None,
    spoof_id_str: Optional[str] = None,
) -> ResolutionResultBridge:
    dev_id = parse_device_id(device_id_str)
    ff = FormFactor(form_factor_str)
    res = resolve_igpu(dev_id, target_macos, ff, platform_id_str, spoof_id_str)
    return ResolutionResultBridge(res)

SPOOF_MAPPINGS = {
    "9BC8": {"target": "3E9B", "arch": "Comet Lake Desktop"},
    "9BC5": {"target": "3E9B", "arch": "Comet Lake Desktop"},
    "9BC4": {"target": "3E9B", "arch": "Comet Lake Mobile"},
    "9B41": {"target": "3E9B", "arch": "Comet Lake Mobile"},
    "3EA5": {"target": "3EA5", "arch": "Whiskey Lake Mobile"},
    "041E": {"target": "0412", "arch": "Haswell Desktop"},
    "0416": {"target": "0412", "arch": "Haswell Mobile"},
    "0A16": {"target": "0412", "arch": "Haswell Mobile ULT"},
}
