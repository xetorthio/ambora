import { describe, it, expect, vi, afterEach } from 'vitest'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { WebSocketServer } from 'ws'

// server.ts imports these at module scope; the port logic touches neither.
vi.mock('electron', () => ({
  app: { getAppPath: () => '/tmp/ambora-test' },
  BrowserWindow: class {},
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

import { listenOnFirstFreePort, DEFAULT_PORT, PORT_ATTEMPTS } from '../../src/main/server'

const HOST = '127.0.0.1'
/** Reserved for documentation (RFC 5737), so never bindable on a real host. */
const UNBINDABLE_HOST = '203.0.113.1'

const opened: Server[] = []

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve()
      return
    }
    server.close(() => resolve())
  })
}

/** Bind an ephemeral port and report which one, so tests never guess. */
async function occupyFreePort(): Promise<number> {
  const server = createServer()
  opened.push(server)
  await new Promise<void>((resolve) => server.listen(0, HOST, resolve))
  return (server.address() as AddressInfo).port
}

/** A port nothing is listening on: take one, then immediately give it back. */
async function borrowFreePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, HOST, resolve))
  const { port } = server.address() as AddressInfo
  await close(server)
  return port
}

function subject(): Server {
  const server = createServer()
  opened.push(server)
  return server
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map(close))
})

describe('listenOnFirstFreePort', () => {
  it('takes the first port when it is free', async () => {
    const free = await borrowFreePort()
    const server = subject()

    await expect(listenOnFirstFreePort(server, HOST, [free])).resolves.toBe(free)
    expect((server.address() as AddressInfo).port).toBe(free)
  })

  it('falls back to the next port when the preferred one is taken', async () => {
    const taken = await occupyFreePort()
    const free = await borrowFreePort()
    const server = subject()

    // Also covers the load-bearing assumption that one server object can be
    // re-listened after a failed bind, so the walk does not need a fresh
    // server (and a fresh Express app) per attempt.
    await expect(listenOnFirstFreePort(server, HOST, [taken, free])).resolves.toBe(free)
  })

  it('skips several taken ports in order', async () => {
    const first = await occupyFreePort()
    const second = await occupyFreePort()
    const free = await borrowFreePort()
    const server = subject()

    await expect(listenOnFirstFreePort(server, HOST, [first, second, free])).resolves.toBe(free)
  })

  it('rejects with EADDRINUSE when every port is taken', async () => {
    const ports = [await occupyFreePort(), await occupyFreePort()]
    const server = subject()

    await expect(listenOnFirstFreePort(server, HOST, ports)).rejects.toMatchObject({
      code: 'EADDRINUSE',
    })
    expect(server.listening).toBe(false)
  })

  it('rejects with EADDRINUSE when offered no ports at all', async () => {
    await expect(listenOnFirstFreePort(subject(), HOST, [])).rejects.toMatchObject({
      code: 'EADDRINUSE',
    })
  })

  it('propagates a non-EADDRINUSE error instead of walking the range', async () => {
    const free = await borrowFreePort()
    const server = subject()

    // A bad host fails the same way on every port, so retrying is pointless.
    const error = await listenOnFirstFreePort(server, UNBINDABLE_HOST, [free, free]).catch(
      (err: NodeJS.ErrnoException) => err,
    )

    expect(error.code).toBeDefined()
    expect(error.code).not.toBe('EADDRINUSE')
    expect(server.listening).toBe(false)
  })
})

describe('port range', () => {
  it('starts at the preferred port and stays contiguous', () => {
    const ports = Array.from({ length: PORT_ATTEMPTS }, (_, i) => DEFAULT_PORT + i)

    expect(ports[0]).toBe(DEFAULT_PORT)
    expect(ports).toHaveLength(PORT_ATTEMPTS)
    expect(ports[ports.length - 1]).toBe(DEFAULT_PORT + PORT_ATTEMPTS - 1)
  })
})

// The silent no-window launch in #47: `ws` forwards the HTTP server's 'error'
// to the WebSocketServer, and an EventEmitter with no 'error' listener throws.
// Attaching the socket server before the bind therefore turns a survivable
// EADDRINUSE into an uncaught exception that kills the main process event loop.
describe('WebSocketServer attach order', () => {
  it('forwards a failed bind to the socket server', async () => {
    const taken = await occupyFreePort()
    const server = subject()
    const socketServer = new WebSocketServer({ server })
    const forwarded: (string | undefined)[] = []
    socketServer.on('error', (err: NodeJS.ErrnoException) => forwarded.push(err.code))

    await expect(listenOnFirstFreePort(server, HOST, [taken])).rejects.toMatchObject({
      code: 'EADDRINUSE',
    })

    expect(forwarded).toEqual(['EADDRINUSE'])
    socketServer.close()
  })

  it('throws that forwarded error when nothing is listening for it', () => {
    const socketServer = new WebSocketServer({ noServer: true })

    expect(() => socketServer.emit('error', new Error('bind failed'))).toThrow('bind failed')

    socketServer.close()
  })
})
