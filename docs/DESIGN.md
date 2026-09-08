# Design System

The UI/UX specification for Ambora — colours, typography, spacing, elevation,
motion, iconography, and touch targets.

Extracted from `ambora-build-prompt.md`, which is the original build brief and is
kept only as a historical record. This file is the current spec; where the two
disagree, this one wins.

---

## Design Philosophy

Ambora is a **performance instrument for dungeon masters**. During a game session, the DM is talking, improvising, rolling dice, and managing NPCs — all while trying to set the mood with music. The UI must disappear into this workflow.

**Core principles:**

- **Zero cognitive load during play.** The phone remote must be usable with a glance and a tap — no reading, no thinking, no navigating.
- **Dark by default.** Used in dimly lit rooms. Must never blast the DM's face with light or draw attention from players.
- **Quiet confidence.** Feels like a premium audio tool — Ableton's restraint, Spotify's clarity. No fantasy clichés, no parchment textures, no dragon illustrations.
- **Color as information.** Climate cards are the only saturated elements in the entire UI. Everything else is muted. Color = mood = music.

## Color System — App Chrome

Built on a neutral scale with a subtle cool undertone (hue ~260 in OKLCH). **Never use pure black (#000000)** — it creates harsh contrast. **Never use pure white (#FFFFFF) for text** — use off-white to reduce glare. All text/background pairs must meet **WCAG AA contrast ratio ≥ 4.5:1**.

| Token              | Hex         | OKLCH                    | Usage                                        |
| ------------------ | ----------- | ------------------------ | -------------------------------------------- |
| `--bg`             | `#0C0C0E`   | `oklch(0.075 0.005 260)` | App background, phone remote background      |
| `--surface-1`      | `#141417`   | `oklch(0.105 0.005 260)` | Sidebar, panels, elevated containers         |
| `--surface-2`      | `#1C1C20`   | `oklch(0.135 0.005 260)` | Cards, inputs, wells                         |
| `--surface-3`      | `#242428`   | `oklch(0.165 0.005 260)` | Hover states, active surfaces                |
| `--border`         | `#2A2A30`   | `oklch(0.195 0.007 260)` | Borders, dividers, separators                |
| `--border-subtle`  | `#1F1F24`   | `oklch(0.150 0.005 260)` | Very subtle dividers                         |
| `--text-primary`   | `#EAEAED`   | `oklch(0.930 0.005 260)` | Headings, primary content                    |
| `--text-secondary` | `#9494A0`   | `oklch(0.640 0.015 270)` | Labels, metadata, helper text                |
| `--text-tertiary`  | `#5C5C68`   | `oklch(0.430 0.015 265)` | Disabled text, placeholders                  |
| `--accent`         | `#7B93F5`   | `oklch(0.670 0.130 265)` | Interactive elements, links, focus rings     |
| `--accent-hover`   | `#95A8F8`   | `oklch(0.730 0.110 265)` | Accent hover state                           |
| `--accent-muted`   | `#7B93F520` | —                        | Accent at 12% opacity for subtle backgrounds |
| `--danger`         | `#F07070`   | `oklch(0.680 0.140 20)`  | Delete actions, errors                       |
| `--success`        | `#5EC269`   | `oklch(0.700 0.150 145)` | Connection status, confirmations             |
| `--warning`        | `#F5A45D`   | `oklch(0.785 0.130 60)`  | Missing audio and non-blocking warnings      |

## Climate Card Color Palette (16 presets)

These are the only saturated colors in the app. Applied at **controlled opacity** on cards to avoid overwhelming the dark UI.

| Name    | Hex       | Suggested mood                 |
| ------- | --------- | ------------------------------ |
| Crimson | `#DC3545` | Combat, danger, boss           |
| Ember   | `#E8652B` | Fire, urgency, chase           |
| Amber   | `#D4943A` | Tavern, warmth, hearth         |
| Gold    | `#CFAD3B` | Royalty, treasure, celebration |
| Emerald | `#2D9A5D` | Forest, nature, druids         |
| Teal    | `#21917F` | Ocean, river, water            |
| Sky     | `#3B8DD4` | Open sky, travel, day          |
| Cobalt  | `#4B6BD4` | Ice, serenity, calm            |
| Indigo  | `#6659D9` | Arcane, magic, portals         |
| Violet  | `#8B49B8` | Mystery, undead, fey           |
| Rose    | `#C74B7A` | Enchantment, romance           |
| Slate   | `#5E6B73` | Dungeon, stone, stealth        |
| Iron    | `#404850` | Shadow, void, death            |
| Copper  | `#9B6842` | Earth, caves, desert           |
| Silver  | `#A8B0B8` | Divine, ethereal, dreams       |
| Blood   | `#9B2335` | Horror, blood, sacrifice       |

**How climate colors are applied:**

Phone remote cards:

```
Background: climate color at 15% opacity
Border: 1px solid, climate color at 30% opacity
Active border: 2px solid, climate color at 80% opacity
Active glow: box-shadow: 0 0 20px {color}30, 0 0 40px {color}15
Icon color: climate color at 90% opacity
```

Desktop cards:

```
Background: --surface-2
Left accent bar: 3px solid, climate color at 70%
```

## Typography

**Font:** Inter Variable via `@fontsource-variable/inter`. Fallback: `-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`.

Enable OpenType features: `font-feature-settings: 'cv01' 1, 'cv02' 1` (cleaner alternate glyphs).

**Desktop type scale (1.25 Major Third ratio, 14px base):**

| Token        | Size | Weight | Line-height | Letter-spacing | Usage                              |
| ------------ | ---- | ------ | ----------- | -------------- | ---------------------------------- |
| `display`    | 28px | 600    | 1.2         | -0.02em        | "Ambora" logo text                 |
| `heading-1`  | 22px | 600    | 1.25        | -0.015em       | Campaign name                      |
| `heading-2`  | 17px | 600    | 1.3         | -0.01em        | Section titles                     |
| `heading-3`  | 14px | 600    | 1.4         | 0              | Card titles, climate names         |
| `body`       | 14px | 400    | 1.5         | 0              | Default text, descriptions, inputs |
| `body-small` | 13px | 400    | 1.45        | 0.005em        | Track titles, metadata             |
| `caption`    | 11px | 500    | 1.4         | 0.03em         | Timestamps, badges, status         |
| `overline`   | 11px | 600    | 1.3         | 0.06em         | Section labels (uppercase)         |

**Phone remote type scale (larger for arm's-length use):**

| Token             | Size | Weight | Usage                     |
| ----------------- | ---- | ------ | ------------------------- |
| `remote-campaign` | 15px | 500    | Campaign name in header   |
| `remote-climate`  | 15px | 600    | Climate card labels       |
| `remote-track`    | 13px | 400    | Now playing track title   |
| `remote-label`    | 11px | 500    | Volume label, status text |

**Rules:** Never below 11px. Use negative letter-spacing (-0.01em to -0.02em) for headings ≥17px. Use positive letter-spacing (0.03em+) for uppercase overlines.

## Spacing & Layout

**4px base grid.** All spacing values are multiples of 4.

| Token      | Value | Usage                                 |
| ---------- | ----- | ------------------------------------- |
| `space-1`  | 4px   | Minimum gap, tight icon-to-text       |
| `space-2`  | 8px   | Compact padding, related items        |
| `space-3`  | 12px  | Small component inner padding         |
| `space-4`  | 16px  | Standard card padding, list item gaps |
| `space-5`  | 20px  | Section margins, panel padding        |
| `space-6`  | 24px  | Major section gaps                    |
| `space-8`  | 32px  | Large section separators              |
| `space-10` | 40px  | Page top/bottom padding               |

**Border radius:**

| Token         | Value  | Usage                         |
| ------------- | ------ | ----------------------------- |
| `radius-sm`   | 6px    | Inputs, badges, small buttons |
| `radius-md`   | 10px   | Cards, dialogs, panels        |
| `radius-lg`   | 14px   | Phone remote climate cards    |
| `radius-xl`   | 20px   | Phone remote bottom sheet     |
| `radius-full` | 9999px | Pills, circular buttons       |

**Desktop dimensions:**

```
Sidebar width:        260px (fixed)
Sidebar padding:      20px
Main content padding: 32px
Climate grid:         CSS Grid, auto-fit, minmax(200px, 1fr), gap 16px
Track list item:      48px height, 12px 16px padding
Now playing bar:      64px, fixed bottom
Dialog width:         480px (standard), 360px (compact)
Max content width:    960px centered
Min window size:      900px × 600px
```

**Phone remote dimensions:**

```
Screen padding:       16px horizontal, 12px top, 16px bottom
Header:               48px
Climate grid:         2 columns, 12px gap
Climate card height:  80-120px (flexible to fill space)
Now playing bar:      52px
Control bar:          72px
Respect:              env(safe-area-inset-bottom) for notched phones
Viewport meta:        width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no
```

## Shadows & Elevation

On dark backgrounds, traditional shadows are nearly invisible. Use **background color steps and borders** instead.

| Level | Technique                                                          | Usage                       |
| ----- | ------------------------------------------------------------------ | --------------------------- |
| 0     | `--bg`                                                             | Page background             |
| 1     | `--surface-1` + `--border-subtle`                                  | Sidebar, panels             |
| 2     | `--surface-2` + `--border`                                         | Cards, inputs               |
| 3     | `--surface-3`                                                      | Hover states                |
| 4     | `--surface-1` + `--border` + `shadow: 0 16px 48px rgba(0,0,0,0.5)` | Modals, dialogs             |
| 5     | Climate color glow                                                 | Active climate card (phone) |

**Rule: No visible shadows on non-overlay elements.** Depth is communicated through background color, not shadows.

## Animation & Motion

**Timing:**

- Micro-interactions (hover, focus): 100-150ms
- State transitions (card activation): 200-300ms
- Glow pulse, now-playing change: 300-500ms
- Easing: `cubic-bezier(0.25, 0.1, 0.25, 1)` (ease-out) default. `cubic-bezier(0.34, 1.56, 0.64, 1)` (spring) for phone card taps.

**Climate card tap (phone):**

```css
.climate-card {
  transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.climate-card:active {
  transform: scale(0.95);
  transition-duration: 100ms;
}
```

Plus `navigator.vibrate(40)` haptic feedback.

**Active climate glow (phone):**

```css
@keyframes glow-pulse {
  0%,
  100% {
    opacity: 0.7;
  }
  50% {
    opacity: 1;
  }
}
.climate-card.active {
  animation: glow-pulse 3s ease-in-out infinite;
}
```

**Climate switch transition:** Old card glow fades out (400ms ease-out), new card glow fades in (400ms ease-out).

**Track title change:** Fade out 200ms, fade in 300ms with 100ms delay.

**Do NOT animate:** Volume slider movement (must be instant), text content swaps, QR code, connection status dot.

**Respect `prefers-reduced-motion`:** Disable glow pulse and spring animations; use instant transitions.

## Iconography

Lucide React exclusively. Sizing:

| Context                | Size | Stroke width |
| ---------------------- | ---- | ------------ |
| Climate icon (phone)   | 28px | 1.5px        |
| Climate icon (desktop) | 24px | 1.5px        |
| Toolbar/action icons   | 18px | 2px          |
| Inline icons           | 16px | 2px          |
| Small indicators       | 14px | 2px          |

Icon colors: Climate icons use the climate's own color at 90%. Action icons: `--text-secondary`, hover → `--text-primary`. Destructive icons: `--text-tertiary`, hover → `--danger`.

## Touch Targets (Phone Remote)

Every tappable element must have a minimum **44×44px** touch area (padding extends hit area beyond visual element).

| Element           | Visual size            | Touch target            | Spacing          |
| ----------------- | ---------------------- | ----------------------- | ---------------- |
| Climate card      | Full column × 80-120px | Same (large enough)     | 12px gap         |
| Skip track        | 18px icon              | 48×48px (via padding)   | Isolated         |
| Volume slider     | 6px track              | 44px tall (via padding) | 16px from edges  |
| Fade to silence   | 48px circle            | 48px                    | 16px from slider |
| Campaign selector | Full header width      | 48px tall               | —                |

---

## Theme Tokens in Code

`src/renderer/src/index.css` is where the chrome palette lives. The palette sits
on `:root` as plain custom properties, and Tailwind's `@theme inline` block maps
every design token onto one of them. A handful of colours deliberately live
elsewhere — the climate presets in `lib/constants.ts`, and the exceptions listed
under _What that block does not reach_ below.

```css
:root {
  --bg: #0c0c0e;
  --surface-1: #141417;
  /* … */
}

@theme inline {
  --color-background: var(--bg);
  --color-surface-1: var(--surface-1);
  /* … */
}
```

The indirection is load-bearing. `@theme inline` bakes the declared value
directly into each generated utility, so a literal here compiles to
`.bg-background { background-color: #0c0c0e }` and no runtime override can reach
it. Pointing at a variable compiles to `var(--bg)` instead, which a second theme
can override.

**Adding a theme** means adding one block for everything that renders through a
Tailwind utility, which is most of the app:

```css
:root[data-theme='light'] {
  --bg: …;
  /* the same names, different values */
}
```

**What that block does not reach.** Three channels bypass CSS custom properties
entirely, and each needs its own change before a second theme is correct:

| Channel                        | Where                        | Why the block misses it                                                                                                                                                       |
| ------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas and imperative `.style` | `NormalizationIndicator.tsx` | `ctx.fillStyle` needs a resolved colour, not a utility class. That component reads the tokens back with `getComputedStyle` — copy the pattern rather than hardcoding a value. |
| Generated images               | `QRCodePanel.tsx`            | QR module colours are baked into the PNG when it is generated. Light modules on a light card are unscannable, so this needs to follow the theme.                              |
| Third-party theme props        | `ui/sonner.tsx`              | `theme="dark"` is a prop, not a class.                                                                                                                                        |

There are also hardcoded base colours inside `components/ui/`: the `bg-white`
thumb in `slider.tsx`, and `text-white` on the destructive variants in
`button.tsx` and `badge.tsx`. Those files are generated by shadcn and the
convention is not to hand-edit them, so a second theme needs a policy for that
layer before it needs a palette.

`AmboraLogo.tsx` and `campaignExport.ts` carry literals too. Both are defensible
— a brand mark and a standalone exported document need not follow the app
chrome — but that is a decision to make explicitly rather than an oversight to
inherit.

**The `dark:` variant is not the mechanism.** `index.css` declares
`@custom-variant dark (&:is(.dark *))`, but nothing in the app ever sets a
`.dark` class, so every `dark:` utility inherited from shadcn is inert today.
Ambora's dark appearance comes from its token values, not from that variant, and
a second theme should keep it that way — swap the palette rather than start
applying `.dark`, or the two mechanisms will disagree.

Ambora ships dark-only today. A light palette is not merely an inversion of
these values: elevation here comes from background steps rather than shadows,
and the climate colours are applied as low-opacity tints chosen against
`#0C0C0E`. Both rules need rethinking rather than translating. See issue #31.

The phone remote (`remote/remote.css`) carries its own palette in the same
shape, and is deliberately dark-only — it is used at the table, in a dim room.
