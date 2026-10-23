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
import { type ProbeResult } from './probe.js';
export { ONE_PIXEL_MEDIA_TYPE, ONE_PIXEL_PNG, describeImageFailure, probeImagePipeline, } from './probe.js';
export type { DescribedImageFailure, ImageFailureKind, ProbeResult } from './probe.js';
/** Cordis plugin name. */
export declare const name = "image-pipeline-doctor";
/**
 * The service the probe reads through.
 *
 * Declared as a hard requirement on purpose: it is what makes "no service" a
 * silence rather than a case to branch on. Without `attachments` the plugin
 * stays pending and inert, and a host with no attachment plane has no image
 * pipeline to diagnose.
 */
export declare const inject: string[];
/** Plugin configuration. */
export interface Config {
    /** Run the probe on activation; false leaves the plugin mounted and silent. */
    enabled: boolean;
    /** Milliseconds to wait before probing, for a Host tree that is still settling. */
    delayMs: number;
}
/**
 * Runtime schema in the standard-schema dialect the Loader accepts, kept
 * dependency-free: this package ships no runtime dependencies.
 */
export declare const Config: {
    '~standard': {
        version: 1;
        vendor: string;
        /**
         * Validate the declared configuration.
         * @param value - the raw configuration node.
         * @returns the configuration, or the problems that make it unusable.
         */
        validate(value: unknown): {
            value: Config;
        } | {
            issues: {
                message: string;
            }[];
        };
    };
};
/** The slice of a Cordis context this plugin uses. */
interface Context {
    get(name: string): unknown;
    effect?(callback: () => unknown, label?: string): unknown;
    logger?: {
        warn(...args: unknown[]): void;
    };
}
/**
 * Take one reading and report a failure once.
 * @param ctx - the context to read the service through.
 * @returns what the probe established, so an explicit caller can act on it.
 */
export declare function check(ctx: Context): Promise<ProbeResult>;
/**
 * Mount the plugin: one probe after activation, and nothing else.
 * @param ctx - the plugin's context.
 * @param config - declared configuration.
 */
export declare function apply(ctx: Context, config?: Config): void;
declare const _default: {
    name: string;
    inject: string[];
    Config: {
        '~standard': {
            version: 1;
            vendor: string;
            /**
             * Validate the declared configuration.
             * @param value - the raw configuration node.
             * @returns the configuration, or the problems that make it unusable.
             */
            validate(value: unknown): {
                value: Config;
            } | {
                issues: {
                    message: string;
                }[];
            };
        };
    };
    apply: typeof apply;
};
export default _default;
