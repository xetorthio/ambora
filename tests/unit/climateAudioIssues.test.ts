import { describe, expect, it } from 'vitest'
import { climateAudioIssues } from '../../src/renderer/src/lib/climateAudioIssues'
import type { Climate } from '../../src/shared/types'

const climate: Climate = {
  id: 'climate-1',
  name: 'Ruins',
  color: '#7B93F5',
  icon: 'Castle',
  tracks: [{ id: 'track-missing', title: 'Missing', source: 'local', order: 0 }],
  ambientLayers: [
    {
      id: 'layer-1',
      name: 'Wind',
      mode: 'loop',
      enabled: true,
      volume: 50,
      clips: [{ id: 'clip-missing', title: 'Missing', localFilePath: '/gone.wav', order: 0 }],
      clipOrder: 'shuffle',
      minDelaySec: 5,
      maxDelaySec: 10,
      order: 0,
    },
  ],
  order: 0,
  crossfadeDuration: 4,
}

describe('climateAudioIssues', () => {
  it('counts unavailable music tracks and ambient clips', () => {
    const issues = climateAudioIssues(climate, {
      'clip-missing': { source: 'probe', reason: 'File not found' },
    })

    expect(issues).toMatchObject({ trackCount: 1, clipCount: 1, total: 2 })
    expect(issues.summary).toContain('1 unplayable track')
    expect(issues.summary).toContain('1 missing or unplayable ambient clip')
  })
})
