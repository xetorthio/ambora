import { describe, it, expect, beforeEach } from 'vitest'
import { useDiagnosticsStore } from '../../src/renderer/src/store/diagnosticsStore'

describe('diagnosticsStore', () => {
  beforeEach(() => {
    useDiagnosticsStore.getState().clearAll()
  })

  it('sets and clears an unplayable diagnostic', () => {
    useDiagnosticsStore.getState().setUnplayable('t1', { source: 'probe', reason: 'bad codec' })
    expect(useDiagnosticsStore.getState().unplayable['t1']).toEqual({
      source: 'probe',
      reason: 'bad codec',
    })
    useDiagnosticsStore.getState().clearUnplayable('t1')
    expect(useDiagnosticsStore.getState().unplayable['t1']).toBeUndefined()
  })

  it('tracks probed ids and is idempotent', () => {
    expect(useDiagnosticsStore.getState().hasProbed('t1')).toBe(false)
    useDiagnosticsStore.getState().markProbed('t1')
    useDiagnosticsStore.getState().markProbed('t1')
    expect(useDiagnosticsStore.getState().hasProbed('t1')).toBe(true)
    expect(useDiagnosticsStore.getState().probed.size).toBe(1)
  })

  it('forgetTrack drops both the diagnostic and the probed mark', () => {
    useDiagnosticsStore.getState().setUnplayable('t1', { source: 'playback', reason: 'x' })
    useDiagnosticsStore.getState().markProbed('t1')
    useDiagnosticsStore.getState().forgetTrack('t1')
    expect(useDiagnosticsStore.getState().unplayable['t1']).toBeUndefined()
    expect(useDiagnosticsStore.getState().hasProbed('t1')).toBe(false)
  })

  it('clearAll resets everything', () => {
    useDiagnosticsStore.getState().setUnplayable('t1', { source: 'probe', reason: 'x' })
    useDiagnosticsStore.getState().markProbed('t2')
    useDiagnosticsStore.getState().clearAll()
    expect(Object.keys(useDiagnosticsStore.getState().unplayable)).toHaveLength(0)
    expect(useDiagnosticsStore.getState().probed.size).toBe(0)
  })
})
