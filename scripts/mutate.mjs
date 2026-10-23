/**
 * Bounded mutation arms: every arm must make the suite fail.
 *
 * The four silent controls and the classification tests are only evidence if
 * removing the behaviour they cover breaks them. Each arm below patches the
 * **built** output and runs the real suite; an arm whose suite still passes is
 * reported as SURVIVED, which means that arm's contract is not actually pinned.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROBE = join(ROOT, 'lib', 'probe.js')
const ENTRY = join(ROOT, 'lib', 'index.js')

/** One arm: the file it patches, the exact text it replaces, and what it becomes. */
const ARMS = [
  {
    name: 'the cause chain is dropped from the reported line',
    file: PROBE,
    from: "chain.map(formatStep).join(' \u2190 caused by ')",
    to: 'formatStep(outermost)',
  },
  {
    name: 'only the outermost link decides the reading',
    file: PROBE,
    from: 'if (has(LOAD_CODES))',
    to: 'if (chain.length === 1 && has(LOAD_CODES))',
  },
  {
    name: 'a missing service is reported as a failure',
    file: PROBE,
    from: "return { status: 'skipped', reason: 'no-service' };",
    to: "return { status: 'failed', kind: 'unknown', message: 'no service' };",
  },
  {
    name: 'the probe rethrows instead of reporting',
    file: PROBE,
    from: '    catch (error) {\n        const described = describeImageFailure(error);',
    to: '    catch (error) {\n        throw error;\n        const described = describeImageFailure(error);',
  },
  {
    name: 'a healthy service is reported as a failure',
    file: PROBE,
    from: "        return { status: 'ok' };",
    to: "        return { status: 'failed', kind: 'unknown', message: 'healthy' };",
  },
  {
    name: 'the cause chain is not walked past the first link',
    file: PROBE,
    from: 'const MAX_CHAIN = 3;',
    to: 'const MAX_CHAIN = 1;',
  },
  {
    name: 'the config switch no longer stops the probe',
    file: ENTRY,
    from: 'if (!config.enabled)',
    to: 'if (false)',
  },
  {
    name: 'the reported warning is dropped',
    file: ENTRY,
    from: "if (result.status === 'failed') {",
    to: "if (result.status === 'nonesuch') {",
  },
]

/** Run the suite and report whether it passed. */
function suitePasses() {
  try {
    execFileSync(process.execPath, ['--test', 'test/probe.spec.mjs', 'test/mount.spec.mjs', 'test/packaging.spec.mjs'], {
      cwd: ROOT,
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

if (!suitePasses()) {
  console.error('the unmutated suite does not pass; fix that before reading any arm')
  process.exit(1)
}

let survived = 0
for (const arm of ARMS) {
  const original = readFileSync(arm.file, 'utf8')
  if (!original.includes(arm.from)) {
    console.log(`SKIPPED  ${arm.name} — anchor not found in the built output`)
    survived += 1
    continue
  }
  writeFileSync(arm.file, original.replace(arm.from, arm.to))
  const caught = !suitePasses()
  writeFileSync(arm.file, original)
  console.log(`${caught ? 'CAUGHT  ' : 'SURVIVED'} ${arm.name}`)
  if (!caught) survived += 1
}

console.log(`\n${ARMS.length - survived}/${ARMS.length} arms caught`)
process.exit(survived === 0 ? 0 : 1)
