# Architecture

## Process Model

Ambora runs as an Electron app with three processes:

```
┌─────────────────────────────────────────────────┐
│  Main Process (Node.js)                         │
│  ├── Express server (serves phone remote)       │
│  ├── WebSocket server (real-time communication) │
│  ├── Data persistence (JSON files)              │
│  └── IPC bridge to renderer                     │
├─────────────────────────────────────────────────┤
│  Renderer Process (Chromium)                    │
│  ├── React desktop UI                           │
│  ├── Audio engine (Web Audio API + YouTube)     │
│  ├── Zustand stores (single source of truth)    │
│  └── Receives commands via IPC from main        │
├─────────────────────────────────────────────────┤
│  Preload Script                                 │
│  └── Secure IPC bridge (contextBridge)          │
└─────────────────────────────────────────────────┘

Phone Remote (browser on local WiFi)
  ├── Vanilla HTML/CSS/JS (no React, no bundler)
  ├── Served as static files by Express
  └── Communicates via WebSocket
```

## Data Flow

```
Phone Remote ──WebSocket──→ Main Process ──IPC──→ Renderer (audio + state)
                                                        │
                                                        ▼
                                                  Zustand stores
                                                        │
                                                        ▼
                                              Main Process ──WebSocket──→ Phone Remote
                                              (state sync)
```

## Audio Engine

Dual-channel crossfade system with channels A and B that alternate:

1. Climate activated from silence: load on Channel A, fade in
2. Climate switch: load new on inactive channel, crossfade both simultaneously
3. Track ends: crossfade to next track within the climate
4. Supports both local files (Web Audio API) and YouTube (IFrame API)

## Ambient Engine

`AmbientEngine` runs beside the music engine, sharing its `AudioContext` (owned by
`audio/audioContext.ts`) but never touching the crossfade channels. It plays a
climate's **ambient layers**: wind looping under everything, birds every 8–20
seconds, a raven when the GM taps it.

```
clip file ──decoded once──▶ AudioBuffer cache
                                 │
              AudioBufferSourceNode (one per trigger)
                                 │
                            layer gain ── layer volume × enabled
                                 │
                            stack gain ── scene fade (one per activation)
                                 │
                           master gain ── master volume
                                 │
                             destination
```

- Clips are decoded once and cached, so a one-shot fires with no latency.
- A "stack" is one climate's live layers. Switching climates fades a new stack in
  while the old one fades out, over the same `crossfadeDuration` as the music.
- Ambient layers are **local files only** — YouTube can't deliver short
  overlapping clips.
- A climate with layers but no tracks plays as an ambience-only scene; the music
  engine tracks this with an `ambient` engine state.
- Runtime layer state (enabled/volume) lives in `audioStore.ambientRuntime` and is
  **ephemeral**: the stored layer holds the scene's authored defaults, and
  re-activating the climate restores them.

See `docs/RFC-ambient-layers.md` for the full design.

## Directory Structure

```
src/main/              → Electron main process
src/preload/           → Preload script for IPC bridge
src/renderer/src/      → Desktop React app
  components/ui/       → shadcn/ui (do not edit)
  components/          → App components
  store/               → Zustand stores
  audio/               → Audio engine
  lib/                 → Types, constants, utilities
remote/                → Phone remote (vanilla JS)
tests/                 → Unit + e2e tests
docs/                  → Architecture docs
```
