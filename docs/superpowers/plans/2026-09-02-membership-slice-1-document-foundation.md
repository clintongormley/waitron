# Membership Slice 1 — Document Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-logic foundation of the membership & rejoin wire-protocol — a self-verifying, signed membership *document* with an Ed25519 trust chain and the two-part accept test — as a new leaf package `@waitron/membership`, with no DB, server, or fiscal dependencies.

**Architecture:** A new pure TypeScript leaf package depending only on `@waitron/shared`. It provides: the document/keypair/endorsement types; deterministic canonical serialization; Ed25519 sign/verify primitives over `node:crypto`; endorsement-chain resolution (a signer's key trusted directly or vouched for back to setup); `verifyMembershipDocument` (authenticity, returning a Result union); and `acceptMembershipDocument` (the authentic **and** strictly-newer gate). Adversarial/stale input is modelled as data (Result unions), not thrown errors; only malformed key material throws an `AppError`.

**Tech Stack:** TypeScript (ESM, `moduleResolution: bundler`), Vitest, `node:crypto` (Ed25519), `@waitron/shared` (`AppError` + the tree-wide error registry).

**Spec:** `docs/superpowers/specs/2026-09-02-membership-and-rejoin-wire-protocol-design.md` (§3 document, §4 trust/keys/accept test). This plan implements **only** the pure §3–§4 foundation; storage, distribution, promotion, rejoin, and conflict resolution are later slices.

## Global Constraints

- **Leaf package, `@waitron/shared` only.** `packages/membership` must depend on nothing but `@waitron/shared` (+ dev tooling). Never import `@waitron/db`/`sync`/server — the whole point is that `db` and `sync` can depend on *it* without a cycle.
- **Error codes name the domain concept, never the package** (CLAUDE.md §3). Use `membership.<concept>`, lowercase, dot-namespaced. Codes are never renamed once shipped. Every throwing file does `import { AppError } from "@waitron/shared";` then `import "./errors.js";`.
- **Error params name the problem, never echo the offending value** (house rule — see `packages/layouts/src/theme.ts`).
- **Adversarial input is data, not exceptions.** `verifyMembershipDocument`/`acceptMembershipDocument` return discriminated-union Results; they do **not** throw on a forged, malformed, or stale document. Only genuinely malformed *key material* throws (`membership.key_invalid`).
- **English-only identifiers** (CLAUDE.md §3). This is a generic (non-Spanish-domain) package; it joins `GENERIC_PACKAGES`.
- **Coverage thresholds:** `statements 98 / lines 98 / functions 98 / branches 95` (the standard non-browser package config).
- **Key & signature encoding:** public keys as base64 SPKI-DER, private keys as base64 PKCS8-DER, signatures as base64. Everything is a JSON-friendly string so a document round-trips as JSON.
- **Determinism:** every signature is computed over `canonicalize(...)` of the signed structure — never over `JSON.stringify` directly (key order would vary).

---

## File structure

```
packages/membership/
  package.json          # name @waitron/membership, deps: @waitron/shared only
  tsconfig.json         # extends ../../tsconfig.base.json
  vitest.config.ts      # pure config: globals, v8 coverage, 98/98/98/95, no globalSetup
  src/
    index.ts            # barrel — re-exports + trailing `import "./errors.js";`
    errors.ts           # declare module "@waitron/shared" → membership.* ErrorParams
    errors.test.ts      # every membership.* code is constructible (reachability convention)
    types.ts            # NodeStanding, MembershipNode, MembershipDocumentBody,
                        #   SignedMembershipDocument, Endorsement, NodeKeyPair, TrustSet,
                        #   VerifyResult, AcceptResult
    canonicalize.ts     # deterministic JSON (recursively key-sorted)
    canonicalize.test.ts
    crypto.ts           # generateNodeKeyPair, signBytes, verifyBytes (Ed25519)
    crypto.test.ts
    endorsement.ts      # endorseKey, resolveSignerKey (chain + cycle guard)
    endorsement.test.ts
    verify.ts           # verifyMembershipDocument
    verify.test.ts
    accept.ts           # acceptMembershipDocument (two-part test)
    accept.test.ts
    integration.test.ts # end-to-end: keys → sign → verify → accept, replay + forgery rejected
```

Cross-package list edits (Task 1): `scripts/changed-scope.mjs`, `.github/workflows/ci.yml`, `packages/db/src/english-only.ts`, `scripts/english-only.test.ts`.

---

## Task 1: Package scaffold, types, and error registry

**Files:**
- Create: `packages/membership/package.json`, `packages/membership/tsconfig.json`, `packages/membership/vitest.config.ts`
- Create: `packages/membership/src/types.ts`, `packages/membership/src/errors.ts`, `packages/membership/src/index.ts`
- Test: `packages/membership/src/errors.test.ts`
- Modify: `scripts/changed-scope.mjs`, `.github/workflows/ci.yml`, `packages/db/src/english-only.ts`, `scripts/english-only.test.ts`

**Interfaces:**
- Produces (consumed by every later task):
  - `type NodeStanding = "serving-primary" | "serving-secondary" | "sell-only" | "evicted"`
  - `interface MembershipNode { nodeId: string; contactUrl: string; standing: NodeStanding }`
  - `interface MembershipDocumentBody { term: number; nodes: MembershipNode[] }`
  - `interface Endorsement { nodeId: string; publicKey: string; endorsedBy: string; signature: string }`
  - `interface SignedMembershipDocument { body: MembershipDocumentBody; signerNodeId: string; signature: string; endorsements: Endorsement[] }`
  - `interface NodeKeyPair { publicKey: string; privateKey: string }` (base64 DER)
  - `type TrustSet = Readonly<Record<string, string>>` (nodeId → base64 SPKI public key)
  - `type VerifyResult = { valid: true; term: number; signerNodeId: string; nodes: MembershipNode[] } | { valid: false; reason: VerifyFailure }`
  - `type VerifyFailure = "malformed" | "untrusted_signer" | "bad_signature" | "endorsement_invalid"`
  - `type AcceptResult = { accepted: true; document: SignedMembershipDocument } | { accepted: false; reason: "invalid"; failure: VerifyFailure } | { accepted: false; reason: "not_newer" }`
  - Error code `membership.key_invalid` with params `{ operation: "sign" | "verify" | "generate" }`.

- [ ] **Step 1: Scaffold the package files**

`packages/membership/package.json`:
```json
{
  "name": "@waitron/membership",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "@waitron/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`packages/membership/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["vitest/globals", "node"]
  },
  "include": ["src"]
}
```

`packages/membership/vitest.config.ts`:
```ts
import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [...coverageConfigDefaults.exclude, "src/index.ts"],
      thresholds: { statements: 98, lines: 98, functions: 98, branches: 95 },
    },
  },
});
```

- [ ] **Step 2: Write `src/types.ts`**

```ts
/** A node's serving standing in the venue (design §3). */
export type NodeStanding = "serving-primary" | "serving-secondary" | "sell-only" | "evicted";

export interface MembershipNode {
  readonly nodeId: string;
  readonly contactUrl: string;
  readonly standing: NodeStanding;
}

/** The signed payload. `term` is the monotonic membership generation (design §3). */
export interface MembershipDocumentBody {
  readonly term: number;
  readonly nodes: readonly MembershipNode[];
}

/** A member key vouched for by an already-trusted node, chaining back to setup (design §4). */
export interface Endorsement {
  readonly nodeId: string;
  readonly publicKey: string; // base64 SPKI DER of the endorsed node's identity key
  readonly endorsedBy: string; // nodeId of the endorser (must itself be trusted)
  readonly signature: string; // base64 Ed25519 over canonicalize({ nodeId, publicKey }) by endorsedBy
}

export interface SignedMembershipDocument {
  readonly body: MembershipDocumentBody;
  readonly signerNodeId: string; // the serving-primary that signed
  readonly signature: string; // base64 Ed25519 over canonicalize(body)
  readonly endorsements: readonly Endorsement[];
}

/** base64 DER: publicKey SPKI, privateKey PKCS8. */
export interface NodeKeyPair {
  readonly publicKey: string;
  readonly privateKey: string;
}

/** nodeId → base64 SPKI public key, the receiver's setup-established trust anchor. */
export type TrustSet = Readonly<Record<string, string>>;

export type VerifyFailure = "malformed" | "untrusted_signer" | "bad_signature" | "endorsement_invalid";

export type VerifyResult =
  | { readonly valid: true; readonly term: number; readonly signerNodeId: string; readonly nodes: readonly MembershipNode[] }
  | { readonly valid: false; readonly reason: VerifyFailure };

export type AcceptResult =
  | { readonly accepted: true; readonly document: SignedMembershipDocument }
  | { readonly accepted: false; readonly reason: "invalid"; readonly failure: VerifyFailure }
  | { readonly accepted: false; readonly reason: "not_newer" };
```

- [ ] **Step 3: Write the failing `src/errors.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import "./index.js"; // loads the barrel, which loads errors.ts

describe("membership error registry", () => {
  it("constructs membership.key_invalid with its params", () => {
    const e = new AppError("membership.key_invalid", { operation: "sign" });
    expect(e.code).toBe("membership.key_invalid");
    expect(e.params).toEqual({ operation: "sign" });
  });
});
```

- [ ] **Step 4: Run it, verify it fails**

Run: `pnpm --filter @waitron/membership test errors`
Expected: FAIL — `membership.key_invalid` is not a declared `ErrorParams` code (TS error / no such code).

- [ ] **Step 5: Write `src/errors.ts` and `src/index.ts`**

`packages/membership/src/errors.ts`:
```ts
// Registers the membership.* error codes on the shared registry (reachability convention —
// packages/shared/src/errors.ts; guarded tree-wide by scripts/errors-reachable.test.ts).
import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    // Thrown only for malformed key material — a programmer error, never adversarial input.
    "membership.key_invalid": { operation: "sign" | "verify" | "generate" };
  }
}
```

`packages/membership/src/index.ts`:
```ts
// The entire public surface of @waitron/membership. Re-exports only — no logic here.
export type {
  NodeStanding,
  MembershipNode,
  MembershipDocumentBody,
  Endorsement,
  SignedMembershipDocument,
  NodeKeyPair,
  TrustSet,
  VerifyFailure,
  VerifyResult,
  AcceptResult,
} from "./types.js";

// Side-effect only: keeps errors.ts's `declare module "@waitron/shared"` augmentation reachable from
// this package's own public barrel (reachability rule, packages/shared/src/errors.ts).
import "./errors.js";
```

- [ ] **Step 6: Run the errors test, verify it passes**

Run: `pnpm --filter @waitron/membership test errors`
Expected: PASS.

- [ ] **Step 7: Wire the package into CI scope + the vocabulary guard**

Read the exact list locations first, then edit. In `scripts/changed-scope.mjs`, add `"@waitron/membership"` to the `LIGHT_A_PACKAGES` array (alongside `@waitron/sync`). In `.github/workflows/ci.yml`, the `test-light-b` job subtracts the LIGHT_A members — add a line mirroring its siblings:
```yaml
        set -- "$@" --filter "!@waitron/membership"
```
(Read the `test-light-a` / `test-light-b` subtraction blocks around ci.yml:975-1010 and place the new `--filter "!..."` in the job that subtracts LIGHT_A, matching the existing style exactly — do NOT add it to the job that subtracts LIGHT_B.)

In `packages/db/src/english-only.ts`, add `"membership"` to the `GENERIC_PACKAGES` array. In `scripts/english-only.test.ts`, add the matching `"membership"` to the pinned expected copy of `GENERIC_PACKAGES`.

- [ ] **Step 8: Install, typecheck, and run the pinning guards**

```bash
pnpm install
pnpm --filter @waitron/membership typecheck
pnpm --filter @waitron/membership lint
pnpm vitest run scripts/ci-workflow.test.mjs scripts/english-only.test.ts
```
Expected: install clean (lockfile updated), typecheck/lint pass, and both guard suites pass (they cross-check the LIGHT bins in `changed-scope.mjs` against `ci.yml`, and the `GENERIC_PACKAGES` pin). If `ci-workflow.test.mjs` fails, the ci.yml `!`-filter is in the wrong light job or missing.

- [ ] **Step 9: Commit**

```bash
git add packages/membership scripts/changed-scope.mjs .github/workflows/ci.yml packages/db/src/english-only.ts scripts/english-only.test.ts pnpm-lock.yaml
git commit -s -m "feat(membership): scaffold @waitron/membership package + error registry"
```

---

## Task 2: Canonical serialization

**Files:**
- Create: `packages/membership/src/canonicalize.ts`
- Test: `packages/membership/src/canonicalize.test.ts`
- Modify: `packages/membership/src/index.ts` (export `canonicalize`)

**Interfaces:**
- Consumes: nothing.
- Produces: `type CanonicalValue = string | number | boolean | null | readonly CanonicalValue[] | { readonly [k: string]: CanonicalValue }`; `function canonicalize(value: CanonicalValue): string` — deterministic JSON with object keys sorted recursively; array order preserved.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { canonicalize } from "./canonicalize.js";

describe("canonicalize", () => {
  it("is independent of object key insertion order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });
  it("sorts keys recursively but preserves array order", () => {
    expect(canonicalize({ z: [{ y: 1, x: 2 }], a: 3 })).toBe('{"a":3,"z":[{"x":2,"y":1}]}');
  });
  it("emits no incidental whitespace", () => {
    expect(canonicalize({ a: 1 })).toBe('{"a":1}');
  });
  it("handles primitives and null", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize("x")).toBe('"x"');
    expect(canonicalize(7)).toBe("7");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @waitron/membership test canonicalize`
Expected: FAIL — `canonicalize` not defined.

- [ ] **Step 3: Write `src/canonicalize.ts`**

```ts
export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

/**
 * Deterministic JSON: object keys are sorted recursively so a signature over the output is stable
 * regardless of how the object was constructed. Array order is meaningful and preserved.
 */
export function canonicalize(value: CanonicalValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as { readonly [key: string]: CanonicalValue };
  const body = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
    .join(",");
  return `{${body}}`;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @waitron/membership test canonicalize`
Expected: PASS.

- [ ] **Step 5: Export and commit**

Add to `src/index.ts`: `export { canonicalize } from "./canonicalize.js"; export type { CanonicalValue } from "./canonicalize.js";`
```bash
git add packages/membership/src
git commit -s -m "feat(membership): deterministic canonical serialization"
```

---

## Task 3: Ed25519 keypair + sign/verify

**Files:**
- Create: `packages/membership/src/crypto.ts`
- Test: `packages/membership/src/crypto.test.ts`
- Modify: `packages/membership/src/index.ts`

**Interfaces:**
- Consumes: `NodeKeyPair` (Task 1); `membership.key_invalid` (Task 1).
- Produces:
  - `function generateNodeKeyPair(): NodeKeyPair`
  - `function signBytes(message: string, privateKeyB64: string): string` (base64 signature)
  - `function verifyBytes(message: string, signatureB64: string, publicKeyB64: string): boolean`
  - Malformed key material throws `AppError("membership.key_invalid", { operation })`; a wrong-but-well-formed key makes `verifyBytes` return `false` (not throw).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { generateNodeKeyPair, signBytes, verifyBytes } from "./crypto.js";
import "./errors.js";

describe("crypto", () => {
  it("round-trips a signature", () => {
    const kp = generateNodeKeyPair();
    const sig = signBytes("hello", kp.privateKey);
    expect(verifyBytes("hello", sig, kp.publicKey)).toBe(true);
  });
  it("rejects a tampered message", () => {
    const kp = generateNodeKeyPair();
    const sig = signBytes("hello", kp.privateKey);
    expect(verifyBytes("hell0", sig, kp.publicKey)).toBe(false);
  });
  it("rejects a signature from a different key", () => {
    const a = generateNodeKeyPair();
    const b = generateNodeKeyPair();
    const sig = signBytes("hello", a.privateKey);
    expect(verifyBytes("hello", sig, b.publicKey)).toBe(false);
  });
  it("returns false (never throws) on a malformed signature", () => {
    const kp = generateNodeKeyPair();
    expect(verifyBytes("hello", "not-base64-sig!!", kp.publicKey)).toBe(false);
  });
  it("throws membership.key_invalid on malformed key material", () => {
    let code = "";
    try {
      signBytes("hello", "not-a-key");
    } catch (e) {
      if (e instanceof AppError) code = e.code;
    }
    expect(code).toBe("membership.key_invalid");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @waitron/membership test crypto`
Expected: FAIL — `generateNodeKeyPair` not defined.

- [ ] **Step 3: Write `src/crypto.ts`**

```ts
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { AppError } from "@waitron/shared";
import type { NodeKeyPair } from "./types.js";
import "./errors.js";

export function generateNodeKeyPair(): NodeKeyPair {
  try {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    return {
      publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    };
  } catch {
    throw new AppError("membership.key_invalid", { operation: "generate" });
  }
}

export function signBytes(message: string, privateKeyB64: string): string {
  let key;
  try {
    key = createPrivateKey({ key: Buffer.from(privateKeyB64, "base64"), format: "der", type: "pkcs8" });
  } catch {
    throw new AppError("membership.key_invalid", { operation: "sign" });
  }
  return sign(null, Buffer.from(message, "utf8"), key).toString("base64");
}

export function verifyBytes(message: string, signatureB64: string, publicKeyB64: string): boolean {
  let key;
  try {
    key = createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
  } catch {
    // A malformed public key means we cannot trust the message — treat as a failed verification,
    // not a thrown error, because the key travels in adversarial input (a document from the wire).
    return false;
  }
  try {
    return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false; // malformed signature bytes
  }
}
```

Note: a malformed *public* key returns `false` (it arrives in wire data), while a malformed *private* key throws `membership.key_invalid` (it is our own key material — a programmer error).

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @waitron/membership test crypto`
Expected: PASS.

- [ ] **Step 5: Export and commit**

Add to `src/index.ts`: `export { generateNodeKeyPair, signBytes, verifyBytes } from "./crypto.js";`
```bash
git add packages/membership/src
git commit -s -m "feat(membership): ed25519 keypair and sign/verify primitives"
```

---

## Task 4: Endorsement creation + chain resolution

**Files:**
- Create: `packages/membership/src/endorsement.ts`
- Test: `packages/membership/src/endorsement.test.ts`
- Modify: `packages/membership/src/index.ts`

**Interfaces:**
- Consumes: `Endorsement`, `TrustSet` (Task 1); `canonicalize` (Task 2); `signBytes`, `verifyBytes` (Task 3).
- Produces:
  - `function endorseKey(nodeId: string, publicKey: string, endorserNodeId: string, endorserPrivateKey: string): Endorsement`
  - `function resolveSignerKey(signerNodeId: string, endorsements: readonly Endorsement[], trustSet: TrustSet): string | null` — returns the trusted base64 public key for `signerNodeId`, following endorsement chains back to a `trustSet` member; `null` if it cannot be trusted. Cycle-safe and bounded.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { generateNodeKeyPair } from "./crypto.js";
import { endorseKey, resolveSignerKey } from "./endorsement.js";
import type { Endorsement, TrustSet } from "./types.js";

describe("resolveSignerKey", () => {
  it("returns the key when the signer is directly in the trust set", () => {
    const a = generateNodeKeyPair();
    const trust: TrustSet = { A: a.publicKey };
    expect(resolveSignerKey("A", [], trust)).toBe(a.publicKey);
  });

  it("resolves a signer vouched for by a trusted node (one hop)", () => {
    const a = generateNodeKeyPair(); // trusted at setup
    const b = generateNodeKeyPair(); // added later, endorsed by A
    const trust: TrustSet = { A: a.publicKey };
    const e = endorseKey("B", b.publicKey, "A", a.privateKey);
    expect(resolveSignerKey("B", [e], trust)).toBe(b.publicKey);
  });

  it("rejects an endorsement by an untrusted endorser", () => {
    const b = generateNodeKeyPair();
    const rogue = generateNodeKeyPair();
    const e = endorseKey("B", b.publicKey, "R", rogue.privateKey); // R not in trust set
    expect(resolveSignerKey("B", [e], {})).toBeNull();
  });

  it("rejects an endorsement whose signature does not verify", () => {
    const a = generateNodeKeyPair();
    const b = generateNodeKeyPair();
    const trust: TrustSet = { A: a.publicKey };
    const tampered: Endorsement = { nodeId: "B", publicKey: b.publicKey, endorsedBy: "A", signature: "AAAA" };
    expect(resolveSignerKey("B", [tampered], trust)).toBeNull();
  });

  it("does not loop on a cyclic endorsement set", () => {
    const b = generateNodeKeyPair();
    const c = generateNodeKeyPair();
    const eBbyC = endorseKey("B", b.publicKey, "C", c.privateKey);
    const eCbyB = endorseKey("C", c.publicKey, "B", b.privateKey);
    expect(resolveSignerKey("B", [eBbyC, eCbyB], {})).toBeNull(); // neither roots at setup
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @waitron/membership test endorsement`
Expected: FAIL — `endorseKey`/`resolveSignerKey` not defined.

- [ ] **Step 3: Write `src/endorsement.ts`**

```ts
import { canonicalize } from "./canonicalize.js";
import { signBytes, verifyBytes } from "./crypto.js";
import type { Endorsement, TrustSet } from "./types.js";

/** The exact bytes an endorsement signs: the (nodeId, publicKey) pair it vouches for. */
function endorsementMessage(nodeId: string, publicKey: string): string {
  return canonicalize({ nodeId, publicKey });
}

export function endorseKey(
  nodeId: string,
  publicKey: string,
  endorserNodeId: string,
  endorserPrivateKey: string,
): Endorsement {
  return {
    nodeId,
    publicKey,
    endorsedBy: endorserNodeId,
    signature: signBytes(endorsementMessage(nodeId, publicKey), endorserPrivateKey),
  };
}

/**
 * Resolve `signerNodeId` to a trusted public key. Trust flows from the setup-established `trustSet`;
 * an endorsement extends trust only if its endorser is itself already trusted AND its signature
 * verifies. Bounded by the number of endorsements, so a cycle cannot loop forever.
 */
export function resolveSignerKey(
  signerNodeId: string,
  endorsements: readonly Endorsement[],
  trustSet: TrustSet,
): string | null {
  const trusted = new Map<string, string>(Object.entries(trustSet));
  // Repeatedly admit any endorsement whose endorser is trusted and whose signature verifies, until
  // no more can be admitted. At most one pass per endorsement, so it terminates on any input.
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of endorsements) {
      if (trusted.has(e.nodeId)) continue;
      const endorserKey = trusted.get(e.endorsedBy);
      if (endorserKey === undefined) continue;
      if (!verifyBytes(endorsementMessage(e.nodeId, e.publicKey), e.signature, endorserKey)) continue;
      trusted.set(e.nodeId, e.publicKey);
      changed = true;
    }
  }
  return trusted.get(signerNodeId) ?? null;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @waitron/membership test endorsement`
Expected: PASS.

- [ ] **Step 5: Export and commit**

Add to `src/index.ts`: `export { endorseKey, resolveSignerKey } from "./endorsement.js";`
```bash
git add packages/membership/src
git commit -s -m "feat(membership): endorsement chain resolution back to setup trust"
```

---

## Task 5: verifyMembershipDocument

**Files:**
- Create: `packages/membership/src/verify.ts`
- Test: `packages/membership/src/verify.test.ts`
- Modify: `packages/membership/src/index.ts`

**Interfaces:**
- Consumes: `SignedMembershipDocument`, `TrustSet`, `VerifyResult` (Task 1); `canonicalize` (Task 2); `signBytes`/`verifyBytes`, `generateNodeKeyPair` (Task 3); `endorseKey`, `resolveSignerKey` (Task 4).
- Produces:
  - `function signDocumentBody(body: MembershipDocumentBody, signerPrivateKey: string): string` (base64 signature over `canonicalize(body)`)
  - `function verifyMembershipDocument(doc: SignedMembershipDocument, trustSet: TrustSet): VerifyResult`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { generateNodeKeyPair } from "./crypto.js";
import { endorseKey } from "./endorsement.js";
import { signDocumentBody, verifyMembershipDocument } from "./verify.js";
import type { MembershipDocumentBody, SignedMembershipDocument, TrustSet } from "./types.js";

function body(term: number): MembershipDocumentBody {
  return { term, nodes: [{ nodeId: "A", contactUrl: "https://a", standing: "serving-primary" }] };
}
function signed(b: MembershipDocumentBody, signerNodeId: string, priv: string): SignedMembershipDocument {
  return { body: b, signerNodeId, signature: signDocumentBody(b, priv), endorsements: [] };
}

describe("verifyMembershipDocument", () => {
  it("accepts a document signed by a directly-trusted primary", () => {
    const a = generateNodeKeyPair();
    const trust: TrustSet = { A: a.publicKey };
    const r = verifyMembershipDocument(signed(body(1), "A", a.privateKey), trust);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.term).toBe(1);
  });

  it("rejects an unknown signer as untrusted_signer", () => {
    const a = generateNodeKeyPair();
    const r = verifyMembershipDocument(signed(body(1), "A", a.privateKey), {}); // empty trust
    expect(r).toEqual({ valid: false, reason: "untrusted_signer" });
  });

  it("rejects a tampered body as bad_signature", () => {
    const a = generateNodeKeyPair();
    const trust: TrustSet = { A: a.publicKey };
    const doc = signed(body(1), "A", a.privateKey);
    const tampered = { ...doc, body: body(2) }; // signature no longer matches the body
    expect(verifyMembershipDocument(tampered, trust)).toEqual({ valid: false, reason: "bad_signature" });
  });

  it("accepts a document signed by an endorsed key", () => {
    const a = generateNodeKeyPair();
    const b = generateNodeKeyPair();
    const trust: TrustSet = { A: a.publicKey };
    const doc: SignedMembershipDocument = {
      body: body(2),
      signerNodeId: "B",
      signature: signDocumentBody(body(2), b.privateKey),
      endorsements: [endorseKey("B", b.publicKey, "A", a.privateKey)],
    };
    expect(verifyMembershipDocument(doc, trust).valid).toBe(true);
  });

  it("rejects a malformed structure as malformed", () => {
    expect(verifyMembershipDocument({} as unknown as SignedMembershipDocument, {})).toEqual({
      valid: false,
      reason: "malformed",
    });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @waitron/membership test verify`
Expected: FAIL — `verify.js` not defined.

- [ ] **Step 3: Write `src/verify.ts`**

```ts
import { canonicalize } from "./canonicalize.js";
import { signBytes, verifyBytes } from "./crypto.js";
import { resolveSignerKey } from "./endorsement.js";
import type {
  Endorsement,
  MembershipDocumentBody,
  MembershipNode,
  NodeStanding,
  SignedMembershipDocument,
  TrustSet,
  VerifyResult,
} from "./types.js";

const STANDINGS: readonly NodeStanding[] = ["serving-primary", "serving-secondary", "sell-only", "evicted"];

export function signDocumentBody(body: MembershipDocumentBody, signerPrivateKey: string): string {
  return signBytes(bodyMessage(body), signerPrivateKey);
}

/** The exact bytes a document signature covers. */
function bodyMessage(body: MembershipDocumentBody): string {
  return canonicalize(bodyToCanonical(body));
}

function bodyToCanonical(body: MembershipDocumentBody): Record<string, unknown> {
  return {
    term: body.term,
    nodes: body.nodes.map((n) => ({ nodeId: n.nodeId, contactUrl: n.contactUrl, standing: n.standing })),
  };
}

function isNode(v: unknown): v is MembershipNode {
  if (v === null || typeof v !== "object") return false;
  const n = v as Record<string, unknown>;
  return (
    typeof n.nodeId === "string" &&
    typeof n.contactUrl === "string" &&
    typeof n.standing === "string" &&
    STANDINGS.includes(n.standing as NodeStanding)
  );
}

function isEndorsement(v: unknown): v is Endorsement {
  if (v === null || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.nodeId === "string" &&
    typeof e.publicKey === "string" &&
    typeof e.endorsedBy === "string" &&
    typeof e.signature === "string"
  );
}

function isDocument(v: unknown): v is SignedMembershipDocument {
  if (v === null || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  if (typeof d.signerNodeId !== "string" || typeof d.signature !== "string") return false;
  if (!Array.isArray(d.endorsements) || !d.endorsements.every(isEndorsement)) return false;
  const b = d.body as Record<string, unknown> | undefined;
  if (b === undefined || typeof b !== "object" || b === null) return false;
  if (typeof b.term !== "number" || !Number.isInteger(b.term)) return false;
  if (!Array.isArray(b.nodes) || !b.nodes.every(isNode)) return false;
  return true;
}

export function verifyMembershipDocument(doc: SignedMembershipDocument, trustSet: TrustSet): VerifyResult {
  if (!isDocument(doc)) return { valid: false, reason: "malformed" };
  const signerKey = resolveSignerKey(doc.signerNodeId, doc.endorsements, trustSet);
  if (signerKey === null) {
    // Either the signer is unknown, or an endorsement it relied on failed to chain/verify.
    return { valid: false, reason: doc.endorsements.length > 0 ? "endorsement_invalid" : "untrusted_signer" };
  }
  if (!verifyBytes(bodyMessage(doc.body), doc.signature, signerKey)) {
    return { valid: false, reason: "bad_signature" };
  }
  return { valid: true, term: doc.body.term, signerNodeId: doc.signerNodeId, nodes: doc.body.nodes };
}
```

Note: the `untrusted_signer` vs `endorsement_invalid` split keys off whether the document *offered* any endorsements — a document with no endorsements and an unknown signer is `untrusted_signer`; one that offered endorsements that failed to establish trust is `endorsement_invalid`. This matches the spec's two distinct §4 failure modes.

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @waitron/membership test verify`
Expected: PASS.

- [ ] **Step 5: Export and commit**

Add to `src/index.ts`: `export { signDocumentBody, verifyMembershipDocument } from "./verify.js";`
```bash
git add packages/membership/src
git commit -s -m "feat(membership): verifyMembershipDocument (authenticity + endorsement chain)"
```

---

## Task 6: acceptMembershipDocument (the two-part test)

**Files:**
- Create: `packages/membership/src/accept.ts`
- Test: `packages/membership/src/accept.test.ts`
- Modify: `packages/membership/src/index.ts`

**Interfaces:**
- Consumes: `SignedMembershipDocument`, `AcceptResult` (Task 1); `verifyMembershipDocument`, `signDocumentBody` (Task 5).
- Produces: `function acceptMembershipDocument(incoming: SignedMembershipDocument, currentTerm: number | null, trustSet: TrustSet): AcceptResult` — accepts iff the document is authentic AND `incoming.body.term` is strictly greater than `currentTerm` (a `null` current means no prior document held).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { generateNodeKeyPair } from "./crypto.js";
import { signDocumentBody } from "./verify.js";
import { acceptMembershipDocument } from "./accept.js";
import type { MembershipDocumentBody, SignedMembershipDocument, TrustSet } from "./types.js";

function doc(term: number, nodeId: string, priv: string): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term,
    nodes: [{ nodeId: "A", contactUrl: "https://a", standing: "serving-primary" }],
  };
  return { body, signerNodeId: nodeId, signature: signDocumentBody(body, priv), endorsements: [] };
}

describe("acceptMembershipDocument", () => {
  const a = generateNodeKeyPair();
  const trust: TrustSet = { A: a.publicKey };

  it("accepts a valid, strictly-newer document", () => {
    const r = acceptMembershipDocument(doc(2, "A", a.privateKey), 1, trust);
    expect(r.accepted).toBe(true);
  });
  it("accepts a valid document when none is held yet (null current)", () => {
    expect(acceptMembershipDocument(doc(0, "A", a.privateKey), null, trust).accepted).toBe(true);
  });
  it("rejects an equal term as not_newer", () => {
    expect(acceptMembershipDocument(doc(2, "A", a.privateKey), 2, trust)).toEqual({
      accepted: false,
      reason: "not_newer",
    });
  });
  it("rejects a lower term as not_newer", () => {
    expect(acceptMembershipDocument(doc(1, "A", a.privateKey), 2, trust)).toEqual({
      accepted: false,
      reason: "not_newer",
    });
  });
  it("rejects an untrusted document as invalid, carrying the verify failure", () => {
    expect(acceptMembershipDocument(doc(9, "A", a.privateKey), 1, {})).toEqual({
      accepted: false,
      reason: "invalid",
      failure: "untrusted_signer",
    });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @waitron/membership test accept`
Expected: FAIL — `accept.js` not defined.

- [ ] **Step 3: Write `src/accept.ts`**

```ts
import type { AcceptResult, SignedMembershipDocument, TrustSet } from "./types.js";
import { verifyMembershipDocument } from "./verify.js";

/**
 * The two-part membership fence (design §4): a document is adopted only if it is BOTH authentic
 * (signature + trust chain) AND strictly newer than the one currently held. Note the asymmetry the
 * spec relies on (§5): this can only ever raise the held term (accept a demotion/eviction); it never
 * grants authority. `currentTerm === null` means nothing is held yet.
 */
export function acceptMembershipDocument(
  incoming: SignedMembershipDocument,
  currentTerm: number | null,
  trustSet: TrustSet,
): AcceptResult {
  const verified = verifyMembershipDocument(incoming, trustSet);
  if (!verified.valid) return { accepted: false, reason: "invalid", failure: verified.reason };
  if (currentTerm !== null && verified.term <= currentTerm) return { accepted: false, reason: "not_newer" };
  return { accepted: true, document: incoming };
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @waitron/membership test accept`
Expected: PASS.

- [ ] **Step 5: Export and commit**

Add to `src/index.ts`: `export { acceptMembershipDocument } from "./accept.js";`
```bash
git add packages/membership/src
git commit -s -m "feat(membership): acceptMembershipDocument two-part fence"
```

---

## Task 7: End-to-end integration + coverage

**Files:**
- Create: `packages/membership/src/integration.test.ts`

**Interfaces:**
- Consumes: the whole public barrel.
- Produces: nothing (capstone test only).

- [ ] **Step 1: Write the end-to-end test**

```ts
import { describe, expect, it } from "vitest";
import {
  acceptMembershipDocument,
  endorseKey,
  generateNodeKeyPair,
  signDocumentBody,
  type MembershipDocumentBody,
  type SignedMembershipDocument,
  type TrustSet,
} from "./index.js";

function build(term: number, signerNodeId: string, priv: string, endorsements: SignedMembershipDocument["endorsements"] = []): SignedMembershipDocument {
  const body: MembershipDocumentBody = {
    term,
    nodes: [
      { nodeId: "server-1", contactUrl: "https://s1", standing: "serving-secondary" },
      { nodeId: "server-2", contactUrl: "https://s2", standing: "serving-primary" },
    ],
  };
  return { body, signerNodeId, signature: signDocumentBody(body, priv), endorsements };
}

describe("membership end-to-end", () => {
  it("promotes across a failover, rejects a replay, and rejects a forgery", () => {
    // Setup: server-1 is the original primary, its key trusted by everyone.
    const s1 = generateNodeKeyPair();
    const s2 = generateNodeKeyPair();
    const trust: TrustSet = { "server-1": s1.publicKey };

    // term 0: server-1 issues the setup document, endorsing server-2's key into the trust set.
    const setupDoc = build(0, "server-1", s1.privateKey, [endorseKey("server-2", s2.publicKey, "server-1", s1.privateKey)]);
    const atSetup = acceptMembershipDocument(setupDoc, null, trust);
    expect(atSetup.accepted).toBe(true);

    // Failover: server-2 is promoted and issues term 1, signed by its own (now-endorsed) key.
    const promoteDoc = build(1, "server-2", s2.privateKey, [endorseKey("server-2", s2.publicKey, "server-1", s1.privateKey)]);
    const afterPromote = acceptMembershipDocument(promoteDoc, 0, trust);
    expect(afterPromote.accepted).toBe(true);

    // A returning server-1 replays its old term-0 document — rejected as not newer.
    expect(acceptMembershipDocument(setupDoc, 1, trust)).toEqual({ accepted: false, reason: "not_newer" });

    // A rogue node forges a higher term with a key nobody trusts — rejected as invalid.
    const rogue = generateNodeKeyPair();
    const forged = build(9, "rogue", rogue.privateKey);
    expect(acceptMembershipDocument(forged, 1, trust)).toEqual({ accepted: false, reason: "invalid", failure: "untrusted_signer" });
  });
});
```

- [ ] **Step 2: Run test, verify it passes**

Run: `pnpm --filter @waitron/membership test integration`
Expected: PASS.

- [ ] **Step 3: Full package coverage gate**

Run: `pnpm --filter @waitron/membership test:coverage`
Expected: PASS, all four thresholds ≥ (98/98/98/95). If a branch is uncovered, add the missing negative-control test rather than lowering the threshold.

- [ ] **Step 4: Commit**

```bash
git add packages/membership/src
git commit -s -m "test(membership): end-to-end failover, replay, and forgery"
```

---

## Self-review notes (author)

- **Spec coverage:** §3 document shape → Task 1 types; canonical/`term` → Tasks 2, 5; §4 node identity keys + sign/verify → Task 3; endorsement chain from setup → Task 4; two-part accept test (authentic + newer) → Tasks 5–6; the demote-never-promote asymmetry is a *consumer* concern (a node only ever calls accept with its own held term) and is documented on `acceptMembershipDocument`, enforced by callers in later slices. §5 distribution, §6 rejoin, §7 conflict resolution, storage, promotion, adopt — **out of scope for Slice 1** (later plans).
- **Type consistency:** `TrustSet`, `VerifyResult`, `AcceptResult`, `SignedMembershipDocument`, `Endorsement` are defined once in Task 1 and consumed by name thereafter. `signDocumentBody` (Task 5) is the single signer used by Tasks 6–7 tests.
- **No placeholders:** every step carries real test + implementation code.
- **CI-list trap (CLAUDE.md §2):** Task 1 Step 7–8 add the package to `LIGHT_A_PACKAGES` + the mirror `ci.yml` subtraction + `GENERIC_PACKAGES` + its test pin, and Step 8 runs `ci-workflow.test.mjs` and `english-only.test.ts` to prove the lists agree. Before opening the PR, run the whole workspace (`pnpm -r test:coverage` scope permitting) so no other pinned list went stale.
