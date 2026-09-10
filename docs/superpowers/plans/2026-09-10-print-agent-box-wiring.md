# Print Agent Box Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A box built from `main` runs the print agent beside the server, on by default, trusting the box's self-signed certificate, so a single-box venue gets central printing with nothing typed.

**Architecture:** A second `print-agent` build target in `deploy/Dockerfile` publishes `ghcr.io/clintongormley/waitron-print-agent`; an on-by-default compose service runs it with a hot-plug-safe read-only `/dev` mount; and a new `server-ca.ts` in the agent fetches the box CA from the landing listener's `/ca.crt` and pins it alongside Node's public roots so `fetch` to `https://127.0.0.1` verifies. CI publishes and smokes both images.

**Tech Stack:** Node 26 (slim/Debian), TypeScript, undici (CA pinning), Docker + compose, Hono (existing agent setup page), Vitest, GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-09-10-print-agent-box-wiring-design.md](../specs/2026-09-10-print-agent-box-wiring-design.md) — read it alongside this plan; every task argues from it.

## Global Constraints

Exact values, copied from the spec — every task's requirements include these:

- Agent image base: `node:26-slim` (matches the app image; Debian `apt`, not Alpine).
- CA-pinning dependency: `undici` at `^8.7.0` (the version `apps/server` and `packages/fiscal-verifactu` already pin).
- Published agent image: `ghcr.io/clintongormley/waitron-print-agent`, tags `{sha-<7>, main[, <version>]}` — the same tag logic as the app image.
- Compose env vars: `WAITRON_PRINT_AGENT_IMAGE` (default `ghcr.io/clintongormley/waitron-print-agent:main`), `WAITRON_PRINT_AGENT_SERVER_URL` (default `https://127.0.0.1`).
- USB device access shape (measured on the box — do not "simplify"): `- /dev:/dev:ro` bind, `device_cgroup_rules: ["c 180:* rwm"]`, `group_add: ["7"]`. **No `devices:` line** (it refuses to start with no printer).
- Setup page / healthcheck port: `9110`, path `/status.json`.
- Pinned CA on disk: `<state-dir>/server-ca.crt`, mode `0644` (a public certificate, not a secret). State dir default `/var/lib/waitron-print-agent`.
- The box's CA route: `GET http://<host>/ca.crt` (the plain-HTTP landing listener, port 80).
- `apps/print-agent/Dockerfile` and `apps/print-agent/.dockerignore` are DELETED — one image definition.
- The app `runtime` stage stays the LAST stage in `deploy/Dockerfile` (a bare `docker build` must still yield the app image).
- No attribution lines in commit messages. Every commit is `git commit -s`.

---

### Task 1: The CA-pinning module (`server-ca.ts`)

The heart of the change: fetch the box's self-signed CA over plain HTTP and build a `fetch` that trusts it **in addition to** Node's public roots, so an agent that later follows a promoted cloud primary with a normal public certificate still verifies. Fully unit-tested and hermetic.

**Files:**
- Modify: `apps/print-agent/package.json` (add the `undici` dependency)
- Create: `apps/print-agent/src/server-ca.ts`
- Test: `apps/print-agent/src/server-ca.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ServerTrustOptions {
    serverUrl: string | undefined;          // the configured WAITRON_SERVER_URL, or undefined
    stateDir: string;                        // where server-ca.crt is persisted
    fetch?: typeof fetch;                    // base fetch for API calls (default: global fetch)
    caEndpointFetch?: typeof fetch;          // fetch for the plain-HTTP /ca.crt GET (default: global fetch)
    now?: () => number;                      // default: Date.now
    log?: (msg: string, fields?: Record<string, unknown>) => void;
  }
  // Returns the fetch the Host is given. When a box CA is trusted it sets an undici dispatcher on
  // every request; on a certificate-verification failure it refetches /ca.crt (≤ once/hour) and
  // retries once if the CA changed. When serverUrl is http: or /ca.crt is absent, it is a pass-through.
  export async function createServerTrustingFetch(opts: ServerTrustOptions): Promise<typeof fetch>;
  ```
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Add the `undici` dependency**

In `apps/print-agent/package.json`, add to `dependencies` (keep alphabetical among existing entries `@hono/node-server`, `@waitron/print-agent`, `hono`):
```json
    "undici": "^8.7.0"
```
Then from the repo root: `pnpm install` (updates the lockfile).

- [ ] **Step 2: Write the failing test**

Create `apps/print-agent/src/server-ca.test.ts`. It mints an in-process CA + `localhost` server certificate with `node-forge` (the shape in `apps/server/src/testing/tls.ts`), starts a real HTTPS server, and drives the returned fetch against it. `node-forge` is already a workspace dependency (used by `apps/server`'s test TLS); add it to `apps/print-agent`'s `devDependencies` as `"node-forge": "^1.3.1"` and `"@types/node-forge": "^1.3.0"` (matching `apps/server`'s pins; both resolve to the installed 1.3.14) in this same step, then `pnpm install`.

```ts
import { createServer, type Server } from "node:https";
import { rootCertificates } from "node:tls";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import forge from "node-forge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServerTrustingFetch } from "./server-ca.js";

/** A CA + a leaf for `commonName`/`127.0.0.1`, returned as PEMs and a usable key. */
function mintCa(leafCn: string): { caPem: string; serverKeyPem: string; serverCertPem: string } {
  const caKeys = forge.pki.rsa.generateKeyPair(2048);
  const ca = forge.pki.createCertificate();
  ca.publicKey = caKeys.publicKey;
  ca.serialNumber = "01";
  ca.validity.notBefore = new Date(2026, 0, 1);
  ca.validity.notAfter = new Date(2030, 0, 1);
  ca.setSubject([{ name: "commonName", value: "test-ca" }]);
  ca.setIssuer([{ name: "commonName", value: "test-ca" }]);
  ca.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, digitalSignature: true },
  ]);
  ca.sign(caKeys.privateKey, forge.md.sha256.create());

  const serverKeys = forge.pki.rsa.generateKeyPair(2048);
  const leaf = forge.pki.createCertificate();
  leaf.publicKey = serverKeys.publicKey;
  leaf.serialNumber = "02";
  leaf.validity.notBefore = new Date(2026, 0, 1);
  leaf.validity.notAfter = new Date(2030, 0, 1);
  leaf.setSubject([{ name: "commonName", value: leafCn }]);
  leaf.setIssuer([{ name: "commonName", value: "test-ca" }]);
  leaf.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }, { type: 7, ip: "127.0.0.1" }] },
  ]);
  leaf.sign(caKeys.privateKey, forge.md.sha256.create());

  return {
    caPem: forge.pki.certificateToPem(ca),
    serverKeyPem: forge.pki.privateKeyToPem(serverKeys.privateKey),
    serverCertPem: forge.pki.certificateToPem(leaf),
  };
}

function startHttps(material: { serverKeyPem: string; serverCertPem: string }): Promise<{ server: Server; origin: string }> {
  return new Promise((resolve) => {
    const server = createServer(
      { key: material.serverKeyPem, cert: material.serverCertPem },
      (_req, res) => { res.writeHead(200); res.end("ok"); },
    );
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, origin: `https://localhost:${port}` });
    });
  });
}

/** A caEndpointFetch stub. `pem` is a fixed string or a getter (for rotation, where the served CA
 * changes over the test); `status` overrides the 200 for the error-path cases. Records every URL. */
function caResponder(
  pem: string | (() => string),
  opts: { status?: number } = {},
): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const body = typeof pem === "function" ? pem() : pem;
    return new Response(body, { status: opts.status ?? 200 });
  }) as typeof fetch;
  return { fetch: fn, calls };
}

describe("createServerTrustingFetch", () => {
  let stateDir: string;
  const servers: Server[] = [];
  beforeEach(async () => { stateDir = await mkdtemp(join(tmpdir(), "agent-ca-")); });
  afterEach(() => { for (const s of servers) s.close(); servers.length = 0; });

  it("without the box CA, a request to the self-signed server fails verification (the bug this fixes)", async () => {
    const material = mintCa("localhost");
    const { server, origin } = await startHttps(material);
    servers.push(server);
    // caEndpointFetch hands back a DIFFERENT, unrelated CA — so the box's real CA is never trusted
    // and verification must fail. This is the negative control: it proves we are verifying, not
    // accepting every certificate.
    const unrelated = mintCa("localhost").caPem;
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir,
      caEndpointFetch: caResponder(unrelated).fetch,
    });
    await expect(trusting(`${origin}/x`)).rejects.toThrow();
  });

  it("with the box CA fetched from /ca.crt, the same request succeeds", async () => {
    const material = mintCa("localhost");
    const { server, origin } = await startHttps(material);
    servers.push(server);
    const responder = caResponder(material.caPem);
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir,
      caEndpointFetch: responder.fetch,
    });
    const res = await trusting(`${origin}/x`);
    expect(res.status).toBe(200);
    // It asked the plain-HTTP landing route on port 80 of the server's host.
    expect(responder.calls).toEqual(["http://localhost/ca.crt"]);
    // And it persisted the CA for a restart to trust immediately.
    expect(await readFile(join(stateDir, "server-ca.crt"), "utf8")).toBe(material.caPem);
  });

  it("retains Node's public roots (does not disable verification)", async () => {
    // A server whose CA is NOT the one we fetch must still fail — proving the trust set is
    // (public roots + box CA), not "accept anything". Public roots are present because the module
    // spreads tls.rootCertificates; this asserts the negative half on real TLS.
    const boxMaterial = mintCa("localhost");
    const otherServer = mintCa("localhost"); // a different CA, not fetched
    const { server, origin } = await startHttps(otherServer);
    servers.push(server);
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir,
      caEndpointFetch: caResponder(boxMaterial.caPem).fetch,
    });
    await expect(trusting(`${origin}/x`)).rejects.toThrow();
    expect(rootCertificates.length).toBeGreaterThan(0); // guards the spread source exists
  });

  it("on a verification failure, refetches the CA and retries once when it changed (rotation)", async () => {
    // The reimaged-box path, exercised for real — the ONLY case that runs the catch → refresh → retry
    // branch. Boot pins the OLD CA (the endpoint still serves old at clock=0, so no change at boot),
    // while the HTTPS server already presents the NEW leaf. An hour later the endpoint serves the NEW
    // CA. The first request FAILS verification (the pinned old CA cannot verify the new leaf), the
    // module refetches, sees the CA changed, rebuilds trust, and the retry succeeds.
    //
    // Boot must serve OLD (not NEW): if the endpoint served NEW at boot, boot's own refresh() would
    // pin it before any request and the retry branch would never run — the vacuous-pass this case
    // exists to avoid (fresh-review I1).
    const oldMaterial = mintCa("localhost");
    await writeFile(join(stateDir, "server-ca.crt"), oldMaterial.caPem, { mode: 0o644 });
    const newMaterial = mintCa("localhost");
    const { server, origin } = await startHttps(newMaterial);
    servers.push(server);
    let clock = 0;
    let served = oldMaterial.caPem; // the box is not reimaged yet
    const responder = caResponder(() => served);
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir,
      caEndpointFetch: responder.fetch,
      now: () => clock,
    });
    clock = 60 * 60 * 1000 + 1; // an hour passes; the box is reimaged and now serves the new CA
    served = newMaterial.caPem;
    const res = await trusting(`${origin}/x`);
    expect(res.status).toBe(200);
    // boot fetch (old, no change) + one refetch on the verify failure (new).
    expect(responder.calls.length).toBe(2);
  });

  it("throttles the refetch to at most once per hour", async () => {
    const material = mintCa("localhost");
    const { server, origin } = await startHttps(material);
    servers.push(server);
    // The endpoint keeps handing back an UNRELATED CA, so every request fails verification and would
    // refetch every time if unthrottled. The clock must ADVANCE between boot and the first failure —
    // a constant clock collides boot's own refresh() (which sets lastFetchAt) with the post-failure
    // refetch, throttling it away and making the .toBe(2) below impossible (fresh-review B1). So:
    // boot fetches at clock=0 (lastFetchAt=0); advance past the hour so the FIRST failure refetches;
    // the SECOND failure is inside that new hour and must NOT.
    let clock = 0;
    const responder = caResponder(mintCa("localhost").caPem);
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir,
      caEndpointFetch: responder.fetch,
      now: () => clock,
    });
    clock = 60 * 60 * 1000 + 1; // past the hour, so the next failure is allowed to refetch
    await expect(trusting(`${origin}/x`)).rejects.toThrow();
    await expect(trusting(`${origin}/x`)).rejects.toThrow();
    // boot fetch (clock=0) + one refetch on the first failure; the second is inside the hour → no fetch.
    expect(responder.calls.length).toBe(2);
  });

  it("is a pass-through for an http server URL (no CA to fetch)", async () => {
    const base = (async () => new Response("plain", { status: 200 })) as typeof fetch;
    const responder = caResponder("unused");
    const trusting = await createServerTrustingFetch({
      serverUrl: "http://127.0.0.1:8080",
      stateDir,
      fetch: base,
      caEndpointFetch: responder.fetch,
    });
    const res = await trusting("http://127.0.0.1:8080/x");
    expect(res.status).toBe(200);
    expect(responder.calls).toEqual([]); // never asked for a CA
  });

  it("is a pass-through when serverUrl is undefined (unconfigured agent)", async () => {
    const base = (async () => new Response("", { status: 204 })) as typeof fetch;
    const trusting = await createServerTrustingFetch({ serverUrl: undefined, stateDir, fetch: base });
    expect((await trusting("http://x/y")).status).toBe(204);
  });

  it("ignores a non-200 from /ca.crt and pins nothing (operator-cert box has no CA to serve)", async () => {
    // Covers refresh()'s `!res.ok` branch. A 404 must not pin a body; the agent falls back to public
    // roots, so the self-signed server still fails verification — proving nothing was pinned.
    const material = mintCa("localhost");
    const { server, origin } = await startHttps(material);
    servers.push(server);
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir,
      caEndpointFetch: caResponder("not found", { status: 404 }).fetch,
    });
    await expect(trusting(`${origin}/x`)).rejects.toThrow();
    await expect(readFile(join(stateDir, "server-ca.crt"), "utf8")).rejects.toThrow();
  });

  it("ignores an empty /ca.crt body", async () => {
    // Covers refresh()'s `pem.trim() === ""` branch: a blank body is not a CA and is never persisted.
    const material = mintCa("localhost");
    const { server, origin } = await startHttps(material);
    servers.push(server);
    const trusting = await createServerTrustingFetch({
      serverUrl: origin,
      stateDir,
      caEndpointFetch: caResponder("   ").fetch,
    });
    await expect(trusting(`${origin}/x`)).rejects.toThrow();
    await expect(readFile(join(stateDir, "server-ca.crt"), "utf8")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @waitron/print-agent-app test server-ca`
Expected: FAIL — `Cannot find module './server-ca.js'`.

- [ ] **Step 4: Write the implementation**

Create `apps/print-agent/src/server-ca.ts`:
```ts
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { rootCertificates } from "node:tls";
import { Agent } from "undici";

/** TLS verification failures undici surfaces on `error.cause.code` — the cases a reimaged box (new
 * self-signed CA) produces. A non-verify failure (refused, DNS, timeout) is NOT in this set, so it is
 * rethrown untouched for the loop to fold into "unreachable". */
const VERIFY_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_SIGNATURE_FAILURE",
]);

const CA_FILE = "server-ca.crt";
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // once per hour

export interface ServerTrustOptions {
  serverUrl: string | undefined;
  stateDir: string;
  fetch?: typeof fetch;
  caEndpointFetch?: typeof fetch;
  now?: () => number;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

function isVerifyError(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown } })?.cause;
  return typeof cause?.code === "string" && VERIFY_ERROR_CODES.has(cause.code);
}

/** `http://<host>/ca.crt` — the plain-HTTP landing route (port 80), for an https server URL only. */
function caUrlFor(serverUrl: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  return `http://${parsed.hostname}/ca.crt`;
}

export async function createServerTrustingFetch(opts: ServerTrustOptions): Promise<typeof fetch> {
  const baseFetch = opts.fetch ?? fetch;
  const caFetch = opts.caEndpointFetch ?? fetch;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((): void => {});
  const caPath = join(opts.stateDir, CA_FILE);
  const caUrl = opts.serverUrl === undefined ? undefined : caUrlFor(opts.serverUrl);

  // A plain-http or unconfigured agent needs no CA work: hand back the base fetch untouched.
  if (caUrl === undefined) return baseFetch;

  let caPem: string | undefined;
  let dispatcher: Agent | undefined;
  let lastFetchAt = -Infinity;

  const rebuild = (): void => {
    dispatcher?.close().catch(() => {});
    dispatcher =
      caPem === undefined
        ? undefined
        : new Agent({ connect: { ca: [...rootCertificates, caPem] } });
  };

  // Persisted CA first, so a restart trusts before the landing listener is even reachable.
  try {
    caPem = await readFile(caPath, "utf8");
    rebuild();
  } catch {
    /* none yet */
  }

  /** Fetch /ca.crt, throttled to once per hour. Returns true when the CA bytes changed. */
  const refresh = async (): Promise<boolean> => {
    if (now() - lastFetchAt < REFRESH_INTERVAL_MS) return false;
    lastFetchAt = now();
    let pem: string;
    try {
      const res = await caFetch(caUrl);
      if (!res.ok) return false;
      pem = await res.text();
    } catch {
      return false;
    }
    if (pem === caPem || pem.trim() === "") return false;
    const changed = caPem !== undefined;
    caPem = pem;
    rebuild();
    await mkdir(opts.stateDir, { recursive: true });
    const tmp = `${caPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, pem, { mode: 0o644 });
    await rename(tmp, caPath);
    log(changed ? "server CA changed" : "server CA pinned", { caUrl });
    return true;
  };

  // One best-effort refresh at boot (covers a first run with no persisted CA).
  await refresh();

  const trusting = (async (input, init) => {
    const withDispatcher = (): RequestInit =>
      dispatcher === undefined ? (init ?? {}) : { ...init, dispatcher } as RequestInit;
    try {
      return await baseFetch(input as RequestInfo | URL, withDispatcher());
    } catch (error) {
      // A cert-verification failure MIGHT be a rotated CA: refetch (throttled) and retry once.
      if (isVerifyError(error) && (await refresh())) {
        return baseFetch(input as RequestInfo | URL, withDispatcher());
      }
      throw error;
    }
  }) as typeof fetch;

  return trusting;
}
```

Note on the `dispatcher` field: Node's global `fetch` reads a per-request `dispatcher` from the init bag (undici extension). The cast keeps TypeScript's stock `RequestInit` happy.

- [ ] **Step 5: Run the tests to verify they pass, with coverage**

Run: `pnpm --filter @waitron/print-agent-app test:coverage`
Expected: PASS — all nine `createServerTrustingFetch` cases, and the package stays above its 90/85 floor. The nine cases hit every branch of `server-ca.ts` except `caUrlFor`'s malformed-URL `catch` (unreachable in production — `config.ts` validates `serverUrl` before this runs). If coverage flags that one branch, add a pass-through case with `serverUrl: "https://"` (which `new URL` rejects) asserting the base fetch is returned unchanged; do NOT lower the threshold.

- [ ] **Step 6: Typecheck, lint, format**

Run: `pnpm --filter @waitron/print-agent-app typecheck && pnpm --filter @waitron/print-agent-app lint && pnpm format:check`
Expected: clean. Typecheck is also where the `{ ...init, dispatcher } as RequestInit` cast is confirmed against the repo tsconfig (`@types/node`'s `RequestInit` already declares `dispatcher`; the cast bridges the standalone `undici` `Agent` to it). If `format:check` flags the new files, run `pnpm format` and re-check.

- [ ] **Step 7: Commit**

```bash
git add apps/print-agent/package.json apps/print-agent/src/server-ca.ts apps/print-agent/src/server-ca.test.ts pnpm-lock.yaml
git commit -s -m "feat(print-agent): pin the box's self-signed CA fetched from /ca.crt

The agent's fetch trusts the box CA (fetched over plain HTTP from the
landing listener) in addition to Node's public roots, so https://127.0.0.1
verifies while a promoted cloud primary's public cert still works. Refetches
once/hour on a verification failure to survive a reimaged box's new CA."
```

---

### Task 2: Wire the trusting fetch into `bin.ts`

`bin.ts` is the hand-wired boot, excluded from coverage and exercised by a container run — so this task has no unit test; its gate is typecheck + the existing agent tests staying green.

**Files:**
- Modify: `apps/print-agent/src/bin.ts`

**Interfaces:**
- Consumes: `createServerTrustingFetch` (Task 1).

- [ ] **Step 1: Build the trusting fetch and pass it to the host**

In `apps/print-agent/src/bin.ts`, after `const state = new FileState(env.stateDir);` and before `createContainerHost`, build the fetch and inject it. Replace:
```ts
const host = createContainerHost({
  env,
  state,
  onStatus: (next) => {
    status = next;
  },
});
```
with (note the `log` sink writes to `console` directly — `host` is not yet declared here, so the closure cannot reference `host.log`):
```ts
// Trust the box's self-signed CA (fetched from its landing listener's /ca.crt) on top of Node's
// public roots, so https://127.0.0.1 verifies and a promoted cloud primary's public cert still does.
const trustingFetch = await createServerTrustingFetch({
  serverUrl: env.serverUrl,
  stateDir: env.stateDir,
  log: (msg, fields) => console.info(JSON.stringify({ level: "info", msg, ...fields })),
});
const host = createContainerHost({
  env,
  state,
  fetch: trustingFetch,
  onStatus: (next) => {
    status = next;
  },
});
```
Add the import at the top, beside the other local imports:
```ts
import { createServerTrustingFetch } from "./server-ca.js";
```

- [ ] **Step 2: Typecheck and run the package's tests**

Run: `pnpm --filter @waitron/print-agent-app typecheck && pnpm --filter @waitron/print-agent-app test`
Expected: typecheck clean; all existing tests still pass (bin.ts is not covered, but a type error here fails typecheck).

- [ ] **Step 3: Commit**

```bash
git add apps/print-agent/src/bin.ts
git commit -s -m "feat(print-agent): use the CA-trusting fetch in the container boot"
```

---

### Task 3: The second image target in `deploy/Dockerfile`

Add the agent build + a runtime stage; delete the standalone Dockerfile.

**Files:**
- Modify: `deploy/Dockerfile`
- Delete: `apps/print-agent/Dockerfile`, `apps/print-agent/.dockerignore`
- Modify: `package.json` (root — add `build:image:print-agent`)

- [ ] **Step 1: Add the agent build to the `build` stage**

In `deploy/Dockerfile`, extend the existing build line (lines 26-29) so the agent bundle is emitted too:
```dockerfile
RUN pnpm --filter @waitron/server build \
  && pnpm --filter @waitron/till build \
  && pnpm --filter @waitron/dashboard build \
  && pnpm --filter @waitron/setup build \
  && pnpm --filter @waitron/print-agent-app build
```

- [ ] **Step 2: Add the `print-agent` runtime stage**

Insert a new stage BETWEEN the `build` stage and the `runtime` stage (so `runtime` stays last). After the build stage's final `RUN` (currently line 29) and before `# ---…Runtime stage`, add:
```dockerfile
# ---------------------------------------------------------------------------
# Print-agent stage — the box-local bridge to USB/network/Bluetooth printers.
# A SEPARATE image from the app (its own compose service), built with
# `--target print-agent`. bluez supplies bluetoothctl, which the Bluetooth
# pair path spawns; node:24-alpine never carried it. Runs as the unprivileged
# `node` user the base image already ships (uid 1000).
# ---------------------------------------------------------------------------
FROM node:26-slim AS print-agent
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends bluez; \
  rm -rf /var/lib/apt/lists/*
# The state volume's mount path, pre-created and chowned so a fresh named volume comes up writable by
# the non-root process (same rule as the app image's /var/lib/waitron paths).
RUN install -d -o node -g node /var/lib/waitron-print-agent
COPY --from=build --chown=node:node /src/apps/print-agent/dist/print-agent.js /app/print-agent.js
ENV NODE_ENV=production \
  WAITRON_STATE_DIR=/var/lib/waitron-print-agent \
  WAITRON_SETUP_PORT=9110
# Documentation only under network_mode: host (the port is not published via Docker) — kept from the
# standalone image so the setup port is visible in `docker inspect`.
EXPOSE 9110
USER node
WORKDIR /app
CMD ["node", "/app/print-agent.js"]
```

- [ ] **Step 3: Delete the standalone image files**

```bash
git rm apps/print-agent/Dockerfile apps/print-agent/.dockerignore
```

- [ ] **Step 4: Add the local build script**

In the root `package.json`, beside `"build:image"`, add:
```json
    "build:image:print-agent": "docker build -f deploy/Dockerfile --target print-agent -t waitron-print-agent:dev .",
```

- [ ] **Step 5: Build both targets and verify the agent image**

Run (the app image build proves `runtime` is still last and default; the agent build proves the new target):
```bash
docker build -f deploy/Dockerfile -t waitron:dev . >/dev/null && echo APP-OK
pnpm build:image:print-agent >/dev/null && echo AGENT-OK
docker run --rm --entrypoint sh waitron-print-agent:dev -c 'command -v bluetoothctl && ls -l /app/print-agent.js && id node && printenv WAITRON_SETUP_PORT'
```
Expected: `APP-OK`, `AGENT-OK`, then `bluetoothctl` found, the bundle present, `uid=1000(node)`, `9110`.

- [ ] **Step 6: Commit**

```bash
git add deploy/Dockerfile package.json
git commit -s -m "build(image): add a print-agent target to deploy/Dockerfile

Builds ghcr.io/clintongormley/waitron-print-agent from one workspace
install, with bluez for the Bluetooth pair path. Deletes the standalone
apps/print-agent/Dockerfile — one image definition, one build cache."
```

---

### Task 4: The compose service, `.env.example`, and README

Run the agent by default with the measured USB shape.

**Files:**
- Modify: `deploy/compose.yml`
- Modify: `deploy/.env.example`
- Modify: `deploy/README.md`

- [ ] **Step 1: Replace the commented block with a live service**

In `deploy/compose.yml`, remove the commented `# --- Print agent …` block (the lines from `# --- Print agent (Track P owed item, spec §2.2) ---` through `# A print_agent: named volume is added …`) and add a real service after the `mailpit` service, before the `networks:` block:
```yaml
  # The box-local bridge between the server and USB/network/Bluetooth printers (print-agent spec
  # 2026-09-10). On by default: the single-box venue is the common case, and the same-box agent joins
  # with nothing typed because WAITRON_SERVER_URL is the box's own loopback leaf, whose CA the agent
  # fetches from the landing listener's /ca.crt.
  print-agent:
    image: ${WAITRON_PRINT_AGENT_IMAGE:-ghcr.io/clintongormley/waitron-print-agent:main}
    restart: unless-stopped
    # Host networking so mDNS printer discovery answers on the venue LAN and the setup page binds 9110
    # on the box directly — same profile as the app service.
    network_mode: host
    # service_started, NOT service_healthy: the app is 503 on /health until provisioned, and the agent
    # follows the primary on its own once the server is up, so it need not wait for health.
    depends_on:
      app:
        condition: service_started
    environment:
      # The box's own origin; the agent trusts its self-signed leaf via the fetched CA. Overridable
      # for an agent that runs on a separate Pi and must name the box's LAN address instead.
      WAITRON_SERVER_URL: ${WAITRON_PRINT_AGENT_SERVER_URL:-https://127.0.0.1}
    # USB printer access, hot-plug safe. Measured on the real box 2026-09-10 (spec §5): a hard
    # `devices:` line refuses to start with no printer; a /dev/usb subdirectory mount goes stale on
    # re-plug. Mounting the whole /dev read-only plus the usblp char-device major (180) lets the node
    # user reach /dev/usb/lpN after a hot-plug, while :ro refuses mknod and the cgroup rule denies any
    # other device class.
    device_cgroup_rules:
      - "c 180:* rwm"
    group_add:
      # gid 7 is `lp`, which owns the write bit on /dev/usb/lpN.
      - "7"
    volumes:
      - print_agent:/var/lib/waitron-print-agent
      - /dev:/dev:ro
      # BlueZ's system DBus socket for `bluetoothctl` scan/pair. Long syntax with create_host_path:
      # false so a host without DBus fails the mount loudly rather than having Docker create a
      # directory where the socket should be.
      - type: bind
        source: /run/dbus/system_bus_socket
        target: /run/dbus/system_bus_socket
        bind:
          create_host_path: false
    # No curl in a slim image, so an inline node http GET — the setup page's /status.json on 9110.
    healthcheck:
      test:
        - CMD
        - node
        - "-e"
        - "require('node:http').get({host:'127.0.0.1',port:9110,path:'/status.json'},(s)=>process.exit(s.statusCode===200?0:1)).on('error',()=>process.exit(1))"
      interval: 10s
      timeout: 5s
      start_period: 20s
      retries: 3
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "5"
```

- [ ] **Step 2: Add the `print_agent` volume**

In the `volumes:` block at the end of `deploy/compose.yml`, add `print_agent:` beside the others:
```yaml
volumes:
  db:
  state:
  logs:
  media:
  backups:
  mailpit:
  print_agent:
```

- [ ] **Step 3: Document the two new env vars in `.env.example`**

Append to `deploy/.env.example`:
```bash
# OPTIONAL. Run a locally built print-agent image instead of the published one
# (`pnpm build:image:print-agent` tags waitron-print-agent:dev).
# WAITRON_PRINT_AGENT_IMAGE=waitron-print-agent:dev

# OPTIONAL. The address the print agent follows. Defaults to the box's own loopback leaf
# (https://127.0.0.1), whose self-signed CA the agent fetches from the landing listener. Set it to the
# box's LAN name only when the agent runs on a SEPARATE machine next to the printer.
# WAITRON_PRINT_AGENT_SERVER_URL=https://box.example
```

- [ ] **Step 4: Update the README's container/volume inventory**

In `deploy/README.md`, change the opening sentence "A node is two containers: the Waitron app and its Postgres." to reflect three-plus-agent, and add the `print_agent` volume to the table. Replace the first paragraph:
```markdown
A node is a few containers: the Waitron app, its Postgres, a local mail capture, and the print agent.
Everything the node keeps lives in named Docker volumes, so `docker volume` is the whole of a box's
life — back those up and you have backed up the box.
```
And add the two rows the table is missing — `mailpit` (already stale: the table omits it) and `print_agent` — so the inventory matches the compose volumes block:
```markdown
| `mailpit`     | `/data`                        | the local dev/prepare mail inbox (account email captured when no SMTP credential exists)                |
| `print_agent` | `/var/lib/waitron-print-agent` | the print agent's join token, saved config, and the pinned box CA (`server-ca.crt`)                     |
```
(While here, correct the sentence "Everything the node keeps lives in five named Docker volumes" if that count appears — the volumes block now has seven. State the property, not the count: "in the named Docker volumes below".)

- [ ] **Step 5: Validate the compose file**

Run:
```bash
cd deploy && POSTGRES_PASSWORD=x docker compose config >/dev/null && echo COMPOSE-OK && cd ..
```
Expected: `COMPOSE-OK` (no interpolation or schema error; `print-agent` service and `print_agent` volume resolve).

- [ ] **Step 6: Commit**

```bash
git add deploy/compose.yml deploy/.env.example deploy/README.md
git commit -s -m "deploy: run the print agent by default, hot-plug-safe USB

An on-by-default compose service with /dev:/dev:ro + the usblp major-180
device rule (survives a printer re-plug; refuses mknod), a 9110 healthcheck,
and a print_agent volume for the token, config and pinned CA."
```

---

### Task 5: Pin the wiring in the root guard (`deploy-image-env.test.ts`)

The root guard reads text and pins copies of one fact against each other. Add pins so a "simplification" back to a stale device mount, a hard `devices:` line, or a resurrected standalone Dockerfile fails here.

**Files:**
- Modify: `scripts/deploy-image-env.test.ts`

**Interfaces:**
- Consumes: the compose service (Task 4), the Dockerfile target (Task 3).

- [ ] **Step 1: Write the failing pins**

In `scripts/deploy-image-env.test.ts`, add a new `describe` block after the existing `describe("the container image's environment", …)`. It reuses the module-level `DOCKERFILE`, `COMPOSE` and `IMAGE_SMOKE` constants already read at the top of the file, and adds a read of the workflow file if not present.
```ts
describe("the print-agent image and its compose wiring", () => {
  it("builds a print-agent target from deploy/Dockerfile", () => {
    expect(DOCKERFILE).toContain("FROM node:26-slim AS print-agent");
    // Emitted by the shared build stage — the source the COPY below pulls from.
    expect(DOCKERFILE).toContain("pnpm --filter @waitron/print-agent-app build");
    expect(DOCKERFILE).toContain(
      "COPY --from=build --chown=node:node /src/apps/print-agent/dist/print-agent.js /app/print-agent.js",
    );
    // The app runtime stage stays LAST, so a bare `docker build` still yields the app image.
    expect(DOCKERFILE.lastIndexOf("AS runtime")).toBeGreaterThan(
      DOCKERFILE.indexOf("AS print-agent"),
    );
  });

  it("runs the agent as an on-by-default compose service with the measured USB shape", () => {
    expect(COMPOSE).toContain("print-agent:");
    expect(COMPOSE).toContain(
      "image: ${WAITRON_PRINT_AGENT_IMAGE:-ghcr.io/clintongormley/waitron-print-agent:main}",
    );
    // The hot-plug-safe device shape, pinned so a subdirectory mount or a hard `devices:` line
    // (both of which the box receipts rejected, spec §5) fails here.
    expect(COMPOSE).toContain("/dev:/dev:ro");
    expect(COMPOSE).toContain('"c 180:* rwm"');
    expect(COMPOSE).not.toMatch(/^\s*devices:/m);
    // The state volume mount matches the agent stage's WAITRON_STATE_DIR ENV.
    expect(COMPOSE).toContain("print_agent:/var/lib/waitron-print-agent");
    expect(DOCKERFILE).toContain("WAITRON_STATE_DIR=/var/lib/waitron-print-agent");
  });

  it("has retired the standalone agent Dockerfile", () => {
    // One image definition. A resurrected file would build a second, drifting image.
    expect(() => read("apps/print-agent/Dockerfile")).toThrow();
  });

  it("smokes the print-agent target it ships", () => {
    expect(IMAGE_SMOKE).toContain("target: print-agent");
  });
});
```
Note: `read()` throws (via `readFileSync`) when the file is absent — that IS the "retired" assertion. If the existing `read` helper is defined to tolerate absence, use `existsSync` from `node:fs` instead; check the top of the file and match its style.

- [ ] **Step 2: Run and verify it passes (the changes from Tasks 3-4 satisfy it)**

Run: `pnpm --filter waitron-root test deploy-image-env` (or the root project's test command — check `package.json`; it is the root vitest project). If the repo runs root guards via `pnpm test` at root, use `pnpm vitest run scripts/deploy-image-env.test.ts`.
Expected: PASS.

- [ ] **Step 3: Prove the guard by deletion (CLAUDE.md §4)**

Temporarily change `/dev:/dev:ro` to `/dev/usb:/dev/usb` in `deploy/compose.yml`, re-run the test, and confirm the "measured USB shape" case FAILS. Then revert. (Do not commit the temporary break.)
Expected: RED on the break, GREEN after revert.

- [ ] **Step 4: Commit**

```bash
git add scripts/deploy-image-env.test.ts
git commit -s -m "test(deploy): pin the print-agent image and its hot-plug USB wiring"
```

---

### Task 6: The image smoke brings the agent up

CI's real-Linux smoke builds both targets, brings the agent up, and proves the wiring end to end (port 9110 answers with the compose-supplied server URL).

**Files:**
- Modify: `.github/workflows/image-smoke.yml`

- [ ] **Step 1: Build the agent target and set its image in the smoke `.env`**

In `.github/workflows/image-smoke.yml`, in the "Write the box's .env" step, add the agent image line:
```yaml
          {
            echo "POSTGRES_PASSWORD=$(openssl rand -hex 32)"
            echo "WAITRON_IMAGE=waitron:ci"
            echo "WAITRON_PRINT_AGENT_IMAGE=waitron-print-agent:ci"
          } > deploy/.env
```
After the existing "Build the image" step, add a second build step (it reuses the cached `build` stage, so it is seconds):
```yaml
      - name: Build the print-agent image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: deploy/Dockerfile
          target: print-agent
          platforms: linux/amd64
          load: true
          tags: waitron-print-agent:ci
          build-args: WAITRON_BUILD_ID=${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max,ignore-error=true
```

- [ ] **Step 2: Add port 9110 to the "already listening" guard**

In the "Refuse to smoke against something already listening" step, extend the port loop:
```yaml
          for port in 443 5432 9110; do
```

- [ ] **Step 3: Assert the agent answers on 9110 with the compose-supplied server URL**

After the existing "The box binds 443 as a non-root process" step, add:
```yaml
      - name: The print agent came up and picked up its server URL
        run: |
          set -euo pipefail
          # The whole point of the compose wiring: the agent process is running (the read-only /dev
          # mount, not a hard `devices:` line, is what lets it start on this printer-less runner), its
          # setup page answers on 9110, and it received WAITRON_SERVER_URL=https://127.0.0.1 from
          # compose. A failed CA fetch would still leave the page answering, so this asserts the
          # wiring, and the live box check (plan Task 9) asserts the join.
          agent=$(docker compose ps -q print-agent)
          [ "$(docker inspect -f '{{.State.Health.Status}}' "$agent")" = "healthy" ]
          code=$(curl -s -o status.json -w '%{http_code}' http://127.0.0.1:9110/status.json)
          cat status.json; echo
          [ "$code" = "200" ]
          [ "$(jq -r .serverUrl status.json)" = "https://127.0.0.1" ]
```

- [ ] **Step 4: Verify the workflow parses**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/image-smoke.yml'))" && echo YAML-OK`
Expected: `YAML-OK`. (The real smoke runs on the PR because this branch touches `deploy/` — the `image` job's `if` reads `needs.changes.outputs.deploy`.)

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/image-smoke.yml
git commit -s -m "ci(image-smoke): build and smoke-test the print-agent container

Builds the print-agent target, brings it up with the box, and asserts 9110
answers with the compose-supplied server URL — the one thing no laptop proves."
```

---

### Task 7: Publish the agent image, pin the publish, teach try-branch

**Files:**
- Modify: `.github/workflows/ci.yml` (the `publish` job)
- Modify: `scripts/ci-workflow.test.mjs`
- Modify: `deploy/try-branch.sh`

- [ ] **Step 1: Emit the agent tag list in the `publish` job's tags step**

In `.github/workflows/ci.yml`, in the `publish` job's "Work out the tags to publish" step, rewrite the `run:` body so it computes BOTH the app tags and the agent tags with one ref parse. **Preserve the three explanatory comments already in that block** (`# GHCR refuses an uppercase path…`, `# Always the immutable one…`, `# What deploy/compose.yml defaults to…`, `# No release tag exists yet…`) — do not drop them. The result:
```bash
          set -euo pipefail
          # GHCR refuses an uppercase path, and github.repository_owner keeps the account's casing.
          repo="ghcr.io/$(printf '%s' "$OWNER" | tr '[:upper:]' '[:lower:]')/waitron"
          # The print-agent image is the app repo with a `-print-agent` suffix, so the casing fold is shared.
          agent_repo="$repo-print-agent"
          # Always the immutable one, so a box can be pinned to an exact commit.
          short="sha-$(printf '%s' "$SHA" | cut -c1-7)"
          tags="$repo:$short"
          agent_tags="$agent_repo:$short"
          case "$REF" in
            # What deploy/compose.yml defaults to: `docker compose pull` on a box follows main.
            refs/heads/main) tags="$tags,$repo:main"; agent_tags="$agent_tags,$agent_repo:main" ;;
            # No release tag exists yet. This line and the `tags:` trigger at the top of the file are
            # together what will make the first `v1.2.3` publish `:1.2.3` rather than nothing.
            refs/tags/v*) tags="$tags,$repo:${REF#refs/tags/v}"; agent_tags="$agent_tags,$agent_repo:${REF#refs/tags/v}" ;;
          esac
          echo "$tags"; echo "$agent_tags"
          echo "tags=$tags" >> "$GITHUB_OUTPUT"
          echo "agent_tags=$agent_tags" >> "$GITHUB_OUTPUT"
```

- [ ] **Step 2: Add the second publish build-push step**

After the "Publish to GHCR" step, add:
```yaml
      - name: Publish the print-agent image to GHCR
        uses: docker/build-push-action@v6
        with:
          context: .
          file: deploy/Dockerfile
          target: print-agent
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.tags.outputs.agent_tags }}
          build-args: WAITRON_BUILD_ID=${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max,ignore-error=true
```

- [ ] **Step 3: Pin the second publish in the workflow guard**

In `scripts/ci-workflow.test.mjs`, inside the `describe` block that holds "gates the publish job downstream of the full `ci` aggregate", add a case:
```js
  // The print-agent image ships from the SAME publish job, so it inherits the ci-green gate above
  // rather than opening a second, ungated publish path.
  it("publishes the print-agent image from the gated publish job", () => {
    const body = job("publish").body.join("\n");
    expect(body).toContain("target: print-agent");
    expect(body).toContain("tags: ${{ steps.tags.outputs.agent_tags }}");
  });
```

- [ ] **Step 4: Build both images in try-branch, set both inline**

In `deploy/try-branch.sh`, after the existing `docker build … -t "$TAG"` line, build the agent target and set both image vars on the compose up. Replace the final two lines:
```bash
docker build -t "$TAG" -f deploy/Dockerfile "$@" "https://github.com/clintongormley/waitron.git#${REF}"

WAITRON_IMAGE="$TAG" docker compose -f "$WAITRON_DIR/compose.yml" up -d
```
with:
```bash
AGENT_TAG="waitron-print-agent:${safe:0:100}"
docker build -t "$TAG" -f deploy/Dockerfile "$@" "https://github.com/clintongormley/waitron.git#${REF}"
docker build -t "$AGENT_TAG" -f deploy/Dockerfile --target print-agent "$@" "https://github.com/clintongormley/waitron.git#${REF}"

# Both image vars set on ONE line with the compose up — NOT split with a `\` continuation. The guard
# scripts/deploy-image-env.test.ts asserts `WAITRON_IMAGE=…docker compose…up` with a single-line regex
# (`[^\n]*`), which a line break would fail (preflight ruling, 2026-09-10).
WAITRON_IMAGE="$TAG" WAITRON_PRINT_AGENT_IMAGE="$AGENT_TAG" docker compose -f "$WAITRON_DIR/compose.yml" up -d
```
Also update the header comment's build line to mention both images (it currently describes one build).

- [ ] **Step 5: Verify the workflow parses and the guard passes**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo CI-YAML-OK
pnpm vitest run scripts/ci-workflow.test.mjs
bash -n deploy/try-branch.sh && echo TRY-OK
```
Expected: `CI-YAML-OK`, the guard PASSES (including the new case), `TRY-OK`.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml scripts/ci-workflow.test.mjs deploy/try-branch.sh
git commit -s -m "ci(publish): publish the print-agent image from the gated publish job

Second build-push (both platforms) tagged ghcr.io/…/waitron-print-agent,
sharing the ci-green gate; try-branch builds both images and sets both
inline so a branch's agent is testable on a box."
```

---

### Task 8: Docs — backlog, CLAUDE.md, spec pointer

**Files:**
- Modify: `docs/backlog.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-08-print-agent-process-design.md`

- [ ] **Step 1: Close the owed item in the backlog**

In `docs/backlog.md`, find the Track P line that owes Track H the compose wiring (around the "Owed to Track H: the box's compose runs the print-agent container beside the server" text) and mark it landed, with a one-line pointer to the spec and the measured USB shape. Replace that sentence with:
```markdown
  Owed to Track H: **DONE 2026-09-10** — the box's compose runs the print-agent container beside the
  server by default (`WAITRON_SERVER_URL=https://127.0.0.1`, the agent fetches and pins the box CA from
  the landing listener), with a hot-plug-safe `/dev:/dev:ro` + major-180 device mount. Spec
  [2026-09-10-print-agent-box-wiring-design.md](superpowers/specs/2026-09-10-print-agent-box-wiring-design.md).
```

- [ ] **Step 2: Add the `/dev` mount trap to CLAUDE.md §3**

In `CLAUDE.md`, in "## 3. Conventions reviewers enforce", add a bullet (near the print-agent transport-seam bullet):
```markdown
- **A container that must reach a hot-plugged USB printer mounts `/dev:/dev:ro`, not `/dev/usb`.** A
  `/dev/usb` subdirectory bind goes stale when the printer is re-plugged (the node vanishes and does
  not return); a hard `devices: /dev/usb/lp0` line refuses to start when no printer is attached. The
  shape that survives both — measured on the real box 2026-09-10 — is the whole `/dev` mounted
  read-only plus `device_cgroup_rules: ["c 180:* rwm"]` (the usblp major) and `group_add: ["7"]` (the
  `lp` group's write bit); `:ro` still permits device-node writes but refuses `mknod`, and the cgroup
  rule denies every other device class. Pinned by `scripts/deploy-image-env.test.ts`; spec
  `docs/superpowers/specs/2026-09-10-print-agent-box-wiring-design.md` §5.
```

- [ ] **Step 3: Add a dated pointer to the process spec**

In `docs/superpowers/specs/2026-09-08-print-agent-process-design.md`, at the end of §2.2 (the line ending "so the same-box agent needs nothing typed."), append:
```markdown

_(2026-09-10: the box compose wiring, the published image, and the CA-trust path the same-box
`https://127.0.0.1` needs are designed in
[2026-09-10-print-agent-box-wiring-design.md](2026-09-10-print-agent-box-wiring-design.md).)_
```

- [ ] **Step 4: Commit**

```bash
git add docs/backlog.md CLAUDE.md docs/superpowers/specs/2026-09-08-print-agent-process-design.md
git commit -s -m "docs: close the print-agent box-wiring item; record the /dev mount trap"
```

---

### Task 9: Live verification on the box (`clinton@waitron.local`)

Not a code change — the proof the whole thing works on real hardware, run via `try-branch.sh` so it validates BEFORE land (no published image needed yet). Reachable over SSH with `sudo -n docker`.

- [ ] **Step 1: Build and run this branch's images on the box**

From a machine that can reach the box, or over SSH:
```bash
ssh clinton@waitron.local 'sudo -n docker rm -f usbprobe usbprobe2 usbprobe3 2>/dev/null; \
  curl -fsSL https://raw.githubusercontent.com/clintongormley/waitron/<this-branch>/deploy/try-branch.sh \
  | sudo bash -s -- <this-branch>'
```
(Push the branch first so the raw URL resolves. `try-branch.sh` builds both images from the git context and brings the stack up.)

- [ ] **Step 2: The agent is up and pinned the CA**

```bash
ssh clinton@waitron.local 'sudo -n docker compose -f /opt/waitron/compose.yml ps; \
  ss -ltn | grep 9110; \
  curl -s http://127.0.0.1:9110/status.json'
```
Expected: `waitron-print-agent-1` healthy; `:9110` listening; status JSON with `serverUrl: "https://127.0.0.1"` and phase `pending` (or `unconfigured` → `pending` within a poll) with a verification code. A failed CA pin would show `unreachable` — that is the failure signal.

- [ ] **Step 3: Accept in the dashboard and print**

In the dashboard: the agent appears under "print agents waiting to join" with that verification code → Accept. Within one poll `/status.json` shows phase `running`. Assign the USB printer to the agent and print a test slip (the printer is loaded coated-side to the head — thermal paper is one-sided).
Expected: a physical slip prints.

- [ ] **Step 4: Record the receipt**

Note the outcome in the PR description (agent healthy, CA pinned, join accepted, slip printed). No commit — this is validation, and the finish-branch flow carries the receipt into the PR thread.

---

## Self-Review

**Spec coverage:**
- §3 image target → Task 3. §4 CA trust → Tasks 1-2. §5 compose service + USB shape → Task 4. §6 CI (smoke, publish, try-branch) → Tasks 6-7. §7 tests → Tasks 1 (unit) + 5 (root guard) + 7 (workflow guard). §8 live check → Task 9. §9 docs → Task 8. All covered.
- `bluez` in the image (spec §3) → Task 3 Step 2. Node roots retained (spec §4) → Task 1 test "retains Node's public roots". `.env.example` + README (spec §5) → Task 4.

**Placeholder scan:** every code step carries real content; no TBD/TODO/"similar to". The one judgement note (bin.ts logger closure) is resolved inline in Task 2 Step 1.

**Type consistency:** `createServerTrustingFetch(opts: ServerTrustOptions): Promise<typeof fetch>` — defined in Task 1, consumed in Task 2 with the same name and the `serverUrl`/`stateDir`/`log` fields. `WAITRON_PRINT_AGENT_IMAGE` / `WAITRON_PRINT_AGENT_SERVER_URL` used identically in Tasks 4, 6, 7. `target: print-agent` consistent across Tasks 3, 6, 7 and the guards in Task 5. `agent_tags` output defined (Task 7 Step 1) before it is read (Step 2) and pinned (Step 3).

**Fresh-context plan review (2026-09-10, before any implementer ran):** a fresh Opus reviewer ran the CA mechanism on the box's real Node 26.7.0 + undici 8.7.0 (verified: box CA trusted, wrong CA rejected, public roots retained; `error.cause.code` codes confirmed; esbuild bundles undici; `docker compose config` accepts the service). Three defects it found are fixed above — the throttle test (case 5) and rotation test (case 4) needed an ADVANCING clock or they pass vacuously / fail (the boot `refresh()` collides with a constant clock), and two error-path cases plus `test:coverage` were added for the package's 90/85 branch floor — along with five polish items (broken bin.ts snippet removed, README `mailpit` row, `EXPOSE 9110` kept, tag-step comments preserved, `@types/node-forge` pin aligned).
