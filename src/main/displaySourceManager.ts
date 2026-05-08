import { desktopCapturer, DesktopCapturerSource } from 'electron'

type DisplaySourceResponse = {
  video: DesktopCapturerSource | null
  audio: 'loopback' | null
}

// Lazy Singleton used for session level stream caching
export class DisplaySourceManager {
  private static instance: DisplaySourceManager

  private cachedSource: DesktopCapturerSource | null
  private cachedAudio: 'loopback' | null

  static getInstance(): DisplaySourceManager {
    if (!DisplaySourceManager.instance) {
      DisplaySourceManager.instance = new DisplaySourceManager()
    }
    return DisplaySourceManager.instance
  }

  private constructor() {
    this.cachedSource = null
    this.cachedAudio = null
  }

  private async createSource(): Promise<void> {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      if (sources.length !== 0) {
        this.cachedSource = sources[0]
        this.cachedAudio = 'loopback'
      }
    } catch (err) {
      console.error('[DisplaySourceManager]', err)
      throw err
    }
  }

  async getStream(): Promise<DisplaySourceResponse> {
    if (!(this.cachedSource && this.cachedAudio)) {
      this.createSource()
    }
    return {
      video: this.cachedSource,
      audio: this.cachedAudio,
    }
  }
}
