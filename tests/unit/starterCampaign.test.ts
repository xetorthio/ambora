import { describe, it, expect } from 'vitest'
import { createStarterCampaign } from '../../src/main/starterCampaign'

const ALLOWED_COLORS = [
  '#DC3545',
  '#E8652B',
  '#D4943A',
  '#CFAD3B',
  '#2D9A5D',
  '#21917F',
  '#3B8DD4',
  '#4B6BD4',
  '#6659D9',
  '#8B49B8',
  '#C74B7A',
  '#5E6B73',
  '#404850',
  '#9B6842',
  '#A8B0B8',
  '#9B2335',
]

const ALLOWED_ICONS = [
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
]

describe('createStarterCampaign', () => {
  const campaign = createStarterCampaign()

  it('has name "Starter Campaign"', () => {
    expect(campaign.name).toBe('Starter Campaign')
  })

  it('has exactly 15 climates', () => {
    expect(campaign.climates).toHaveLength(15)
  })

  it('each climate has exactly 5 tracks', () => {
    for (const climate of campaign.climates) {
      expect(climate.tracks).toHaveLength(5)
    }
  })

  it('all tracks are youtube source with valid youtubeVideoId', () => {
    for (const climate of campaign.climates) {
      for (const track of climate.tracks) {
        expect(track.source).toBe('youtube')
        expect(track.youtubeVideoId).toBeTruthy()
        expect(typeof track.youtubeVideoId).toBe('string')
      }
    }
  })

  it('all climate colors are unique', () => {
    const colors = campaign.climates.map((c) => c.color)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('all climate icons are unique', () => {
    const icons = campaign.climates.map((c) => c.icon)
    expect(new Set(icons).size).toBe(icons.length)
  })

  it('all colors are from the allowed set', () => {
    for (const climate of campaign.climates) {
      expect(ALLOWED_COLORS).toContain(climate.color)
    }
  })

  it('all icons are from the allowed set', () => {
    for (const climate of campaign.climates) {
      expect(ALLOWED_ICONS).toContain(climate.icon)
    }
  })

  // Derived from the actual climate count so adding a mood doesn't break this.
  it('climate orders are sequential from 0', () => {
    const orders = campaign.climates.map((c) => c.order)
    expect(orders).toEqual(campaign.climates.map((_, i) => i))
  })

  it('track orders are sequential 0-4 within each climate', () => {
    for (const climate of campaign.climates) {
      const orders = climate.tracks.map((t) => t.order)
      expect(orders).toEqual([0, 1, 2, 3, 4])
    }
  })

  it('generates unique IDs on each call', () => {
    const campaign2 = createStarterCampaign()
    expect(campaign.id).not.toBe(campaign2.id)
  })
})
