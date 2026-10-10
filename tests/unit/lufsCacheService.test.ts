import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAnalyzeLufs, mockCancelLufs, mockFingerprint, mockLoadCache, mockSaveCache, mockStat } =
  vi.hoisted(() => ({
    mockAnalyzeLufs: vi.fn(),
    mockCancelLufs: vi.fn(),
    mockFingerprint: vi.fn(),
    mockLoadCache: vi.fn(),
    mockSaveCache: vi.fn(),
    mockStat: vi.fn(),
  }))

vi.mock('../../src/main/data', () => ({
  loadLufsCache: mockLoadCache,
  saveLufsCache: mockSaveCache,
}))
vi.mock('../../src/main/lufsAnalyze', () => ({
  analyzeLufs: mockAnalyzeLufs,
  cancelLufs: mockCancelLufs,
}))
vi.mock('../../src/main/lufsFingerprint', () => ({ fingerprintAudioFile: mockFingerprint }))
vi.mock('node:fs/promises', () => ({ stat: mockStat }))

import {
  __resetLufsCacheForTests,
  cancelLufsRequest,
  flushLufsCache,
  getLufs,
} from '../../src/main/lufsCache'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('main-process LUFS cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetLufsCacheForTests()
    mockLoadCache.mockReturnValue({ '/old/path.mp3': -18 })
    mockFingerprint.mockResolvedValue('v1:content-hash')
    mockAnalyzeLufs.mockResolvedValue({ ok: true, integratedLufs: -16.4 })
    mockStat.mockResolvedValue({ size: 1000, mtimeMs: 1, dev: 1, ino: 1 })
  })

  afterEach(() => vi.useRealTimers())

  it('reuses a content cache entry after a file moves and discards path keys', async () => {
    await expect(getLufs('/music/original.mp3', 'request-1')).resolves.toEqual({
      ok: true,
      integratedLufs: -16.4,
    })
    await expect(getLufs('/different-folder/copy.mp3', 'request-2')).resolves.toEqual({
      ok: true,
      integratedLufs: -16.4,
      cached: true,
    })

    expect(mockAnalyzeLufs).toHaveBeenCalledOnce()
    expect(mockFingerprint).toHaveBeenCalledTimes(2)

    flushLufsCache()
    expect(mockSaveCache).toHaveBeenCalledWith({ 'v1:content-hash': -16.4 })
  })

  it('debounces saves, flush cancels the timer, and ignores non-finite persisted values', async () => {
    vi.useFakeTimers()
    mockLoadCache.mockReturnValue({ 'v1:good': -14, 'v1:bad': Number.NaN, '/old/path': -18 })

    await getLufs('/music/track.mp3', 'request-1')
    expect(mockSaveCache).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1999)
    expect(mockSaveCache).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(mockSaveCache).toHaveBeenCalledWith({ 'v1:good': -14, 'v1:content-hash': -16.4 })

    mockSaveCache.mockClear()
    flushLufsCache()
    await vi.advanceTimersByTimeAsync(5000)
    expect(mockSaveCache).not.toHaveBeenCalled()
  })

  it('does not save when flush has no dirty entries', () => {
    flushLufsCache()
    expect(mockSaveCache).not.toHaveBeenCalled()
  })

  it('cancels a request while fingerprinting without starting analysis', async () => {
    const fingerprint = deferred<string>()
    mockFingerprint.mockReturnValueOnce(fingerprint.promise)

    const result = getLufs('/music/track.mp3', 'request-1')
    await Promise.resolve()
    cancelLufsRequest('request-1')
    fingerprint.resolve('v1:content-hash')

    await expect(result).resolves.toEqual({ ok: false, reason: 'cancelled', cancelled: true })
    expect(mockAnalyzeLufs).not.toHaveBeenCalled()
  })

  it('cancels a request while analysis is running', async () => {
    const analysis = deferred<{ ok: true; integratedLufs: number }>()
    mockAnalyzeLufs.mockReturnValueOnce(analysis.promise)

    const result = getLufs('/music/track.mp3', 'request-1')
    await Promise.resolve()
    await Promise.resolve()
    cancelLufsRequest('request-1')
    analysis.resolve({ ok: true, integratedLufs: -16.4 })

    await expect(result).resolves.toEqual({ ok: false, reason: 'cancelled', cancelled: true })
    expect(mockCancelLufs).toHaveBeenCalledWith('request-1')
  })

  it('shares an in-flight analysis for concurrent cache misses', async () => {
    const analysis = deferred<{ ok: true; integratedLufs: number }>()
    mockAnalyzeLufs.mockReturnValueOnce(analysis.promise)

    const first = getLufs('/music/first.mp3', 'request-1')
    const second = getLufs('/music/second.mp3', 'request-2')
    await vi.waitFor(() => expect(mockAnalyzeLufs).toHaveBeenCalledOnce())
    analysis.resolve({ ok: true, integratedLufs: -16.4 })

    await expect(first).resolves.toEqual({ ok: true, integratedLufs: -16.4 })
    await expect(second).resolves.toEqual({ ok: true, integratedLufs: -16.4 })
  })

  it('refingerprints a path whose stat signature changes', async () => {
    await getLufs('/music/track.mp3', 'request-1')
    mockStat.mockResolvedValueOnce({ size: 1001, mtimeMs: 2, dev: 1, ino: 1 })
    mockFingerprint.mockResolvedValueOnce('v1:replacement')

    await getLufs('/music/track.mp3', 'request-2')
    expect(mockFingerprint).toHaveBeenCalledTimes(2)
  })
})
