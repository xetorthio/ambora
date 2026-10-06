import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fingerprintAudioFile } from '../../src/main/lufsFingerprint'

const temporaryDirectories: string[] = []

async function fixture(name: string, content: Buffer): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ambora-lufs-'))
  temporaryDirectories.push(directory)
  const path = join(directory, name)
  await writeFile(path, content)
  return path
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

describe('fingerprintAudioFile', () => {
  it('uses the same versioned fingerprint for identical files at different paths', async () => {
    const content = Buffer.from('identical ambient loop')
    const first = await fixture('first.ogg', content)
    const second = await fixture('moved.ogg', content)

    await expect(fingerprintAudioFile(first)).resolves.toMatch(/^v1:[a-f0-9]{64}$/)
    await expect(fingerprintAudioFile(first)).resolves.toBe(await fingerprintAudioFile(second))
  })

  it('includes the tail sample for large files', async () => {
    const size = 320 * 1024 + 1
    const firstContent = Buffer.alloc(size, 0)
    const secondContent = Buffer.from(firstContent)
    secondContent[secondContent.length - 1] = 1
    const first = await fixture('first.wav', firstContent)
    const second = await fixture('second.wav', secondContent)

    await expect(fingerprintAudioFile(first)).resolves.not.toBe(await fingerprintAudioFile(second))
  })
})
