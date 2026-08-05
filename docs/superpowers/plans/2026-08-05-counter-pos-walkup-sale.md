# Counter POS — walk-up cash sale (sub-project 7, slice 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A logged-in operator rings up a cash sale at the deli counter — pick products (weighed by keypad), take cash, the sale files with AEAT, and a legally-correct ticket + QR displays — with no fiscal machinery reimplemented.

**Architecture:** A new `apps/till` Lit browser app talks to new HTTPS/JSON endpoints on `apps/server`'s existing Hono app; each endpoint opens `withTenant`/`asAppUser` and calls the already-built `@waitron/catalogue` / `@waitron/core` / `@waitron/identity` domain functions. The server is the price authority (re-prices every basket) and resolves the till identity from config. The screen is built as widgets coordinating through one shared in-browser working-order store — the seam later slices (park/retrieve, kitchen, the layout editor) extend.

**Tech Stack:** TypeScript (ESM, `moduleResolution: bundler`), Lit 3 + `@waitron/ui` primitives, Vite 6, Vitest 3 (`@vitest/browser` + Playwright for the till; Testcontainers Postgres for the API), Hono + `@hono/node-server`, Drizzle, pnpm workspace.

Design spec: `docs/superpowers/specs/2026-08-05-counter-pos-walkup-sale-design.md`. Legal basis for the ticket: `docs/compliance/verifactu-findings.md` §14.

## Global Constraints

- **English is the UI base language; Spanish is an i18n translation** — never hardcode Spanish in source (spec §9). Ship `en` (base) + `es`.
- **The server is the price authority** — the browser sends `{ productId, quantity }`; the server re-reads the catalogue and re-prices with `priceBasket` before filing. Never trust or file a browser-computed total (spec §2).
- **Reuse domain functions verbatim** — no re-implementation of pricing, chaining, or filing (spec §9). `recordSale` is called with `settlement.kind = "immediate"`.
- **No new tenant-scoped tables, no migrations, no `working_orders` write** in slice 1 (spec §4, §13). The `workingOrderId` is a generated UUID.
- **Widgets coordinate only through the shared working-order store + events — never direct references** (spec §3).
- **Transport is HTTPS with `Secure`, `httpOnly`, `SameSite=Strict` session cookies** (spec §2). TLS is served by the Node process via a config-supplied cert/key; production local-CA trust + LAN binding + static-bundle serving are deployment (#9), out of this slice.
- **Money is a `Decimal` string end to end**; format for display only (es-ES → `12,27 €`). Reuse `@waitron/shared` decimal math; add the one missing display formatter.
- **Error codes name the DOMAIN CONCEPT, not the package** (`sale.*`, `session.*`, `staff.*`), declared by augmenting `@waitron/shared`'s `ErrorParams`; codes are never renamed once shipped.
- **Coverage thresholds:** 98/98/98/95 for `@waitron/identity` and `apps/server`; `apps/till` mirrors `@waitron/ui`'s 95/95/90/88 (browser package, documented reason).
- **Real-Postgres suites need `TESTCONTAINERS_RYUK_DISABLED=true` locally.** `apps/*` is exempt from the `english-only` guard.
- **Every commit is `git commit -s`.**

---

## File Structure

**New — `@waitron/identity` (one new export):**
- `packages/identity/src/staff.ts` (modify) — add `listActiveStaff(tx)`; test `packages/identity/src/staff.test.ts` (modify).

**New — `apps/server` (the till API):**
- `apps/server/src/till-config.ts` — resolve `{ tenantId, tillId, nodeId, seriesId, locale, invoiceLocales }` from env. Test: `till-config.test.ts`.
- `apps/server/src/till-api.ts` — `mountTillApi(app, deps, log)`; the six routes + session-cookie helpers. Test: `till-api.test.ts` (PGlite) + `till-api.realpg.test.ts` (Testcontainers, the sale path).
- `apps/server/src/till-sale.ts` — `recordTillSale(deps, session, body)`: re-price + `recordSale` immediate. Test: `till-sale.test.ts`.
- `apps/server/src/errors.ts` (modify) — new `sale.*` / `staff.*` / `session.*` codes as needed.
- `apps/server/src/tls.ts` — build the `serve()` TLS options from config. Test: `tls.test.ts`.
- `apps/server/src/config.ts` (modify) — TLS + till-identity env. `apps/server/src/boot.ts` (modify) — mount the till API, pass TLS options to `serve`.

**New — `apps/till` (the browser app):**
- `apps/till/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,index.html}` — scaffold.
- `apps/till/src/main.ts` — bootstrap (applyTokens, registerIcons, mount `<till-app>`).
- `apps/till/src/i18n/strings.ts` — `en` (base) + `es` catalogues. `apps/till/src/i18n/t.ts` — `t()` + `currentLocale`. `apps/till/src/i18n/format.ts` — `formatMoney`.
- `apps/till/src/api/client.ts` — `TillApi` fetch client.
- `apps/till/src/state/working-order.ts` — `WorkingOrderStore`.
- `apps/till/src/qr.ts` — `qrSvg(text)`.
- `apps/till/src/widgets/{product-grid,basket,total,tender-pay}.ts` — the four widgets.
- `apps/till/src/screens/{lock-screen,counter-screen,ticket-view}.ts` — the three screens.
- `apps/till/src/layout.ts` — the layout-A definition.
- `apps/till/src/till-app.ts` — the root element (routing lock↔counter↔ticket, wiring store↔api).
- `*.test.ts` alongside each.

**Modify — CI/scope wiring (for the new browser app):**
- `scripts/changed-scope.mjs`, `.github/workflows/ci.yml`, and `scripts/ci-workflow.test.mjs` stays green (it asserts the two lists agree).

---

# Phase 1 — Backend: the till API on `apps/server`

### Task 1: `listActiveStaff` — the pre-login staff read

The lock screen lists active staff before any session exists, so this cannot go through `authorize`. It is tenant-scoped by RLS (the caller opens `withTenant`) and returns only `{ personId, displayName }` — no PIN hashes, no roles.

**Files:**
- Modify: `packages/identity/src/staff.ts`
- Modify: `packages/identity/src/staff.test.ts`
- Modify: `packages/identity/src/index.ts` (export)

**Interfaces:**
- Produces: `listActiveStaff(tx: Transaction): Promise<StaffListEntry[]>` where `StaffListEntry = { personId: string; displayName: string }`, ordered by `displayName`, `active` persons only.
- Consumes: the `persons` table + `Transaction` from `@waitron/db` (already imported in `staff.ts`).

- [ ] **Step 1: Write the failing test.** Append to `packages/identity/src/staff.test.ts` (it already has a PGlite suite that seeds a tenant and creates persons):

```ts
it("listActiveStaff returns active persons' id + name, sorted, no secrets", async () => {
  const tx = /* the suite's tx under withTenant for the seeded tenant */;
  await createPerson(tx, { actorSessionId: adminSession.id, displayName: "Zoe", role: "staff", pin: "4444" });
  await createPerson(tx, { actorSessionId: adminSession.id, displayName: "Ana", role: "supervisor", pin: "5555" });
  const suspended = await createPerson(tx, { actorSessionId: adminSession.id, displayName: "Gone", role: "staff", pin: "6666" });
  await suspendPerson(tx, { actorSessionId: adminSession.id, personId: suspended.id });

  const staff = await listActiveStaff(tx);

  expect(staff.map((s) => s.displayName)).toEqual(["Ana", "Zoe"]); // sorted, suspended excluded
  expect(Object.keys(staff[0])).toEqual(["personId", "displayName"]); // no pinHash, no role
});
```

- [ ] **Step 2: Run it, watch it fail.** `cd packages/identity && TESTCONTAINERS_RYUK_DISABLED=true pnpm vitest run src/staff.test.ts -t "listActiveStaff"` → FAIL (`listActiveStaff is not a function`).

- [ ] **Step 3: Implement.** In `packages/identity/src/staff.ts`:

```ts
export interface StaffListEntry {
  personId: string;
  displayName: string;
}

/**
 * Pre-login roster for the till lock screen. Tenant-scoped by RLS via the
 * caller's transaction; returns only id + name for `active` persons, so it is
 * safe to expose before a session exists. No PIN material, no role.
 */
export async function listActiveStaff(tx: Transaction): Promise<StaffListEntry[]> {
  const rows = await tx
    .select({ personId: persons.id, displayName: persons.displayName })
    .from(persons)
    .where(eq(persons.status, "active"))
    .orderBy(persons.displayName);
  return rows.map((r) => ({ personId: r.personId, displayName: r.displayName }));
}
```
Add `eq` to the existing `drizzle-orm` import if not present, and `persons` is already imported in `staff.ts`.

- [ ] **Step 4: Export it.** In `packages/identity/src/index.ts` add `listActiveStaff` and `type StaffListEntry` to the staff export block.

- [ ] **Step 5: Prove the guard.** Temporarily change `"active"` to `"suspended"`; re-run; the test must fail (proves the status filter is load-bearing). Restore.

- [ ] **Step 6: Run the whole package unfiltered** (cross-cutting guard suites): `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/identity test:coverage` → PASS.

- [ ] **Step 7: Commit.** `git add packages/identity && git commit -s -m "feat(identity): listActiveStaff pre-login roster for the till lock screen"`

---

### Task 2: `till-config` — resolve the till's identity from env

The server already knows which till it is (provisioning stood it up). Resolve the four fiscal ids + locale from env, branded, failing loudly on a bad/missing value.

**Files:**
- Create: `apps/server/src/till-config.ts`
- Create: `apps/server/src/till-config.test.ts`
- Modify: `apps/server/src/errors.ts` (add `server.till_config_missing`, `server.till_config_invalid`)

**Interfaces:**
- Produces: `loadTillConfig(env: NodeJS.ProcessEnv): TillConfig` where
  `TillConfig = { tenantId: TenantId; tillId: TillId; nodeId: NodeId; seriesId: SeriesId; locale: string; invoiceLocales: string[] }`.
- Consumes: brand fns `tenantId, tillId, nodeId, seriesId` from `@waitron/shared`.

- [ ] **Step 1: Add the error codes.** In `apps/server/src/errors.ts` add to the `declare module "@waitron/shared"` block:

```ts
/** A required WAITRON_TILL_* env var is unset. `key` names it (no value echoed). */
"server.till_config_missing": { key: string };
/** A WAITRON_TILL_* value is present but not a valid id/locale. `key` names it. */
"server.till_config_invalid": { key: string };
```

- [ ] **Step 2: Write the failing test** (`apps/server/src/till-config.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { loadTillConfig } from "./till-config.js";
import { isAppError } from "@waitron/shared";

const UUID = "11111111-1111-4111-8111-111111111111";
const base = {
  WAITRON_TILL_TENANT_ID: UUID, WAITRON_TILL_TILL_ID: UUID,
  WAITRON_TILL_NODE_ID: UUID, WAITRON_TILL_SERIES_ID: UUID,
};

it("loads and brands the four ids, defaulting locale to es-ES", () => {
  const cfg = loadTillConfig(base);
  expect(cfg.tenantId).toBe(UUID);
  expect(cfg.locale).toBe("es-ES");
  expect(cfg.invoiceLocales).toEqual(["es-ES"]);
});

it("throws server.till_config_missing when an id is unset", () => {
  try { loadTillConfig({ ...base, WAITRON_TILL_NODE_ID: undefined }); expect.fail(); }
  catch (e) { expect(isAppError(e) && e.code).toBe("server.till_config_missing"); }
});

it("throws server.till_config_invalid on a non-uuid id", () => {
  try { loadTillConfig({ ...base, WAITRON_TILL_TILL_ID: "nope" }); expect.fail(); }
  catch (e) { expect(isAppError(e) && e.code).toBe("server.till_config_invalid"); }
});
```

- [ ] **Step 3: Run, watch fail.** `cd apps/server && pnpm vitest run src/till-config.test.ts` → FAIL.

- [ ] **Step 4: Implement** (`apps/server/src/till-config.ts`):

```ts
import "./errors.js";
import { AppError, tenantId, tillId, nodeId, seriesId } from "@waitron/shared";
import type { TenantId, TillId, NodeId, SeriesId } from "@waitron/shared";

export interface TillConfig {
  tenantId: TenantId; tillId: TillId; nodeId: NodeId; seriesId: SeriesId;
  locale: string; invoiceLocales: string[];
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (v === undefined || v === "") throw new AppError("server.till_config_missing", { key });
  return v;
}

function brand<T>(key: string, fn: (v: string) => T, raw: string): T {
  try { return fn(raw); }
  catch { throw new AppError("server.till_config_invalid", { key }); }
}

export function loadTillConfig(env: NodeJS.ProcessEnv): TillConfig {
  const locale = env.WAITRON_TILL_LOCALE ?? "es-ES";
  return {
    tenantId: brand("WAITRON_TILL_TENANT_ID", tenantId, required(env, "WAITRON_TILL_TENANT_ID")),
    tillId: brand("WAITRON_TILL_TILL_ID", tillId, required(env, "WAITRON_TILL_TILL_ID")),
    nodeId: brand("WAITRON_TILL_NODE_ID", nodeId, required(env, "WAITRON_TILL_NODE_ID")),
    seriesId: brand("WAITRON_TILL_SERIES_ID", seriesId, required(env, "WAITRON_TILL_SERIES_ID")),
    locale,
    invoiceLocales: [locale],
  };
}
```
(Confirm `AppError` is exported from `@waitron/shared`; the webhook uses `isAppError`/`AppError` from there.)

- [ ] **Step 5: Run → PASS.** `pnpm vitest run src/till-config.test.ts`.

- [ ] **Step 6: Commit.** `git add apps/server/src/till-config.* apps/server/src/errors.ts && git commit -s -m "feat(server): loadTillConfig resolves the till's fiscal identity from env"`

---

### Task 3: `recordTillSale` — server-authoritative re-price + immediate file

The heart of the slice. Given a session + a basket of `{ productId, quantity }` + a cash tender, re-read the catalogue, re-price with `priceBasket`, and file with `recordSale` immediate — inside one `withTenant`/`asAppUser` transaction.

**Files:**
- Create: `apps/server/src/till-sale.ts`
- Create: `apps/server/src/till-sale.test.ts` (real Postgres — exercises RLS + a genuine chained record)
- Modify: `apps/server/src/errors.ts` (`sale.unknown_product`, `sale.empty_basket`, `sale.unsupported_tender`)

**Interfaces:**
- Produces: `recordTillSale(deps: TillSaleDeps, cfg: TillConfig, req: TillSaleRequest): Promise<TillSaleResult>` where
  - `TillSaleRequest = { lines: { productId: string; quantity: string }[]; tender: { method: "cash"; amount: string } }`
  - `TillSaleResult = { invoiceNumber: string; issuedAt: string; total: string; vatBreakdown: { rate: string; base: string; tax: string }[]; change: string; qr: string }`
  - `TillSaleDeps = { db: Database; backend: FiscalBackend; clock: TrustedClock }`
- Consumes: `listAvailableProducts`, `priceBasket` (`@waitron/catalogue`); `recordSale`, `formatInvoiceNumber` (`@waitron/core`); `withTenant`, `asAppUser` (`@waitron/db`); `subtractDecimal`, `compareDecimal`, `workingOrderId` (`@waitron/shared`).

- [ ] **Step 1: Add the error codes** to `apps/server/src/errors.ts`:

```ts
/** A basket line referenced a product not sellable at this location. `productId` is a uuid, safe. */
"sale.unknown_product": { productId: string };
/** The basket had no lines. */
"sale.empty_basket": Record<string, never>;
/** A tender method the till does not support (slice 1: cash only). `method` echoes the request. */
"sale.unsupported_tender": { method: string };
```

- [ ] **Step 2: Write the failing test.** `apps/server/src/till-sale.test.ts` uses the **real-Postgres** harness (`apps/server/src/testing/postgres.ts` + `useRealPostgres`), provisions a venue with `applyVenue`, seeds a catalogue as the app role (mirror `catalogue-demo.ts:108-168`), then:

```ts
it("re-prices a basket authoritatively and files a chained immediate cash sale", async () => {
  const cfg = tillConfigFromVenue(venue); // brand the ids applyVenue returned
  const each = available.find((p) => p.pricingUnit === "each")!;   // 1.50 general(21%)
  const result = await recordTillSale({ db, backend, clock }, cfg, {
    lines: [{ productId: each.id, quantity: "2" }],
    tender: { method: "cash", amount: "5.00" },
  });
  expect(result.total).toBe("3.00");
  expect(result.change).toBe("2.00");            // 5.00 tendered − 3.00
  expect(result.invoiceNumber).toMatch(/^A\/\d+$/);
  expect(result.vatBreakdown).toEqual([{ rate: "21.00", base: "2.48", tax: "0.52" }]);
  // a genuine chained fiscal record exists:
  const rows = await withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return tx.select().from(registrosFacturacion); // or count for this tenant/node
  });
  expect(rows.length).toBe(1);
});

it("ignores a browser-sent price — it only reads productId + quantity", async () => {
  // TillSaleRequest has no price field; assert the type/handler never reads one.
  // Regression: send an extra `unitPrice: "0.01"` cast as any; total is still authoritative.
  const result = await recordTillSale({ db, backend, clock }, cfg,
    { lines: [{ productId: each.id, quantity: "1", unitPrice: "0.01" } as any], tender: { method: "cash", amount: "1.50" } });
  expect(result.total).toBe("1.50");
});

it("rejects an empty basket / unknown product / non-cash tender", async () => {
  await expect(recordTillSale(deps, cfg, { lines: [], tender: { method: "cash", amount: "0" } }))
    .rejects.toMatchObject({ code: "sale.empty_basket" });
  await expect(recordTillSale(deps, cfg, { lines: [{ productId: UUID_NOT_IN_CAT, quantity: "1" }], tender: { method: "cash", amount: "1" } }))
    .rejects.toMatchObject({ code: "sale.unknown_product" });
  await expect(recordTillSale(deps, cfg, { lines: [{ productId: each.id, quantity: "1" }], tender: { method: "card" as any, amount: "1.50" } }))
    .rejects.toMatchObject({ code: "sale.unsupported_tender" });
});
```

- [ ] **Step 3: Run, watch fail.** `cd apps/server && TESTCONTAINERS_RYUK_DISABLED=true pnpm vitest run src/till-sale.test.ts` → FAIL.

- [ ] **Step 4: Implement** (`apps/server/src/till-sale.ts`). Note the operator id comes from the session (Task 5 passes it); here it is a parameter:

```ts
import "./errors.js";
import { AppError, workingOrderId, subtractDecimal, compareDecimal, decimal } from "@waitron/shared";
import type { Database } from "@waitron/db";
import { withTenant, asAppUser } from "@waitron/db";
import { listAvailableProducts, priceBasket } from "@waitron/catalogue";
import { recordSale, formatInvoiceNumber } from "@waitron/core";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { randomUUID } from "node:crypto";
import type { TillConfig } from "./till-config.js";

export interface TillSaleDeps { db: Database; backend: FiscalBackend; clock: TrustedClock; }
export interface TillSaleRequest {
  lines: { productId: string; quantity: string }[];
  tender: { method: "cash"; amount: string };
}
export interface TillSaleResult {
  invoiceNumber: string; issuedAt: string; total: string;
  vatBreakdown: { rate: string; base: string; tax: string }[]; change: string; qr: string;
}

export async function recordTillSale(
  deps: TillSaleDeps, cfg: TillConfig, req: TillSaleRequest, operatorId?: string,
): Promise<TillSaleResult> {
  if (req.lines.length === 0) throw new AppError("sale.empty_basket", {});
  if (req.tender.method !== "cash") throw new AppError("sale.unsupported_tender", { method: req.tender.method });

  return withTenant(deps.db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const available = await listAvailableProducts(tx, /* locationId resolved from cfg — see note */ cfg.locationId);
    const byId = new Map(available.map((p) => [p.id, p]));
    const items = req.lines.map((l) => {
      const product = byId.get(l.productId);
      if (!product) throw new AppError("sale.unknown_product", { productId: l.productId });
      return { product, quantity: l.quantity };
    });
    const priced = priceBasket(items);

    const change = subtractDecimal(decimal(req.tender.amount), priced.total);
    if (compareDecimal(change, decimal("0.00")) < 0)
      throw new AppError("sale.tender_shortfall", { total: priced.total, tendered: req.tender.amount });

    const { fiscal } = await recordSale(tx, deps.backend, {
      tenantId: cfg.tenantId, tillId: cfg.tillId, nodeId: cfg.nodeId, seriesId: cfg.seriesId,
      workingOrderId: workingOrderId(randomUUID()),
      locale: cfg.locale, invoiceLocales: cfg.invoiceLocales,
      total: priced.total, lines: priced.lines, vatBreakdown: priced.vatBreakdown,
      fiscalBackend: "verifactu", clock: deps.clock, operatorId,
      settlement: { kind: "immediate", tenders: [
        { method: "cash", amount: req.tender.amount, tipAmount: "0.00", settledAt: deps.clock.now().instant },
      ] },
    });

    return {
      invoiceNumber: formatInvoiceNumber(fiscal.seriesCode, fiscal.number), // see note on fields
      issuedAt: fiscal.issuedAt.toISOString(),
      total: priced.total,
      vatBreakdown: priced.vatBreakdown.map((v) => ({ rate: v.rate, base: v.base, tax: v.tax })),
      change,
      qr: fiscal.verificationUrl ?? "",
    };
  });
}
```

**Implementation notes for the engineer (resolve during Step 4, do not leave open):**
- `TillConfig` in Task 2 does **not** carry `locationId`. Add `locationId: LocationId` to `TillConfig` and `WAITRON_TILL_LOCATION_ID` to `loadTillConfig` (brand with `locationId` from `@waitron/shared`) — `listAvailableProducts` needs it. Update Task 2's test to include it.
- `formatInvoiceNumber(code, number)` needs the series **code** and **number**. Confirm what `FiscalRecordRef` exposes (`packages/fiscal/src/backend.ts` — `recordId`, `state`, `issuedAt`, `offsetMinutes`, `verificationUrl`). If it does **not** expose `seriesCode`/`number`, read them back from the sale row inside the same `tx` (the sale carries its `invoice_number`), or extend the result read — pick one, write the test to the real shape. Do **not** invent a `fiscal.seriesCode` that isn't there.
- `sale.tender_shortfall` already exists in `@waitron/core` (settleSale throws it); if importing that code's namespace is awkward from `apps/server`, catch the shortfall pre-flight as above with the existing code (do not add a duplicate).

- [ ] **Step 5: Run → PASS** (all three tests, including the tampered-price regression).

- [ ] **Step 6: Prove the authoritative-pricing guard.** Temporarily make the handler trust a `req` price if present; the "ignores a browser-sent price" test must still pass (it has no price field) — then add an assertion that the function signature's `TillSaleRequest.lines` type has no price property (a compile check). Restore.

- [ ] **Step 7: Commit.** `git add apps/server/src/till-sale.* apps/server/src/errors.ts apps/server/src/till-config.* && git commit -s -m "feat(server): recordTillSale re-prices authoritatively and files an immediate cash sale"`

---

### Task 4: Session cookie helpers + `POST/DELETE /api/session`

**Files:**
- Create: `apps/server/src/till-session.ts` (cookie name, parse/set/clear, `requireSession`)
- Modify: `apps/server/src/till-api.ts` (created here), `apps/server/src/till-api.test.ts`
- Modify: `apps/server/src/errors.ts` (`session.required`)

**Interfaces:**
- Produces: `SESSION_COOKIE = "waitron_till_session"`; `setSessionCookie(c, sessionId, secure)`, `clearSessionCookie(c)`, `readSessionId(c): string | null`; `mountTillApi(app, deps, log)`.
- Consumes: Hono `Context`; `loginWithPin`, `endSession` (`@waitron/identity`); `withTenant`, `asAppUser`.

- [ ] **Step 1: Add** `session.required: Record<string, never>` to `apps/server/src/errors.ts` (fact about the request — an operation needed a session and none was open).

- [ ] **Step 2: Write the failing test** (`apps/server/src/till-api.test.ts`, PGlite via `usePgliteDb` with `CORE_MIGRATIONS, IDENTITY_MIGRATIONS`, driven by `app.request(...)` like `webhook.test.ts`):

```ts
it("POST /api/session opens a session and sets an httpOnly cookie; DELETE ends it", async () => {
  const res = await app.request("/api/session", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId: ana.id, pin: "5555" }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")!;
  expect(cookie).toMatch(/waitron_till_session=/);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Strict/i);

  const del = await app.request("/api/session", { method: "DELETE", headers: { cookie } });
  expect(del.status).toBe(200);
});

it("POST /api/session rejects a bad pin with 401 and a code", async () => {
  const res = await app.request("/api/session", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ personId: ana.id, pin: "0000" }),
  });
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ error: { code: "pin.invalid" } });
});
```

- [ ] **Step 3: Run, fail.** `cd apps/server && TESTCONTAINERS_RYUK_DISABLED=true pnpm vitest run src/till-api.test.ts` → FAIL.

- [ ] **Step 4: Implement `till-session.ts`** (use Hono's `hono/cookie` helpers `getCookie`/`setCookie`/`deleteCookie`):

```ts
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
export const SESSION_COOKIE = "waitron_till_session";
export function setSessionCookie(c: Context, sessionId: string, secure: boolean): void {
  setCookie(c, SESSION_COOKIE, sessionId, { httpOnly: true, secure, sameSite: "Strict", path: "/" });
}
export function clearSessionCookie(c: Context): void { deleteCookie(c, SESSION_COOKIE, { path: "/" }); }
export function readSessionId(c: Context): string | null { return getCookie(c, SESSION_COOKIE) ?? null; }
```

- [ ] **Step 5: Implement `mountTillApi`** with the session routes (products/sales come in Tasks 5–6). The `secure` flag comes from `deps.secureCookies` (true in prod HTTPS, false on loopback dev):

```ts
export interface TillApiDeps {
  db: Database; backend: FiscalBackend; clock: TrustedClock; cfg: TillConfig; secureCookies: boolean;
}
export function mountTillApi(app: Hono, deps: TillApiDeps, log: Logger): void {
  app.post("/api/session", (c) => run(c, log, async () => {
    const { personId, pin } = await c.req.json<{ personId: string; pin: string }>();
    const session = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return loginWithPin(tx, { tenantId: deps.cfg.tenantId, tillId: deps.cfg.tillId, personId, pin });
    });
    setSessionCookie(c, session.id, deps.secureCookies);
    return c.json({ personId: session.personId });
  }));

  app.delete("/api/session", (c) => run(c, log, async () => {
    const id = readSessionId(c);
    if (id) await withTenant(deps.db, deps.cfg.tenantId, async (tx) => { await asAppUser(tx); await endSession(tx, id); });
    clearSessionCookie(c);
    return c.json({ ok: true });
  }));
}
```
where `run(c, log, fn)` is the shared handler wrapper (Task 4a) mapping `AppError` → JSON `{ error: { code, params } }` with a status from a code→status table (`pin.invalid`/`person.*`/`session.*` → 401/409; `sale.*` client codes → 400; unknown → 500), logging only the code.

- [ ] **Step 4a (inline): the `run` wrapper.** Add to `till-api.ts`:

```ts
const STATUS: Record<string, number> = {
  "pin.invalid": 401, "person.not_found": 401, "person.suspended": 403, "session.not_open": 401,
  "session.required": 401, "sale.empty_basket": 400, "sale.unknown_product": 400,
  "sale.unsupported_tender": 400, "sale.tender_shortfall": 400, "authorization.not_permitted": 403,
};
async function run(c: Context, log: Logger, fn: () => Promise<Response>): Promise<Response> {
  try { return await fn(); }
  catch (cause) {
    if (isAppError(cause)) {
      const status = STATUS[cause.code] ?? 400;
      log(status >= 500 ? "error" : "warn", cause.code, cause.params);
      return c.json({ error: { code: cause.code, params: cause.params } }, status);
    }
    log("error", "till.failed", { errorCode: codeOf(cause) });
    return c.json({ error: { code: "server.internal" } }, 500);
  }
}
```
(Confirm `server.internal` exists or add it to `errors.ts`. Mirror the `codeOf`/`isAppError` imports from `webhook.ts`.)

- [ ] **Step 6: Run → PASS.** Both session tests.

- [ ] **Step 7: Commit.** `git add apps/server/src/till-session.ts apps/server/src/till-api.* apps/server/src/errors.ts && git commit -s -m "feat(server): till session endpoints with httpOnly SameSite cookies"`

---

### Task 5: `GET /api/till` and `GET /api/staff`

**Files:** Modify `apps/server/src/till-api.ts`, `apps/server/src/till-api.test.ts`.

**Interfaces:** Produces routes `GET /api/till` → `{ venueName, tillLabel, locale, layout }` (no secrets; `layout` is the checked-in default from the till app — for the server, return `locale` and identity labels only, the browser owns the layout) and `GET /api/staff` → `StaffListEntry[]`.

- [ ] **Step 1: Failing test:**

```ts
it("GET /api/staff lists active staff without secrets", async () => {
  const res = await app.request("/api/staff");
  expect(res.status).toBe(200);
  const staff = await res.json();
  expect(staff).toEqual([{ personId: ana.id, displayName: "Ana" }, /* … sorted */]);
});
it("GET /api/till returns the locale and no secret", async () => {
  const body = await (await app.request("/api/till")).json();
  expect(body.locale).toBe("es-ES");
  expect(JSON.stringify(body)).not.toMatch(/pin|secret|url/i);
});
```

- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement** the two routes in `mountTillApi`:

```ts
app.get("/api/staff", (c) => run(c, log, async () => {
  const staff = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => { await asAppUser(tx); return listActiveStaff(tx); });
  return c.json(staff);
}));
app.get("/api/till", (c) => run(c, log, async () =>
  c.json({ locale: deps.cfg.locale, tillLabel: deps.cfg.tillId /* or a human label from cfg */ })));
```
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit.** `-m "feat(server): GET /api/till and /api/staff"`

---

### Task 6: `GET /api/products` and `POST /api/sales` (session-guarded)

**Files:** Modify `apps/server/src/till-api.ts`, add `apps/server/src/till-api.realpg.test.ts` (the sale path against real Postgres).

**Interfaces:** Produces `GET /api/products` → `AvailableProduct[]` (auth) and `POST /api/sales` → `TillSaleResult` (auth), both requiring an open session; the sale attributes `operatorId = session.personId`.

- [ ] **Step 1: Add `requireSession`** to `till-session.ts`:

```ts
export async function requireSession(deps: { db: Database; cfg: TillConfig }, c: Context): Promise<{ personId: string; sessionId: string }> {
  const id = readSessionId(c);
  if (!id) throw new AppError("session.required", {});
  const personId = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const [row] = await tx.select({ personId: sessions.personId })
      .from(sessions).where(and(eq(sessions.id, id), isNull(sessions.endedAt)));
    return row?.personId ?? null;
  });
  if (!personId) throw new AppError("session.required", {});
  return { personId, sessionId: id };
}
```
(`sessions` schema is exported from `@waitron/identity`.)

- [ ] **Step 2: Failing tests** — `GET /api/products` returns 401 without a cookie, returns the product list with one; `POST /api/sales` files a sale and returns the ticket payload, and the response `set-cookie` is absent (session already open). Put the real-Postgres sale assertion (chained record exists) in `till-api.realpg.test.ts`, driven by `app.request` with the login cookie.

- [ ] **Step 3: Run, fail.**

- [ ] **Step 4: Implement:**

```ts
app.get("/api/products", (c) => run(c, log, async () => {
  await requireSession(deps, c);
  const products = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => { await asAppUser(tx); return listAvailableProducts(tx, deps.cfg.locationId); });
  return c.json(products);
}));
app.post("/api/sales", (c) => run(c, log, async () => {
  const { personId } = await requireSession(deps, c);
  const body = await c.req.json<TillSaleRequest>();
  const result = await recordTillSale({ db: deps.db, backend: deps.backend, clock: deps.clock }, deps.cfg, body, personId);
  return c.json(result);
}));
```
(Note `recordTillSale` opens its own `withTenant`; do not nest — call it outside any tx.)

- [ ] **Step 5: Run → PASS** (incl. the 401-without-session guard, proven by deletion of `requireSession`).

- [ ] **Step 6: Run apps/server unfiltered.** `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/server test:coverage` (name per its package.json) → PASS.

- [ ] **Step 7: Commit.** `-m "feat(server): GET /api/products and POST /api/sales (session-guarded, operator-attributed)"`

---

### Task 7: TLS-capable serving + wire the till API into boot

The Hono app is HTTP-only today. Make the Node listener serve HTTPS when a cert/key is configured (else HTTP loopback for dev). Production local-CA trust + LAN binding are deployment (#9) — this task only makes the process TLS-capable and sets `secureCookies` accordingly.

**Files:** Create `apps/server/src/tls.ts` + `tls.test.ts`; modify `apps/server/src/config.ts` (TLS + till env), `apps/server/src/boot.ts` (mount till API, pass TLS to `serve`).

- [ ] **Step 1: Config.** In `config.ts` add optional `WAITRON_TLS_CERT_FILE` / `WAITRON_TLS_KEY_FILE` and the `WAITRON_TILL_*` vars; surface `config.tls?: { certFile: string; keyFile: string }` and `config.till: TillConfig`. Add a test that both-or-neither TLS files are set (`server.config_invalid` if only one).

- [ ] **Step 2: `tls.ts`** — `buildServeOptions(base, tls)`: when `tls` present, read the files and return `{ ...base, createServer: httpsCreateServer, serverOptions: { key, cert } }` for `@hono/node-server`'s `serve`. Confirm the exact option names against `@hono/node-server`'s `serve` signature (it accepts `createServer` + `serverOptions`); write a test that boots the server with a self-signed cert (generate a cert **and its CA** in-test with `node-forge`, already a devDep) and does an `https` GET of `/health` **that trusts that CA via the request's `ca:` option** (never `rejectUnauthorized: false` — disabling verification would defeat the point of the test and model a MITM-open client; the `ca` option is also exactly how a till device is meant to trust the local CA in production) → 200.

- [ ] **Step 3: `boot.ts`** — after `mountWebhook(...)`, add:

```ts
mountTillApi(app, {
  db, backend: makeFiscalBackend(...), clock, cfg: config.till,
  secureCookies: config.tls !== undefined,
}, log);
```
and pass `buildServeOptions({ fetch: app.fetch, port: config.httpPort, hostname: config.httpHost }, config.tls)` to `serve(...)`. `backend`/`clock`: construct the `VerifactuBackend` + `systemClock()` exactly as `record-one-sale.ts:82-99,149-173` (extract a small `makeFiscalBackend(db, env)` helper in `boot.ts` or a `till-backend.ts`, tested once).

- [ ] **Step 4:** Run `apps/server` unfiltered → PASS. Boot test proves HTTPS.
- [ ] **Step 5: Commit.** `-m "feat(server): optional TLS serving; mount the till API in boot"`

---

# Phase 2 — Till app foundation (`apps/till`)

### Task 8: Scaffold `apps/till` + CI shard wiring

A new `@vitest/browser`/Playwright app. It MUST get its own CI shard or it hangs test-light (as `@waitron/ui` did).

**Files:** Create `apps/till/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,index.html,src/main.ts}`; modify `scripts/changed-scope.mjs`, `.github/workflows/ci.yml`.

- [ ] **Step 1: `apps/till/package.json`** (mirror `@waitron/ui` for the browser toolchain + `@waitron/catalogue` for workspace deps):

```json
{
  "name": "@waitron/till", "version": "0.0.0", "private": true, "type": "module",
  "main": "./src/main.ts",
  "scripts": {
    "dev": "vite", "test": "vitest run", "test:watch": "vitest",
    "test:coverage": "vitest run --coverage", "typecheck": "tsc --noEmit", "lint": "eslint ."
  },
  "dependencies": { "@waitron/ui": "workspace:*", "@waitron/shared": "workspace:*", "@waitron/catalogue": "workspace:*", "lit": "^3.2.0", "qrcode-generator": "^1.4.4" },
  "devDependencies": {
    "@vitest/browser": "^3.0.0", "@vitest/coverage-v8": "^3.0.0", "axe-core": "^4.12.1",
    "playwright": "^1.49.0", "typescript": "^5.7.0", "vite": "^6.0.0", "vitest": "^3.0.0"
  }
}
```
`qrcode-generator` is a zero-dependency, offline pure-JS QR encoder (the concrete choice the spec left open, §13). `@waitron/catalogue` is imported only for its **pure** `priceBasket` type/preview — confirm it is browser-import-clean (no Node built-ins); if not, the store previews via a copy of the arithmetic and the server stays authoritative (spec §13).

- [ ] **Step 2: `tsconfig.json`** = `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "types": ["vitest/globals"] }, "include": ["src"] }`.

- [ ] **Step 3: `vite.config.ts`** = `import { defineConfig } from "vite"; export default defineConfig({ server: { port: 5190, proxy: { "/api": "http://127.0.0.1:8080" } } });` (dev proxy to the local server).

- [ ] **Step 4: `vitest.config.ts`** — copy `packages/ui/vitest.config.ts` verbatim (the browser+playwright+`emulateColorScheme` block and the 95/95/90/88 thresholds), excluding `src/main.ts` and test helpers from coverage.

- [ ] **Step 5: `index.html`** + `src/main.ts` — model on `packages/ui/index.html` + `demo/main.ts`: a `<div id="app">`, `applyTokens(document.documentElement)`, `registerIcons({...})` (the handful of icons the till uses), and `render(html\`<till-app></till-app>\`, app)`.

- [ ] **Step 6: CI wiring.** In `scripts/changed-scope.mjs`: add `"@waitron/till"` to `OWN_SHARD_PACKAGES` and a `till` entry to `SCOPE_GATES` (its predicate: scope contains `@waitron/till`). In `.github/workflows/ci.yml`: add a `test-till` job mirroring `test-ui` (`ci.yml:532-581`), add it to `ci`'s `needs`, add `--filter "!@waitron/till"` beside the `!@waitron/ui` line in test-light (`ci.yml:667-668`), and gate `test-till` on the `till` output.

- [ ] **Step 7: Prove CI wiring.** `pnpm vitest run scripts/ci-workflow.test.mjs` → PASS (it asserts `OWN_SHARD_PACKAGES` and the test-light exclusions agree, and that each own-shard package has a shard job). Also `pnpm vitest run scripts/changed-scope.test.mjs` → PASS.

- [ ] **Step 8: Install + smoke.** `pnpm install` (from root; regenerates the lockfile), then `pnpm --filter @waitron/till typecheck` → PASS. Commit. `-m "chore(till): scaffold apps/till browser app + its own CI shard"`

---

### Task 9: i18n — English base + Spanish, and `formatMoney`

**Files:** Create `apps/till/src/i18n/{strings.ts,t.ts,format.ts}` + tests.

**Interfaces:** Produces `t(key: StringKey, locale?: string): string`, `currentLocale(): string` / `setLocale(l)`, and `formatMoney(value: string, locale?: string): string`.

- [ ] **Step 1: Failing test** (`format.test.ts`):

```ts
it("formats a Decimal string as es-ES currency", () => {
  expect(formatMoney("12.27", "es-ES")).toBe("12,27 €"); // NBSP before €
  expect(formatMoney("1500.00", "es-ES")).toBe("1500,00 €");
});
it("formats English base as €12.27", () => { expect(formatMoney("12.27", "en")).toBe("€12.27"); });
```
and `t.test.ts`:
```ts
it("resolves an English base key to Spanish", () => { expect(t("action.pay", "es-ES")).toBe("Cobrar"); });
it("falls back to the English base when a locale lacks the key", () => { expect(t("action.pay", "en")).toBe("Pay"); });
```

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement `strings.ts`** — English is the base map (the source of truth), `es` is a translation:

```ts
export const en = {
  "action.pay": "Pay", "action.confirm_payment": "Confirm payment", "action.new_sale": "New sale",
  "action.logout": "Log out", "tender.cash": "Cash", "label.change": "Change", "label.total": "Total",
  "label.tendered": "Tendered", "label.all": "All", "login.enter_pin": "Enter PIN", /* … */
} as const;
export type StringKey = keyof typeof en;
export const es: Record<StringKey, string> = {
  "action.pay": "Cobrar", "action.confirm_payment": "Confirmar cobro", "action.new_sale": "Nueva venta",
  "action.logout": "Cerrar sesión", "tender.cash": "Efectivo", "label.change": "Cambio", "label.total": "Total",
  "label.tendered": "Entregado", "label.all": "Todos", "login.enter_pin": "Introduce el PIN", /* … */
};
export const catalogues: Record<string, Partial<Record<StringKey, string>>> = { en, es, "es-ES": es };
```

- [ ] **Step 4: Implement `t.ts` / `format.ts`:**

```ts
// t.ts
import { en, catalogues, type StringKey } from "./strings.js";
let locale = "es-ES";
export function setLocale(l: string): void { locale = l; }
export function currentLocale(): string { return locale; }
export function t(key: StringKey, l: string = locale): string {
  return catalogues[l]?.[key] ?? en[key];
}
// format.ts
export function formatMoney(value: string, l: string = "es-ES"): string {
  return new Intl.NumberFormat(l, { style: "currency", currency: "EUR" }).format(Number(value));
}
```
(`Number(value)` is safe at money scale — ≤ 12 integer digits, 2 decimals, well within float precision. Never round with it; it is display-only. The design forbids storing formatted money — this formats at the edge, per spec §9.)

- [ ] **Step 5: Run → PASS.** (If Node's ICU renders a plain space vs NBSP differently under the browser runner, assert with a normalized-space matcher rather than hardcoding U+00A0 — verify the actual output first and pin it.)
- [ ] **Step 6: Commit.** `-m "feat(till): i18n layer (en base + es) and es-ES money formatter"`

---

### Task 10: The API client

**Files:** Create `apps/till/src/api/client.ts` + `client.test.ts`.

**Interfaces:** Produces `TillApi` with `getTill()`, `listStaff()`, `login(personId, pin)`, `logout()`, `listProducts()`, `recordSale(lines, tender)` — thin `fetch` wrappers (`credentials: "include"` for the cookie), throwing `{ code }` on a non-2xx JSON error.

- [ ] **Step 1: Failing test** with a stubbed `fetch`:

```ts
it("recordSale POSTs lines+tender and returns the ticket payload", async () => {
  const fetchStub = vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ invoiceNumber: "A/1", total: "3.00", change: "2.00", vatBreakdown: [], issuedAt: "…", qr: "x" }),
    { status: 200, headers: { "content-type": "application/json" } }));
  const api = new TillApi("", fetchStub);
  const r = await api.recordSale([{ productId: "p", quantity: "2" }], { method: "cash", amount: "5.00" });
  expect(fetchStub).toHaveBeenCalledWith("/api/sales", expect.objectContaining({ method: "POST", credentials: "include" }));
  expect(r.change).toBe("2.00");
});
it("throws { code } on a 4xx error body", async () => {
  const fetchStub = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "pin.invalid" } }), { status: 401 }));
  await expect(new TillApi("", fetchStub).login("p", "0000")).rejects.toMatchObject({ code: "pin.invalid" });
});
```

- [ ] **Step 2: Run, fail. Step 3: Implement** `TillApi` (constructor `(baseUrl = "", fetchImpl = fetch)`; each method `await fetchImpl(base+path, { method, credentials: "include", headers, body })`, then `if (!res.ok) throw { code: (await res.json()).error?.code ?? "server.internal" }`, else `res.json()`).
- [ ] **Step 4: Run → PASS. Step 5: Commit.** `-m "feat(till): TillApi fetch client"`

---

### Task 11: The working-order store

**Files:** Create `apps/till/src/state/working-order.ts` + test.

**Interfaces:** Produces `WorkingOrderStore` with `addProduct(product, quantity)`, `removeLine(index)`, `clear()`, `lines`, `total` (preview via `priceBasket`), `vatBreakdown`, and a `subscribe(fn)` / `emit(event)` channel (`"changed" | "product-selected"`). The store survives logout (it is not tied to a session).

- [ ] **Step 1: Failing test:**

```ts
it("adds lines and previews the total via priceBasket", () => {
  const s = new WorkingOrderStore();
  const each = { id: "p", descriptions: { "es-ES": "Café" }, pricingUnit: "each", unitPrice: "1.50", vatClass: "general", category: null } as AvailableProduct;
  s.addProduct(each, "2");
  expect(s.total).toBe("3.00");
  expect(s.lines).toHaveLength(1);
});
it("notifies subscribers on change and clears", () => {
  const s = new WorkingOrderStore(); let n = 0; s.subscribe(() => n++);
  s.addProduct(each, "1"); s.clear();
  expect(n).toBe(2); expect(s.lines).toHaveLength(0);
});
```

- [ ] **Step 2: Run, fail. Step 3: Implement** the store: hold `{ product, quantity }[]`; `total`/`vatBreakdown` are getters calling `priceBasket(this.items)` (or the copied arithmetic if catalogue isn't browser-clean — decide in Task 8 Step 1). `subscribe` pushes to a listener set; every mutation calls `this.emit("changed")`.
- [ ] **Step 4: Run → PASS. Step 5: Commit.** `-m "feat(till): working-order store with priceBasket preview + event channel"`

---

# Phase 3 — Widgets & screens

Each widget is a `LitElement` that reads the store and emits intent through it — never a direct reference to another widget (spec §3). Each gets a browser test (mount, interact, assert) mirroring `@waitron/ui`'s `test-helpers.ts` pattern, plus an axe-core a11y test per theme.

### Task 12: `product-grid` widget
- [ ] Test: given products, renders a tile per product (description in the current locale, price via `formatMoney`); tapping an `each` tile calls `store.addProduct(product, "1")`; tapping a `weight` tile emits `"product-selected"` (the kg keypad, Task 15, handles it). a11y: tiles are `<wt-button>`s with accessible names, ≥44px.
- [ ] Implement `apps/till/src/widgets/product-grid.ts` (`@customElement("till-product-grid")`, `@property() products`, `@property({attribute:false}) store`). Commit.

### Task 13: `basket` widget
- [ ] Test: renders one row per `store.lines` (description, qty, line total via `formatMoney`); a remove control calls `store.removeLine(i)`; subscribes to the store and re-renders on `"changed"`; empty state shows a placeholder.
- [ ] Implement `till-basket`. Commit.

### Task 14: `total` widget
- [ ] Test: shows `formatMoney(store.total)`; updates on `"changed"`.
- [ ] Implement `till-total`. Commit.

### Task 15: `tender-pay` widget + kg keypad
- [ ] Test (pay): a **Pay** `<wt-button>` (label `t("action.pay")`) is disabled when the basket is empty; when tapped it opens the cash screen; entering a tendered amount shows change (`tendered − total`, via decimal subtraction, `formatMoney`); **Confirm payment** is disabled while `tendered < total`; confirming emits `"confirm-payment"` with the tender.
- [ ] Test (kg keypad): reacting to `"product-selected"` for a `weight` product, a numeric keypad captures kg; **Add** calls `store.addProduct(product, kg)`. Reject `0`/empty.
- [ ] Implement `till-tender-pay` (owns both the cash pad and, for slice-1 simplicity, the kg entry as a shared numeric-pad component `till-numeric-pad`). Commit.

### Task 16: `lock-screen` (staff picker + PIN)
- [ ] Test: renders `api.listStaff()` names as `<wt-button>`s; tapping a name reveals the PIN pad; entering the PIN calls `api.login(personId, pin)`; on success emits `"logged-in"`; on `{ code: "pin.invalid" }` shows a localized error and clears the PIN.
- [ ] Implement `till-lock-screen`. Commit.

### Task 17: `ticket-view` + QR
- [ ] Test: given a `TillSaleResult`, renders the legally-required fields (spec §7 / findings §14): issuer name+NIF, **date**, `invoiceNumber` (`A/1`), the line descriptions, the **base per rate**, total, and the **QR** (from `result.qr`) + the **VERI\*FACTU** legend. Assert the QR element contains an `<svg>` and the legend text is present. **New sale** button emits `"new-sale"`.
- [ ] Implement `till-ticket-view` using `qrSvg(result.qr)` (`apps/till/src/qr.ts`, wrapping `qrcode-generator`: `const qr = qrcode(0, "M"); qr.addData(text); qr.make(); return qr.createSvgTag({...});`). The issuer name/NIF come from `GET /api/till` (extend it to return `venueName` + `nif` — public, non-secret). Commit.

### Task 18: `counter-screen` — the widget shell + layout A
- [ ] **Step 1:** Define `apps/till/src/layout.ts`: `export const LAYOUT_A: LayoutDef = [{ type: "product-grid", region: "main", config: {} }, { type: "basket", region: "aside", config: {} }, { type: "total", region: "aside", config: {} }, { type: "tender-pay", region: "aside", config: {} }];` (`LayoutDef = { type: WidgetType; region: "main" | "aside"; config: Record<string, unknown> }[]`).
- [ ] **Step 2:** Test: `till-counter-screen` renders the four widgets into the two regions per `LAYOUT_A`, all sharing the one `store`; header shows the operator name + a **Log out** button; passes axe in light+dark.
- [ ] **Step 3:** Implement the shell: it maps `LAYOUT_A` to widget elements by `type`, passing the shared `store` and (for product-grid) the fetched products. Commit.

### Task 19: `till-app` — the root, wiring it together
- [ ] **Step 1:** Test the flow with a stubbed `TillApi`:
  - starts on `till-lock-screen`; after `"logged-in"` → `till-counter-screen`; `GET /api/products` is loaded.
  - `"confirm-payment"` → `api.recordSale(store.lines, tender)` → `till-ticket-view` with the result.
  - `"new-sale"` → `store.clear()` → back to counter with an empty basket.
  - `"logout"` → `api.logout()` → lock screen, **and the basket survives** (assert `store.lines` unchanged across a logout with items).
- [ ] **Step 2:** Implement `till-app` (holds the single `WorkingOrderStore` + `TillApi`, a `screen` state machine, and the event wiring). `setLocale` from `GET /api/till`'s locale on boot.
- [ ] **Step 3:** Run `pnpm --filter @waitron/till test:coverage` (unfiltered) → PASS. Commit. `-m "feat(till): root app wiring — login → sell → pay → ticket → new sale; logout keeps the basket"`

---

# Phase 4 — End-to-end, demo, and finish

### Task 20: End-to-end sale test (server + real fiscal chain)
- [ ] **Step 1:** In `apps/server`, add `till-api.e2e.realpg.test.ts`: provision a venue, seed a catalogue, then via `app.request` drive `POST /api/session` → `GET /api/products` → `POST /api/sales` (cash), asserting: the response carries every legally-required ticket field (invoiceNumber `A/1`, issuedAt, per-rate base, total, non-empty `qr`), a genuine `registros_facturacion` row exists for the tenant/node, and the chain is intact (`huella`/`secuencia` present). This is the "ring up a sandwich" proof.
- [ ] **Step 2:** Run → PASS. Commit. `-m "test(server): end-to-end till cash sale files a chained fiscal record"`

### Task 21: Demo script + docs
- [ ] **Step 1:** Add `apps/server/scripts/till-demo.ts` (self-migrating, mirrors `catalogue-demo.ts` setup) that boots the server, opens a session over the API, and rings one sale — a runnable manual check. Add a `demo:till` script to `apps/server/package.json` (via `tsx`, like `demo:catalogue`).
- [ ] **Step 2:** Add `apps/till/README.md`: how to run it in dev (`pnpm --filter @waitron/server ...` to boot the API with `WAITRON_TILL_*` env, then `pnpm --filter @waitron/till dev`, open `:5190`), and the slice's boundaries (cash only, no offline/card/hardware; TLS + LAN + static-serving are deployment).
- [ ] **Step 3:** Commit. `-m "docs(till): demo script + dev run instructions"`

### Task 22: Full gate + backlog
- [ ] **Step 1:** From root: `pnpm lint && pnpm typecheck && pnpm format:check`. Fix any findings.
- [ ] **Step 2:** `pnpm install` (lockfile committed), then the scoped coverage for the touched packages: `TESTCONTAINERS_RYUK_DISABLED=true pnpm --filter @waitron/identity --filter @waitron/server --filter @waitron/till test:coverage`. Also run the repo-level guard suites: `pnpm vitest run scripts/` (english-only, guarded-teardowns, ci-workflow, changed-scope).
- [ ] **Step 3:** Update `docs/backlog.md`: move the Counter POS slice-1 (7a) row to reflect it is built; note the remaining #7 slices (7b park/retrieve, 7c prepare/collect) and the deferred edges (TLS/LAN/static-serving → #9; card/offline/hardware/refunds-voids; the layout & receipt editors; multi-till). This backlog edit lands with the feature PR (it is code-adjacent), not the docs-direct-to-main path.
- [ ] **Step 4:** Commit. `-m "docs(backlog): Counter POS walk-up cash sale (7a) built; record deferred edges"`

---

## Self-Review (completed against the spec)

- **Spec coverage:** §2 transport → Tasks 4,7 (HTTPS/Secure cookie, TLS serving); price authority → Task 3. §3 widgets/shared-store → Tasks 11–19. §4 working order (no `working_orders` write, generated id) → Tasks 3,11. §5 flow → Tasks 16–19. §6 identity seam (pre-login staff read, logout, no auth gates) → Tasks 1,4,16. §7 receipt legal fields → Task 17. §8 theming → inherited from `@waitron/ui` tokens (all widgets); a11y tests per theme. §9 i18n (en base + es) + money format → Tasks 9. §10 API surface → Tasks 4–6. §11 testing → each task is TDD; real-PG + browser + e2e. §12 no new tables → honored (no migration task). §13/§14 open questions resolved in-plan: QR lib (`qrcode-generator`, Task 8/17), session cookie (httpOnly+Secure, Task 4), TLS (Task 7), i18n choice (in-house, Task 9), `formatMoney` (Task 9), layout-def shape (Task 18), `priceBasket` browser-cleanliness (flagged Task 8/11).
- **Known must-confirm-during-implementation (not placeholders — each has a concrete fallback):** (a) `FiscalRecordRef` fields for `invoiceNumber` — read back from the sale row if `seriesCode`/`number` aren't on the ref (Task 3 note); (b) `@hono/node-server` TLS option names (Task 7); (c) `@waitron/catalogue` browser-import cleanliness → copied arithmetic fallback (Task 8/11); (d) NBSP vs space in `formatMoney` output → pin to the observed value (Task 9).
- **Type consistency:** `TillConfig` gains `locationId` (Task 3 note updates Task 2); `TillSaleRequest`/`TillSaleResult` are the single shapes shared by `recordTillSale` (Task 3) and the `/api/sales` route (Task 6) and the `TillApi` client (Task 10) and `till-ticket-view` (Task 17).

---

## Execution note

Recommended: **subagent-driven** (superpowers:subagent-driven-development) — a fresh implementer per task with a review gate between, per the user's standing preference (Opus 5 for the code-writing subagents). Phase 1 (backend) and Phase 3 (widgets) each parallelize within a phase after their foundation task; keep the ordering across phases.
