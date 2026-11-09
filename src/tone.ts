// Orca's components take five semantic tones, never a free colour. A Hilbana state has a hex colour,
// so the nearest tone is picked by hue; states with no (usable) colour fall back to their category.
import type { StateTone } from './protocol'

/** Hue, saturation and lightness (0-360, 0-1, 0-1) of "#rrggbb" or "#rgb"; null if it is not a colour. */
function hsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const full = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s, l }
}

/** What a state looks like when Hilbana gives no colour for it: by category. */
export function toneForType(stateType: string | null | undefined): StateTone {
  if (stateType === 'completed') return 'success'
  if (stateType === 'canceled') return 'danger'
  if (stateType === 'started') return 'accent'
  return 'neutral'
}

/** The Orca tone closest to a state's Hilbana colour:
 *  grey → neutral, red → danger, orange/yellow → warning, green → success, cyan/blue/purple → accent. */
export function toneFor(color: string | null | undefined, stateType?: string | null): StateTone {
  const parsed = color ? hsl(color) : null
  if (!parsed) return toneForType(stateType)
  if (parsed.s < 0.2 || parsed.l < 0.1 || parsed.l > 0.95) return 'neutral'
  const { h } = parsed
  if (h >= 345 || h < 15) return 'danger'
  if (h < 70) return 'warning'
  if (h < 170) return 'success'
  return 'accent'
}
