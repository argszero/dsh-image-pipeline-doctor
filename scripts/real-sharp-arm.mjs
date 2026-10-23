/**
 * The real arm: the host's own `sharp`, and a native module that really fails
 * to load.
 *
 * The suite is hermetic, so both of these live here instead of in it. Run it
 * with a path to a real `sharp` package:
 *
 *   node scripts/real-sharp-arm.mjs /path/to/node_modules/sharp
 *
 * It mirrors the host's seam — `requireSharp()` first, then the decode — so a
 * pass here means the probe's happy path and its failure path were both
 * exercised against the runtime, not against a hand-written string.
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { probeImagePipeline } from '../lib/index.js'

const require = createRequire(import.meta.url)
const sharpPath = process.argv[2]
if (sharpPath === undefined) {
  console.error('usage: node scripts/real-sharp-arm.mjs /path/to/node_modules/sharp')
  process.exit(1)
}

/** The healthy arm: the host's real reshape path, `requireSharp()` then decode. */
const healthy = {
  async validateImage(input) {
    const sharp = require(sharpPath)
    const image = sharp(input.data, { failOn: 'error', limitInputPixels: false })
    const meta = await image.metadata()
    await image.raw().toBuffer()
    if (meta.width !== 1 || meta.height !== 1) throw new Error(`unexpected ${meta.width}x${meta.height}`)
  },
}

/**
 * The broken arm: a package whose entry really calls `process.dlopen` on a file
 * that is not a shared library, so the failure is the runtime's own
 * `ERR_DLOPEN_FAILED` rather than a message this script wrote.
 */
const fakeRoot = join(tmpdir(), `dsh-broken-sharp-${process.pid}`)
mkdirSync(fakeRoot, { recursive: true })
writeFileSync(join(fakeRoot, 'package.json'), JSON.stringify({ name: 'sharp', version: '0.0.0', main: 'index.cjs' }))
writeFileSync(join(fakeRoot, 'libvips-42.dll'), 'this file is not a shared library\n')
writeFileSync(
  join(fakeRoot, 'index.cjs'),
  "const path = require('node:path')\nmodule.exports = function () {\n  process.dlopen(module, path.join(__dirname, 'libvips-42.dll'))\n}\n",
)

const broken = {
  async validateImage(input) {
    // `requireSharp()` in the host runs before any try/catch, so a load failure
    // arrives unwrapped. Same shape here.
    const sharp = require(fakeRoot)
    await sharp(input.data).metadata()
  },
}

const ok = await probeImagePipeline(healthy)
console.log('healthy arm:', JSON.stringify(ok))
if (ok.status !== 'ok') throw new Error('the healthy arm did not pass against the real module')

const failed = await probeImagePipeline(broken)
console.log('broken arm: ', JSON.stringify(failed))
if (failed.status !== 'failed') throw new Error('the broken arm was not reported as a failure')
if (failed.kind !== 'decoder-cannot-load') throw new Error(`the broken arm read as ${failed.kind}`)

console.log('\nline a reader would get:\n  image pipeline self-check failed:', failed.message)
console.log('\nREAL ARM OK')
