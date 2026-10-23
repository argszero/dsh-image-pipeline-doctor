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
import { probeImagePipeline } from './probe.js';
export { ONE_PIXEL_MEDIA_TYPE, ONE_PIXEL_PNG, describeImageFailure, probeImagePipeline, } from './probe.js';
/** Cordis plugin name. */
export const name = 'image-pipeline-doctor';
/**
 * The service the probe reads through.
 *
 * Declared as a hard requirement on purpose: it is what makes "no service" a
 * silence rather than a case to branch on. Without `attachments` the plugin
 * stays pending and inert, and a host with no attachment plane has no image
 * pipeline to diagnose.
 */
export const inject = ['attachments'];
/** Defaults, applied by {@link Config}. */
const DEFAULTS = { enabled: true, delayMs: 0 };
/**
 * Runtime schema in the standard-schema dialect the Loader accepts, kept
 * dependency-free: this package ships no runtime dependencies.
 */
export const Config = {
    '~standard': {
        version: 1,
        vendor: 'dsh-image-pipeline-doctor',
        /**
         * Validate the declared configuration.
         * @param value - the raw configuration node.
         * @returns the configuration, or the problems that make it unusable.
         */
        validate(value) {
            const issues = [];
            const row = (value ?? {});
            if (row.enabled !== undefined && typeof row.enabled !== 'boolean') {
                issues.push({ message: 'enabled must be a boolean' });
            }
            if (row.delayMs !== undefined && (typeof row.delayMs !== 'number' || !Number.isFinite(row.delayMs) || row.delayMs < 0)) {
                issues.push({ message: 'delayMs must be a non-negative finite number' });
            }
            if (issues.length > 0)
                return { issues };
            return { value: { ...DEFAULTS, ...row } };
        },
    },
};
/**
 * Take one reading and report a failure once.
 * @param ctx - the context to read the service through.
 * @returns what the probe established, so an explicit caller can act on it.
 */
export async function check(ctx) {
    let service;
    try {
        service = ctx.get('attachments');
    }
    catch {
        // A context that cannot hand the service over is a host with nothing to
        // diagnose, which is a silence rather than a finding.
        return { status: 'skipped', reason: 'unreadable-service' };
    }
    const result = await probeImagePipeline(service);
    if (result.status === 'failed') {
        ctx.logger?.warn('image pipeline self-check failed: %s', result.message);
    }
    return result;
}
/**
 * Mount the plugin: one probe after activation, and nothing else.
 * @param ctx - the plugin's context.
 * @param config - declared configuration.
 */
export function apply(ctx, config = DEFAULTS) {
    if (!config.enabled)
        return;
    try {
        const handle = setTimeout(() => { void check(ctx).catch(() => { }); }, config.delayMs);
        // A doctor must never hold the process open on its own account.
        handle.unref?.();
        ctx.effect?.(() => () => { clearTimeout(handle); }, 'image-pipeline-doctor.probe');
    }
    catch {
        /* Whatever went wrong here, a boot is worth more than this diagnostic. */
    }
}
export default { name, inject, Config, apply };
