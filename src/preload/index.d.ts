import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  Campaign,
  LoadCampaignsResult,
  RemoteCommand,
  RemoteStateMessage,
  RemoteFullState,
  CollectCampaignMediaResult,
  CollectMediaProgress,
} from '../shared/types'
import type { AudioProbeResult, LufsAnalyzeResult } from '../shared/audioTools'

interface AmboraAPI {
  platform: NodeJS.Platform
  getCampaigns(): Promise<LoadCampaignsResult>
  saveCampaigns(campaigns: Campaign[]): void
  getPathForFile(file: File): string
  registerAudioPath(filePath: string): Promise<string>
  getYouTubeTitle(videoUrl: string): Promise<string | null>
  loadLufsCache(): Promise<Record<string, number>>
  saveLufsCache(cache: Record<string, number>): void
  analyzeLufs(filePath: string, requestId: string): Promise<LufsAnalyzeResult>
  cancelLufs(requestId: string): void
  probeAudioFile(filePath: string): Promise<AudioProbeResult>
  getAppVersion(): Promise<string>
  exportCampaign(json: string, suggestedName: string): Promise<boolean>
  importCampaign(): Promise<string | null>
  collectCampaignMedia(
    campaign: Campaign,
    onProgress: (progress: CollectMediaProgress) => void,
  ): Promise<CollectCampaignMediaResult>
  getServerInfo(): Promise<{ port: number; localIP: string }>
  onRemoteCommand(callback: (command: RemoteCommand) => void): () => void
  onConnectionStatus(callback: (status: { connectedClients: number }) => void): () => void
  sendStateUpdate(message: RemoteStateMessage): void
  sendFullState(state: RemoteFullState, broadcast?: boolean): void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AmboraAPI
  }
}
