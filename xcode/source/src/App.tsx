/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  parseVBT,
  generateOpenCoreXml,
  generateAsciiTable,
  VBTParseResult,
} from './vbtParser.ts';
import {
  analyzeIgpuCompatibility,
  IGPU_DATABASE,
  IgpuAnalysisResult,
  IgpuModel,
} from './igpuDatabase.ts';
import {
  Cpu,
  Monitor,
  Download,
  Copy,
  Check,
  Terminal,
  FileCode,
  FileUp,
  GitBranch,
  Layers,
  ArrowRight,
  ShieldCheck,
  Code,
  Play,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  Sliders,
  RefreshCw,
} from 'lucide-react';

interface SampleInfo {
  id: string;
  name: string;
  description: string;
  platform_id: string;
  device_id?: string;
  type: string;
}

const PLATFORM_PRESETS = [
  { id: '07009B3E', label: 'Coffee Lake Desktop (UHD 630 - Default)', cpu: 'i9-9900K, i7-9700K, i5-9600K, i7-10700 (Spoof)' },
  { id: '00009B3E', label: 'Coffee Lake / Comet Lake Laptop (UHD 630)', cpu: 'i7-10750H, i7-9750H, i7-8750H' },
  { id: '0000923E', label: 'Coffee Lake Desktop Headless (Compute only)', cpu: 'dGPU paired headless mode' },
  { id: '00001659', label: 'Kaby Lake Desktop (HD 630)', cpu: 'i7-7700K, i5-7600K' },
  { id: '00001B59', label: 'Kaby Lake Laptop (HD 620/630)', cpu: 'i7-7500U, i5-7200U' },
  { id: '0000A53E', label: 'Comet Lake Desktop Native (UHD 630 macOS 10.15.5+)', cpu: 'i9-10900K, i7-10700K' },
  { id: '0000528A', label: 'Ice Lake Laptop (Iris Plus G7)', cpu: 'i7-1065G7' },
  { id: '00001619', label: 'Skylake Desktop (HD 530)', cpu: 'i7-6700K, i5-6600K' },
  { id: '0300220D', label: 'Haswell Desktop (HD 4600)', cpu: 'i7-4770K, i7-4790K' },
];

export default function App() {
  const [samples, setSamples] = useState<SampleInfo[]>([]);
  const [selectedSample, setSelectedSample] = useState<string>('cfl_desktop_vbt.bin');
  const [platformId, setPlatformId] = useState<string>('07009B3E');
  const [vbtBinary, setVbtBinary] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string>('cfl_desktop_vbt.bin');
  const [fileSize, setFileSize] = useState<number>(0);
  const [parseResult, setParseResult] = useState<VBTParseResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Intel iGPU Device-ID Compatibility & WhateverGreen Spoofing State
  const [deviceIdInput, setDeviceIdInput] = useState<string>('3E9B');
  const [targetMacos, setTargetMacos] = useState<string>('14.0');
  const [formFactor, setFormFactor] = useState<string>('auto');
  const [enableSpoofOverride, setEnableSpoofOverride] = useState<boolean | null>(null);
  const [customSpoofId, setCustomSpoofId] = useState<string>('');

  // v3.4.0 Advanced Framebuffer & Tuning Options
  const [backlightFix, setBacklightFix] = useState<boolean>(false);
  const [lspconMode, setLspconMode] = useState<'' | 'pcon' | 'ls'>('');
  const [busIdSource, setBusIdSource] = useState<'ddi' | 'ddc'>('ddi');
  const [mobileMode, setMobileMode] = useState<boolean>(false);
  const [firstConIndex, setFirstConIndex] = useState<string>('');
  const [unifiedmem, setUnifiedmem] = useState<boolean>(true);
  const [rpsControl, setRpsControl] = useState<boolean>(true);
  const [pipeOverride, setPipeOverride] = useState<string>('');
  const [conFlags, setConFlags] = useState<string>('');
  const [fbFlags, setFbFlags] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  // Active view tab
  const [activeTab, setActiveTab] = useState<'diagram' | 'compatibility' | 'table' | 'xml' | 'merge' | 'terminal' | 'hex' | 'cli'>(
    'diagram'
  );

  // Copy states
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Plist merge state
  const [uploadedPlist, setUploadedPlist] = useState<string>('');
  const [mergedPlist, setMergedPlist] = useState<string>('');
  const [mergeLoading, setMergeLoading] = useState<boolean>(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  // CLI execution state
  const [cliOutput, setCliOutput] = useState<string>('');
  const [cliRunning, setCliRunning] = useState<boolean>(false);
  const [cliSourceCode, setCliSourceCode] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const plistInputRef = useRef<HTMLInputElement>(null);

  // Fetch sample list on mount
  useEffect(() => {
    fetch('/api/samples')
      .then((res) => res.json())
      .then((data) => {
        if (data.samples) {
          setSamples(data.samples);
        }
      })
      .catch((err) => {
        console.warn('Could not load samples via API, using fallback data:', err);
      });

    // Also fetch CLI script source code
    fetch('/api/cli-code')
      .then((res) => res.json())
      .then((data) => {
        if (data.code) setCliSourceCode(data.code);
      })
      .catch(() => {});
  }, []);

  // Load sample binary whenever selectedSample changes
  useEffect(() => {
    if (!selectedSample) return;

    fetch(`/api/samples/${selectedSample}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.base64) {
          const binaryStr = atob(data.base64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          setVbtBinary(bytes);
          setFileName(selectedSample);
          setFileSize(bytes.length);

          const foundSample = samples.find((s) => s.id === selectedSample);
          if (foundSample?.device_id) {
            setDeviceIdInput(foundSample.device_id);
            setEnableSpoofOverride(null);
          }
          processVbtBinary(bytes);
        }
      })
      .catch((err) => {
        console.error('Error loading sample:', err);
      });
  }, [selectedSample]);

  // Process VBT binary bytes
  const processVbtBinary = (bytes: Uint8Array) => {
    try {
      const result = parseVBT(bytes);
      setParseResult(result);
      setParseError(null);

      // If PCIR option ROM contains hardware Device ID, auto-update deviceIdInput
      if (result.detectedPcirDeviceId) {
        setDeviceIdInput(result.detectedPcirDeviceId);
        setEnableSpoofOverride(null);
      }
    } catch (err: any) {
      setParseError(err.message || 'Unknown parsing failure');
      setParseResult(null);
    }
  };

  // Analyze compatibility based on deviceIdInput and target macOS version
  const compatibility: IgpuAnalysisResult = analyzeIgpuCompatibility(deviceIdInput, platformId, targetMacos);
  const targetModel: IgpuModel = compatibility.detectedOrSelected;

  // Determine whether spoofing is effectively enabled
  const isSpoofActive =
    enableSpoofOverride !== null
      ? enableSpoofOverride
      : compatibility.isSpoofRecommended;

  const effectiveSpoofId = isSpoofActive
    ? customSpoofId || compatibility.effectiveSpoofDeviceId || targetModel.recommendedSpoofDeviceId || '3E9B'
    : null;

  // Handle file drop / upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const arrayBuffer = event.target?.result as ArrayBuffer;
      if (arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        setVbtBinary(bytes);
        setFileName(file.name);
        setFileSize(bytes.length);
        setSelectedSample('');
        setEnableSpoofOverride(null);
        processVbtBinary(bytes);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Copy to clipboard helper
  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Download raw XML
  const downloadXml = () => {
    if (!parseResult) return;
    const xml = generateOpenCoreXml(parseResult.activeDevices, platformId, effectiveSpoofId, {
      firstConIndex: firstConIndex !== '' ? parseInt(firstConIndex, 10) : undefined,
      unifiedmem,
      rpsControl,
      backlightFix,
      targetMacos,
      lspconMode,
      mobileMode,
      conFlags,
      fbFlags,
      pipeOverride: pipeOverride !== '' ? parseInt(pipeOverride, 10) : undefined,
    });
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `OpenCore_Framebuffer_Patch_${platformId}${effectiveSpoofId ? `_spoof_${effectiveSpoofId}` : ''}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Handle Plist File Upload
  const handlePlistUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setUploadedPlist(text);
        setMergedPlist('');
        setMergeError(null);
      }
    };
    reader.readAsText(file);
  };

  // Run Backend Plist Merge
  const executePlistMerge = async () => {
    if (!uploadedPlist || !vbtBinary) return;
    setMergeLoading(true);
    setMergeError(null);

    try {
      let binaryStr = '';
      for (let i = 0; i < vbtBinary.length; i++) {
        binaryStr += String.fromCharCode(vbtBinary[i]);
      }
      const vbt_base64 = btoa(binaryStr);

      const res = await fetch('/api/merge-plist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vbt_base64,
          plist_content: uploadedPlist,
          platform_id: platformId,
          device_id: deviceIdInput,
          spoof_id: effectiveSpoofId,
          target_macos: targetMacos,
          form_factor: formFactor === 'auto' ? undefined : formFactor,
          unifiedmem,
          rps_control: rpsControl,
          backlight_fix: backlightFix,
          mobile: mobileMode,
          first_con: firstConIndex !== '' ? parseInt(firstConIndex, 10) : undefined,
          bus_id_source: busIdSource,
          pipe: pipeOverride !== '' ? parseInt(pipeOverride, 10) : undefined,
          con_flags: conFlags || undefined,
          fb_flags: fbFlags || undefined,
          lspcon_mode: lspconMode || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to merge config.plist');
      }

      setMergedPlist(data.mergedPlist);
    } catch (err: any) {
      setMergeError(err.message || 'Error merging plist');
    } finally {
      setMergeLoading(false);
    }
  };

  // Run Backend Python CLI
  const executeBackendCli = async (jsonMode = false) => {
    if (!vbtBinary) return;
    setCliRunning(true);

    try {
      let binaryStr = '';
      for (let i = 0; i < vbtBinary.length; i++) {
        binaryStr += String.fromCharCode(vbtBinary[i]);
      }
      const vbt_base64 = btoa(binaryStr);

      const res = await fetch('/api/run-cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vbt_base64,
          platform_id: platformId,
          device_id: deviceIdInput,
          spoof_id: effectiveSpoofId,
          target_macos: targetMacos,
          form_factor: formFactor === 'auto' ? undefined : formFactor,
          unifiedmem,
          rps_control: rpsControl,
          backlight_fix: backlightFix,
          mobile: mobileMode,
          first_con: firstConIndex !== '' ? parseInt(firstConIndex, 10) : undefined,
          bus_id_source: busIdSource,
          pipe: pipeOverride !== '' ? parseInt(pipeOverride, 10) : undefined,
          con_flags: conFlags || undefined,
          fb_flags: fbFlags || undefined,
          lspcon_mode: lspconMode || undefined,
          verbose: true,
          json_mode: jsonMode,
        }),
      });

      const data = await res.json();
      setCliOutput(data.stdout || data.stderr || 'No output produced');
    } catch (err: any) {
      setCliOutput(`[!] CLI Execution error: ${err.message}`);
    } finally {
      setCliRunning(false);
    }
  };

  // Generated XML & ASCII Table
  const generatedXml = parseResult
    ? generateOpenCoreXml(parseResult.activeDevices, platformId, effectiveSpoofId, {
        firstConIndex: firstConIndex !== '' ? parseInt(firstConIndex, 10) : undefined,
        unifiedmem,
        rpsControl,
        backlightFix,
        targetMacos,
        lspconMode,
        mobileMode,
        conFlags,
        fbFlags,
        pipeOverride: pipeOverride !== '' ? parseInt(pipeOverride, 10) : undefined,
      })
    : '';
  const asciiTable = parseResult ? generateAsciiTable(parseResult.activeDevices) : '';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30 px-4 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-base tracking-tight text-white">vbt2fbpatch</span>
              <span className="text-xs text-cyan-400 font-mono font-semibold bg-cyan-950 px-1.5 py-0.5 rounded border border-cyan-800">v3.4.0</span>
              <span className="text-slate-600">·</span>
              <span className="text-xs text-slate-300">by 5T33Z0</span>
              <span className="text-slate-600">·</span>
              <span className="text-xs text-slate-400">WhateverGreen Framebuffer Patcher</span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Intel Video BIOS Table connector parser, iGPU compatibility detection, WhateverGreen spoofing & OpenCore patches
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <a
            href="/api/download-cli"
            download="vbt2fbpatch.py"
            title="Download 100% self-contained standalone Python 3 script"
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-cyan-600 hover:bg-cyan-500 text-white transition-colors shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Standalone Script</span>
          </a>

          <button
            onClick={() => {
              setActiveTab('cli');
              if (!cliOutput) executeBackendCli(false);
            }}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            <Terminal className="w-3.5 h-3.5 text-slate-400" />
            <span>Terminal CLI</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-8 flex flex-col gap-6">
        {/* Top Control Bar: Source, Target Platform ID, and iGPU Device ID */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* VBT Source Selector */}
          <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Intel VBT Binary Source
                </span>
              </div>
              <div className="text-xs text-slate-400">
                <span>{fileName}</span>
                {fileSize > 0 && <span className="ml-1 text-slate-500">({fileSize} bytes)</span>}
              </div>
            </div>

            {/* Sample Selector Buttons */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {samples.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSelectedSample(s.id);
                    setPlatformId(s.platform_id);
                    if (s.device_id) {
                      setDeviceIdInput(s.device_id);
                      setEnableSpoofOverride(null);
                    }
                  }}
                  className={`px-2.5 py-1 text-xs rounded-md transition-all text-left ${
                    selectedSample === s.id
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-medium'
                      : 'bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/50'
                  }`}
                  title={s.description}
                >
                  {s.name.split('(')[0].trim()}
                </button>
              ))}
            </div>

            {/* Upload or Drop */}
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".bin,.rom,.dat,*/*"
                onChange={handleFileUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2 px-3 border border-dashed border-slate-700 hover:border-cyan-500/50 rounded-lg bg-slate-950/50 hover:bg-slate-950 text-xs text-slate-400 hover:text-cyan-300 flex items-center justify-center gap-2 transition-all"
              >
                <FileUp className="w-3.5 h-3.5" />
                <span>Upload custom vbt.bin (or dump from /sys/kernel/debug/dri/0/i915_vbt)</span>
              </button>
            </div>
          </div>

          {/* Target AAPL,ig-platform-id Configuration */}
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Target AAPL,ig-platform-id
                </span>
              </div>
              <span className="font-mono text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                &lt;{platformId}&gt;
              </span>
            </div>

            <div className="space-y-2">
              <select
                value={platformId}
                onChange={(e) => setPlatformId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              >
                {PLATFORM_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id} - {p.label}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 whitespace-nowrap">Custom Hex:</span>
                <input
                  type="text"
                  maxLength={8}
                  value={platformId}
                  onChange={(e) => setPlatformId(e.target.value.toUpperCase().replace(/[^0-9A-F]/g, ''))}
                  className="w-full font-mono bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-cyan-300 focus:outline-none focus:border-cyan-500"
                  placeholder="07009B3E"
                />
                {targetModel.recommendedPlatformId &&
                  targetModel.recommendedPlatformId !== 'UNSUPPORTED' &&
                  targetModel.recommendedPlatformId !== platformId && (
                    <button
                      onClick={() => setPlatformId(targetModel.recommendedPlatformId)}
                      className="px-2 py-1 text-[11px] font-medium bg-cyan-950 text-cyan-300 hover:bg-cyan-900 border border-cyan-800 rounded whitespace-nowrap flex items-center gap-1"
                      title="Apply recommended platform ID for this iGPU"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Use &lt;{targetModel.recommendedPlatformId}&gt;</span>
                    </button>
                  )}
              </div>
            </div>
          </div>
        </section>

        {/* Intel iGPU Compatibility & WhateverGreen Spoofing Engine Card */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <Cpu className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-white">Intel iGPU Compatibility & WhateverGreen Spoofing Engine</h3>
                  {/* Status Badge */}
                  {targetModel.status === 'native' && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
                      <CheckCircle2 className="w-3 h-3" />
                      Native macOS Support
                    </span>
                  )}
                  {targetModel.status === 'needs_spoof' && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950 text-amber-300 border border-amber-800">
                      <AlertTriangle className="w-3 h-3" />
                      WhateverGreen Spoof Required
                    </span>
                  )}
                  {targetModel.status === 'legacy_ventura' && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950 text-amber-300 border border-amber-800">
                      <AlertTriangle className="w-3 h-3" />
                      Legacy (Spoof on Ventura+)
                    </span>
                  )}
                  {targetModel.status === 'unsupported' && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-red-950 text-red-300 border border-red-800">
                      <XCircle className="w-3 h-3" />
                      Xe Architecture - Unsupported in macOS
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Detects hardware PCI Device ID from VBT PCIR header or manual selection, validating macOS driver compatibility
                </p>
              </div>
            </div>

            {/* Quick Presets / Selection */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <span>Select iGPU:</span>
                <select
                  value={deviceIdInput}
                  onChange={(e) => {
                    setDeviceIdInput(e.target.value);
                    setEnableSpoofOverride(null);
                    const matched = analyzeIgpuCompatibility(e.target.value);
                    if (
                      matched.detectedOrSelected.recommendedPlatformId &&
                      matched.detectedOrSelected.recommendedPlatformId !== 'UNSUPPORTED'
                    ) {
                      setPlatformId(matched.detectedOrSelected.recommendedPlatformId);
                    }
                  }}
                  className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                >
                  <optgroup label="10th Gen Comet Lake (Needs Spoof to 3E9B)">
                    <option value="9BC8">0x9BC8 - i7-10700 / i5-10600 UHD 630 (Desktop)</option>
                    <option value="9BC5">0x9BC5 - i5-10400 / i3-10100 UHD 630 (Desktop)</option>
                    <option value="9BC4">0x9BC4 - i7-10750H / i7-10875H UHD 630 (Mobile)</option>
                    <option value="9B41">0x9B41 - i3-10110U / i5-10210U UHD 620 (Mobile)</option>
                  </optgroup>
                  <optgroup label="8th / 9th Gen Coffee Lake (Native)">
                    <option value="3E9B">0x3E9B - i9-9900K / i7-9700K UHD 630 (Desktop)</option>
                    <option value="3E92">0x3E92 - i5-9600K / i5-8600K UHD 630 (Desktop)</option>
                    <option value="3E91">0x3E91 - i3-9100 / i3-8100 UHD 630 (Desktop)</option>
                    <option value="3EA5">0x3EA5 - Iris Plus 655 (MacBook Pro 13-inch)</option>
                    <option value="3EA0">0x3EA0 - Whiskey Lake UHD 620 (Needs Spoof)</option>
                  </optgroup>
                  <optgroup label="7th Gen Kaby Lake (Native)">
                    <option value="5912">0x5912 - i7-7700K / i5-7600K HD 630 (Desktop)</option>
                    <option value="5916">0x5916 - i7-7500U / i5-7200U HD 620 (Mobile)</option>
                    <option value="5926">0x5926 - i7-7567U Iris Plus 650 (NUC / Mobile)</option>
                  </optgroup>
                  <optgroup label="6th Gen Skylake (Native up to Monterey)">
                    <option value="1912">0x1912 - i7-6700K / i5-6600K HD 530 (Desktop)</option>
                    <option value="1916">0x1916 - i7-6500U / i5-6200U HD 520 (Mobile)</option>
                  </optgroup>
                  <optgroup label="10th Gen Ice Lake (Native)">
                    <option value="8A52">0x8A52 - i7-1065G7 Iris Plus G7 (Mobile)</option>
                  </optgroup>
                  <optgroup label="4th Gen Haswell (Legacy Native)">
                    <option value="0412">0x0412 - i7-4770K / i7-4790K HD 4600 (Desktop)</option>
                  </optgroup>
                  <optgroup label="11th - 14th Gen Intel Xe (UNSUPPORTED in macOS)">
                    <option value="4C8A">0x4C8A - 11th Gen Rocket Lake UHD 750 (Unsupported)</option>
                    <option value="9A49">0x9A49 - 11th Gen Tiger Lake Iris Xe (Unsupported)</option>
                    <option value="4680">0x4680 - 12th Gen Alder Lake UHD 770 (Unsupported)</option>
                    <option value="4682">0x4682 - 13th/14th Gen Raptor Lake UHD 770 (Unsupported)</option>
                  </optgroup>
                </select>
              </div>

              <div className="flex items-center gap-1 text-xs">
                <span className="text-slate-500 font-mono">0x</span>
                <input
                  type="text"
                  maxLength={4}
                  value={deviceIdInput}
                  onChange={(e) => {
                    const clean = e.target.value.toUpperCase().replace(/[^0-9A-F]/g, '');
                    setDeviceIdInput(clean);
                    setEnableSpoofOverride(null);
                  }}
                  className="w-16 font-mono bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-indigo-300 focus:outline-none focus:border-indigo-500 uppercase"
                  placeholder="9BC8"
                />
              </div>

              {/* Target macOS */}
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <span>Target macOS:</span>
                <select
                  value={targetMacos}
                  onChange={(e) => setTargetMacos(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                >
                  <option value="15.0">macOS 15 (Sequoia)</option>
                  <option value="14.0">macOS 14 (Sonoma)</option>
                  <option value="13.0">macOS 13 (Ventura)</option>
                  <option value="12.6">macOS 12 (Monterey)</option>
                  <option value="11.7">macOS 11 (Big Sur)</option>
                  <option value="10.15.7">macOS 10.15 (Catalina)</option>
                  <option value="10.14.4">macOS 10.14.4+ (Mojave Native 9th)</option>
                  <option value="10.14.3">macOS 10.14.3 (Mojave Spoof 9th)</option>
                  <option value="10.13.6">macOS 10.13.6 (High Sierra)</option>
                </select>
              </div>

              {/* Form Factor */}
              <div className="flex items-center gap-1 text-xs text-slate-400">
                <span>Profile:</span>
                <select
                  value={formFactor}
                  onChange={(e) => setFormFactor(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                >
                  <option value="auto">Auto (VBT Detect)</option>
                  <option value="desktop">Desktop</option>
                  <option value="mobile">Mobile / Laptop</option>
                  <option value="headless">Headless (Compute)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800 flex flex-col gap-1.5">
              <span className="text-slate-400 uppercase tracking-wider font-semibold text-[11px]">Hardware Model</span>
              <span className="font-semibold text-slate-100 text-sm">{targetModel.name}</span>
              <span className="text-slate-400 font-mono">{targetModel.generation} ({targetModel.architecture})</span>
              <div className="text-[11px] text-slate-500 mt-1">
                PCI ID: <code className="text-indigo-400">0x{targetModel.deviceId}</code>
                {parseResult?.detectedPcirDeviceId && (
                  <span className="ml-2 text-emerald-400 font-sans">(Auto-detected from Option ROM)</span>
                )}
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800 flex flex-col gap-1.5">
              <span className="text-slate-400 uppercase tracking-wider font-semibold text-[11px]">macOS Compatibility</span>
              <span className="font-semibold text-slate-100">{targetModel.macosVersionSupport}</span>
              <p className="text-slate-400 text-[11px] leading-relaxed">{targetModel.notes}</p>
              {targetModel.recommendedBootArgs && (
                <div className="mt-1 text-[11px]">
                  <span className="text-slate-500">Recommended boot-arg: </span>
                  <code className="text-cyan-400 font-mono">{targetModel.recommendedBootArgs}</code>
                </div>
              )}
            </div>

            <div className="p-3.5 rounded-lg bg-slate-950/70 border border-slate-800 flex flex-col justify-between gap-3">
              <div>
                <span className="text-slate-400 uppercase tracking-wider font-semibold text-[11px] block mb-1">
                  WhateverGreen Device-ID Injection
                </span>

                <label className="flex items-center gap-2 cursor-pointer mt-1">
                  <input
                    type="checkbox"
                    checked={isSpoofActive}
                    onChange={(e) => setEnableSpoofOverride(e.target.checked)}
                    className="w-4 h-4 rounded text-cyan-500 bg-slate-900 border-slate-700 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-xs font-medium text-slate-200">
                    Inject <code className="text-cyan-400 font-mono">device-id</code> spoof
                  </span>
                </label>
              </div>

              {isSpoofActive && (
                <div className="p-2.5 rounded bg-slate-900 border border-slate-800 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Target Spoof ID:</span>
                    <input
                      type="text"
                      maxLength={4}
                      value={customSpoofId || targetModel.recommendedSpoofDeviceId || '3E9B'}
                      onChange={(e) => setCustomSpoofId(e.target.value.toUpperCase().replace(/[^0-9A-F]/g, ''))}
                      className="w-16 font-mono bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-amber-300 focus:outline-none uppercase"
                    />
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    Value: <span className="text-emerald-400">&lt;{(customSpoofId || targetModel.recommendedSpoofDeviceId || '3E9B').slice(2, 4).toLowerCase()}{(customSpoofId || targetModel.recommendedSpoofDeviceId || '3E9B').slice(0, 2).toLowerCase()}0000&gt;</span>
                  </div>
                </div>
              )}

              {targetModel.status === 'unsupported' && (
                <p className="text-[11px] text-red-400 bg-red-950/50 p-2 rounded border border-red-900">
                  Note: 11th Gen+ Intel Xe graphics cannot be made to work with WhateverGreen. A compatible AMD discrete GPU (e.g. RX 6600, RX 580) is required for macOS GUI acceleration.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* v3.4.0 Advanced Framebuffer Flags & Options Panel */}
        <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden transition-all">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full px-5 py-3.5 flex items-center justify-between text-left bg-slate-900 hover:bg-slate-850 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <Sliders className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-white">Advanced Framebuffer Flags & Hardware Tuning</h3>
                  <span className="text-[11px] font-mono text-cyan-400 bg-cyan-950 px-1.5 py-0.5 rounded border border-cyan-800">
                    v3.4.0 Features
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  LSPCON HDMI 2.0 modes, Backlight register fix (macOS 13.4+), Bus ID routing sources, port counts & IntelFramebuffer.bt flags
                </p>
              </div>
            </div>
            <span className="text-xs font-medium text-cyan-400 hover:underline">
              {showAdvanced ? 'Hide Advanced Settings ▲' : 'Show Advanced Settings ▼'}
            </span>
          </button>

          {showAdvanced && (
            <div className="p-5 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs bg-slate-950/40">
              {/* Backlight Registers Fix */}
              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between gap-2">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">Backlight Register Fix</span>
                    <span className="text-[10px] font-mono text-slate-500">--backlight-fix</span>
                  </div>
                  <p className="text-slate-400 text-[11px] mt-1 leading-relaxed">
                    Fixes laptop brightness PWM registers on KBL/CFL/ICL. Automatically switches to{' '}
                    <code className="text-cyan-400 font-mono">enable-backlight-registers-alternative-fix</code> on macOS 13.4+ per the FAQ.
                  </p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer mt-2 pt-2 border-t border-slate-800">
                  <input
                    type="checkbox"
                    checked={backlightFix}
                    onChange={(e) => setBacklightFix(e.target.checked)}
                    className="w-4 h-4 rounded text-cyan-500 bg-slate-950 border-slate-700 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-slate-300 font-medium">Inject Backlight Fix</span>
                </label>
              </div>

              {/* LSPCON HDMI 2.0 Mode */}
              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between gap-2">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">LSPCON HDMI 2.0 Mode</span>
                    <span className="text-[10px] font-mono text-slate-500">--lspcon-mode</span>
                  </div>
                  <p className="text-slate-400 text-[11px] mt-1 leading-relaxed">
                    Sets preferred mode for onboard Level Shifter / Protocol Converter chips (DP to HDMI 2.0 4K@60Hz).
                  </p>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800">
                  <select
                    value={lspconMode}
                    onChange={(e) => setLspconMode(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">Auto / VBT Default</option>
                    <option value="pcon">pcon - Protocol Converter (DP &rarr; HDMI 2.0 4K@60)</option>
                    <option value="ls">ls - Level Shifter (HDMI 1.4 4K@30)</option>
                  </select>
                </div>
              </div>

              {/* Bus ID Source */}
              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between gap-2">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">Bus ID Source</span>
                    <span className="text-[10px] font-mono text-slate-500">--bus-id-source</span>
                  </div>
                  <p className="text-slate-400 text-[11px] mt-1 leading-relaxed">
                    Derive Apple Bus IDs from physical DDI routing (standard) or legacy VBT ddc_pin (experimental GMBUS pins 4, 5, 6).
                  </p>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-800">
                  <select
                    value={busIdSource}
                    onChange={(e) => setBusIdSource(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="ddi">DDI Routing (Standard: B=0x05, C=0x04, D=0x06)</option>
                    <option value="ddc">DDC GMBUS Pins (Experimental)</option>
                  </select>
                </div>
              </div>

              {/* Laptop Mode & Portcount */}
              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between gap-2">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">Mobile Laptop Mode</span>
                    <span className="text-[10px] font-mono text-slate-500">--mobile</span>
                  </div>
                  <p className="text-slate-400 text-[11px] mt-1 leading-relaxed">
                    Restricts to at most 3 connectors (con0..con2) and injects <code className="text-cyan-400 font-mono">framebuffer-portcount = 3</code>.
                  </p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer mt-2 pt-2 border-t border-slate-800">
                  <input
                    type="checkbox"
                    checked={mobileMode}
                    onChange={(e) => setMobileMode(e.target.checked)}
                    className="w-4 h-4 rounded text-cyan-500 bg-slate-950 border-slate-700 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-slate-300 font-medium">Force Laptop 3-Port Constraint</span>
                </label>
              </div>

              {/* First Connector Index & Pipe Override */}
              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between gap-2">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">Connector Index & Pipe</span>
                    <span className="text-[10px] font-mono text-slate-500">--first-con / --pipe</span>
                  </div>
                  <p className="text-slate-400 text-[11px] mt-1 leading-relaxed">
                    Set first patch index (default: con0 for laptops, con1 for desktops) or override hardware pipe.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-800">
                  <div>
                    <span className="text-[11px] text-slate-400 block mb-1">First Con:</span>
                    <select
                      value={firstConIndex}
                      onChange={(e) => setFirstConIndex(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                    >
                      <option value="">Auto (Default)</option>
                      <option value="0">con0</option>
                      <option value="1">con1</option>
                      <option value="2">con2</option>
                    </select>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block mb-1">Pipe Override:</span>
                    <input
                      type="text"
                      placeholder="e.g. 18"
                      value={pipeOverride}
                      onChange={(e) => setPipeOverride(e.target.value.replace(/[^0-9]/g, ''))}
                      className="w-full font-mono bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                    />
                  </div>
                </div>
              </div>

              {/* Custom Framebuffer Flags & Connector Flags */}
              <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between gap-2">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">Custom Hex Flags</span>
                    <span className="text-[10px] font-mono text-slate-500">--fb-flags / --con-flags</span>
                  </div>
                  <p className="text-slate-400 text-[11px] mt-1 leading-relaxed">
                    Inject specific bitmasks from <code className="text-cyan-400 font-mono">IntelFramebuffer.bt</code> for power wells and aperture.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-800">
                  <div>
                    <span className="text-[11px] text-slate-400 block mb-1">FB Flags:</span>
                    <input
                      type="text"
                      placeholder="0xE30B0A"
                      value={fbFlags}
                      onChange={(e) => setFbFlags(e.target.value)}
                      className="w-full font-mono bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                    />
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block mb-1">Con Flags:</span>
                    <input
                      type="text"
                      placeholder="0x3C7"
                      value={conFlags}
                      onChange={(e) => setConFlags(e.target.value)}
                      className="w-full font-mono bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
        {parseResult && (
          <section className="bg-slate-900/60 border border-slate-800/80 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-3 text-slate-400">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">VBT Offset:</span>
                <span className="font-mono text-slate-200">0x{parseResult.vbtOffset.toString(16).padStart(4, '0').toUpperCase()}</span>
              </div>
              <span className="text-slate-700">·</span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">VBT Version:</span>
                <span className="font-mono text-slate-200">0x{parseResult.vbtVersion.toString(16).padStart(4, '0').toUpperCase()}</span>
              </div>
              <span className="text-slate-700">·</span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">BDB Offset:</span>
                <span className="font-mono text-slate-200">0x{parseResult.bdbOffset.toString(16).padStart(4, '0').toUpperCase()}</span>
              </div>
              <span className="text-slate-700">·</span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">BDB Version:</span>
                <span className="font-mono text-slate-200">{parseResult.bdbVersion}</span>
              </div>
              <span className="text-slate-700">·</span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">Child Device Stride:</span>
                <span className="font-mono text-slate-200">{parseResult.stride} bytes</span>
              </div>
              {parseResult.detectedPcirDeviceId && (
                <>
                  <span className="text-slate-700">·</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-500">ROM PCI ID:</span>
                    <span className="font-mono text-indigo-400 font-semibold">0x{parseResult.detectedPcirDeviceId}</span>
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-500">Active Routing:</span>
              <span className="font-mono font-medium text-emerald-400">
                {parseResult.activeDevices.length} physical outputs mapped
              </span>
            </div>
          </section>
        )}

        {/* Parse Error Notification */}
        {parseError && (
          <div className="p-4 rounded-xl bg-red-950/40 border border-red-800 text-red-300 text-xs flex items-start gap-3">
            <div className="w-5 h-5 rounded-full bg-red-900/50 flex items-center justify-center text-red-200 shrink-0">
              !
            </div>
            <div>
              <p className="font-semibold mb-1">Failed to Parse VBT Binary</p>
              <p className="text-red-400 font-mono">{parseError}</p>
              <p className="mt-2 text-slate-400">
                Ensure you are providing a genuine Intel Video BIOS Table extracted from UEFI or Linux sysfs.
              </p>
            </div>
          </div>
        )}

        {/* View Tabs Bar */}
        <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
          <button
            onClick={() => setActiveTab('diagram')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'diagram'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Rosetta Routing Diagram</span>
          </button>

          <button
            onClick={() => setActiveTab('compatibility')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'compatibility'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>iGPU Database & Spoofing Matrix</span>
          </button>

          <button
            onClick={() => setActiveTab('table')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'table'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Connector Summary Table</span>
          </button>

          <button
            onClick={() => setActiveTab('xml')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'xml'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>OpenCore DeviceProperties XML</span>
          </button>

          <button
            onClick={() => setActiveTab('merge')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'merge'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Merge into config.plist</span>
          </button>

          <button
            onClick={() => setActiveTab('terminal')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'terminal'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>ASCII Terminal Output</span>
          </button>

          <button
            onClick={() => setActiveTab('hex')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'hex'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
            <span>VBT Blocks & Hex Inspector</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('cli');
              if (!cliOutput) executeBackendCli(false);
            }}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === 'cli'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Play className="w-3.5 h-3.5" />
            <span>CLI Runner & Guide</span>
          </button>
        </div>

        {/* Tab 1: Rosetta Stone Visual Connector Routing Diagram */}
        {activeTab === 'diagram' && parseResult && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-cyan-400" />
                  Intel Hardware Routing → Apple Framebuffer Translation
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  How physical Intel DDI outputs from VBT Block 0x28 are dynamically translated to WhateverGreen conX parameters
                </p>
              </div>

              <button
                onClick={() => copyToClipboard(generatedXml, 'diagram_xml')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              >
                {copiedKey === 'diagram_xml' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'diagram_xml' ? 'Copied' : 'Copy Patch XML'}</span>
              </button>
            </div>

            {/* Visual Flow Lines */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
              {/* Left Column: Intel Physical Hardware Ports */}
              <div className="flex flex-col gap-4">
                <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>
                  Intel Motherboard VBT Physical Ports
                </span>

                {parseResult.activeDevices.map((dev) => (
                  <div
                    key={`intel-${dev.index}`}
                    className="p-4 rounded-lg bg-slate-950/70 border border-blue-900/40 hover:border-blue-500/50 transition-all flex flex-col gap-2 relative group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-sm text-blue-400">{dev.intelPortName}</span>
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-blue-950/80 text-blue-300 border border-blue-800/50">
                        DVO 0x{dev.dvoPort.toString(16).padStart(2, '0').toUpperCase()}
                      </span>
                    </div>

                    <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
                      <span>Connector: <strong className="text-slate-200">{dev.connectorName}</strong></span>
                      <span className="text-slate-600">·</span>
                      <span>DDC Pin: <code className="text-blue-300">0x{dev.ddcPin.toString(16).padStart(2, '0')}</code></span>
                      <span className="text-slate-600">·</span>
                      <span>AUX Ch: <code className="text-blue-300">0x{dev.auxChannel.toString(16).padStart(2, '0')}</code></span>
                      <span className="text-slate-600">·</span>
                      <span>HPD: <code className="text-blue-300">0x{dev.hpdPin.toString(16).padStart(2, '0')}</code></span>
                    </div>

                    <div className="text-xs font-mono text-slate-500">
                      device_type: 0x{dev.deviceType.toString(16).padStart(4, '0').toUpperCase()}
                    </div>
                  </div>
                ))}
              </div>

              {/* Right Column: macOS Apple Framebuffer Connectors */}
              <div className="flex flex-col gap-4">
                <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                  macOS WhateverGreen Connector Patches
                </span>

                {parseResult.activeDevices.map((dev, idx) => (
                  <div
                    key={`apple-${dev.index}`}
                    className="p-4 rounded-lg bg-slate-950/70 border border-emerald-900/40 hover:border-emerald-500/50 transition-all flex flex-col gap-2 relative group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-sm text-emerald-400">framebuffer-con{idx}</span>
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/50">
                        Apple Bus ID: 0x{dev.appleBusId.toString(16).padStart(2, '0').toUpperCase()}
                      </span>
                    </div>

                    <div className="text-xs text-slate-400 flex flex-wrap items-center gap-2">
                      <span>Type: <strong className="text-slate-200 font-mono">{dev.appleConTypeHex}</strong></span>
                      <span className="text-slate-600">·</span>
                      <span>Base64: <code className="text-emerald-300">{dev.appleConTypeBase64}</code></span>
                      <span className="text-slate-600">·</span>
                      <span>Pipe: <code className="text-emerald-300">{dev.pipe} (0x0{dev.pipe})</code></span>
                    </div>

                    <div className="text-xs font-mono text-slate-500">
                      busid: &lt;{dev.appleBusId.toString(16).padStart(2, '0')}000000&gt;
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Translation Logic Reference Card */}
            <div className="mt-4 p-4 rounded-lg bg-slate-950/50 border border-slate-800 text-xs text-slate-400">
              <span className="font-semibold text-slate-300 uppercase tracking-wider block mb-2">
                Rosetta Stone Translation Rules Applied:
              </span>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <li className="flex items-center gap-2">
                  <ArrowRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>DDI A / eDP → Bus ID 0x00, Connector Type 0x00020000 (Internal Panel)</span>
                </li>
                <li className="flex items-center gap-2">
                  <ArrowRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>DDI B → Bus ID 0x05 (Base64: BQAAAA==)</span>
                </li>
                <li className="flex items-center gap-2">
                  <ArrowRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>DDI C → Bus ID 0x04 (Base64: BAAAAA==)</span>
                </li>
                <li className="flex items-center gap-2">
                  <ArrowRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>DDI D → Bus ID 0x06 (Base64: BgAAAA==)</span>
                </li>
                <li className="flex items-center gap-2">
                  <ArrowRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>DisplayPort (DP) → 0x00040000 (Base64: AAQAAA==)</span>
                </li>
                <li className="flex items-center gap-2">
                  <ArrowRight className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>HDMI / DVI-D (TMDS) → 0x00080000 (Base64: AAgAAA==)</span>
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* Tab: iGPU Database & Spoofing Matrix */}
        {activeTab === 'compatibility' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col gap-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-cyan-400" />
                Intel iGPU Architecture & macOS WhateverGreen Compatibility Matrix
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Complete reference table of Intel integrated graphics generations, native support status, and spoofing targets.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 font-medium border-b border-slate-800 uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="px-4 py-3">PCI Device ID</th>
                    <th className="px-4 py-3">Microarchitecture</th>
                    <th className="px-4 py-3">iGPU Model</th>
                    <th className="px-4 py-3">macOS Status</th>
                    <th className="px-4 py-3">Spoof Target</th>
                    <th className="px-4 py-3">Recommended Platform ID</th>
                    <th className="px-4 py-3">Supported macOS</th>
                    <th className="px-4 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {Object.entries(IGPU_DATABASE).map(([id, item]) => (
                    <tr
                      key={id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        deviceIdInput.toUpperCase() === id ? 'bg-cyan-950/30' : ''
                      }`}
                    >
                      <td className="px-4 py-3 font-bold text-cyan-400">0x{id}</td>
                      <td className="px-4 py-3 text-slate-300 font-sans">{item.generation}</td>
                      <td className="px-4 py-3 text-slate-200 font-sans">{item.name}</td>
                      <td className="px-4 py-3 font-sans">
                        {item.status === 'native' && (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
                            NATIVE
                          </span>
                        )}
                        {item.status === 'needs_spoof' && (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950 text-amber-300 border border-amber-800">
                            NEEDS_SPOOF
                          </span>
                        )}
                        {item.status === 'legacy_ventura' && (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950 text-amber-300 border border-amber-800">
                            LEGACY
                          </span>
                        )}
                        {item.status === 'unsupported' && (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-red-950 text-red-300 border border-red-800">
                            UNSUPPORTED
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-amber-300">
                        {item.recommendedSpoofDeviceId ? `0x${item.recommendedSpoofDeviceId}` : 'None (Native)'}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {item.recommendedPlatformId !== 'UNSUPPORTED' ? `<${item.recommendedPlatformId}>` : 'None'}
                      </td>
                      <td className="px-4 py-3 text-slate-400 font-sans">{item.macosVersionSupport}</td>
                      <td className="px-4 py-3 font-sans">
                        <button
                          onClick={() => {
                            setDeviceIdInput(id);
                            if (item.recommendedPlatformId && item.recommendedPlatformId !== 'UNSUPPORTED') {
                              setPlatformId(item.recommendedPlatformId);
                            }
                            setEnableSpoofOverride(null);
                            setActiveTab('diagram');
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium bg-slate-800 hover:bg-cyan-600 hover:text-white rounded border border-slate-700 transition-colors"
                        >
                          Select
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: Detailed Connector Table */}
        {activeTab === 'table' && parseResult && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Parsed Display Connector Routing</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Extracted from VBT Child Devices block (Block 0x28 / 0x02)
                </p>
              </div>
              <span className="text-xs font-mono text-slate-400">
                {parseResult.activeDevices.length} active / {parseResult.allDevices.length} total entries
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 text-slate-400 font-medium border-b border-slate-800 uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="px-4 py-3">Connector</th>
                    <th className="px-4 py-3">Intel Port</th>
                    <th className="px-4 py-3">DVO Port</th>
                    <th className="px-4 py-3">Device Type</th>
                    <th className="px-4 py-3">Connector</th>
                    <th className="px-4 py-3">Apple Bus ID</th>
                    <th className="px-4 py-3">macOS Type (Hex)</th>
                    <th className="px-4 py-3">macOS Type (Base64)</th>
                    <th className="px-4 py-3">Pipe</th>
                    <th className="px-4 py-3">DDC/AUX</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {parseResult.activeDevices.map((dev, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-4 py-3 font-semibold text-cyan-400">con{idx}</td>
                      <td className="px-4 py-3 text-slate-200 font-sans">{dev.intelPortName}</td>
                      <td className="px-4 py-3 text-slate-400">0x{dev.dvoPort.toString(16).padStart(2, '0').toUpperCase()}</td>
                      <td className="px-4 py-3 text-slate-400">0x{dev.deviceType.toString(16).padStart(4, '0').toUpperCase()}</td>
                      <td className="px-4 py-3 font-sans">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                          dev.connectorName === 'eDP'
                            ? 'bg-purple-950 text-purple-300 border border-purple-800'
                            : dev.connectorName === 'DP'
                            ? 'bg-blue-950 text-blue-300 border border-blue-800'
                            : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                        }`}>
                          {dev.connectorName}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-emerald-400 font-bold">0x{dev.appleBusId.toString(16).padStart(2, '0').toUpperCase()}</td>
                      <td className="px-4 py-3 text-slate-300">{dev.appleConTypeHex}</td>
                      <td className="px-4 py-3 text-slate-400">{dev.appleConTypeBase64}</td>
                      <td className="px-4 py-3 text-slate-300">{dev.pipe} (0x0{dev.pipe})</td>
                      <td className="px-4 py-3 text-slate-400 font-sans">
                        DDC: {dev.ddcPin} / AUX: {dev.auxChannel}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: OpenCore XML Snippet */}
        {activeTab === 'xml' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">
                  OpenCore DeviceProperties XML
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Paste directly under DeviceProperties → Add in config.plist
                  {isSpoofActive && (
                    <span className="ml-2 text-amber-300 font-semibold">
                      (Includes WhateverGreen device-id spoof to 0x{effectiveSpoofId})
                    </span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyToClipboard(generatedXml, 'xml_copy')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                >
                  {copiedKey === 'xml_copy' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'xml_copy' ? 'Copied XML' : 'Copy XML'}</span>
                </button>

                <button
                  onClick={downloadXml}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-cyan-600 hover:bg-cyan-500 text-white transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .xml</span>
                </button>
              </div>
            </div>

            <pre className="p-4 font-mono text-xs leading-relaxed text-slate-300 bg-slate-950 overflow-x-auto max-h-[600px] select-all">
              {generatedXml}
            </pre>
          </div>
        )}

        {/* Tab 4: Direct config.plist Merger */}
        {activeTab === 'merge' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col gap-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Automatic config.plist Framebuffer Injection
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Upload your existing OpenCore config.plist. The vbt2fbpatch Python utility's plistlib engine will safely merge the exact PciRoot(0x0)/Pci(0x2,0x0) properties into DeviceProperties → Add.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Input Plist */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Input config.plist
                  </span>
                  <input
                    ref={plistInputRef}
                    type="file"
                    accept=".plist,.xml"
                    onChange={handlePlistUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => plistInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                  >
                    <FileUp className="w-3.5 h-3.5" />
                    <span>Upload config.plist</span>
                  </button>
                </div>

                <textarea
                  value={uploadedPlist}
                  onChange={(e) => setUploadedPlist(e.target.value)}
                  placeholder="Paste or upload your OpenCore config.plist XML content here..."
                  className="w-full h-80 bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs text-slate-300 focus:outline-none focus:border-cyan-500 resize-none"
                />

                <button
                  disabled={!uploadedPlist || mergeLoading}
                  onClick={executePlistMerge}
                  className={`py-2 px-4 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                    uploadedPlist && !mergeLoading
                      ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-md'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{mergeLoading ? 'Merging via Python plistlib...' : 'Merge Framebuffer Patch into Plist'}</span>
                </button>

                {mergeError && (
                  <p className="text-xs text-red-400 font-mono bg-red-950/40 p-2.5 rounded border border-red-800">
                    {mergeError}
                  </p>
                )}
              </div>

              {/* Output Merged Plist */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Patched Output config.plist
                  </span>
                  {mergedPlist && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyToClipboard(mergedPlist, 'merged_plist')}
                        className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
                      >
                        {copiedKey === 'merged_plist' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>Copy</span>
                      </button>

                      <button
                        onClick={() => {
                          const blob = new Blob([mergedPlist], { type: 'application/x-plist' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = 'config.plist';
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-emerald-600 hover:bg-emerald-500 text-white"
                      >
                        <Download className="w-3 h-3" />
                        <span>Download config.plist</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="relative">
                  <textarea
                    readOnly
                    value={mergedPlist}
                    placeholder="Merged config.plist will appear here after clicking merge..."
                    className="w-full h-80 bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs text-slate-300 focus:outline-none resize-none"
                  />
                  {mergedPlist && (
                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded text-[11px] bg-emerald-950/90 text-emerald-300 border border-emerald-800/80">
                      Successfully Injected
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 5: Terminal ASCII Output */}
        {activeTab === 'terminal' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-cyan-400" />
                  Terminal CLI ASCII Table Output
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Exact terminal render produced by vbt2fbpatch CLI
                </p>
              </div>

              <button
                onClick={() => copyToClipboard(asciiTable, 'ascii_copy')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
              >
                {copiedKey === 'ascii_copy' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'ascii_copy' ? 'Copied' : 'Copy Table'}</span>
              </button>
            </div>

            <pre className="p-6 font-mono text-xs leading-normal text-emerald-400 bg-slate-950 overflow-x-auto select-all">
              {asciiTable}
            </pre>
          </div>
        )}

        {/* Tab 6: Hex & BDB Blocks Inspector */}
        {activeTab === 'hex' && parseResult && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col gap-6">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Code className="w-4 h-4 text-cyan-400" />
                VBT & BDB Block Structure Inspector
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Discovered BDB data blocks within the Video BIOS Table
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {parseResult.blocks.map((b) => (
                <div
                  key={b.id}
                  className={`p-3 rounded-lg border text-xs flex flex-col gap-1 ${
                    b.id === 0x28 || b.id === 0x02
                      ? 'bg-cyan-950/40 border-cyan-500/50 text-cyan-200'
                      : 'bg-slate-950 border-slate-800 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between font-mono font-semibold">
                    <span>Block 0x{b.id.toString(16).padStart(2, '0').toUpperCase()}</span>
                    <span className="text-slate-400 text-[11px]">{b.size} bytes</span>
                  </div>
                  <span className="font-sans text-slate-400">{b.name}</span>
                  <span className="font-mono text-[11px] text-slate-500">Offset: 0x{b.offset.toString(16).toUpperCase()}</span>
                </div>
              ))}
            </div>

            {/* Hex Dump of Child Device block */}
            {vbtBinary && (
              <div className="flex flex-col gap-2 mt-2">
                <span className="text-xs font-semibold text-slate-300">Raw VBT Binary Hex Preview (First 256 bytes):</span>
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg font-mono text-[11px] text-slate-400 overflow-x-auto leading-relaxed">
                  {Array.from({ length: Math.min(Math.ceil(vbtBinary.length / 16), 16) }).map((_, row) => {
                    const offset = row * 16;
                    const chunk = vbtBinary.slice(offset, offset + 16);
                    const hexPart = Array.from(chunk)
                      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
                      .join(' ');
                    const asciiPart = Array.from(chunk)
                      .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
                      .join('');
                    return (
                      <div key={row} className="flex gap-4">
                        <span className="text-cyan-500">{offset.toString(16).padStart(4, '0').toUpperCase()}:</span>
                        <span className="text-slate-300">{hexPart.padEnd(48, ' ')}</span>
                        <span className="text-slate-500">|{asciiPart}|</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 7: CLI Runner & Guide */}
        {activeTab === 'cli' && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col gap-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-cyan-400" />
                  Live Python 3 Execution & Instructions
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Run the zero-dependency Python script directly on the server, or run it on your local machine.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => executeBackendCli(false)}
                  disabled={cliRunning}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-cyan-600 hover:bg-cyan-500 text-white transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{cliRunning ? 'Running CLI...' : 'Run CLI on Current VBT'}</span>
                </button>

                <button
                  onClick={() => executeBackendCli(true)}
                  disabled={cliRunning}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                >
                  <span>Run with --json</span>
                </button>
              </div>
            </div>

            {/* Live CLI Output Console */}
            {cliOutput && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase font-mono text-slate-400">Execution Output (stdout / stderr):</span>
                  <button
                    onClick={() => copyToClipboard(cliOutput, 'cli_output')}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200"
                  >
                    {copiedKey === 'cli_output' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>Copy Output</span>
                  </button>
                </div>
                <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-400 overflow-x-auto max-h-96">
                  {cliOutput}
                </pre>
              </div>
            )}

            {/* Quick Command Cheatsheet */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-2">
                <span className="text-xs font-semibold text-slate-200">1. Extract VBT on Linux</span>
                <p className="text-xs text-slate-400">
                  Run in terminal to dump the active Intel VBT binary directly from the i915 DRM driver:
                </p>
                <div className="p-2.5 rounded bg-slate-900 font-mono text-xs text-cyan-300 flex items-center justify-between">
                  <span className="overflow-x-auto">sudo cat /sys/kernel/debug/dri/0/i915_vbt &gt; vbt.bin</span>
                  <button
                    onClick={() =>
                      copyToClipboard('sudo cat /sys/kernel/debug/dri/0/i915_vbt > vbt.bin', 'cmd_extract')
                    }
                    className="ml-2 p-1 text-slate-400 hover:text-slate-200"
                  >
                    {copiedKey === 'cmd_extract' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 flex flex-col gap-2">
                <span className="text-xs font-semibold text-slate-200">2. Run vbt2fbpatch CLI with Active Options</span>
                <p className="text-xs text-slate-400">
                  Generate OpenCore patch with active WhateverGreen spoofing & options, merging directly into config.plist:
                </p>
                {(() => {
                  const cmd = [
                    'python3 vbt2fbpatch.py',
                    `-i ${fileName || 'vbt.bin'}`,
                    deviceIdInput ? `-d ${deviceIdInput}` : '',
                    platformId ? `-p ${platformId}` : '',
                    targetMacos && targetMacos !== '14.0' ? `-t ${targetMacos}` : '',
                    formFactor && formFactor !== 'auto' ? `-f ${formFactor}` : '',
                    backlightFix ? '--backlight-fix' : '',
                    mobileMode ? '--mobile' : '',
                    firstConIndex !== '' ? `--first-con ${firstConIndex}` : '',
                    busIdSource !== 'ddi' ? `--bus-id-source ${busIdSource}` : '',
                    lspconMode ? `--lspcon-mode ${lspconMode}` : '',
                    pipeOverride !== '' ? `--pipe ${pipeOverride}` : '',
                    conFlags ? `--con-flags ${conFlags}` : '',
                    fbFlags ? `--fb-flags ${fbFlags}` : '',
                    '-m config.plist',
                  ].filter(Boolean).join(' ');
                  return (
                    <div className="p-2.5 rounded bg-slate-900 font-mono text-xs text-cyan-300 flex items-center justify-between">
                      <span className="overflow-x-auto whitespace-nowrap">{cmd}</span>
                      <button
                        onClick={() => copyToClipboard(cmd, 'cmd_run')}
                        className="ml-2 p-1 text-slate-400 hover:text-slate-200 shrink-0"
                      >
                        {copiedKey === 'cmd_run' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* CLI Python Code Preview */}
            {cliSourceCode && (
              <div className="flex flex-col gap-2 mt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-300">vbt2fbpatch.py (100% Standalone Single-File Script):</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-400 border border-emerald-800">
                      Zero Dependencies · No Companion Modules
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <a
                      href="/api/download-cli"
                      download="vbt2fbpatch.py"
                      className="text-xs text-cyan-400 hover:underline flex items-center gap-1 font-medium"
                    >
                      <Download className="w-3 h-3" />
                      <span>Download Standalone vbt2fbpatch.py</span>
                    </a>
                    <span className="text-slate-600">|</span>
                    <a
                      href="/api/download-cli?legacy=1"
                      download="vbt2opencore.py"
                      className="text-xs text-slate-400 hover:underline flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" />
                      <span>Standalone vbt2opencore.py</span>
                    </a>
                  </div>
                </div>
                <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 max-h-80 overflow-y-auto">
                  {cliSourceCode}
                </pre>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-950 text-slate-500 py-4 px-6 text-xs text-center flex flex-col sm:flex-row items-center justify-between gap-2">
        <p>
          vbt2fbpatch v3.4.0 · Intel Video BIOS Table connector routing & WhateverGreen framebuffer patcher for macOS
        </p>
        <p className="text-[11px] text-slate-500">
          Copyright &copy; 2026 5T33Z0 · MIT License · Zero external Python dependencies
        </p>
      </footer>
    </div>
  );
}
