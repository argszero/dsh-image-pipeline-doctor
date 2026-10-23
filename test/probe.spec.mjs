/**
 * The probe's contract, one arm per silent control.
 *
 * Four of these are the reason the plugin can be installed at all: a healthy
 * service, a missing service, a service that cannot validate and a disabled
 * plugin each have to produce **no** warning. A doctor that warns on a working
 * host is one users delete, and that failure mode is unrecoverable because
 * nobody reads the line before uninstalling.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ONE_PIXEL_MEDIA_TYPE,
  ONE_PIXEL_PNG,
  check,
  describeImageFailure,
  probeImagePipeline,
} from '../lib/index.js'

/** The failure the reported issue produces: a native binding that will not load. */
const DLL = 'file:///C:/Users/reporter/AppData/Local/dsh/libvips-42.dll'
function dlopenFailure() {
  const error = new Error(`Could not load the native module: ${DLL} is not a valid Win32 application.`)
  error.code = 'ERR_DLOPEN_FAILED'
  return error
}

/** A context whose logger records every call, so "exactly one warning" is countable. */
function recordingContext(service) {
  const warnings = []
  return {
    warnings,
    ctx: {
      get(name) {
        assert.equal(name, 'attachments')
        return service
      },
      effect() {
        return () => {}
      },
      logger: { warn: (...args) => warnings.push(args) },
    },
  }
}

/** A service that validates whatever it is handed. */
const healthy = { validateImage: async () => {} }

test('the probe submits one 1x1 PNG', () => {
  assert.equal(ONE_PIXEL_PNG.byteLength, 70)
  assert.deepEqual(
    [...ONE_PIXEL_PNG.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  )
  assert.equal(Buffer.from(ONE_PIXEL_PNG.subarray(12, 16)).toString('latin1'), 'IHDR')
  assert.equal(ONE_PIXEL_MEDIA_TYPE, 'image/png')
})

test('a broken decoder produces exactly one warning naming the module and the cause', async () => {
  const { ctx, warnings } = recordingContext({ validateImage: async () => { throw dlopenFailure() } })
  const result = await check(ctx)

  assert.equal(result.status, 'failed')
  assert.equal(result.kind, 'decoder-cannot-load')
  assert.equal(warnings.length, 1)
  const line = warnings[0].join(' ')
  assert.match(line, /image pipeline self-check failed/)
  assert.match(line, /sharp/)
  assert.match(line, /ERR_DLOPEN_FAILED/)
  assert.match(line, /libvips-42\.dll/)
})

test('a healthy decoder is silent', async () => {
  const { ctx, warnings } = recordingContext(healthy)
  const result = await check(ctx)

  assert.deepEqual(result, { status: 'ok' })
  assert.equal(warnings.length, 0)
})

test('a missing service is silent, not a failure', async () => {
  const { ctx, warnings } = recordingContext(undefined)
  const result = await check(ctx)

  assert.deepEqual(result, { status: 'skipped', reason: 'no-service' })
  assert.equal(warnings.length, 0)
})

test('a service that cannot validate is silent, not a failure', async () => {
  const { ctx, warnings } = recordingContext({ retrieve: async () => {} })
  const result = await check(ctx)

  assert.deepEqual(result, { status: 'skipped', reason: 'no-method' })
  assert.equal(warnings.length, 0)
})

test('a service the context cannot hand over is silent', async () => {
  const warnings = []
  const ctx = {
    get() { throw new Error('cannot get required service "attachments" in inactive context') },
    logger: { warn: (...args) => warnings.push(args) },
  }
  const result = await check(ctx)

  assert.deepEqual(result, { status: 'skipped', reason: 'unreadable-service' })
  assert.equal(warnings.length, 0)
})

test('a wrapped failure keeps both layers, and the deepest one decides the reading', async () => {
  const wrapped = Object.assign(new Error('Unsupported or malformed image data.'), {
    code: 'INVALID_IMAGE',
    cause: dlopenFailure(),
  })
  const described = describeImageFailure(wrapped)

  assert.equal(described.kind, 'decoder-cannot-load')
  assert.match(described.message, /INVALID_IMAGE: Unsupported or malformed image data\./)
  assert.match(described.message, /← caused by ERR_DLOPEN_FAILED:/)
  assert.match(described.message, /libvips-42\.dll/)
})

test('a decoder that is absent is read as absent, not as a load failure', () => {
  const missing = Object.assign(new Error("Cannot find module 'sharp'"), { code: 'MODULE_NOT_FOUND' })
  const described = describeImageFailure(missing)

  assert.equal(described.kind, 'decoder-missing')
  assert.match(described.message, /is not installed/)
  assert.match(described.message, /Cannot find module 'sharp'/)
})

test('an unrecognized rejection is still reported verbatim', () => {
  const described = describeImageFailure(new Error('something nobody expected'))

  assert.equal(described.kind, 'unknown')
  assert.match(described.message, /something nobody expected/)
})

test('a rejection that carries no message still yields one line', () => {
  assert.equal(describeImageFailure(null).kind, 'unknown')
  assert.match(describeImageFailure(null).message, /carried no message/)
  assert.match(describeImageFailure('plain string reason').message, /plain string reason/)
})

test('a cyclic cause chain terminates', () => {
  const loop = new Error('loops')
  loop.cause = loop
  const described = describeImageFailure(loop)

  assert.equal(described.kind, 'unknown')
  assert.match(described.message, /loops/)
})

test('a synchronous throw is caught, and reaches the caller as a failure', async () => {
  const { ctx, warnings } = recordingContext({
    validateImage() { throw dlopenFailure() },
  })
  const result = await check(ctx)

  assert.equal(result.status, 'failed')
  assert.equal(warnings.length, 1)
})

test('the service is handed a copy, so a provider cannot consume the constant', async () => {
  let seen
  await probeImagePipeline({
    validateImage: async (input) => { seen = input.data },
  })
  assert.notEqual(seen, ONE_PIXEL_PNG)
  assert.deepEqual([...seen], [...ONE_PIXEL_PNG])
})
