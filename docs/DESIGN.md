---
name: Ghostwire Tactical Proxy
colors:
  surface: '#121317'
  surface-dim: '#121317'
  surface-bright: '#38393e'
  surface-container-lowest: '#0d0e12'
  surface-container-low: '#1a1b20'
  surface-container: '#1e1f24'
  surface-container-high: '#292a2e'
  surface-container-highest: '#343439'
  on-surface: '#e3e2e8'
  on-surface-variant: '#b9cbb9'
  inverse-surface: '#e3e2e8'
  inverse-on-surface: '#2f3035'
  outline: '#849585'
  outline-variant: '#3b4b3d'
  surface-tint: '#00e479'
  primary: '#f1ffef'
  on-primary: '#003919'
  primary-container: '#00ff88'
  on-primary-container: '#007139'
  inverse-primary: '#006d37'
  secondary: '#bdf4ff'
  on-secondary: '#00363d'
  secondary-container: '#00e3fd'
  on-secondary-container: '#00616d'
  tertiary: '#fffaf8'
  on-tertiary: '#432c00'
  tertiary-container: '#ffd99f'
  on-tertiary-container: '#835a00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#60ff99'
  primary-fixed-dim: '#00e479'
  on-primary-fixed: '#00210c'
  on-primary-fixed-variant: '#005228'
  secondary-fixed: '#9cf0ff'
  secondary-fixed-dim: '#00daf3'
  on-secondary-fixed: '#001f24'
  on-secondary-fixed-variant: '#004f58'
  tertiary-fixed: '#ffdeac'
  tertiary-fixed-dim: '#ffba38'
  on-tertiary-fixed: '#281900'
  on-tertiary-fixed-variant: '#604100'
  background: '#121317'
  on-background: '#e3e2e8'
  surface-variant: '#343439'
typography:
  headline-xl:
    fontFamily: Space Grotesk
    fontSize: 44px
    fontWeight: '700'
    lineHeight: 52px
    letterSpacing: -0.04em
  headline-xl-mobile:
    fontFamily: Space Grotesk
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 38px
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.03em
  headline-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.02em
  body-lg:
    fontFamily: JetBrains Mono
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-md:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  body-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.08em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.12em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 9px
    fontWeight: '500'
    lineHeight: 12px
    letterSpacing: 0.16em
spacing:
  gutter: 1rem
  gutter-mobile: 0.5rem
  margin: 1.5rem
  margin-mobile: 0.75rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style
The design system establishes a zero-trust, mission-critical defensive posture for autonomous edge proxies and encrypted telemetry relays. Built for elite SecOps teams, network architects, and threat-hunting engineers, the aesthetic fuses strict technical minimalism with aggressive cybernetic instrumentation.

The interface should evoke absolute situational control, microscopic precision, and uncompromised stealth. Extraneous decorative fluff is eliminated in favor of information density, low retinal fatigue in dark operation centers, and real-time responsiveness. The design movement blends **Technical Cyber-Brutalism** with **Phosphor Precision**: stark abyss-black grounds, sharp rectilinear apertures, hairline luminescence, and raw monospaced metric columns operating with military clarity.

## Colors
The palette leverages a true deep-void substrate to preserve dark adaptation and optimize contrast for optical scanning.

- **Primary (`#00FF88` - Neon Emerald):** Designates verified cryptographic routes, healthy proxy nodes, optimal packet latency, and nominal security posture.
- **Secondary (`#00E5FF` - Cyan Intercept):** Signifies active data streams, telemetry packets, routing transitions, and diagnostic inspection modes.
- **Tertiary (`#FFB300` - Threat Tier 2 Amber):** Highlights anomalous handshakes, heuristic rate-limits, signature mismatches, and elevated monitoring thresholds.
- **Severe Hazard (`#FF1744` - Crimson Breached):** Exclusively deployed for critical state failures, cryptographic injection attempts, payload intercepts, and perimeter tripwires.
- **Neutral Core (`#08090D` void with `#050507` base and `#0B0C10` surface elevations):** Deep absorption layers paired with crisp cyber-monochrome structural lines (`#181B22` frame, `#4E5666` subdued data, `#DCE1EC` terminal output).

## Typography
Typography is treated as a high-density, machine-readable instrumentation readout.

- **Primary Structural Font (Space Grotesk):** Deployed for high-level module identifiers, console designations, and metric headlines. Its sharp geometric forms echo physical control systems while maintaining swift legibility.
- **Instrument Data & Body (JetBrains Mono):** Monospaced throughout all status strings, telemetry feeds, hex traces, and runtime parameters. Fixed-width character sizing prevents layout reflows during rapid telemetry refreshes and live socket streaming.
- **Micro Labels:** All labels and meta-coordinates are formatted in uppercase with expanded letter-spacing to ensure legibility when overlaid on complex matrix surfaces or animated radar sweeps.

## Layout & Spacing
The layout implements a high-density fluid grid system designed for panoramic command decks and multi-monitor operations, collapsing systematically on smaller viewport viewports:

- **Grid Architecture:** Desktop displays utilize a strict 12-column or 16-column continuous fluid telemetry grid. Modules anchor to razor-sharp borders without extraneous gaps. Mobile and constrained views drop down to a 4-column single-stream stack.
- **Rhythm & Padding:** Built on a disciplined 4px base increment (`0.25rem`). Component interiors run compact paddings to ensure real-time terminal output consumes maximal screen real estate without claustrophobic text collisions.
- **Reflow Protocols:** High-priority status heads and threat feeds maintain top-tier visual persistence (pinned HUD). Subsidiary charts, packet sniffers, and proxy topology diagrams reconfigure into collapsible tabs below 1024px viewport widths.

## Elevation & Depth
Elevation abandons traditional soft drop shadows entirely. Depth is achieved via **Sub-Surface Luminance and Telemetry Border Containment**:

- **Z-Index Layering (Tonal Grounds):**
  - Level 0 (Canvas Base): `#050507` — absolute abyss backdrop containing sub-surface scanline sweeps and coordinate radar grids.
  - Level 1 (Panels & Frames): `#0B0C10` — opaque workstation panels bounded by 1px crisp borders in `#161922`.
  - Level 2 (Active Modals & Drawer Overlays): `#0E1017` — suspended intercept monitors and payload inspectors.
- **Telemetry Glow & Hairline Borders:** Rather than casting dark ambient shadows, focused elements emit controlled photon bleed (`box-shadow: 0 0 16px -2px rgba(0, 255, 136, 0.25)` or `rgba(255, 23, 68, 0.35)`). Active panes feature an electric 1px border stroke directly tied to operational status.
- **Optical Scanlines & Radar Sweep FX:** Background scanlines are rendered using a 2px repeating linear raster mask (`rgba(255, 255, 255, 0.015)` alternating every 4px). Radar sweeps, active packet streams, and beam pulses utilize synchronized linear-gradient wipes across the SVG layer space.

## Shapes
The design system enforces a **Level 0 (Sharp)** shape geometry. 

All surfaces, inputs, buttons, and telemetry viewports use 0px border-radii. Corners represent hard silicon and military chassis cutoffs. Specialized frames may utilize 45-degree corner cutouts (chamfered edges, e.g., `clip-path: polygon(...)`) to emphasize ruggedized HUD architecture and telemetry bounding boxes. Rounded forms are strictly reserved for functional circular radar scopes, vector nodes, and rotating ring gauges.

## Components

### Buttons
- **Execute Primary:** Solid `#00FF88` fill with `#050507` bold monospace typography. Zero border-radius. On hover, intense neon bloom (`0 0 18px rgba(0,255,136,0.6)`) with subtle inward scanline flicker.
- **Tactical Secondary:** `#0B0C10` background, 1px solid border in `#2A313D`, text in `#DCE1EC`. On hover: border-color flips to `#00E5FF`, text color transitions to `#00E5FF`, paired with hairline glowing corner brackets.
- **Destructive/Emergency Purge:** 1px solid `#FF1744` with `#FF1744` text. On active state: pure crimson flash and instant payload cancellation confirmation.

### Chips & Threat Badges
- Strict rectilinear badges containing uppercase status tags (`ACTIVE`, `BYPASS`, `THREAT_LVL_4`, `ISOLATED`).
- Structure: 1px border colored by hazard state with a 10% opacity tinted fill. Includes a 6px pulsing phosphor node indicator on the left flank.

### Lists & Stream Telemetry
- Alternating subtle rows (`#08090D` to `#0B0C10`) bordered by hairline dividers (`#151821`).
- Numbers and timestamps are consistently right-aligned in dim grey (`#4E5666`), while variable payload data and client IP addresses highlight in high-contrast mono white.
- Cursor hover produces a distinct left-edge neon highlight bar (2px width) that slides vertically across target rows.

### Checkboxes & Binary Toggles
- **Checkboxes:** Exact 14x14px sharp squares with a 1px border (`#2A313D`). Checked state presents a solid emerald core inset or a glowing crosshair glyph (`+`).
- **Toggles:** Sharp binary slide-switches with instantaneous, zero-spring state transitions. Displays active state indicators labeled directly in the track (`[I / O]`).

### Input Fields & Terminal Prompts
- Substrate color `#06070A` with a 1px solid `#1C202B` border.
- Active focus triggers a 1px `#00E5FF` bounding perimeter with matching text glow.
- Prefixed with persistent terminal directory markers (e.g., `proxy::root@node-01:~$ `). Blinking cursor features a sharp monospaced block glyph.

### Cards & Bounding Modules
- Sharp structural tiles featuring top-left or top-right technical label cutouts (e.g., `SEC-BOX // LATENCY_MONITOR`).
- Optional subtle radar background canvas or horizontal scanline sweep overlay running at 60fps with pure CSS compositing.

### Specialized Components (Radar & Trace Streamers)
- **Sweep Radar:** Dark concentric circular vectors (`rgba(0, 229, 255, 0.1)`) with a continuous 360-degree rotating gradient sector displaying intercepted proxy pings.
- **Telemetry Streamer:** Auto-scrolling, high-throughput monospace log viewport featuring real-time stream pausing on pointer hover and instant regex isolation.