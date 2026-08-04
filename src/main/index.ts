import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  dialog,
  desktopCapturer,
  session,
} from 'electron'
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { extname, join } from 'path'
import { randomUUID } from 'node:crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { AMBORA_FILE_FILTER } from '../shared/exportTypes'
import icon from '../../resources/icon.png?asset'
import { loadCampaigns, saveCampaigns, flushSave, loadLufsCache, saveLufsCache } from './data'
import {
  startServer,
  stopServer,
  broadcastToClients,
  updateCachedState,
  getLocalIP,
  setMainWindow,
} from './server'

let mainWindow: BrowserWindow | null = null
// token -> absolute file path, and the reverse index so repeated requests for
// the same file reuse one token instead of growing the registry unbounded.
const audioPathRegistry = new Map<string, string>()
const audioTokenByPath = new Map<string, string>()

// Map a file extension to a media MIME type so the renderer's <audio>
// element / FFmpeg demuxer gets an accurate content type.
function audioMimeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.mp3':
      return 'audio/mpeg'
    case '.m4a':
    case '.aac':
    case '.mp4':
      return 'audio/mp4'
    case '.flac':
      return 'audio/flac'
    case '.ogg':
    case '.oga':
      return 'audio/ogg'
    case '.opus':
      return 'audio/opus'
    case '.wav':
      return 'audio/wav'
    case '.webm':
      return 'audio/webm'
    default:
      return 'application/octet-stream'
  }
}

function createWindow(): BrowserWindow {
  // Create the browser window.
  const win = new BrowserWindow({
    title: `Ambora ${is.dev ? '(dev)' : `v${app.getVersion()}`}`,
    width: 900,
    height: 670,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false,
    },
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  // Production loads from the Express server so the renderer gets a proper
  // HTTP origin that YouTube accepts for embedding (avoids error 153).
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadURL('http://localhost:3000/desktop/')
  }

  return win
}

function registerIpcHandlers(): void {
  ipcMain.handle('data:get-campaigns', () => {
    return loadCampaigns()
  })

  ipcMain.on('data:save-campaigns', (_event, campaigns) => {
    saveCampaigns(campaigns)
  })

  ipcMain.handle('server:get-info', () => {
    return { port: 3000, localIP: getLocalIP() }
  })

  ipcMain.on('remote:state-update', (_event, message) => {
    broadcastToClients(message)
  })

  ipcMain.on('remote:full-state', (_event, state) => {
    updateCachedState(state)
  })

  ipcMain.handle('audio:register-path', (_event, filePath: string) => {
    const existing = audioTokenByPath.get(filePath)
    if (existing) return existing
    const token = randomUUID()
    audioPathRegistry.set(token, filePath)
    audioTokenByPath.set(filePath, token)
    return token
  })

  ipcMain.handle('audio:load-lufs-cache', () => {
    return loadLufsCache()
  })

  ipcMain.on('audio:save-lufs-cache', (_event, cache: Record<string, number>) => {
    saveLufsCache(cache)
  })

  ipcMain.handle('app:get-version', () => {
    return app.getVersion()
  })

  ipcMain.handle(
    'campaign:export',
    async (_event, json: string, suggestedName: string): Promise<boolean> => {
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: suggestedName,
        filters: [AMBORA_FILE_FILTER],
      })
      if (canceled || !filePath) return false
      writeFileSync(filePath, json, 'utf-8')
      return true
    },
  )

  ipcMain.handle('campaign:import', async (): Promise<string | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      filters: [AMBORA_FILE_FILTER],
      properties: ['openFile'],
    })
    if (canceled || filePaths.length === 0) return null
    return readFileSync(filePaths[0], 'utf-8')
  })

  ipcMain.handle('youtube:get-title', async (_event, videoUrl: string) => {
    try {
      const response = await net.fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`,
      )
      if (!response.ok) return null
      const data = (await response.json()) as { title?: string }
      return data.title ?? null
    } catch {
      return null
    }
  })
}

// Register custom protocol for serving local audio files.
// Must be called before app is ready.
// `corsEnabled` matters for the fetch() consumers (ambient clip decoding, LUFS
// analysis): the renderer has an http:// origin, so reading this scheme with
// fetch() is a cross-origin request. Without it Chromium blocks the request
// outright and the caller only sees "Failed to fetch". The <audio> element path
// is unaffected either way — media loads are no-cors.
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-audio', privileges: { stream: true, supportFetchAPI: true, corsEnabled: true } },
])

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Serve local audio files via custom protocol so the renderer
  // can load them regardless of its own origin (http:// in dev, file:// in prod).
  protocol.handle('local-audio', (request) => {
    // Present on every response, including errors: without it a fetch() caller
    // sees a generic "Failed to fetch" instead of the real status.
    const cors = { 'Access-Control-Allow-Origin': '*' }

    const token = new URL(request.url).pathname.replace(/^\/+/, '')
    const filePath = audioPathRegistry.get(token)
    if (!filePath) {
      return new Response('Not found', { status: 404, headers: cors })
    }

    let fileSize: number
    try {
      fileSize = statSync(filePath).size
    } catch {
      return new Response('Not found', { status: 404, headers: cors })
    }

    const contentType = audioMimeForPath(filePath)
    const toWebStream = (start: number, end: number): ReadableStream =>
      Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as ReadableStream

    // Honor HTTP Range requests. Chromium's <audio> element / FFmpeg demuxer
    // relies on range requests to seek and to progressively read the file;
    // returning the whole file (200) for a range request causes intermittent
    // PIPELINE_ERROR_READ ("data source error") on some files. See the media
    // pipeline docs: a streamed media source MUST support 206 Partial Content.
    const rangeHeader = request.headers.get('range')
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
      if (match && (match[1] !== '' || match[2] !== '')) {
        let start: number
        let end: number
        if (match[1] === '') {
          // Suffix range: last N bytes.
          start = Math.max(0, fileSize - Number(match[2]))
          end = fileSize - 1
        } else {
          start = Number(match[1])
          end = match[2] === '' ? fileSize - 1 : Math.min(Number(match[2]), fileSize - 1)
        }

        if (start > end || start >= fileSize) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: { ...cors, 'Content-Range': `bytes */${fileSize}` },
          })
        }

        return new Response(toWebStream(start, end), {
          status: 206,
          headers: {
            ...cors,
            'Content-Type': contentType,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
          },
        })
      }
    }

    // No (or unparseable) range: return the whole file, but advertise range
    // support so the media pipeline knows it may seek on later requests.
    return new Response(toWebStream(0, fileSize - 1), {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': contentType,
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
      },
    })
  })

  // System-audio capture backs the YouTube AGC, and Electron supports
  // `audio: 'loopback'` on Windows only. Registering this handler anywhere else
  // would let the renderer trigger an OS screen-recording prompt for a capture
  // that can never return an audio track — a scary permission dialog in exchange
  // for nothing. With no handler registered, Electron denies getDisplayMedia
  // outright, so the prompt cannot appear at all.
  if (process.platform === 'win32') {
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] })
        if (sources.length === 0) {
          callback({})
          return
        }
        callback({ video: sources[0], audio: 'loopback' })
      } catch (error) {
        // Previously swallowed, which made a failure here look like a mystery
        // "no video stream was provided" rejection further down.
        console.error('[display-media] could not enumerate screen sources:', error)
        callback({})
      }
    })
  }

  registerIpcHandlers()

  // Start the Express server first so the renderer can load from
  // http://localhost:3000/desktop/ in production.
  await startServer()

  mainWindow = createWindow()
  setMainWindow(mainWindow)

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
      setMainWindow(mainWindow)
    }
  })
})

// Flush pending data writes and stop server before quitting
app.on('before-quit', () => {
  stopServer()
  flushSave()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
