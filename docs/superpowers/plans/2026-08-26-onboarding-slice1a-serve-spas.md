# Onboarding Slice 1a: Serve the built SPAs from the box — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Waitron server (`apps/server`, Hono) serve the built `till` and `dashboard`
front-ends as static assets same-origin in production, so a single box origin serves both the app and
its `/api` — the prerequisite for the appliance and for any single-origin deploy.

**Architecture:** Add production `vite build` scripts to the two front-ends; move `dashboard` to a
`/manage/` base so its assets don't collide with `till` at `/`. Add one small, explicit,
unit-tested static-file module in the server (`spa-api.ts`) mirroring the existing `media-api.ts`
house style (custom fs handler, explicit traversal guard — **not** `@hono/node-server/serve-static`,
per CLAUDE.md §3). Mount `dashboard` at `/manage` and `till` at `/` **after** all API routes, gated
on new optional config so dev (which uses the Vite dev servers) is unaffected.

**Tech Stack:** TypeScript (Node ≥24), Hono 4.x + `@hono/node-server` 1.x, Vite (front-ends), Lit
(front-ends), Vitest.

**Spec:** [docs/superpowers/specs/2026-08-26-appliance-onboarding-design.md](../specs/2026-08-26-appliance-onboarding-design.md)
(§5 "Server setup mode and serving the PWAs" — the "serve the built PWAs from the box" prerequisite;
this plan is the first half of that spec's **slice 1**. The second half — **setup-mode boot** — is a
separate follow-on plan, 1b.)

## Global Constraints

- **Node ≥ 24; pnpm 9.15.0** (`package.json` `engines`/`packageManager`).
- **TDD:** every behavioural task is failing-test-first → run it red → minimal implementation → run
  it green → commit. Prove each guard by deletion where a test asserts one.
- **Coverage thresholds — the new module lives in `apps/server`, which is `98/98/98/95`** (statements/
  lines/functions/branches). Run `pnpm --filter @waitron/server test:coverage`, not just `test`
  (CLAUDE.md §2 — CI shards run `test:coverage`). `apps/till` and `apps/dashboard` carry their own
  thresholds; the changes to them here are build config only (no new testable logic).
- **Explicit defence, never implicit** (CLAUDE.md §3): the static handler validates the resolved path
  stays within its root — an explicit, unit-tested traversal guard, the reason `media-api.ts` avoids
  `serve-static`.
- **Identifiers are English** (`packages/db/src/english-only.ts` guard scopes `packages/`, not
  `apps/`, but keep app identifiers English by convention — CLAUDE.md §3 / the english-only memo).
- **No new error codes needed** — reuse `server.config_invalid { reason }` for a misconfigured app
  dir; do not mint a code. If any code is thrown, the file must `import "./errors.js"` (it already is
  in `apps/server`).
- **House pattern to mirror exactly:** `apps/server/src/media-api.ts` (custom fs handler, `readFile`
  from `node:fs/promises`, `join` from `node:path`, `c.body(bytes, status, headers)`, plain 404s with
  no `AppError` envelope, `Logger` only for unexpected fs errors). Open it before writing `spa-api.ts`
  and copy its import lines for `Hono` and `Logger`.

---

## Task 1: Add production build to the two front-ends; move dashboard to `/manage/`

Build config only. No unit test — verified by running the builds and inspecting output (Vite build
success + emitted asset base path is the check; build config is not unit-tested logic, and
`apps/*/vite.config.ts` are not typechecked as app source).

**Files:**
- Modify: `apps/till/package.json` (add a `build` script)
- Modify: `apps/dashboard/package.json` (add a `build` script)
- Modify: `apps/dashboard/vite.config.ts` (add `base: "/manage/"`)

**Interfaces:**
- Consumes: nothing.
- Produces: `apps/till/dist/` (built SPA, asset URLs `/assets/*`, `base: "/"`) and
  `apps/dashboard/dist/` (built SPA, asset URLs `/manage/assets/*`, `base: "/manage/"`). Task 3 reads
  these directories at runtime.

- [ ] **Step 1: Add the `build` script to `apps/till/package.json`**

In the `"scripts"` block add:

```json
"build": "vite build",
```

(Place it beside the existing `dev` script. `vite` is already the dev dependency the `dev` script
uses; no new dependency.)

- [ ] **Step 2: Add the `build` script to `apps/dashboard/package.json`**

Same addition in `apps/dashboard/package.json`'s `"scripts"`:

```json
"build": "vite build",
```

- [ ] **Step 3: Set the dashboard's base path**

In `apps/dashboard/vite.config.ts`, add `base: "/manage/"` to the config object (top level, beside
`server`). The file currently has no `base` (defaults to `/`). Result:

```ts
export default defineConfig({
  base: "/manage/",
  server: {
    port: 5191,
    proxy: {
      "/management-api": "http://127.0.0.1:8080",
      "/media": "http://127.0.0.1:8080",
    },
  },
});
```

Rationale (record in the commit body): `till` stays at `/`; `dashboard` moves to `/manage/` so the
two builds' `/assets/*` do not collide when served from one origin. `base` changes only asset URLs and
the served path — the dashboard's `/management-api/*` calls are absolute-from-origin and unaffected,
and the WebAuthn RP is the origin (host), not the path, so passkeys are unaffected.

- [ ] **Step 4: Verify both builds and their base paths**

Run:

```bash
pnpm --filter @waitron/till build && pnpm --filter @waitron/dashboard build
```

Expected: both succeed. Then verify the emitted base paths:

```bash
grep -o '/assets/[^"]*' apps/till/dist/index.html | head -1        # → /assets/...
grep -o '/manage/assets/[^"]*' apps/dashboard/dist/index.html | head -1  # → /manage/assets/...
test -f apps/till/dist/index.html && test -f apps/dashboard/dist/index.html && echo OK
```

Expected: `till`'s index.html references `/assets/*`; `dashboard`'s references `/manage/assets/*`;
both `index.html` exist. If dashboard's assets are still `/assets/*`, `base` was not applied — recheck
Step 3.

- [ ] **Step 5: Commit**

```bash
git add apps/till/package.json apps/dashboard/package.json apps/dashboard/vite.config.ts
git commit -s -m "build(frontends): add vite build scripts; serve dashboard under /manage/

till builds at base / and dashboard at base /manage/ so their hashed /assets/*
bundles do not collide when both are served same-origin from the box (slice 1a).
base changes only asset URLs and the served path; the dashboard's absolute
/management-api calls and the WebAuthn origin (host, not path) are unaffected."
```

---

## Task 2: The `spa-api.ts` static-serving module (TDD)

The one piece of real logic. A small module that serves a built SPA directory at a URL prefix:
existing files are served (with a traversal guard and content-type/cache headers), the prefix root
serves `index.html`, and anything else 404s. **No history/SPA fallback** is needed because neither
front-end uses client-side URL routing (screens are in-memory Lit state; the URL never changes), so a
reload only ever lands on the prefix root. The existence check is what stops a stray unmatched path
(e.g. `/api/typo`) from returning HTML — no file, so it 404s.

**Files:**
- Create: `apps/server/src/spa-api.ts`
- Test: `apps/server/src/spa-api.test.ts`

**Interfaces:**
- Consumes: `Hono` and `Logger` (import exactly as `media-api.ts:1-15` does).
- Produces:
  - `export interface SpaDeps { root: string; basePath: string }` — `root` is the absolute built-SPA
    directory; `basePath` is the URL prefix (`""` for root, or e.g. `"/manage"`, no trailing slash).
  - `export function mountSpa(app: Hono, deps: SpaDeps, log: Logger): void` — registers the GET
    routes. For `basePath === ""` it registers `app.get("*", handler)`; otherwise it registers
    `app.get(basePath, handler)` and `app.get(\`${basePath}/*\`, handler)`. Must be called **after**
    all API routes so terminal API handlers win for their paths (the catch-all runs only for
    unmatched paths).

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/spa-api.test.ts`. It builds a throwaway SPA dir fixture, mounts it on a bare
Hono app, and asserts each behaviour via Hono's `app.request`.

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mountSpa } from "./spa-api.js";

const noopLog = () => {};

describe("mountSpa", () => {
  let root: string | undefined;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "waitron-spa-"));
    writeFileSync(join(root, "index.html"), "<!doctype html><div id=app></div>");
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "app-abc123.js"), "console.log(1)");
    writeFileSync(join(root, "favicon.svg"), "<svg/>");
  });

  afterAll(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true }); // guarded teardown (CLAUDE.md §4)
  });

  const mount = (basePath: string) => {
    const app = new Hono();
    // a terminal API route registered BEFORE the SPA, to prove the catch-all does not shadow it
    app.get("/api/ping", (c) => c.json({ ok: true }));
    mountSpa(app, { root: root!, basePath }, noopLog);
    return app;
  };

  it("serves index.html at the root of the base path with no-cache", async () => {
    const res = await mount("").request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain("id=app");
  });

  it("serves a hashed asset with an immutable cache and correct content-type", async () => {
    const res = await mount("").request("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await res.text()).toBe("console.log(1)");
  });

  it("serves a non-hashed root file (favicon) without the immutable cache", async () => {
    const res = await mount("").request("/favicon.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("404s an unknown path rather than returning index.html (no client routing)", async () => {
    const res = await mount("").request("/does/not/exist");
    expect(res.status).toBe(404);
  });

  it("does not shadow an API route mounted before it", async () => {
    const res = await mount("").request("/api/ping");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("404s a stray unmatched /api path (no file, so no HTML)", async () => {
    const res = await mount("").request("/api/typo");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
  });

  it("rejects a path-traversal attempt with 404, never escaping root", async () => {
    const res = await mount("").request("/assets/..%2f..%2f..%2fetc%2fpasswd");
    expect(res.status).toBe(404);
  });

  it("serves index.html at the base-path root and assets under it when basePath is set", async () => {
    const app = mount("/manage");
    const rootRes = await app.request("/manage/");
    expect(rootRes.status).toBe(200);
    expect(await rootRes.text()).toContain("id=app");
    const bareRes = await app.request("/manage");
    expect(bareRes.status).toBe(200);
    const assetRes = await app.request("/manage/assets/app-abc123.js");
    expect(assetRes.status).toBe(200);
    expect(await assetRes.text()).toBe("console.log(1)");
  });

  it("does not claim paths outside its base path", async () => {
    const res = await mount("/manage").request("/somewhere-else");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @waitron/server test spa-api`
Expected: FAIL — `mountSpa` is not exported / `./spa-api.js` not found.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/server/src/spa-api.ts`. Open `apps/server/src/media-api.ts:1-15` first and copy its
`Hono` and `Logger` import lines verbatim (same paths), then:

```ts
import { readFile } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
// import { Hono } and { Logger } exactly as media-api.ts does (same module paths)

export interface SpaDeps {
  /** Absolute path to the built SPA directory (holds index.html + assets/). */
  root: string;
  /** URL prefix this SPA is served under; "" for the origin root, else e.g. "/manage" (no trailing slash). */
  basePath: string;
}

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const REVALIDATE_CACHE_CONTROL = "no-cache";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const contentTypeFor = (path: string): string =>
  CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";

/**
 * Resolve a request's relative path to an absolute file inside `root`, or `null` if it would escape
 * `root` (the explicit traversal guard — the reason we serve files by hand, not via serve-static).
 * `resolve` collapses `..`; we then require the result to stay within `root`.
 */
function safeResolve(root: string, relPath: string): string | null {
  const absolute = resolve(root, "." + (relPath.startsWith("/") ? relPath : "/" + relPath));
  // `root + path separator` prevents a sibling like `<root>-evil` from passing a bare startsWith.
  if (absolute !== root && !absolute.startsWith(root + sep())) return null;
  return absolute;
}

function sep(): string {
  return join("a", "b").slice(1, 2); // the platform path separator, without importing `sep` twice
}

export function mountSpa(app: Hono, deps: SpaDeps, log: Logger): void {
  const indexFile = join(deps.root, "index.html");

  const serve = async (c: /* Context */ any, relPath: string) => {
    // The base-path root ("" or "/") serves index.html; there is no client-side routing to fall back on.
    if (relPath === "" || relPath === "/") {
      return sendFile(c, indexFile, REVALIDATE_CACHE_CONTROL, log);
    }
    const abs = safeResolve(deps.root, relPath);
    if (abs === null) return c.body(null, 404);
    const cache = relPath.includes("/assets/") ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL;
    return sendFile(c, abs, cache, log);
  };

  if (deps.basePath === "" || deps.basePath === "/") {
    app.get("*", (c) => serve(c, c.req.path));
    return;
  }
  const base = deps.basePath;
  app.get(base, (c) => serve(c, "/"));
  app.get(`${base}/*`, (c) => serve(c, c.req.path.slice(base.length) || "/"));
}

async function sendFile(c: /* Context */ any, absolutePath: string, cacheControl: string, log: Logger) {
  try {
    const bytes = new Uint8Array(await readFile(absolutePath));
    return c.body(bytes, 200, {
      "Content-Type": contentTypeFor(absolutePath),
      "Cache-Control": cacheControl,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return c.body(null, 404); // missing file → plain 404, no fallback
    log("error", "spa.read_failed", { path: absolutePath, code });
    return c.body(null, 404); // never 500, never leak fs detail — as media-api.ts does
  }
}
```

Notes for the implementer:
- Replace the `/* Context */ any` placeholders with Hono's `Context` type (`import type { Context }
  from "hono"`) — kept generic here only so this snippet reads standalone; the real file must be typed.
- `sep()` is a helper to avoid a second named import; if simpler, `import { sep } from "node:path"`
  directly and delete the helper. Either is fine — just be consistent.
- Match `media-api.ts`'s exact `log(...)` signature (level, event, fields) when you copy its imports.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @waitron/server test spa-api`
Expected: PASS (all cases).

- [ ] **Step 5: Prove the traversal guard by deletion**

Temporarily make `safeResolve` always return the naive join (drop the containment check), re-run the
traversal test, confirm it now FAILS (or would serve an out-of-root file), then restore. This proves
the guard is load-bearing (CLAUDE.md §4 "prove a guard by deletion").

- [ ] **Step 6: Full-package coverage check**

Run: `pnpm --filter @waitron/server test:coverage`
Expected: PASS at `98/98/98/95`. If a branch is uncovered (e.g. the non-ENOENT `log("error", …)`
path), add a test that triggers it — e.g. point `root` at a path whose `index.html` is actually a
directory, or mock `readFile` to throw an `EACCES` error — asserting a 404 and that `log` was called.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/spa-api.ts apps/server/src/spa-api.test.ts
git commit -s -m "feat(server): spa-api — serve a built SPA dir at a URL prefix

Custom fs handler mirroring media-api.ts (explicit traversal guard, plain 404s,
no serve-static). Serves index.html at the prefix root, hashed /assets/* with an
immutable cache, other files revalidated, and 404s everything else — no history
fallback because the front-ends have no client-side URL routing."
```

---

## Task 3: Config for the app dirs, mount both SPAs in boot, prove precedence

Wire two optional config values (the built app directories) and mount the SPAs in `boot.ts` **after**
`mountMedia` (the last API mount, `boot.ts:401`) and before `serve()` (`boot.ts:513`). Gated on the
config being set, so dev (Vite dev servers, dirs unset) is unaffected. Dashboard mounts at `/manage`
first, till at `/` last (the root catch-all must be registered last).

**Files:**
- Modify: `apps/server/src/config.ts` (add `tillAppDir?`, `dashboardAppDir?` from
  `WAITRON_TILL_APP_DIR` / `WAITRON_DASHBOARD_APP_DIR`; both optional)
- Modify: `apps/server/src/boot.ts` (mount the two SPAs after `mountMedia`, with an index.html
  existence check)
- Test: `apps/server/src/boot.spa-mount.test.ts` (a focused Hono-level test of mount precedence — no
  DB, no full boot)

**Interfaces:**
- Consumes: `mountSpa`, `SpaDeps` (Task 2); the existing `AppConfig` shape and `loadConfig` in
  `config.ts`.
- Produces: `config.tillAppDir?: string`, `config.dashboardAppDir?: string`; boot behaviour that,
  when a dir is set, serves that SPA at its prefix.

- [ ] **Step 1: Write the failing precedence test**

Because a full `startServer` needs a database, test the **mounting rule** directly on a Hono app built
the same way boot does: APIs first, then `mountSpa`. This is the behaviour that matters (the catch-all
must not shadow APIs; `/manage` must win over `/`). Create
`apps/server/src/boot.spa-mount.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mountSpa } from "./spa-api.js";

const noopLog = () => {};

describe("SPA mounting alongside API routes (boot order)", () => {
  let tillDir: string | undefined;
  let dashDir: string | undefined;

  beforeAll(() => {
    tillDir = mkdtempSync(join(tmpdir(), "waitron-till-"));
    dashDir = mkdtempSync(join(tmpdir(), "waitron-dash-"));
    writeFileSync(join(tillDir, "index.html"), "<html>till</html>");
    writeFileSync(join(dashDir, "index.html"), "<html>dashboard</html>");
    mkdirSync(join(dashDir, "assets"));
    writeFileSync(join(dashDir, "assets", "d-1.js"), "// dashboard asset");
  });

  afterAll(() => {
    if (tillDir !== undefined) rmSync(tillDir, { recursive: true, force: true });
    if (dashDir !== undefined) rmSync(dashDir, { recursive: true, force: true });
  });

  const build = () => {
    const app = new Hono();
    // stand-ins for the real API + health routes, registered first exactly as boot.ts does
    app.get("/health", (c) => c.json({ ok: true }));
    app.get("/api/till", (c) => c.json({ api: "till" }));
    app.get("/management-api/staff-roster", (c) => c.json({ api: "management" }));
    // then the SPAs, dashboard (/manage) before till (/), as boot will mount them
    mountSpa(app, { root: dashDir!, basePath: "/manage" }, noopLog);
    mountSpa(app, { root: tillDir!, basePath: "" }, noopLog);
    return app;
  };

  it("routes /api and /management-api to the APIs, not the SPA catch-all", async () => {
    const app = build();
    expect(await (await app.request("/api/till")).json()).toEqual({ api: "till" });
    expect(await (await app.request("/management-api/staff-roster")).json()).toEqual({
      api: "management",
    });
    expect((await app.request("/health")).status).toBe(200);
  });

  it("serves the till at / and the dashboard at /manage", async () => {
    const app = build();
    expect(await (await app.request("/")).text()).toContain("till");
    expect(await (await app.request("/manage/")).text()).toContain("dashboard");
    expect(await (await app.request("/manage/assets/d-1.js")).text()).toContain("dashboard asset");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @waitron/server test boot.spa-mount`
Expected: FAIL only if `mountSpa` behaviour is wrong; if Task 2 is correct this may already pass. If
it passes immediately, that is fine — it is a **regression guard** for the mount order. (Note this in
the commit; a test that passes on first write is acceptable when it pins an ordering contract, but
prove it bites by swapping the two `mountSpa` calls' order and/or registering the catch-all before the
API and watching it fail, then restore.)

- [ ] **Step 3: Add the config fields**

In `apps/server/src/config.ts`, in the `AppConfig` type add:

```ts
  /** Built `till` SPA directory to serve at "/", or undefined to not serve it (dev uses Vite). */
  tillAppDir?: string;
  /** Built `dashboard` SPA directory to serve at "/manage", or undefined. */
  dashboardAppDir?: string;
```

In `loadConfig`'s returned object, read them as optional (mirror how an optional string env is read
elsewhere — absent/empty → `undefined`, using the existing `isUnset` helper):

```ts
  tillAppDir: isUnset(env.WAITRON_TILL_APP_DIR) ? undefined : env.WAITRON_TILL_APP_DIR,
  dashboardAppDir: isUnset(env.WAITRON_DASHBOARD_APP_DIR) ? undefined : env.WAITRON_DASHBOARD_APP_DIR,
```

- [ ] **Step 4: Write the failing config test**

In the existing `apps/server/src/config.test.ts` (follow its established style), add:

```ts
it("reads WAITRON_TILL_APP_DIR / WAITRON_DASHBOARD_APP_DIR when set, else undefined", () => {
  const base = validBaseEnv(); // the suite's helper that yields a full valid env; reuse it
  const off = loadConfig(base, MIGRATIONS_ROOT, MEDIA_ROOT);
  expect(off.tillAppDir).toBeUndefined();
  expect(off.dashboardAppDir).toBeUndefined();

  const on = loadConfig(
    { ...base, WAITRON_TILL_APP_DIR: "/srv/till", WAITRON_DASHBOARD_APP_DIR: "/srv/dash" },
    MIGRATIONS_ROOT,
    MEDIA_ROOT,
  );
  expect(on.tillAppDir).toBe("/srv/till");
  expect(on.dashboardAppDir).toBe("/srv/dash");
});
```

(Use the same fixtures/helpers the surrounding `config.test.ts` cases use — `validBaseEnv`,
`MIGRATIONS_ROOT`, `MEDIA_ROOT` are placeholders for whatever that file already defines; open it and
match.)

- [ ] **Step 5: Run config test red → green**

Run: `pnpm --filter @waitron/server test config`
Expected: FAIL before Step 3's fields exist / after only the test is added; PASS once the fields are
read. (If you wrote Step 3 before Step 4, write the test, watch it pass, then prove it by removing the
`tillAppDir` read and watching it fail.)

- [ ] **Step 6: Mount the SPAs in boot**

In `apps/server/src/boot.ts`, immediately **after** `mountMedia(app, …)` (`boot.ts:401`) and before
the sync block / `serve()`, add:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { mountSpa } from "./spa-api.js";
// ... (place imports with the other node/app imports at the top)

// Serve the built front-ends same-origin, when their dirs are configured (production/appliance).
// Dev leaves these unset and uses the Vite dev servers, so nothing mounts here.
if (config.dashboardAppDir !== undefined) {
  if (!existsSync(join(config.dashboardAppDir, "index.html"))) {
    throw new AppError("server.config_invalid", { reason: "dashboard_app_dir_missing_index" });
  }
  mountSpa(app, { root: config.dashboardAppDir, basePath: "/manage" }, log);
}
if (config.tillAppDir !== undefined) {
  if (!existsSync(join(config.tillAppDir, "index.html"))) {
    throw new AppError("server.config_invalid", { reason: "till_app_dir_missing_index" });
  }
  mountSpa(app, { root: config.tillAppDir, basePath: "" }, log); // "" = root catch-all — MUST be last
}
```

Notes:
- Mount **dashboard before till** so `/manage/*` wins; the till root catch-all is registered last so
  it cannot shadow `/manage`, `/api`, `/management-api`, `/media`, `/health`, or the sync routes.
- `AppError` and `log` are already in scope in `boot.ts`; `server.config_invalid` is an existing code
  (do not add one). Confirm `boot.ts` already `import "./errors.js"` — it does (via the app).
- If the sync block (`boot.ts:410+`) mounts more routes, keep the SPA mounts **after** it too, or
  ensure the sync routes are mounted before the till catch-all. Safest: place these two `if` blocks
  immediately before `serve()` at `boot.ts:513`, after every other mount including sync.

- [ ] **Step 7: Full-package coverage check**

Run: `pnpm --filter @waitron/server test:coverage`
Expected: PASS at `98/98/98/95`. The two new `throw` branches (missing index.html) need coverage —
add a small test that calls the mount logic with a dir lacking `index.html` and asserts
`server.config_invalid`. If that logic is inline in `boot.ts` and hard to reach without a full boot,
extract it into a tiny exported helper in `spa-api.ts`
(`export function assertBuiltApp(dir: string): void` that throws `server.config_invalid`), unit-test
that, and call it from boot — preferable to leaving an uncovered branch in the un-unit-testable boot
path.

- [ ] **Step 8: Manual end-to-end smoke (documented, not a unit test)**

With a provisioned dev DB (`pnpm dev:setup` once), build the apps (Task 1) and run the server with the
app dirs set, then curl each surface:

```bash
pnpm --filter @waitron/till build && pnpm --filter @waitron/dashboard build
WAITRON_TILL_APP_DIR=apps/till/dist WAITRON_DASHBOARD_APP_DIR=apps/dashboard/dist \
  node apps/server/scripts/dev-server.mjs &   # or the built server; uses apps/server/.env
sleep 2
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:8080/            # 200 text/html (till)
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:8080/manage/     # 200 text/html (dashboard)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/health                      # 200/503 (health, not HTML)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/api/till                    # NOT html — the till API
```

Expected: `/` and `/manage/` return HTML; `/health` and `/api/*` are unaffected. (This is a
verification step, not a committed test — the committed coverage lives in Tasks 2–3.)

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/config.ts apps/server/src/boot.ts \
        apps/server/src/config.test.ts apps/server/src/boot.spa-mount.test.ts apps/server/src/spa-api.ts
git commit -s -m "feat(server): serve the built till and dashboard from the box

New WAITRON_TILL_APP_DIR / WAITRON_DASHBOARD_APP_DIR config (both optional); when
set, boot mounts the built SPAs after every API route — dashboard at /manage,
till at / (root catch-all, mounted last). Dev leaves them unset and keeps using
the Vite dev servers. A configured dir without index.html fails boot loudly with
server.config_invalid."
```

---

## Self-Review

**1. Spec coverage** (against spec §5 "serving the PWAs"):
- "Build both Vite apps to static bundles" → Task 1. ✅
- "serve them from Hono with a fallback-to-`index.html` … and correct caching, at path roots (`/` =
  till, `/manage` = dashboard)" → Tasks 2–3. ✅ — with the correction that **no history fallback** is
  needed (the front-ends have no client-side routing, verified); the spec's "fallback-to-index.html"
  assumption is narrowed to "the prefix root serves index.html," recorded in Task 2's preamble.
- "same origin, so the existing httpOnly-cookie auth is unchanged" → both clients are `baseUrl=""`
  same-origin; nothing here touches auth. ✅
- **Deliberately NOT in this plan (1b, next):** setup-mode boot / unprovisioned detection / the config
  restructuring that lets the server start without a venue, and `dev:onboard`. This plan assumes a
  provisioned box (or the dev `.env`); it only changes how the app is *served*, never boot's
  provisioned-or-not behaviour. Also **not** here: making the SPAs installable PWAs (service worker +
  web manifest) — a later slice (needed for Add-to-Home-Screen), and the front-ends have neither
  today.

**2. Placeholder scan:** The `/* Context */ any` and `validBaseEnv`/`MIGRATIONS_ROOT` tokens are
explicitly flagged as "match the existing file" anchors, not left as blind TODOs — each names the
concrete thing to copy (Hono's `Context`; `config.test.ts`'s existing helpers). No "add error
handling"/"handle edge cases" placeholders; every step has runnable code or an exact command.

**3. Type consistency:** `SpaDeps { root, basePath }` and `mountSpa(app, deps, log)` are used
identically in Tasks 2 and 3 and both test files. `config.tillAppDir`/`config.dashboardAppDir`
(optional `string`) are defined in Task 3 Step 3 and read in Step 6. `server.config_invalid { reason }`
matches the existing code's shape (a `reason` field, per the config §2 findings).

**Known deviation from strict TDD, called out:** Task 1 (build scripts / `base`) and Task 3 Step 8
(curl smoke) are verification-by-running, not unit tests, because Vite build config and a live HTTP
bind are not unit-testable logic. All *logic* (the handler, the config read, the mount precedence, the
missing-index guard) is TDD'd in Tasks 2–3.


> **2026-09-06 update:** Till and dashboard now use path navigation. Browser HTML requests under
> `/tabs` and `/manage` serve the appropriate app page, including nested paths; APIs and assets
> retain their responses. See [UI navigation and controls](2026-09-06-ui-navigation-and-controls.md).
