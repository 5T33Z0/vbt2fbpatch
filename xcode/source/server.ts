import http from 'http';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Explicitly disable HMR in AI Studio environment to prevent WebSocket transport errors
process.env.DISABLE_HMR = 'true';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = process.env.PORT || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '20mb' }));

  // Ensure samples directory exists
  const samplesDir = path.join(__dirname, 'samples');
  if (!fs.existsSync(samplesDir)) {
    fs.mkdirSync(samplesDir, { recursive: true });
  }

  // API Route: Download vbt2fbpatch.py CLI script
  app.get('/api/download-cli', (req, res) => {
    const isLegacy = req.query.legacy === 'true' || req.query.legacy === '1';
    const filename = isLegacy ? 'vbt2opencore.py' : 'vbt2fbpatch.py';
    const scriptPath = path.join(__dirname, filename);
    if (!fs.existsSync(scriptPath)) {
      res.status(404).send('CLI script not found');
      return;
    }
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'text/x-python');
    fs.createReadStream(scriptPath).pipe(res);
  });

  // API Route: Get script content as plain text
  app.get('/api/cli-code', (_req, res) => {
    const scriptPath = path.join(__dirname, 'vbt2fbpatch.py');
    if (!fs.existsSync(scriptPath)) {
      res.status(404).json({ error: 'CLI script not found' });
      return;
    }
    const code = fs.readFileSync(scriptPath, 'utf-8');
    res.json({ code });
  });

  // API Route: List sample VBT files
  app.get('/api/samples', (_req, res) => {
    const samples = [
      {
        id: 'cfl_desktop_vbt.bin',
        name: 'Coffee Lake Desktop (i9-9900K / UHD 630)',
        description: 'Asus ROG Z390 / DDI B (HDMI), DDI C (DP), DDI D (DP)',
        platform_id: '07009B3E',
        device_id: '3E9B',
        type: 'desktop',
      },
      {
        id: 'cml_laptop_vbt.bin',
        name: 'Comet Lake Laptop (i7-10750H / UHD 630 - Needs Spoof)',
        description: 'Dell XPS 15 / DDI A (eDP Native Panel), DDI B (HDMI 2.0)',
        platform_id: '00009B3E',
        device_id: '9BC4',
        type: 'laptop',
      },
      {
        id: 'kbl_nuc_vbt.bin',
        name: 'Kaby Lake Mini-PC / NUC (i7-7567U / Iris Plus 650)',
        description: 'Intel NUC7 / DDI B (HDMI), DDI C (DP over USB-C)',
        platform_id: '00001659',
        device_id: '5926',
        type: 'nuc',
      },
      {
        id: 'block28_direct_vbt.bin',
        name: 'Block 0x28 Direct Child Devices VBT',
        description: 'VBT with Block ID 0x28 (40 dec) / DDI B (DP), DDI C (DVI-D)',
        platform_id: '07009B3E',
        device_id: '3E9B',
        type: 'custom',
      },
      {
        id: 'oem_checksum_dc_vbt.bin',
        name: 'OEM BIOS Dump (Checksum 0xDC / Standard BDB)',
        description: 'Standard Intel VBT with 0x1C bdb_offset and 0xDC checksum',
        platform_id: '07009B3E',
        device_id: '3E98',
        type: 'oem',
      },
    ];
    res.json({ samples });
  });

  // API Route: Get sample VBT as base64
  app.get('/api/samples/:name', (req, res) => {
    const filename = path.basename(req.params.name);
    const filePath = path.join(samplesDir, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Sample not found' });
      return;
    }
    const buf = fs.readFileSync(filePath);
    res.json({
      name: filename,
      size: buf.length,
      base64: buf.toString('base64'),
    });
  });

  // API Route: Run python vbt2fbpatch.py
  app.post('/api/run-cli', (req, res) => {
    const {
      vbt_base64,
      sample_id,
      platform_id,
      device_id,
      detect_device_id = false,
      spoof_id,
      target_macos,
      form_factor,
      unifiedmem = false,
      rps_control = false,
      backlight_fix = false,
      mobile = false,
      first_con,
      bus_id_source,
      pipe,
      con_flags,
      fb_flags,
      lspcon_mode,
      verbose = false,
      json_mode = false,
    } = req.body;

    let vbtBuffer: Buffer;
    if (vbt_base64) {
      try {
        vbtBuffer = Buffer.from(vbt_base64, 'base64');
      } catch {
        res.status(400).json({ error: 'Invalid base64 payload' });
        return;
      }
    } else if (sample_id) {
      const samplePath = path.join(samplesDir, path.basename(sample_id));
      if (!fs.existsSync(samplePath)) {
        res.status(404).json({ error: 'Sample file not found' });
        return;
      }
      vbtBuffer = fs.readFileSync(samplePath);
    } else {
      res.status(400).json({ error: 'Missing vbt_base64 or sample_id' });
      return;
    }

    const tmpVbtPath = path.join('/tmp', `vbt_${Date.now()}_${Math.random().toString(36).substring(7)}.bin`);
    fs.writeFileSync(tmpVbtPath, vbtBuffer);

    const cliArgs = ['vbt2fbpatch.py', '-i', tmpVbtPath];
    if (platform_id) {
      cliArgs.push('-p', platform_id);
    }
    if (device_id) {
      cliArgs.push('-d', device_id);
    } else if (detect_device_id) {
      cliArgs.push('--detect-device-id');
    }
    if (spoof_id) {
      cliArgs.push('--spoof-id', spoof_id);
    }
    if (target_macos) {
      cliArgs.push('-t', target_macos);
    }
    if (form_factor && form_factor !== 'auto') {
      cliArgs.push('-f', form_factor);
    }
    if (unifiedmem) {
      cliArgs.push('--unifiedmem');
    }
    if (rps_control) {
      cliArgs.push('--rps-control');
    }
    if (backlight_fix) {
      cliArgs.push('--backlight-fix');
    }
    if (mobile) {
      cliArgs.push('--mobile');
    }
    if (first_con !== undefined && first_con !== null && first_con !== '') {
      cliArgs.push('--first-con', String(first_con));
    }
    if (bus_id_source && bus_id_source !== 'ddi') {
      cliArgs.push('--bus-id-source', bus_id_source);
    }
    if (pipe !== undefined && pipe !== null && pipe !== '') {
      cliArgs.push('--pipe', String(pipe));
    }
    if (con_flags) {
      cliArgs.push('--con-flags', con_flags);
    }
    if (fb_flags) {
      cliArgs.push('--fb-flags', fb_flags);
    }
    if (lspcon_mode) {
      cliArgs.push('--lspcon-mode', lspcon_mode);
    }
    if (verbose) {
      cliArgs.push('--verbose');
    }
    if (json_mode) {
      cliArgs.push('--json');
    }

    execFile('python3', cliArgs, { cwd: __dirname }, (error, stdout, stderr) => {
      try {
        if (fs.existsSync(tmpVbtPath)) {
          fs.unlinkSync(tmpVbtPath);
        }
      } catch {
        // ignore
      }

      if (error && !stdout) {
        res.status(500).json({
          error: error.message,
          stderr,
          stdout,
        });
        return;
      }

      let parsedJson = null;
      if (json_mode) {
        try {
          parsedJson = JSON.parse(stdout);
        } catch {
          // fallback
        }
      }

      res.json({
        success: !error,
        stdout,
        stderr,
        parsedJson,
      });
    });
  });

  // API Route: Merge into config.plist using python CLI
  app.post('/api/merge-plist', (req, res) => {
    const {
      vbt_base64,
      sample_id,
      plist_content,
      platform_id,
      device_id,
      detect_device_id = false,
      spoof_id,
      target_macos,
      form_factor,
      unifiedmem = false,
      rps_control = false,
      backlight_fix = false,
      mobile = false,
      first_con,
      bus_id_source,
      pipe,
      con_flags,
      fb_flags,
      lspcon_mode,
    } = req.body;

    if (!plist_content) {
      res.status(400).json({ error: 'Missing plist_content' });
      return;
    }

    let vbtBuffer: Buffer;
    if (vbt_base64) {
      vbtBuffer = Buffer.from(vbt_base64, 'base64');
    } else if (sample_id) {
      const samplePath = path.join(samplesDir, path.basename(sample_id));
      if (!fs.existsSync(samplePath)) {
        res.status(404).json({ error: 'Sample file not found' });
        return;
      }
      vbtBuffer = fs.readFileSync(samplePath);
    } else {
      res.status(400).json({ error: 'Missing vbt_base64 or sample_id' });
      return;
    }

    const id = Date.now() + '_' + Math.random().toString(36).substring(7);
    const tmpVbtPath = path.join('/tmp', `vbt_${id}.bin`);
    const tmpPlistPath = path.join('/tmp', `config_${id}.plist`);

    fs.writeFileSync(tmpVbtPath, vbtBuffer);
    fs.writeFileSync(tmpPlistPath, plist_content, 'utf-8');

    const cliArgs = ['vbt2fbpatch.py', '-i', tmpVbtPath, '-m', tmpPlistPath];
    if (platform_id) {
      cliArgs.push('-p', platform_id);
    }
    if (device_id) {
      cliArgs.push('-d', device_id);
    } else if (detect_device_id) {
      cliArgs.push('--detect-device-id');
    }
    if (spoof_id) {
      cliArgs.push('--spoof-id', spoof_id);
    }
    if (target_macos) {
      cliArgs.push('-t', target_macos);
    }
    if (form_factor && form_factor !== 'auto') {
      cliArgs.push('-f', form_factor);
    }
    if (unifiedmem) {
      cliArgs.push('--unifiedmem');
    }
    if (rps_control) {
      cliArgs.push('--rps-control');
    }
    if (backlight_fix) {
      cliArgs.push('--backlight-fix');
    }
    if (mobile) {
      cliArgs.push('--mobile');
    }
    if (first_con !== undefined && first_con !== null && first_con !== '') {
      cliArgs.push('--first-con', String(first_con));
    }
    if (bus_id_source && bus_id_source !== 'ddi') {
      cliArgs.push('--bus-id-source', bus_id_source);
    }
    if (pipe !== undefined && pipe !== null && pipe !== '') {
      cliArgs.push('--pipe', String(pipe));
    }
    if (con_flags) {
      cliArgs.push('--con-flags', con_flags);
    }
    if (fb_flags) {
      cliArgs.push('--fb-flags', fb_flags);
    }
    if (lspcon_mode) {
      cliArgs.push('--lspcon-mode', lspcon_mode);
    }

    execFile('python3', cliArgs, { cwd: __dirname }, (error, stdout, stderr) => {
      let mergedPlist: string | null = null;
      try {
        if (fs.existsSync(tmpPlistPath)) {
          mergedPlist = fs.readFileSync(tmpPlistPath, 'utf-8');
          fs.unlinkSync(tmpPlistPath);
        }
        if (fs.existsSync(tmpVbtPath)) {
          fs.unlinkSync(tmpVbtPath);
        }
      } catch {
        // ignore
      }

      if (error && !mergedPlist) {
        res.status(500).json({ error: error.message, stderr, stdout });
        return;
      }

      res.json({
        success: true,
        stdout,
        mergedPlist,
      });
    });
  });

  // API Route: Get complete iGPU database and flag metadata directly from vbt2fbpatch
  app.get('/api/igpu-database', (_req, res) => {
    execFile(
      'python3',
      [
        '-c',
        `import json, vbt2fbpatch

db_data = {
    f"{k:04X}": {
        "device_id": f"{k:04X}",
        "model_name": v.model_name,
        "cpu_architecture": v.architecture,
        "gpu_generation": v.architecture,
        "form_factor": v.form_factor.value,
        "status": "NATIVE" if v.supported and not v.spoof else ("UNSUPPORTED" if not v.supported else "NEEDS_SPOOF"),
        "macos_native_min": v.macos_min,
        "macos_native_max": v.macos_max,
        "default_spoof_target": f"{v.spoof.target_id:04X}" if v.spoof else None,
        "default_spoof_reason": v.spoof.reason if v.spoof else None,
        "recommended_platform_id": f"{v.profiles[0].platform_id:08X}" if v.profiles else "3E9B0007",
        "faq_section": v.faq_section,
        "notes": v.notes,
    }
    for k, v in vbt2fbpatch.INTEL_IGPU_DATABASE.items()
}

fb_flags = {f"0x{k:X}": v for k, v in vbt2fbpatch.FRAMEBUFFER_FLAG_NAMES.items()}
con_flags = {f"0x{k:X}": v for k, v in vbt2fbpatch.CONNECTOR_FLAG_NAMES.items()}

print(json.dumps({
    "database": db_data,
    "framebuffer_flags": fb_flags,
    "connector_flags": con_flags,
    "known_platform_ids": [f"{pid:08X}" for pid in vbt2fbpatch.KNOWN_PLATFORM_IDS]
}))`,
      ],
      { cwd: __dirname },
      (error, stdout, stderr) => {
        if (error) {
          res.status(500).json({ error: error.message, stderr });
          return;
        }
        try {
          res.json(JSON.parse(stdout));
        } catch (e: any) {
          res.status(500).json({ error: 'Failed to parse database output', details: e.message });
        }
      }
    );
  });

  // Serve static assets or mount Vite dev server
  if (isProd) {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, () => {
    console.log(`vbt2fbpatch server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
