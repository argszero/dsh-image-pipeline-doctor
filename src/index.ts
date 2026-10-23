/**
 * Say at boot that the host's image decode path is broken, instead of letting a
 * user find out by pasting a screenshot and reading `session/agent-busy`.
 *
 * One probe runs once, right after activation: a 1×1 PNG through
 * `ctx.attachments.validateImage()`, which reaches the decoder before any
 * pass-through decision. A healthy install says nothing at all; a broken one gets
 * exactly one line naming the decoder and the real cause.
 *
 * It reads and reports. It never repairs, never writes an attachment, never
 * retries and never throws: a diagnostic that can stop a boot is worse than the
 * defect it reports, so every path out of this plugin is a normal return.
 * @module @argszero/dsh-image-pipeline-doctor
 */
import { probeImagePipeline, type ProbeResult } from './probe.js'

export {
  ONE_PIXEL_MEDIA_TYPE,
  ONE_PIXEL_PNG,
  describeImageFailure,
  probeImagePipeline,
} from './probe.js'
export type { DescribedImageFailure, ImageFailureKind, ProbeResult } from './probe.js'

/** Cordis plugin name. */
export const name = 'image-pipeline-doctor'

/**
 * The service the probe reads through.
 *
 * Declared as a hard requirement on purpose: it is what makes "no service" a
 * silence rather than a case to branch on. Without `attachments` the plugin
 * stays pending and inert, and a host with no attachment plane has no image
 * pipeline to diagnose.
 */
export const inject = ['attachments']

/** Plugin configuration. */
export interface Config {
  /** Run the probe on activation; false leaves the plugin mounted and silent. */
  enabled: boolean
  /** Milliseconds to wait before probing, for a Host tree that is still settling. */
  delayMs: number
}

/** Defaults, applied by {@link Config}. */
const DEFAULTS: Config = { enabled: true, delayMs: 0 }

/**
 * Runtime schema in the standard-schema dialect the Loader accepts, kept
 * dependency-free: this package ships no runtime dependencies.
 */
export const Config = {
  '~standard': {
    version: 1 as const,
    vendor: 'dsh-image-pipeline-doctor',
    /**
     * Validate the declared configuration.
     * @param value - the raw configuration node.
     * @returns the configuration, or the problems that make it unusable.
     */
    validate(value: unknown): { value: Config } | { issues: { message: string }[] } {
      const issues: { message: string }[] = []
      const row = (value ?? {}) as Partial<Config>
      if (row.enabled !== undefined && typeof row.enabled !== 'boolean') {
        issues.push({ message: 'enabled must be a boolean' })
      }
      if (row.delayMs !== undefined && (typeof row.delayMs !== 'number' || !Number.isFinite(row.delayMs) || row.delayMs < 0)) {
        issues.push({ message: 'delayMs must be a non-negative finite number' })
      }
      if (issues.length > 0) return { issues }
      return { value: { ...DEFAULTS, ...row } }
    },
  },
}

/** A pending timer, as the host runtime hands one back. */
interface TimerHandle {
  /** Release the event loop's hold on the process, where the runtime offers it. */
  unref?(): void
}

/* Declared rather than derived from `@types/node`, as above. */
declare const setTimeout: (callback: () => void, milliseconds: number) => TimerHandle
declare const clearTimeout: (handle: TimerHandle) => void

/** The slice of a Cordis context this plugin uses. */
interface Context {
  get(name: string): unknown
  effect?(callback: () => unknown, label?: string): unknown
  logger?: { warn(...args: unknown[]): void }
}

/**
 * Take one reading and report a failure once.
 * @param ctx - the context to read the service through.
 * @returns what the probe established, so an explicit caller can act on it.
 */
export async function check(ctx: Context): Promise<ProbeResult> {
  let service: unknown
  try {
    service = ctx.get('attachments')
  } catch {
    // A context that cannot hand the service over is a host with nothing to
    // diagnose, which is a silence rather than a finding.
    return { status: 'skipped', reason: 'unreadable-service' }
  }
  const result = await probeImagePipeline(service)
  if (result.status === 'failed') {
    // One argument, not a format string plus one: a sink that renders the
    // message without cordis's formatter would otherwise show the `%s`.
    ctx.logger?.warn(`image pipeline self-check failed: ${result.message}`)
  }
  return result
}

/**
 * Mount the plugin: one probe after activation, and nothing else.
 * @param ctx - the plugin's context.
 * @param config - declared configuration.
 */
export function apply(ctx: Context, config: Config = DEFAULTS): void {
  if (!config.enabled) return
  try {
    const handle = setTimeout(() => { void check(ctx).catch(() => {}) }, config.delayMs)
    // A doctor must never hold the process open on its own account.
    handle.unref?.()
    ctx.effect?.(() => () => { clearTimeout(handle) }, 'image-pipeline-doctor.probe')
  } catch {
    /* Whatever went wrong here, a boot is worth more than this diagnostic. */
  }
}

export default { name, inject, Config, apply }
