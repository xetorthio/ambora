/**
 * Guards the core invariant: an ambient layer never plays two clips at once.
 *
 * Drives the real AmbientEngine against a minimal fake Web Audio graph, so the
 * scheduling paths that previously stacked voices (re-enabling a layer while a
 * clip is still sounding, a slow decode racing a re-arm, a rapid one-shot
 * retrigger) are exercised rather than reasoned about.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AmbientLayer, Climate } from '../../src/shared/types'

class FakeParam {
  value = 1
  cancelScheduledValues(): void {
    /* no scheduling in the fake */
  }
  setValueAtTime(v: number): void {
    this.value = v
  }
  linearRampToValueAtTime(v: number): void {
    this.value = v
  }
}

class FakeGain {
  gain = new FakeParam()
  connect(): void {
    /* graph wiring is irrelevant here */
  }
  disconnect(): void {
    /* graph wiring is irrelevant here */
  }
}

/** Tracks every source ever started so the test can assert on concurrency. */
const startedSources: FakeSource[] = []

class FakeSource {
  buffer: unknown = null
  loop = false
  playbackRate = { value: 1 }
  started = false
  stopped = false
  /** True when the engine cut this voice short rather than it ending naturally. */
  choked = false
  private listeners: (() => void)[] = []

  connect(): void {
    /* graph wiring is irrelevant here */
  }
  disconnect(): void {
    /* graph wiring is irrelevant here */
  }

  addEventListener(event: string, cb: () => void): void {
    if (event === 'ended') this.listeners.push(cb)
  }

  start(): void {
    this.started = true
    startedSources.push(this)
  }

  /** Only the engine calls stop(); the test ends clips via end(). */
  stop(): void {
    if (!this.stopped) this.choked = true
    this.end()
  }

  /** Simulates the clip reaching its end — naturally or because it was stopped. */
  end(): void {
    if (this.stopped) return
    this.stopped = true
    for (const cb of [...this.listeners]) cb()
  }

  get playing(): boolean {
    return this.started && !this.stopped
  }
}

class FakeAudioContext {
  currentTime = 0
  state = 'running'
  destination = {}
  createGain(): FakeGain {
    return new FakeGain()
  }
  createBufferSource(): FakeSource {
    return new FakeSource()
  }
  decodeAudioData(): Promise<unknown> {
    return Promise.resolve({ duration: 3 })
  }
  resume(): void {
    /* always running in the fake */
  }
  close(): void {
    /* nothing to release */
  }
}

let AmbientEngine: typeof import('../../src/renderer/src/audio/AmbientEngine').AmbientEngine

function layer(overrides: Partial<AmbientLayer> = {}): AmbientLayer {
  return {
    id: 'layer-1',
    name: 'Birds',
    mode: 'random',
    enabled: true,
    volume: 60,
    clips: [{ id: 'clip-1', title: 'a.wav', localFilePath: '/sfx/a.wav', order: 0 }],
    clipOrder: 'shuffle',
    minDelaySec: 1,
    maxDelaySec: 2,
    order: 0,
    ...overrides,
  }
}

function climate(layers: AmbientLayer[]): Climate {
  return {
    id: 'climate-1',
    name: 'Forest',
    color: '#2D9A5D',
    icon: 'TreePine',
    order: 0,
    crossfadeDuration: 4,
    tracks: [],
    ambientLayers: layers,
  }
}

const liveSources = (): FakeSource[] => startedSources.filter((s) => s.playing)

/** Lets queued promise callbacks (the decode chain) settle. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  startedSources.length = 0

  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('window', {
    api: { registerAudioPath: () => Promise.resolve('token') },
  })
  vi.stubGlobal('fetch', () =>
    Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
  )

  const mod = await import('../../src/renderer/src/audio/AmbientEngine')
  AmbientEngine = mod.AmbientEngine
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('one voice per layer', () => {
  it('stops a running audition when a real climate starts', async () => {
    const engine = AmbientEngine.getInstance()
    await engine.auditionLayer(layer())

    expect(liveSources()).toHaveLength(1)
    engine.startClimate(climate([]), 0)

    expect(liveSources()).toHaveLength(0)
    const { useAudioStore } = await import('../../src/renderer/src/store/audioStore')
    expect(useAudioStore.getState().auditioningLayerId).toBeNull()
  })

  it('does not start an audition that finishes decoding after a climate starts', async () => {
    let finishDecode: ((buffer: unknown) => void) | undefined
    vi.spyOn(FakeAudioContext.prototype, 'decodeAudioData').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishDecode = resolve
        }),
    )

    const engine = AmbientEngine.getInstance()
    const audition = engine.auditionLayer(layer())
    await flush()
    engine.startClimate(climate([]), 0)

    finishDecode?.({ duration: 3 })
    await audition

    expect(startedSources).toHaveLength(0)
    const { useAudioStore } = await import('../../src/renderer/src/store/audioStore')
    expect(useAudioStore.getState().auditioningLayerId).toBeNull()
  })

  it('restarts a live layer when an edited clip points to a different file', async () => {
    const engine = AmbientEngine.getInstance()
    engine.startClimate(climate([layer({ mode: 'loop' })]), 0)
    await flush()
    const firstSource = liveSources()[0]

    engine.syncClimate(
      climate([
        layer({
          mode: 'loop',
          clips: [{ id: 'clip-1', title: 'b.wav', localFilePath: '/sfx/b.wav', order: 0 }],
        }),
      ]),
    )
    await flush()

    expect(firstSource.choked).toBe(true)
    expect(startedSources).toHaveLength(2)
    expect(liveSources()).toHaveLength(1)
  })

  it('never has two clips playing at once in random mode', async () => {
    const engine = AmbientEngine.getInstance()
    engine.startClimate(climate([layer()]), 0)

    // Drive many fire/end cycles; a violation at any point fails the run.
    for (let i = 0; i < 25; i++) {
      await vi.advanceTimersByTimeAsync(2000)
      await flush()
      expect(liveSources().length).toBeLessThanOrEqual(1)
      liveSources().forEach((s) => s.end())
      await flush()
    }

    expect(startedSources.length).toBeGreaterThan(1)
  })

  it('lets every random clip finish instead of cutting it off', async () => {
    const engine = AmbientEngine.getInstance()
    engine.startClimate(climate([layer()]), 0)

    // Hold each clip open well past the delay window. The scheduler must wait for
    // it to end rather than firing again — a fire mid-clip would choke this voice,
    // which is just as wrong as overlapping it.
    for (let i = 0; i < 15; i++) {
      await vi.advanceTimersByTimeAsync(2000)
      await flush()
      await vi.advanceTimersByTimeAsync(5000)
      await flush()
      expect(startedSources.filter((s) => s.choked)).toHaveLength(0)
      liveSources().forEach((s) => s.end())
      await flush()
    }

    expect(startedSources.length).toBeGreaterThan(1)
  })

  it('does not stack a voice when a layer is re-enabled mid-clip', async () => {
    const engine = AmbientEngine.getInstance()
    engine.startClimate(climate([layer()]), 0)

    await vi.advanceTimersByTimeAsync(2000)
    await flush()
    expect(liveSources()).toHaveLength(1)

    // Toggle off and straight back on while the clip is still sounding — the
    // window in which the deferred stop hasn't run yet.
    engine.setLayerEnabled('layer-1', false)
    engine.setLayerEnabled('layer-1', true)
    await flush()

    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(liveSources().length).toBeLessThanOrEqual(1)
    // Re-arming must not queue a fire on top of the clip already playing, which
    // would choke it the moment the delay elapsed.
    expect(startedSources.filter((s) => s.choked)).toHaveLength(0)
  })

  it('does not stack a voice when the scene is paused and resumed mid-clip', async () => {
    const engine = AmbientEngine.getInstance()
    engine.startClimate(climate([layer()]), 0)

    await vi.advanceTimersByTimeAsync(2000)
    await flush()
    expect(liveSources()).toHaveLength(1)

    engine.fadeOut(0)
    engine.fadeIn(0)
    await flush()

    await vi.advanceTimersByTimeAsync(3000)
    await flush()
    expect(liveSources().length).toBeLessThanOrEqual(1)
    expect(startedSources.filter((s) => s.choked)).toHaveLength(0)
  })

  it('chokes the previous voice when a one-shot is retriggered', async () => {
    const engine = AmbientEngine.getInstance()
    engine.startClimate(climate([layer({ mode: 'oneshot' })]), 0)
    await flush()

    engine.triggerLayer('layer-1')
    await flush()
    expect(liveSources()).toHaveLength(1)
    const first = liveSources()[0]

    engine.triggerLayer('layer-1')
    await flush()
    // The outgoing voice fades before it is stopped, so let that timer run.
    await vi.advanceTimersByTimeAsync(200)

    expect(first.playing).toBe(false)
    expect(liveSources().length).toBeLessThanOrEqual(1)
  })

  it('keeps a loop layer to one voice and applies pitch variation per activation', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(1)
    const engine = AmbientEngine.getInstance()
    const pitchedLoop = climate([layer({ mode: 'loop', pitchVariation: 20 })])
    engine.startClimate(pitchedLoop, 0)
    await flush()

    engine.setLayerEnabled('layer-1', true)
    engine.setLayerEnabled('layer-1', true)
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    await flush()

    expect(liveSources()).toHaveLength(1)
    expect(liveSources()[0].loop).toBe(true)
    expect(liveSources()[0].playbackRate.value).toBeCloseTo(1.2)

    random.mockReturnValue(0)
    engine.startClimate(pitchedLoop, 0)
    await flush()
    expect(startedSources.at(-1)?.playbackRate.value).toBeCloseTo(0.8)
  })
})
