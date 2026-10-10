import { createHash } from 'node:crypto'
import { open, readFile, stat } from 'node:fs/promises'

const HEAD_SAMPLE_BYTES = 256 * 1024
const MIDDLE_SAMPLE_BYTES = 64 * 1024
const TAIL_SAMPLE_BYTES = 64 * 1024
const FULL_FILE_THRESHOLD_BYTES = HEAD_SAMPLE_BYTES + TAIL_SAMPLE_BYTES
const FINGERPRINT_VERSION = 'v1'

/**
 * A fast, versioned identity for an audio file. Small files are read in full;
 * larger files contribute their size, first 256 KiB, a 64 KiB middle sample,
 * and last 64 KiB. The middle sample distinguishes loop exports which commonly
 * have equal-length silence at both ends.
 */
export async function fingerprintAudioFile(filePath: string): Promise<string> {
  const { size } = await stat(filePath)
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('Audio file has an invalid size')
  }

  const hash = createHash('sha256')
  hash.update(`${FINGERPRINT_VERSION}\0${String(size)}\0`)

  if (size < FULL_FILE_THRESHOLD_BYTES) {
    hash.update(await readFile(filePath))
  } else {
    const file = await open(filePath, 'r')
    try {
      const head = Buffer.allocUnsafe(HEAD_SAMPLE_BYTES)
      const middle = Buffer.allocUnsafe(MIDDLE_SAMPLE_BYTES)
      const tail = Buffer.allocUnsafe(TAIL_SAMPLE_BYTES)
      const middleOffset = Math.floor((size - MIDDLE_SAMPLE_BYTES) / 2)
      const [headRead, middleRead, tailRead] = await Promise.all([
        file.read(head, 0, head.length, 0),
        file.read(middle, 0, middle.length, middleOffset),
        file.read(tail, 0, tail.length, size - TAIL_SAMPLE_BYTES),
      ])
      hash.update(head.subarray(0, headRead.bytesRead))
      hash.update(middle.subarray(0, middleRead.bytesRead))
      hash.update(tail.subarray(0, tailRead.bytesRead))
    } finally {
      await file.close()
    }
  }

  return `${FINGERPRINT_VERSION}:${hash.digest('hex')}`
}
