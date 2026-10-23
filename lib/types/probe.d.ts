/**
 * One probe of the host image decode path, and the words for what it found.
 *
 * `ctx.attachments.validateImage()` is public and documented as validating one
 * image without persisting it, and its admission policy reaches the decoder
 * before the pass-through branch that would skip re-encoding: `validateImage` →
 * `validateImageFile` → `prepareImageFile` → `inspectMetadata` → `detectImage`,
 * which calls `requireSharp()` before it looks at the bytes. A single 1×1 PNG
 * therefore exercises the same native module a pasted screenshot needs.
 *
 * That is the whole probe: one tiny image in, and the load failure out — at
 * boot, instead of at the first paste twenty minutes later.
 *
 * Nothing here throws and nothing here writes. The probe reports; the caller
 * decides what to say.
 * @module @argszero/dsh-image-pipeline-doctor/probe
 */
/** The 1×1 transparent PNG the probe submits, as its exact 70 encoded bytes. */
export declare const ONE_PIXEL_PNG: Uint8Array;
/** The media type declared for {@link ONE_PIXEL_PNG}. */
export declare const ONE_PIXEL_MEDIA_TYPE: "image/png";
/** Which kind of failure the evidence points at. */
export type ImageFailureKind = 'decoder-cannot-load' | 'decoder-missing' | 'decoder-rejected' | 'unknown';
/** One line about a failed probe, plus the kind it was read as. */
export interface DescribedImageFailure {
    /** The reading, decided by the codes present anywhere in the cause chain. */
    readonly kind: ImageFailureKind;
    /** One line naming the decoder and the real cause, cause chain included. */
    readonly message: string;
}
/** What one probe established. */
export type ProbeResult = {
    readonly status: 'ok';
} | {
    readonly status: 'skipped';
    readonly reason: 'no-service' | 'no-method' | 'unreadable-service';
} | {
    readonly status: 'failed';
    readonly kind: ImageFailureKind;
    readonly message: string;
};
/**
 * Turn whatever a failed probe rejected with into one attributable line.
 *
 * The line names the decoder, the code that carries the cause, and every
 * `cause` link beneath it — the raw native loader message is kept rather than
 * paraphrased, because the path it names is the fact a reader acts on.
 * @param error - the value the probe rejected with.
 * @returns the reading and its one line.
 */
export declare function describeImageFailure(error: unknown): DescribedImageFailure;
/**
 * Run one probe against an attachment service, without ever throwing.
 * @param service - the host's `attachments` service, or whatever is in its place.
 * @returns what the probe established; a missing or unusable service is skipped,
 * never reported as a failure.
 */
export declare function probeImagePipeline(service: unknown): Promise<ProbeResult>;
