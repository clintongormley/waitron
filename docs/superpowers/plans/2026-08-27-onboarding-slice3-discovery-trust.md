# Onboarding Slice 3: Discovery + CA-serving (mDNS · `/setup-api/ca.crt` · IP-QR · trust page) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a freshly-installed box **discoverable and trustable on the LAN** without any appliance OS: the server advertises `waitron.local` over mDNS from inside its own process, serves its self-signed **CA for download** (`GET /setup-api/ca.crt`, the cert 2a minted into the state dir), publishes machine-readable **discovery info** (`GET /setup-api/discovery`), and renders a **minimal trust page** (`GET /setup/trust`) with per-OS CA-trust steps and an **IP-QR** fallback for when `.local` does not resolve (iOS).

**Architecture:** Three new, focused server modules — `mdns.ts` (a `multicast-dns` responder answering A queries for `waitron.local` → the box's LAN IPv4s), `box-reach.ts` (pure: enumerate the box's non-internal IPv4s + build the reachable URLs + the QR target), and `discovery-api.ts` (`mountDiscovery` — the three routes + the server-rendered trust page + an inline SVG QR via `qrcode`). Boot starts the mDNS responder in its **shared prefix** so both setup and trading modes advertise the name, stops it in the shared `makeStartedServer` teardown, and mounts `mountDiscovery` **in the setup branch only, before `mountSetup`** so the setup surface's `GET *` catch-all cannot shadow the new routes. **`setup-api.ts` is NOT touched** (slice 2b owns it live).

**Tech Stack:** TypeScript (Node ≥24), Hono 4.x + `@hono/node-server`, `multicast-dns` (new runtime dep), `qrcode` (new runtime dep), Vitest, Testcontainers (real-Postgres full-boot tests via `@waitron/db/testing/lifecycle`).

**Spec:** [docs/superpowers/specs/2026-08-26-appliance-onboarding-design.md](../specs/2026-08-26-appliance-onboarding-design.md) — §3 (the honest cost of "free" is a per-device CA-trust step), §7 (discovery & naming: Avahi/`waitron.local` + the IP-QR fallback), §8 (free/self-signed cert: the box hosts the CA download + per-platform trust instructions). This is the spec's **slice 3**, following 1a (#137), 1b (#139), and slice 2a (#141, secrets + self-signed cert). Slice 2b (the `/setup-api` provisioning endpoints) is in flight in a sibling worktree — see the collision note below.

## Decisions (read before implementing)

Ratified with the owner on 2026-08-27, refining the spec's slice-3 sketch:

- **mDNS is an in-process Node responder (`multicast-dns`), NOT OS Avahi.** The spec §7 says "Avahi advertises `waitron.local`," which is an appliance-OS assumption (Avahi is absent on a dev laptop and on a bare-Node host). Slice 3 is the in-repo, runs-on-any-Node+Postgres-host layer (§16), so it advertises from inside the server process. Avahi/OS-level publication, if ever wanted, is an appliance-slice (5–6) refinement and does not block this.
- **Scope is the discovery + serving layer only.** The polished trust UX is slice 2c (the `apps/setup` SPA); this slice serves a **minimal server-rendered** trust page. The **automated "does this device already trust the box CA?" check is DEFERRED to a browser-behaviour spike** — spec §17/§18 flag the underlying claim (untrusted-CA origins block service-workers / PWA install / WebAuthn until trusted) as **load-bearing and unverified**, and building an automated check on an unverified external claim is exactly the §1 defect class this repo polices. The trust page therefore *instructs and offers the download + QR*; it does not assert or test trust state.
- **`setup-api.ts` and boot's provisioning wiring are OFF-LIMITS.** Slice 2b is actively editing `setup-api.ts`, `mountSetup`'s deps, and the setup branch's route registrations. This slice adds a **separate** `discovery-api.ts` module and confines its boot edits to: (a) the shared prefix (start mDNS), (b) `makeStartedServer` (stop mDNS — a shared helper 2b does not touch), and (c) **one `mountDiscovery(...)` line placed immediately before the existing `mountSetup(...)` call** in the setup branch. Expect a small, mechanical merge conflict at (c) and at the setup-branch `makeStartedServer` call; keep the additions minimal and clearly delimited so whoever lands second resolves them in seconds. Do not restructure `mountSetup`'s catch-all — mounting before it is sufficient (Hono is first-match-wins).
- **mDNS advertises in BOTH modes; `mountDiscovery` mounts in SETUP mode only.** The name→IP mapping is useful in trading too (tills reaching the box by name), so the responder lives in the shared prefix. The CA-download + trust page are onboarding concerns, so they mount only in the setup branch. Trading-mode HTTPS-from-the-box-cert is a separate, orthogonal gap (2a wired the box cert into setup mode only) and is out of scope here.
- **CA-download depends on the box having minted a CA.** 2a mints the CA quartet only when the operator did **not** supply their own `WAITRON_TLS_*` pair (boot's setup branch: `config.tls ?? ensured.leaf`). When an operator cert is configured, `<stateDir>/tls/ca.crt` may be absent — `GET /setup-api/ca.crt` must handle that with a clean 404, and the trust page must say "this box uses your own certificate; no CA download is needed," never 500.

## Global Constraints

- **Node ≥ 24; pnpm 9.15.0.** TDD: failing test first → red → minimal impl → green → commit. Prove guards by deletion.
- **Coverage — all changes are in `apps/server` (98/98/98/95).** Run `pnpm --filter @waitron/server test:coverage`. Container full-boot tests need `TESTCONTAINERS_RYUK_DISABLED=true` locally (export it when running the suite by hand).
- **The trading (provisioned) boot path MUST be behaviourally unchanged** (CLAUDE.md §5: nothing blocks a sale). This slice adds an mDNS responder to the shared prefix (started in both modes) and stops it in the shared teardown, but mounts **no new routes** in the trading branch. A full-boot trading test must still prove `/api/*`, `/health` and the SPAs behave exactly as before, and that `GET /setup-api/discovery` is **404 in trading mode** (setup-only routes are not mounted).
- **`multicast-dns` and `qrcode` are new RUNTIME dependencies** of `apps/server` (imported from `src/`). Add `multicast-dns` and `qrcode` to `dependencies`, `@types/multicast-dns` and `@types/qrcode` to `devDependencies`, run `pnpm install`, and **commit the lockfile** — a dependency-section change fails CI's `--frozen-lockfile` install otherwise (CLAUDE.md §2).
- **No SQL in this slice.** But the same "never trust raw input" rule governs file paths: `GET /setup-api/ca.crt` reads a **fixed** path (`join(stateDir, "tls", "ca.crt")`), never a request-derived one — there is no user-supplied filename to guard, and none may be introduced.
- **No new error codes** unless genuinely needed. A file that throws a code imports `./errors.js`. The discovery routes answer with HTTP status + a JSON/HTML body, not thrown `AppError`s, except where an existing `server.*` code already fits.
- **Error codes name the domain concept** (CLAUDE.md §3): if a module must throw, name the concept (`setup.*` / `server.*`), never the file.
- **English-only identifiers** (CLAUDE.md §3): the guard skips `apps/`, but keep screen keys, route paths, JSON field names, and CSS classes in English regardless (memory: identifiers English, Spanish only as i18n values). User-facing trust-page copy is fine in English for now; localisation is a later concern.

---

## Task 1: `mdns.ts` — the in-process `waitron.local` responder

A thin responder around `multicast-dns`: on every mDNS query for our hostname, answer with the box's current IPv4 addresses. The record-building is a pure function tested directly; the socket is injected so the unit test needs no real multicast.

**Files:**
- Create: `apps/server/src/mdns.ts`
- Test: `apps/server/src/mdns.test.ts`
- Modify: `apps/server/package.json` (`multicast-dns` → `dependencies`, `@types/multicast-dns` → `devDependencies`)
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**
- Consumes: `multicast-dns`, `./logger.js` (`Logger`).
- Produces:
  ```ts
  /** One mDNS answer record — the subset of multicast-dns's ResourceRecord this module emits. */
  export interface MdnsAnswer { name: string; type: "A"; ttl: number; data: string; }

  /** A minimal view of a multicast-dns instance, so the responder can be unit-tested with a fake. */
  export interface MdnsSocket {
    on(event: "query", handler: (query: { questions: { name: string; type: string }[] }) => void): void;
    respond(response: { answers: MdnsAnswer[] }): void;
    destroy(cb?: () => void): void;
  }

  export interface MdnsResponder { stop(): Promise<void>; }

  export interface MdnsDeps {
    /** The name to answer for, e.g. "waitron.local". */
    hostname: string;
    /** Current box IPv4s, read per query (not cached) so a DHCP change is reflected. */
    getAddresses: () => string[];
    log: Logger;
    /** Socket factory, injected for tests. Default: the real multicast-dns instance. */
    makeSocket?: () => MdnsSocket;
  }

  /** TTL (seconds) on the A records — short so a moved box is re-resolved quickly. */
  export const MDNS_TTL_SECONDS = 120;

  /** Pure: the A answers for `hostname` over `addresses` (empty when there are no addresses). */
  export function buildMdnsAnswers(hostname: string, addresses: string[]): MdnsAnswer[];

  /** Start answering mDNS A queries for `hostname`. Idempotent stop(). */
  export function startMdnsResponder(deps: MdnsDeps): MdnsResponder;
  ```
  Behaviour: on each `"query"`, for any question whose `name === hostname` and whose `type` is `"A"` or `"ANY"`, call `respond({ answers: buildMdnsAnswers(hostname, getAddresses()) })` — but only when there is at least one answer (never respond with an empty answer set). `stop()` calls `destroy()` once and resolves; a second `stop()` is a no-op. Logs `mdns.responding` once at start and `mdns.stopped` on stop.

- [ ] **Step 1: Add the deps + reinstall.** In `apps/server/package.json` add `"multicast-dns": "^7.2.5"` to `dependencies` and `"@types/multicast-dns": "^7.2.4"` to `devDependencies`. From the repo root: `pnpm install`; stage `pnpm-lock.yaml`. Verify: `pnpm --filter @waitron/server exec node -e "require.resolve('multicast-dns')"` prints a path.

- [ ] **Step 2: Write the failing tests** in `mdns.test.ts` using a fake `MdnsSocket` (a tiny `EventEmitter`-like object with `respond`/`destroy` spies):

```ts
import { describe, it, expect, vi } from "vitest";
import { buildMdnsAnswers, startMdnsResponder, MDNS_TTL_SECONDS, type MdnsSocket } from "./mdns.js";

function fakeSocket() {
  let handler: ((q: { questions: { name: string; type: string }[] }) => void) | undefined;
  const respond = vi.fn();
  const destroy = vi.fn((cb?: () => void) => cb?.());
  const socket: MdnsSocket = {
    on: (_e, h) => { handler = h; },
    respond,
    destroy,
  };
  return { socket, respond, destroy, query: (q: { questions: { name: string; type: string }[] }) => handler?.(q) };
}

it("builds one A answer per address", () => {
  const answers = buildMdnsAnswers("waitron.local", ["192.168.1.5", "10.0.0.9"]);
  expect(answers).toEqual([
    { name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" },
    { name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "10.0.0.9" },
  ]);
});

it("answers an A query for its hostname with the current addresses", () => {
  const f = fakeSocket();
  startMdnsResponder({ hostname: "waitron.local", getAddresses: () => ["192.168.1.5"], log: () => {}, makeSocket: () => f.socket });
  f.query({ questions: [{ name: "waitron.local", type: "A" }] });
  expect(f.respond).toHaveBeenCalledWith({ answers: [{ name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" }] });
});

it("ignores a query for a different name", () => {
  const f = fakeSocket();
  startMdnsResponder({ hostname: "waitron.local", getAddresses: () => ["192.168.1.5"], log: () => {}, makeSocket: () => f.socket });
  f.query({ questions: [{ name: "other.local", type: "A" }] });
  expect(f.respond).not.toHaveBeenCalled();
});

it("does not respond when the box has no addresses", () => {
  const f = fakeSocket();
  startMdnsResponder({ hostname: "waitron.local", getAddresses: () => [], log: () => {}, makeSocket: () => f.socket });
  f.query({ questions: [{ name: "waitron.local", type: "A" }] });
  expect(f.respond).not.toHaveBeenCalled();
});

it("stop() destroys the socket once", async () => {
  const f = fakeSocket();
  const r = startMdnsResponder({ hostname: "waitron.local", getAddresses: () => ["192.168.1.5"], log: () => {}, makeSocket: () => f.socket });
  await r.stop();
  await r.stop();
  expect(f.destroy).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Run — FAIL** (`mdns.js` missing). `pnpm --filter @waitron/server test mdns`.

- [ ] **Step 4: Implement `mdns.ts`.** Default `makeSocket` = `() => multicastDns()` (`import multicastDns from "multicast-dns"`). `buildMdnsAnswers` maps addresses → `{ name: hostname, type: "A", ttl: MDNS_TTL_SECONDS, data: addr }`. `startMdnsResponder` creates the socket, registers the `"query"` handler (filter questions by `name === hostname && (type === "A" || type === "ANY")`; if any match and `getAddresses()` is non-empty, `respond`), logs `mdns.responding`, and returns `{ stop }` with a `stopped` latch that calls `destroy` once (wrap `destroy(cb)` in a `Promise<void>`) and logs `mdns.stopped`.

- [ ] **Step 5: Run — PASS.**

- [ ] **Step 6: Prove the hostname filter by deletion.** Temporarily drop the `name === hostname` check (respond to every query); confirm the "ignores a query for a different name" test fails; restore. Note it in the commit body.

- [ ] **Step 7: Coverage + commit.** `pnpm --filter @waitron/server test:coverage` clears 98/98/98/95. Commit `-s`: `feat(server): mdns.ts — in-process waitron.local responder (onboarding slice 3)`.

---

## Task 2: `box-reach.ts` — the box's LAN IPv4s + reachable URLs + QR target

Pure helpers: enumerate the box's non-internal IPv4 addresses (the same shape 2a's `box-secrets.ts` uses for cert SANs) and build the URLs a device uses to reach the box, plus the single URL the IP-QR encodes.

**Files:**
- Create: `apps/server/src/box-reach.ts`
- Test: `apps/server/src/box-reach.test.ts`

**Interfaces:**
- Consumes: `node:os` (`networkInterfaces`).
- Produces:
  ```ts
  export interface ReachInfo {
    hostname: string;              // "waitron.local"
    scheme: "https" | "http";
    port: number;
    addresses: string[];           // non-internal IPv4s
    hostnameUrl: string;           // e.g. "https://waitron.local:8080" (":443"/":80" omitted)
    ipUrls: string[];              // one per address, same port rule
    /** The URL the IP-QR encodes — the FIRST ip URL, since `.local` is unreliable on iOS (spec §7);
     *  null when the box has no non-internal IPv4 (e.g. a container with only loopback). */
    qrTarget: string | null;
  }

  export interface BuildReachOptions {
    hostname: string;
    port: number;
    /** true → https, false → http. Setup mode always serves TLS (2a), so this is normally true. */
    secure: boolean;
    /** Injected for tests; default enumerates the real interfaces. */
    listIpv4?: () => string[];
  }

  /** Non-internal IPv4 addresses of this host (default `listIpv4`). */
  export function listBoxIpv4(): string[];

  export function buildReachInfo(opts: BuildReachOptions): ReachInfo;
  ```
  URL rule: omit the port when it is the scheme default (`443` for https, `80` for http), else append `:${port}`. `listBoxIpv4` = `Object.values(networkInterfaces()).flat().filter(n => n && n.family === "IPv4" && !n.internal).map(n => n.address)` (mirrors `box-secrets.ts`'s `defaultListIpv4`; kept local to this slice so 2a's tested module is untouched).

- [ ] **Step 1: Write the failing tests** in `box-reach.test.ts` (inject `listIpv4` — never touch real interfaces in a unit test):

```ts
import { describe, it, expect } from "vitest";
import { buildReachInfo } from "./box-reach.js";

const base = { hostname: "waitron.local", listIpv4: () => ["192.168.1.5", "10.0.0.9"] };

it("builds hostname + ip URLs with a non-default port", () => {
  const r = buildReachInfo({ ...base, port: 8080, secure: true });
  expect(r.hostnameUrl).toBe("https://waitron.local:8080");
  expect(r.ipUrls).toEqual(["https://192.168.1.5:8080", "https://10.0.0.9:8080"]);
  expect(r.qrTarget).toBe("https://192.168.1.5:8080");
  expect(r.addresses).toEqual(["192.168.1.5", "10.0.0.9"]);
});

it("omits the port when it is the scheme default (443)", () => {
  const r = buildReachInfo({ ...base, port: 443, secure: true });
  expect(r.hostnameUrl).toBe("https://waitron.local");
  expect(r.ipUrls[0]).toBe("https://192.168.1.5");
});

it("uses http when not secure", () => {
  const r = buildReachInfo({ ...base, port: 80, secure: false });
  expect(r.hostnameUrl).toBe("http://waitron.local");
});

it("qrTarget is null when there is no non-internal IPv4", () => {
  const r = buildReachInfo({ hostname: "waitron.local", port: 8080, secure: true, listIpv4: () => [] });
  expect(r.qrTarget).toBeNull();
  expect(r.ipUrls).toEqual([]);
});
```

- [ ] **Step 2: Run — FAIL** (`box-reach.js` missing).

- [ ] **Step 3: Implement `box-reach.ts`.** A private `urlFor(scheme, host, port)` applying the default-port rule; `buildReachInfo` gathers `addresses = (opts.listIpv4 ?? listBoxIpv4)()`, `scheme = opts.secure ? "https" : "http"`, and composes the fields; `qrTarget = ipUrls[0] ?? null`.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Prove the default-port rule by deletion.** Temporarily always append `:${port}`; confirm the ":443 omitted" test fails; restore. Note it in the commit body.

- [ ] **Step 6: Coverage + commit.** `pnpm --filter @waitron/server test:coverage` clears thresholds. Commit `-s`: `feat(server): box-reach.ts — LAN IPv4s + reachable URLs + QR target`.

---

## Task 3: `discovery-api.ts` — CA download, discovery JSON, and the trust page

The one HTTP module this slice adds. It reads the CA 2a wrote, publishes discovery info, and renders a minimal server-rendered trust page with per-OS steps and an inline SVG QR. Everything IO-injected so the suite runs on a bare `new Hono()` + a temp state dir (mirrors `setup-api.test.ts`).

**Files:**
- Create: `apps/server/src/discovery-api.ts`
- Test: `apps/server/src/discovery-api.test.ts`
- Modify: `apps/server/package.json` (`qrcode` → `dependencies`, `@types/qrcode` → `devDependencies`)
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**
- Consumes: `Hono`, `./logger.js` (`Logger`), `buildReachInfo`/`listBoxIpv4` (Task 2), `node:fs/promises` (`readFile`), `node:path` (`join`), `qrcode`.
- Produces:
  ```ts
  export interface DiscoveryDeps {
    /** The persisted state dir (config.stateDir); the CA lives at <stateDir>/tls/ca.crt (2a). */
    stateDir: string;
    hostname: string;              // "waitron.local"
    port: number;                  // config.httpPort
    secure: boolean;               // config.tls !== undefined || the box mints its own (setup mode → true)
    /** Injected for tests. */
    listIpv4?: () => string[];
    /** Injected for tests; default `QRCode.toString(text, { type: "svg", margin: 1 })`. */
    renderQrSvg?: (text: string) => Promise<string>;
  }

  export function mountDiscovery(app: Hono, deps: DiscoveryDeps, log: Logger): void;
  ```
  Routes registered:
  - `GET /setup-api/ca.crt` → read `join(stateDir, "tls", "ca.crt")`. Present → `200`, body = the PEM, `Content-Type: application/x-x509-ca-cert`, `Content-Disposition: attachment; filename="waitron-ca.crt"`, `Cache-Control: no-store`. Absent (ENOENT) → `404` JSON `{ error: "no_box_ca", message: "This box uses an operator-supplied certificate; no CA download is needed." }`.
  - `GET /setup-api/discovery` → `200` JSON: the `ReachInfo` fields plus `caDownloadAvailable: boolean` (does `<stateDir>/tls/ca.crt` exist?) and `caDownloadPath: "/setup-api/ca.crt"`.
  - `GET /setup/trust` → `200` `text/html`, `Cache-Control: no-cache`: a minimal page with (a) the box's reach URLs, (b) a "Download the certificate" link to `/setup-api/ca.crt` (or, when no box CA, a line saying an operator cert is in use), (c) concise per-OS trust steps (Android, iOS, macOS, Windows), and (d) the inline SVG QR of `qrTarget` (omitted with a note when `qrTarget` is null). The page is a self-contained string (no external asset — matches `setup-api.ts`'s inline placeholder style).

- [ ] **Step 1: Add the QR dep + reinstall.** In `apps/server/package.json` add `"qrcode": "^1.5.4"` to `dependencies` and `"@types/qrcode": "^1.5.5"` to `devDependencies`. `pnpm install`; stage `pnpm-lock.yaml`. Verify `pnpm --filter @waitron/server exec node -e "require.resolve('qrcode')"` prints a path.

- [ ] **Step 2: Write the failing tests** in `discovery-api.test.ts` (bare Hono + a temp state dir with a fake `ca.crt`; inject `listIpv4` and a fast `renderQrSvg`):

```ts
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, it, expect, afterEach } from "vitest";
import { mountDiscovery } from "./discovery-api.js";

const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function stateDirWithCa(pem = "-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n") {
  const d = await mkdtemp(join(tmpdir(), "disc-")); dirs.push(d);
  await mkdir(join(d, "tls"), { recursive: true });
  await writeFile(join(d, "tls", "ca.crt"), pem);
  return d;
}
function appFor(stateDir: string, over: Partial<Parameters<typeof mountDiscovery>[1]> = {}) {
  const app = new Hono();
  mountDiscovery(app, {
    stateDir, hostname: "waitron.local", port: 8080, secure: true,
    listIpv4: () => ["192.168.1.5"],
    renderQrSvg: async (t) => `<svg data-qr="${t}"></svg>`,
    ...over,
  }, () => {});
  return app;
}

it("serves the CA as a downloadable attachment", async () => {
  const app = appFor(await stateDirWithCa());
  const res = await app.request("/setup-api/ca.crt");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/x-x509-ca-cert");
  expect(res.headers.get("content-disposition")).toContain("waitron-ca.crt");
  expect(await res.text()).toContain("BEGIN CERTIFICATE");
});

it("404s the CA download when the box has no CA (operator cert)", async () => {
  const d = await mkdtemp(join(tmpdir(), "disc-noca-")); dirs.push(d);
  const res = await appFor(d).request("/setup-api/ca.crt");
  expect(res.status).toBe(404);
  expect(await res.json()).toMatchObject({ error: "no_box_ca" });
});

it("publishes discovery JSON with addresses, urls and the qr target", async () => {
  const res = await appFor(await stateDirWithCa()).request("/setup-api/discovery");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    hostname: "waitron.local",
    addresses: ["192.168.1.5"],
    hostnameUrl: "https://waitron.local:8080",
    ipUrls: ["https://192.168.1.5:8080"],
    qrTarget: "https://192.168.1.5:8080",
    caDownloadAvailable: true,
    caDownloadPath: "/setup-api/ca.crt",
  });
});

it("reports caDownloadAvailable:false when there is no box CA", async () => {
  const d = await mkdtemp(join(tmpdir(), "disc-noca2-")); dirs.push(d);
  expect(await (await appFor(d).request("/setup-api/discovery")).json()).toMatchObject({ caDownloadAvailable: false });
});

it("renders a trust page with the CA link and the inline QR", async () => {
  const res = await appFor(await stateDirWithCa()).request("/setup/trust");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  const html = await res.text();
  expect(html).toContain("/setup-api/ca.crt");
  expect(html).toContain('data-qr="https://192.168.1.5:8080"'); // the injected QR svg
  expect(html).toMatch(/iOS/); // per-OS steps present
});

it("trust page notes the operator-cert case instead of a download when no box CA", async () => {
  const d = await mkdtemp(join(tmpdir(), "disc-noca3-")); dirs.push(d);
  const html = await (await appFor(d).request("/setup/trust")).text();
  expect(html).toMatch(/own certificate|operator-supplied/i);
});
```

- [ ] **Step 3: Run — FAIL** (`discovery-api.js` missing).

- [ ] **Step 4: Implement `discovery-api.ts`.** A private `caPath = join(deps.stateDir, "tls", "ca.crt")` and `caExists()` (`access(caPath).then(() => true, () => false)`). Import the default `QRCode from "qrcode"`; `renderQrSvg` default `(t) => QRCode.toString(t, { type: "svg", margin: 1 })`. `mountDiscovery` registers the three routes:
  - `ca.crt`: `readFile(caPath, "utf8")`; on success return the PEM with the three headers; catch ENOENT → `c.json({ error: "no_box_ca", message: "…" }, 404)`.
  - `discovery`: `const reach = buildReachInfo({ hostname, port, secure, listIpv4 }); return c.json({ ...reach, caDownloadAvailable: await caExists(), caDownloadPath: "/setup-api/ca.crt" })`.
  - `trust`: build the reach info, `const qr = reach.qrTarget ? await renderQrSvg(reach.qrTarget) : null`, then a self-contained HTML string (heading, reach URLs, the CA-download link **or** the operator-cert note gated on `await caExists()`, the four per-OS step blocks, and `qr ?? "<p>No LAN address detected…</p>"`). Return `c.html(html, 200, { "Cache-Control": "no-cache" })`. Keep the per-OS copy concise and factual (Android: Settings → Security → Encryption & credentials → Install a certificate → CA certificate; iOS: install the profile, then Settings → General → VPN & Device Management, then enable full trust under General → About → Certificate Trust Settings; macOS: open the file → Keychain Access → set to Always Trust; Windows: import into Trusted Root Certification Authorities). Log `discovery.mounted` once.

- [ ] **Step 5: Run — PASS.**

- [ ] **Step 6: Prove the CA-absent branch by deletion.** Temporarily make `caExists()` always-true; confirm the "404s … when the box has no CA" and "caDownloadAvailable:false" tests fail; restore. Note it in the commit body.

- [ ] **Step 7: Coverage + commit.** `pnpm --filter @waitron/server test:coverage` clears 98/98/98/95. Commit `-s`: `feat(server): discovery-api.ts — CA download, discovery JSON, IP-QR trust page`.

---

## Task 4: Wire mDNS + `mountDiscovery` into boot

Start the responder in the shared prefix (both modes), stop it in the shared `makeStartedServer` teardown, and mount `mountDiscovery` in the setup branch **before** `mountSetup`.

**Files:**
- Modify: `apps/server/src/boot.ts`
- Test: `apps/server/src/boot.test.ts` (extend the setup-mode + trading-mode full-boot cases)

**Interfaces:**
- Consumes: `startMdnsResponder`/`MdnsResponder` (Task 1), `listBoxIpv4` (Task 2), `mountDiscovery` (Task 3), `config.stateDir`/`config.httpPort`/`config.tls` (existing).
- Produces: mDNS advertised in both modes; discovery routes served in setup mode; trading mode unchanged (no discovery routes); mDNS stopped on `close()`.

- [ ] **Step 1: Write the failing full-boot tests** in `boot.test.ts`. The slice-2a setup-mode test already dials HTTPS trusting the minted CA — reuse that harness (read `<stateDir>/tls/ca.crt`, dial via an undici `Agent`). Add:

```ts
// SETUP MODE: discovery routes are served.
it("setup mode serves the discovery JSON, the CA download, and the trust page", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "boot-disc-"));
  const server = await startServer(setupModeEnv(dbUrl, { WAITRON_STATE_DIR: stateDir }));
  try {
    const ca = await readFile(join(stateDir, "tls", "ca.crt"));
    const dispatcher = new Agent({ connect: { ca } });
    const disc = await fetch(`https://127.0.0.1:${port}/setup-api/discovery`, { dispatcher } as any);
    expect(disc.status).toBe(200);
    expect(await disc.json()).toMatchObject({ hostname: "waitron.local", caDownloadAvailable: true });

    const crt = await fetch(`https://127.0.0.1:${port}/setup-api/ca.crt`, { dispatcher } as any);
    expect(crt.status).toBe(200);
    expect(crt.headers.get("content-disposition")).toContain("waitron-ca.crt");

    const trust = await fetch(`https://127.0.0.1:${port}/setup/trust`, { dispatcher } as any);
    expect(trust.status).toBe(200);
    expect(trust.headers.get("content-type")).toContain("text/html");
  } finally {
    await server.close();
    await rm(stateDir, { recursive: true, force: true });
  }
});

// TRADING MODE: discovery routes are NOT mounted (setup-only), and the box still trades unchanged.
it("trading mode does not mount the setup-only discovery routes", async () => {
  // provision a venue + full trading env (the existing trading full-boot helper), then:
  //   expect((await fetch(`${base}/setup-api/discovery`)).status).toBe(404);
  //   expect((await fetch(`${base}/api/staff`)).status).not.toBe(404); // trading routes unchanged
});
```

(`setupModeEnv(dbUrl, overrides)` and the HTTPS/CA harness are the slice-2a helpers; extend `setupModeEnv` to thread `WAITRON_STATE_DIR` if it does not already. `port`/`base` are read the way the existing full-boot tests read them.)

- [ ] **Step 2: Run — the setup-mode discovery test FAILS** (`/setup-api/discovery` 404s — the routes are not mounted yet).

- [ ] **Step 3: Implement the boot wiring.** Three edits, each minimal and delimited so the concurrent slice-2b edits merge cleanly:

  1. **Shared prefix** — after `const app = healthApp(health, now);` and **before** the `if (config.till === undefined)` branch, start the responder:
     ```ts
     // Advertise waitron.local over mDNS from inside the process (slice 3) — in BOTH modes, so a
     // device reaches the box by name whether it is being set up or already trading. The name→IP
     // mapping is independent of which front-door cert is served; the reachable URL carries the port.
     // Stopped in makeStartedServer's close() below (shared teardown), so a test that opens and closes
     // many servers never leaks the UDP :5353 socket.
     const mdns = startMdnsResponder({ hostname: "waitron.local", getAddresses: listBoxIpv4, log });
     ```
  2. **Setup branch** — mount discovery immediately **before** `mountSetup(app, { environment: config.environment }, log);` (so the setup surface's `GET *` catch-all cannot shadow it — Hono is first-match-wins):
     ```ts
     // The discovery + CA-serving surface (slice 3): GET /setup-api/ca.crt (the CA 2a minted),
     // GET /setup-api/discovery, and GET /setup/trust. Registered BEFORE mountSetup, whose GET *
     // placeholder catch-all would otherwise swallow these paths. Setup-mode only — a trading box
     // needs neither (its tills are already paired). `secure: true` — the box serves the setup
     // surface over HTTPS (2a), so every reach URL is https.
     mountDiscovery(app, { stateDir: config.stateDir, hostname: "waitron.local", port: config.httpPort, secure: true }, log);
     ```
  3. **`makeStartedServer`** — give the shared helper the responder so `close()` stops it in **both** modes. Add a parameter and stop it first in `close()`:
     ```ts
     function makeStartedServer(server, health, log, teardown, mdns: MdnsResponder): StartedServer {
       let closed = false;
       return { health, close: async () => {
         if (closed) return; closed = true;
         await mdns.stop();               // stop advertising first — the box is going down
         await teardown.stopWork();
         try { await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))); }
         finally { await teardown.closePools(); }
         log("info", "server.stopped");
       } };
     }
     ```
     Pass `mdns` at BOTH `makeStartedServer(...)` call sites (the setup branch's and the trading branch's). Update the JSDoc on `makeStartedServer` to mention it stops the mDNS responder shared by both modes.

- [ ] **Step 4: Run — both new full-boot tests PASS, and the existing setup/trading tests still pass.** Then **prove the setup-only mount by deletion**: temporarily move the `mountDiscovery(...)` line into the trading branch (or delete it); confirm the setup-mode discovery test fails; restore.

- [ ] **Step 5: Trading-mode regression.** Confirm the existing trading-mode full-boot test still serves `/api/*`, `/health`, and the SPAs unchanged, and now also that `/setup-api/discovery` is `404` there. `pnpm --filter @waitron/server typecheck` clean (the extra `makeStartedServer` arg is threaded at both call sites).

- [ ] **Step 6: Coverage + commit.** `pnpm --filter @waitron/server test:coverage` clears 98/98/98/95, `boot.ts` branch coverage intact (both `makeStartedServer` call sites and the setup-branch mount exercised by the full-boot tests). Commit `-s`: `feat(server): advertise waitron.local + serve the discovery/CA/trust surface (onboarding slice 3)`.

---

## Task 5: dev exercise + `.env.example` + design-spec note

Make the discovery surface exercisable in the local onboarding flow and record slice 3 in the spec.

**Files:**
- Modify: `apps/server/scripts/dev-onboard.ts` (its documented manual-verification block)
- Modify: `apps/server/.env.example` (note `waitron.local` mDNS + the trust page)
- Modify: `docs/superpowers/specs/2026-08-26-appliance-onboarding-design.md` (§7 discovery note)

**Interfaces:** none (dev tooling + docs).

- [ ] **Step 1: Update `dev-onboard.ts`'s manual-verification comment/output** so it dials the new surface over HTTPS with `-k` and mentions mDNS:
  ```
  curl -sk https://127.0.0.1:8080/setup-api/discovery         # {"hostname":"waitron.local","addresses":[...],...}
  curl -sk https://127.0.0.1:8080/setup-api/ca.crt -o /tmp/waitron-ca.crt   # the box CA
  curl -sk -o /dev/null -w "%{http_code}\n" https://127.0.0.1:8080/setup/trust   # 200 (trust page)
  # mDNS (macOS): dns-sd -q waitron.local   |   (Linux) avahi-resolve -n waitron.local
  ```
  The script itself is unchanged; only its printed guidance changes.

- [ ] **Step 2: `.env.example` note** near the `WAITRON_STATE_DIR`/`WAITRON_TLS_*` lines: in setup mode the box advertises `waitron.local` over mDNS and serves its CA at `/setup-api/ca.crt` plus a trust page at `/setup/trust`; devices trust that CA once to get a warning-free HTTPS/PWA experience (spec §3). No new env var is introduced by this slice.

- [ ] **Step 3: Design-spec §7 note.** In `2026-08-26-appliance-onboarding-design.md`, append a dated sub-note under §7 (do not rewrite history — CLAUDE.md §6):
  > **Implementation note (2026-08-27): slice 3 = in-process mDNS + CA-serving, no OS Avahi.** The box advertises `waitron.local` from inside the server process (`multicast-dns`), in both setup and trading modes, so it runs on any Node host with no appliance OS. The setup surface serves the box CA for download (`GET /setup-api/ca.crt`), machine-readable discovery (`GET /setup-api/discovery`), and a minimal server-rendered trust page with per-OS steps + an IP-QR fallback (`GET /setup/trust`). **Deferred:** the polished trust UX → slice 2c (`apps/setup`); the automated "is this device trusting the CA?" check → a browser-behaviour spike, because §17/§18's untrusted-CA-blocks-PWA claim is still unverified and must not be built on. OS-level Avahi publication and trading-mode HTTPS-from-the-box-cert remain later (appliance / separate) work.

- [ ] **Step 4: Manual verification (documented).** Record the output of:
  ```bash
  pnpm dev:reset >/dev/null 2>&1 || true
  pnpm dev:onboard
  pnpm --filter @waitron/server dev &
  sleep 4
  curl -sk https://127.0.0.1:8080/setup-api/discovery
  curl -sk -o /dev/null -w "%{http_code}\n" https://127.0.0.1:8080/setup/trust
  curl -sk https://127.0.0.1:8080/setup-api/ca.crt | head -1   # -----BEGIN CERTIFICATE-----
  ```
  (If Docker/port contention interferes locally, note it; the `boot.test.ts` full-boot tests are the real gate. Real mDNS resolution depends on the host network and is not asserted in CI — the `mdns.test.ts` unit test covers the responder logic.)

- [ ] **Step 5: Commit** `-s`: `docs+dev(server): exercise the discovery surface locally; record slice 3 in the design spec`.

---

## Self-Review

**1. Spec coverage** (spec §3, §7, §8):
- §7 "advertise `waitron.local`" → Task 1 (mDNS responder) + Task 4 (boot, both modes). ✅
- §7 "always-available fallback: a QR encoding the box's current IP" → Task 2 (`qrTarget` = IP URL) + Task 3 (inline SVG QR on the trust page). ✅
- §8 "the setup page hosts the CA download + per-platform trust instructions" → Task 3 (`GET /setup-api/ca.crt` + the per-OS trust page). ✅
- §3 "each device must trust the box's CA once — a guided step" → Task 3 (the trust page guides it). ✅
- **Deliberately NOT here** (each stated in "Decisions"): the automated trusted-device *check* (→ browser spike, §17/§18); the polished trust UX (→ 2c); OS Avahi; trading-mode HTTPS-from-the-box-cert; leaf renewal. ✅

**2. Placeholder scan:** the two described-not-coded test bodies are Task 4 Step 1's trading-mode case (the step names the exact assertions: `/setup-api/discovery` 404, `/api/staff` not 404, reusing the existing trading full-boot helper) — everything else is real code. `mdns.ts`, `box-reach.ts`, and `discovery-api.ts` bodies are specified as concrete logic. No "TODO/TBD/handle edge cases."

**3. Type consistency:** `startMdnsResponder(MdnsDeps): MdnsResponder` (Task 1) is called by boot (Task 4) with `{ hostname, getAddresses: listBoxIpv4, log }` and its handle is threaded into `makeStartedServer` (Task 4 Step 3). `listBoxIpv4`/`buildReachInfo` (Task 2) are consumed by `discovery-api.ts` (Task 3) and boot (Task 4). `mountDiscovery(app, DiscoveryDeps, log)` (Task 3) is called by boot with `{ stateDir: config.stateDir, hostname, port: config.httpPort, secure: true }` (Task 4). `MdnsResponder` is imported into `boot.ts` for the `makeStartedServer` param. Names consistent across tasks.

**4. Collision check (slice 2b is live in a sibling worktree):** this slice never edits `setup-api.ts`. Its only shared-file edits are in `boot.ts`: the shared-prefix mDNS start (new lines, away from 2b's setup-branch route work), the `makeStartedServer` signature + both call sites (a shared helper 2b does not touch, plus one added arg at each call), and one `mountDiscovery(...)` line before `mountSetup` in the setup branch (adjacent to 2b's new POST routes). Expect small, mechanical conflicts at the setup-branch `mountDiscovery` line and the setup-branch `makeStartedServer` call; whoever lands second re-adds one argument and one mount line. `package.json`/`pnpm-lock.yaml` also both change — resolve by re-running `pnpm install`.

**Risk note carried into the fix/review loop:** Task 4 edits the fiscal server's boot. The regression guards are the trading-mode full-boot test (unchanged `/api/*`, `/health`, SPAs; new `/setup-api/discovery` → 404) and the mDNS-stopped-on-close assertion. The whole-branch (finish-branch) review must confirm the trading path is byte-for-byte as before apart from the mDNS start/stop, and that `multicast-dns`/`qrcode` moving into runtime deps does not perturb the bundle (`bundle-smoke` is CI-only — watch it).
