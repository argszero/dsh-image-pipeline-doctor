# @argszero/dsh-image-pipeline-doctor

Says at boot that the host's image decode path is broken, instead of letting a
user find out by pasting a screenshot.

When a native image module cannot load — a third-party plugin shipping its own
`sharp`, two `libvips` builds in one process, an architecture or
`ERR_DLOPEN_FAILED` mismatch — the host does not report it at startup. The first
pasted image is refused, and what reaches the conversation is a generic client
error, so "restart and try again" looks like a fix while the real cause is
nowhere on screen. [Discussion #10758](https://github.com/deepseek-ai/deepseek-harness/discussions/10758)
reports exactly that shape.

This plugin moves the discovery to activation: one 1×1 PNG through the public
`ctx.attachments.validateImage()` call, which reaches the decoder before the
pass-through branch, and exactly one logged line naming the decoder and the real
cause when that fails.

## Install

```
dsh plugin --profile <profile> add github:argszero/dsh-image-pipeline-doctor
```

The build output ships in the repository, so no build step runs on install.
`npm i` alone does not mount a plugin: the `dsh plugin add` verb is what writes
it into `dsh.profile.bundles`.

The plugin imports nothing outside its own build — no runtime dependency and no
peer — so an install adds exactly one package and has nothing to warn about. It
reads the attachment plane through the `attachments` service it injects, not
through an import of cordis or of the attachment package.

## What you see

Healthy install: nothing. There is no success line and no "image pipeline OK"
banner — a diagnostic that warns on a working host is one users delete.

Broken install, one line, at boot:

```
image pipeline self-check failed: the host image decoder (sharp) cannot load its
native binding: ERR_DLOPEN_FAILED: dlopen(/…/libvips-42.dll, 0x0001): …
```

The native loader's own message is kept rather than paraphrased, because the path
it names is the fact a reader acts on. When the admission policy wraps the load
failure, both layers are shown, outermost first, joined by `← caused by`; the
deepest link decides the reading.

Warnings reach the user because the host registers its diagnostics exporter at
`levels: { default: 2 }` and collects `warn` and `error` into its startup logs
(`app-boot`). A bare cordis context drops a warn at its default INFO threshold,
so a test that expects this line has to install that exporter.

## Silent by design

The plugin produces no output at all when:

- the decoder works,
- there is no `attachments` service (it stays pending and inert),
- the service cannot validate images (a host with no image pipeline to diagnose),
- or `enabled: false`.

Nothing here throws, retries, writes an attachment, or holds the process open. A
diagnostic that can stop a boot is worse than the defect it reports.

## What it cannot do

- It cannot fix the misreporting. A client that rewrites an attachment failure
  into a generic session error is not reachable from a plugin; that belongs in
  the core.
- It cannot isolate processes or version native library names. A plugin runs in
  the same process and inherits the same conflict.
- It cannot say which plugin's `sharp` won the mapping. It reports that the
  host's decode path fails and what it failed with — the fact a reader needs,
  not the attribution.

## Config

```yaml
- set:
    - id: image-pipeline-doctor
      config:
        enabled: true   # run the probe on activation (default true)
        delayMs: 0      # wait before probing, for a Host tree still settling
```

## Verification

Run on macOS with Node 26.5.0 against `attachment-local` at upstream
`22ddee3792`:

- `npm test` — 22/22. Eleven contract arms, four of them the silent controls
  above; the warning arm asserts exactly one line naming `ERR_DLOPEN_FAILED` and
  the failing path; the mount arms run on a real cordis `Context` and assert that
  disposing the fiber cancels a probe that has not run yet.
- `node scripts/mutate.mjs` — 8/8 arms caught: dropping the cause chain, deciding
  the reading from the outermost link only, reporting a missing service as a
  failure, rethrowing instead of reporting, reporting a healthy service as a
  failure, walking only one cause link, ignoring `enabled`, and dropping the
  warning each fail the suite.
- `node scripts/real-sharp-arm.mjs <path-to-sharp>` — the healthy arm passes
  against the real `sharp@0.35.5` (libvips 8.18.7), and the broken arm produces a
  runtime `ERR_DLOPEN_FAILED` from a real `process.dlopen` on a non-library,
  which the plugin names.

The reported failure was observed on Windows; the plugin's own arms above were
run on macOS, and the Windows path is represented by a runtime-produced
`ERR_DLOPEN_FAILED`, not by a reproduction of that user's install.

## Licence

MIT
