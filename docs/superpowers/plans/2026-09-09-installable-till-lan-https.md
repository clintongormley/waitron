# Installable Till + LAN HTTPS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the till installable as a home-screen app over the box's LAN HTTPS, name-constrain the box CA, serve a plain-HTTP trust/landing page, and add a screen wake lock plus a per-profile inactivity timeout.

**Architecture:** Six independent-ish surfaces on one branch. The box CA gains a hand-built `nameConstraints` extension; a second plain-HTTP listener serves the trust page and CA download on port 80; the till ships a web-app manifest; a client-side session-activity controller holds a screen wake lock and idle-logs-out session devices; and a nullable `inactivity_timeout_seconds` on `device_profiles` (edited in the dashboard, delivered on the till boot payload) drives that timeout. KDS is exempt from idle-logout and holds the wake lock indefinitely.

**Tech Stack:** TypeScript, node-forge (X.509), `@hono/node-server`, Hono, Lit (till/dashboard), Drizzle (Postgres), Vite, Vitest, node:test/openssl for the constraint proof.

**Spec:** `docs/superpowers/specs/2026-09-08-lan-https-install-and-name-constraints-spike.md` (build definition §3; inactivity-timeout addition §8).

## Global Constraints

- **Claims discipline (CLAUDE.md §1):** a claim of necessity/impossibility carries a receipt (the command run or a `file:line`). State the experiment, not the conclusion. Prove guards by deletion. The name-constraint task is proven by RUNNING openssl, never by reading.
- **The gate (CLAUDE.md §2):** `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`. **Every task's verify step includes `pnpm format:check`** (not just lint+typecheck+test:coverage).
- **Coverage thresholds (CLAUDE.md §2):** `packages/db` is a HIGH-bar package (statements 98 / lines 98 / functions 98 / branches 95). `apps/server`, `apps/till`, `apps/dashboard`, `packages/layouts`, `packages/ui` sit at the 90/90/85/85 floor. Keep the touched package at or above its bar.
- **CI runs `test:coverage`, not `test` (CLAUDE.md §2):** before calling a package green run `pnpm --filter <pkg> test:coverage`.
- **Migration hazard (CLAUDE.md §6, backlog #287):** **never run `pnpm --filter @waitron/db db:generate`** — it proposes `DROP TABLE "bookings" CASCADE` because `bookings` left the core schema barrel but stayed in the core snapshot chain. Add the `device_profiles` column with `db:generate:custom` (hand-written `ALTER TABLE`), which is snapshot-less.
- **No new core table without a stated reason (CLAUDE.md §3):** this adds a COLUMN to the existing core `device_profiles`; state the reason in the commit.
- **English-only guard (CLAUDE.md §3):** `packages/layouts` is scanned — English identifiers, strings AND comments. `apps/*` is out of scope for the guard (UI Spanish lives in i18n string files).
- **Tenant isolation (CLAUDE.md §3):** a by-id read scopes to the tenant. This plan adds no new by-id read; do not remove the existing `eq(tenantId)` scoping on `device_profiles` reads.
- **Comments (CLAUDE.md §1):** invariant + non-obvious why, not history. Thin on touch; do not sweep.
- **Every commit is `git commit -s`.** Conventional-commit subjects.
- **Coordination:** Tasks 1, 2, 3, 6b, 11 touch Track P / provisioning files (`self-signed-cert.ts`, `tls.ts`, `boot.ts`, `config.ts`, `discovery-api.ts`, `venue-plan.ts`, `deploy/`) that active backup/recovery and printer-agent sessions may own. Rebase onto their work on conflict (`boot.ts`, `config.ts` are the likely points); regenerate nothing blindly.
- **Deploy owed-note (not built here):** binding the landing listener on port 80 in the box image needs `cap_net_bind_service` (already granted for 443) and, under the image's host networking, no compose port map — record this as owed to the deploy/ owner; this plan does not edit `deploy/`.
- **Risk trigger = FULL review ceremony:** this diff touches a migration and a cross-package contract, so `/finish-branch` runs the full wave (per-task reviews + simplify lenses + run-it + convention), and the fresh-context plan-vs-spec read and the Codex run-it seat both run.
- **Owner sign-off at land:** not fiscal core, but confirm the seeded timeout default and the till-vs-handheld idle-logout scope with the owner at review.

---

### Task 1: Name-constrain the box CA

**Files:**
- Modify: `apps/server/src/self-signed-cert.ts` (add `nameConstraints` + `pathLenConstraint` to the CA)
- Test: `apps/server/src/self-signed-cert.test.ts` (extend), and a new `apps/server/src/name-constraints.test.ts` (openssl proof)

**Interfaces:**
- Consumes: nothing.
- Produces: `mintSelfSignedServerCert(opts)` unchanged in signature; the returned `caCertPem` now carries a critical `nameConstraints` extension permitting `DNS:waitron.local`, `DNS:localhost`, and IPv4 CIDRs `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, and `basicConstraints` gains `pathLenConstraint: 0`.

**Background:** node-forge (1.4.0) has no builder for `nameConstraints` (`_fillMissingExtensionFields` in `lib/x509.js` has no case for it), but if an extension object carries a pre-built `value` byte string it is emitted verbatim (OID from `e.id`/`e.name`). So build the DER by hand with `forge.asn1`. `NameConstraints ::= SEQUENCE { permittedSubtrees [0] IMPLICIT GeneralSubtrees }`, `GeneralSubtree ::= SEQUENCE { base GeneralName }`, dNSName is context `[2]` primitive (IA5String bytes), iPAddress in a name constraint is context `[7]` primitive holding **address bytes followed by mask bytes** (8 bytes for IPv4).

- [ ] **Step 1: Write the failing unit test** — assert the CA cert carries the extension.

In `apps/server/src/self-signed-cert.test.ts` add:

```ts
import forge from "node-forge";

it("the CA carries a critical nameConstraints extension permitting waitron.local + loopback + RFC1918", () => {
  const m = mintSelfSignedServerCert({
    hostnames: ["waitron.local", "localhost"],
    ipAddresses: ["127.0.0.1", "192.168.1.50"],
    now: new Date("2026-09-09T00:00:00Z"),
  });
  const ca = forge.pki.certificateFromPem(m.caCertPem);
  const nc = ca.getExtension("nameConstraints") as { critical?: boolean; value?: string } | undefined;
  expect(nc).toBeDefined();
  expect(nc?.critical).toBe(true);
  // pathLenConstraint 0 on basicConstraints
  const bc = ca.getExtension("basicConstraints") as { pathLenConstraint?: number } | undefined;
  expect(bc?.pathLenConstraint).toBe(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/server test -- self-signed-cert`
Expected: FAIL — `nc` is undefined (no nameConstraints emitted yet).

- [ ] **Step 3: Implement the ASN.1 builder and attach it**

In `self-signed-cert.ts`, add a helper and extend the CA extension list. Add the permitted-set constants near the top:

```ts
/**
 * The CA's permitted name space. Loopback + the three RFC1918 ranges are in the set (the box leaf
 * carries `localhost`/`127.0.0.1` SANs and a LAN address); nothing public is, so the root can never
 * vouch for an outside name. Android ignores this extension on a user root (spike §7) — kept anyway
 * because it constrains on desktop and iOS and costs nothing.
 */
const PERMITTED_DNS = ["waitron.local", "localhost"];
const PERMITTED_IPV4_CIDRS: Array<[string, number]> = [
  ["127.0.0.0", 8],
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
];

/** IPv4 dotted-quad → 4 bytes. */
function ipv4Bytes(addr: string): number[] {
  return addr.split(".").map((o) => Number(o) & 0xff);
}

/** A /n prefix length → 4 mask bytes. */
function ipv4Mask(prefix: number): number[] {
  const bits = 0xffffffff & (prefix === 0 ? 0 : ~0 << (32 - prefix));
  return [(bits >>> 24) & 0xff, (bits >>> 16) & 0xff, (bits >>> 8) & 0xff, bits & 0xff];
}

/**
 * A pre-built `nameConstraints` extension (node-forge has no builder for it). The `value` is the DER
 * of `NameConstraints ::= SEQUENCE { permittedSubtrees [0] IMPLICIT SEQUENCE OF GeneralSubtree }`.
 */
function nameConstraintsExtension(): CertExtension & { id: string; critical: boolean; value: string } {
  const { asn1 } = forge;
  const dnsSubtrees = PERMITTED_DNS.map((name) =>
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      // GeneralName dNSName = context [2] primitive
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 2, false, name),
    ]),
  );
  const ipSubtrees = PERMITTED_IPV4_CIDRS.map(([addr, prefix]) =>
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      // GeneralName iPAddress = context [7] primitive; name-constraint form is address||mask
      asn1.create(
        asn1.Class.CONTEXT_SPECIFIC,
        7,
        false,
        String.fromCharCode(...ipv4Bytes(addr), ...ipv4Mask(prefix)),
      ),
    ]),
  );
  const permitted = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [...dnsSubtrees, ...ipSubtrees]);
  const nameConstraints = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [permitted]);
  return {
    name: "nameConstraints",
    // The LITERAL OID — node-forge 1.4.0 registers only id→name for 2.5.29.30, so
    // `forge.pki.oids.nameConstraints` is undefined and `setExtensions` would throw
    // "Extension ID not specified." (verified by running it). Do not "simplify" this to the lookup.
    id: "2.5.29.30",
    critical: true,
    value: asn1.toDer(nameConstraints).getBytes(),
  };
}
```

Add `id?: string`, `critical?: boolean`, and `value?: string` to the `CertExtension` interface. Then in the CA extension array (currently `basicConstraints` + `keyUsage`), add `pathLenConstraint: 0` to `basicConstraints` and append `nameConstraintsExtension()`:

```ts
[
  { name: "basicConstraints", cA: true, pathLenConstraint: 0 },
  { name: "keyUsage", keyCertSign: true, cRLSign: true, digitalSignature: true },
  nameConstraintsExtension(),
],
```

(Add `pathLenConstraint?: number` to `CertExtension`.)

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm --filter @waitron/server test -- self-signed-cert`
Expected: PASS, and the pre-existing handshake test (client trusting the CA dials `127.0.0.1`/servername `localhost`, `authorized===true`) still PASSES — loopback is inside the permitted set.

- [ ] **Step 5: Write the openssl proof test** — prove by running, not reading (CLAUDE.md §1/§4).

Create `apps/server/src/name-constraints.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";

/**
 * Proves the CA's nameConstraints actually CONSTRAIN, by running openssl rather than reading the DER:
 * a control leaf for `example.com` signed by the same CA must be REFUSED, while a `waitron.local`
 * leaf is accepted. Mirrors the desktop spike (spec §6). Skips cleanly where openssl is absent.
 */
function haveOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.runIf(haveOpenssl())("CA name constraints (openssl proof)", () => {
  it("refuses a control leaf outside the permitted subtree, accepts a permitted one", () => {
    const m = mintSelfSignedServerCert({
      hostnames: ["waitron.local"],
      ipAddresses: ["192.168.1.50"],
      now: new Date("2026-09-09T00:00:00Z"),
    });
    // Forge a control leaf for example.com signed by the SAME CA key.
    const caKey = forge.pki.privateKeyFromPem(m.caKeyPem);
    const caCert = forge.pki.certificateFromPem(m.caCertPem);
    const leafKeys = forge.pki.rsa.generateKeyPair(2048);
    const control = forge.pki.createCertificate();
    control.publicKey = leafKeys.publicKey;
    control.serialNumber = "02";
    control.validity.notBefore = new Date("2026-09-08T00:00:00Z");
    control.validity.notAfter = new Date("2027-09-08T00:00:00Z");
    control.setSubject([{ name: "commonName", value: "example.com" }]);
    control.setIssuer(caCert.subject.attributes);
    control.setExtensions([
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: [{ type: 2, value: "example.com" }] },
    ]);
    control.sign(caKey, forge.md.sha256.create());

    const dir = mkdtempSync(join(tmpdir(), "waitron-nc-"));
    try {
      writeFileSync(join(dir, "ca.pem"), m.caCertPem);
      writeFileSync(join(dir, "leaf-a.pem"), m.serverCertPem);
      writeFileSync(join(dir, "leaf-b.pem"), forge.pki.certificateToPem(control));
      // Leaf A (waitron.local) verifies.
      const okA = () =>
        execFileSync("openssl", ["verify", "-CAfile", join(dir, "ca.pem"), join(dir, "leaf-a.pem")], {
          encoding: "utf8",
        });
      expect(okA()).toMatch(/OK/);
      // Leaf B (example.com) is refused for a permitted-subtree violation.
      let failed = false;
      let msg = "";
      try {
        execFileSync("openssl", ["verify", "-CAfile", join(dir, "ca.pem"), join(dir, "leaf-b.pem")], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (e) {
        failed = true;
        msg = String((e as { stdout?: string; stderr?: string }).stdout ?? "") +
          String((e as { stdout?: string; stderr?: string }).stderr ?? "");
      }
      expect(failed).toBe(true);
      expect(msg).toMatch(/permitted subtree/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 6: Run the proof test**

Run: `pnpm --filter @waitron/server test -- name-constraints`
Expected: PASS — `leaf-a` verifies OK, `leaf-b` fails with "permitted subtree violation". If openssl is absent the suite is skipped (record that in the commit body so a green isn't mistaken for a run).

- [ ] **Step 7: Verify and commit**

Run: `pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/server test:coverage && pnpm format:check`

```bash
git add apps/server/src/self-signed-cert.ts apps/server/src/self-signed-cert.test.ts apps/server/src/name-constraints.test.ts
git commit -s -m "feat(server): name-constrain the box CA to waitron.local + loopback + RFC1918"
```

---

### Task 2: Extract the trust page into a shared module

**Files:**
- Create: `apps/server/src/trust-page.ts` (the rendered HTML + CA content-type constants)
- Modify: `apps/server/src/discovery-api.ts` (import the shared renderer instead of the inline one)
- Test: `apps/server/src/trust-page.test.ts`; keep `apps/server/src/discovery-api.test.ts` green

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `renderTrustPage(input: { reachUrls: string[]; caAvailable: boolean; caDownloadPath: string; qrSvg?: string; httpsUrl: string }): string`
  - `CA_CONTENT_TYPE = "application/x-x509-ca-cert"`, `CA_FILENAME = "waitron-ca.crt"`

**Background:** `discovery-api.ts` currently holds `renderTrustPage` inline with the POSITIONAL signature `renderTrustPage(reach: ReachInfo, caAvailable, qrSvg)` (`discovery-api.ts:150`) — verify the real shape before moving it. Task 3's plain-HTTP listener needs the identical page but serves the CA at a DIFFERENT path (`/ca.crt`, not `/setup-api/ca.crt`), so the extracted renderer takes an explicit `caDownloadPath` — without it the landing page's download link 404s on port 80, defeating the load-bearing surface (review B2). Move the pure renderer + the CA content-type/filename to `trust-page.ts` with the new object signature; `discovery-api.ts` keeps its routes and calls the shared renderer, building `reachUrls` from `reach` and passing `caDownloadPath: "/setup-api/ca.crt"`. This is a refactor: behaviour unchanged, so `discovery-api.test.ts` must stay green (CLAUDE.md — preserve behavioural assertions), which it does because its assertions go through the mounted `/setup/trust` route (the `/setup-api/ca.crt` link, the injected QR, the `iOS`/no-QR/operator-cert notes).

- [ ] **Step 1: Write the failing test** for the extracted renderer.

`apps/server/src/trust-page.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CA_CONTENT_TYPE, CA_FILENAME, renderTrustPage } from "./trust-page.js";

describe("renderTrustPage", () => {
  it("renders the CA download link at the given path, reach URLs and the https link", () => {
    const html = renderTrustPage({
      reachUrls: ["https://waitron.local", "https://192.168.1.50"],
      caAvailable: true,
      caDownloadPath: "/setup-api/ca.crt",
      httpsUrl: "https://waitron.local",
    });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('href="/setup-api/ca.crt"'); // exact link, not a substring
    expect(html).toContain("https://waitron.local");
  });
  it("honours a different caDownloadPath (the landing origin uses /ca.crt)", () => {
    const html = renderTrustPage({
      reachUrls: [],
      caAvailable: true,
      caDownloadPath: "/ca.crt",
      httpsUrl: "https://waitron.local",
    });
    expect(html).toContain('href="/ca.crt"');
    expect(html).not.toContain("/setup-api/ca.crt");
  });
  it("omits the download link when no box CA is present", () => {
    const html = renderTrustPage({ reachUrls: [], caAvailable: false, caDownloadPath: "/ca.crt", httpsUrl: "https://waitron.local" });
    expect(html).not.toContain('href="/ca.crt"');
  });
  it("exposes the CA content-type and filename", () => {
    expect(CA_CONTENT_TYPE).toBe("application/x-x509-ca-cert");
    expect(CA_FILENAME).toBe("waitron-ca.crt");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/server test -- trust-page`
Expected: FAIL — module `./trust-page.js` not found.

- [ ] **Step 3: Create `trust-page.ts`** by lifting the exact template + per-OS instructions from `discovery-api.ts`'s current `renderTrustPage`, parameterised by the object interface above. The CA download link now renders `href="${caDownloadPath}"` (a parameter), so both origins can point it at their own path. Keep the byte-for-byte instruction copy; do not reword (CLAUDE.md §1 — a behaviour change retires receipts).

- [ ] **Step 4: Rewire `discovery-api.ts`** to `import { renderTrustPage, CA_CONTENT_TYPE, CA_FILENAME } from "./trust-page.js"` and delete the inline copy. The `GET /setup/trust` handler builds the object from the current `ReachInfo` — `reachUrls: [reach.hostnameUrl, ...reach.ipUrls]` (confirm the real field names on `ReachInfo` at `discovery-api.ts:150`), `caDownloadPath: "/setup-api/ca.crt"`, `qrSvg` and `httpsUrl` as today — and `GET /setup-api/ca.crt` uses `CA_CONTENT_TYPE`/`CA_FILENAME`.

- [ ] **Step 5: Run both suites to verify they pass**

Run: `pnpm --filter @waitron/server test -- trust-page discovery-api`
Expected: PASS — `discovery-api.test.ts` unchanged and green (refactor preserved behaviour).

- [ ] **Step 6: Verify and commit**

Run: `pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/server test:coverage && pnpm format:check`

```bash
git add apps/server/src/trust-page.ts apps/server/src/trust-page.test.ts apps/server/src/discovery-api.ts
git commit -s -m "refactor(server): extract renderTrustPage into a shared trust-page module"
```

---

### Task 3: Plain-HTTP landing listener on port 80

**Files:**
- Create: `apps/server/src/landing-app.ts` (a tiny Hono app: `GET /`, `GET /ca.crt`)
- Modify: `apps/server/src/config.ts` (add `landingPort` from `WAITRON_HTTP_LANDING_PORT`, default 80, 0 = disabled)
- Modify: `apps/server/src/boot.ts` (start the landing listener in setup + trading when the box serves its own minted leaf)
- Test: `apps/server/src/landing-app.test.ts`; extend `apps/server/src/config.test.ts`

**Interfaces:**
- Consumes: `renderTrustPage`, `CA_CONTENT_TYPE`, `CA_FILENAME` (Task 2); `caCertPath(stateDir)` (`box-secrets.ts`).
- Produces:
  - `buildLandingApp(deps: { stateDir: string; reachUrls: string[]; httpsUrl: string; log: Logger }): Hono`
  - `startLandingListener(config, log): { close(): Promise<void> } | undefined` — returns `undefined` when `landingPort === 0` or no minted leaf exists.
  - `config.landingPort: number`

**Background:** No port-80 listener exists today; every mode serves HTTPS on `httpPort` (443 in the box image via host networking + `cap_net_bind_service`). The landing page is the load-bearing trust surface (the spike showed the HTTPS interstitial fires before our JS on an untrusted origin). It must **never redirect** and **never send HSTS**.

- [ ] **Step 1: Write the failing config test**

In `apps/server/src/config.test.ts`:

```ts
it("landingPort defaults to 80 and 0 disables it", () => {
  const cfg = (env: Record<string, string>) => loadConfig(env, ROOT, MEDIA_ROOT, STATE_ROOT);
  expect(cfg({ ...MIN_ENV }).landingPort).toBe(80);
  expect(cfg({ ...MIN_ENV, WAITRON_HTTP_LANDING_PORT: "0" }).landingPort).toBe(0);
  expect(cfg({ ...MIN_ENV, WAITRON_HTTP_LANDING_PORT: "8081" }).landingPort).toBe(8081);
});
```

The real helpers are `MIN_ENV` and the four-arg `loadConfig(env, ROOT, MEDIA_ROOT, STATE_ROOT)` (confirm the exact fixture names in `config.test.ts`).

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/server test -- config`
Expected: FAIL — `landingPort` undefined.

- [ ] **Step 3: Add `landingPort` to config** — parse `WAITRON_HTTP_LANDING_PORT` (default 80, integer, bounded `0..65535`, `0` allowed as "disabled"), beside the existing `httpPort` parsing in `config.ts`. **Do NOT reuse `parsePositiveInt`** — it throws on `value <= 0` (`config.ts:479-487`) and `0` must be a valid "disabled" value; write a small bounded parser that accepts `0..65535`.

- [ ] **Step 4: Write the failing landing-app test**

`apps/server/src/landing-app.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLandingApp } from "./landing-app.js";

function stateDirWithCa(): string {
  const d = mkdtempSync(join(tmpdir(), "waitron-land-"));
  mkdirSync(join(d, "tls"), { recursive: true });
  writeFileSync(join(d, "tls", "ca.crt"), "-----BEGIN CERTIFICATE-----\nMII...\n-----END CERTIFICATE-----\n");
  return d;
}

describe("landing app", () => {
  const log = { info() {}, warn() {}, error() {} } as never;

  it("serves the trust page at / without redirecting and without HSTS", async () => {
    const dir = stateDirWithCa();
    try {
      const app = buildLandingApp({ stateDir: dir, reachUrls: ["https://waitron.local"], httpsUrl: "https://waitron.local", log });
      const res = await app.request("http://waitron.local/");
      expect(res.status).toBe(200); // not a 3xx
      expect(res.headers.get("strict-transport-security")).toBeNull();
      // The download link points at the landing-local path, not /setup-api/ca.crt (which is HTTPS-only).
      expect(await res.text()).toContain('href="/ca.crt"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves the CA at /ca.crt as an attachment", async () => {
    const dir = stateDirWithCa();
    try {
      const app = buildLandingApp({ stateDir: dir, reachUrls: [], httpsUrl: "https://waitron.local", log });
      const res = await app.request("http://waitron.local/ca.crt");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/x-x509-ca-cert");
      expect(res.headers.get("content-disposition")).toContain("waitron-ca.crt");
      expect(await res.text()).toContain("BEGIN CERTIFICATE");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm --filter @waitron/server test -- landing-app`
Expected: FAIL — `./landing-app.js` not found.

- [ ] **Step 6: Implement `landing-app.ts`.** A Hono app: `GET /` reads `caCertPath(stateDir)` existence for `caAvailable`, returns `renderTrustPage({ ..., caDownloadPath: "/ca.crt" })` with `Cache-Control: no-cache` and **no** HSTS (this is the load-bearing plain-HTTP surface, so the download link must resolve on THIS origin); `GET /ca.crt` streams the PEM with `CA_CONTENT_TYPE` + `Content-Disposition: attachment; filename="${CA_FILENAME}"`, 404 when absent.

- [ ] **Step 7: Wire `startLandingListener` into boot.** Add `startLandingListener(config, log)` to `boot.ts` (or a small helper it calls): return `undefined` when `config.landingPort === 0` or `mintedBoxLeaf(config.stateDir)` is undefined (operator-TLS / leaf-less dev); otherwise `serve(buildServeOptions({ fetch: buildLandingApp(...).fetch, port: config.landingPort, hostname: config.httpHost }, undefined))` — **`undefined` TLS = plain HTTP**, confirmed at `tls.ts:40` (`buildServeOptions` returns `base` unchanged). The landing port differs from `httpPort`, so there is no bind conflict.

  **There are THREE bind sites, not two** (verified): the setup-mode bind (~`boot.ts:869`), and `startTradingListener` is called at BOTH `boot.ts:1001` (adoption-pending) and `boot.ts:2007` (main trading). Each is followed by `makeStartedServer(...)`. Start the landing listener at all three (or once inside `startTradingListener` + once at the setup site), and thread its handle into `makeStartedServer` so its `close()` sequence (`boot.ts:448-476`) also closes the landing listener — otherwise it leaks on shutdown. Do NOT touch `node-entry.ts` recovery in this task — leave a `// TODO(recovery): landing listener in recovery mode — coordinate with the backup/recovery session` note and record it in the PR as owed.

- [ ] **Step 8: Write a boot-level no-redirect + no-HSTS integration test** (real listener):

`apps/server/src/landing-listener.test.ts` — bind `startLandingListener` on an ephemeral port against a temp stateDir with a CA, `http.get` `/`, assert status 200 (no `location` header) and no `strict-transport-security`, then close. (Follow `tls.test.ts`'s real-`serve` pattern; use `landingPort` override.)

- [ ] **Step 9: Run the suites to verify they pass**

Run: `pnpm --filter @waitron/server test -- landing-app landing-listener config`
Expected: PASS.

- [ ] **Step 10: Verify and commit**

Run: `pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/server test:coverage && pnpm format:check`

```bash
git add apps/server/src/landing-app.ts apps/server/src/landing-app.test.ts apps/server/src/landing-listener.test.ts apps/server/src/config.ts apps/server/src/config.test.ts apps/server/src/boot.ts
git commit -s -m "feat(server): serve a plain-HTTP trust/landing page on WAITRON_HTTP_LANDING_PORT (default 80)"
```

---

### Task 4: Generate 192/512 manifest icons from the brand mark

**Files:**
- Modify: `packages/ui/brand/build-icons.mjs` (emit `icon-192.png`, `icon-512.png`)
- Create (committed outputs): `packages/ui/brand/public/icon-192.png`, `packages/ui/brand/public/icon-512.png`

**Interfaces:**
- Produces: two committed PNGs at `packages/ui/brand/public/icon-{192,512}.png` (the mark on an opaque white ground, matching `apple-touch-icon.png`).

**Background:** `build-icons.mjs` renders the brand mark via Inkscape (present locally, 1.4.4) and commits the outputs; nothing in CI runs it. A manifest install icon wants 192 and 512 px PNGs. Reuse the existing `square(mark.fill, <white rect>)` + `render(..., { opaque: true })` path (iOS/Android flatten alpha).

- [ ] **Step 1: Extend `build-icons.mjs`** — after the apple-touch render, add:

```js
for (const size of [192, 512]) {
  render(appleSrc, join(pub, `icon-${size}.png`), size, { opaque: true });
  written.push(`public/icon-${size}.png`);
}
```

- [ ] **Step 2: Run the generator**

Run: `node packages/ui/brand/build-icons.mjs`
Expected: prints `build-icons: wrote ... public/icon-192.png, public/icon-512.png ...`.

- [ ] **Step 3: Verify the outputs**

Run: `file packages/ui/brand/public/icon-192.png packages/ui/brand/public/icon-512.png`
Expected: `PNG image data, 192 x 192` and `512 x 512`.

- [ ] **Step 4: Verify and commit** (this only touches `packages/ui`, whose gate runs on dependents)

Run: `pnpm --filter @waitron/ui typecheck && pnpm --filter @waitron/ui test:coverage && pnpm format:check`

```bash
git add packages/ui/brand/build-icons.mjs packages/ui/brand/public/icon-192.png packages/ui/brand/public/icon-512.png
git commit -s -m "feat(ui): generate 192/512 brand PNGs for the web-app manifest"
```

---

### Task 5: Till web-app manifest + install metadata

**Files:**
- Modify: `apps/till/vite.config.ts` (a plugin emitting `manifest.webmanifest` into the build + serving it in dev)
- Modify: `apps/till/index.html` (`<link rel="manifest">` + `<meta name="theme-color">`)
- Test: `apps/till/src/manifest.test.ts` (assert the manifest JSON shape); a served-in-prod assertion via the server SPA test if one exists

**Interfaces:**
- Consumes: `packages/ui/brand/public/icon-{192,512}.png` (Task 4), served at the till origin root by the shared `publicDir`.
- Produces: `manifest.webmanifest` at the till origin root; `buildManifest(): object` exported from a small `apps/till/src/manifest.ts` for testability.

**Background:** The till is served same-origin by the box over HTTPS in production (`mountSpa`, till at root `/`); dev serves it via Vite (5190). `publicDir` is the shared `packages/ui/brand/public`, so a till-specific manifest cannot simply live there. Emit it from a Vite plugin (build asset + dev middleware). Install needs HTTPS (already) + a manifest with name/icons/`start_url`/`display` (no service worker required per spec §3.1; on-device Android install remains an owner phone-row check).

- [ ] **Step 1: Write the failing manifest-shape test**

`apps/till/src/manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildManifest } from "./manifest.js";

describe("till web app manifest", () => {
  it("declares an installable standalone app with 192 and 512 icons", () => {
    const m = buildManifest();
    expect(m.name).toContain("Waitron");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    const sizes = (m.icons as Array<{ sizes: string; src: string }>).map((i) => i.sizes).sort();
    expect(sizes).toEqual(["192x192", "512x512"]);
    for (const i of m.icons as Array<{ src: string }>) expect(i.src).toMatch(/^\/icon-\d+\.png$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/till test -- manifest`
Expected: FAIL — `./manifest.js` not found.

- [ ] **Step 3: Create `apps/till/src/manifest.ts`** exporting `buildManifest()` returning `{ name: "Waitron Till", short_name: "Waitron", start_url: "/", scope: "/", display: "standalone", background_color: "#ffffff", theme_color: "<brand primary>", icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }] }`. (Use the brand primary token value; `purpose: "any"` — the mark lacks a maskable safe zone.)

- [ ] **Step 4: Add the Vite plugin** in `apps/till/vite.config.ts`:

```ts
function webManifest() {
  const json = JSON.stringify(buildManifest(), null, 2);
  return {
    name: "waitron-webmanifest",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: json });
    },
    configureServer(server) {
      server.middlewares.use("/manifest.webmanifest", (_req, res) => {
        res.setHeader("Content-Type", "application/manifest+json");
        res.end(json);
      });
    },
  };
}
```

Add `webManifest()` to `plugins`. Import `buildManifest` from `./src/manifest.ts` (config is ESM/TS — Vite loads it).

- [ ] **Step 5: Add the link + theme-color to `apps/till/index.html`** head:

```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="<brand primary>" />
```

- [ ] **Step 6: Build the till and verify the manifest is emitted**

Run: `pnpm --filter @waitron/till build && test -f apps/till/dist/manifest.webmanifest && node -e "const m=require('./apps/till/dist/manifest.webmanifest');" 2>/dev/null; cat apps/till/dist/manifest.webmanifest | head`
Expected: `manifest.webmanifest` exists in `dist` with the JSON. (Also confirm `dist/icon-192.png`/`icon-512.png` copied from `publicDir`.)

- [ ] **Step 7: Run tests + verify**

Run: `pnpm --filter @waitron/till typecheck && pnpm --filter @waitron/till test:coverage && pnpm format:check`
Expected: PASS. (Note: `scripts/brand-icons.test.ts` reads text and does not check manifest icons, so it stays green; the new `<link rel="manifest">` does not match its `rel="(icon|apple-touch-icon)"` pattern.)

- [ ] **Step 8: Commit**

```bash
git add apps/till/vite.config.ts apps/till/index.html apps/till/src/manifest.ts apps/till/src/manifest.test.ts
git commit -s -m "feat(till): ship a web-app manifest so the till installs as a standalone app"
```

---

### Task 6: `device_profiles.inactivity_timeout_seconds` — schema + layouts

**Files:**
- Modify: `packages/db/src/schema/device-profiles.ts` (nullable integer column; add `integer` to the drizzle import — it currently imports only jsonb/pgEnum/pgTable/text/timestamp/unique/uuid)
- Create: a custom migration `packages/db/drizzle/00NN_device_profile_inactivity_timeout_sql.sql` via `db:generate:custom` (hand-written `ALTER TABLE`)
- Modify: `packages/layouts/src/device-profile.ts` (the `DefaultDeviceProfile` interface, seed defaults, `validateInactivityTimeout`) and `packages/layouts/src/device-profile-store.ts` (the `DeviceProfileRow` type `:42`, `PROFILE_COLUMNS` `:51-57`, `toRow` `:60-74`, and the create/update verbs)
- Modify: `packages/provisioning/src/venue-plan.ts` (the `DefaultDeviceProfile` mapping at `:170-174` and the `seed-device-profiles` action / `applyVenue` call drop any field not in their map — thread the new field through, or the seeded default never reaches the DB)
- Test: `packages/layouts` store tests; a `packages/db` migration/column test; a `packages/provisioning` seed test

**Interfaces:**
- Produces:
  - `device_profiles.inactivity_timeout_seconds INTEGER NULL` (NULL = never).
  - `DeviceProfileRow.inactivityTimeoutSeconds: number | null` (store read shape) and `DefaultDeviceProfile.inactivityTimeoutSeconds?: number | null` (seed shape).
  - `createDeviceProfile`/`updateDeviceProfile` accept `inactivityTimeoutSeconds: number | null` in their input objects.
  - `validateInactivityTimeout(value: number | null, formFactor: FormFactor): number | null` — throws on a negative/non-integer; forces `null` for `kds`.

**Background:** `device_profiles` is core (`packages/db`, HIGH coverage bar). `bookings` is a module table absent from the core barrel but present in the core snapshot chain, so `db:generate` proposes dropping it — **use `db:generate:custom`** (snapshot-less) and hand-write the `ALTER TABLE`. The column inherits table-level grants (verify `privileges.test.ts` stays green). **The seed reaches the DB only through `venue-plan.ts`**, which maps each `DEFAULT_DEVICE_PROFILES` entry to `{ name, formFactor, capabilities }` and would silently drop a new field — so B1's provisioning edit is load-bearing, and `packages/provisioning` is a cross-package contract (a risk trigger). Note `DEFAULT_DEVICE_PROFILES` has entries for `till`, `kds`, `phone-portrait` only — **there is no `tablet-landscape` entry to seed**.

- [ ] **Step 1: Write the failing layouts validation test**

In the appropriate `packages/layouts` test (e.g. `device-profile.test.ts`):

```ts
import { validateInactivityTimeout } from "./device-profile.js";

it("validates the inactivity timeout and forces null for KDS", () => {
  expect(validateInactivityTimeout(300, "phone-portrait")).toBe(300);
  expect(validateInactivityTimeout(null, "till")).toBeNull();
  expect(validateInactivityTimeout(300, "kds")).toBeNull(); // KDS is exempt
  expect(() => validateInactivityTimeout(-5, "till")).toThrow();
  expect(() => validateInactivityTimeout(1.5, "till")).toThrow();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/layouts test -- device-profile`
Expected: FAIL — `validateInactivityTimeout` not exported.

- [ ] **Step 3: Add the column to the schema** in `packages/db/src/schema/device-profiles.ts`:

```ts
inactivityTimeoutSeconds: integer("inactivity_timeout_seconds"),
```

(nullable; `integer` from `drizzle-orm/pg-core`, already imported or add it.)

- [ ] **Step 4: Generate the custom migration** (NOT `db:generate`):

Run: `pnpm --filter @waitron/db db:generate:custom --name device_profile_inactivity_timeout`
Then hand-write the emitted `..._sql.sql` body:

```sql
ALTER TABLE "device_profiles" ADD COLUMN "inactivity_timeout_seconds" integer;
```

- [ ] **Step 5: Add the type + validation + seed defaults in layouts.** In `device-profile.ts`: add `inactivityTimeoutSeconds?: number | null` to the `DefaultDeviceProfile` interface; add `validateInactivityTimeout`; in `DEFAULT_DEVICE_PROFILES` set the `phone-portrait` entry to `300` and leave `till`/`kds` at `null`/omitted (there is no `tablet-landscape` entry). Add a header comment: the seeded 300 s is a default the owner confirms at review.

- [ ] **Step 6: Thread it through the store verbs** in `device-profile-store.ts`: add `inactivityTimeoutSeconds: number | null` to the `DeviceProfileRow` type (`:42`), `PROFILE_COLUMNS` (`:51-57`) and `toRow` (`:60-74`); `createDeviceProfile`/`updateDeviceProfile` accept `inactivityTimeoutSeconds`, run `validateInactivityTimeout(input.inactivityTimeoutSeconds, input.formFactor)` beside `validateCapabilities`, and write the column; `getDeviceProfile`/`listDeviceProfiles` already select via `PROFILE_COLUMNS`/`toRow`, so they return it once those are updated. Keep the existing `eq(tenantId)` scoping (`:130`,`:144`).

- [ ] **Step 6b: Thread it through provisioning seeding** in `packages/provisioning/src/venue-plan.ts`: the `DefaultDeviceProfile`→create mapping (`:170-174`) currently emits `{ name, formFactor, capabilities }` only; add `inactivityTimeoutSeconds: p.inactivityTimeoutSeconds ?? null` so the seeded 300 s reaches `createDeviceProfile` through the `seed-device-profiles` action / `applyVenue` handler. Write a `packages/provisioning` test asserting a freshly-seeded `phone-portrait` profile has `inactivityTimeoutSeconds === 300` and `till`/`kds` have `null`.

- [ ] **Step 7: Write a store round-trip test** (real PG or PGlite per the suite's target) asserting create → get returns the value, and a `kds` create coerces it to null. Add a `packages/db` test that runs migrations and asserts the column exists and is nullable.

- [ ] **Step 8: Run the suites**

Run: `pnpm --filter @waitron/layouts test:coverage && pnpm --filter @waitron/db test:coverage && pnpm --filter @waitron/provisioning test:coverage`
Expected: PASS, including `packages/db`'s `privileges.test.ts` (grants unchanged; column inherits table grants).

- [ ] **Step 9: Typecheck dependents + verify**

Run: `pnpm --filter @waitron/layouts... typecheck && pnpm format:check`

- [ ] **Step 10: Commit** (state the core-column reason)

```bash
git add packages/db/src/schema/device-profiles.ts packages/db/drizzle/ packages/layouts/src/device-profile.ts packages/layouts/src/device-profile-store.ts packages/layouts/src/*.test.ts packages/db/src/**/*.test.ts packages/provisioning/src/venue-plan.ts packages/provisioning/src/*.test.ts
git commit -s -m "feat(layouts): add per-profile inactivity_timeout_seconds (core column: it lives on the core device_profiles table)"
```

---

### Task 7: Serve + accept the timeout — server routes and till boot payload

**Files:**
- Modify: `apps/server/src/management-api.ts` (POST/PUT device-profile body validation + input threading)
- Modify: `apps/server/src/till-api.ts` (include `inactivityTimeoutSeconds` on the `GET /api/till` boot payload)
- Test: extend `apps/server/src/management-api.pg.test.ts` and `apps/server/src/till-api.test.ts`

**Interfaces:**
- Consumes: `createDeviceProfile`/`updateDeviceProfile` (Task 6), `getDeviceProfile` (returns the field).
- Produces: `GET /api/till` boot JSON gains `inactivityTimeoutSeconds: number | null` beside `capabilities`; POST/PUT `/management-api/device-profiles` accept `inactivityTimeoutSeconds`.

- [ ] **Step 1: Write the failing till-api boot test**

In `apps/server/src/till-api.test.ts`, extend the boot-payload assertion to expect `inactivityTimeoutSeconds` mirrored from the enrolled device's profile (e.g. a handheld profile seeded 300 → boot payload `inactivityTimeoutSeconds: 300`; a profile with null → `null`).

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/server test -- till-api`
Expected: FAIL — field absent from the payload.

- [ ] **Step 3: Add it to the boot payload** in `till-api.ts`. `profile` is only in scope inside `if (device != null)` (`:747-769`), so declare `let inactivityTimeoutSeconds: number | null = null` at the OUTER scope beside `capabilities` (`:746`) and set it from `profile.inactivityTimeoutSeconds` inside that block (mirroring exactly how `capabilities` is handled — not a `profile?.… ?? null` at the return, which would not compile). Include it in the `boot` object and the JSON response (`:770-845`).

- [ ] **Step 4: Write the failing management-api validation test** in `management-api.pg.test.ts`: POST/PUT a profile with `inactivityTimeoutSeconds: 300` persists it; a negative value is rejected (`400`); a `kds` profile coerces to null.

- [ ] **Step 5: Add body validation + threading** in `management-api.ts` POST (~`:1175-1208`) and PUT (~`:1229-1257`): accept an optional `inactivityTimeoutSeconds` (integer or null; reuse `requireInt`/equivalent, default null when absent), pass it into the create/update input objects (the store's `validateInactivityTimeout` enforces the KDS/negative rules — keep the server check to shape/type only, mirroring how `capabilities` is handled).

- [ ] **Step 6: Run the suites**

Run: `pnpm --filter @waitron/server test -- till-api management-api`
Expected: PASS.

- [ ] **Step 7: Verify + commit**

Run: `pnpm --filter @waitron/server typecheck && pnpm --filter @waitron/server test:coverage && pnpm format:check`

```bash
git add apps/server/src/management-api.ts apps/server/src/till-api.ts apps/server/src/*.test.ts
git commit -s -m "feat(server): accept inactivity timeout on device-profile routes and deliver it on till boot"
```

---

### Task 8: Dashboard device-profile editor — inactivity-timeout field

**Files:**
- Modify: `apps/dashboard/src/screens/device-profiles-screen.ts` (draft state, number input, save threading, KDS gating)
- Modify: `apps/dashboard/src/api/client.ts` (`createDeviceProfile`/`updateDeviceProfile` verbs gain the arg)
- Modify: `apps/dashboard/src/i18n/strings.ts` (`device_profiles.*` labels, English + Spanish)
- Test: `apps/dashboard/src/screens/device-profiles-screen.test.ts`

**Interfaces:**
- Consumes: the POST/PUT routes (Task 7).
- Produces: an "Auto-logout after (minutes)" number field, hidden for a `kds` form factor, that sends `inactivityTimeoutSeconds` (minutes × 60, or null when blank).

**Background:** The editor is `device-profiles-screen.ts` (`#renderEditor` ~`:464-534`, `#save` ~`:306-333`). The dashboard cannot import `@waitron/layouts` at runtime; form-factor values are mirrored from `card-contracts.ts`. UI works in whole minutes; storage is seconds.

- [ ] **Step 1: Write the failing screen test** — rendering + KDS gating + save payload.

Assert: for a `phone-portrait` draft the timeout input renders; entering `5` minutes and saving passes `300` as the trailing positional `inactivityTimeoutSeconds` arg to `api.updateDeviceProfile(id, name, canvasId, capabilities, formFactor, 300)`; for a `kds` draft the input is not rendered and the save passes `null`. (The verbs are POSITIONAL — `updateDeviceProfile(id, name, canvasId, capabilities, formFactor)` / `createDeviceProfile(name, canvasId, capabilities, formFactor)` at `device-profiles-screen.ts:321-322`; the new arg is trailing. Follow the existing screen test's harness for mounting the Lit element and stubbing `api`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/dashboard test -- device-profiles-screen`
Expected: FAIL.

- [ ] **Step 3: Add draft state + input.** Add `draftInactivityMinutes: number | null` (`:156`-area). In `#renderEditor`, render a `wt-input type="number" min="1"` labelled by a new i18n key, shown only when `this.draftFormFactor !== "kds"`. In `#save`, compute `inactivityTimeoutSeconds = draftFormFactor === "kds" || draftInactivityMinutes == null ? null : draftInactivityMinutes * 60` and pass it to the API verbs. When loading a profile for edit, seed `draftInactivityMinutes` from `profile.inactivityTimeoutSeconds == null ? null : profile.inactivityTimeoutSeconds / 60`.

- [ ] **Step 4: Extend the client verbs** in `client.ts`: `createDeviceProfile`/`updateDeviceProfile` take `inactivityTimeoutSeconds: number | null` as a new TRAILING positional parameter (they are positional today) and include it in the request body; the profile read type gains the field.

- [ ] **Step 5: Add i18n strings** (`device_profiles.inactivity_timeout_label` etc.) in English and Spanish. (Copy decision for the Spanish label is an owner follow-up; use a clear provisional "Cierre de sesión automático (minutos)".)

- [ ] **Step 6: Run the suite**

Run: `pnpm --filter @waitron/dashboard test:coverage`
Expected: PASS (browser-mode; check machine headroom first per CLAUDE.md §2).

- [ ] **Step 7: Verify + commit**

Run: `pnpm --filter @waitron/dashboard typecheck && pnpm format:check`

```bash
git add apps/dashboard/src/screens/device-profiles-screen.ts apps/dashboard/src/api/client.ts apps/dashboard/src/i18n/strings.ts apps/dashboard/src/screens/device-profiles-screen.test.ts
git commit -s -m "feat(dashboard): edit a device profile's inactivity timeout (hidden for KDS)"
```

---

### Task 9: Till session-activity controller — wake lock + idle logout

**Files:**
- Create: `apps/till/src/session-activity.ts` (a framework-free controller) + `apps/till/src/session-activity.test.ts`
- Modify: `apps/till/src/till-app.ts` (wire it into the lifecycle, login/logout, and boot payload)

**Interfaces:**
- Consumes: `inactivityTimeoutSeconds` from the boot payload; `handheldMode`/`deviceMode`/`kind` runtime flags; `#onLogout` (drop-and-lock).
- Produces:
  - `class SessionActivity` with `configure({ loggedIn: boolean; kind: DeviceKind; timeoutSeconds: number | null; onIdle: () => void })`, `noteInteraction()`, `start()`, `stop()`.
  - Wake-lock behaviour: KDS (`kds_station`) holds the lock whenever active; a session device holds it while `loggedIn`. Idle-logout: only when `kind !== "kds_station"`, `loggedIn`, and `timeoutSeconds != null`.

**Background:** No idle/wake-lock code exists in the till today (greenfield). The Wake Lock API needs a secure context and drops the lock when the tab hides (re-acquire on `visibilitychange`). Root element hooks: `connectedCallback` (`:247`), `disconnectedCallback` (`:252`), `#onLoggedIn` (`:835`), `#onLogout` (`:2119`), `#boot` (reads identity/boot payload).

- [ ] **Step 1: Write the failing controller test** (inject a fake wake-lock + fake clock):

`apps/till/src/session-activity.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { SessionActivity } from "./session-activity.js";

function fakeWakeLock() {
  const released: boolean[] = [];
  const sentinel = { released: false, release: vi.fn(async () => { released.push(true); }) };
  return { request: vi.fn(async () => sentinel), sentinel, released };
}

describe("SessionActivity", () => {
  it("acquires the wake lock while a session device is logged in, releases on logout", async () => {
    const wl = fakeWakeLock();
    const sa = new SessionActivity({ wakeLock: wl as never, now: () => 0, setTimer: () => 0, clearTimer: () => {} });
    sa.configure({ loggedIn: true, kind: "handheld", timeoutSeconds: null, onIdle: () => {} });
    await sa.start();
    expect(wl.request).toHaveBeenCalledTimes(1);
    sa.configure({ loggedIn: false, kind: "handheld", timeoutSeconds: null, onIdle: () => {} });
    await Promise.resolve();
    expect(wl.sentinel.release).toHaveBeenCalled();
  });

  it("fires onIdle after the timeout with no interaction, and not for KDS", () => {
    let fn: (() => void) | undefined;
    let now = 0;
    const timers = { setTimer: (f: () => void) => { fn = f; return 1; }, clearTimer: () => { fn = undefined; }, now: () => now };
    const onIdle = vi.fn();
    const sa = new SessionActivity({ wakeLock: { request: async () => ({ released: false, release: async () => {} }) } as never, ...timers });
    sa.configure({ loggedIn: true, kind: "handheld", timeoutSeconds: 300, onIdle });
    sa.start();
    now = 300_000; fn?.();
    expect(onIdle).toHaveBeenCalledTimes(1);

    onIdle.mockClear();
    sa.configure({ loggedIn: true, kind: "kds_station", timeoutSeconds: 300, onIdle });
    fn?.();
    expect(onIdle).not.toHaveBeenCalled(); // KDS is exempt
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/till test -- session-activity`
Expected: FAIL — `./session-activity.js` not found.

- [ ] **Step 3: Implement `SessionActivity`** with injected `wakeLock` (`navigator.wakeLock` by default, feature-detected → no-op), `now`/`setTimer`/`clearTimer` (real `Date.now`/`setTimeout`/`clearTimeout` by default). Acquire/release the sentinel per the rules above; re-acquire on a `reacquire()` call (wired to `visibilitychange`); `noteInteraction()` resets the idle timer; `onIdle` fires only for a session device with a set timeout.

- [ ] **Step 4: Wire it into `till-app.ts`.** Construct a `SessionActivity` in the element; in `connectedCallback` add `pointerdown`/`keydown` listeners (→ `noteInteraction()`) and a `visibilitychange` listener (→ `reacquire()`), removed in `disconnectedCallback`; call `configure(...)` from `#onLoggedIn`, `#onLogout`, and after `#boot` sets `handheldMode`/`deviceMode` and reads `inactivityTimeoutSeconds`; `onIdle` calls the existing `#onLogout` path. Store `inactivityTimeoutSeconds` from the boot payload on a field.

- [ ] **Step 5: Run the suites** (unit + the till-app tests that touch login/logout)

Run: `pnpm --filter @waitron/till test:coverage`
Expected: PASS. Add a small till-app test asserting a boot with a handheld + 300 s configures the controller and that `#onLogout` stops it. (Guard the wake-lock feature-detect so jsdom/no-`navigator.wakeLock` is a clean no-op.)

- [ ] **Step 6: Verify + commit**

Run: `pnpm --filter @waitron/till typecheck && pnpm format:check`

```bash
git add apps/till/src/session-activity.ts apps/till/src/session-activity.test.ts apps/till/src/till-app.ts
git commit -s -m "feat(till): hold a screen wake lock and idle-logout session devices (KDS exempt)"
```

---

### Task 10: HTTPS-side trust detector (minimal)

**Files:**
- Modify: `apps/till/src/main.ts` or the till boot path (a pre-render secure-context check)
- Create: `apps/till/src/trust-check.ts` + `apps/till/src/trust-check.test.ts`

**Interfaces:**
- Produces: `isTrustBroken(nav = navigator): Promise<boolean>` and a small render that, when trust is broken for a click-through user, shows a message + link to `http://<host>` (the plain-HTTP landing page from Task 3) instead of the till.

**Background:** The spike found the browser's own interstitial fires before our JS on an untrusted origin, so this only helps a user who already clicked through; the plain-HTTP landing page is the load-bearing surface. Keep this small (spec §3.3 "nice-to-have"). Signal: `navigator.serviceWorker.register()` throwing `SecurityError` on a click-through origin (belief; unverified on-device — flag it).

- [ ] **Step 1: Write the failing test** — `isTrustBroken` returns true when a stubbed `serviceWorker.register` rejects with a `SecurityError`, false when it resolves; and false (skip) when `serviceWorker` is absent.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/till test -- trust-check`
Expected: FAIL.

- [ ] **Step 3: Implement `trust-check.ts`** — feature-detect `navigator.serviceWorker`; attempt a no-op registration; return `true` only on `SecurityError`, else `false`; never throw. Register a real no-op SW file only if needed, else attempt `register("/sw-probe.js")` and treat network/404 as "not broken".

- [ ] **Step 4: Wire it into the till boot** — before the first render, if `isTrustBroken()` resolves true, render a minimal instructions panel linking to `http://${location.hostname}${landingPortSuffix}` (the plain-HTTP landing page) instead of `<till-app>`. Keep it behind a guard so a trusted origin is unaffected.

- [ ] **Step 5: Run the suite + verify**

Run: `pnpm --filter @waitron/till test:coverage && pnpm --filter @waitron/till typecheck && pnpm format:check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/till/src/trust-check.ts apps/till/src/trust-check.test.ts apps/till/src/main.ts
git commit -s -m "feat(till): show trust instructions when the box CA is not yet trusted (click-through)"
```

---

### Task 11: Commit the openssl name-constraint spike harness

**Files:**
- Create: `scripts/name-constraints-spike.sh` (the reproducible desktop harness from spec §2)

**Interfaces:**
- Produces: a documented, runnable script that mints a name-constrained root + leaves A/B/C and runs `openssl verify`, matching the desktop rows in spec §6.

**Background:** Spec §2 says the harness is "kept in the repo when the spike lands." The programmatic proof lives in Task 1's `name-constraints.test.ts`; this is the human-runnable openssl script for re-checking a browser/OS row.

- [ ] **Step 1: Write `scripts/name-constraints-spike.sh`** — mint the root (`nameConstraints=critical,permitted;DNS:waitron.local,permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0,permitted;DNS:localhost,permitted;IP:127.0.0.0/255.0.0.0`), leaf A (`waitron.local` + a `192.168.x` SAN, must verify OK), leaf B (`example.com`, must be refused), print a PASS/FAIL summary. Header comment: what it proves, the failing case stated first (spec §2), and that it needs `openssl` only.

- [ ] **Step 2: Run it**

Run: `bash scripts/name-constraints-spike.sh`
Expected: prints leaf A OK, leaf B refused ("permitted subtree violation"), exits 0 on the expected split.

- [ ] **Step 3: Verify + commit**

Run: `pnpm format:check` (shell scripts are not linted by eslint; confirm no root gate breaks)

```bash
git add scripts/name-constraints-spike.sh
git commit -s -m "test: commit the name-constraint openssl spike harness (spec §2)"
```

---

## Self-Review

**Spec coverage (§3 build + §8):**
- §3.1 manifest → Tasks 4, 5. §3.2 name-constrain the CA → Task 1. §3.3 trust flow (plain-HTTP landing, no HSTS, HTTPS detector) → Tasks 2, 3, 10. §3.4 wake lock → Task 9. §3.5 acceptance on real devices → OWNER (out of scope; noted). §2 spike harness → Task 11. §8 inactivity timeout → Tasks 6, 7, 8, 9. Recovery-mode landing → deferred with a recorded TODO (Task 3 step 7). ✅
- Not built here (correctly): the bring-your-own-domain option (§4, back-burner); the iOS/Android on-device spike rows (owner).

**Placeholder scan:** no "TBD"/"handle edge cases"; each code step carries real code or an exact edit locus. Line numbers are approximate anchors ("~") and the implementer confirms against the file.

**Type consistency:** `inactivityTimeoutSeconds` (seconds, `number | null`) is the wire/storage name across Tasks 6–9; the dashboard converts to/from whole minutes locally (Task 8). `validateInactivityTimeout(value, formFactor)` and `SessionActivity.configure({ loggedIn, kind, timeoutSeconds, onIdle })` are used consistently. `renderTrustPage` / `CA_CONTENT_TYPE` / `CA_FILENAME` are produced in Task 2 and consumed in Task 3.

**Open decisions flagged for owner review at land:** the seeded 300 s handheld default; whether idle-logout is offered on the counter `till` form factor as well as handheld (plan allows it when a timeout is set; KDS always exempt); the Spanish label copy; the recovery-mode landing listener deferral; and that on-device Android install (no service worker) and the iOS trust rows remain owner phone-row checks.
