/**
 * TypeScript VBT Parser and OpenCore Framebuffer Patch Generator
 * Implements the exact same parsing and Rosetta Stone mapping logic as vbt2opencore.py
 */

import { extractPcirDeviceId } from './igpuDatabase.ts';

export interface ParsedChildDevice {
  index: number;
  handle: number;
  deviceType: number;
  dvoPort: number;
  auxChannel: number;
  ddcPin: number;
  hpdPin: number;
  flags: number;
  intelPortName: string;
  connectorName: string;
  isActive: boolean;
  appleBusId: number;
  appleConType: number;
  appleConTypeHex: string;
  appleConTypeBase64: string;
  pipe: number;
}

export interface VBTParseResult {
  vbtOffset: number;
  vbtVersion: number;
  bdbOffset: number;
  bdbVersion: number;
  blocks: { id: number; name: string; size: number; offset: number }[];
  allDevices: ParsedChildDevice[];
  activeDevices: ParsedChildDevice[];
  stride: number;
  detectedPcirDeviceId?: string | null;
}

const DEFAULT_PIPES = [0x09, 0x0a, 0x08, 0x07];

const DVO_PORTS_MAP: Record<number, string> = {
  0x00: 'DDI A / HDMIA',
  0x01: 'DDI B / HDMIB',
  0x02: 'DDI C / HDMIC',
  0x03: 'DDI D / HDMID',
  0x04: 'LVDS',
  0x05: 'TV',
  0x06: 'CRT',
  0x07: 'DDI B / DPB',
  0x08: 'DDI C / DPC',
  0x09: 'DDI D / DPD',
  0x0a: 'DDI A / DPA / eDP',
  0x0b: 'DDI E / DPE',
  0x0c: 'DDI E / HDMIE',
  0x0d: 'DDI F / DPF',
  0x0e: 'DDI F / HDMIF',
};

const BDB_NAMES: Record<number, string> = {
  0x01: 'BDB_GENERAL_FEATURES',
  0x02: 'BDB_GENERAL_DEFINITIONS',
  0x03: 'BDB_DISPLAY_TOGGLE',
  0x04: 'BDB_MODE_SUPPORT_LIST',
  0x05: 'BDB_GENERIC_MODE_TABLE',
  0x06: 'BDB_EXT_MMIO_REGS',
  0x14: 'BDB_DRIVER_PERSISTENCE',
  0x28: 'BDB_CHILD_DEVICE_CONFIG',
  0x29: 'BDB_LFP_DATA_PTRS',
  0x2a: 'BDB_LFP_DATA',
  0x2b: 'BDB_LFP_BACKLIGHT',
};

export function parseVBT(buffer: Uint8Array): VBTParseResult {
  const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // 1. Locate $VBT Header
  let vbtOffset = -1;
  const needle = [0x24, 0x56, 0x42, 0x54]; // "$VBT"
  for (let i = 0; i <= buffer.length - 4; i++) {
    if (
      buffer[i] === needle[0] &&
      buffer[i + 1] === needle[1] &&
      buffer[i + 2] === needle[2] &&
      buffer[i + 3] === needle[3]
    ) {
      vbtOffset = i;
      break;
    }
  }

  if (vbtOffset === -1) {
    throw new Error('No $VBT signature found in binary (expected "$VBT" header)');
  }

  const vbtVersion = vbtOffset + 0x16 <= buffer.length ? dataView.getUint16(vbtOffset + 0x14, true) : 0;

  // 2. Locate BDB (BIOS Data Block) Offset and Signature
  // In standard Intel VBTs, bdb_offset is a uint32 at offset 0x1C.
  // In legacy/non-standard variants, it may be at offset 0x1A (uint16) or offset 0x16.
  const candidates: { desc: string; offset: number }[] = [];
  if (vbtOffset + 0x20 <= buffer.length) {
    const c32 = dataView.getUint32(vbtOffset + 0x1c, true);
    if (c32 > 0 && c32 < buffer.length) {
      candidates.push({ desc: '0x1C (uint32)', offset: vbtOffset + c32 });
    }
  }

  if (vbtOffset + 0x1c <= buffer.length) {
    const c16 = dataView.getUint16(vbtOffset + 0x1a, true);
    if (c16 > 0 && c16 < buffer.length) {
      candidates.push({ desc: '0x1A (uint16)', offset: vbtOffset + c16 });
    }
  }

  if (vbtOffset + 0x18 <= buffer.length) {
    const hs = dataView.getUint16(vbtOffset + 0x16, true);
    if (hs > 0 && hs < buffer.length) {
      candidates.push({ desc: '0x16 (header_size)', offset: vbtOffset + hs });
    }
  }

  const detectSig = (off: number): 'BIOS_DATA_BLOCK' | '$BDB' | 'BDB' | null => {
    if (off < 0 || off + 4 > buffer.length) return null;
    const chunkStr = String.fromCharCode(...buffer.slice(off, Math.min(off + 20, buffer.length)));
    if (chunkStr.startsWith('BIOS_DATA_BLOCK')) return 'BIOS_DATA_BLOCK';
    if (chunkStr.startsWith('$BDB') || chunkStr.startsWith('BDB ')) return '$BDB';
    if (chunkStr.startsWith('BDB') && chunkStr.length >= 10) return 'BDB';
    return null;
  };

  let resolvedBdbOffset: number | null = null;
  let sigType: 'BIOS_DATA_BLOCK' | '$BDB' | 'BDB' | null = null;

  for (const cand of candidates) {
    const st = detectSig(cand.offset);
    if (st) {
      resolvedBdbOffset = cand.offset;
      sigType = st;
      break;
    }
  }

  // Fallback scan across binary if candidate offsets did not locate signature
  if (resolvedBdbOffset === null) {
    const biosDataBlockBytes = [
      0x42, 0x49, 0x4f, 0x53, 0x5f, 0x44, 0x41, 0x54, 0x41, 0x5f, 0x42, 0x4c, 0x4f, 0x43, 0x4b,
    ]; // "BIOS_DATA_BLOCK"
    for (let i = 0; i <= buffer.length - biosDataBlockBytes.length; i++) {
      let match = true;
      for (let j = 0; j < biosDataBlockBytes.length; j++) {
        if (buffer[i + j] !== biosDataBlockBytes[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        resolvedBdbOffset = i;
        sigType = 'BIOS_DATA_BLOCK';
        break;
      }
    }
  }

  if (resolvedBdbOffset === null) {
    const bdbBytes = [0x24, 0x42, 0x44, 0x42]; // "$BDB"
    for (let i = 0; i <= buffer.length - 4; i++) {
      if (
        buffer[i] === bdbBytes[0] &&
        buffer[i + 1] === bdbBytes[1] &&
        buffer[i + 2] === bdbBytes[2] &&
        buffer[i + 3] === bdbBytes[3]
      ) {
        resolvedBdbOffset = i;
        sigType = '$BDB';
        break;
      }
    }
  }

  if (resolvedBdbOffset === null) {
    throw new Error('Could not locate a valid BDB header in VBT (expected "BIOS_DATA_BLOCK" or "$BDB" signature)');
  }

  const bdbOffset = resolvedBdbOffset;

  // Read BDB Version and Header/Total Size based on signature format
  let bdbVersion = 0;
  let bdbHeaderSize = 22;
  let bdbTotalSize = buffer.length - bdbOffset;

  if (sigType === 'BIOS_DATA_BLOCK') {
    // struct bdb_header: signature[16], version[2], header_size[2], bdb_size[2]
    bdbVersion = bdbOffset + 18 <= buffer.length ? dataView.getUint16(bdbOffset + 16, true) : 0;
    const rawHdr = bdbOffset + 20 <= buffer.length ? dataView.getUint16(bdbOffset + 18, true) : 22;
    const rawTotal = bdbOffset + 22 <= buffer.length ? dataView.getUint16(bdbOffset + 20, true) : buffer.length - bdbOffset;
    bdbHeaderSize = rawHdr >= 16 && rawHdr <= 64 ? rawHdr : 22;
    bdbTotalSize = rawTotal > bdbHeaderSize ? rawTotal : buffer.length - bdbOffset;
  } else {
    // Short $BDB header: signature[4], version[2], header_size[2], bdb_size[2]
    bdbVersion = bdbOffset + 6 <= buffer.length ? dataView.getUint16(bdbOffset + 4, true) : 0;
    const rawHdr = bdbOffset + 8 <= buffer.length ? dataView.getUint16(bdbOffset + 6, true) : 16;
    const rawTotal = bdbOffset + 10 <= buffer.length ? dataView.getUint16(bdbOffset + 8, true) : buffer.length - bdbOffset;
    bdbHeaderSize = rawHdr >= 4 && rawHdr <= 64 ? rawHdr : 16;
    bdbTotalSize = rawTotal > bdbHeaderSize ? rawTotal : buffer.length - bdbOffset;
  }

  // 3. Walk BDB Blocks
  let currOffset = bdbOffset + bdbHeaderSize;
  const bdbEnd = Math.min(bdbOffset + bdbTotalSize, buffer.length);
  const blocks: { id: number; name: string; size: number; offset: number }[] = [];
  const blockMap = new Map<number, Uint8Array>();

  while (currOffset + 3 <= bdbEnd) {
    const blockId = buffer[currOffset];
    const blockSize = dataView.getUint16(currOffset + 1, true);
    if (blockSize === 0) break;
    const blockStart = currOffset + 3;
    const blockEnd = Math.min(blockStart + blockSize, buffer.length);

    const blockData = buffer.slice(blockStart, blockEnd);
    blockMap.set(blockId, blockData);
    blocks.push({
      id: blockId,
      name: BDB_NAMES[blockId] || `Block 0x${blockId.toString(16).padStart(2, '0').toUpperCase()}`,
      size: blockSize,
      offset: currOffset,
    });

    currOffset = blockStart + blockSize;
  }

  // 4. Locate Child Device Config Block
  // In real Intel VBTs, Block 0x02 (BDB_GENERAL_DEFINITIONS) contains the child device array.
  // In synthetic/custom VBTs, Block 0x28 (BDB_CHILD_DEVICE_CONFIG) may contain them directly.
  const b2Data = blockMap.get(0x02);
  const b28Data = blockMap.get(0x28);

  const countDevices = (data?: Uint8Array, hasHdr = false): number => {
    if (!data) return 0;
    const payloadBytes = hasHdr && data.length >= 5 ? data.slice(5) : data;
    const st = hasHdr && data.length >= 5 && [33, 37, 38, 39, 40].includes(data[4]) ? data[4] : 40;
    return Math.floor(payloadBytes.length / st);
  };

  const b2Count = b2Data && b2Data.length >= 5 ? countDevices(b2Data, true) : 0;
  const b28Count = b28Data && b28Data.length >= 20 ? countDevices(b28Data, false) : 0;

  let targetBlockData: Uint8Array | null = null;
  let hasGeneralHeader = false;

  if (b2Count > 0) {
    targetBlockData = b2Data!;
    hasGeneralHeader = true;
  } else if (b28Count > 0) {
    targetBlockData = b28Data!;
    hasGeneralHeader = false;
  } else if (b2Data) {
    targetBlockData = b2Data;
    hasGeneralHeader = true;
  } else if (b28Data) {
    targetBlockData = b28Data;
    hasGeneralHeader = false;
  } else {
    throw new Error('Neither Block 0x02 (General Definitions) nor Block 0x28 (Child Devices) was found in BDB');
  }

  // 5. Detect Stride and Parse Entries
  let stride = 40;
  let payload = targetBlockData;

  if (hasGeneralHeader && targetBlockData.length >= 5) {
    const cand = targetBlockData[4];
    if ([33, 37, 38, 39, 40].includes(cand)) {
      stride = cand;
    }
    payload = targetBlockData.slice(5);
  } else {
    if (targetBlockData.length >= 5 && [33, 37, 38, 39, 40].includes(targetBlockData[4])) {
      const cand = targetBlockData[4];
      if ((targetBlockData.length - 5) % cand === 0) {
        stride = cand;
        payload = targetBlockData.slice(5);
      } else {
        stride = detectStride(targetBlockData);
      }
    } else {
      stride = detectStride(targetBlockData);
    }
  }

  const allDevices: ParsedChildDevice[] = [];
  const activeDevices: ParsedChildDevice[] = [];
  const numEntries = Math.floor(payload.length / stride);

  let activeIndex = 0;
  for (let i = 0; i < numEntries; i++) {
    const entry = payload.slice(i * stride, (i + 1) * stride);
    if (entry.length < 20) continue;
    const entryView = new DataView(entry.buffer, entry.byteOffset, entry.byteLength);

    const handle = entryView.getUint16(0, true);
    const deviceType = entryView.getUint16(2, true);
    const dvoPort = entry.length > 16 ? entry[16] : 0;
    const ddcPin = entry.length > 19 ? entry[19] : 0;
    const auxChannel = entry.length > 23 ? entry[23] : 0;
    const hpdPin = entry.length > 27 ? entry[27] : 0;
    const flags = entry.length > 28 ? entry[28] : 0;

    const intelPortName = resolveIntelPort(dvoPort);
    const connectorName = resolveConnectorType(deviceType, dvoPort);
    const isActive = checkIsActive(deviceType, dvoPort);
    const appleBusId = resolveAppleBusId(intelPortName);
    const appleConType = resolveAppleConType(connectorName);

    // Format apple connector type using Little-Endian struct.pack('<I', appleConType)
    const conTypeBytes = new Uint8Array([
      appleConType & 0xff,
      (appleConType >>> 8) & 0xff,
      (appleConType >>> 16) & 0xff,
      (appleConType >>> 24) & 0xff,
    ]);
    const conTypeHex = `<${Array.from(conTypeBytes).map((b) => b.toString(16).padStart(2, '0')).join('')}>`;
    const appleConTypeBase64 = btoa(String.fromCharCode(...conTypeBytes));

    const pipe = activeIndex < DEFAULT_PIPES.length ? DEFAULT_PIPES[activeIndex] : 0x07;

    const devObj: ParsedChildDevice = {
      index: i,
      handle,
      deviceType,
      dvoPort,
      auxChannel,
      ddcPin,
      hpdPin,
      flags,
      intelPortName,
      connectorName,
      isActive,
      appleBusId,
      appleConType,
      appleConTypeHex: conTypeHex,
      appleConTypeBase64,
      pipe,
    };

    allDevices.push(devObj);
    if (isActive) {
      activeDevices.push({
        ...devObj,
        index: activeIndex,
      });
      activeIndex++;
    }
  }

  const pcir = extractPcirDeviceId(buffer);
  const detectedPcirDeviceId = pcir ? pcir.deviceIdHex : null;

  return {
    vbtOffset,
    vbtVersion,
    bdbOffset,
    bdbVersion,
    blocks,
    allDevices,
    activeDevices,
    stride,
    detectedPcirDeviceId,
  };
}

function detectStride(data: Uint8Array): number {
  const candidates = [40, 37, 38, 33];
  let best = 40;
  let maxScore = -1;

  for (const s of candidates) {
    if (data.length < s) continue;
    const count = Math.floor(data.length / s);
    let score = 0;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    for (let i = 0; i < Math.min(count, 8); i++) {
      const offset = i * s;
      if (offset + 18 > data.length) continue;
      const dtype = view.getUint16(offset + 2, true);
      const port = data[offset + 16];
      if (dtype !== 0 && dtype !== 0xffff) score += 2;
      if (DVO_PORTS_MAP[port]) score += 3;
    }

    if (score > maxScore) {
      maxScore = score;
      best = s;
    }
  }

  return best;
}

function resolveIntelPort(p: number): string {
  if (p === 0x00 || p === 0x0a) return 'DDI A';
  if (p === 0x01 || p === 0x07) return 'DDI B';
  if (p === 0x02 || p === 0x08) return 'DDI C';
  if (p === 0x03 || p === 0x09) return 'DDI D';
  if (p === 0x0b || p === 0x0c || p === 0x05) return 'DDI E';
  if (p === 0x0d || p === 0x0e) return 'DDI F';
  if (p === 0x04) return 'LVDS';
  if (p === 0x06) return 'CRT';
  return `Port 0x${p.toString(16).padStart(2, '0').toUpperCase()}`;
}

function resolveConnectorType(dt: number, p: number): string {
  // eDP / internal checks
  if ([0x78c6, 0x78d6, 0x1806, 0x0400, 0x0100].includes(dt) || (dt & 0x0100 && dt & (0x0800 | 0x1000))) {
    return 'eDP';
  }
  if ((p === 0x04 || p === 0x0a) && (dt & (0x0800 | 0x0100 | 0x1000))) {
    return 'eDP';
  }

  // DisplayPort
  if ([0x68c6, 0x1404, 0x1406, 0x1804].includes(dt) || (dt & 0x1000)) {
    return 'DP';
  }

  // HDMI / DVI-D / TMDS
  if ([0x60d2, 0x60d6, 0x68d2, 0x1004, 0x1006, 0x1202].includes(dt) || (dt & 0x0400)) {
    if (dt === 0x68d2) return 'DVI-D';
    if (dt === 0x60d6) return 'DP++';
    return 'HDMI';
  }

  if ([0x07, 0x08, 0x09, 0x0b, 0x0d].includes(p)) return 'DP';
  if ([0x00, 0x01, 0x02, 0x03, 0x0c, 0x0e].includes(p)) return 'HDMI';

  return 'DP';
}

function checkIsActive(dt: number, p: number): boolean {
  if (dt === 0x0000 || dt === 0xffff || p === 0xff) return false;
  if (p === 0x06 && !(dt & 0x0020)) return false;
  return true;
}

function resolveAppleBusId(portName: string): number {
  if (portName.includes('DDI A') || portName.includes('LVDS')) return 0x00;
  if (portName.includes('DDI B')) return 0x05;
  if (portName.includes('DDI C')) return 0x04;
  if (portName.includes('DDI D')) return 0x06;
  if (portName.includes('DDI E')) return 0x01;
  if (portName.includes('DDI F')) return 0x02;
  return 0x00;
}

function resolveAppleConType(connector: string): number {
  if (connector === 'eDP') return 0x00020000;
  if (['HDMI', 'DVI-D', 'DP++'].includes(connector)) return 0x00080000;
  return 0x00040000;
}

export interface OpenCoreXmlOptions {
  firstConIndex?: number;
  unifiedmem?: boolean;
  rpsControl?: boolean;
  backlightFix?: boolean;
  targetMacos?: string;
  lspconMode?: 'pcon' | 'ls' | '';
  mobileMode?: boolean;
  conFlags?: string;
  fbFlags?: string;
  pipeOverride?: number;
}

export function generateOpenCoreXml(
  activeDevices: ParsedChildDevice[],
  platformIdHex: string,
  spoofDeviceIdHex?: string | null,
  options?: OpenCoreXmlOptions
): string {
  const {
    firstConIndex,
    unifiedmem = true,
    rpsControl = true,
    backlightFix = false,
    targetMacos = '14.0',
    lspconMode = '',
    mobileMode = false,
    conFlags,
    fbFlags,
    pipeOverride,
  } = options || {};

  // Clean and prepare platform-id
  const cleanPid = platformIdHex.replace(/[^0-9A-Fa-f]/g, '');
  const pidBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const byteHex = cleanPid.substring(i * 2, i * 2 + 2);
    pidBytes[i] = parseInt(byteHex || '00', 16);
  }
  const pidBase64 = btoa(String.fromCharCode(...pidBytes));

  const lines: string[] = [];
  lines.push('<key>DeviceProperties</key>');
  lines.push('<dict>');
  lines.push('\t<key>Add</key>');
  lines.push('\t<dict>');
  lines.push('\t\t<key>PciRoot(0x0)/Pci(0x2,0x0)</key>');
  lines.push('\t\t<dict>');

  // AAPL,ig-platform-id
  lines.push(`\t\t\t<key>AAPL,ig-platform-id</key>`);
  lines.push(`\t\t\t<data>${pidBase64}</data> <!-- <${cleanPid}> -->`);

  // device-id spoof if requested
  if (spoofDeviceIdHex) {
    const cleanSpoof = spoofDeviceIdHex.replace(/[^0-9A-Fa-f]/g, '').padStart(4, '0').toUpperCase();
    const b0 = parseInt(cleanSpoof.substring(2, 4), 16);
    const b1 = parseInt(cleanSpoof.substring(0, 2), 16);
    const spoofBytes = new Uint8Array([b0, b1, 0, 0]);
    const spoofBase64 = btoa(String.fromCharCode(...spoofBytes));
    const spoofHex = `${cleanSpoof.substring(2, 4).toLowerCase()}${cleanSpoof.substring(0, 2).toLowerCase()}0000`;
    lines.push(`\t\t\t<key>device-id</key>`);
    lines.push(`\t\t\t<data>${spoofBase64}</data> <!-- <${spoofHex}> -->`);
  }

  // framebuffer-patch-enable
  lines.push(`\t\t\t<key>framebuffer-patch-enable</key>`);
  lines.push(`\t\t\t<data>AQAAAA==</data> <!-- <01000000> -->`);

  // Mobile mode portcount
  if (mobileMode) {
    lines.push(`\t\t\t<key>framebuffer-portcount</key>`);
    lines.push(`\t\t\t<data>AwAAAA==</data> <!-- <03000000> (laptop 3 ports) -->`);
  }

  // Framebuffer custom flags
  if (fbFlags) {
    const num = parseInt(fbFlags.replace(/^0x/i, ''), 16);
    if (!isNaN(num)) {
      const fbBytes = new Uint8Array([num & 0xff, (num >>> 8) & 0xff, (num >>> 16) & 0xff, (num >>> 24) & 0xff]);
      lines.push(`\t\t\t<key>framebuffer-flags</key>`);
      lines.push(`\t\t\t<data>${btoa(String.fromCharCode(...fbBytes))}</data> <!-- 0x${num.toString(16).toUpperCase()} -->`);
    }
  }

  // Connector starting index: 0 if has internal panel, else 1
  const hasInternalPanel = activeDevices.some((d) => d.appleConType === 0x00020000);
  const startIdx = firstConIndex !== undefined ? firstConIndex : (hasInternalPanel ? 0 : 1);
  const devicesToPatch = mobileMode ? activeDevices.slice(0, 3) : activeDevices;

  let hasAnyLspcon = false;

  devicesToPatch.forEach((dev, idx) => {
    const conNum = startIdx + idx;
    const con = `con${conNum}`;

    // Bus ID little-endian
    const busIdBytes = new Uint8Array([dev.appleBusId, 0, 0, 0]);
    const busIdBase64 = btoa(String.fromCharCode(...busIdBytes));
    const busIdHex = `${dev.appleBusId.toString(16).padStart(2, '0')}000000`;

    // Type little-endian matching struct.pack('<I', dev.appleConType)
    const typeBytes = new Uint8Array([
      dev.appleConType & 0xff,
      (dev.appleConType >>> 8) & 0xff,
      (dev.appleConType >>> 16) & 0xff,
      (dev.appleConType >>> 24) & 0xff,
    ]);
    const typeBase64 = btoa(String.fromCharCode(...typeBytes));
    const typeHex = Array.from(typeBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

    // Pipe little-endian
    const pipeVal = pipeOverride !== undefined ? pipeOverride : (idx < DEFAULT_PIPES.length ? DEFAULT_PIPES[idx] : 0x07);
    const pipeBytes = new Uint8Array([pipeVal, 0, 0, 0]);
    const pipeBase64 = btoa(String.fromCharCode(...pipeBytes));
    const pipeHex = `${pipeVal.toString(16).padStart(2, '0')}000000`;

    lines.push(`\t\t\t<key>framebuffer-${con}-enable</key>`);
    lines.push(`\t\t\t<data>AQAAAA==</data> <!-- <01000000> -->`);

    lines.push(`\t\t\t<key>framebuffer-${con}-busid</key>`);
    lines.push(`\t\t\t<data>${busIdBase64}</data> <!-- <${busIdHex}> -->`);

    lines.push(`\t\t\t<key>framebuffer-${con}-type</key>`);
    lines.push(`\t\t\t<data>${typeBase64}</data> <!-- <${typeHex}> -->`);

    lines.push(`\t\t\t<key>framebuffer-${con}-pipe</key>`);
    lines.push(`\t\t\t<data>${pipeBase64}</data> <!-- <${pipeHex}> -->`);

    // Connector custom flags
    if (conFlags && dev.appleConType !== 0x00020000) {
      const cNum = parseInt(conFlags.replace(/^0x/i, ''), 16);
      if (!isNaN(cNum)) {
        const cBytes = new Uint8Array([cNum & 0xff, (cNum >>> 8) & 0xff, (cNum >>> 16) & 0xff, (cNum >>> 24) & 0xff]);
        lines.push(`\t\t\t<key>framebuffer-${con}-flags</key>`);
        lines.push(`\t\t\t<data>${btoa(String.fromCharCode(...cBytes))}</data> <!-- 0x${cNum.toString(16).toUpperCase()} -->`);
      }
    }

    // LSPCON detection
    const isLspcon = Boolean(dev.flags && (dev.flags & 0x04));
    if (isLspcon) {
      hasAnyLspcon = true;
      lines.push(`\t\t\t<key>framebuffer-${con}-has-lspcon</key>`);
      lines.push(`\t\t\t<data>AQAAAA==</data> <!-- <01000000> -->`);
      if (lspconMode === 'pcon') {
        lines.push(`\t\t\t<key>framebuffer-${con}-preferred-lspcon-mode</key>`);
        lines.push(`\t\t\t<data>AQAAAA==</data> <!-- <01000000> (PCON mode: DP to HDMI 2.0) -->`);
      } else if (lspconMode === 'ls') {
        lines.push(`\t\t\t<key>framebuffer-${con}-preferred-lspcon-mode</key>`);
        lines.push(`\t\t\t<data>AAAAAA==</data> <!-- <00000000> (Level Shifter mode: HDMI 1.4) -->`);
      }
    }
  });

  if (hasAnyLspcon) {
    lines.push(`\t\t\t<key>enable-lspcon-support</key>`);
    lines.push(`\t\t\t<data>AQAAAA==</data> <!-- <01000000> -->`);
  }

  // Backlight register fix
  if (backlightFix) {
    const isSonomaOrLater = parseFloat(targetMacos) >= 13.4;
    const propName = isSonomaOrLater ? 'enable-backlight-registers-alternative-fix' : 'enable-backlight-registers-fix';
    lines.push(`\t\t\t<key>${propName}</key>`);
    lines.push(`\t\t\t<data>AQAAAA==</data> <!-- <01000000> (${targetMacos >= '13.4' ? 'macOS 13.4+ fix' : 'standard fix'}) -->`);
  }

  if (unifiedmem) {
    lines.push(`\t\t\t<key>framebuffer-unifiedmem</key>`);
    lines.push(`\t\t\t<data>AAAAgA==</data> <!-- <00000080> (DVMT 2048MB) -->`);
  }
  if (rpsControl) {
    lines.push(`\t\t\t<key>rps-control</key>`);
    lines.push(`\t\t\t<data>AQAAAA==</data> <!-- <01000000> -->`);
  }

  lines.push('\t\t</dict>');
  lines.push('\t</dict>');
  lines.push('</dict>');

  return lines.join('\n');
}

export function generateAsciiTable(activeDevices: ParsedChildDevice[]): string {
  const headers = ['Index', 'Intel Port', 'DVO Port', 'Connector', 'Apple Bus ID', 'macOS Type (Hex)', 'Pipe'];
  const rows = activeDevices.map((dev, idx) => {
    const pipe = idx < DEFAULT_PIPES.length ? DEFAULT_PIPES[idx] : 0x07;
    return [
      `con${idx}`,
      dev.intelPortName,
      `0x${dev.dvoPort.toString(16).padStart(2, '0').toUpperCase()}`,
      dev.connectorName,
      `0x${dev.appleBusId.toString(16).padStart(2, '0').toUpperCase()}`,
      dev.appleConTypeHex,
      `${pipe} (0x${pipe.toString(16).padStart(2, '0').toUpperCase()})`,
    ];
  });

  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]?.length || 0)));

  const makeSep = (ch: string, cross: string) => cross + colWidths.map((w) => ch.repeat(w + 2)).join(cross) + cross;

  const lines: string[] = [];
  lines.push(makeSep('-', '+'));
  lines.push('| ' + headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ') + ' |');
  lines.push(makeSep('=', '+'));

  if (rows.length === 0) {
    const totalW = colWidths.reduce((a, b) => a + b, 0) + (colWidths.length - 1) * 3;
    lines.push('| ' + 'No active physical display connectors detected'.padEnd(totalW) + ' |');
  } else {
    rows.forEach((r) => {
      lines.push('| ' + r.map((c, i) => c.padEnd(colWidths[i])).join(' | ') + ' |');
    });
  }

  lines.push(makeSep('-', '+'));
  return lines.join('\n');
}
