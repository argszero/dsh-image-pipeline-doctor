/**
 * Mount the built plugin on a real Cordis Context.
 *
 * `probe.spec.mjs` proves the probe's contract against hand-made inputs; this
 * file proves the plugin is a plugin: it mounts through `ctx.plugin`, reaches
 * the service through the context, reports once through the context logger, and
 * gives its pending timer back when the fiber is disposed.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import plugin from '../lib/index.js'

/**
 * A context that already has the attachment plane the plugin injects, and the
 * exporter the real host installs at boot.
 *
 * `app-boot` registers `levels: { default: 2 }` and collects `warn` and `error`
 * into its startup diagnostics, which is what makes a plugin warning reach a
 * user at all: cordis drops a warn at its default INFO threshold. This test
 * reproduces that registration rather than raising the level to whatever the
 * assertion needs.
 * @param service - the stand-in `attachments` service.
 * @returns the context, and the warnings its exporter collected.
 */
function mounting(service) {
  const ctx = new Context()
  const warnings = []
  ctx.logger.exporter({
    levels: { default: 2 },
    export: ({ type, args }) => { if (type === 'warn') warnings.push(args) },
  })
  ctx.provide('attachments')
  ctx.set('attachments', service)
  return { ctx, warnings }
}

/** Wait for the deferred probe to have had its chance. */
const settle = () => new Promise(resolve => setTimeout(resolve, 60))

/** The reported failure, shaped like the one a broken native module produces. */
function dlopenFailure() {
  const error = new Error('Could not load /usr/local/lib/libvips-cpp.42.dylib')
  error.code = 'ERR_DLOPEN_FAILED'
  return error
}

test('a real fiber mounts the plugin and reports the failure exactly once', async () => {
  let calls = 0
  const { ctx, warnings } = mounting({
    validateImage: async () => { calls += 1; throw dlopenFailure() },
  })

  ctx.plugin(plugin, { enabled: true, delayMs: 0 })
  await settle()

  assert.equal(calls, 1, 'the probe did not reach the attachment service on a real fiber')
  assert.equal(warnings.length, 1, `expected one warning, got ${warnings.length}`)
  assert.match(warnings[0].join(' '), /image pipeline self-check failed/)
  assert.match(warnings[0].join(' '), /ERR_DLOPEN_FAILED/)

  await ctx.fiber.dispose()
})

test('a real fiber over a healthy service warns nothing', async () => {
  let calls = 0
  const { ctx, warnings } = mounting({ validateImage: async () => { calls += 1 } })

  ctx.plugin(plugin, { enabled: true, delayMs: 0 })
  await settle()

  assert.equal(calls, 1)
  assert.equal(warnings.length, 0)

  await ctx.fiber.dispose()
})

test('disposing the fiber cancels a probe that has not run yet', async () => {
  let calls = 0
  const { ctx } = mounting({ validateImage: async () => { calls += 1 } })

  ctx.plugin(plugin, { enabled: true, delayMs: 40 })
  await new Promise(resolve => setTimeout(resolve, 10))
  await ctx.fiber.dispose()
  await new Promise(resolve => setTimeout(resolve, 90))

  assert.equal(calls, 0, 'the teardown did not clear the pending probe')
})

test('a disabled plugin mounts and never probes', async () => {
  let calls = 0
  const { ctx, warnings } = mounting({ validateImage: async () => { calls += 1 } })

  ctx.plugin(plugin, { enabled: false, delayMs: 0 })
  await settle()

  assert.equal(calls, 0)
  assert.equal(warnings.length, 0)

  await ctx.fiber.dispose()
})
