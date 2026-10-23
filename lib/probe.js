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
/** A 1×1 fully transparent PNG, as base64. The smallest image that still decodes. */
const ONE_PIXEL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** The 1×1 transparent PNG the probe submits, as its exact 70 encoded bytes. */
export const ONE_PIXEL_PNG = Uint8Array.from(Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'));
/** The media type declared for {@link ONE_PIXEL_PNG}. */
export const ONE_PIXEL_MEDIA_TYPE = 'image/png';
/** Node's code for a native binding that exists but will not load. */
const LOAD_CODES = new Set(['ERR_DLOPEN_FAILED', 'ERR_DLOPEN_FAILED_DEPENDENCY']);
/** Node's code for a module that cannot be resolved at all. */
const MISSING_CODES = new Set(['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND']);
/** The admission policy's own codes: the decoder was reached and refused the image. */
const REJECTION_CODES = new Set(['INVALID_IMAGE', 'ATTACHMENT_WRITE_FAILED']);
/** Upper bound on one rendered line, so a native loader's wall of text stays readable. */
const MAX_LINE = 320;
/** Upper bound on the cause chain, so a cyclic `cause` cannot spin. */
const MAX_CHAIN = 3;
/**
 * Keep the first line of a message, bounded.
 * @param message - the raw message.
 * @returns one bounded line.
 */
function firstLine(message) {
    const line = message.split('\n', 1)[0] ?? message;
    return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line;
}
/**
 * Read one link of a cause chain.
 * @param error - the value a rejection carried.
 * @returns the readable step, or undefined when the value says nothing.
 */
function stepOf(error) {
    if (typeof error === 'string') {
        return error === '' ? undefined : { message: firstLine(error), cause: undefined };
    }
    if (error === null || typeof error !== 'object')
        return undefined;
    const record = error;
    const code = typeof record.code === 'string' && record.code !== '' ? record.code : undefined;
    const raw = typeof record.message === 'string' && record.message !== '' ? record.message : undefined;
    const message = raw === undefined ? 'no message' : firstLine(raw);
    return code === undefined ? { message, cause: record.cause } : { code, message, cause: record.cause };
}
/**
 * Walk a rejection's `cause` chain outermost first.
 * @param error - the value a rejection carried.
 * @returns the readable links, empty when there is nothing to say.
 */
function chainOf(error) {
    const chain = [];
    let current = error;
    for (let depth = 0; depth < MAX_CHAIN; depth += 1) {
        const step = stepOf(current);
        if (step === undefined)
            break;
        chain.push(step);
        current = step.cause;
    }
    return chain;
}
/**
 * Render one link.
 * @param step - the link to render.
 * @returns `CODE: message`, or the message when the link carries no code.
 */
function formatStep(step) {
    return step.code === undefined ? step.message : `${step.code}: ${step.message}`;
}
/**
 * Decide which kind of failure a chain is evidence of.
 *
 * A load failure is reported by the innermost link a wrapper put its cause in,
 * so every link is consulted rather than the outermost one alone: the host wraps
 * a decoder that loaded but then refused the bytes, and an unwrapped
 * `requireSharp()` failure on the same path is what a broken native module looks
 * like.
 * @param chain - the rendered cause chain.
 * @returns the reading.
 */
function kindOf(chain) {
    const has = (codes) => chain.some(step => step.code !== undefined && codes.has(step.code));
    if (has(LOAD_CODES))
        return 'decoder-cannot-load';
    if (has(MISSING_CODES))
        return 'decoder-missing';
    if (has(REJECTION_CODES))
        return 'decoder-rejected';
    return 'unknown';
}
/**
 * The headline for one reading.
 * @param kind - the reading.
 * @returns a phrase that names the decoder and what happened to it.
 */
function headline(kind) {
    switch (kind) {
        case 'decoder-cannot-load':
            return 'the host image decoder (sharp) cannot load its native binding';
        case 'decoder-missing':
            return 'the host image decoder (sharp) is not installed';
        case 'decoder-rejected':
            return 'the host image decoder (sharp) refused the probe image';
        default:
            return 'the host image decode probe failed';
    }
}
/**
 * Turn whatever a failed probe rejected with into one attributable line.
 *
 * The line names the decoder, the code that carries the cause, and every
 * `cause` link beneath it — the raw native loader message is kept rather than
 * paraphrased, because the path it names is the fact a reader acts on.
 * @param error - the value the probe rejected with.
 * @returns the reading and its one line.
 */
export function describeImageFailure(error) {
    const chain = chainOf(error);
    const outermost = chain[0];
    if (outermost === undefined) {
        return {
            kind: 'unknown',
            message: 'the host image decode probe failed with a value that carried no message',
        };
    }
    const kind = kindOf(chain);
    return { kind, message: `${headline(kind)}: ${chain.map(formatStep).join(' ← caused by ')}` };
}
/**
 * Run one probe against an attachment service, without ever throwing.
 * @param service - the host's `attachments` service, or whatever is in its place.
 * @returns what the probe established; a missing or unusable service is skipped,
 * never reported as a failure.
 */
export async function probeImagePipeline(service) {
    if (service === null || service === undefined)
        return { status: 'skipped', reason: 'no-service' };
    const validate = service.validateImage;
    if (typeof validate !== 'function')
        return { status: 'skipped', reason: 'no-method' };
    try {
        await validate.call(service, {
            data: ONE_PIXEL_PNG.slice(),
            mediaType: ONE_PIXEL_MEDIA_TYPE,
        });
        return { status: 'ok' };
    }
    catch (error) {
        const described = describeImageFailure(error);
        return { status: 'failed', kind: described.kind, message: described.message };
    }
}
