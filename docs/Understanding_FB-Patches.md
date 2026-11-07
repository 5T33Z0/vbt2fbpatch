# Understanding Intel framebuffer configuration

:construction: WORK in PROGRESS

## Introduction

Intel framebuffer configuration determines how macOS initializes the integrated GPU and handles connected displays. It combines a selected framebuffer personality with a set of connector definitions that describe how displays are connected to the iGPU.

Correctly configuring these properties is *essential* for getting internal displays and external video outputs working reliably on a Hackintosh. This document explains the relevant DeviceProperties, the structure of framebuffer connector entries, and how `vbt2fbpatch` uses the system's Video BIOS Table (VBT) to help identify the required connector information.

## Working principle

`AAPL,ig-platform-id` and `device-id` configure how macOS identifies and initializes the Intel integrated GPU (iGPU), while the framebuffer `connector` properties describe the individual display outputs within the selected framebuffer personality.

## `AAPL,ig-platform-id` specifics

`AAPL,ig-platform-id` selects the Intel framebuffer personality used by macOS to initialize and configure the integrated GPU.

The selected platform ID determines the framebuffer configuration, including connector definitions, display routing and memory-related parameters.

- **Native platform ID:** Use the platform ID corresponding to your actual iGPU when it is supported by macOS.
- **Compatible platform ID:** If the native framebuffer is unsuitable or incompatible, another platform ID from a compatible Intel GPU generation may be used.
- **Framebuffer patching:** Individual connector properties can be modified without replacing the entire framebuffer personality.

Unlike `device-id`, which changes the PCI device identity presented to macOS, `AAPL,ig-platform-id` selects the framebuffer implementation.

> [!IMPORTANT]
> 
> A compatible platform ID must match the actual GPU architecture and hardware capabilities. Simply selecting a platform ID from a newer or more powerful iGPU does not add unsupported hardware features.

## Device-ID specifics

If the iGPU integrated into your CPU is natively supported by your macOS version, injecting a `device-id` is generally unnecessary.

If the iGPU is not natively recognized, you can inject a compatible `device-id` from another supported GPU, preferably from the same or a closely related CPU generation. This is known as a **device-ID spoof**.

The same principle applies when running an older macOS version that does not officially support your CPU generation and its integrated GPU. In such cases, additional spoofing may be required:

- **CPU-ID spoof:** Makes macOS identify the processor as a supported CPU generation.
- **iGPU device-ID spoof:** Makes macOS identify the integrated GPU as a supported graphics device.

> [!IMPORTANT]
> 
> A device-ID spoof alone does not add missing hardware capabilities or guarantee graphics acceleration. The selected framebuffer personality and any required patches must also be compatible with the actual GPU hardware.## Visualization

## Relevant DeviceProperties

### Starting Point

| Property | Level | Function |
| -------- | ----- | -------- |
| `AAPL,ig-platform-id` | Framebuffer | Selects the Intel framebuffer personality 
| `device-id` | GPU| Spoofs the PCI device ID presented to macOS |

> [!NOTE]
> 
> Device-ID is optional. Depends on hardware configuration/compatibility with macOS

### Connector Properties

A framebuffer personality contains an array of connector entries. Each entry describes a display connection from the perspective of the macOS graphics driver. Depending on the Intel generation, the underlying connector structure can differ, but the commonly patched properties are:

| Property | Description |
|---|---|
| `framebuffer-conX-enable` | Enables patching of connector `X`. |
| `framebuffer-conX-index` | Defines the connector index used by the framebuffer. |
| `framebuffer-conX-busid` | Specifies the GMBUS/DDC bus identifier used for display communication and detection. |
| `framebuffer-conX-pipe` | Specifies the pipe value associated with the connector. Its precise role is not fully documented. |
| `framebuffer-conX-type` | Defines the connector type presented to macOS, such as DisplayPort, HDMI or eDP. |
| `framebuffer-conX-flags` | Contains connector-specific flags that influence how the framebuffer handles the connection. |

`X` represents the connector's position in the framebuffer connector array (for example, `con0`, `con1` or `con2`).

### Connector Type

The connector type tells macOS how to treat a framebuffer output. Common values include:

| Connector | Value (hex) | Data representation |
|---|---:|---|
| Dummy | `0x00000001` | `01000000` |
| LVDS / eDP | `0x00000002` | `02000000` |
| Digital DVI | `0x00000004` | `04000000` |
| DisplayPort | `0x00000400` | `00040000` |
| HDMI | `0x00000800` | `00080000` |

The values in the final column show how the 32-bit values are represented in little-endian form in OpenCore DeviceProperties.

The connector type does not necessarily identify the physical socket. For example, a physical USB-C port carrying DisplayPort video may be represented as a DisplayPort connector in the framebuffer.

### Bus ID

The Bus ID identifies the GMBUS/DDC interface associated with a connector. It is relevant to display detection and communication, including reading display information such as EDID.

Common Bus ID values include `0x04`, `0x05` and `0x06`. They are not universal identifiers for physical HDMI or DisplayPort sockets: the correct assignment depends on the platform's display wiring and firmware configuration.

### Pipe

The pipe value is another field in the connector entry. Its exact purpose is not fully established in the available documentation. It should not be confused with the framebuffer's separate `framebuffer-pipecount` property.

### Flags

Connector flags are a bit field containing additional connector-specific settings. Individual bits can affect framebuffer behavior, but their meaning is not fully documented for every Intel generation. Avoid copying flag values from unrelated framebuffer configurations without understanding the hardware and the intended patch.

## What is VBT.bin?

VBT stands for **Video BIOS Table**. It is a firmware-provided data structure containing platform- and board-specific configuration information for Intel graphics. Much of this information concerns the display hardware and its **connections**.

The VBT can contain information about the system's display topology, including port configuration and the interfaces used for display communication. It is therefore a valuable reference when investigating how a laptop's internal panel and external video outputs are wired.

`vbt2fbpatch` uses the extracted `VBT.bin` as an input to identify relevant display connector information, including **connector**, **Bus ID** and **pipe data**. It interprets this information alongside the framebuffer structure and documentation to help determine suitable connector properties for an OpenCore framebuffer patch.

**Why use the VBT?**

A framebuffer dump shows the connector configuration provided by a macOS framebuffer personality. It does not necessarily tell you how the laptop's physical display outputs are wired. The VBT provides a second, firmware-level source of information that can help bridge that gap.

The VBT is not an OpenCore configuration file, nor does it directly provide a ready-to-use macOS framebuffer patch. Its data must be *interpreted* in the context of the selected framebuffer personality and *verified* against the actual hardware.

**In short**: the VBT helps identify the hardware's display connections; the framebuffer connector properties describe how macOS should handle those connections.

## Intel FB Visualization


```mermaid
flowchart TD
    A["Intel GPU (IGPU)"]

    A --> B["PCI Device Identity"]
    A --> C["Framebuffer Configuration"]

    B --> D["device-id"]
    D --> E["Spoofed PCI Device ID"]

    C --> F["AAPL,ig-platform-id"]
    F --> G["Selects Framebuffer Personality"]

    G --> H["Framebuffer Connector Array"]

    H --> I["Connector 0 (con0)"]
    H --> J["Connector 1 (con1)"]
    H --> K["Connector 2 (con2)"]

    I --> L["Bus ID"]
    I --> M["Pipe"]
    I --> N["Connector Type"]
    I --> O["Connector Flags"]

    J --> P["Bus ID"]
    J --> Q["Pipe"]
    J --> R["Connector Type"]
    J --> S["Connector Flags"]

    K --> T["Bus ID"]
    K --> U["Pipe"]
    K --> V["Connector Type"]
    K --> W["Connector Flags"]
```


