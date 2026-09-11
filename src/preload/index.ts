import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { randomUUID } from 'node:crypto'
import { electronAPI } from '@electron-toolkit/preload'
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

// Custom APIs for renderer
const api = {
  platform: process.platform,
  getCampaigns: (): Promise<LoadCampaignsResult> => ipcRenderer.invoke('data:get-campaigns'),
  saveCampaigns: (campaigns: Campaign[]): void => {
    ipcRenderer.send('data:save-campaigns', campaigns)
  },
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  registerAudioPath: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('audio:register-path', filePath),
  getYouTubeTitle: (videoUrl: string): Promise<string | null> =>
    ipcRenderer.invoke('youtube:get-title', videoUrl),
  loadLufsCache: (): Promise<Record<string, number>> => ipcRenderer.invoke('audio:load-lufs-cache'),
  saveLufsCache: (cache: Record<string, number>): void => {
    ipcRenderer.send('audio:save-lufs-cache', cache)
  },
  analyzeLufs: (filePath: string, requestId: string): Promise<LufsAnalyzeResult> =>
    ipcRenderer.invoke('audio:analyze-lufs', filePath, requestId),
  cancelLufs: (requestId: string): void => {
    ipcRenderer.send('audio:cancel-lufs', requestId)
  },
  probeAudioFile: (filePath: string): Promise<AudioProbeResult> =>
    ipcRenderer.invoke('audio:probe-file', filePath),

  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  exportCampaign: (json: string, suggestedName: string): Promise<boolean> =>
    ipcRenderer.invoke('campaign:export', json, suggestedName),
  importCampaign: (): Promise<string | null> => ipcRenderer.invoke('campaign:import'),
  collectCampaignMedia: async (
    campaign: Campaign,
    onProgress: (progress: CollectMediaProgress) => void,
  ): Promise<CollectCampaignMediaResult> => {
    const requestId = randomUUID()
    const handler = (
      _event: Electron.IpcRendererEvent,
      message: { requestId: string; progress: CollectMediaProgress },
    ): void => {
      if (message.requestId === requestId) onProgress(message.progress)
    }
    ipcRenderer.on('campaign:collect-media-progress', handler)
    try {
      const result: CollectCampaignMediaResult = await ipcRenderer.invoke(
        'campaign:collect-media',
        campaign,
        requestId,
      )
      onProgress(result.finalProgress)
      return result
    } finally {
      ipcRenderer.removeListener('campaign:collect-media-progress', handler)
    }
  },

  getServerInfo: (): Promise<{ port: number; localIP: string }> =>
    ipcRenderer.invoke('server:get-info'),
  onRemoteCommand: (callback: (command: RemoteCommand) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, command: RemoteCommand): void => {
      callback(command)
    }
    ipcRenderer.on('remote:command', handler)
    return () => {
      ipcRenderer.removeListener('remote:command', handler)
    }
  },
  onConnectionStatus: (callback: (status: { connectedClients: number }) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: { connectedClients: number },
    ): void => {
      callback(status)
    }
    ipcRenderer.on('server:connection-status', handler)
    return () => {
      ipcRenderer.removeListener('server:connection-status', handler)
    }
  },
  sendStateUpdate: (message: RemoteStateMessage): void => {
    ipcRenderer.send('remote:state-update', message)
  },
  sendFullState: (state: RemoteFullState, broadcast = false): void => {
    ipcRenderer.send('remote:full-state', state, broadcast)
  },
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
