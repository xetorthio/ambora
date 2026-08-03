import { cn } from '@/lib/utils'

/**
 * Three-bar level meter showing what a layer is doing in the *live* scene:
 *
 * - sounding  → bars animate, in the climate colour ("audible right now")
 * - armed     → flat dim bars ("part of the scene, waiting for its next fire")
 * - otherwise → nothing is rendered
 *
 * Deliberately separate from the preview (▶) button, which acts on the layer
 * regardless of what's playing and says nothing about scene state.
 */
interface AmbientActivityProps {
  /** The layer's climate is the one currently playing. */
  isLive: boolean
  enabled: boolean
  sounding: boolean
  color: string
}

const BAR_DELAYS = ['0ms', '160ms', '320ms']

export function AmbientActivity({
  isLive,
  enabled,
  sounding,
  color,
}: AmbientActivityProps): React.JSX.Element | null {
  if (!isLive || !enabled) return null

  const label = sounding ? 'Playing now' : 'Waiting for next play'

  return (
    <span
      className="flex h-3.5 w-3.5 shrink-0 items-end justify-center gap-[2px]"
      title={label}
      aria-label={label}
      role="img"
    >
      {BAR_DELAYS.map((delay, i) => (
        <span
          key={delay}
          className={cn('w-[2px] rounded-full', sounding ? 'h-3.5' : 'h-[3px]')}
          style={{
            backgroundColor: sounding ? color : 'var(--color-text-tertiary)',
            transformOrigin: 'bottom',
            animation: sounding ? `ambient-pulse 1.1s ease-in-out ${delay} infinite` : undefined,
            // Middle bar peaks a touch higher so the meter doesn't read as a flat block.
            maxHeight: sounding && i === 1 ? '14px' : '11px',
          }}
        />
      ))}
    </span>
  )
}
