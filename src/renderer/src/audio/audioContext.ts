/**
 * Single shared AudioContext for the renderer.
 *
 * The music engine (dual-channel crossfade) and the ambient engine both graph
 * into it. Sharing one context — rather than each owning its own — keeps a
 * single output stream to the device and lets ambient layers and music be
 * scheduled against the same clock.
 *
 * Ownership lives here instead of in AudioEngine so AmbientEngine doesn't have
 * to import AudioEngine (which imports it back).
 */

let ctx: AudioContext | null = null

export function getAudioContext(): AudioContext {
  if (!ctx || ctx.state === 'closed') {
    ctx = new AudioContext()
  }
  if (ctx.state === 'suspended') {
    void ctx.resume()
  }
  return ctx
}

/** The current context without creating one — for teardown paths. */
export function peekAudioContext(): AudioContext | null {
  return ctx
}

export function closeAudioContext(): void {
  void ctx?.close()
  ctx = null
}
