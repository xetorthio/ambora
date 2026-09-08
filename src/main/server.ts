import { createServer, type Server } from 'http'
import { join } from 'path'
import { networkInterfaces } from 'os'
import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { app, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { RemoteFullState, RemoteStateMessage } from '../shared/types'
import { parseRemoteCommand } from '../shared/remoteCommand'

/**
 * Preferred port. Tried first on every launch so a phone that bookmarked the
 * pairing URL keeps working, rather than chasing an ephemeral port each time.
 */
export const DEFAULT_PORT = 3000
/** Consecutive ports tried, starting at DEFAULT_PORT, before giving up. */
export const PORT_ATTEMPTS = 10
/** Drop oversized remote messages (commands are tiny JSON). */
const WS_MAX_PAYLOAD = 64 * 1024

let httpServer: ReturnType<typeof createServer> | null = null
let wss: WebSocketServer | null = null
let cachedState: RemoteFullState | null = null
let mainWindow: BrowserWindow | null = null

const clients = new Set<WebSocket>()

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

export function getLocalIP(): string {
  const interfaces = networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name]
    if (!addrs) continue
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address
      }
    }
  }
  return '127.0.0.1'
}

export function broadcastToClients(message: RemoteStateMessage): void {
  const data = JSON.stringify(message)
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  }
}

export function updateCachedState(state: RemoteFullState): void {
  cachedState = state
}

/**
 * Bind `server` to the first port in `ports` that is free.
 *
 * A port already taken raises EADDRINUSE and we move on; anything else (a bad
 * host, a privileged port) is a real failure and propagates, because walking
 * the range would only produce the same error ten more times. A Node server
 * can be re-listened after a failed bind, so one server object is reused
 * across attempts.
 */
export function listenOnFirstFreePort(
  server: Server,
  host: string,
  ports: number[],
): Promise<number> {
  return ports.reduce<Promise<number>>(
    (previous, port) =>
      previous.catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EADDRINUSE') throw error
        return bind(server, host, port)
      }),
    Promise.reject<number>(
      Object.assign(new Error('No ports were offered'), { code: 'EADDRINUSE' }),
    ),
  )
}

function bind(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onListening = (): void => {
      server.off('error', onError)
      resolve(port)
    }
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off('listening', onListening)
      reject(error)
    }

    server.once('listening', onListening)
    server.once('error', onError)
    server.listen(port, host)
  })
}

/** Resolves with the port the server actually bound to. */
export async function startServer(): Promise<number> {
  const expressApp = express()

  // In production, serve the renderer build at /desktop/ so the
  // BrowserWindow can load from http://localhost:<port>/desktop/ and
  // get a proper HTTP origin that YouTube accepts for embedding.
  if (!is.dev) {
    const rendererPath = join(__dirname, '../renderer')
    expressApp.use('/desktop', express.static(rendererPath))
  }

  // Serve phone remote static files
  const remotePath = is.dev ? join(__dirname, '../../remote') : join(app.getAppPath(), '../remote')

  // The remote is updated together with the desktop app. Avoid leaving a
  // phone on an older HTML/JS shell that cannot render newly-added state.
  expressApp.use(
    express.static(remotePath, {
      setHeaders(response) {
        response.setHeader('Cache-Control', 'no-store')
      },
    }),
  )

  const server = createServer(expressApp)
  httpServer = server

  const ports = Array.from({ length: PORT_ATTEMPTS }, (_, i) => DEFAULT_PORT + i)
  const port = await listenOnFirstFreePort(server, '0.0.0.0', ports)

  // Attached only once the port is ours. `ws` forwards the HTTP server's
  // 'error' to the WebSocketServer, which has no error listener of its own, so
  // attaching it before the bind turns a survivable EADDRINUSE into an uncaught
  // exception: the main process event loop dies, no window is ever created, and
  // nothing is logged. That is the silent no-window launch in #47.
  const socketServer = new WebSocketServer({ server, maxPayload: WS_MAX_PAYLOAD })
  wss = socketServer

  // Past the initial bind there is nowhere to return an error to. Log both,
  // rather than letting an unhandled 'error' event take the process down.
  server.on('error', (err) => {
    console.error('[server] Server error:', err)
  })
  socketServer.on('error', (err) => {
    console.error('[server] WebSocket server error:', err)
  })

  function notifyConnectionCount(): void {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server:connection-status', {
        connectedClients: clients.size,
      })
    }
  }

  socketServer.on('connection', (ws) => {
    clients.add(ws)
    notifyConnectionCount()

    // Send cached state to new connection
    if (cachedState) {
      const msg: RemoteStateMessage = { type: 'full-state', payload: cachedState }
      ws.send(JSON.stringify(msg))
    }

    ws.on('message', (raw) => {
      try {
        const parsed: unknown = JSON.parse(raw.toString())
        const command = parseRemoteCommand(parsed)
        if (!command) return
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('remote:command', command)
        }
      } catch {
        // Ignore malformed messages
      }
    })

    ws.on('close', () => {
      clients.delete(ws)
      notifyConnectionCount()
    })
  })

  if (port !== DEFAULT_PORT) {
    console.log(`[server] Port ${DEFAULT_PORT} was in use, fell back to ${port}`)
  }
  console.log(`[server] Listening on http://0.0.0.0:${port}`)
  return port
}

export function stopServer(): void {
  for (const client of clients) {
    client.close()
  }
  clients.clear()

  wss?.close()
  wss = null

  httpServer?.close()
  httpServer = null
}
