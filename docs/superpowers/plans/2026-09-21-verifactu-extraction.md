# Veri*Factu Library Extraction — Implementation Plan (core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `packages/verifactu` out of the Waitron monorepo into a standalone, public, Apache-2.0 npm package (`@waitron/verifactu`), publish `0.1.0`, and repoint Waitron to consume it from the registry.

**Architecture:** Two parts in two repositories. **Part A** builds the new library repo at `github.com/waitron-io/verifactu` (a fresh copy of the source — no monorepo history — with a real `tsc` build, a publish-ready manifest, an internal-reference scrub, its own CI, and a first publish). **Part B** rewires Waitron in a worktree: swap the workspace package for the registry dependency, promote the one deep import to a public `./testing` export, delete the package, and clean up the CI guards that named it. The library is a clean leaf (only runtime dependency `fast-xml-parser`, no workspace imports), so the code moves without change; the work is the build, the wiring, and the gate cleanup.

**Tech Stack:** TypeScript (ESM, `type: module`), `tsc` build to `dist/`, Vitest + `@vitest/coverage-v8`, Stryker (mutation), `fast-xml-parser` (runtime), npm (public scoped publish with provenance), GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-09-21-verifactu-extraction-design.md](../specs/2026-09-21-verifactu-extraction-design.md) — read it alongside this plan.

## Global Constraints

- **Package name:** `@waitron/verifactu`, published **public** from the `waitron` npm org. `publishConfig.access` MUST be `"public"` or the first publish is rejected as private.
- **Licence:** Apache-2.0 for the library (Waitron itself is Elastic License 2.0 — deliberately different).
- **Version:** first publish is `0.1.0`.
- **Fresh git history** in the library repo — no monorepo commits carried across.
- **No internal or AI-workflow material in the public repo** — no `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.codex/`, `docs/superpowers|handoffs|compliance`, and no in-source references to them. A CI guard enforces this (Task A4).
- **Coverage bars in the library repo (exact — the copied `vitest.config.ts` already holds these):** `statements: 98, functions: 98, lines: 98, branches: 95`. The 95 is on **branches**; do not reorder or edit. **Mutation floor:** `90`.
- **The only new public API the extraction adds is the `./testing` subpath export** (for `createFakeAeat`). Every other consumer import is the existing root surface.
- **No behavioural change to any verifactu code.** This is a move, a build, and a rewire.
- **Runtime dependencies of the library stay at exactly one: `fast-xml-parser`.** The `./testing` and (future) ergonomics layers must not add a runtime dependency to the root entry.
- **Library working directory:** `~/workspace/repos/verifactu` (a clone of the new GitHub repo). **Waitron working directory:** a worktree created via `python3 ~/workspace/tools/worktree.py new waitron extract-verifactu` at execution time.
- **Commits:** every commit uses `git commit -s`. Commit messages are plain English (a domain/file/command name may appear once as a pointer).

---

## PART A — The new library repo (`~/workspace/repos/verifactu`)

### Task A1: Create the GitHub repo and scaffold a clean source copy

**Files:**
- Create (GitHub): `waitron-io/verifactu` (empty, public)
- Create (local): `~/workspace/repos/verifactu/` — clone of the above
- Copy in: `src/**`, `schemas/**`, `test/**`, `stryker.config.json`, `vitest.config.ts`, `tsconfig.json`, `PROVENANCE.md`, `README.md` from `~/workspace/repos/waitron/packages/verifactu/`
- Create: `LICENSE` (Apache-2.0 full text), `.gitignore`

**Interfaces:**
- Produces: a git repo whose `src/index.ts` re-export surface is unchanged from the monorepo package, ready for a build and manifest in A2.

- [ ] **Step 1: Confirm `clintongormley` is an org owner and create the empty public repo**

```bash
gh api orgs/waitron-io -q '.login'            # expect: waitron-io
gh repo create waitron-io/verifactu --public --description "AEAT Veri*Factu / SIF protocol library (huella, QR, records, XML, SOAP client)" --disable-wiki
git clone https://github.com/waitron-io/verifactu.git ~/workspace/repos/verifactu
```

Expected: repo created; clone succeeds (empty repo).

- [ ] **Step 2: Copy the source tree, excluding build artefacts**

```bash
SRC=~/workspace/repos/waitron/packages/verifactu
DST=~/workspace/repos/verifactu
for p in src schemas test stryker.config.json vitest.config.ts tsconfig.json PROVENANCE.md README.md; do
  cp -R "$SRC/$p" "$DST/$p"
done
# Never copy: coverage/ reports/ node_modules/ package.json (rewritten in A2)
ls "$DST"        # expect: src schemas test *.json *.md (no coverage/reports/node_modules)
```

Expected: the four config/doc files and the three directories are present; no `coverage/`, `reports/`, `node_modules/`, or old `package.json`.

- [ ] **Step 3: Add the Apache-2.0 LICENSE and a public `.gitignore`**

Create `~/workspace/repos/verifactu/LICENSE` with the full Apache License 2.0 text (from https://www.apache.org/licenses/LICENSE-2.0.txt), with the copyright line `Copyright 2026 Waitron`.

Create `~/workspace/repos/verifactu/.gitignore`:

```gitignore
node_modules/
dist/
coverage/
reports/
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 4: Initial commit (no build/manifest yet)**

```bash
cd ~/workspace/repos/verifactu
git add -A
git status                                   # verify: no coverage/reports/node_modules staged
git commit -s -m "Import the Veri*Factu protocol library source

A clean, fresh-history copy of the AEAT Veri*Factu implementation: the huella
chaining, QR payload, record builders, XML serialise/parse, the SOAP client,
the fake-AEAT test double, and the committed AEAT schemas. Apache-2.0."
```

Expected: one commit; working tree clean.

---

### Task A2: Add the build and the publish-ready manifest

**Files:**
- Create: `~/workspace/repos/verifactu/package.json`
- Create: `~/workspace/repos/verifactu/tsconfig.build.json`
- Modify: `~/workspace/repos/verifactu/tsconfig.json` (make it self-contained for typecheck)

**Interfaces:**
- Produces: `npm run build` emits `dist/index.js` + `dist/index.d.ts` and `dist/testing/fake-aeat.js` + `.d.ts`; `npm run typecheck` passes; the `exports` map resolves `.` and `./testing`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@waitron/verifactu",
  "version": "0.1.0",
  "description": "AEAT Veri*Factu / SIF protocol library: huella chaining, QR payload, invoice records, XML serialise/parse, and the AEAT SOAP submission client.",
  "type": "module",
  "license": "Apache-2.0",
  "repository": { "type": "git", "url": "git+https://github.com/waitron-io/verifactu.git" },
  "homepage": "https://github.com/waitron-io/verifactu#readme",
  "bugs": { "url": "https://github.com/waitron-io/verifactu/issues" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./testing": { "types": "./dist/testing/fake-aeat.d.ts", "default": "./dist/testing/fake-aeat.js" }
  },
  "files": ["dist", "schemas", "PROVENANCE.md", "README.md", "LICENSE"],
  "publishConfig": { "access": "public", "provenance": true },
  "sideEffects": false,
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint .",
    "mutation": "stryker run",
    "format:check": "prettier --check ."
  },
  "dependencies": {
    "fast-xml-parser": "^5.11.1"
  },
  "devDependencies": {
    "@stryker-mutator/core": "^10.0.0",
    "@stryker-mutator/vitest-runner": "^10.0.0",
    "@types/node": "^26.0.0",
    "@vitest/coverage-v8": "^4.1.11",
    "eslint": "^9.0.0",
    "fast-check": "^4.10.1",
    "prettier": "^3.0.0",
    "typescript": "^7.0.0",
    "vitest": "^4.1.11"
  }
}
```

> Note: `eslint` and `prettier` versions are placeholders to satisfy the scripts — pin them to whatever the first `npm install` resolves and CI accepts; the lint/format config is added in Task A5. If the package needs an `eslint.config.js`, add a minimal flat config there.

- [ ] **Step 2: Write `tsconfig.build.json` (emit) and make `tsconfig.json` self-contained (typecheck)**

`tsconfig.json` (the monorepo one extended a base that no longer exists — replace with a standalone config):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "test"]
}
```

> Note (verify, do not assume): this minimal config drops the monorepo base's `lib: [DOM…]` and `types: [vitest/globals…]`. The source uses `node:crypto` (a module import, not a global), no DOM APIs, and the tests import `{ describe, expect, it }` from `vitest` explicitly (no ambient globals), and not setting `types` lets all installed `@types/*` (including `@types/node`) resolve — so it should typecheck. Step 5 confirms it. If typecheck complains about a missing global, add the specific `lib`/`types` entry it names rather than copying the whole monorepo base.

- [ ] **Step 3: Install and build**

```bash
cd ~/workspace/repos/verifactu
npm install
npm run build
```

Expected: `dist/index.js`, `dist/index.d.ts`, `dist/testing/fake-aeat.js`, `dist/testing/fake-aeat.d.ts` all exist.

- [ ] **Step 4: Verify emit produced both JS and declarations (TS 7 emit check)**

```bash
test -f dist/index.js && test -f dist/index.d.ts && test -f dist/testing/fake-aeat.js && test -f dist/testing/fake-aeat.d.ts && echo OK
```

Expected: `OK`. **If declarations are missing** (the native TS 7 compiler's emit differs), pin `typescript` to the latest version that emits `.d.ts` for this project and re-run; record the working version in the commit. Do not proceed until both `.js` and `.d.ts` emit.

- [ ] **Step 5: Typecheck and run the existing suite**

```bash
npm run typecheck && npm test
```

Expected: typecheck clean; the existing tests pass (they run against source, unaffected by the build).

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json tsconfig.build.json package-lock.json
git commit -s -m "Add the build and the publish-ready manifest

tsc now emits dist/ (JavaScript + type declarations) because a published
package cannot ship raw TypeScript the way the monorepo consumed it. The
manifest is public, Apache-2.0, scoped @waitron, and its exports map exposes
the root plus a ./testing entry."
```

---

### Task A3: The `./testing` public export — build-smoke proof it resolves

**Files:**
- Create: `~/workspace/repos/verifactu/scripts/pack-smoke.mjs`
- (No source change — `exports."./testing"` already added in A2; this task proves it works from the built, packed package.)

**Interfaces:**
- Consumes: the `exports` map from A2.
- Produces: proof that a consumer installing the packed tarball can `import { createFakeAeat } from "@waitron/verifactu/testing"` and `import * as v from "@waitron/verifactu"`.

- [ ] **Step 1: Write the pack-smoke script**

```javascript
// scripts/pack-smoke.mjs — packs the built package, installs it into a temp
// project, and asserts the root and ./testing exports resolve from dist.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
execSync("npm run build", { cwd: root, stdio: "inherit" });
const tarball = execSync("npm pack --silent", { cwd: root }).toString().trim();

const dir = mkdtempSync(join(tmpdir(), "verifactu-smoke-"));
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "smoke", type: "module", private: true }));
execSync(`npm install ${join(root, tarball)}`, { cwd: dir, stdio: "inherit" });
writeFileSync(
  join(dir, "smoke.mjs"),
  [
    'import * as v from "@waitron/verifactu";',
    'import { createFakeAeat } from "@waitron/verifactu/testing";',
    'if (typeof v.computeHuella !== "function") throw new Error("root export missing computeHuella");',
    'if (typeof v.buildQrPayload !== "function") throw new Error("root export missing buildQrPayload");',
    'if (typeof createFakeAeat !== "function") throw new Error("./testing export missing createFakeAeat");',
    'console.log("pack-smoke OK");',
  ].join("\n"),
);
execSync("node smoke.mjs", { cwd: dir, stdio: "inherit" });
```

- [ ] **Step 2: Run it**

```bash
cd ~/workspace/repos/verifactu && node scripts/pack-smoke.mjs
```

Expected: `pack-smoke OK`. If `./testing` fails to resolve, fix the `exports` map or the `outDir` layout until the packed tarball resolves both entries.

- [ ] **Step 3: Commit**

```bash
git add scripts/pack-smoke.mjs
git commit -s -m "Prove the built package resolves its root and ./testing exports

A pack-smoke check installs the packed tarball into a throwaway project and
imports both entries, so a broken exports map or dist layout fails here rather
than in a consumer. This is the one guarantee the monorepo never needed,
because it consumed raw source."
```

---

### Task A4: Scrub internal references and add the no-internal-references guard

**Files:**
- Modify: `src/huella.test.ts` (drop "CLAUDE.md §5 / §1" comment pointers)
- Modify: `src/records.test.ts` (drop "CLAUDE.md §5" pointer)
- Modify: `src/validate.ts:34` (replace `docs/compliance/verifactu-findings.md:621` pointer with the AEAT source or a plain statement)
- Modify: `PROVENANCE.md`, `README.md` (public-audience rewrite — no internal process)
- Create: `src/no-internal-references.test.ts` (guard)

**Interfaces:**
- Produces: a repo whose tree contains no `claude`/`codex`/`superpower`/`CLAUDE.md`/internal-doc references, enforced by a test.

- [ ] **Step 1: Write the failing guard test**

```typescript
// src/no-internal-references.test.ts
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("the public repo carries no internal or AI-workflow references", () => {
  it("finds none of the forbidden markers in tracked files", () => {
    // Case-insensitive; scans tracked files only. `git grep` returns exit 1 (no matches) on success.
    const pattern = "claude|codex|superpower|CLAUDE\\.md|docs/(superpowers|compliance|handoffs)";
    let hits = "";
    try {
      hits = execSync(`git grep -In -iE '${pattern}' -- . ':(exclude)src/no-internal-references.test.ts'`, {
        encoding: "utf8",
      });
    } catch (e: unknown) {
      // git grep exits 1 with empty stdout when there are no matches — that is success.
      const err = e as { status?: number; stdout?: string };
      if (err.status === 1 && !err.stdout) return;
      throw e;
    }
    expect(hits, `internal references found:\n${hits}`).toBe("");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL listing the known spots**

```bash
cd ~/workspace/repos/verifactu && npx vitest run src/no-internal-references.test.ts
```

Expected: FAIL, listing `src/huella.test.ts`, `src/records.test.ts`, `src/validate.ts`, and any `PROVENANCE.md`/`README.md` lines.

- [ ] **Step 3: Scrub each reference**

- `src/huella.test.ts` (~lines 169, 197): reword the two comments to state the invariant directly (that `entorno` is our metadata and never enters the hash, and that the block runs the claim rather than asserting it), with no "CLAUDE.md §N" pointer.
- `src/records.test.ts` (~line 417): reword to state the fiscal invariant (Destinatarios is not one of the eight fields that enter the huella) with no "CLAUDE.md §5" pointer.
- `src/validate.ts` (~line 34): replace the `docs/compliance/verifactu-findings.md:621` pointer with the AEAT source it rests on (cite the relevant XSD/FAQ), or state the rule plainly.
- `PROVENANCE.md`: already public-facing after the monorepo scrub; re-read it end to end and remove anything describing internal process.
- `README.md`: re-read; make it a public README (what the library does, install, a minimal usage example, a provenance note). Remove any internal reference.

- [ ] **Step 4: Run the guard to green, then the full suite**

```bash
npx vitest run src/no-internal-references.test.ts && npm test
```

Expected: guard PASSES; full suite stays green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -s -m "Scrub internal references and guard against their return

Reword the in-source comments that pointed at internal files, rewrite the
provenance and README for a public audience, and add a test that fails if any
internal or AI-workflow reference reappears in a tracked file."
```

---

### Task A5: CI workflow for the library repo

**Files:**
- Create: `~/workspace/repos/verifactu/.github/workflows/ci.yml`
- Create (if needed): `~/workspace/repos/verifactu/eslint.config.js` (minimal flat config), `.prettierignore`

**Interfaces:**
- Produces: a CI that runs install, format:check, lint, typecheck, test:coverage (98 bars), the pack-smoke, mutation (90), and the no-internal-references guard on every push and PR.

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run format:check
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run build
      - run: node scripts/pack-smoke.mjs
      - run: npm run test:coverage
      - run: npm run mutation
```

- [ ] **Step 2: Confirm the coverage thresholds are UNCHANGED from the copied config**

Read `vitest.config.ts` (copied verbatim in A1). Confirm `coverage.thresholds` reads exactly `{ statements: 98, lines: 98, functions: 98, branches: 95 }` — the 95 is on **branches**, not lines. Do NOT reorder or edit these; the copied config already holds the correct gate, and changing the metric a number sits on would silently move the gate. Confirm `coverage.include` names `src`. (The config is already standalone — it does not extend a monorepo base.)

- [ ] **Step 3: Confirm the mutation config is UNCHANGED from the copied config**

Read `stryker.config.json` (copied in A1). Confirm `thresholds.break` is `90` and `mutate` is already package-wide — `["src/**/*.ts", "!src/**/*.test.ts"]`. No widening is needed (the named-subset caveat in CLAUDE.md is about `packages/fiscal`, not verifactu). Leave it as copied.

- [ ] **Step 4: Run the whole CI sequence locally**

```bash
cd ~/workspace/repos/verifactu
npm run format:check && npm run lint && npm run typecheck && npm run build && node scripts/pack-smoke.mjs && npm run test:coverage && npm run mutation
```

Expected: every step passes; coverage ≥ bars; mutation ≥ 90.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml eslint.config.js .prettierignore vitest.config.ts stryker.config.json
git commit -s -m "Add the library's own CI: format, lint, types, build-smoke, coverage, mutation

The gates that used to live in Waitron's CI now belong to this repo — the
98/98/98/95 coverage bars and the 90 mutation floor — plus a build and
pack-smoke so a broken exports map fails here."
```

---

### Task A6: Release workflow — publish on tag with provenance

**Files:**
- Create: `~/workspace/repos/verifactu/.github/workflows/release.yml`

**Interfaces:**
- Produces: a workflow that, on a `v*` tag, builds and runs `npm publish --access public` with provenance via GitHub OIDC.

- [ ] **Step 1: Write `.github/workflows/release.yml`**

```yaml
name: Release
on:
  push:
    tags: ["v*"]
permissions:
  contents: read
  id-token: write   # required for npm provenance via OIDC
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: "https://registry.npmjs.org"
      - run: npm ci
      - run: npm run build
      - run: node scripts/pack-smoke.mjs
      - run: npm publish --access public --provenance
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Document the one-time secret**

In `README.md` (or a `CONTRIBUTING.md`), note: an npm **automation** token for the `waitron` org must be stored as the repo secret `NPM_TOKEN`. Provenance additionally requires the workflow to run from the public repo (it does) and the `repository` field to match (it does, from A2).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml README.md
git commit -s -m "Publish on tag, with npm provenance

A v* tag builds, re-runs the pack-smoke, and publishes the public package with
provenance via GitHub OIDC. Provenance is a trust signal worth having for a
fiscal library."
```

---

### Task A7: Push, get CI green, publish `0.1.0`

**Files:** none (operational).

**Interfaces:**
- Produces: `@waitron/verifactu@0.1.0` public on npm; the version Part B depends on.

- [ ] **Step 1: Push all commits and watch CI**

```bash
cd ~/workspace/repos/verifactu
git push origin main
gh run watch --exit-status
```

Expected: the CI workflow completes green. Fix anything it finds before proceeding.

- [ ] **Step 2: Add the `NPM_TOKEN` secret (owner action)**

The owner creates an npm automation token for the `waitron` org and sets it:

```bash
gh secret set NPM_TOKEN --repo waitron-io/verifactu
```

- [ ] **Step 3: Tag and publish `0.1.0`**

```bash
npm version 0.1.0 --no-git-tag-version   # if package.json is not already 0.1.0; else skip
git tag v0.1.0 && git push origin v0.1.0
gh run watch --exit-status                # the Release workflow
```

Expected: the Release workflow publishes. Verify:

```bash
npm view @waitron/verifactu version       # expect: 0.1.0
```

- [ ] **Step 4: Confirm the published tarball contents**

```bash
npm pack @waitron/verifactu@0.1.0 --dry-run
```

Expected: the tarball contains `dist/`, `schemas/`, `README.md`, `PROVENANCE.md`, `LICENSE` — and NOT `src/`, `test/`, `coverage/`, or `.github/`.

---

## PART B — Repoint Waitron (worktree `extract-verifactu`)

> Create the worktree at execution time: `python3 ~/workspace/tools/worktree.py new waitron extract-verifactu`. All Part B paths are relative to that worktree.

### Task B1: Swap the workspace package for the registry dependency

**Files:**
- Modify: `apps/server/package.json` (move `@waitron/verifactu` to `devDependencies`, `^0.1.0`)
- Modify: `packages/fiscal-verifactu/package.json` (`dependencies`, `^0.1.0`)
- Modify: `packages/provisioning/package.json` (`devDependencies`, `^0.1.0`)
- Modify (6 import sites, deep → public): `packages/fiscal-verifactu/src/acks.test.ts`, `packages/fiscal-verifactu/src/drain.concurrency.test.ts`, `packages/fiscal-verifactu/src/drain.test.ts`, `packages/fiscal-verifactu/src/reconcile.test.ts`, `packages/fiscal-verifactu/test/write-path-fixtures.ts`, `packages/provisioning/src/venue-apply.e2e.test.ts`
- Delete: `packages/verifactu/`
- Modify: `pnpm-lock.yaml` (regenerated by install)

**Interfaces:**
- Consumes: `@waitron/verifactu@0.1.0` from the registry (Part A) and its `./testing` export.
- Produces: a Waitron that resolves verifactu from the registry, with the three consumers green.

- [ ] **Step 1: Rewrite the six deep imports**

In each of the six files, replace:

```typescript
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
```

with:

```typescript
import { createFakeAeat } from "@waitron/verifactu/testing";
```

Verify no deep **import** remains (narrow to the import form — a broad `@waitron/verifactu/src/` grep also hits doc-comment cross-references in `fiscal-verifactu/src/drain.ts`, `fiscal-verifactu/test/drain-fixtures.ts` and `workforce/src/projection.ts`, which are NOT being changed here):

```bash
grep -rn 'from "@waitron/verifactu/src/' packages apps | grep -v node_modules
```

Expected: no results. (The remaining comment cross-references are fine; thin them only when next touching those files.)

- [ ] **Step 2: Repoint the three manifests and delete the package**

Set the dependency in each consumer's `package.json`:
- `apps/server`: remove `@waitron/verifactu` from `dependencies`, add `"@waitron/verifactu": "^0.1.0"` to `devDependencies` (production never imports it — only two test files do).
- `packages/fiscal-verifactu`: change `"@waitron/verifactu": "workspace:*"` to `"^0.1.0"` in `dependencies`.
- `packages/provisioning`: change `"@waitron/verifactu": "workspace:*"` to `"^0.1.0"` in `devDependencies`.

```bash
git rm -r packages/verifactu
pnpm install
```

Expected: install resolves `@waitron/verifactu@0.1.0` from the registry; `pnpm-lock.yaml` updates.

- [ ] **Step 3: Run the three consumers' focused suites**

```bash
pnpm --filter @waitron/fiscal-verifactu test
pnpm --filter @waitron/provisioning test
pnpm --filter @waitron/server test -- fake-aeat aeat qr-link-range
```

Expected: green. The behaviour is identical (same code, resolved from the registry); the `fake-aeat` double now arrives via `@waitron/verifactu/testing`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -s -m "Consume @waitron/verifactu from the registry, not the workspace

The library now lives in its own repo and npm package, so Waitron depends on
@waitron/verifactu@^0.1.0 instead of the workspace copy, the fake-AEAT double
is imported from its public ./testing entry rather than a deep source path,
and packages/verifactu is deleted. No behavioural change."
```

---

### Task B2: Clean up `ci.yml` (job, gate, filter, and the stale receipts)

**Files:**
- Modify: `.github/workflows/ci.yml`
- Verify: `scripts/ci-workflow.test.mjs`, `scripts/main-tag-guard.test.mjs`

**Interfaces:**
- Produces: a CI workflow with no verifactu-specific job, gate, or filter, and its text-guards green.

- [ ] **Step 1: Remove the verifactu pieces from `ci.yml`**

Delete, in `.github/workflows/ci.yml`:
- the `mutation-verifactu` job (its whole block, ~lines 1473-1499, including the `mutation-report-verifactu` artifact upload) and its entry in the `ci` job's `needs:` list (~line 1572);
- the `verifactu` output of the `changes`/`gates` job (~line 126) and the step logic that computes it;
- the `--filter "!@waitron/verifactu"` argument from the coverage-run step (~line 1368).

Leave every `fiscal-verifactu` reference untouched — that package stays.

- [ ] **Step 2: Sweep the stale comment receipts the removal leaves** (editing a file is not auditing it — CLAUDE.md §1)

- The `mutation-shared` job header (~lines 1501-1515) calls its target "cheaper than `packages/verifactu`" and gated "by the same membership mechanism as **mutation-verifactu above**". Remove the "cheaper than packages/verifactu" clause and reword the "as mutation-verifactu above" reference — that job no longer exists — so the comment stands on its own.
- The changed-scope worked example (~lines 87-88) prints `verifactu=false`. It is explicitly a *historical* snapshot (disclaimed at ~lines 90-91, "spelled as it was on `main` at the time"), so leaving it is defensible; if you touch it, drop only the `verifactu=false` token. Low priority.

- [ ] **Step 3: Run the workflow text-guards**

```bash
pnpm exec vitest run scripts/ci-workflow.test.mjs scripts/main-tag-guard.test.mjs
```

Expected: PASS. If either pins a job count or the `needs` list, update the guard's expectation to match the removed job, then re-run.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml scripts/ci-workflow.test.mjs scripts/main-tag-guard.test.mjs
git commit -s -m "Drop verifactu's CI job, change-gate and coverage filter

The package no longer lives here, so its dedicated mutation job, its change
detection gate, and the coverage-run filter that excluded it are removed —
along with the stale comment receipts on the mutation-shared job that pointed
at the removed job."
```

---

### Task B3: Guard SOURCE and config cleanup (mechanical removals)

**Files:**
- Modify: `scripts/coverage-thresholds.test.ts`
- Modify: `scripts/changed-scope.mjs`
- Modify: `scripts/english-only.test.ts`
- Modify: `eslint.config.js`

**Interfaces:**
- Produces: the guard/config source with no reference to verifactu as a workspace member. The guard TESTS (`changed-scope.test.mjs`, `changed-packages.test.mjs`) are rewritten in B4 and stay RED until then.

- [ ] **Step 1: `scripts/coverage-thresholds.test.ts`** — remove the `"@waitron/verifactu",` entry from `HIGH_BAR_PACKAGES` (~line 43). Keep `@waitron/fiscal-verifactu`.

- [ ] **Step 2: `scripts/changed-scope.mjs`** — two functional removals plus a comment sweep:
  - remove `"@waitron/verifactu",` from `LIGHT_B_PACKAGES` (~line 328) — verifactu ran its tests in the `test-light-b` shard;
  - remove the `{ output: "verifactu", covers: membership("@waitron/verifactu") },` entry from `SCOPE_GATES` (~line 421) — the `mutation-verifactu` gate;
  - comments: the path-allowlist rationale (~lines 12-16) uses `packages/verifactu/schemas/README.md` as its example — reword it to state the principle (an allowlist of paths, not an extension match, because a package-nested README can be a test fixture) without naming the deleted file; the `FISCAL_VERIFACTU_PACKAGE` comment's last sentence (~line 254, "NOT to be confused with the `verifactu` gate…") — delete it; the `SCOPE_GATES` mutation-measurement comment (~lines 375-379) — repoint the example from `mutation-verifactu` to `mutation-shared`, which remains; the `gateOutputs` dependents example (~lines 499-504) — drop the `@waitron/verifactu...` half, keeping the `@waitron/shared...` one.

- [ ] **Step 3: `scripts/english-only.test.ts`** — in the negative-check loop (`for (const domainSpecific of [...])`, ~line 141) remove `"verifactu"`, leaving `"country-es"`, `"country-gb"`, `"reporting"`; trim the "verifactu (the AEAT wire library)" phrase from the comment above it (~lines 137-138).

- [ ] **Step 4: `eslint.config.js`** — remove the ENTIRE first `import-x/no-restricted-paths` config object, the one whose single zone `target`s `./packages/verifactu/**/*` (~lines 44-78: its `files`/`plugins`/`settings`/`rules`). That rule forbade repo packages from importing verifactu's internals; with verifactu external it targets a directory that no longer exists. **Leave the `packages/shared` no-restricted-paths object (from ~line 80) untouched.** Read the surrounding lines to find the object's exact `{`…`}` boundaries before deleting.

- [ ] **Step 5: Run the affected guards and lint**

```bash
pnpm exec vitest run scripts/coverage-thresholds.test.ts scripts/english-only.test.ts scripts/module-seams.test.ts
pnpm --filter @waitron/fiscal-verifactu lint
```

Expected: the three guards PASS. `module-seams.test.ts` passes **unchanged** — it keys on the package name `@waitron/verifactu`, still an external dependency, and the host-must-not-import-in-production boundary is unchanged. Lint passes with the verifactu eslint zone gone. (The `changed-scope`/`changed-packages` guard tests are still RED here — B4 rewrites them.)

- [ ] **Step 6: Commit**

```bash
git add scripts/coverage-thresholds.test.ts scripts/changed-scope.mjs scripts/english-only.test.ts eslint.config.js
git commit -s -m "Remove verifactu from the workspace guards and the eslint boundary

Coverage thresholds, the changed-scope light bin and mutation gate, the
english-only exemption, and the eslint no-restricted-paths zone that fenced
packages/verifactu all named a package that has left the workspace. The stale
comment receipts pointing at the removed gate go in the same change.
module-seams needs no change — it keys on the package name, which still exists."
```

---

### Task B4: Rewrite the guard TESTS that were built around verifactu

The two `changed-*` guard tests are STRUCTURALLY built on verifactu — one exemplar package that switches two gates, and one primary-source README fixture. `@waitron/shared` has the identical dual-gate shape (it is in `LIGHT_A_PACKAGES` **and** has its own `shared` mutation gate), so it replaces the exemplar; an existing package README replaces the fixture.

**Files:**
- Modify: `scripts/changed-scope.test.mjs`
- Modify: `scripts/changed-packages.test.mjs`

**Interfaces:**
- Consumes: `changed-scope.mjs`'s `SCOPE_GATES` with the `verifactu` gate removed (B3).
- Produces: both `.test.mjs` files green.

- [ ] **Step 1: Delete the verifactu-specific mutation-gate test**

In `scripts/changed-scope.test.mjs`, delete the test `"runs mutation-verifactu only when @waitron/verifactu is in the resolved scope"` (~lines 436-439). The analogous `"runs mutation-shared only when @waitron/shared is in the resolved scope"` test (~lines 441-444) stays and covers the membership-gate pattern.

- [ ] **Step 2: Rewrite the "gates independent" test against `@waitron/shared`**

Replace the `"keeps the gates independent of each other"` test (~lines 446-475) with:

```javascript
  // A package in scope must not switch on a gate belonging to a different package.
  // @waitron/fiscal-verifactu has its own shard, so it switches `fiscal_verifactu` and neither
  // light gate; @waitron/shared is in bin A, so it switches light_a AND the `shared` mutation
  // gate (one package can legitimately switch on both); @waitron/server switches only `server`.
  it("keeps the gates independent of each other", () => {
    const scope = packagesInScope(
      ls("@waitron/shared", "@waitron/fiscal-verifactu", "@waitron/server"),
    );
    expect(gates(scope)).toEqual({
      heavy: "false",
      ui: "false",
      till: "false",
      dashboard: "false",
      setup: "false",
      venue_service: "false",
      server: "true",
      fiscal_verifactu: "true",
      bookings: "false",
      media: "false",
      payments_stripe: "false",
      payments_sumup: "false",
      light_a: "true",
      light_b: "false",
      shared: "true",
    });
  });
```

- [ ] **Step 3: Remove verifactu from the remaining gate baselines**

In `scripts/changed-scope.test.mjs`:
- in the per-gate baseline object of the "switches only its own gate" test (~line 429), remove the `verifactu: "false",` line (keep `shared: "false",`);
- in the hardcoded gate-name list (~line 548), remove the `"verifactu",` entry (keep `"shared",`).

If either is derived from `SCOPE_GATES` rather than hardcoded, B3 already dropped it — check, and only edit the hardcoded copies.

- [ ] **Step 4: Replace the schemas-README classification fixture**

- In `scripts/changed-scope.test.mjs`, delete the test `"treats packages/verifactu/schemas/README.md as code, not documentation"` and its comment (~lines 49-55). The general case `packages/db/README.md` (~line 59) already asserts a package-nested README classifies as code, and the deleted test's rationale (a primary-source fixture) no longer has a file in this repo.
- In `scripts/changed-packages.test.mjs`, in the "treats exactly the paths classify() calls documentation" test (~lines 306-314), replace `"packages/verifactu/schemas/README.md"` (~line 311) with `"packages/db/README.md"` — an existing non-docs package README that `classify()` also treats as code.

- [ ] **Step 5: Run both files to green**

```bash
pnpm exec vitest run scripts/changed-scope.test.mjs scripts/changed-packages.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/changed-scope.test.mjs scripts/changed-packages.test.mjs
git commit -s -m "Rewrite the changed-scope guard tests around @waitron/shared

Two tests were built on verifactu: one exemplar that switches two gates, and a
primary-source README fixture. @waitron/shared has the same dual-gate shape (a
light bin plus its own mutation gate), so it replaces the exemplar, and an
existing package README replaces the fixture. The gate logic is unchanged."
```

---

### Task B5: Documentation sweep (and the local-override note)

**Files:**
- Modify: `CLAUDE.md`, `docs/developers/ci-and-gates.md`, `docs/developers/testing-guide.md`, `docs/developers/workflow-guide.md`
- Verify: `scripts/claude-md-pointers.test.ts`

**Interfaces:**
- Produces: docs with no false claim about verifactu being a workspace package, plus the §3.3 local-override note.

- [ ] **Step 1: Find and fix the false statements**

```bash
grep -rn "verifactu" CLAUDE.md docs/developers/ci-and-gates.md docs/developers/testing-guide.md | grep -v fiscal-verifactu
```

For each hit, decide: is it still true with verifactu external? Fix only the ones the extraction falsifies — the `mutation-verifactu` CI job (gone), the 98-bar coverage set membership (verifactu removed), the `test-light-b` bin membership, and any "workspace package" framing. Leave statements that remain true. Do not sweep unrelated lines.

- [ ] **Step 2: Add the local-override note (spec §3.3)**

In `docs/developers/workflow-guide.md`, document how to point Waitron at a local checkout of the library for iterating without publishing — a `pnpm link --global` from `~/workspace/repos/verifactu` plus `pnpm link --global @waitron/verifactu` in the consumer, or a `pnpm.overrides` entry mapping `@waitron/verifactu` to a `file:` path — and note that the committed manifests always reference the published version.

- [ ] **Step 3: Run the pointer guard and confirm no dangling links**

```bash
pnpm exec vitest run scripts/claude-md-pointers.test.ts
```

Expected: PASS (no `packages/verifactu/...` backticked path remains in `CLAUDE.md` or its topic files that the guard checks).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/developers/ci-and-gates.md docs/developers/testing-guide.md docs/developers/workflow-guide.md
git commit -s -m "Update the docs the extraction made false, and document the local override

verifactu is no longer a workspace package: its mutation job is gone, it has
left the 98-bar coverage set and the light-b test bin, and it is an external
dependency now. Fix the statements that said otherwise, and record how to point
Waitron at a local checkout of the library while iterating."
```

---

### Task B6: Full verification and open the PR

**Files:** none (verification + PR).

**Interfaces:**
- Produces: a green PR ready to land.

- [ ] **Step 1: Run the guard suite and the affected consumers**

```bash
pnpm exec vitest run scripts/          # the root guard project
pnpm --filter @waitron/fiscal-verifactu test:coverage
```

Expected: green. Investigate any failure at the root, never re-run to green.

- [ ] **Step 2: Push and let the pre-push hook run once**

```bash
git push -u origin extract-verifactu
```

Expected: the hook runs the local gate (it will typecheck the changed packages — `fiscal-verifactu`, `provisioning`, `apps/server`); all pass. Do not `--no-verify`; do not hand-run the gate first.

- [ ] **Step 3: Open the PR and watch CI**

```bash
gh pr create --fill
gh pr checks --watch
```

Expected: CI green. Confirm the run belongs to the current head SHA (`gh run view <id> --json headSha`). Address anything CI finds.

- [ ] **Step 4: Report ready to land**

State plainly that the branch is validated and ready for `finish-branch` / the owner's `land-branch`. Note that landing Part B requires `@waitron/verifactu@0.1.0` to be published (Part A, Task A7) — CI's install will fail otherwise.

---

## Self-Review

**Spec coverage:**
- §1 decisions → Global Constraints + A1/A2 (name, licence, version, org). ✓
- §2.1 what moves → A1. ✓  §2.2 build → A2. ✓  §2.3 manifest/exports → A2. ✓  §2.4 public API + ./testing → A2/A3. ✓  §2.5 licence/provenance → A1/A4. ✓
- §2.6 library CI → A5; release/provenance → A6. ✓
- §2.7 no internal artifacts → A4 (scrub + guard). ✓
- §2.8/§2.9/§2.10 (differential tests, facade, QR renderer) → **deliberately deferred to a follow-up plan** (off critical path, spike-gated). Stated at the top. ✓
- §3 consumption (registry dep, deep-import fix, local override) → B1 (dep + imports), B5 Step 2 (local-override doc). ✓
- §4 gate cleanup → B2 (ci.yml + stale receipts), B3 (guard source + eslint zone), B4 (guard-test rewrites), B5 (docs); §4.3 module-seams no-change → asserted in B3 Step 5. ✓
- §5 testing → A3 (build smoke), A5 (coverage/mutation), B1/B6 (consumer + guard suites). ✓
- §6 sequencing → Part A before Part B; B6 Step 4 notes the publish dependency. ✓
- §7 two-repo cost → inherent; noted in the spec. ✓

**Applied from the fresh-context plan review (2026-09-21):**
- Coverage bars corrected to `statements 98, functions 98, lines 98, branches 95` (the 95 is on branches) in Global Constraints and A5 Step 2 — the earlier "98/98/98/95 statements/branches/functions/lines" would have moved the gate. Same fix in spec §2.6.
- Part B split: B3 is now the mechanical guard/config source removals (adding the `changed-scope.mjs` light-bin + gate, the stale-comment sweep, and the `eslint.config.js` no-restricted-paths zone the first draft missed entirely); B4 is the design-laden guard-TEST rewrites against `@waitron/shared` (the package with verifactu's dual-gate shape), with the schemas-README fixture repointed to `packages/db/README.md`.
- B1's deep-import verification narrowed to the `from "@waitron/verifactu/src/` form so doc-comment cross-references don't read as failures.
- A5 Step 3 corrected (verifactu's stryker `mutate` is already package-wide).

**Placeholder scan:** the `eslint`/`prettier` version notes and the TS-7-emit fallback (A2) are explicit verify-and-pin steps, not vague TODOs. B4's rewritten test is shown in full. No "add error handling"/"write tests for the above" placeholders.

**Type consistency:** the `./testing` export path (`@waitron/verifactu/testing`) is used identically in A2 (exports map), A3 (smoke), and B1 (the six rewrites); `createFakeAeat` throughout. `@waitron/shared` is the replacement exemplar in B4, consistent with its `LIGHT_A`+`shared`-gate membership in `changed-scope.mjs`. Mutation `90` and the corrected coverage bars are stated consistently.

---

## Follow-up (separate plan, after this lands and the spike runs)

The spec's §2.8 (differential tests vs `inoguerols/verifactu`), §2.9 (convenience facade), and §2.10 (optional QR image renderer). First task there is the spike that maps inoguerols's real published API to ours; the facade and renderer are additive, opt-in, and must not add a runtime dependency to the root entry.
