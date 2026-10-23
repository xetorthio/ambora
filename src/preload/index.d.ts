import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  Campaign,
  LoadCampaignsResult,
  RemoteCommand,
  RemoteStateMessage,
  RemoteFullState,
  CollectCampaignMediaResult,
  CollectMediaProgress,
  UpdateStatus,
  RemoteClientInfo,
} from '../shared/types'
import type { AudioProbeResult, LufsAnalyzeResult } from '../shared/audioTools'

type DebugLogRecord = {
  timestamp: string
  rendererTimeMs: number
  event: string
  fields: Record<string, string | number | boolean | null | undefined>
}

interface AmboraAPI {
  platform: NodeJS.Platform
  getCampaigns(): Promise<LoadCampaignsResult>
  saveCampaigns(campaigns: Campaign[]): void
  getPathForFile(file: File): string
  registerAudioPath(filePath: string): Promise<string>
  getYouTubeTitle(videoUrl: string): Promise<string | null>
  getLufs(filePath: string, requestId: string): Promise<LufsAnalyzeResult>
  cancelLufs(requestId: string): void
  probeAudioFile(filePath: string): Promise<AudioProbeResult>
  showItemInFolder(filePath: string): void
  debugLog(record: DebugLogRecord): void
  getAppVersion(): Promise<string>
  exportCampaign(json: string, suggestedName: string): Promise<boolean>
  importCampaign(): Promise<string | null>
  collectCampaignMedia(
    campaign: Campaign,
    onProgress: (progress: CollectMediaProgress) => void,
  ): Promise<CollectCampaignMediaResult>
  getServerInfo(): Promise<{ port: number; localIP: string; clients: RemoteClientInfo[] }>
  onRemoteCommand(callback: (command: RemoteCommand) => void): () => void
  onConnectionStatus(
    callback: (status: { connectedClients: number; clients: RemoteClientInfo[] }) => void,
  ): () => void
  sendStateUpdate(message: RemoteStateMessage): void
  sendFullState(state: RemoteFullState, broadcast?: boolean): void
  getUpdateStatus(): Promise<UpdateStatus>
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void
  installUpdate(): void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AmboraAPI
  }
}
