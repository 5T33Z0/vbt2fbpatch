# Extracting Intel Video BIOS Table (`vbt.bin`) via Live Linux

This guide covers how to reliably dump the native **Video BIOS Table (VBT)** for an Intel Integrated GPU (iGPU) using a Live Linux environment.

---

## Background

On modern UEFI systems (CSM disabled) or switchable graphics laptops (Intel iGPU + AMD/NVIDIA dGPU), bootloaders like Clover often fail to dump the Intel VBIOS. Clover's legacy `F6` shortcut dumps memory region `0xC0000`, which either dumps the discrete GPU ROM or an empty memory block.

Booting into a Linux Live environment allows the Linux kernel's Intel graphics driver (`i915` or `xe`) to expose the active, decoded VBT directly from ACPI/OpRegion memory via `debugfs`.

---

## Prerequisites

- A USB drive 
- Ventoy 
- Linux Distribution supporting live mode (e.g., **Zorin OS**, **Ubuntu**, **Linux Mint**, or **SystemRescue**).

---

## Step-by-Step Instructions

### 1. Prepare and Boot the Live Linux USB

- Download and install [Ventoy](https://www.ventoy.net/) on a USB flash drive. Ventoy allows you to boot multiple operating systems directly from ISO files without having to create a separate bootable USB for each one.
- Download a Linux distribution ISO (e.g. [Zorin OS](https://zorin.com/os/)).
- Copy the Linux ISO file to the Ventoy USB flash drive. No extraction or additional preparation is required.
- Connect the USB flash drive and boot your system into the boot menu (F12, F11, F8, or Esc, depending on the motherboard).
- Select the USB flash drive to launch Ventoy.
- In the Ventoy menu, select the Linux ISO file and press Enter.
- Once Linux has booted, choose **"Try Linux"** (do not install).
- Avoid **"Safe Graphics"** or `nomodeset` mode to ensure the Intel graphics driver loads correctly.

### 2. Locate the VBT File
Open a **Terminal** window and search for the active VBT path inside kernel debug storage:

```bash
sudo find /sys/kernel/debug/dri/ -name "*vbt*"
```

Depending on the Linux kernel version, the file will be located at either:
- **By PCI Address:** `/sys/kernel/debug/dri/0000:00:02.0/i915_vbt`
- **By Device Index:** `/sys/kernel/debug/dri/0/i915_vbt` (or `dri/1/i915_vbt`)

---

### 3. Copy and Set Permissions
Copy the binary to your Desktop (replace the source path with the one found in Step 2):

```bash
sudo cp /sys/kernel/debug/dri/0000:00:02.0/i915_vbt ~/Desktop/vbt.bin
```

Adjust the file permissions so it can be copied and edited without root privileges:

```bash
sudo chmod 666 ~/Desktop/vbt.bin
```

---

### 4. Verify the File Header
Check the first 20 bytes of the extracted file to confirm it is a valid Intel VBT:

```bash
head -c 20 ~/Desktop/vbt.bin
```

**Expected output:**
```text
$VBT <GENERATION>
```
*(e.g., `$VBT SKYLAKE`, `$VBT KABYLAKE`, `$VBT HASWELL`, etc.)*

---

### 5. Transfer to macOS
You can now transfer `vbt.bin` back to your primary OS:
- Copy it to a FAT32/exFAT-formatted USB drive.
- Open a web browser in the Live session and upload it to cloud storage (Google Drive, iCloud, etc.) or email it to yourself.

---

## Troubleshooting

### Issue: `No such file or directory` under `/sys/kernel/debug/`
If `/sys/kernel/debug` is empty or inaccessible, mount `debugfs` manually:
```bash
sudo mount -t debugfs none /sys/kernel/debug
```

### Issue: VBT is not found in `debugfs`
If the file path does not appear, install the official Intel GPU diagnostics toolkit directly in the live session:
```bash
sudo apt update
sudo apt install -y intel-gpu-tools
sudo intel_bios_dumper ~/Desktop/vbt.bin
```
