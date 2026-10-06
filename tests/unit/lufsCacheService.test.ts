import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAnalyzeLufs, mockCancelLufs, mockFingerprint, mockLoadCache, mockSaveCache } =
  vi.hoisted(() => ({
    mockAnalyzeLufs: vi.fn(),
    mockCancelLufs: vi.fn(),
    mockFingerprint: vi.fn(),
    mockLoadCache: vi.fn(),
    mockSaveCache: vi.fn(),
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

import { __resetLufsCacheForTests, flushLufsCache, getLufs } from '../../src/main/lufsCache'

describe('main-process LUFS cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetLufsCacheForTests()
    mockLoadCache.mockReturnValue({ '/old/path.mp3': -18 })
    mockFingerprint.mockResolvedValue('v1:content-hash')
    mockAnalyzeLufs.mockResolvedValue({ ok: true, integratedLufs: -16.4 })
  })

  it('reuses a content cache entry after a file moves and discards path keys', async () => {
    await expect(getLufs('/music/original.mp3', 'request-1')).resolves.toEqual({
      ok: true,
      integratedLufs: -16.4,
    })
    await expect(getLufs('/different-folder/copy.mp3', 'request-2')).resolves.toEqual({
      ok: true,
      integratedLufs: -16.4,
    })

    expect(mockAnalyzeLufs).toHaveBeenCalledOnce()
    expect(mockFingerprint).toHaveBeenCalledTimes(2)

    flushLufsCache()
    expect(mockSaveCache).toHaveBeenCalledWith({ 'v1:content-hash': -16.4 })
  })
})
