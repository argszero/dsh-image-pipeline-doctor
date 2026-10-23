/**
 * The packaging contract: what the installer reads, asserted as data.
 *
 * c757 measured that `dsh plugin add` rejects a `cordis.patch.yml` whose top
 * level is a `plugins:` mapping and accepts only a sequence of patch entries, so
 * the shape is asserted by parsing the file rather than by trusting it. The
 * assertions here come from the installer's contract, not from this file's own
 * prose.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

test('the overlay is a top-level sequence of patch entries', () => {
  const parsed = parse(readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8'))

  assert.ok(Array.isArray(parsed), 'the top level must be a sequence, never a `plugins:` mapping')
  assert.equal(parsed.length, 1)
  const [entry] = parsed
  assert.ok(Array.isArray(entry.insert), 'the first entry must be an `insert` of rows')
  assert.equal(entry.insert.length, 1)
  assert.equal(entry.insert[0].name, manifest.name)
  assert.equal(typeof entry.insert[0].id, 'string')
  assert.ok(entry.insert[0].id.length > 0)
})

test('the manifest declares the overlay the installer follows', () => {
  assert.deepEqual(manifest.dsh, { bundle: { patch: './cordis.patch.yml' } })
  assert.ok(existsSync(join(ROOT, manifest.dsh.bundle.patch)))
})

test('the built entry point ships, so a git install needs no build step', () => {
  assert.ok(existsSync(join(ROOT, 'lib', 'index.js')), 'lib/index.js must be committed, not gitignored')
  assert.ok(existsSync(join(ROOT, 'lib', 'types', 'index.d.ts')))
  assert.equal(manifest.main, 'lib/index.js')
  assert.ok(manifest.files.includes('lib/**/*.js'))
  assert.ok(manifest.files.includes('cordis.patch.yml'))
  const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
  assert.doesNotMatch(ignore, /^lib\/?$/m, 'lib/ must not be ignored: the install verb runs no build')
})

test('the plugin declares the one service it reads through', async () => {
  const module = await import('../lib/index.js')

  assert.deepEqual(module.inject, ['attachments'])
  assert.equal(module.name, 'image-pipeline-doctor')
  assert.equal(typeof module.apply, 'function')
  assert.equal(module.default.name, module.name)
  assert.deepEqual(module.default.inject, module.inject)
})

test('the plugin asks for nothing outside its own build', () => {
  // The built output's only import is `./probe.js`. A peer declaration would buy
  // nothing at runtime and, with `autoInstallPeers: false`, only print a
  // "missing peer" line on every install — so the contract asserted here is
  // that there is nothing to install and nothing to warn about.
  assert.equal(manifest.dependencies, undefined)
  assert.equal(manifest.peerDependencies, undefined)
  assert.equal(typeof manifest.devDependencies['@deepseek-ai/cordis'], 'string')
})
