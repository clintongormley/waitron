# Onboarding Slice 2a: Secrets + self-signed cert — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On its first boot in **setup mode**, an unprovisioned box mints its own private **CA + `waitron.local`/IP server certificate**, writes the PEMs to a persisted **state directory**, serves the setup surface over **HTTPS** from that certificate, and generates + persists the two box-owned secrets it will need later — the **vault master key** (`WAITRON_CREDENTIALS_KEY`) and the **sync node token** — all idempotently, so a restart reuses everything.

**Architecture:** A pure `mintSelfSignedServerCert` (productised from the test-only `apps/server/src/testing/tls.ts`) mints a CA + leaf via `node-forge`. A `box-secrets.ts` orchestrator owns a state directory: mint-the-cert-if-absent, generate-the-secrets-if-absent, write files (private keys `0600`), and hand back the TLS file paths — **idempotent**, never regenerating. Boot's **setup branch** (slice 1b) calls it and serves HTTPS from the returned paths, unless the operator supplied their own `WAITRON_TLS_*` pair (that wins). The **trading branch is untouched.**

**Tech Stack:** TypeScript (Node ≥24), Hono 4.x + `@hono/node-server` (its TLS path via `buildServeOptions`), `node-forge` (moved to a runtime dependency), Vitest, Testcontainers (real-Postgres full-boot tests via `@waitron/db/testing/lifecycle`).

**Spec:** [docs/superpowers/specs/2026-08-26-appliance-onboarding-design.md](../specs/2026-08-26-appliance-onboarding-design.md) (§5 setup mode, §8 HTTPS & certificates, §9 secrets — generate/persist/custody). This is the first of the spec's **slice 2** three-way split (2a secrets+cert · 2b provisioning endpoints · 2c the `apps/setup` wizard), recorded in the design's §16 decomposition note. Slices **1a (#137) and 1b (#139)** are already on `main`.

## What this slice is NOT (defer to 2b / 2c / later)

- **No provisioning.** The wizard endpoints that call `planInstance`/`planVenue` in-process, the demo/live fork, and the AEAT-cert-upload step are **slice 2b**. This slice serves the *same* placeholder + `/setup-api/status` slice 1b already serves — only now over HTTPS.
- **No wizard UI.** The `apps/setup` SPA is **slice 2c**.
- **No trust UX, no mDNS, no IP-QR.** The CA-download page, per-platform trust instructions, the trusted-device check, and `waitron.local` Avahi advertisement are **slice 3**. This slice mints a cert whose SANs *include* `waitron.local` and the box's LAN IPs, but does nothing to advertise the name or guide trusting the CA — a browser will show the usual self-signed warning, which is expected here.
- **No HTTP→HTTPS :80 redirect, no privileged-port binding.** The appliance's `80→443` redirect and `CAP_NET_BIND_SERVICE` are the OS/appliance slices (5–6). This slice serves HTTPS on the one configured `WAITRON_HTTP_PORT` (8080 in dev).
- **No leaf renewal / rotation.** The minted leaf is long-lived (~10 years). Auto-renewal and re-issuing a leaf when the box's IP changes are later work; 2a mints once and reuses.
- **No boot-unlock / FDE / passphrase (§9 custody).** Those are OS-image concerns. 2a writes the secrets to a `0600` file in the state directory and relies on the deployment placing that directory on a protected volume; it does not implement disk encryption.

## Global Constraints

- **Node ≥ 24; pnpm 9.15.0.** TDD: failing test first → red → minimal impl → green → commit. Prove guards by deletion.
- **Coverage — all changes are in `apps/server` (98/98/98/95).** Run `pnpm --filter @waitron/server test:coverage`. Container full-boot tests need `TESTCONTAINERS_RYUK_DISABLED=true` locally.
- **The trading (provisioned) boot path MUST be behaviourally unchanged** (CLAUDE.md §5: nothing blocks a sale). 2a only adds to the **setup** branch and adds one config field + one default-root argument; the trading branch's code is untouched. A full-boot trading test must still prove `/api/*`, `/health` and the SPAs behave exactly as before.
- **`node-forge` moves from `devDependencies` to `dependencies`** in `apps/server/package.json` (it is imported from `src/` now, not only test code). Run `pnpm install` and **commit the lockfile** — a dependency-section move fails CI's `--frozen-lockfile` install otherwise (CLAUDE.md §2).
- **Never build a utility statement by unescaped concatenation** (CLAUDE.md §3). No SQL here, but the same rule governs the cert: SANs and the state-dir path are validated/normalised, never trusted raw. The state directory is resolved to an absolute path (`resolve`) exactly as `mediaDir` is, and secret files are written under it with an explicit `0600` mode, never a default umask.
- **An empty value is a valid value** (CLAUDE.md §3): `WAITRON_STATE_DIR` follows the `isUnset` rule every other optional path variable in `config.ts` follows — absent OR empty → the computed default, never `resolve("")` (which is cwd).
- **No new error codes** unless genuinely needed. A file that throws a code imports `./errors.js`. Reuse `server.config_invalid { variable, reason }` for a bad `WAITRON_STATE_DIR`.
- **Error codes name the domain concept** (CLAUDE.md §3): if the cert/secrets orchestrator must throw, the code names the concept (e.g. `setup.*` or the existing `server.*`), never the throwing file.

---

## Task 1: `mintSelfSignedServerCert` — the productised CA+leaf minter

Productise the cert-construction helpers currently living **only** in the test file `apps/server/src/testing/tls.ts` (which mints a CA + `localhost` server cert + a *client* cert for the mTLS suite) into a reusable **server-cert** minter that takes explicit hostnames + IPs and a clock. The test file is left as-is (it mints a client cert too, for mTLS — a different shape); this task adds a new, separate module.

**Files:**
- Create: `apps/server/src/self-signed-cert.ts`
- Test: `apps/server/src/self-signed-cert.test.ts`
- Modify: `apps/server/package.json` (move `node-forge` to `dependencies`)
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**
- Consumes: `node-forge` (`forge.pki`).
- Produces:
  ```ts
  export interface SelfSignedMaterial {
    caCertPem: string;
    caKeyPem: string;
    serverCertPem: string;
    serverKeyPem: string;
  }
  export interface MintOptions {
    /** dNSName SANs on the leaf, e.g. ["waitron.local", "localhost"]. At least one required. */
    hostnames: string[];
    /** iPAddress SANs on the leaf, e.g. ["127.0.0.1", "192.168.1.50"]. May be empty. */
    ipAddresses: string[];
    /** Clock, injected so the validity window is deterministic in tests. */
    now: Date;
    /** Keypair factory, injected so a test can reuse one keypair instead of paying RSA-2048
     * generation twice per mint. Defaults to `forge.pki.rsa.generateKeyPair(2048)`. */
    keypair?: () => forge.pki.rsa.KeyPair;
  }
  export function mintSelfSignedServerCert(opts: MintOptions): SelfSignedMaterial;
  ```
  Behaviour: mints a CA (basicConstraints `cA:true`, keyUsage `keyCertSign,cRLSign,digitalSignature`), then a leaf signed by that CA (basicConstraints `cA:false`, keyUsage `digitalSignature,keyEncipherment`, extKeyUsage `serverAuth`, subjectAltName = the hostnames as dNSName + the IPs as iPAddress). Leaf CN = `hostnames[0]`. Validity: `notBefore = now − 1 day` (clock-skew slack), `notAfter = now + 3650 days`. Distinct serials (CA `01`, leaf `02`). Throws `AppError("setup.cert_hostnames_empty", {})` if `hostnames` is empty (a leaf with no dNSName is useless; register the code in `errors.ts`).

  > **Corrected 2026-08-27 (Copilot review round 2):** the minter uses **cryptographically-random positive serials** (`randomBytes(16)`, high bit cleared) per cert, **not** the fixed `01`/`02` this line planned. Fixed serials would collide if the retained CA ever re-signs a rotated leaf — exactly the future re-issue this slice keeps the CA key for — so per-issuer serial uniqueness is generated, not hardcoded. The tests assert serial *distinctness*, not specific values.

- [ ] **Step 1: Move `node-forge` to a runtime dependency + reinstall.** In `apps/server/package.json` move `"node-forge": "^1.3.1"` from `devDependencies` to `dependencies` (leave `@types/node-forge` in `devDependencies`). Then from the repo root: `pnpm install` and stage `pnpm-lock.yaml`. Verify: `pnpm --filter @waitron/server exec node -e "require.resolve('node-forge')"` prints a path (proves it resolves as a prod dep).

- [ ] **Step 2: Write the failing tests** in `self-signed-cert.test.ts`. Generate ONE keypair up front and inject it into every mint so the suite pays keygen once, not per-case:

```ts
import { X509Certificate, createServer as createHttpsServer } from "node:https"; // X509Certificate from node:crypto
import { connect as tlsConnect } from "node:tls";
import forge from "node-forge";
import { describe, it, expect, beforeAll } from "vitest";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

let sharedKeypair: forge.pki.rsa.KeyPair;
beforeAll(() => { sharedKeypair = forge.pki.rsa.generateKeyPair(2048); });
const mint = (over = {}) => mintSelfSignedServerCert({
  hostnames: ["waitron.local", "localhost"],
  ipAddresses: ["127.0.0.1"],
  now: new Date("2026-08-26T00:00:00Z"),
  keypair: () => sharedKeypair,
  ...over,
});

it("mints a leaf carrying every requested hostname and IP as a SAN", () => {
  const { serverCertPem } = mint();
  const cert = new (require("node:crypto").X509Certificate)(serverCertPem);
  // subjectAltName is a comma-joined string like "DNS:waitron.local, DNS:localhost, IP Address:127.0.0.1"
  expect(cert.subjectAltName).toContain("DNS:waitron.local");
  expect(cert.subjectAltName).toContain("DNS:localhost");
  expect(cert.subjectAltName).toContain("127.0.0.1");
});

it("signs the leaf with the CA (leaf issuer == CA subject)", () => {
  const { caCertPem, serverCertPem } = mint();
  const ca = forge.pki.certificateFromPem(caCertPem);
  const leaf = forge.pki.certificateFromPem(serverCertPem);
  expect(leaf.issuer.getField("CN").value).toBe(ca.subject.getField("CN").value);
  // and the CA's public key actually verifies the leaf's signature:
  expect(ca.verify(leaf)).toBe(true);
});

it("sets a ~10-year validity window starting a day before `now`", () => {
  const now = new Date("2026-08-26T00:00:00Z");
  const { serverCertPem } = mint({ now });
  const leaf = forge.pki.certificateFromPem(serverCertPem);
  expect(leaf.validity.notBefore.getTime()).toBeLessThan(now.getTime());
  const years = (leaf.validity.notAfter.getTime() - now.getTime()) / (365 * 24 * 3600 * 1000);
  expect(years).toBeGreaterThan(9);
});

it("throws when no hostname is given", () => {
  expect(() => mint({ hostnames: [] })).toThrow(/cert_hostnames_empty/);
});

// The property that actually matters: the minted material completes a real TLS handshake
// when the client trusts the CA, and fails when it does not.
it("serves a TLS handshake a CA-trusting client accepts and an untrusting one rejects", async () => {
  const { caCertPem, serverCertPem, serverKeyPem } = mint();
  const server = createHttpsServer({ key: serverKeyPem, cert: serverCertPem }, (_req, res) => res.end("ok"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as import("node:net").AddressInfo;
  try {
    // trusting the CA + dialing a SAN (127.0.0.1) → handshake authorized
    const okSocket = tlsConnect({ port, host: "127.0.0.1", ca: caCertPem, servername: "localhost" });
    await new Promise<void>((res, rej) => { okSocket.on("secureConnect", res); okSocket.on("error", rej); });
    expect(okSocket.authorized).toBe(true);
    okSocket.destroy();
    // NOT trusting the CA → rejected
    const badSocket = tlsConnect({ port, host: "127.0.0.1", servername: "localhost" }); // no `ca`
    await new Promise<void>((res) => { badSocket.on("error", () => res()); badSocket.on("secureConnect", () => res()); });
    expect(badSocket.authorized).toBe(false);
    badSocket.destroy();
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
```

(Tidy the `require` usage to a top `import { X509Certificate } from "node:crypto"` — shown inline above only to be explicit about the source.)

- [ ] **Step 3: Run — FAIL** (`self-signed-cert.js` does not exist). `pnpm --filter @waitron/server test self-signed-cert`.

- [ ] **Step 4: Implement `self-signed-cert.ts`.** Mirror `testing/tls.ts`'s `CertExtension` stand-in type and its `certificate()`/`keypair()` helpers, but parameterise subject/validity/SANs and split the returned material into CA + server only (no client cert, no PKCS#12). Register `setup.cert_hostnames_empty` in `apps/server/src/errors.ts` and `import "./errors.js"`. Key points:
  - `keypair` defaults to `() => forge.pki.rsa.generateKeyPair(2048)`; call it **twice** (CA, leaf) — a test injecting a shared keypair is fine, the two certs differ by subject/extensions/issuer regardless of sharing a key.
  - Build SAN `altNames`: `hostnames.map(h => ({ type: 2, value: h }))` concat `ipAddresses.map(ip => ({ type: 7, ip }))` (type 2 = dNSName, 7 = iPAddress, per `testing/tls.ts`).
  - `notBefore = new Date(now.getTime() - 86_400_000)`, `notAfter = new Date(now.getTime() + 3650 * 86_400_000)`.

- [ ] **Step 5: Run — PASS.** `pnpm --filter @waitron/server test self-signed-cert`.

- [ ] **Step 6: Prove the SAN guard by deletion.** Temporarily drop the `type: 7` IP branch; confirm the SAN test fails on the missing `127.0.0.1`; restore. Note it in the commit body.

- [ ] **Step 7: Coverage + commit.** `pnpm --filter @waitron/server test:coverage` clears 98/98/98/95 (the new module is fully exercised). Commit `-s`: `feat(server): mintSelfSignedServerCert — a reusable CA+leaf server-cert minter`.

---

## Task 2: `WAITRON_STATE_DIR` config + `DEFAULT_STATE_ROOT`

Add the persisted state directory to config, exactly as `mediaDir` is threaded — an env override with a boot-computed default — plus a `.gitignore` so the dev default (which holds secrets) is never committed.

**Files:**
- Modify: `apps/server/src/config.ts` (add `stateDir` to `ServerConfig`, a `defaultStateRoot` parameter to `loadConfig`)
- Modify: `apps/server/src/boot.ts` (add `DEFAULT_STATE_ROOT`, pass it to `loadConfig`)
- Modify: `.gitignore` (ignore the dev state dir)
- Test: `apps/server/src/config.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ServerConfig.stateDir: string` (always present — absolute, resolved). `loadConfig(env, defaultMigrationsRoot, defaultMediaRoot, defaultStateRoot)` (a 4th positional arg). `export const DEFAULT_STATE_ROOT` in `boot.ts` (computed like `DEFAULT_MEDIA_ROOT`).

- [ ] **Step 1: Write the failing tests** in `config.test.ts` (match the existing `mediaDir` cases):

```ts
it("defaults stateDir to the supplied default root when WAITRON_STATE_DIR is unset", () => {
  const cfg = loadConfig(baseEnv(), "/mig", "/media", "/default/state");
  expect(cfg.stateDir).toBe("/default/state");
});
it("resolves WAITRON_STATE_DIR to an absolute path when set", () => {
  const cfg = loadConfig({ ...baseEnv(), WAITRON_STATE_DIR: "some/state" }, "/mig", "/media", "/default/state");
  expect(cfg.stateDir).toBe(resolve("some/state"));
});
it("treats an empty WAITRON_STATE_DIR as unset (never resolve(''))", () => {
  const cfg = loadConfig({ ...baseEnv(), WAITRON_STATE_DIR: "" }, "/mig", "/media", "/default/state");
  expect(cfg.stateDir).toBe("/default/state");
});
```

(`baseEnv()` = whatever minimal valid env the suite already builds, with `DATABASE_URL` set. Update the existing `loadConfig(...)` call sites in `config.test.ts` to pass the 4th arg.)

- [ ] **Step 2: Run — FAIL** (`loadConfig` takes 3 args; `stateDir` undefined).

- [ ] **Step 3: Implement.** In `config.ts`: add `stateDir: string;` to `ServerConfig` (document it: "the persisted directory the box owns its self-signed cert PEMs and generated secrets under — resolved absolute like `mediaDir`; `WAITRON_STATE_DIR` overrides the boot default; deployment sets it to a durable, protected path e.g. `/var/lib/waitron`"). Add the `defaultStateRoot: string` parameter to `loadConfig` (after `defaultMediaRoot`). In the return object add:
  ```ts
  // Same isUnset fallback + resolve-only-a-real-value shape mediaDir uses (CLAUDE.md §3).
  stateDir: isUnset(env.WAITRON_STATE_DIR) ? defaultStateRoot : resolve(env.WAITRON_STATE_DIR),
  ```

- [ ] **Step 4: Add `DEFAULT_STATE_ROOT` in `boot.ts`** beside `DEFAULT_MEDIA_ROOT`, with the same header-comment reasoning:
  ```ts
  export const DEFAULT_STATE_ROOT = fileURLToPath(new URL("state", import.meta.url));
  ```
  and pass it as the 4th arg at the `loadConfig(env, DEFAULT_MIGRATIONS_ROOT, DEFAULT_MEDIA_ROOT, DEFAULT_STATE_ROOT)` call site (`boot.ts:333`).

- [ ] **Step 5: gitignore the dev state dir.** Append to `.gitignore`:
  ```
  # The box's self-signed cert + generated secrets, materialised on first setup boot.
  # The dev default is apps/server/src/state (from-source) / apps/server/dist/state (built, already
  # covered by dist/). Never commit secrets. Deployment sets WAITRON_STATE_DIR to a protected path.
  apps/server/src/state/
  ```

- [ ] **Step 6: Run — PASS** (config.test.ts). Fix any other `loadConfig` call sites the compiler flags (`boot.ts` and any script) to pass the 4th arg. `pnpm --filter @waitron/server typecheck` clean.

- [ ] **Step 7: Coverage + commit.** `pnpm --filter @waitron/server test:coverage` clears thresholds. Commit `-s`: `feat(server): WAITRON_STATE_DIR config for the box's persisted secrets`.

---

## Task 3: `ensureBoxSecrets` — the idempotent state-dir orchestrator

The heart of the slice: given a state directory, materialise the cert + secrets **once** and reuse them forever after. Pure IO orchestration around Task 1's minter + `generateKeyRing`; every side effect is injected so the unit test runs without touching a real clock or entropy, and a real-fs test proves file permissions and idempotency.

**Files:**
- Create: `apps/server/src/box-secrets.ts`
- Test: `apps/server/src/box-secrets.test.ts`

**Interfaces:**
- Consumes: `mintSelfSignedServerCert` (Task 1); `generateKeyRing` from `@waitron/provisioning`; `node:fs/promises`, `node:crypto` (`randomBytes`), `node:os` (`networkInterfaces`).
- Produces:
  ```ts
  export interface BoxTlsFiles { certFile: string; keyFile: string; caCertFile: string; }
  export interface EnsureBoxSecretsDeps {
    stateDir: string;
    /** dNSName SANs beyond the box IPs — defaults handled by the caller (boot passes
     * ["waitron.local", "localhost"]). */
    hostnames: string[];
    now: () => Date;
    // Injectables (all default to the real implementations):
    mint?: typeof mintSelfSignedServerCert;
    makeKeyRing?: () => { key: string; version: number };      // default generateKeyRing
    makeToken?: () => string;                                   // default randomBytes(32).toString("hex")
    listIpv4?: () => string[];                                  // default: non-internal IPv4s from os
  }
  export async function ensureBoxSecrets(deps: EnsureBoxSecretsDeps): Promise<BoxTlsFiles>;
  ```
  State-dir layout it writes/reads:
  ```
  <stateDir>/tls/ca.crt          <stateDir>/tls/ca.key   (0600)
  <stateDir>/tls/server.crt      <stateDir>/tls/server.key (0600)
  <stateDir>/secrets.env         (0600)   # KEY=VALUE, LF-terminated
  ```
  `secrets.env` holds `WAITRON_CREDENTIALS_KEY`, `WAITRON_CREDENTIALS_KEY_VERSION`, `WAITRON_SYNC_NODE_TOKEN`. Behaviour: `mkdir -p <stateDir>/tls`; if `server.key` is absent, mint (SANs = `hostnames` + `listIpv4()`, always including `127.0.0.1`) and write all four PEMs (keys `mode: 0o600`); if `secrets.env` is absent, generate the key ring + token and write it (`mode: 0o600`); **presence = reuse, never regenerate** (test the tell: two calls, same bytes). Returns the three TLS file paths. Does **not** load or consume the secrets — that is 2b/trading's job on the next boot.

- [ ] **Step 1: Write the failing unit tests** in `box-secrets.test.ts`, using a real temp dir (`mkdtemp`) so the file/permission behaviour is genuinely exercised, but injecting a fast `mint` (one shared keypair) and deterministic `makeKeyRing`/`makeToken`/`listIpv4`:

```ts
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { ensureBoxSecrets } from "./box-secrets.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

let kp: forge.pki.rsa.KeyPair;
beforeAll(() => { kp = forge.pki.rsa.generateKeyPair(2048); });
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
const newDir = async () => { const d = await mkdtemp(join(tmpdir(), "boxsecrets-")); dirs.push(d); return d; };

const deps = (stateDir: string) => ({
  stateDir,
  hostnames: ["waitron.local", "localhost"],
  now: () => new Date("2026-08-26T00:00:00Z"),
  mint: (o: Parameters<typeof mintSelfSignedServerCert>[0]) =>
    mintSelfSignedServerCert({ ...o, keypair: () => kp }),
  makeKeyRing: () => ({ key: "A".repeat(43) + "=", version: 1 }), // shape only; boot uses the real one
  makeToken: () => "deadbeef".repeat(8),
  listIpv4: () => ["192.168.1.50"],
});

it("materialises the cert + secrets on first call and returns the TLS paths", async () => {
  const d = await newDir();
  const tls = await ensureBoxSecrets(deps(d));
  expect(tls.certFile).toBe(join(d, "tls", "server.crt"));
  expect(tls.keyFile).toBe(join(d, "tls", "server.key"));
  expect(tls.caCertFile).toBe(join(d, "tls", "ca.crt"));
  // secrets.env holds all three names
  const env = await readFile(join(d, "secrets.env"), "utf8");
  expect(env).toMatch(/^WAITRON_CREDENTIALS_KEY=/m);
  expect(env).toMatch(/^WAITRON_CREDENTIALS_KEY_VERSION=1$/m);
  expect(env).toMatch(/^WAITRON_SYNC_NODE_TOKEN=deadbeef/m);
});

it("writes private keys and the secrets file 0600", async () => {
  const d = await newDir();
  await ensureBoxSecrets(deps(d));
  for (const f of ["tls/server.key", "tls/ca.key", "secrets.env"]) {
    const mode = (await stat(join(d, f))).mode & 0o777;
    expect(mode).toBe(0o600);
  }
});

it("is idempotent: a second call reuses the exact same bytes (never regenerates)", async () => {
  const d = await newDir();
  await ensureBoxSecrets(deps(d));
  const before = await readFile(join(d, "tls", "server.crt"), "utf8");
  const beforeEnv = await readFile(join(d, "secrets.env"), "utf8");
  await ensureBoxSecrets(deps(d)); // second boot
  expect(await readFile(join(d, "tls", "server.crt"), "utf8")).toBe(before);
  expect(await readFile(join(d, "secrets.env"), "utf8")).toBe(beforeEnv);
});

it("puts 127.0.0.1 and the detected LAN IP into the leaf SANs", async () => {
  const d = await newDir();
  await ensureBoxSecrets(deps(d));
  const { X509Certificate } = await import("node:crypto");
  const cert = new X509Certificate(await readFile(join(d, "tls", "server.crt"), "utf8"));
  expect(cert.subjectAltName).toContain("127.0.0.1");
  expect(cert.subjectAltName).toContain("192.168.1.50");
  expect(cert.subjectAltName).toContain("DNS:waitron.local");
});
```

- [ ] **Step 2: Run — FAIL** (`box-secrets.js` missing).

- [ ] **Step 3: Implement `box-secrets.ts`.** Sketch:
  ```ts
  import { mkdir, writeFile, readFile, access } from "node:fs/promises";
  import { randomBytes } from "node:crypto";
  import { networkInterfaces } from "node:os";
  import { join } from "node:path";
  import { generateKeyRing } from "@waitron/provisioning";
  import { mintSelfSignedServerCert } from "./self-signed-cert.js";

  const exists = (p: string) => access(p).then(() => true, () => false);
  const defaultListIpv4 = (): string[] =>
    Object.values(networkInterfaces()).flat()
      .filter((n): n is NonNullable<typeof n> => !!n && n.family === "IPv4" && !n.internal)
      .map((n) => n.address);

  export async function ensureBoxSecrets(deps: EnsureBoxSecretsDeps): Promise<BoxTlsFiles> {
    const mint = deps.mint ?? mintSelfSignedServerCert;
    const makeKeyRing = deps.makeKeyRing ?? generateKeyRing;
    const makeToken = deps.makeToken ?? (() => randomBytes(32).toString("hex"));
    const listIpv4 = deps.listIpv4 ?? defaultListIpv4;
    const tlsDir = join(deps.stateDir, "tls");
    await mkdir(tlsDir, { recursive: true });
    const files = {
      certFile: join(tlsDir, "server.crt"), keyFile: join(tlsDir, "server.key"),
      caCertFile: join(tlsDir, "ca.crt"), caKeyFile: join(tlsDir, "ca.key"),
    };
    if (!(await exists(files.keyFile))) {
      const ips = Array.from(new Set(["127.0.0.1", ...listIpv4()]));
      const m = mint({ hostnames: deps.hostnames, ipAddresses: ips, now: deps.now() });
      await writeFile(files.caCertFile, m.caCertPem);
      await writeFile(files.caKeyFile, m.caKeyPem, { mode: 0o600 });
      await writeFile(files.certFile, m.serverCertPem);
      await writeFile(files.keyFile, m.serverKeyPem, { mode: 0o600 });
    }
    const secretsFile = join(deps.stateDir, "secrets.env");
    if (!(await exists(secretsFile))) {
      const ring = makeKeyRing();
      const token = makeToken();
      const body =
        `WAITRON_CREDENTIALS_KEY=${ring.key}\n` +
        `WAITRON_CREDENTIALS_KEY_VERSION=${ring.version}\n` +
        `WAITRON_SYNC_NODE_TOKEN=${token}\n`;
      await writeFile(secretsFile, body, { mode: 0o600 });
    }
    return { certFile: files.certFile, keyFile: files.keyFile, caCertFile: files.caCertFile };
  }
  ```
  **Note on the `mode` option + umask:** `writeFile(..., { mode: 0o600 })` sets the mode only when the file is *created*, and the effective mode is `mode & ~umask`. `0o600 & ~umask` is `0o600` for any sane umask (022/002/077), so the test's `=== 0o600` holds; document this in a comment so a reviewer does not "fix" it to a chmod.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Prove idempotency by deletion.** Temporarily make the `if (!(await exists(files.keyFile)))` always-true (regenerate every call); confirm the idempotency test fails (`server.crt` bytes differ); restore. Note it in the commit body.

- [ ] **Step 6: Coverage + commit.** `pnpm --filter @waitron/server test:coverage` clears thresholds. Commit `-s`: `feat(server): ensureBoxSecrets — idempotent state-dir cert + secret materialisation`.

---

## Task 4: Serve HTTPS from the minted cert in setup-mode boot

Wire Task 3 into the setup branch: mint-or-reuse the box cert, then serve the existing setup surface over HTTPS from it — unless the operator supplied their own `WAITRON_TLS_*` pair, which wins.

**Files:**
- Modify: `apps/server/src/boot.ts` (setup branch only)
- Test: `apps/server/src/boot.test.ts` (extend the setup-mode + trading-mode full-boot cases)

**Interfaces:**
- Consumes: `ensureBoxSecrets` (Task 3), `config.stateDir` + `config.tls` (Task 2 / existing).
- Produces: setup mode serves HTTPS; the operator-TLS-override branch; the trading path unchanged.

- [ ] **Step 1: Write the failing full-boot tests** in `boot.test.ts`. The existing slice-1b setup-mode test dials `http://…/setup-api/status`; it must now dial **HTTPS** trusting the minted CA. Read `ca.crt` from the state dir and pass it via an undici `Agent`:

```ts
import { Agent } from "undici";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("setup mode serves the setup surface over HTTPS from a self-signed cert", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "boot-setup-"));
  const server = await startServer(setupModeEnv(dbUrl, { WAITRON_STATE_DIR: stateDir }));
  try {
    const ca = await readFile(join(stateDir, "tls", "ca.crt"));
    const dispatcher = new Agent({ connect: { ca } });
    const status = await fetch(`https://127.0.0.1:${port}/setup-api/status`, { dispatcher } as any);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ provisioned: false });
    // the CA + secrets were persisted:
    expect((await readFile(join(stateDir, "secrets.env"), "utf8"))).toMatch(/WAITRON_CREDENTIALS_KEY=/);
    // a plain-HTTP dial to the same port fails (it is HTTPS now):
    await expect(fetch(`http://127.0.0.1:${port}/setup-api/status`)).rejects.toBeTruthy();
  } finally {
    await server.close();
    await rm(stateDir, { recursive: true, force: true });
  }
});

it("setup mode honours an operator-supplied WAITRON_TLS_* pair over minting its own", async () => {
  // point WAITRON_TLS_CERT_FILE/_KEY_FILE at a pre-minted pair on disk; assert the state dir's
  // tls/server.crt was NOT created (operator cert wins), and HTTPS still serves.
});
```

(Reuse the suite's `setupModeEnv` helper from slice 1b; extend it to accept overrides so `WAITRON_STATE_DIR` and the operator-TLS vars can be injected. `port` = the fixed test port `setupModeEnv` sets. If binding TLS with an ephemeral port is easier, read the bound port from the `server.listening` log as the trading test already does.)

- [ ] **Step 2: Run — the HTTPS setup test FAILS** (setup mode serves plain HTTP today; the `https://` fetch fails to connect / the `http://` one succeeds).

- [ ] **Step 3: Implement the setup-branch wiring.** In `boot.ts`, `DEFAULT_STATE_ROOT` is already added (Task 2). Change the setup branch (`boot.ts:394-411`) so it materialises + serves the cert:

```ts
if (config.till === undefined) {
  // SETUP MODE (slice 1b) — unchanged: /health + the unauthenticated setup surface, no key ring, no
  // trading routes/workers. NEW in 2a: the box serves this surface over HTTPS from its own
  // self-signed cert, minted + persisted on first boot (ensureBoxSecrets). An operator who supplied
  // their own WAITRON_TLS_* pair keeps it — config.tls wins; otherwise we mint into the state dir.
  mountSetup(app, { environment: config.environment }, log);
  const tls =
    config.tls ??
    (await ensureBoxSecrets({
      stateDir: config.stateDir,
      hostnames: ["waitron.local", "localhost"],
      now,
    }));
  const server = startListening({ ...config, tls }, app, now, log);
  return makeStartedServer(server, health, log, {
    stopWork: () => Promise.resolve(),
    closePools: () => db.close(),
  });
}
```

`ensureBoxSecrets` returns `BoxTlsFiles` (`{ certFile, keyFile, caCertFile }`), and `config.tls`/`startListening` want `{ certFile, keyFile }` — the extra `caCertFile` is a structural superset, so `{ ...config, tls }` typechecks (or narrow explicitly: `tls: config.tls ?? { certFile: ensured.certFile, keyFile: ensured.keyFile }`). `now` is the existing `() => new Date()` in scope.

- [ ] **Step 4: Run — both setup tests PASS.** Then **prove the operator-override by deletion**: force the branch to always mint (ignore `config.tls`), confirm the override test fails (the state-dir cert gets created despite an operator cert), restore.

- [ ] **Step 5: Trading-mode regression.** Confirm the existing trading-mode full-boot test still passes unchanged (it sets no `WAITRON_STATE_DIR`, reaches the `else` branch, never calls `ensureBoxSecrets`). If the trading test set an ephemeral/fixed port and asserted `http://`, it is untouched — the trading branch's serve path is byte-for-byte as before (this task edits only the setup branch).

- [ ] **Step 6: Coverage + commit.** `pnpm --filter @waitron/server test:coverage` clears 98/98/98/95, `boot.ts` branch coverage intact (setup-HTTPS, operator-override, and trading branches all exercised). Commit `-s`: `feat(server): serve setup mode over a self-signed HTTPS cert (onboarding slice 2a)`.

---

## Task 5: `dev:onboard` over HTTPS + design-spec decomposition note

Make the local onboarding-dev flow work over HTTPS, and record the slice-2 decomposition in the design spec.

**Files:**
- Modify: `apps/server/scripts/dev-onboard.ts` (its documented manual-verification block → HTTPS)
- Modify: `apps/server/.env.example` (note `WAITRON_STATE_DIR` is optional; the box mints its own cert)
- Modify: `docs/superpowers/specs/2026-08-26-appliance-onboarding-design.md` (§16 decomposition note)

**Interfaces:** none (dev tooling + docs).

- [ ] **Step 1: Update `dev-onboard.ts`'s manual-verification comment/output** so it dials HTTPS with `-k` (self-signed) and mentions the state dir. The script itself (migrate-only, write a setup `.env`) is unchanged; only its printed "now run" guidance changes:
  ```
  curl -sk https://127.0.0.1:8080/setup-api/status   # {"provisioned":false,...}
  curl -sk -o /dev/null -w "%{http_code}\n" https://127.0.0.1:8080/   # 200 (placeholder over HTTPS)
  ```
  If `dev-onboard.ts` writes an `.env` with `WAITRON_HTTP_PORT=8080`, leave it; the box will now serve HTTPS on that port using a cert minted into `apps/server/src/state` (the `DEFAULT_STATE_ROOT`, gitignored). Optionally write `WAITRON_STATE_DIR` explicitly into the dev `.env` pointing at a worktree-local path if the default is not desired — not required.

- [ ] **Step 2: Add a `.env.example` note** near the `WAITRON_TLS_*` lines: `WAITRON_STATE_DIR` is where the box persists its self-signed cert + generated secrets on first setup boot; unset uses a local default; set `WAITRON_TLS_CERT_FILE`/`_KEY_FILE` to override the self-signed cert with your own.

- [ ] **Step 3: Add the design-spec §16 decomposition note.** In `2026-08-26-appliance-onboarding-design.md`, under §16 slice 2, add a dated sub-note (do not rewrite history — append, CLAUDE.md §6):
  > **Implementation note (2026-08-26): slice 2 is built as 2a → 2b → 2c.** 2a = secret generation/persistence + self-signed CA/leaf minting, server-side, no UI (this branch): first setup boot mints a CA + `waitron.local`/IP leaf into a persisted state dir (`WAITRON_STATE_DIR`) and serves the setup surface over HTTPS from it, and generates+persists the vault master key + sync node token — idempotent across restarts; operator-supplied `WAITRON_TLS_*` overrides the served cert (the box still mints and persists its own secrets regardless). 2b = the `/setup-api` provisioning endpoints (`planInstance`/`planVenue` in-process, demo/live fork, AEAT-cert-required-for-live, persist the till ids/DB URLs, then restart into trading — decided: persist-config-then-restart, not hot-flip). 2c = a new `apps/setup` Vite+Lit wizard consuming 2b, served in setup mode.

- [ ] **Step 4: Manual verification (documented).** Record the output of:
  ```bash
  pnpm dev:reset >/dev/null 2>&1 || true
  pnpm dev:onboard
  pnpm --filter @waitron/server dev &
  sleep 4
  curl -sk https://127.0.0.1:8080/setup-api/status
  curl -sk -o /dev/null -w "%{http_code}\n" https://127.0.0.1:8080/
  ls -la apps/server/src/state apps/server/src/state/tls   # ca.crt server.crt server.key + secrets.env
  ```
  Confirm the status JSON, the 200, and that the state dir holds the four PEMs + `secrets.env` with `0600` keys. (If Docker/port contention interferes locally, note it; the `boot.test.ts` HTTPS test is the real gate.)

- [ ] **Step 5: Commit** `-s`: `docs+dev(server): dev:onboard over HTTPS; record slice-2 decomposition (2a/2b/2c)`.

---

## Self-Review

**1. Spec coverage** (spec §5, §8, §9):
- §8 "box mints a private CA + `waitron.local` leaf, writes PEMs, serves HTTPS via tls.ts" → Tasks 1, 3, 4. ✅
- §9 "vault master key — reuse keyring generation but WRITE it; sync node token — generate at onboarding" → Task 3 (`generateKeyRing` + a random token into `secrets.env`). ✅
- §9 "CA + leaf keys persisted" → Task 3. ✅
- §5 "setup mode binds HTTPS and serves the setup surface" → Task 4. ✅
- §9 "root-only protected file" → Task 3 writes keys + secrets `0600`; the FDE volume is an OS-image concern, out of scope (stated). ✅
- **Deliberately NOT here:** provisioning endpoints, the wizard UI, trust UX/mDNS/IP-QR, `:80` redirect, leaf renewal, boot-unlock/passphrase — each named in "What this slice is NOT". ✅

**2. Placeholder scan:** the one `it("…operator-supplied…", async () => { /* point WAITRON_TLS_* … */ })` in Task 4 Step 1 is a described-not-coded test body; the step's prose names the exact assertion (state-dir `server.crt` NOT created; HTTPS still serves) and the mechanism (pre-mint a pair, point the two env vars at it). The `box-secrets.ts` and `self-signed-cert.ts` bodies are given as real code. No "TODO/TBD/handle edge cases".

**3. Type consistency:** `mintSelfSignedServerCert(MintOptions): SelfSignedMaterial` (Task 1) is called by `ensureBoxSecrets` (Task 3) with `{ hostnames, ipAddresses, now }` and injected in tests via `keypair`. `ensureBoxSecrets(EnsureBoxSecretsDeps): Promise<BoxTlsFiles>` (Task 3) is called by boot (Task 4) with `{ stateDir, hostnames, now }` and its `{ certFile, keyFile }` feed `config.tls`/`startListening`. `loadConfig(env, mig, media, state)` (Task 2) matches boot's 4-arg call (Task 2 Step 4). `config.stateDir` (Task 2) is read by boot (Task 4). Names consistent across tasks.

**Risk note carried into the fix/review loop:** Task 4 edits the fiscal server's boot, but **only the setup branch** — the trading branch's serve path is untouched. The regression guard is the trading-mode full-boot test (Task 4 Step 5). The whole-branch (finish-branch) review must confirm the `else`/trading path is byte-for-byte as before, and that `node-forge` moving to a runtime dependency does not perturb the bundle (`bundle-smoke` is CI-only — watch it).
