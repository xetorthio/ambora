# RFC: Ambient Sound Layers

Iterated design for [issue #12](https://github.com/xetorthio/ambora/issues/12).

## Problem

Ambora plays music well and switches scenes smoothly, but a scene is more than a
track. A forest is wind under everything, birds every 8–20 seconds, a branch
cracking every half minute, and a raven when the GM decides the players should
be nervous. Looping a single `forest-ambience.mp3` cannot produce that, and
asking the GM to tap buttons every few seconds during play is worse than
silence.

## Design

Each Climate gains an optional list of **Ambient Layers**. A layer is a named
bundle of audio clips plus a rule for when they fire.

### Playback modes

| Mode         | Behaviour                                                                   |
| ------------ | --------------------------------------------------------------------------- |
| **Loop**     | One clip loops continuously (wind, rain, tavern murmur).                    |
| **Random**   | Picks a clip, plays it, waits a random delay, repeats.                      |
| **One-shot** | Never fires on its own; the GM triggers it (raven, scream, distant scream). |

For Random, the delay is drawn from `[minDelay, maxDelay]` and measured **from
when the previous clip finished**, so clips within a layer never overlap
themselves — as the original request specified. The first delay after a scene
activates is drawn from `[0, minDelay]` instead, so a scene sounds alive
immediately rather than dead for the first 30 seconds.

### Clip selection

When a layer has several clips, `clipOrder` decides which one plays:

- **Shuffle** (default) — a shuffle bag: every clip plays once per cycle before
  any repeats, and a cycle never starts with the clip that just played. This is
  the RFC's "avoid repeating the same file twice in a row", but stronger: it
  also stops one clip from being starved.
- **Random** — an independent draw each time.
- **Sequential** — in list order.

This reuses the existing `ShuffleBag` from `audio/trackSelection.ts`, so it cost
nothing to include all three.

### Scope decisions

- **Ambient layers are local files only.** YouTube cannot deliver short
  overlapping clips — one `<iframe>` per player, seconds of load latency, and no
  way to fire a one-shot on time. Music keeps YouTube + local; ambient is local.
- **Layers belong to a climate** (`climate.ambientLayers[]`), matching the
  original proposal. A "Copy layer to…" action lets a rain layer be reused across
  scenes without re-authoring it. A campaign-wide shared library remains possible
  later without changing this shape.
- **No LUFS normalization on ambient clips.** The BS.1770 gating window is 400ms;
  most one-shots are shorter than a few seconds and would measure nonsense. Per-layer
  volume is the control.

### Data model

```ts
type AmbientMode = 'loop' | 'random' | 'oneshot'
type AmbientClipOrder = 'shuffle' | 'random' | 'sequential'

interface AmbientClip {
  id: string
  title: string
  localFilePath: string
  duration?: number
  order: number
}

interface AmbientLayer {
  id: string
  name: string
  mode: AmbientMode
  enabled: boolean // default state when the climate activates
  volume: number // 0–100, relative to master
  clips: AmbientClip[]
  clipOrder: AmbientClipOrder
  minDelaySec: number // random mode
  maxDelaySec: number // random mode
  order: number
}

interface Climate {
  // …existing fields
  ambientLayers?: AmbientLayer[] // optional — old campaigns load unchanged
}
```

`ambientLayers` is optional, so existing `campaigns.json` files load without a
migration step.

### Audio architecture

A new `AmbientEngine` runs beside the existing `AudioEngine` and shares its
`AudioContext`. It does not touch the dual-channel music crossfade at all.

```
clip file ──decode once──▶ AudioBuffer cache
                                 │
              AudioBufferSourceNode (per trigger)
                                 │
                            layer gain ── layer volume
                                 │
                          ambient bus ── master volume × scene fade
                                 │
                            destination
```

Clips are decoded once and cached as `AudioBuffer`s, so a one-shot fires with no
perceptible latency. The active climate's clips are preloaded when the climate
activates.

**Master volume governs everything.** Layer volume is relative to the master, the
same way music channel volume is, so the phone's volume slider still means "the
whole soundscape".

**Scene transitions.** When climates cross-fade, the outgoing climate's ambient
bus fades out and the incoming one fades in over the same `crossfadeDuration`.
Fade-to-silence and pause take ambient with them. Toggling a single layer fades
that layer over 400ms so loops don't click.

### Runtime state is ephemeral

The stored `enabled` and `volume` on a layer are the scene's **authored
defaults**. Toggling a layer or dragging its volume during a session changes
runtime state only, and re-activating the climate restores the defaults. This
matches how master volume and shuffle already behave, and means a session cannot
quietly destroy a carefully-built scene.

### Desktop UI

The climate detail view gains tabs, so a climate with eight tracks and six
layers stays readable:

```
┌──────────────────────────────────────────┐
│ ← 🌲 Forest Scene  ⚙        Delete Climate│
├──────────────────────────────────────────┤
│  ┌────────┐┌──────────┐                  │
│  │Music(5)││Ambient(4)│                  │
│  └────────┘└──────────┘                  │
│                                          │
│  AMBIENT LAYERS (4)        + Add Layer   │
│  ≡ ◉ Wind         Loop      ──●─── 60% ▶⋯│
│  ≡ ◉ Birds     Random 8–20s ────●─ 45% ▶⋯│
│  ≡ ○ Branch..  Random 30–90s ─●─── 70% ▶⋯│
│  ≡ ◉ Raven      One-shot     ──●── 80% ▶⋯│
│                                          │
│    ⌄ expands → mode, clips, min/max      │
└──────────────────────────────────────────┘
```

A collapsed row shows everything needed to judge a layer at a glance: on/off,
name, mode summary, volume, and a ▶ button to audition it. Expanding reveals the
mode selector, the clip list with a drop zone, and the min/max delay inputs.

Dropping audio files onto the Ambient tab creates one Loop layer per file, named
from the filename. Dropping files onto an expanded layer adds them as clips to
that layer.

### Phone remote UI

A collapsible drawer sits above Now Playing. Collapsed, it is one line showing
how many layers are live; expanded, it stays open (remembered in `localStorage`)
so one-shot pads are one tap away for a whole scene. It is hidden entirely when
the active climate has no layers.

```
COLLAPSED              EXPANDED
┌─────────────────┐    ┌─────────────────┐
│ 🎵 Curse of…  ● │    │ 🎵 Curse of…  ● │
├─────────────────┤    ├─────────────────┤
│ ┌─────┐ ┌─────┐ │    │ Ambient      ⌄  │
│ │ 🌲  │ │ ⚔️  │ │    │ ◉ Wind  ──●───  │
│ └─────┘ └─────┘ │    │ ◉ Birds ────●─  │
│ ┌─────┐ ┌─────┐ │    │ ○ Cracks ─●───  │
│ │ 🏰  │ │ 💀  │ │    │ ─────────────── │
│ └─────┘ └─────┘ │    │ ▶ Raven  ▶ Bell │
├─────────────────┤    ├─────────────────┤
│ ≈ Ambient·3 on ⌃│    │ ● Forest Theme ⏭│
├─────────────────┤    ├─────────────────┤
│ ● Forest Theme ⏭│    │  ▶  🔀  🔈 ──── │
├─────────────────┤    └─────────────────┘
│  ▶  🔀  🔈 ──── │
└─────────────────┘
```

One-shot pads flash when they fire, so the GM gets confirmation without hearing
the room. All touch targets stay at 44×44px minimum.

### WebSocket protocol

Three new commands, phone → desktop:

```ts
{ type: 'set-layer-enabled', payload: { layerId, enabled } }
{ type: 'set-layer-volume',  payload: { layerId, volume } }
{ type: 'trigger-layer',     payload: { layerId } }
```

`PlaybackState` gains `ambientRuntime: Record<layerId, { enabled, volume, triggeredAt }>`
covering the active climate. Layer definitions already reach the phone through
the existing `campaigns-update` message, so only the runtime delta is new.

## Deferred

From the original P.S., these are deliberately not in the first version:

- **Probability mode** ("30% chance each minute") — Random Interval covers the
  same ground for most scenes; worth revisiting if it doesn't.
- **Per-layer configurable fade curves** — fades exist but are fixed (400ms on
  toggle, `crossfadeDuration` on scene change).
- **Cross-scene triggers** — a layer firing because a different scene activated
  needs a trigger model that doesn't exist yet.
- **Campaign-wide layer library** — the per-climate model can grow into this
  without a breaking change.
