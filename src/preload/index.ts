import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Campaign, RemoteCommand, RemoteStateMessage, RemoteFullState } from '../shared/types'

// Custom APIs for renderer
const api = {
  platform: process.platform,
  getCampaigns: (): Promise<Campaign[]> => ipcRenderer.invoke('data:get-campaigns'),
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

  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:get-version'),
  exportCampaign: (json: string, suggestedName: string): Promise<boolean> =>
    ipcRenderer.invoke('campaign:export', json, suggestedName),
  importCampaign: (): Promise<string | null> => ipcRenderer.invoke('campaign:import'),

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
  sendFullState: (state: RemoteFullState): void => {
    ipcRenderer.send('remote:full-state', state)
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
