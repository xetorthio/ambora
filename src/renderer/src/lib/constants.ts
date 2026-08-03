export const CLIMATE_COLORS = [
  { name: 'Crimson', hex: '#DC3545' },
  { name: 'Ember', hex: '#E8652B' },
  { name: 'Amber', hex: '#D4943A' },
  { name: 'Gold', hex: '#CFAD3B' },
  { name: 'Emerald', hex: '#2D9A5D' },
  { name: 'Teal', hex: '#21917F' },
  { name: 'Sky', hex: '#3B8DD4' },
  { name: 'Cobalt', hex: '#4B6BD4' },
  { name: 'Indigo', hex: '#6659D9' },
  { name: 'Violet', hex: '#8B49B8' },
  { name: 'Rose', hex: '#C74B7A' },
  { name: 'Slate', hex: '#5E6B73' },
  { name: 'Iron', hex: '#404850' },
  { name: 'Copper', hex: '#9B6842' },
  { name: 'Silver', hex: '#A8B0B8' },
  { name: 'Blood', hex: '#9B2335' },
] as const

export const CLIMATE_ICONS = [
  'Swords',
  'Shield',
  'Skull',
  'TreePine',
  'Mountain',
  'Castle',
  'Flame',
  'Waves',
  'Moon',
  'Sun',
  'Beer',
  'BookOpen',
  'Eye',
  'Ghost',
  'Crown',
  'CloudLightning',
  'Heart',
  'Tent',
  'DoorOpen',
  'Sparkles',
] as const

export const ACCEPTED_AUDIO = '.mp3,.wav,.ogg,.flac'
export const ACCEPTED_AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac']

export const DEFAULTS = {
  crossfadeDuration: 4,
  volume: 80,
  serverPort: 3000,
  minCrossfade: 1,
  maxCrossfade: 10,
  maxClimates: 16,
} as const

export const AMBIENT_DEFAULTS = {
  volume: 60,
  minDelaySec: 10,
  maxDelaySec: 30,
  minDelayBound: 1,
  maxDelayBound: 600,
  maxLayers: 12,
  /** Fade applied when a single layer is toggled, so loops don't click. */
  toggleFadeSec: 0.4,
} as const
