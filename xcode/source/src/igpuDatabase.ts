/**
 * Comprehensive Intel iGPU Database & WhateverGreen Compatibility / Spoofing Engine
 * Covers Gen7.5 (Haswell) through Gen12+ (Alder/Raptor Lake).
 */

export type IgpuSupportStatus = 'native' | 'needs_spoof' | 'legacy_ventura' | 'unsupported';

export interface IgpuModel {
  deviceId: string; // 4-char hex in uppercase, e.g. "9BC8", "3E9B"
  name: string;
  generation: string;
  series: 'desktop' | 'mobile' | 'nuc' | 'server';
  architecture: string;
  status: IgpuSupportStatus;
  statusDescription: string;
  recommendedPlatformId: string; // e.g. "07009B3E"
  recommendedSpoofDeviceId?: string; // e.g. "3E9B"
  recommendedBootArgs?: string;
  notes: string;
  macosVersionSupport: string; // e.g. "10.14 - 15.x" or "Unsupported"
}

export interface IgpuAnalysisResult {
  detectedOrSelected: IgpuModel;
  isSpoofRecommended: boolean;
  effectivePlatformId: string;
  effectiveSpoofDeviceId: string | null;
  platformIdBase64: string;
  spoofDeviceIdBase64: string | null;
  spoofDeviceIdHexLE: string | null; // e.g. "9B3E0000"
  recommendedBootArgs: string | null;
  recommendedProperties: Record<string, { hex: string; base64: string; comment: string }>;
  warnings: string[];
}

// -----------------------------------------------------------------------------
// Known Intel iGPU Database
// -----------------------------------------------------------------------------

export const IGPU_DATABASE: Record<string, IgpuModel> = {
  // === Comet Lake (10th Gen, 14nm) ===
  '9BC8': {
    deviceId: '9BC8',
    name: 'Intel UHD Graphics 630 (Comet Lake-S Desktop)',
    generation: '10th Gen Comet Lake',
    series: 'desktop',
    architecture: 'Gen9.5',
    status: 'needs_spoof',
    statusDescription: 'Requires WhateverGreen device-id spoof to Coffee Lake (0x3E9B) for full QE/CI hardware acceleration.',
    recommendedPlatformId: '07009B3E',
    recommendedSpoofDeviceId: '3E9B',
    macosVersionSupport: 'macOS 10.15.4 - 15.x (Sequoia)',
    notes: 'Common in desktop Core i5-10400, i7-10700, i9-10900. Spoof to 3E9B allows native CFL driver binding.',
  },
  '9BC5': {
    deviceId: '9BC5',
    name: 'Intel UHD Graphics 630 (Comet Lake Desktop v2)',
    generation: '10th Gen Comet Lake',
    series: 'desktop',
    architecture: 'Gen9.5',
    status: 'needs_spoof',
    statusDescription: 'Requires WhateverGreen device-id spoof to Coffee Lake (0x3E9B).',
    recommendedPlatformId: '07009B3E',
    recommendedSpoofDeviceId: '3E9B',
    macosVersionSupport: 'macOS 10.15.4 - 15.x (Sequoia)',
    notes: 'Found in Core i5-10600K, i7-10700K. Spoof to 3E9B is required on macOS Catalina, Big Sur, Monterey, Ventura, Sonoma.',
  },
  '9BC4': {
    deviceId: '9BC4',
    name: 'Intel UHD Graphics 630 (Comet Lake GT2)',
    generation: '10th Gen Comet Lake',
    series: 'desktop',
    architecture: 'Gen9.5',
    status: 'needs_spoof',
    statusDescription: 'Requires WhateverGreen device-id spoof to 0x3E9B.',
    recommendedPlatformId: '07009B3E',
    recommendedSpoofDeviceId: '3E9B',
    macosVersionSupport: 'macOS 10.15.4 - 15.x (Sequoia)',
    notes: 'Comet Lake desktop variant requiring Coffee Lake spoof.',
  },
  '9B41': {
    deviceId: '9B41',
    name: 'Intel UHD Graphics 630 (Comet Lake-H Mobile)',
    generation: '10th Gen Comet Lake',
    series: 'mobile',
    architecture: 'Gen9.5',
    status: 'needs_spoof',
    statusDescription: 'Mobile Comet Lake laptop iGPU. Needs spoof to 0x3E9B with mobile framebuffer 0x0900A53E or 0x00009B3E.',
    recommendedPlatformId: '0900A53E',
    recommendedSpoofDeviceId: '3E9B',
    macosVersionSupport: 'macOS 10.15.4 - 15.x (Sequoia)',
    notes: 'Equipped in Core i7-10750H, i7-10875H, i5-10300H (Dell XPS, Lenovo Legion, HP Omen, Razer Blade).',
  },
  '9BA4': {
    deviceId: '9BA4',
    name: 'Intel UHD Graphics 620 (Comet Lake-U Mobile)',
    generation: '10th Gen Comet Lake',
    series: 'mobile',
    architecture: 'Gen9.5',
    status: 'needs_spoof',
    statusDescription: 'Requires device-id spoof to 0x3E9B or 0x5917.',
    recommendedPlatformId: '0900A53E',
    recommendedSpoofDeviceId: '3E9B',
    macosVersionSupport: 'macOS 10.15.4 - 15.x (Sequoia)',
    notes: 'Common in Core i7-10510U, i5-10210U ultrabooks.',
  },
  '9BCA': {
    deviceId: '9BCA',
    name: 'Intel UHD Graphics 630 (Comet Lake-S Server / Xeon W)',
    generation: '10th Gen Comet Lake',
    series: 'server',
    architecture: 'Gen9.5',
    status: 'needs_spoof',
    statusDescription: 'Xeon W-1200 series graphics; spoof to 0x3E9B.',
    recommendedPlatformId: '07009B3E',
    recommendedSpoofDeviceId: '3E9B',
    macosVersionSupport: 'macOS 10.15.4 - 15.x (Sequoia)',
    notes: 'Found in workstation prebuilts with Xeon W-1290 / W-1270.',
  },
  '9BA5': {
    deviceId: '9BA5',
    name: 'Intel UHD Graphics 610 (Comet Lake GT1 Pentium/Celeron)',
    generation: '10th Gen Comet Lake',
    series: 'desktop',
    architecture: 'Gen9.5 (GT1)',
    status: 'needs_spoof',
    statusDescription: 'GT1 12-EU processor graphics. Requires spoofing to GT2 (0x3E9B or 0x3E92), though QE/CI may have glitches.',
    recommendedPlatformId: '07009B3E',
    recommendedSpoofDeviceId: '3E9B',
    macosVersionSupport: 'macOS 10.15 - 15.x (Limited QE/CI)',
    notes: 'Pentium G6400, Celeron G5900. GT1 lacks native macOS shader optimizations.',
  },

  // === Coffee Lake & Coffee Lake Refresh (8th/9th Gen, 14nm) ===
  '3E9B': {
    deviceId: '3E9B',
    name: 'Intel UHD Graphics 630 (Coffee Lake-H Mobile)',
    generation: '8th/9th Gen Coffee Lake',
    series: 'mobile',
    architecture: 'Gen9.5',
    status: 'native',
    statusDescription: 'Natively supported in macOS. Apple golden reference for CFL mobile graphics (MacBookPro15,1 / 16,1).',
    recommendedPlatformId: '00009B3E',
    macosVersionSupport: 'macOS 10.13.6 - 15.x (Sequoia)',
    notes: 'Core i7-8750H, i7-9750H, i9-9880H. Also serves as primary WhateverGreen spoof target.',
  },
  '3E92': {
    deviceId: '3E92',
    name: 'Intel UHD Graphics 630 (Coffee Lake Desktop)',
    generation: '8th/9th Gen Coffee Lake',
    series: 'desktop',
    architecture: 'Gen9.5',
    status: 'native',
    statusDescription: 'Natively supported in macOS. Apple golden reference for CFL desktop graphics (iMac19,1 / Macmini8,1).',
    recommendedPlatformId: '07009B3E',
    macosVersionSupport: 'macOS 10.13.6 - 15.x (Sequoia)',
    notes: 'Core i7-8700, i5-8400, i3-8100, i7-9700, i9-9900.',
  },
  '3E98': {
    deviceId: '3E98',
    name: 'Intel UHD Graphics 630 (Coffee Lake Refresh Desktop 9th Gen)',
    generation: '9th Gen Coffee Lake-R',
    series: 'desktop',
    architecture: 'Gen9.5',
    status: 'native',
    statusDescription: 'Natively recognized in macOS Mojave 10.14.4+ and later.',
    recommendedPlatformId: '07009B3E',
    macosVersionSupport: 'macOS 10.14.4 - 15.x (Sequoia)',
    notes: 'Core i9-9900K, i7-9700K, i5-9600K.',
  },
  '3E91': {
    deviceId: '3E91',
    name: 'Intel UHD Graphics 630 (Coffee Lake Desktop Stepping 0)',
    generation: '8th Gen Coffee Lake',
    series: 'desktop',
    architecture: 'Gen9.5',
    status: 'native',
    statusDescription: 'Natively supported in macOS.',
    recommendedPlatformId: '07009B3E',
    macosVersionSupport: 'macOS 10.13.6 - 15.x (Sequoia)',
    notes: 'Core i3-8100 desktop variant.',
  },
  '3EA0': {
    deviceId: '3EA0',
    name: 'Intel UHD Graphics 620 (Whiskey Lake Mobile)',
    generation: '8th Gen Whiskey Lake',
    series: 'mobile',
    architecture: 'Gen9.5',
    status: 'needs_spoof',
    statusDescription: 'Supported via spoof to 0x3E9B or 0x5916.',
    recommendedPlatformId: '0900A53E',
    recommendedSpoofDeviceId: '3E9B',
    macosVersionSupport: 'macOS 10.14 - 15.x (Sequoia)',
    notes: 'Core i5-8265U, i7-8565U.',
  },
  '3EA5': {
    deviceId: '3EA5',
    name: 'Intel Iris Plus Graphics 655 (Coffee Lake-U 28W)',
    generation: '8th Gen Coffee Lake',
    series: 'mobile',
    architecture: 'Gen9.5 (128MB eDRAM)',
    status: 'native',
    statusDescription: 'Native macOS support (MacBookPro15,2).',
    recommendedPlatformId: '0000A53E',
    macosVersionSupport: 'macOS 10.13.6 - 15.x (Sequoia)',
    notes: 'Core i7-8559U, i5-8259U (Mac mini & MacBook Pro 13").',
  },
  '3E90': {
    deviceId: '3E90',
    name: 'Intel UHD Graphics 610 (Coffee Lake GT1 Pentium)',
    generation: '8th/9th Gen Coffee Lake',
    series: 'desktop',
    architecture: 'Gen9.5 (GT1)',
    status: 'needs_spoof',
    statusDescription: 'GT1 graphics. Spoof to 0x3E92 or 0x3E9B.',
    recommendedPlatformId: '07009B3E',
    recommendedSpoofDeviceId: '3E92',
    macosVersionSupport: 'macOS 10.14 - 15.x (Limited QE/CI)',
    notes: 'Pentium Gold G5400, Celeron G4900.',
  },

  // === Kaby Lake (7th Gen, 14nm) ===
  '5912': {
    deviceId: '5912',
    name: 'Intel HD Graphics 630 (Kaby Lake Desktop)',
    generation: '7th Gen Kaby Lake',
    series: 'desktop',
    architecture: 'Gen9.5',
    status: 'native',
    statusDescription: 'Natively supported in macOS (iMac18,2 / iMac18,3).',
    recommendedPlatformId: '00001659',
    macosVersionSupport: 'macOS 10.12.6 - 15.x (Sequoia)',
    notes: 'Core i7-7700K, i5-7600K.',
  },
  '5916': {
    deviceId: '5916',
    name: 'Intel HD Graphics 620 (Kaby Lake Mobile)',
    generation: '7th Gen Kaby Lake',
    series: 'mobile',
    architecture: 'Gen9.5',
    status: 'native',
    statusDescription: 'Natively supported in macOS (MacBookPro14,1).',
    recommendedPlatformId: '00001B59',
    macosVersionSupport: 'macOS 10.12.6 - 15.x (Sequoia)',
    notes: 'Core i7-7500U, i5-7200U laptop processor.',
  },
  '591B': {
    deviceId: '591B',
    name: 'Intel HD Graphics 630 (Kaby Lake-H Mobile)',
    generation: '7th Gen Kaby Lake',
    series: 'mobile',
    architecture: 'Gen9.5',
    status: 'native',
    statusDescription: 'Natively supported in macOS (MacBookPro14,3).',
    recommendedPlatformId: '00001B59',
    macosVersionSupport: 'macOS 10.12.6 - 15.x (Sequoia)',
    notes: 'Core i7-7700HQ, i5-7300HQ laptop processor.',
  },
  '5917': {
    deviceId: '5917',
    name: 'Intel UHD Graphics 620 (Kaby Lake-R 8th Gen 15W)',
    generation: '8th Gen Kaby Lake Refresh',
    series: 'mobile',
    architecture: 'Gen9.5',
    status: 'needs_spoof',
    statusDescription: 'Often requires spoofing to 0x5916 or 0x591B on older macOS builds; native in 10.13.6+.',
    recommendedPlatformId: '00001B59',
    recommendedSpoofDeviceId: '5916',
    macosVersionSupport: 'macOS 10.13.6 - 15.x (Sequoia)',
    notes: 'Core i5-8250U, i7-8550U. Very popular ultrabook CPU.',
  },
  '5926': {
    deviceId: '5926',
    name: 'Intel Iris Plus Graphics 640 (Kaby Lake Mobile 15W)',
    generation: '7th Gen Kaby Lake',
    series: 'mobile',
    architecture: 'Gen9.5 (64MB eDRAM)',
    status: 'native',
    statusDescription: 'Natively supported (MacBookPro14,1 & iMac18,1).',
    recommendedPlatformId: '00002659',
    macosVersionSupport: 'macOS 10.12.6 - 15.x (Sequoia)',
    notes: 'Core i7-7660U, i5-7360U.',
  },
  '5927': {
    deviceId: '5927',
    name: 'Intel Iris Plus Graphics 650 (Kaby Lake 28W)',
    generation: '7th Gen Kaby Lake',
    series: 'mobile',
    architecture: 'Gen9.5 (64MB eDRAM)',
    status: 'native',
    statusDescription: 'Natively supported (MacBookPro14,2).',
    recommendedPlatformId: '00002759',
    macosVersionSupport: 'macOS 10.12.6 - 15.x (Sequoia)',
    notes: 'Core i7-7567U, i5-7267U (Intel NUC7).',
  },
  '591E': {
    deviceId: '591E',
    name: 'Intel HD Graphics 615 (Kaby Lake-Y 4.5W)',
    generation: '7th Gen Kaby Lake',
    series: 'mobile',
    architecture: 'Gen9.5',
    status: 'native',
    statusDescription: 'Natively supported (MacBook10,1).',
    recommendedPlatformId: '00001E59',
    macosVersionSupport: 'macOS 10.12.6 - 15.x (Sequoia)',
    notes: 'Core m3-7Y30, i5-7Y54, i7-7Y75.',
  },
  '5902': {
    deviceId: '5902',
    name: 'Intel HD Graphics 610 (Kaby Lake GT1 Desktop)',
    generation: '7th Gen Kaby Lake',
    series: 'desktop',
    architecture: 'Gen9.5 (GT1)',
    status: 'needs_spoof',
    statusDescription: 'GT1 graphics. Spoof to 0x5912.',
    recommendedPlatformId: '00001659',
    recommendedSpoofDeviceId: '5912',
    macosVersionSupport: 'macOS 10.12 - 15.x (Limited QE/CI)',
    notes: 'Pentium G4560, G4600.',
  },

  // === Skylake (6th Gen, 14nm) ===
  '1912': {
    deviceId: '1912',
    name: 'Intel HD Graphics 530 (Skylake Desktop)',
    generation: '6th Gen Skylake',
    series: 'desktop',
    architecture: 'Gen9',
    status: 'legacy_ventura',
    statusDescription: 'Native in macOS Monterey and earlier. Dropped in macOS Ventura/Sonoma/Sequoia: spoof as Kaby Lake (0x5912).',
    recommendedPlatformId: '00001219',
    recommendedSpoofDeviceId: '5912',
    recommendedBootArgs: '-igfxsklaskbl',
    macosVersionSupport: '10.11 - 12.x native; 13+ via KBL spoof',
    notes: 'Core i7-6700K, i5-6600K. For macOS 13+ Ventura/Sonoma, spoof to 5912 with -igfxsklaskbl.',
  },
  '1916': {
    deviceId: '1916',
    name: 'Intel HD Graphics 520 (Skylake Mobile)',
    generation: '6th Gen Skylake',
    series: 'mobile',
    architecture: 'Gen9',
    status: 'legacy_ventura',
    statusDescription: 'Native in Monterey and earlier. On Ventura/Sonoma/Sequoia, spoof as Kaby Lake HD 620 (0x5916).',
    recommendedPlatformId: '00001619',
    recommendedSpoofDeviceId: '5916',
    recommendedBootArgs: '-igfxsklaskbl',
    macosVersionSupport: '10.11 - 12.x native; 13+ via KBL spoof',
    notes: 'Core i7-6500U, i5-6200U.',
  },
  '191B': {
    deviceId: '191B',
    name: 'Intel HD Graphics 530 (Skylake-H Mobile)',
    generation: '6th Gen Skylake',
    series: 'mobile',
    architecture: 'Gen9',
    status: 'legacy_ventura',
    statusDescription: 'Native in Monterey and earlier. On Ventura+, spoof as Kaby Lake (0x591B).',
    recommendedPlatformId: '00001B19',
    recommendedSpoofDeviceId: '591B',
    recommendedBootArgs: '-igfxsklaskbl',
    macosVersionSupport: '10.11 - 12.x native; 13+ via KBL spoof',
    notes: 'Core i7-6700HQ, i5-6300HQ.',
  },
  '1926': {
    deviceId: '1926',
    name: 'Intel Iris Graphics 540 (Skylake Mobile 15W)',
    generation: '6th Gen Skylake',
    series: 'mobile',
    architecture: 'Gen9 (64MB eDRAM)',
    status: 'legacy_ventura',
    statusDescription: 'Native up to Monterey (MacBookPro13,1). Spoof as KBL (0x5926) on Ventura+.',
    recommendedPlatformId: '00002619',
    recommendedSpoofDeviceId: '5926',
    recommendedBootArgs: '-igfxsklaskbl',
    macosVersionSupport: '10.11 - 12.x native; 13+ via KBL spoof',
    notes: 'Core i7-6650U, i5-6360U.',
  },

  // === Broadwell (5th Gen, 14nm) ===
  '1616': {
    deviceId: '1616',
    name: 'Intel HD Graphics 5500 (Broadwell Mobile)',
    generation: '5th Gen Broadwell',
    series: 'mobile',
    architecture: 'Gen8',
    status: 'native',
    statusDescription: 'Native support in macOS Monterey and earlier (MacBookPro12,1). Ventura+ requires OCLP root patches.',
    recommendedPlatformId: '00001616',
    macosVersionSupport: 'macOS 10.10 - 12.x (OCLP for 13+)',
    notes: 'Core i7-5500U, i5-5200U.',
  },
  '1626': {
    deviceId: '1626',
    name: 'Intel HD Graphics 6000 (Broadwell Mobile)',
    generation: '5th Gen Broadwell',
    series: 'mobile',
    architecture: 'Gen8',
    status: 'native',
    statusDescription: 'Native support in macOS Monterey and earlier (MacBookAir7,2).',
    recommendedPlatformId: '00002616',
    macosVersionSupport: 'macOS 10.10 - 12.x (OCLP for 13+)',
    notes: 'Core i7-5650U, i5-5350U.',
  },
  '1622': {
    deviceId: '1622',
    name: 'Intel Iris Pro Graphics 6200 (Broadwell Desktop/Mobile)',
    generation: '5th Gen Broadwell',
    series: 'desktop',
    architecture: 'Gen8 (128MB eDRAM)',
    status: 'native',
    statusDescription: 'Native support (iMac16,2).',
    recommendedPlatformId: '00002216',
    macosVersionSupport: 'macOS 10.10 - 12.x (OCLP for 13+)',
    notes: 'Core i7-5775C, i5-5675C.',
  },

  // === Haswell (4th Gen, 22nm) ===
  '0412': {
    deviceId: '0412',
    name: 'Intel HD Graphics 4600 (Haswell Desktop)',
    generation: '4th Gen Haswell',
    series: 'desktop',
    architecture: 'Gen7.5',
    status: 'native',
    statusDescription: 'Native in macOS Monterey and earlier (iMac14,1 / iMac15,1). Ventura+ requires OCLP root patch.',
    recommendedPlatformId: '0300220D',
    macosVersionSupport: 'macOS 10.9 - 12.x (OCLP for 13+)',
    notes: 'Core i7-4790K, i7-4770, i5-4690, i5-4460.',
  },
  '0416': {
    deviceId: '0416',
    name: 'Intel HD Graphics 4600 (Haswell-H Mobile)',
    generation: '4th Gen Haswell',
    series: 'mobile',
    architecture: 'Gen7.5',
    status: 'native',
    statusDescription: 'Native in Monterey and earlier (MacBookPro11,2).',
    recommendedPlatformId: '00000604',
    macosVersionSupport: 'macOS 10.9 - 12.x (OCLP for 13+)',
    notes: 'Core i7-4700MQ, i7-4710HQ, i5-4200M.',
  },
  '041E': {
    deviceId: '041E',
    name: 'Intel HD Graphics 4400 (Haswell Desktop)',
    generation: '4th Gen Haswell',
    series: 'desktop',
    architecture: 'Gen7.5',
    status: 'needs_spoof',
    statusDescription: 'Desktop HD 4400 is not natively supported in macOS. Requires WhateverGreen spoof to HD 4600 (0x0412).',
    recommendedPlatformId: '0300220D',
    recommendedSpoofDeviceId: '0412',
    macosVersionSupport: 'macOS 10.9 - 12.x (via HD 4600 spoof)',
    notes: 'Core i3-4130, i3-4150, i3-4160. Classic Hackintosh spoof to 0412.',
  },
  '0A16': {
    deviceId: '0A16',
    name: 'Intel HD Graphics 4400 (Haswell ULT Mobile)',
    generation: '4th Gen Haswell',
    series: 'mobile',
    architecture: 'Gen7.5',
    status: 'needs_spoof',
    statusDescription: 'Mobile HD 4400. Supported via WhateverGreen spoof to HD 4600 Mobile (0x0416) or HD 5000 (0x0A26).',
    recommendedPlatformId: '0600260A',
    recommendedSpoofDeviceId: '0416',
    macosVersionSupport: 'macOS 10.9 - 12.x (via spoof)',
    notes: 'Core i5-4200U, i5-4210U, i7-4500U.',
  },
  '0A26': {
    deviceId: '0A26',
    name: 'Intel HD Graphics 5000 (Haswell ULT 15W)',
    generation: '4th Gen Haswell',
    series: 'mobile',
    architecture: 'Gen7.5',
    status: 'native',
    statusDescription: 'Natively supported in macOS Monterey and earlier (MacBookAir6,2).',
    recommendedPlatformId: '0600260A',
    macosVersionSupport: 'macOS 10.9 - 12.x (OCLP for 13+)',
    notes: 'Core i7-4650U, i5-4250U.',
  },

  // === Ice Lake (10th Gen 10nm, Gen11) ===
  '8A52': {
    deviceId: '8A52',
    name: 'Intel Iris Plus Graphics G7 (Ice Lake 64-EU)',
    generation: '10th Gen Ice Lake (10nm)',
    series: 'mobile',
    architecture: 'Gen11',
    status: 'native',
    statusDescription: 'Natively supported in macOS Catalina 10.15.4+ through Sequoia (MacBookAir9,1).',
    recommendedPlatformId: '0000528A',
    macosVersionSupport: 'macOS 10.15.4 - 15.x (Sequoia)',
    notes: 'Core i7-1065G7. Native AppleICLLPFramebuffer.',
  },
  '8A51': {
    deviceId: '8A51',
    name: 'Intel Iris Plus Graphics G4 (Ice Lake 48-EU)',
    generation: '10th Gen Ice Lake (10nm)',
    series: 'mobile',
    architecture: 'Gen11',
    status: 'native',
    statusDescription: 'Natively supported in macOS Catalina 10.15.4+.',
    recommendedPlatformId: '0000528A',
    macosVersionSupport: 'macOS 10.15.4 - 15.x (Sequoia)',
    notes: 'Core i5-1035G4, i5-1035G1.',
  },

  // === Unsupported 11th/12th/13th/14th Gen Graphics (Intel Xe Architecture) ===
  '9A49': {
    deviceId: '9A49',
    name: 'Intel Iris Xe Graphics (Tiger Lake-U 96-EU)',
    generation: '11th Gen Tiger Lake (10nm SuperFin)',
    series: 'mobile',
    architecture: 'Intel Xe-LP (Gen12)',
    status: 'unsupported',
    statusDescription: 'COMPLETELY UNSUPPORTED IN MACOS. Apple never shipped Mac models with Intel Xe Graphics.',
    recommendedPlatformId: 'UNSUPPORTED',
    macosVersionSupport: 'Unsupported (No Apple drivers exist)',
    notes: 'Apple transitioned to Apple Silicon prior to 11th Gen. Intel Xe graphics cannot be accelerated in macOS. Use a supported AMD dGPU on desktops or run in display-only VESA mode.',
  },
  '9A40': {
    deviceId: '9A40',
    name: 'Intel Iris Xe Graphics (Tiger Lake-H 32-EU)',
    generation: '11th Gen Tiger Lake-H',
    series: 'mobile',
    architecture: 'Intel Xe-LP (Gen12)',
    status: 'unsupported',
    statusDescription: 'COMPLETELY UNSUPPORTED IN MACOS. No driver support exists in any macOS release.',
    recommendedPlatformId: 'UNSUPPORTED',
    macosVersionSupport: 'Unsupported (No Apple drivers exist)',
    notes: 'Core i7-11800H, i5-11400H.',
  },
  '4C8A': {
    deviceId: '4C8A',
    name: 'Intel UHD Graphics 750 (Rocket Lake Desktop)',
    generation: '11th Gen Rocket Lake',
    series: 'desktop',
    architecture: 'Intel Xe-LP (Gen12)',
    status: 'unsupported',
    statusDescription: 'COMPLETELY UNSUPPORTED IN MACOS. Requires discrete AMD GPU (e.g. RX 6600, RX 580) with iGPU disabled.',
    recommendedPlatformId: 'UNSUPPORTED',
    macosVersionSupport: 'Unsupported (No Apple drivers exist)',
    notes: 'Core i9-11900K, i7-11700K, i5-11600K.',
  },
  '4680': {
    deviceId: '4680',
    name: 'Intel UHD Graphics 770 (Alder Lake Desktop 12th Gen)',
    generation: '12th Gen Alder Lake',
    series: 'desktop',
    architecture: 'Intel Xe-LP (Gen12)',
    status: 'unsupported',
    statusDescription: 'COMPLETELY UNSUPPORTED IN MACOS. No macOS drivers exist for Alder Lake / Raptor Lake iGPUs.',
    recommendedPlatformId: 'UNSUPPORTED',
    macosVersionSupport: 'Unsupported (No Apple drivers exist)',
    notes: 'Core i9-12900K, i7-12700K, i5-12600K. Disable iGPU in BIOS or OpenCore, and use a supported AMD Radeon discrete GPU.',
  },
  'A780': {
    deviceId: 'A780',
    name: 'Intel UHD Graphics 770 (Raptor Lake Desktop 13th/14th Gen)',
    generation: '13th/14th Gen Raptor Lake',
    series: 'desktop',
    architecture: 'Intel Xe-LP (Gen12)',
    status: 'unsupported',
    statusDescription: 'COMPLETELY UNSUPPORTED IN MACOS. Intel Xe graphics have no macOS drivers.',
    recommendedPlatformId: 'UNSUPPORTED',
    macosVersionSupport: 'Unsupported (No Apple drivers exist)',
    notes: 'Core i9-14900K, i9-13900K, i7-14700K, i5-14600K. Disable iGPU and use an AMD Radeon RX 6600/6800/6900 XT or RX 580.',
  },
};

// -----------------------------------------------------------------------------
// Binary PCIR Header Extraction Engine
// -----------------------------------------------------------------------------

/**
 * Searches a binary buffer (such as an Option ROM or UEFI GOP dump)
 * for the PCI Data Structure signature 'PCIR' (0x50 0x43 0x49 0x52).
 * If Vendor ID matches 0x8086 (Intel), extracts the physical PCI Device ID.
 */
export function extractPcirDeviceId(buffer: Uint8Array): {
  vendorId: number;
  deviceId: number;
  deviceIdHex: string;
  offset: number;
} | null {
  if (buffer.length < 32) return null;

  // 1. Check standard PCI Option ROM Header at offset 0: 0x55 0xAA
  if (buffer[0] === 0x55 && buffer[1] === 0xaa) {
    const pcirPtr = buffer[0x18] | (buffer[0x19] << 8);
    if (pcirPtr > 0 && pcirPtr + 16 <= buffer.length) {
      if (
        buffer[pcirPtr] === 0x50 &&
        buffer[pcirPtr + 1] === 0x43 &&
        buffer[pcirPtr + 2] === 0x49 &&
        buffer[pcirPtr + 3] === 0x52
      ) {
        const vendor = buffer[pcirPtr + 4] | (buffer[pcirPtr + 5] << 8);
        const device = buffer[pcirPtr + 6] | (buffer[pcirPtr + 7] << 8);
        if (vendor === 0x8086) {
          const hex = device.toString(16).padStart(4, '0').toUpperCase();
          return { vendorId: vendor, deviceId: device, deviceIdHex: hex, offset: pcirPtr };
        }
      }
    }
  }

  // 2. Scan whole binary for 'PCIR' signature
  for (let i = 0; i <= buffer.length - 16; i++) {
    if (
      buffer[i] === 0x50 && // 'P'
      buffer[i + 1] === 0x43 && // 'C'
      buffer[i + 2] === 0x49 && // 'I'
      buffer[i + 3] === 0x52 // 'R'
    ) {
      const vendor = buffer[i + 4] | (buffer[i + 5] << 8);
      const device = buffer[i + 6] | (buffer[i + 7] << 8);
      if (vendor === 0x8086) {
        const hex = device.toString(16).padStart(4, '0').toUpperCase();
        return { vendorId: vendor, deviceId: device, deviceIdHex: hex, offset: i };
      }
    }
  }

  return null;
}

// -----------------------------------------------------------------------------
// Compatibility & WhateverGreen Spoofing Analyzer
// -----------------------------------------------------------------------------

function parseMacosVersion(v?: string): number[] {
  if (!v) return [14, 0, 0];
  const parts = v.split('.').map((x) => parseInt(x, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function isMacosVersionGe(v1?: string, v2?: string): boolean {
  const p1 = parseMacosVersion(v1);
  const p2 = parseMacosVersion(v2);
  for (let i = 0; i < 3; i++) {
    if (p1[i] > p2[i]) return true;
    if (p1[i] < p2[i]) return false;
  }
  return true;
}

export function analyzeIgpuCompatibility(
  rawDeviceIdInput?: string,
  userPlatformIdOverride?: string,
  targetMacos: string = '14.0'
): IgpuAnalysisResult {
  const cleanId = (rawDeviceIdInput || '9BC8').replace(/[^0-9A-Fa-f]/g, '').padStart(4, '0').slice(-4).toUpperCase();
  const known = IGPU_DATABASE[cleanId];

  const model: IgpuModel = known ? { ...known } : {
    deviceId: cleanId,
    name: `Intel Graphics Controller (Device-ID: 0x${cleanId})`,
    generation: 'Custom / Uncataloged Intel iGPU',
    series: 'desktop',
    architecture: 'Intel Graphics',
    status: 'needs_spoof',
    statusDescription: `Device 0x${cleanId} is not in standard native Apple driver tables. Spoofing to 0x3E9B (Coffee Lake) is recommended.`,
    recommendedPlatformId: '07009B3E',
    recommendedSpoofDeviceId: '3E9B',
    macosVersionSupport: 'Check generation compatibility',
    notes: 'Verify CPU generation to ensure compatible framebuffer selection.',
  };

  // Evaluate version-dependent compatibility
  let resolvedStatus = model.status;
  let resolvedSpoofId = model.recommendedSpoofDeviceId;
  let resolvedBootArgs = model.recommendedBootArgs;

  if (cleanId === '3E98') {
    if (isMacosVersionGe(targetMacos, '10.14.4')) {
      resolvedStatus = 'native';
      resolvedSpoofId = undefined;
      model.statusDescription = `Native support in macOS ${targetMacos} (driver support present since 10.14.4).`;
    } else {
      resolvedStatus = 'needs_spoof';
      resolvedSpoofId = '3E92';
      model.statusDescription = `macOS ${targetMacos} < 10.14.4 requires spoofing to Coffee Lake 0x3E92.`;
    }
  } else if (cleanId === '5917') {
    if (isMacosVersionGe(targetMacos, '10.13.6')) {
      resolvedStatus = 'native';
      resolvedSpoofId = undefined;
      model.statusDescription = `Native support in macOS ${targetMacos} (driver support present since 10.13.6).`;
    } else {
      resolvedStatus = 'needs_spoof';
      resolvedSpoofId = '5916';
      model.statusDescription = `macOS ${targetMacos} < 10.13.6 requires spoofing to Kaby Lake 0x5916.`;
    }
  } else if (['1912', '1916', '191B'].includes(cleanId)) {
    if (isMacosVersionGe(targetMacos, '13.0')) {
      resolvedStatus = 'needs_spoof';
      resolvedSpoofId = cleanId === '1912' ? '5912' : '5916';
      resolvedBootArgs = '-igfxsklaskbl';
      model.statusDescription = `macOS ${targetMacos} (Ventura+) dropped native Skylake drivers. Requires KBL spoof and boot-arg -igfxsklaskbl.`;
    } else {
      resolvedStatus = 'native';
      resolvedSpoofId = undefined;
      resolvedBootArgs = undefined;
      model.statusDescription = `Native support in macOS ${targetMacos} (native Skylake driver present in Monterey and earlier).`;
    }
  }

  model.status = resolvedStatus;
  model.recommendedSpoofDeviceId = resolvedSpoofId;
  model.recommendedBootArgs = resolvedBootArgs;

  const isSpoofRecommended = resolvedStatus === 'needs_spoof' || resolvedStatus === 'legacy_ventura';
  const effectivePlatformId = userPlatformIdOverride && userPlatformIdOverride.length === 8
    ? userPlatformIdOverride.toUpperCase()
    : model.recommendedPlatformId !== 'UNSUPPORTED'
    ? model.recommendedPlatformId
    : '07009B3E';

  const effectiveSpoofDeviceId = isSpoofRecommended && resolvedSpoofId
    ? resolvedSpoofId.toUpperCase()
    : null;

  // Convert platform-id to base64: e.g. "07009B3E" -> bytes [07, 00, 9B, 3E] -> base64
  const pidBytes = new Uint8Array([
    parseInt(effectivePlatformId.slice(0, 2), 16),
    parseInt(effectivePlatformId.slice(2, 4), 16),
    parseInt(effectivePlatformId.slice(4, 6), 16),
    parseInt(effectivePlatformId.slice(6, 8), 16),
  ]);
  const platformIdBase64 = btoa(String.fromCharCode(...pidBytes));

  // Convert spoof device-id to little endian 4-byte format:
  // e.g. "3E9B" -> Little Endian bytes: [0x9B, 0x3E, 0x00, 0x00] -> hex "9B3E0000" -> base64 "mz4AAA=="
  let spoofDeviceIdBase64: string | null = null;
  let spoofDeviceIdHexLE: string | null = null;

  if (effectiveSpoofDeviceId) {
    const val = parseInt(effectiveSpoofDeviceId, 16);
    const low = val & 0xff;
    const high = (val >> 8) & 0xff;
    const spoofBytes = new Uint8Array([low, high, 0x00, 0x00]);
    spoofDeviceIdBase64 = btoa(String.fromCharCode(...spoofBytes));
    spoofDeviceIdHexLE = `${low.toString(16).padStart(2, '0')}${high.toString(16).padStart(2, '0')}0000`.toUpperCase();
  }

  const warnings: string[] = [];
  if (model.status === 'unsupported') {
    warnings.push(
      `CRITICAL: ${model.name} (${model.generation}) is NOT supported by macOS! Intel Xe graphics (11th+ Gen) have no Apple drivers.`
    );
    warnings.push(
      'To run macOS on this system, you must disable the Intel iGPU and use a supported discrete GPU (e.g., AMD Radeon RX 6600, RX 580, etc.).'
    );
  } else if (model.status === 'needs_spoof') {
    warnings.push(
      `Device 0x${cleanId} requires WhateverGreen device-id spoofing to 0x${effectiveSpoofDeviceId} (<${spoofDeviceIdHexLE}>) for hardware QE/CI acceleration.`
    );
  } else if (model.status === 'legacy_ventura') {
    warnings.push(
      `Skylake graphics support was dropped natively in macOS 13 (Ventura). On Ventura/Sonoma/Sequoia, spoofing to Kaby Lake (0x${effectiveSpoofDeviceId}) with boot-arg '${model.recommendedBootArgs}' is required.`
    );
  }

  // Recommended DeviceProperties dict
  const recommendedProperties: Record<string, { hex: string; base64: string; comment: string }> = {
    'AAPL,ig-platform-id': {
      hex: effectivePlatformId.toLowerCase(),
      base64: platformIdBase64,
      comment: `AAPL,ig-platform-id = <${effectivePlatformId.toLowerCase()}>`,
    },
    'framebuffer-patch-enable': {
      hex: '01000000',
      base64: 'AQAAAA==',
      comment: 'Enable WhateverGreen framebuffer patching',
    },
  };

  if (effectiveSpoofDeviceId && spoofDeviceIdBase64 && spoofDeviceIdHexLE) {
    recommendedProperties['device-id'] = {
      hex: spoofDeviceIdHexLE.toLowerCase(),
      base64: spoofDeviceIdBase64,
      comment: `Spoof iGPU as 0x${effectiveSpoofDeviceId} (<${spoofDeviceIdHexLE.toLowerCase()}>)`,
    };
  }

  recommendedProperties['framebuffer-unifiedmem'] = {
    hex: '00000080',
    base64: 'AAAAgA==',
    comment: 'Set VRAM to 2048MB',
  };

  recommendedProperties['rps-control'] = {
    hex: '01000000',
    base64: 'AQAAAA==',
    comment: 'Enable RPS control',
  };

  return {
    detectedOrSelected: model,
    isSpoofRecommended,
    effectivePlatformId,
    effectiveSpoofDeviceId,
    platformIdBase64,
    spoofDeviceIdBase64,
    spoofDeviceIdHexLE,
    recommendedBootArgs: model.recommendedBootArgs || null,
    recommendedProperties,
    warnings,
  };
}
