# Dependency upgrades — detail

The open entries are listed in [the backlog](../backlog.md), under "Dependency upgrades". This file holds
their full text.

## Open Dependabot pull requests

- **Open Dependabot pull requests — low priority, not queued (owner, 2026-10-08: take them from here
  when a lane has room).** #1179 (Vitest 5) waits on Stryker (owner). The rest, each landed per
  workflow-guide → Dependabot pull requests:
  1. **sharp 0.35.5 (#1299 root, #1423 `apps/server`) and the compose group (#1178).** Land the two
     sharp PRs together. sharp is copied into the box image and left out of every bundle, so the
     image smoke's sharp step is the proof — and a PR that changed no image input builds no image
     (CLAUDE.md §2): say how the image was built for it (a `workflow_dispatch` on the head, with its
     `headSha`). For compose, check the dev stack still starts if a service image moved.
  2. **The npm minor-and-patch group (#1267, 13 updates).** Rebase first. Read every package's notes
     across its whole range; list anything that changes behaviour, a default or built output, and
     diff built artefacts for anything in a bundle. A bump that breaks is dropped from the group,
     with the reason recorded.
  3. **stripe 22.6.2 → 23.0.0 (#1181, a major).** Map each breaking change to
     `packages/payments-stripe` call sites; test through the real client as well as a fake (CLAUDE.md
     §4). Payments: full review path.

## Comments and docs still name drizzle-orm 0.45.2; 0.45.3 is installed

**Comments and docs still name drizzle-orm 0.45.2; 0.45.3 is installed — OPEN (found 2026-10-03 by #1139's
review).** #1139 updated `scripts/journal-monotonic.test.ts` and one citation in
`docs/developers/conventions-data.md`, and checked their line numbers against 0.45.3. Still naming
0.45.2: `apps/server/src/restore-fiscal-e2e.test.ts:310` and
`packages/store/src/node-sqlite-adapter.ts:34`, where the review found only the number stale; and
`packages/db/src/testing/schema-conformance.ts:226`, `docs/developers/conventions-data.md:280` and
this file (the 0.45.2 unnamed-`unique()` note in Track C), none of them re-checked against 0.45.3.
**Next action:** read each claim against the installed 0.45.3, then update the number or the claim.

## Collapse the two TypeScript entries back into one, once typescript-eslint supports version 7

**Left behind by the TypeScript 7 upgrade (#460, 2026-09-20).**

- **Collapse the two TypeScript entries back into one, once typescript-eslint supports version 7.**
  Packages run `tsc` at 7; the repository root resolves the name `typescript` to
  `npm:@typescript/typescript6` so typescript-eslint keeps the version 6 API it still reads.
  typescript-eslint tracks the work in its issue 10940, and the message it prints today names
  version **7.1** as the target. When a release supports it, the root entry goes back to a plain
  `^7` range and the alias disappears. `scripts/comments-only.mjs`,
  `scripts/apply-migrations-callers.test.ts`, `scripts/pinned-actions-column.test.ts`,
  `scripts/native-form-fields.test.ts` and `scripts/screenshot-paths.test.ts` parse with
  the version 6 API (`ts.createSourceFile`), so they have to be ported, or the alias kept for them,
  before that move. The arrangement is in [ci-and-gates.md](../developers/ci-and-gates.md) → _Two
  TypeScript compilers are installed, and that is deliberate_.

## A Vitest 5 retry has to re-measure mutation — nothing about Stryker 10 settles it

**Left behind by the Stryker upgrade (#447, 2026-09-19).**

- **A Vitest 5 retry has to re-measure mutation — nothing about Stryker 10 settles it.** Vitest 5 was
  abandoned because Stryker 9.6.1 kills almost nothing under it: `packages/fiscal` scored 0.00% and
  `packages/shared` 8.14% (stryker-js#6210). Stryker 10.0.0's release notes mention neither issue,
  and nothing here was run under Vitest 5, so the question is untouched rather than resolved. A
  retry must also check whether #766's stored Dependabot ignore of `@vitest/browser-playwright` 5.x
  holds that package back, and clear it if so (`docs/developers/workflow-guide.md` → Dependabot pull
  requests).

## Whether a declared floor follows the installed version is undecided — one decision for every manifest

**Left behind by the dependency refresh (#432, 2026-09-19).**

- **Whether a declared floor follows the installed version is undecided — one decision for every
  manifest.** #432 raised five low floors (`hono`, `pg`, `playwright`, `@types/pg`,
  `@aws-sdk/client-s3`) so that every package declared one identical range; no commit or doc
  explains why those floors were low, so this was a judgement, not a rule being followed. The vite 8
  and passkey upgrades below left the same shape (`^8.0.0` against 8.3.0 installed; `^14.0.0` below
  14.0.2 in two manifests). Dependabot's npm updates set no `versioning-strategy`; its first npm PR,
  #765, raised the floor of each caret range it changed to the new version and kept each manifest's own form (an
  exact pin stayed exact), so it did not restore #432's one-range shape where that had lapsed:
  `@aws-sdk/client-s3` is exact in `apps/server` and a caret range in `packages/stream` and
  `bench/sqlite-failover`. The answer goes in `versioning-strategy` in `.github/dependabot.yml`.

## `apps/dashboard` type-checks against two `@types/node` majors at once

**Left behind by the Node types upgrade (#441, 2026-09-19).**

- **`apps/dashboard` type-checks against two `@types/node` majors at once.** `@types/qrcode`
  (declared in `apps/dashboard` and `apps/server`) references the Node types with its own range
  `"*"`, and the lockfile leaves it on 24.x while everything else is on 26. Nothing complains
  because `skipLibCheck` is on (`tsconfig.base.json`); with `--skipLibCheck false` that program
  reports a duplicate `NonSharedBuffer` identifier. The fix is a pnpm resolution override, which is
  a policy decision, so it was left for the owner. (`@types/ssh2` also holds 18.x, but it asks for
  `"^18.11.18"` and no 26 release satisfies it.)

## Only the request side of that adapter was compared between the two versions

**Left behind by the Hono Node adapter upgrade (#444, 2026-09-19).** `apps/server` and
`apps/print-agent` moved from `@hono/node-server` 1.19.15 to 2.1.1. Two things it leaves open:

- **Only the request side of that adapter was compared between the two versions.** Version 2 also
  changed response code — `Response` fast paths, null-body handling, a close handler for
  `Blob`/`ReadableStream` responses, and `Response.json()`/`Response.redirect()` — and nothing
  compared a response BODY or its headers across the two. The suites pass, so nothing is known to
  be broken. Re-running the comparison needs a scratch install of 1.19.15.

## The default browser floor rose, and no BROWSER floor is stated anywhere in the repo

**Left behind by the vite 8 upgrade (#450, 2026-09-19).**

- **The default browser floor rose, and no BROWSER floor is stated anywhere in the repo.** Nothing
  sets a `build.target` and there is no `browserslist`, so the SPAs take vite's default: on 8.3.0
  `["chrome111","edge111","firefox114","safari16.4","ios16.4"]`, where 6.4.3 gave
  `["es2020","edge88","firefox78","chrome87","safari14"]`. A `browserslist` field would not fix this
  (measured against vite 8.3.0: it leaves the resolved target at the default, while
  `build: { target: … }` sets it). Nothing is known to break, and the devices are bought new — but
  the hardware track's own stated floors do NOT establish that, and one of them cuts the other way:
  Screen Wake Lock's iOS Safari 16.4
  (`docs/superpowers/specs/2026-09-08-handheld-app-store-and-kiosk-findings.md`) sits exactly ON
  the new floor, and Web NFC's Chrome for Android 89
  (`docs/superpowers/specs/2026-09-18-handheld-and-till-hardware-decisions.md`) is twenty-two majors
  BELOW the new chrome111. What is missing is anywhere that states a browser floor, so the next
  bump moves it again silently.

## The browser-mode packages that declare no vite follow the others' by deduplication, not by a declaration

**Left behind by the vite 8 upgrade (#450, 2026-09-19).**

- **The browser-mode packages that declare no vite follow the others' by deduplication, not by a
  declaration.** `packages/adjustments`, `bookings`, `media`, `payments-stripe`, `payments-sumup`
  and `venue-service` resolve vite because vitest declares it as a required peer spanning three
  majors and pnpm deduped onto the one the declaring manifests choose. If a future change puts a
  second vite in the tree, they could land on a different one silently.

## A dependency-optimizer receipt taken on vite 6 was not re-measured

**Left behind by the vite 8 upgrade (#450, 2026-09-19).**

- **A dependency-optimizer receipt taken on vite 6 was not re-measured.** The `vitest.config.ts` of
  `apps/dashboard`, `apps/setup`, `apps/till` and `packages/ui` each carry an
  `optimizeDeps.include` list; only `apps/setup`'s comment still quotes Vite's warning — "Vite
  unexpectedly reloaded a test" — as the flake it fixes. Vite 8's migration guide says Rolldown "is
  now used for dependency optimization instead of esbuild". Nobody re-checked that vite 8 still emits
  that warning, or that the `include` lists are still the fix.

## The till's QR pin compares the code against itself, not an authority

**Left behind by the till QR library upgrade (qrcode-generator 1 -> 2, 2026-09-20).**

- **The till's QR pin compares the code against itself, not an authority.** `qrSvg`'s one product
  call site is the on-screen ticket (`apps/till/src/screens/till-ticket-view.ts`); the PRINTED QR's
  test reads the error-correction level back out of the format-information bits (`formatInfoLevel`
  in `apps/server/src/qr-matrix.test.ts`) with negative controls, which asserts what art. 21.1
  mandates. Giving the till the same reader needs a matrix accessor as well (`qrSvg` returns a
  string, never the library's `qr` object) and a module-boundary decision about where the helper
  lives.

## `node-forge` has a high-severity security alert with no fixed version

**`node-forge` has a high-severity security alert with no fixed version — OPEN (Dependabot alert #20,
2026-10-01).** Every version up to 1.4.0, the one in the lockfile, accepts some RSA signatures
it should reject when checking them. It is a direct dependency of `packages/server-kit`,
`apps/server` and `apps/print-agent`. From reading the code on 2026-10-02 (nothing run), product
code only creates and signs certificates and certificate requests with it
(`packages/server-kit/src/certificate.ts`, `apps/server/src/self-signed-cert.ts`,
`apps/server/src/cloud-remote.ts`); it checks signatures with it only in tests. **Next action:**
bump it when a fixed version is published, and run the certificate suites in those three packages.

## Whether the vulnerability the upgrade fixes is reachable in this product is open

**Left behind by the passkey library upgrade (#453, 2026-09-19).** `@simplewebauthn/server` and
`@simplewebauthn/browser` moved to 14.

- **Whether the vulnerability the upgrade fixes is reachable in this product is open.** 14.0.2's
  release note describes it as "Revamped certificate revocation logic to only cryptographically
  verify and process CRLs from certificates that chained back to an RP-chosen trust anchor"
  (GHSA-2g3p-m8c9-hhwh; the release note is the only source). We ask for `attestation: "none"` and
  never call `MetadataService`, but the attestation FORMAT is chosen by the RESPONSE: the verifier
  dispatches on the `fmt` inside the client-supplied attestation object, and the `apple` and
  `android-key` formats carry the library's own built-in trust anchors, which is what makes
  `validateCertificatePath` — the only caller of `isCertRevoked` — do work. The cheap evidence leans
  towards reachable rather than away.

## Decisions and deliberate limits

**Left behind by the esbuild upgrade (#439, 2026-09-19).**

- **A bundler bump is checked by comparing the built bundles, by hand.** The test suites run against
  TypeScript source and cannot see a bundler change, and CI's `bundle-smoke` job would catch a
  bundle that no longer boots, not one whose contents quietly changed shape. The method: build,
  stash the outputs, bump, rebuild, `cmp` each pair, and account for every difference class. It does
  not survive a bundler REPLACEMENT; what replaced it for vite 8 is below.

**Left behind by the vite 8 upgrade (#450, 2026-09-19).** `apps/dashboard`, `apps/setup`,
`apps/till` and `packages/ui` moved to vite 8, which swaps the bundler and the transformer (Rolldown
and Oxc for Rollup and esbuild). What replaced the byte comparison: build both, then run the
SHIPPED bundles and compare what they produce.

**Left behind by the AEAT XML parser upgrade (fast-xml-parser 4 -> 5, 2026-09-20).** Version 5 no
longer decodes numeric character references: `&#38;` and the references for the other four
XML-reserved characters arrive as their own source text, and a reference to a character XML 1.0
forbids is removed entirely. Named forms (`&amp;` and the rest) still decode, and `escape.ts` writes
nothing but named forms. The upgrade shipped WITHOUT compensating for it, on this argument: every
parsed AEAT value that is matched against one of ours is a value WE minted and AEAT echoed —
`RefExterna` (a UUID), `NumSerieFactura` (emitted only from `NUMSERIE_PATTERN`'s charset) and
`Huella` (hex) — and none of those characters is ever entity-encoded. **The limit of that receipt:
nothing validates a value on the way back IN** — `NUMSERIE_PATTERN` runs only on the outgoing
record — so it is an assumption about AEAT's serialiser, not an invariant this code enforces. If it
is ever in doubt, validating the parsed values on arrival is the cheap fix. `htmlEntities: true` was
tried and reverted: it decodes 35 named entities XML does not define and turns `&nbsp;` and `&#160;`
into U+00A0 where 4.5.7 gave U+0020. Exact XML semantics would need version 5's `entityDecoder`
hook, which is bespoke code on a fiscal path and a decision rather than a bump.
