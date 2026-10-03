# Venue settings and the new sidebar: implementation plan (A261 step 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the dashboard sidebar to the spec's layout and gather the set-once settings (receipts, table statuses, adjustment reasons, kitchen, floor) onto one new **Venue settings** page with a tab per subject, changing no behaviour except two small fixes and one missing switch.

**Architecture:** A new core screen, `dashboard-venue-settings-screen` (in `apps/dashboard`), owns the page's one `h1` and a `wt-tabs` strip whose tab keys and order are fixed in core. Each tab holds one or more **panels**. Core panels are today's Receipts, Statuses and Kitchen screens with their own `h1` removed. Modules add panels through a new `settingsPanels` seat on the dashboard contract (`packages/dashboard-kit/src/contract.ts`), validated in `#activate` the way nav groups are. The sidebar gains a **Venue operations** group; a group with no visible page no longer draws its header.

**Tech Stack:** TypeScript, Lit web components, Hono routes, Drizzle on SQLite (`node:sqlite`), Vitest 4 (browser mode in real headless Chromium for UI suites).

**Spec:** `docs/superpowers/specs/2026-10-03-venue-operations-design.md` — §2 (sidebar), §3 (Venue settings), §5 (Receipts), §11 step 1. Everything else in the spec is a later step and out of scope here.

## Decisions (the driver's defaults — the owner may strike any of them)

1. **Sidebar order:** Overview (no header), Reporting, Service, Products and menus, **Venue operations** (new), Team, Purchasing, Settings. Service keeps only Bookings (a module) for now; Live floor is a later spec. Venue operations holds, in order: **Departments and zones** (today's venue-service `venue-operations` screen, renamed in the sidebar), **Floor plan** (core `floor`, moved from Service), **Prep stations** (module, moved from Service), **Venue settings** (new). Hours (spec §7) arrives in step 5 and will slot between Departments and zones and Floor plan. Statuses, Kitchen, Receipts and Adjustment reasons leave the sidebar. A group with no page this session may open draws no header (today it would draw an empty header — checked: `#shownNav` returns `pages: []` and `#nav` draws the header for it).
2. **Venue settings** is a core screen at `/manage/venue-settings/view/<tab>`. It owns the page's single `h1`. Tab keys and order: `receipts`, `table-statuses`, `adjustment-reasons`, `kitchen`, `floor`. A missing, unknown or not-visible tab in the address shows the first visible tab and replaces the history entry; choosing a tab pushes one. A tab shows only when at least one of its panels is visible to this session; ~~the page shows in the sidebar only when at least one tab does~~ — **left out by this plan** (see I). Hidden panels stay mounted (design-system rule).
3. **Panels.** Core: Receipts (manager or admin only, as today), Table statuses (today's Statuses screen; no rule, as today), Kitchen (courses, bump mode, fire control; no rule, as today; its "Stations are set up on Prep stations" link goes). Module: adjustments contributes its reasons screen as the `adjustment-reasons` panel (permission `adjustment.manage`) and stops placing it in the sidebar; its report stays in Reporting. venue-service contributes the four "Changes after sending" settings as a `kitchen` panel, removes that tab from its own screen, and contributes a `floor` panel with one switch for `service_settings.clearing_workflow`, which gets a route for the first time.
4. **Fix:** bump mode gets `GET /management-api/bump-mode`, and the Kitchen panel shows the stored value instead of always starting on "Per item".
5. ~~Fix the receipt-language save~~ — **struck by the driver** (see A): one receipt language per location is the owner's landed decision C113, so the save is right as it is.
6. The Departments and zones screen keeps its **Status** (readiness) tab until step 2.
7. Old addresses get no redirects. `/manage/kitchen`, `/manage/statuses`, `/manage/receipts` and `/manage/adjustment-reasons` fall back to Overview, as any unknown screen does; `/manage/venue-operations/view/kitchen` falls back to that screen's first tab.
8. No server permission changes and no schema changes.

### Decisions this plan adds (not in the driver's brief)

- **A. Decision 5 conflicts with a landed owner decision.** Commit `0068ef4ce` (#1014, C113, "owner-approved", 2026-10-02) says: *"Each location now prints its receipt in one language… every new save stores exactly one entry"*, and pins that with the test `writes one language over a two-language row` in `apps/server/src/location-settings-api.test.ts`. `docs/backlog.md` (C113 entry) repeats: *"A receipt prints in ONE language, never two"*. So the one-entry write is deliberate, not a silent bug. The driver confirmed this and deleted the task that would have changed it.
- **B. Panels drop their `h1` and keep every other heading level.** The tab already names its panel (`wt-tabs` gives each `role="tabpanel"` an `aria-labelledby` pointing at its tab), so a panel needs no title heading. Receipts keeps its `h2`s and `h3`; Kitchen keeps its "Courses" `h2`; the adjustments panel keeps its "Limit on a bill's discounts" `h2`; the venue-service kitchen panel keeps its "Changes after sending" `h2`.
- **C. The venue-service screen's own heading follows its new sidebar name.** Its `h1` and tab-strip label (`venue.title`) become "Departments and zones" / "Departamentos y zonas", and its nav key is renamed from `nav.venue_operations` to `nav.departments_zones`, so the group header "Venue operations" and a page of the same name do not sit one above the other. The screen id and address (`venue-operations`, `/manage/venue-operations`) stay.
- **D. Adjustments keeps the contract's `screen` field required.** Its first screen becomes the adjustment report (today its `moreScreens[0]`), so `screen` does not need to become optional.
- **E. Core items can sit among module items.** Venue operations interleaves module and core pages, which `items`/`itemsAfterModules` cannot express. A group gains `itemsAmongModules`: core items with an `order`, sorted together with the group's module pages by `order` (ties keep the core item first). Departments and zones takes order 10, Floor plan 20, Prep stations 30, leaving room for Hours at 15 later.
- **F. Module panels carry an `order`; core panels count as 0** and come first on a tie. On the Kitchen tab the core panel (courses, bump mode, fire control) comes first and venue-service's panel (order 10) after it.
- **G. The venue-service panels read the existing `GET /management-api/venue-service`** through a new `loadSettings()` that keeps only the settings fields, with a new live-query group `settings: ["service_settings"]`. No new GET route.
- **H. Spanish wording:** group "Operaciones del local"; page "Ajustes del local"; tabs "Recibos", "Estados de mesa", "Motivos de ajuste", "Cocina", "Mesas". The Floor tab in Spanish is «Mesas», because «Sala» is already the Floor plan page (`nav.floor`, `apps/dashboard/src/i18n/strings.ts` ~2644), and both sit under Venue operations — owner to confirm. The floor switch reuses the till's own words for Finish table ("Cerrar mesa") and Needs clearing ("Por recoger"), read from `apps/till/src/i18n/strings.ts`.
- **I. "The page shows in the sidebar only when a tab does" is not built in this step.** No real session can reach the hidden case today: Table statuses and Kitchen carry no access rule (as today), so every non-staff session sees at least those two tabs, and staff never see this sidebar. A check written now would have a false branch no test can reach, which counts against the package's 98% coverage bar. The rule is added when the first panel gains an access rule. The page itself still renders only the tabs that have a visible panel (Task 3).
- **J. Two §5 Receipts details wait for step 2.** Spec §5's header line "described as printed under the legal name" and "the Receipts tab says where the trading name is edited" both depend on the trading name, which step 2 adds; this step leaves the Receipts panel's wording as it is.
- **K. The panels keep their own Add buttons.** Design-system.md → "Tabbed management pages" asks for a page's Add button in the tab strip's `actions` slot. Here each panel is a self-contained screen and several tabs hold more than one panel, so each panel keeps its Add button inside itself (the Table statuses panel's and the adjustment reasons panel's Add buttons stay where they are). The owner may strike this.

## Global Constraints

- No behaviour changes beyond decisions 3 (the new clearing switch and its route) and 4 (spec §11 step 1: "No behaviour changes").
- No schema change, no migration file touched, no server permission changed.
- `apps/dashboard` reaches module code only through `@waitron/dashboard-modules` (`scripts/module-seams.test.ts`).
- A module's `src/dashboard` files never import server code (`scripts/dashboard-browser-purity.test.ts` covers `packages/adjustments/src/dashboard`; keep venue-service's to the same rule: import only `./client.js`, `./strings.js`, `./live-queries.js`, `@waitron/dashboard-kit`, `@waitron/ui` and `lit`).
- Every live query a dashboard file declares names a declared server resource (`scripts/live-subscriptions.test.ts`).
- One `h1` per page; panels render none.
- Every new string has English and Spanish (typecheck enforces this for `Record<StringKey, string>` and venue-service's `Record<keyof typeof en, string>`). Delete keys this step leaves unused — grep the whole tree for each before deleting.
- Forms follow `docs/developers/design-system.md` → Forms; a screen draws no native `<select>`, `<textarea>` or text `<input>` (`scripts/native-form-fields.test.ts`); colours, spacing and fonts read `--wt-*` tokens.
- Tabs follow design-system.md → "Tabbed management pages" and "Navigation and language controls": the selected tab lives in the URL; replace history for defaults and invalid destinations, push for a new selection.
- `git commit -s` on every commit. Do not push; `/finish-branch` does that later.
- Comments only for an invariant or a non-obvious why (CLAUDE.md §1, last rule). No history in comments.
- Run browser suites only after checking free memory (`memory_pressure | grep free`); see CLAUDE.md §2.

## Review Focus

1. **A tab in the address the session may not see** (for example a supervisor opening `/manage/venue-settings/view/receipts`, or `/view/floor` when venue-service is disabled): expect the first visible tab, the address corrected with a replace, and no extra Back stop. Owned by Task 3 (element) and Task 5 (through the shell).
2. **A module disabled for the venue** (`me.modules` lacks it): its panels and their tab are absent, nothing throws, and its tab key in the address falls back. Owned by Task 5.
3. **Two panels on one tab**: core first, then module panels by `order`; both mounted; a save in one does not disturb the other. Owned by Task 5 (order) and Task 6 (the Kitchen tab with both).
4. **The one-`h1` rule across nested shadow roots**: the page's `h1` is the only one, counting inside each panel's own shadow root. Owned by Task 4 (`allH1` helper in `dashboard-app.test.ts`) and the a11y suite.
5. **An empty group**: a session that can open no Service page (Bookings disabled, or no `booking.manage`) sees no "Service" header, and a search still reports "No pages match." correctly. Owned by Task 8.
6. **A session that can see no tab** (decision I): not reachable today, and the sidebar item is not hidden for it in this step; the element itself renders only its `h1` with no panels (Task 3 tests that). Reviewer: confirm decision I's claim that no real session reaches it against `CORE_SETTINGS_PANELS` before accepting it.

---

## File structure

| File | Change | Responsibility |
| --- | --- | --- |
| `apps/server/src/kitchen.ts` | modify | add `getBumpMode` |
| `apps/server/src/management-api.ts` | modify | add `GET /management-api/bump-mode` |
| `apps/server/src/management-api.test.ts` | modify | bump-mode GET cases |
| `apps/dashboard/src/api/client.ts`, `live-queries.ts` (+ tests) | modify | `getBumpMode` |
| `apps/dashboard/src/screens/kitchen-screen.ts` (+ tests) | modify | read bump mode; no `h1`, no prep link |
| `apps/dashboard/src/screens/receipts-screen.ts`, `service-status-screen.ts` (+ tests) | modify | no `h1` |
| `apps/dashboard/src/screens/venue-settings-screen.ts` (+ test) | **create** | the page: `h1`, tabs, URL |
| `apps/dashboard/src/dashboard-app.ts` | modify | core panels, module panel seat, nav regroup, empty groups |
| `apps/dashboard/src/dashboard-app.settings-panels.test.ts` | **create** | module panels through the shell |
| `apps/dashboard/src/dashboard-app.test.ts`, `.a11y.test.ts`, `.module-order.test.ts` | modify | nav and route expectations |
| `apps/dashboard/src/i18n/strings.ts` | modify | new and removed keys |
| `packages/dashboard-kit/src/contract.ts` | modify | `DashboardSettingsPanel`, `settingsPanels` |
| `packages/venue-service/src/routes.ts` (+ test) | modify | clearing-workflow route, GET field |
| `packages/venue-service/src/dashboard/client.ts`, `live-queries.ts` (+ test) | modify | `loadSettings`, `saveClearingWorkflow` |
| `packages/venue-service/src/dashboard/service-settings-panel.ts` (+ tests) | **create** | kitchen and floor panels |
| `packages/venue-service/src/dashboard/venue-operations-screen.ts` (+ tests) | modify | Kitchen tab removed |
| `packages/venue-service/src/dashboard/index.ts`, `strings.ts` (+ test) | modify | panels, placements, labels |
| `packages/adjustments/src/dashboard/index.ts`, `reasons-screen.ts`, `strings.ts` (+ tests) | modify | reasons as a panel |
| `packages/dashboard-modules/src/registry.test.ts` | modify | adjustments' new shape |
| `docs/developers/design-system.md`, `conventions-ui.md`, `testing-guide.md`, `docs/content-and-images.md`, `docs/backlog.md` | modify | retire stale claims |

---

### Task 1: The bump mode can be read back, and the Kitchen screen shows it

**Files:**
- Modify: `apps/server/src/kitchen.ts:214-220`
- Modify: `apps/server/src/management-api.ts` (imports ~92-103; routes ~1861-1874)
- Test: `apps/server/src/management-api.test.ts` (describe `/management-api/stations (KDS-1 config)`, from ~1201; its bump-mode, staff and no-session cases at ~1566-1648)
- Modify: `apps/dashboard/src/api/client.ts:2289`, `apps/dashboard/src/api/live-queries.ts:245`
- Test: `apps/dashboard/src/api/client-routes.test.ts`, `apps/dashboard/src/api/live-queries.test.ts`
- Modify: `apps/dashboard/src/screens/kitchen-screen.ts:56-87`
- Test: `apps/dashboard/src/screens/kitchen-screen.test.ts`, `apps/dashboard/src/screens/kitchen-screen.a11y.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getBumpMode(tx: Transaction, cfg: TillConfig): Promise<BumpMode>` (server); `GET /management-api/bump-mode → 200 { mode: "line" | "ticket" }`, gated by `venue.configure` like the PUT; `DashboardApi.getBumpMode(): Promise<{ mode: BumpMode }>`; query name `getBumpMode` depending on `["locations"]`.

- [ ] **Step 1: Write the failing server test**

In `apps/server/src/management-api.test.ts`, inside `describe("/management-api/stations (KDS-1 config)")`, after the `PUT /bump-mode` case:

```ts
  it("GET /bump-mode reads the stored mode: 'line' until a manager changes it", async () => {
    const initial = await req("/bump-mode", { method: "GET" }, managerCookie);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({ mode: "line" });
    await req(
      "/bump-mode",
      { method: "PUT", body: JSON.stringify({ mode: "ticket" }) },
      managerCookie,
    );
    try {
      const after = await req("/bump-mode", { method: "GET" }, managerCookie);
      expect(await after.json()).toEqual({ mode: "ticket" });
    } finally {
      await req(
        "/bump-mode",
        { method: "PUT", body: JSON.stringify({ mode: "line" }) },
        managerCookie,
      );
    }
  });
```

and add `req("/bump-mode", { method: "GET" }, staffCookie),` to the `cases` array of `a STAFF session is refused on every station/routing route`, and `req("/bump-mode", { method: "GET" }, undefined),` to the `cases` of `no session → 401 management_session.required on every station/routing route`.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @waitron/server exec vitest run src/management-api.test.ts -t "KDS-1 config"`
This runs the whole `/management-api/stations (KDS-1 config)` describe: a `-t "bump"` filter would miss the staff and no-session cases, whose names do not contain "bump".
Expected: the new case FAILS with status 404 (no GET route), and the staff and no-session cases fail the same way.

- [ ] **Step 3: Add the reader and the route**

In `apps/server/src/kitchen.ts`, after `setBumpMode`:

```ts
export async function getBumpMode(tx: Transaction, cfg: TillConfig): Promise<BumpMode> {
  const { rows } = await tx.execute<{ bump_mode: BumpMode }>(
    sql`select bump_mode from locations where id = ${cfg.locationId}`,
  );
  return rows[0]!.bump_mode;
}
```

In `apps/server/src/management-api.ts`, add `getBumpMode,` to the import list from `./kitchen.js` (beside `getFireControl`), and before `app.put("/management-api/bump-mode", …)`:

```ts
  app.get("/management-api/bump-mode", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const mode = await withVenueAuth(deps, sessionId, (tx) => getBumpMode(tx, cfg));
      return c.json({ mode });
    }),
  );
```

- [ ] **Step 4: Run the server tests and see them pass**

Run: `pnpm --filter @waitron/server exec vitest run src/management-api.test.ts -t "KDS-1 config"`
Expected: PASS (the whole describe, so the staff and no-session cases run too).

- [ ] **Step 5: Write the failing dashboard tests**

In `apps/dashboard/src/api/client-routes.test.ts`, inside `describe("DashboardApi routes")`:

```ts
  it("reads the bump mode from its own route", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ mode: "ticket" }));
    const api = new DashboardApi("", fetchImpl);
    expect(await api.getBumpMode()).toEqual({ mode: "ticket" });
    expect(callsOf(fetchImpl)).toEqual([["/management-api/bump-mode", "GET", undefined]]);
  });
```

In `apps/dashboard/src/api/live-queries.test.ts`, add `["getBumpMode", [], "locations"],` to the first `it.each` table (the one ending with `["getReceiptLanguage", [], "locations"]`).

In `apps/dashboard/src/screens/kitchen-screen.test.ts`, add `getBumpMode: vi.fn().mockResolvedValue({ mode: "line" }),` to `stubApi`'s object (beside `setBumpMode`), and add:

```ts
  it("seeds the bump-mode toggle from the stored setting (getBumpMode)", async () => {
    const api = stubApi({ getBumpMode: vi.fn().mockResolvedValue({ mode: "ticket" }) });
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    expect(api.getBumpMode).toHaveBeenCalledTimes(1);
    expect(q(el, "[data-test=bump-ticket]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "[data-test=bump-line]")!.getAttribute("variant")).toBe("secondary");
  });

  it("still reads fire control when the bump mode cannot be read, and says the read failed", async () => {
    const api = stubApi(
      { getBumpMode: vi.fn().mockRejectedValue({ code: "server.internal" }) },
      STATIONS,
      COURSES,
      "expo",
    );
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    expect(q(el, "[data-test=fire-expo]")!.getAttribute("variant")).toBe("primary");
    expect(q(el, "[role=alert]")!.textContent).toContain(codeMessage("server.internal"));
  });
```

In `apps/dashboard/src/screens/kitchen-screen.a11y.test.ts`, add `getBumpMode: vi.fn().mockResolvedValue({ mode: "line" }),` to its `stubApi`.

- [ ] **Step 6: Run them and watch them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/api/client-routes.test.ts src/api/live-queries.test.ts src/screens/kitchen-screen.test.ts`
Expected: FAIL — `api.getBumpMode is not a function` / type error on `"getBumpMode"` not being a query name; the seeding case finds `bump-line` primary.

- [ ] **Step 7: Add the client method, the query, and read it on the screen**

`apps/dashboard/src/api/client.ts`, beside `setBumpMode`:

```ts
  getBumpMode(): Promise<{ mode: BumpMode }> {
    return this.#request<{ mode: BumpMode }>("/management-api/bump-mode", "GET");
  }
```

`apps/dashboard/src/api/live-queries.ts`, beside `getFireControl: ["locations"],`:

```ts
  getBumpMode: ["locations"],
```

`apps/dashboard/src/screens/kitchen-screen.ts`: delete the comment line `// There is no route to read the bump mode back, so the control starts on the column default.` and replace `#load` with:

```ts
  async #load(): Promise<void> {
    this.#showError(null);
    await Promise.all([
      this.#queries
        .watch("getBumpMode", [], (bump) => {
          this.bumpMode = bump.mode;
        })
        .catch((error: unknown) => this.#showReadError(error)),
      this.#queries
        .watch("getFireControl", [], (fire) => {
          this.fireControl = fire.mode;
        })
        .catch((error: unknown) => this.#showReadError(error)),
    ]);
  }
```

(These two are separate HTTP reads, not statements on one transaction, so CLAUDE.md's "never `Promise.all`" rule for one `tx` does not apply.)

- [ ] **Step 8: Run them and see them pass**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/api/client-routes.test.ts src/api/live-queries.test.ts src/screens/kitchen-screen.test.ts src/screens/kitchen-screen.a11y.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/kitchen.ts apps/server/src/management-api.ts apps/server/src/management-api.test.ts apps/dashboard/src/api/client.ts apps/dashboard/src/api/live-queries.ts apps/dashboard/src/api/client-routes.test.ts apps/dashboard/src/api/live-queries.test.ts apps/dashboard/src/screens/kitchen-screen.ts apps/dashboard/src/screens/kitchen-screen.test.ts apps/dashboard/src/screens/kitchen-screen.a11y.test.ts
git commit -s -m "Kitchen settings show the stored bump mode, read from a new GET /management-api/bump-mode"
```

---

### Task 2: A route and a client for "tables need clearing after Finish table"

**Files:**
- Modify: `packages/venue-service/src/routes.ts` (imports ~31-40; GET ~401-417; new PUT after ~446)
- Test: `packages/venue-service/src/routes.test.ts` (new describe after `the print-held-work setting`, ~1194)
- Modify: `packages/venue-service/src/dashboard/client.ts`, `packages/venue-service/src/dashboard/live-queries.ts`
- Test: `packages/venue-service/src/dashboard/client.test.ts`
- Modify (type fixtures only): `packages/venue-service/src/dashboard/venue-operations-screen.test.ts:72-75`, `venue-navigation.test.ts:21-24`, `venue-operations-screen.a11y.test.ts` (each `VenueServiceView` literal), `index.test.ts` (the `empty` literal)

**Interfaces:**
- Consumes: `readClearingWorkflow(tx)`, `writeClearingWorkflow(tx, value)` from `packages/venue-service/src/kitchen-notices.ts`.
- Produces:
  - `GET /management-api/venue-service` gains top-level `clearingWorkflow: boolean`.
  - `PUT /management-api/venue-service/settings/clearing-workflow` with body `{ clearingWorkflow: boolean }` → 204; anything else → 400 `management.request_invalid` `{ field: "clearingWorkflow" }`; permission `venue_service.manage`.
  - In `client.ts`: `VenueServiceModel.clearingWorkflow: boolean`; `export type VenueServiceSettingsView = Pick<VenueServiceModel, "settings" | "kitchenTicketGrouping" | "printHeldWork" | "releaseReminderMinutes" | "clearingWorkflow">`; `VenueServiceApi.loadSettings(): Promise<VenueServiceSettingsView>`; `VenueServiceApi.saveClearingWorkflow(clearingWorkflow: boolean): Promise<void>`.
  - `QUERY_DEPENDENCIES.settings = ["service_settings"]` in `live-queries.ts`.

- [ ] **Step 1: Write the failing route tests**

In `packages/venue-service/src/routes.test.ts`, after `describe("the print-held-work setting", …)`:

```ts
describe("the clearing setting", () => {
  const CLEARING = "/management-api/venue-service/settings/clearing-workflow";
  async function stored(fx: Fixture): Promise<unknown> {
    return (
      (await (
        await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
      ).json()) as { clearingWorkflow: unknown }
    ).clearingWorkflow;
  }

  it("reads off until a manager turns it on, and back", async () => {
    const fx = await fixture();
    expect(await stored(fx)).toBe(false);
    expect(
      (await send(fx.app, "PUT", CLEARING, fx.managerCookie, { clearingWorkflow: true })).status,
    ).toBe(204);
    expect(await stored(fx)).toBe(true);
    expect(
      (await send(fx.app, "PUT", CLEARING, fx.managerCookie, { clearingWorkflow: false })).status,
    ).toBe(204);
    expect(await stored(fx)).toBe(false);
  });

  it("refuses anything but true or false, naming the field, and keeps the stored value", async () => {
    const fx = await fixture();
    expect(
      (await send(fx.app, "PUT", CLEARING, fx.managerCookie, { clearingWorkflow: true })).status,
    ).toBe(204);
    for (const body of [
      {},
      { clearingWorkflow: "false" },
      { clearingWorkflow: 0 },
      { clearingWorkflow: null },
      { clearingWorkflow: [false] },
    ]) {
      const rejected = await send(fx.app, "PUT", CLEARING, fx.managerCookie, body);
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toEqual({
        error: { code: "management.request_invalid", params: { field: "clearingWorkflow" } },
      });
    }
    expect(await stored(fx)).toBe(true);
  });

  it("lets only a signed-in manager change it", async () => {
    const fx = await fixture();
    const body = { clearingWorkflow: true };
    expect((await send(fx.app, "PUT", CLEARING, undefined, body)).status).toBe(401);
    const refused = await send(fx.app, "PUT", CLEARING, fx.staffCookie, body);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect(await stored(fx)).toBe(false);
  });

  it("leaves the other settings as they were", async () => {
    const fx = await fixture();
    expect(
      (await send(fx.app, "PUT", CLEARING, fx.managerCookie, { clearingWorkflow: true })).status,
    ).toBe(204);
    const body = (await (
      await send(fx.app, "GET", "/management-api/venue-service", fx.managerCookie)
    ).json()) as {
      settings: unknown;
      kitchenTicketGrouping: unknown;
      printHeldWork: unknown;
      releaseReminderMinutes: unknown;
    };
    expect(body.settings).toEqual({ editSentLines: true });
    expect(body.kitchenTicketGrouping).toBe("combined");
    expect(body.printHeldWork).toBe(false);
    expect(body.releaseReminderMinutes).toBe(10);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @waitron/venue-service exec vitest run src/routes.test.ts -t "clearing setting"`
Expected: FAIL — `stored(fx)` is `undefined` (the GET has no field) and the PUT answers 404.

- [ ] **Step 3: Add the field and the route**

In `packages/venue-service/src/routes.ts`, add `readClearingWorkflow,` and `writeClearingWorkflow,` to the import from `./kitchen-notices.js` (keep alphabetical order). In the `GET /management-api/venue-service` handler add `clearingWorkflow: await readClearingWorkflow(tx),` after `releaseReminderMinutes`. After the `print-held-work` route:

```ts
    app.put("/management-api/venue-service/settings/clearing-workflow", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const body = await readJsonBody<Record<string, unknown>>(c);
        const clearingWorkflow = body.clearingWorkflow;
        if (typeof clearingWorkflow !== "boolean") {
          throw new AppError("management.request_invalid", { field: "clearingWorkflow" });
        }
        await gated(sessionId, (tx) => writeClearingWorkflow(tx, clearingWorkflow));
        return c.body(null, 204);
      }),
    );
```

- [ ] **Step 4: Run the route suite**

Run: `pnpm --filter @waitron/venue-service exec vitest run src/routes.test.ts`
Expected: PASS (the whole file: the other settings' "leaves the other settings" cases read `settings` with `toEqual` and are not affected by the new top-level field).

- [ ] **Step 5: Write the failing client tests**

In `packages/venue-service/src/dashboard/client.test.ts`, inside `describe("VenueServiceApi")` (the file builds the client with `createRequest({ fetchImpl })` and a local `jsonResponse(body, status)` helper), add:

```ts
  it("stores whether tables need clearing after Finish table", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    await api.saveClearingWorkflow(true);
    expect(
      fetchImpl.mock.calls.map(([path, init]) => [
        path,
        init.method,
        JSON.parse(init.body as string),
      ]),
    ).toEqual([
      ["/management-api/venue-service/settings/clearing-workflow", "PUT", { clearingWorkflow: true }],
    ]);
  });

  it("loads only the settings from the venue-service read", async () => {
    const model = {
      departments: [{ id: "d1" }],
      zones: [],
      deviceZones: [],
      hours: [],
      zoneMenus: [],
      readiness: [],
      settings: { editSentLines: false },
      kitchenTicketGrouping: "separate",
      printHeldWork: true,
      releaseReminderMinutes: null,
      clearingWorkflow: true,
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(model));
    const api = new VenueServiceApi(createRequest({ fetchImpl: fetchImpl as typeof fetch }));
    expect(await api.loadSettings()).toEqual({
      settings: { editSentLines: false },
      kitchenTicketGrouping: "separate",
      printHeldWork: true,
      releaseReminderMinutes: null,
      clearingWorkflow: true,
    });
    expect(fetchImpl.mock.calls.map(([path, init]) => [path, init.method])).toEqual([
      ["/management-api/venue-service", "GET"],
    ]);
  });
```

- [ ] **Step 6: Run and watch them fail**

Run: `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/client.test.ts`
Expected: FAIL — `saveClearingWorkflow` and `loadSettings` are not functions.

- [ ] **Step 7: Add the types and methods**

In `packages/venue-service/src/dashboard/client.ts`: add `clearingWorkflow: boolean;` to `VenueServiceModel` after `releaseReminderMinutes`; after `VenueServiceSettings` add:

```ts
/** What the settings panels read: the venue-service model's settings fields alone. */
export type VenueServiceSettingsView = Pick<
  VenueServiceModel,
  "settings" | "kitchenTicketGrouping" | "printHeldWork" | "releaseReminderMinutes" | "clearingWorkflow"
>;
```

and in `VenueServiceApi`:

```ts
  async loadSettings(): Promise<VenueServiceSettingsView> {
    const model = await this.#read<VenueServiceModel>("/management-api/venue-service");
    return {
      settings: model.settings,
      kitchenTicketGrouping: model.kitchenTicketGrouping,
      printHeldWork: model.printHeldWork,
      releaseReminderMinutes: model.releaseReminderMinutes,
      clearingWorkflow: model.clearingWorkflow,
    };
  }

  saveClearingWorkflow(clearingWorkflow: boolean): Promise<void> {
    return this.request("/management-api/venue-service/settings/clearing-workflow", "PUT", {
      clearingWorkflow,
    });
  }
```

In `packages/venue-service/src/dashboard/live-queries.ts` add a third group:

```ts
  settings: ["service_settings"],
```

Then add `clearingWorkflow: false,` to every `VenueServiceView`/model literal the typecheck now flags (`venue-operations-screen.test.ts` `model`, `venue-navigation.test.ts` `model`, the literals in `venue-operations-screen.a11y.test.ts`, and `index.test.ts`'s `empty`). Find them with `pnpm --filter @waitron/venue-service typecheck`.

- [ ] **Step 8: Run the client suite, the typecheck and the live-subscription guard**

Run: `pnpm --filter @waitron/venue-service typecheck && pnpm --filter @waitron/venue-service exec vitest run src/dashboard/client.test.ts && pnpm exec vitest run scripts/live-subscriptions.test.ts`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/venue-service/src
git commit -s -m "Venue service: a route and client for whether tables need clearing after Finish table"
```

---

### Task 3: The Venue settings page element

**Files:**
- Create: `apps/dashboard/src/screens/venue-settings-screen.ts`
- Create: `apps/dashboard/src/screens/venue-settings-screen.test.ts`
- Create: `apps/dashboard/src/screens/venue-settings-screen.a11y.test.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts` (English block near `nav.group.*` ~529; Spanish block ~2626)

**Interfaces:**
- Consumes: `dashboardPath` (`apps/dashboard/src/navigation.ts`; its `"*"` entry already maps the `view` field to the `view` path segment), `UrlStateController` (`@waitron/ui`), `wt-tabs`.
- Produces (exported from `venue-settings-screen.ts`):
  - `export const VENUE_SETTINGS_TABS = ["receipts", "table-statuses", "adjustment-reasons", "kitchen", "floor"] as const;`
  - `export type VenueSettingsTab = (typeof VENUE_SETTINGS_TABS)[number];`
  - `export function isVenueSettingsTab(value: string | null): value is VenueSettingsTab;`
  - `export interface VenueSettingsPanel { key: string; tab: VenueSettingsTab; render(): TemplateResult; }` — panels arrive already filtered for the session and ordered.
  - element `dashboard-venue-settings-screen`, class `VenueSettingsScreen`, property `panels: readonly VenueSettingsPanel[]`.
  - string keys `venue_settings.title`, `venue_settings.tab.receipts`, `venue_settings.tab.table_statuses`, `venue_settings.tab.adjustment_reasons`, `venue_settings.tab.kitchen`, `venue_settings.tab.floor`.

- [ ] **Step 1: Write the failing tests**

`apps/dashboard/src/screens/venue-settings-screen.test.ts`:

```ts
import { html } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WtTabs } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import "./venue-settings-screen.js";
import type { VenueSettingsPanel, VenueSettingsScreen } from "./venue-settings-screen.js";

const initialUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  vi.restoreAllMocks();
  history.replaceState(null, "", initialUrl);
  setLocale("es-ES");
});

function panel(key: string, tab: VenueSettingsPanel["tab"]): VenueSettingsPanel {
  return { key, tab, render: () => html`<p data-test=${`panel-${key}`}>${key}</p>` };
}

function navigate(path: string): void {
  const url = new URL(location.href);
  url.pathname = path;
  url.searchParams.set("source", "saved link");
  history.replaceState(null, "", url);
}

async function mount(panels: VenueSettingsPanel[]): Promise<VenueSettingsScreen> {
  const { el } = await mountWidget<VenueSettingsScreen>("dashboard-venue-settings-screen", {
    panels,
  });
  await el.updateComplete;
  const strip = tabs(el);
  if (strip) await strip.updateComplete;
  return el;
}

const tabs = (el: VenueSettingsScreen) => el.shadowRoot!.querySelector<WtTabs>("wt-tabs");
const tabKeys = (el: VenueSettingsScreen) =>
  [...tabs(el)!.shadowRoot!.querySelectorAll('[role="tab"]')].map((tab) =>
    tab.getAttribute("data-key"),
  );
const selected = (el: VenueSettingsScreen) =>
  tabs(el)!.shadowRoot!.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("data-key");

async function select(el: VenueSettingsScreen, key: string): Promise<void> {
  tabs(el)!.shadowRoot!.querySelector<HTMLButtonElement>(`[role="tab"][data-key="${key}"]`)!.click();
  await el.updateComplete;
  await tabs(el)!.updateComplete;
}

describe("the Venue settings page", () => {
  it("owns the one h1 and shows only the tabs that have a panel, in core's order", async () => {
    setLocale("en-GB");
    navigate("/manage/venue-settings/view/kitchen");
    const el = await mount([panel("k", "kitchen"), panel("r", "receipts")]);
    const h1s = el.shadowRoot!.querySelectorAll("h1");
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent!.trim()).toBe("Venue settings");
    expect(tabKeys(el)).toEqual(["receipts", "kitchen"]);
    expect(tabs(el)!.label).toBe("Venue settings");
  });

  it("restores the tab its address names without writing history", async () => {
    navigate("/manage/venue-settings/view/kitchen");
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    const el = await mount([panel("r", "receipts"), panel("k", "kitchen")]);
    expect(selected(el)).toBe("kitchen");
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    "/manage/venue-settings",
    "/manage/venue-settings/view/nowhere",
    // A real tab this session has no panel on.
    "/manage/venue-settings/view/floor",
  ])("replaces %s with the first visible tab, keeping the query", async (path) => {
    navigate(path);
    const query = location.search;
    const push = vi.spyOn(history, "pushState");
    const replace = vi.spyOn(history, "replaceState");
    const el = await mount([panel("s", "table-statuses"), panel("k", "kitchen")]);
    expect(selected(el)).toBe("table-statuses");
    expect(location.pathname).toBe("/manage/venue-settings/view/table-statuses");
    expect(location.search).toBe(query);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("pushes one history entry per new tab and follows Back", async () => {
    navigate("/manage/venue-settings/view/receipts");
    const el = await mount([panel("r", "receipts"), panel("k", "kitchen")]);
    const push = vi.spyOn(history, "pushState");
    await select(el, "kitchen");
    expect(location.pathname).toBe("/manage/venue-settings/view/kitchen");
    await select(el, "kitchen");
    expect(push).toHaveBeenCalledTimes(1);
    const back = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    history.back();
    await back;
    await el.updateComplete;
    await tabs(el)!.updateComplete;
    expect(selected(el)).toBe("receipts");
  });

  it("shows a tab's panels in the order given, and keeps every tab's panels mounted", async () => {
    navigate("/manage/venue-settings/view/receipts");
    const el = await mount([
      panel("r", "receipts"),
      panel("first", "kitchen"),
      panel("second", "kitchen"),
    ]);
    const kitchen = el.shadowRoot!.querySelector('[slot="kitchen"]')!;
    expect(
      [...kitchen.querySelectorAll<HTMLElement>("[data-test]")].map((p) => p.dataset.test),
    ).toEqual(["panel-first", "panel-second"]);
    expect(el.shadowRoot!.querySelector("[data-test=panel-r]")).not.toBeNull();
    expect(kitchen.querySelector("[data-test=panel-first]")!.checkVisibility()).toBe(false);
  });

  it("draws only its heading when no panel is visible", async () => {
    navigate("/manage/venue-settings");
    const el = await mount([]);
    expect(el.shadowRoot!.querySelectorAll("h1")).toHaveLength(1);
    expect(tabs(el)).toBeNull();
  });

  it("ignores a tab change sent from a strip inside a panel", async () => {
    navigate("/manage/venue-settings/view/receipts");
    const el = await mount([panel("r", "receipts"), panel("k", "kitchen")]);
    const inner = el.shadowRoot!.querySelector("[data-test=panel-r]")!;
    inner.dispatchEvent(
      new CustomEvent("wt-tab-change", { detail: { value: "kitchen" }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(location.pathname).toBe("/manage/venue-settings/view/receipts");
  });

  it("names its tabs in Spanish", async () => {
    setLocale("es-ES");
    navigate("/manage/venue-settings");
    const el = await mount([
      panel("r", "receipts"),
      panel("s", "table-statuses"),
      panel("a", "adjustment-reasons"),
      panel("k", "kitchen"),
      panel("f", "floor"),
    ]);
    expect(el.shadowRoot!.querySelector("h1")!.textContent!.trim()).toBe("Ajustes del local");
    expect(
      [...tabs(el)!.shadowRoot!.querySelectorAll('[role="tab"]')].map((t) => t.textContent!.trim()),
    ).toEqual(["Recibos", "Estados de mesa", "Motivos de ajuste", "Cocina", "Mesas"]);
  });
});
```

Note on the "ignores a tab change sent from inside a panel" case: the panel content is in the screen's light-DOM slot of `wt-tabs`, so dispatching from it reaches the `wt-tabs` listener with `event.target` being the `<p>`, not the strip — which is what the guard must ignore.

`apps/dashboard/src/screens/venue-settings-screen.a11y.test.ts`:

```ts
import { html } from "lit";
import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./venue-settings-screen.js";
import type { VenueSettingsScreen } from "./venue-settings-screen.js";

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("venue settings a11y (%s theme)", (theme) => {
  it("renders accessibly with two tabs", async () => {
    const { el, host } = await mountWidget<VenueSettingsScreen>(
      "dashboard-venue-settings-screen",
      {
        panels: [
          { key: "r", tab: "receipts", render: () => html`<h2>Receipt text</h2><p>Body</p>` },
          { key: "k", tab: "kitchen", render: () => html`<h2>Courses</h2>` },
        ],
      },
      theme,
    );
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/venue-settings-screen.test.ts src/screens/venue-settings-screen.a11y.test.ts`
Expected: FAIL — the module `./venue-settings-screen.js` does not exist.

- [ ] **Step 3: Add the strings**

In `apps/dashboard/src/i18n/strings.ts`, English block (beside `nav.group.*`):

```ts
  "venue_settings.title": "Venue settings",
  "venue_settings.tab.receipts": "Receipts",
  "venue_settings.tab.table_statuses": "Table statuses",
  "venue_settings.tab.adjustment_reasons": "Adjustment reasons",
  "venue_settings.tab.kitchen": "Kitchen",
  "venue_settings.tab.floor": "Floor",
```

Spanish block (same position):

```ts
  "venue_settings.title": "Ajustes del local",
  "venue_settings.tab.receipts": "Recibos",
  "venue_settings.tab.table_statuses": "Estados de mesa",
  "venue_settings.tab.adjustment_reasons": "Motivos de ajuste",
  "venue_settings.tab.kitchen": "Cocina",
  "venue_settings.tab.floor": "Mesas",
```

- [ ] **Step 4: Write the element**

`apps/dashboard/src/screens/venue-settings-screen.ts`:

```ts
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, UrlStateController } from "@waitron/ui";
import "@waitron/ui/src/components/wt-tabs.js";
import { dashboardPath } from "../navigation.js";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

/** The page's tabs in the order they show; a module's panel names one of these keys. */
export const VENUE_SETTINGS_TABS = [
  "receipts",
  "table-statuses",
  "adjustment-reasons",
  "kitchen",
  "floor",
] as const;
export type VenueSettingsTab = (typeof VENUE_SETTINGS_TABS)[number];

const TAB_LABELS: Record<VenueSettingsTab, StringKey> = {
  receipts: "venue_settings.tab.receipts",
  "table-statuses": "venue_settings.tab.table_statuses",
  "adjustment-reasons": "venue_settings.tab.adjustment_reasons",
  kitchen: "venue_settings.tab.kitchen",
  floor: "venue_settings.tab.floor",
};

export function isVenueSettingsTab(value: string | null): value is VenueSettingsTab {
  return (VENUE_SETTINGS_TABS as readonly string[]).includes(value ?? "");
}

/** A panel this session may see. The page owns the h1, so a panel renders none. */
export interface VenueSettingsPanel {
  key: string;
  tab: VenueSettingsTab;
  render(): TemplateResult;
}

@customElement("dashboard-venue-settings-screen")
export class VenueSettingsScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      h1 {
        margin-top: 0;
      }
    `,
  ];

  /** Already filtered to this session and ordered within each tab. */
  @property({ attribute: false }) panels: readonly VenueSettingsPanel[] = [];
  @state() private tab?: VenueSettingsTab;

  readonly #url = new UrlStateController(this, () => this.#restore(), dashboardPath);

  #tabs(): VenueSettingsTab[] {
    return VENUE_SETTINGS_TABS.filter((tab) => this.panels.some((panel) => panel.tab === tab));
  }

  #restore(): void {
    if (this.#url.read("dashboard") !== "venue-settings") return;
    const requested = this.#url.read("view");
    const tabs = this.#tabs();
    const tab = tabs.find((each) => each === requested) ?? tabs[0];
    this.tab = tab;
    if (tab !== undefined && tab !== requested)
      this.#url.write({ dashboard: "venue-settings", view: tab }, true);
  }

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("panels") && (this.tab === undefined || !this.#tabs().includes(this.tab)))
      this.#restore();
  }

  #select(event: CustomEvent<{ value: string }>): void {
    // A strip inside a panel sends the same composed event.
    if (event.target !== event.currentTarget) return;
    if (!isVenueSettingsTab(event.detail.value)) return;
    this.tab = event.detail.value;
    this.#url.write({ dashboard: "venue-settings", view: this.tab });
  }

  override render(): TemplateResult {
    const tabs = this.#tabs();
    return html`<h1>${t("venue_settings.title")}</h1>
      ${
        tabs.length === 0
          ? nothing
          : html`<wt-tabs
              label=${t("venue_settings.title")}
              .value=${this.tab ?? tabs[0]!}
              .items=${tabs.map((tab) => ({ key: tab, label: t(TAB_LABELS[tab]) }))}
              @wt-tab-change=${(event: CustomEvent<{ value: string }>) => this.#select(event)}
            >
              ${repeat(
                tabs,
                (tab) => tab,
                (tab) =>
                  html`<div slot=${tab} data-test=${`venue-settings-${tab}`}>
                    ${repeat(
                      this.panels.filter((panel) => panel.tab === tab),
                      (panel) => panel.key,
                      (panel) => panel.render(),
                    )}
                  </div>`,
              )}
            </wt-tabs>`
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-venue-settings-screen": VenueSettingsScreen;
  }
}
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/venue-settings-screen.test.ts src/screens/venue-settings-screen.a11y.test.ts`
Expected: PASS. If the "keeps every tab's panels mounted" visibility assertion fails because `checkVisibility()` reads `true` through a hidden slot, assert instead that the kitchen `tabpanel` inside the strip's shadow root has `hidden` set — the claim under test is "mounted but hidden", and it must be checked against what the strip actually hides.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/screens/venue-settings-screen.ts apps/dashboard/src/screens/venue-settings-screen.test.ts apps/dashboard/src/screens/venue-settings-screen.a11y.test.ts apps/dashboard/src/i18n/strings.ts
git commit -s -m "Dashboard: a Venue settings page with one tab per subject, its tab kept in the address"
```

---

### Task 4: Receipts, Table statuses and Kitchen open as tabs of Venue settings

This task turns the three core screens into panels (no `h1`, no prep-stations link) and wires the page into the shell in the same commit — the two cannot land apart without breaking the shell's one-`h1` tests.

**Files:**
- Modify: `apps/dashboard/src/screens/receipts-screen.ts:785` (render), `service-status-screen.ts:30-34, 253` (style + render), `kitchen-screen.ts` (style `.title`, render)
- Test: `apps/dashboard/src/screens/receipts-screen.trim.test.ts:87-95`, `service-status-screen.test.ts:77`, `kitchen-screen.test.ts:66-75`
- Modify: `apps/dashboard/src/dashboard-app.ts` (imports 51-55; `CORE_SCREENS` 89-122; types 139-156; `NAV_GROUPS` 165-233; `#mayOpen` 1410; `#renderScreen` 1710-1719)
- Modify: `apps/dashboard/src/i18n/strings.ts` (add `nav.venue_settings`; delete keys listed in Step 7)
- Test: `apps/dashboard/src/dashboard-app.test.ts`, `dashboard-app.a11y.test.ts`, `dashboard-app.module-order.test.ts`

**Interfaces:**
- Consumes: `VenueSettingsPanel`, `VenueSettingsTab`, element `dashboard-venue-settings-screen` (Task 3).
- Produces, in `dashboard-app.ts`:
  - `type AccessRule = { requiresManager?: boolean; requiresPermission?: string };` and `type ScreenRule = AccessRule & { screen: ScreenId };` — `#mayOpen(rule: AccessRule)`.
  - `type CoreSettingsPanel = AccessRule & { key: string; tab: VenueSettingsTab; render(api: DashboardApi): TemplateResult };`
  - `const CORE_SETTINGS_PANELS: readonly CoreSettingsPanel[]` with keys `receipts`, `table-statuses`, `kitchen`.
  - `#settingsPanels(): (VenueSettingsPanel & { order: number })[]` (Task 5 adds the module part).
  - screen id `venue-settings` in `CORE_SCREENS`; nav item `{ screen: "venue-settings", labelKey: "nav.venue_settings" }` (no access rule — decision I), placed in the `configuration` group where `receipts` was (Task 8 moves it).

- [ ] **Step 1: Change the screens' own tests to expect no h1**

`receipts-screen.trim.test.ts`, replace the case `renders exactly one h1, the page title` with:

```ts
  it("renders no h1: the Venue settings page owns the page heading", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ReceiptsScreen>("dashboard-receipts-screen", { api });
    await flush(el);
    expect(qa(el, "h1")).toHaveLength(0);
    expect(qa(el, "h2").length).toBeGreaterThan(0);
  });
```

`service-status-screen.test.ts:77`: change `expect(el.shadowRoot!.querySelectorAll("h1").length).toBe(1);` to `expect(el.shadowRoot!.querySelectorAll("h1").length).toBe(0);`.

`kitchen-screen.test.ts`, replace `links to Prep stations without the former stations panel` with:

```ts
  it("draws no h1, no stations panel and no link to Prep stations", async () => {
    const api = stubApi();
    const { el } = await mountWidget<KitchenScreen>("dashboard-kitchen-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelectorAll("h1")).toHaveLength(0);
    expect(q(el, "[data-test=stations-panel]")).toBeNull();
    expect(q(el, 'a[href="/manage/prep-stations"]')).toBeNull();
    expect(api.listStations).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Change the shell's tests to the new page**

In `apps/dashboard/src/dashboard-app.test.ts`:

1. Helpers (~248-289): delete `receipt`, `statuses`, `kitchen`, `navReceipt`, `navStatuses`, `navKitchen`; add:

```ts
const venueSettings = (el: DashboardApp) =>
  el.shadowRoot!.querySelector("dashboard-venue-settings-screen");
const navVenueSettings = (el: DashboardApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-venue-settings]");
/** Every h1 under `root`, through each shadow root on the way. */
function allH1(root: ParentNode): Element[] {
  const found = [...root.querySelectorAll("h1")];
  for (const child of root.querySelectorAll("*"))
    if (child.shadowRoot) found.push(...allH1(child.shadowRoot));
  return found;
}
```

2. `NAV_SCREENS`: remove `"statuses"`, `"kitchen"`, `"receipts"`; add `"venue-settings"` where `"receipts"` was.
3. `SCREEN_TAGS`: remove `"dashboard-receipts-screen"`, `"dashboard-service-status-screen"`, `"dashboard-kitchen-screen"`; add `"dashboard-venue-settings-screen"`.
4. `stubApi`'s defaults: add the reads the three panels make on connect, so no stray rejection is hidden:

```ts
    getBumpMode: vi.fn().mockResolvedValue({ mode: "line" }),
    getFireControl: vi.fn().mockResolvedValue({ mode: "waiter" }),
    listCourses: vi.fn().mockResolvedValue([]),
    getLocationSettings: vi
      .fn()
      .mockResolvedValue({ name: "Sala principal", operationDescription: "Venta" }),
    getReceiptLanguage: vi
      .fn()
      .mockResolvedValue({ language: "es-ES", choices: ["es-ES"], fixed: null }),
    previewReceipt: vi.fn(() => new Promise(() => undefined)),
```

   Any later test that overrides one of these keeps its override (overrides are spread last).

5. Replace `navigates to the service-status screen` and `navigates to the kitchen (Cocina) screen` with:

```ts
  it("opens Venue settings, with Table statuses and Kitchen among its tabs, under one h1", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    navVenueSettings(el)!.click();
    await flush(el);
    expect(mountedScreens(el)).toEqual(["dashboard-venue-settings-screen"]);
    const page = venueSettings(el)!;
    const keys = [
      ...page.shadowRoot!.querySelector("wt-tabs")!.shadowRoot!.querySelectorAll('[role="tab"]'),
    ].map((tab) => tab.getAttribute("data-key"));
    expect(keys).toEqual(["receipts", "table-statuses", "kitchen"]);
    expect(page.shadowRoot!.querySelector("dashboard-service-status-screen")).not.toBeNull();
    expect(page.shadowRoot!.querySelector("dashboard-kitchen-screen")).not.toBeNull();
    expect(allH1(el.shadowRoot!)).toHaveLength(1);
    expect(location.pathname).toBe("/manage/venue-settings/view/receipts");
  });

  it("hands each core panel the shell's api", async () => {
    history.replaceState(null, "", "/manage/venue-settings/view/kitchen");
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    const page = venueSettings(el)!;
    for (const tag of [
      "dashboard-receipts-screen",
      "dashboard-service-status-screen",
      "dashboard-kitchen-screen",
    ])
      expect(page.shadowRoot!.querySelector<HTMLElement & { api: DashboardApi }>(tag)!.api).toBe(
        api,
      );
    expect(location.pathname).toBe("/manage/venue-settings/view/kitchen");
  });

  it.each(["/manage/kitchen", "/manage/statuses", "/manage/receipts"])(
    "treats the retired address %s as an unknown screen",
    async (path) => {
      history.replaceState(null, "", path);
      const { el } = await mountWidget<DashboardApp>("dashboard-app", {
        api: stubApi({ listStaff: vi.fn().mockResolvedValue([]) }),
      });
      await flush(el);
      expect(overview(el)).not.toBeNull();
      expect(location.pathname).toBe("/manage/overview");
    },
  );
```

   `/manage/adjustment-reasons` is not in this list: it belongs to the adjustments module, which still owns that screen until Task 7, and the default stub does not enable adjustments, so a row here would pass before and after. Task 7 Step 1 adds its own case with adjustments enabled.

6. `navigates the three non-roster logged-in screens…`: replace `navReceipt` with `navVenueSettings`, the expected tag `"dashboard-receipts-screen"` with `"dashboard-venue-settings-screen"`, `receipt(el)` with `venueSettings(el)`, and the `countH1(el)` after it with `allH1(el.shadowRoot!).length` (the panels' shadow roots sit one level deeper than `countH1` looks, so `countH1` would read 1 whether a panel kept its `h1` or not).
7. `offers a manager one Receipts page in Settings…` (~2140): replace with:

```ts
  it("offers a manager Venue settings in Settings, opening on its Receipts tab", async () => {
    const api = stubApi({ listStaff: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api });
    await flush(el);
    expect(navItem(el, "receipts")).toBeNull();
    const item = navVenueSettings(el)!;
    expect(item.textContent!.trim()).toBe(t("nav.venue_settings"));
    const panel = el.shadowRoot!.querySelector("#nav-group-panel-configuration")!;
    expect(panel.contains(item)).toBe(true);
    item.click();
    await flush(el);
    const receipts = venueSettings(el)!.shadowRoot!.querySelector<
      HTMLElement & { api?: DashboardApi }
    >("dashboard-receipts-screen");
    expect(receipts!.api).toBe(api);
    expect(location.pathname).toBe("/manage/venue-settings/view/receipts");
  });
```

8. `hides the Receipts page from a supervisor` (~2162): keep its supervisor stub; replace the two final expectations with:

```ts
    expect(navItem(el, "devices")).toBeTruthy();
    navVenueSettings(el)!.click();
    await flush(el);
    const page = venueSettings(el)!;
    expect(page.shadowRoot!.querySelector("dashboard-receipts-screen")).toBeNull();
    expect(location.pathname).toBe("/manage/venue-settings/view/table-statuses");
```

   and rename it `shows a supervisor Venue settings without its Receipts tab`.
9. `offers Content languages in Settings, after Receipts…` (~2258): change `"nav-receipts"` to `"nav-venue-settings"` and "after Receipts" to "after Venue settings" in its name.
10. `does not show the nav on the login screen` (~2690): `navReceipt` → `navVenueSettings`.
11. The `it.each` of addresses (~4686): remove `["receipts", "dashboard-receipts-screen"],` (Venue settings has no `api` property; the "hands each core panel the shell's api" case above covers it).
12. `files every enabled module the session may use into its group…` (~4753): expected Service list becomes `["nav-floor", "nav-bookings", "nav-venue-operations", "nav-prep-stations"]` (Task 8 changes it again).
13. Run `/usr/bin/grep -n "Recibos\|Receipts\|Cocina\|Kitchen\|Estados\|Statuses" apps/dashboard/src/dashboard-app.test.ts` and fix any remaining search-term case that relied on those three nav labels; keep its intent (find a page by part of its label) using "Venue settings" / "Ajustes del local".

In `apps/dashboard/src/dashboard-app.a11y.test.ts` (~319-332), replace the receipt case with:

```ts
  it("the Venue settings page renders accessibly with a single, well-ordered heading", async () => {
    const api = stubApi({
      listStaff: vi.fn().mockResolvedValue(people),
      getBumpMode: vi.fn().mockResolvedValue({ mode: "line" }),
      getFireControl: vi.fn().mockResolvedValue({ mode: "waiter" }),
      listCourses: vi.fn().mockResolvedValue([]),
      listStatuses: vi.fn().mockResolvedValue([]),
    });
    const { el, host } = await mountWidget<DashboardApp>("dashboard-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-venue-settings]")!.click();
    await flush(el);
    const page = el.shadowRoot!.querySelector("dashboard-venue-settings-screen");
    expect(page).toBeTruthy();
    const deep = (root: ParentNode): Element[] => [
      ...root.querySelectorAll("h1"),
      ...[...root.querySelectorAll("*")].flatMap((child) =>
        child.shadowRoot ? deep(child.shadowRoot) : [],
      ),
    ];
    expect(deep(el.shadowRoot!)).toHaveLength(1);
    await expectNoA11yViolations(host);
  });
```

   (If that file's `stubApi` takes overrides differently, follow its shape; the reads listed are what the three panels make on connect.)

In `apps/dashboard/src/dashboard-app.module-order.test.ts`, the expected list becomes `["nav-floor", "nav-unordered", "nav-first", "nav-second"]`.

- [ ] **Step 3: Run them and watch them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/receipts-screen.trim.test.ts src/screens/service-status-screen.test.ts src/screens/kitchen-screen.test.ts src/dashboard-app.test.ts src/dashboard-app.module-order.test.ts`
Expected: FAIL — the screens still draw an `h1`; there is no `nav-venue-settings`; `/manage/receipts` still opens Receipts.

- [ ] **Step 4: Remove the panels' h1s**

- `receipts-screen.ts` render: `return html\`<h1>${t("receipts.title")}</h1>` → `return html\``, keeping everything after it.
- `service-status-screen.ts`: delete the `<h1 class="title">${t("status.title")}</h1>` line and the `.title { … }` rule in its styles.
- `kitchen-screen.ts`: delete `<h1 class="title">${t("kitchen.title")}</h1>`, the `<p><a href="/manage/prep-stations">…</a></p>` line, and the `.title { … }` rule.

- [ ] **Step 5: Wire the page into the shell**

In `apps/dashboard/src/dashboard-app.ts`:

1. Imports: remove nothing yet (the three screen modules are still needed); add

```ts
import "./screens/venue-settings-screen.js";
import type { VenueSettingsPanel, VenueSettingsTab } from "./screens/venue-settings-screen.js";
```

2. `CORE_SCREENS`: remove `"receipts"`, `"statuses"`, `"kitchen"`; add `"venue-settings"` after `"content-languages"`.
3. Types:

```ts
type AccessRule = {
  requiresManager?: boolean;
  requiresPermission?: string;
};
type ScreenRule = AccessRule & { screen: ScreenId };
```

   (replacing the old `ScreenRule`), and after `UNLISTED_SCREENS`:

```ts
type CoreSettingsPanel = AccessRule & {
  key: string;
  tab: VenueSettingsTab;
  render(api: DashboardApi): TemplateResult;
};

const CORE_SETTINGS_PANELS: readonly CoreSettingsPanel[] = [
  {
    key: "receipts",
    tab: "receipts",
    requiresManager: true,
    render: (api) => html`<dashboard-receipts-screen .api=${api}></dashboard-receipts-screen>`,
  },
  {
    key: "table-statuses",
    tab: "table-statuses",
    render: (api) =>
      html`<dashboard-service-status-screen .api=${api}></dashboard-service-status-screen>`,
  },
  {
    key: "kitchen",
    tab: "kitchen",
    render: (api) => html`<dashboard-kitchen-screen .api=${api}></dashboard-kitchen-screen>`,
  },
];
```

4. `NAV_GROUPS`: in `service`, delete the `statuses` and `kitchen` items; in `configuration`, replace the `receipts` item with `{ screen: "venue-settings", labelKey: "nav.venue_settings" },`.
5. `#mayOpen`:

```ts
  #mayOpen(rule: AccessRule): boolean {
    if (rule.requiresManager && this.sessionRole !== "manager" && this.sessionRole !== "admin")
      return false;
    return (
      rule.requiresPermission === undefined ||
      this.#sessionPermissions.includes(rule.requiresPermission)
    );
  }

  /** The Venue settings panels this session may see, core first on an equal order. */
  #settingsPanels(): (VenueSettingsPanel & { order: number })[] {
    return CORE_SETTINGS_PANELS.filter((panel) => this.#mayOpen(panel)).map((panel) => ({
      key: panel.key,
      tab: panel.tab,
      order: 0,
      render: () => panel.render(this.api),
    }));
  }
```

6. `#renderScreen`: delete the `receipts`, `statuses` and `kitchen` cases; add

```ts
      case "venue-settings":
        return html`<dashboard-venue-settings-screen
          .panels=${this.#settingsPanels()}
        ></dashboard-venue-settings-screen>`;
```

7. `apps/dashboard/src/i18n/strings.ts`: add `"nav.venue_settings": "Venue settings",` (English) and `"nav.venue_settings": "Ajustes del local",` (Spanish) beside `nav.printing_rules`/the `nav.*` keys.

- [ ] **Step 6: Run the tests and see them pass**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/screens/receipts-screen.trim.test.ts src/screens/service-status-screen.test.ts src/screens/kitchen-screen.test.ts src/screens/kitchen-screen.a11y.test.ts src/screens/receipts-screen.a11y.test.ts src/screens/service-status-screen.a11y.test.ts src/dashboard-app.test.ts src/dashboard-app.a11y.test.ts src/dashboard-app.module-order.test.ts src/dashboard-app.module-screens.test.ts`
Expected: PASS. Then run the typecheck: `pnpm --filter @waitron/dashboard typecheck`.

- [ ] **Step 7: Delete the strings this left unused**

For each of `nav.receipts`, `nav.statuses`, `nav.kitchen`, `receipts.title`, `status.title`, `kitchen.title`, `kitchen.prep_stations_link`, run `/usr/bin/grep -rn '"<key>"\|<key>' apps packages --include='*.ts' | /usr/bin/grep -v node_modules` and, where the only hits are the two definitions in `apps/dashboard/src/i18n/strings.ts`, delete both definitions (English and Spanish). Leave a key that something still reads. Re-run `pnpm --filter @waitron/dashboard typecheck`.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src
git commit -s -m "Dashboard: Receipts, Table statuses and Kitchen become tabs of Venue settings, each without its own heading"
```

---

### Task 5: Modules can add panels to Venue settings

**Files:**
- Modify: `packages/dashboard-kit/src/contract.ts`
- Modify: `apps/dashboard/src/dashboard-app.ts` (`#activate` 1095-1128; fields ~628-634; `#returnToLogin` ~1074; `#settingsPanels`)
- Create: `apps/dashboard/src/dashboard-app.settings-panels.test.ts`

**Interfaces:**
- Consumes: `VENUE_SETTINGS_TABS` (Task 3), `#settingsPanels`, `CORE_SETTINGS_PANELS` (Task 4).
- Produces, in `packages/dashboard-kit/src/contract.ts`:

```ts
/** A Venue settings tab key; the app validates each contributed panel's tab against its own list. */
export type SettingsTabId = string;

/** A panel a module adds to one tab of the Venue settings page. The page owns the h1, so a panel
 * renders none. */
export interface DashboardSettingsPanel {
  /** Unique across every panel, core and module. */
  id: string;
  tab: SettingsTabId;
  /** Order among the tab's panels; core panels count as 0 and come first on a tie. */
  order?: number;
  requiresPermission: string;
  create(ctx: DashboardModuleContext): DashboardScreenHandle;
}
```

  and on `DashboardContribution`: `settingsPanels?: readonly DashboardSettingsPanel[];`. `#activate` throws `dashboard module "<m>" names unknown settings tab "<tab>"` and `dashboard module "<m>" repeats settings panel id "<id>"`.

- [ ] **Step 1: Write the failing tests**

`apps/dashboard/src/dashboard-app.settings-panels.test.ts`:

```ts
import { html } from "lit";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
import type { DashboardApi } from "./api/client.js";
import "./dashboard-app.js";
import type { DashboardApp } from "./dashboard-app.js";

// "widgets" adds a kitchen panel this session may see and a floor panel it may not; "gadgets" is
// not enabled for the venue and adds a floor panel too.
function panelModule(module: string, panels: DashboardContribution["settingsPanels"]) {
  return {
    module,
    screen: {
      id: `${module}-home`,
      navLabelKey: `nav.${module}`,
      group: "reports",
      requiresPermission: "test.use",
    },
    strings: { en: { [`nav.${module}`]: module }, es: { [`nav.${module}`]: module } },
    create: () => ({ render: () => html`<p>${module}</p>` }),
    settingsPanels: panels,
  } satisfies DashboardContribution;
}
// A function declaration, not a `const`: `vi.mock` is hoisted above the module body, and its
// factory would otherwise read `shown` before initialization.
function shown(id: string) {
  return () => ({ render: () => html`<p data-test=${`panel-${id}`}>${id}</p>` });
}

vi.mock("@waitron/dashboard-modules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@waitron/dashboard-modules")>()),
  DASHBOARD_MODULES: [
    panelModule("widgets", [
      { id: "widgets-late", tab: "kitchen", order: 5, requiresPermission: "test.use", create: shown("late") },
      { id: "widgets-early", tab: "kitchen", order: -1, requiresPermission: "test.use", create: shown("early") },
      { id: "widgets-floor", tab: "floor", requiresPermission: "test.audit", create: shown("floor") },
    ]),
    panelModule("gadgets", [
      { id: "gadgets-floor", tab: "floor", requiresPermission: "test.use", create: shown("gadgets") },
    ]),
  ],
}));

const initialUrl = location.href;
afterEach(() => {
  cleanupWidgets();
  history.replaceState(null, "", initialUrl);
  setLocale("es-ES");
});

function stubApi(role = "manager"): DashboardApi {
  const pending = () => vi.fn(() => new Promise(() => undefined));
  return {
    getMe: vi.fn().mockResolvedValue({
      personId: "p1",
      role,
      email: "manager@example.com",
      locale: null,
      venueLocale: "es-ES",
      sessionDefault: "es-ES",
      venueName: "Deli Test SL",
      permissions: ["test.use"],
      modules: ["widgets"],
    }),
    getGoogleConfig: vi.fn().mockResolvedValue({ configured: false }),
    getContentLanguages: vi.fn().mockResolvedValue({ defaultLanguage: "es", languages: ["es"] }),
    getSalesOverview: pending(),
    listAlerts: vi.fn().mockResolvedValue({ visible: false, alerts: [] }),
    getReceipt: pending(),
    getLocationSettings: pending(),
    getReceiptLanguage: pending(),
    listStatuses: vi.fn().mockResolvedValue([]),
    listCourses: vi.fn().mockResolvedValue([]),
    getBumpMode: vi.fn().mockResolvedValue({ mode: "line" }),
    getFireControl: vi.fn().mockResolvedValue({ mode: "waiter" }),
  } as unknown as DashboardApi;
}

async function mount(path: string, role = "manager"): Promise<DashboardApp> {
  const url = new URL(location.href);
  url.pathname = path;
  history.replaceState(null, "", url);
  const { el } = await mountWidget<DashboardApp>("dashboard-app", {
    api: stubApi(role),
    request: async () => [] as never,
  });
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-venue-settings-screen")).not.toBeNull(),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  return el;
}
const page = (el: DashboardApp) => el.shadowRoot!.querySelector("dashboard-venue-settings-screen")!;
const tabKeys = (el: DashboardApp) =>
  [...page(el).shadowRoot!.querySelector("wt-tabs")!.shadowRoot!.querySelectorAll('[role="tab"]')].map(
    (tab) => tab.getAttribute("data-key"),
  );

it("puts a module's panels on their tab by their stated order, the core panel counting as 0", async () => {
  const el = await mount("/manage/venue-settings/view/kitchen");
  const kitchen = page(el).shadowRoot!.querySelector('[slot="kitchen"]')!;
  const children = [...kitchen.children].map((child) =>
    child.tagName === "DASHBOARD-KITCHEN-SCREEN" ? "core" : (child as HTMLElement).dataset.test,
  );
  expect(children).toEqual(["panel-early", "core", "panel-late"]);
});

it("leaves out a panel the session lacks the permission for, and a disabled module's panel", async () => {
  const el = await mount("/manage/venue-settings/view/floor");
  expect(tabKeys(el)).toEqual(["receipts", "table-statuses", "kitchen"]);
  expect(page(el).shadowRoot!.querySelector("[data-test=panel-floor]")).toBeNull();
  expect(page(el).shadowRoot!.querySelector("[data-test=panel-gadgets]")).toBeNull();
  expect(location.pathname).toBe("/manage/venue-settings/view/receipts");
});

it("refuses to start when a module names an unknown settings tab", async () => {
  const list = DASHBOARD_MODULES as unknown as unknown[];
  const original = [...list];
  list.length = 0;
  list.push(
    panelModule("widgets", [
      { id: "lost", tab: "nowhere", requiresPermission: "test.use", create: shown("lost") },
    ]),
  );
  try {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi(),
      request: async () => [] as never,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    // The throw lands in the session probe's catch, which drops to login; a silent skip would not.
    expect(el.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull();
  } finally {
    list.length = 0;
    list.push(...original);
  }
});

it("refuses to start when a module repeats a core panel's id", async () => {
  const list = DASHBOARD_MODULES as unknown as unknown[];
  const original = [...list];
  list.length = 0;
  list.push(
    panelModule("widgets", [
      { id: "kitchen", tab: "kitchen", requiresPermission: "test.use", create: shown("dup") },
    ]),
  );
  try {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi(),
      request: async () => [] as never,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("dashboard-login-screen")).not.toBeNull();
  } finally {
    list.length = 0;
    list.push(...original);
  }
});
```

(`mount` is not used by the two refusal cases because they never reach the page.) Check the negative control in each refusal case: before Step 3, the module's panel is silently ignored and the session lands on Overview, so the login-screen assertion fails — that is the failure you must see.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.settings-panels.test.ts`
Expected: FAIL. Vitest does not typecheck, so the missing `settingsPanels` field on the contract is no failure here (the typecheck in Step 5 catches it). What the run prints: the order case fails its `toEqual`, receiving `["core"]` where it expects `["panel-early", "core", "panel-late"]`, because no module panel appears; and the two refusal cases fail `expected null not to be null`, because the session lands on Overview, not the login screen. The "leaves out a panel…" case already passes here, since it checks only that panels are absent — it guards against Step 4 showing too much, not against it showing nothing.

- [ ] **Step 3: Add the contract seat**

Add the `SettingsTabId` type and `DashboardSettingsPanel` interface from the Interfaces block to `packages/dashboard-kit/src/contract.ts` (after `DashboardFurtherScreen`), and to `DashboardContribution`:

```ts
  /** Panels on the Venue settings page; each names a tab the app knows, and is shown only to a
   * session holding its permission. */
  settingsPanels?: readonly DashboardSettingsPanel[];
```

`packages/dashboard-kit/src/index.ts` already re-exports `./contract.js`, so nothing else changes there.

- [ ] **Step 4: Activate and show module panels**

In `apps/dashboard/src/dashboard-app.ts`:

1. Import `DashboardSettingsPanel` from `@waitron/dashboard-kit` (add to the existing import list) and `VENUE_SETTINGS_TABS` from `./screens/venue-settings-screen.js` (beside the type import).
2. Field beside `#navGroups`:

```ts
  #activePanels: { panel: DashboardSettingsPanel; handle: DashboardScreenHandle }[] = [];
```

3. `#returnToLogin`: after `this.#navGroups.clear();` add `this.#activePanels = [];`.
4. `#activate`: replace with

```ts
  #activate(enabled: readonly string[]): void {
    const knownGroups = new Set<NavGroupId>(NAV_GROUPS.map((g) => g.id));
    const knownTabs = new Set<string>(VENUE_SETTINGS_TABS);
    const ids = new Set<string>(CORE_SCREENS);
    const panelIds = new Set<string>(CORE_SETTINGS_PANELS.map((panel) => panel.key));
    this.#activeScreens.clear();
    this.#navGroups.clear();
    this.#activePanels = [];
    for (const c of DASHBOARD_MODULES) {
      if (!enabled.includes(c.module)) continue;
      const screens: readonly DashboardFurtherScreen[] = [c, ...(c.moreScreens ?? [])];
      for (const { screen } of screens) {
        if (!knownGroups.has(screen.group))
          throw new Error(
            `dashboard module "${c.module}" names unknown nav group "${screen.group}"`,
          );
        if (ids.has(screen.id))
          throw new Error(`dashboard module "${c.module}" repeats screen id "${screen.id}"`);
        ids.add(screen.id);
      }
      for (const panel of c.settingsPanels ?? []) {
        if (!knownTabs.has(panel.tab))
          throw new Error(
            `dashboard module "${c.module}" names unknown settings tab "${panel.tab}"`,
          );
        if (panelIds.has(panel.id))
          throw new Error(`dashboard module "${c.module}" repeats settings panel id "${panel.id}"`);
        panelIds.add(panel.id);
      }
      registerCatalogue(c.strings);
      const ctx = { request: this.request, liveData: this.api.liveData };
      for (const contributed of screens) {
        const { screen } = contributed;
        this.#activeScreens.set(screen.id, { screen, handle: contributed.create(ctx) });
        if (this.#sessionPermissions.includes(screen.requiresPermission)) {
          const group = this.#navGroups.get(screen.group) ?? [];
          group.push(screen);
          this.#navGroups.set(screen.group, group);
        }
      }
      for (const panel of c.settingsPanels ?? [])
        this.#activePanels.push({ panel, handle: panel.create(ctx) });
    }
    for (const list of this.#navGroups.values())
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
```

   and update its doc comment's last sentence to: "A screen naming an unknown nav group id, a panel naming an unknown Venue settings tab, or a repeated screen or panel id THROWS rather than silently dropping or replacing one."
5. `#settingsPanels`:

```ts
  #settingsPanels(): (VenueSettingsPanel & { order: number })[] {
    const core = CORE_SETTINGS_PANELS.filter((panel) => this.#mayOpen(panel)).map((panel) => ({
      key: panel.key,
      tab: panel.tab,
      order: 0,
      render: () => panel.render(this.api),
    }));
    const modules = this.#activePanels
      .filter(({ panel }) => this.#sessionPermissions.includes(panel.requiresPermission))
      .map(({ panel, handle }) => ({
        key: panel.id,
        // `#activate` refused any tab outside VENUE_SETTINGS_TABS.
        tab: panel.tab as VenueSettingsTab,
        order: panel.order ?? 0,
        render: () => handle.render(),
      }));
    return [...core, ...modules].sort((a, b) => a.order - b.order);
  }
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `pnpm --filter @waitron/dashboard-kit typecheck && pnpm --filter @waitron/dashboard typecheck && pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.settings-panels.test.ts src/dashboard-app.module-screens.test.ts src/dashboard-app.test.ts -t "module|unknown|Venue settings"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard-kit/src/contract.ts apps/dashboard/src/dashboard-app.ts apps/dashboard/src/dashboard-app.settings-panels.test.ts
git commit -s -m "Dashboard contract: modules can add panels to a Venue settings tab, checked when the session starts"
```

---

### Task 6: venue-service's kitchen and floor panels; its screen loses the "Changes after sending" tab

**Files:**
- Create: `packages/venue-service/src/dashboard/service-settings-panel.ts`
- Create: `packages/venue-service/src/dashboard/service-settings-panel.test.ts`
- Create: `packages/venue-service/src/dashboard/service-settings-panel.a11y.test.ts`
- Modify: `packages/venue-service/src/dashboard/venue-operations-screen.ts` (constants 29-31; `VIEWS` 32; the four `#save*Setting` methods ~265-335; `#kitchenChanges`, `#releaseReminder`, `#kitchenTicketGrouping` ~844-910; render 1166-1186)
- Modify: `packages/venue-service/src/dashboard/venue-operations-screen.test.ts` (move describes ~1917-2443; tab list ~771-780; hint case ~2668), `venue-operations-screen.a11y.test.ts` (move the four kitchen-tab describes ~36-216)
- Modify: `packages/venue-service/src/dashboard/index.ts`, `index.test.ts`, `strings.ts`

**Interfaces:**
- Consumes: `VenueServiceApi.loadSettings()`, `saveClearingWorkflow()`, `saveSettings()`, `saveKitchenTicketGrouping()`, `savePrintHeldWork()`, `saveReleaseReminderMinutes()`, `VenueServiceSettingsView`, `QUERY_DEPENDENCIES.settings` (Task 2); `DashboardSettingsPanel` (Task 5).
- Produces: element `dashboard-venue-service-settings`, class `ServiceSettingsPanel`, properties `api: VenueServiceApi` and `subject: "kitchen" | "floor"`; `VENUE_SERVICE_DASHBOARD.settingsPanels` = `[{ id: "venue-service-kitchen", tab: "kitchen", order: 10, requiresPermission: "venue_service.manage" }, { id: "venue-service-floor", tab: "floor", requiresPermission: "venue_service.manage" }]`; strings `venue.clearing_workflow`, `venue.clearing_workflow_hint`.

- [ ] **Step 1: Move the kitchen-setting tests to the new panel, and add the floor tests**

Create `service-settings-panel.test.ts` with this header:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { VenueServiceApi, VenueServiceSettingsView } from "./client.js";
import type { ServiceSettingsPanel } from "./service-settings-panel.js";
import "./service-settings-panel.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

const model: VenueServiceSettingsView = {
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: 10,
  clearingWorkflow: false,
};

async function mount(
  api: VenueServiceApi,
  subject: "kitchen" | "floor" = "kitchen",
): Promise<ServiceSettingsPanel> {
  const host = document.createElement("div");
  applyTokens(host);
  document.body.appendChild(host);
  hosts.push(host);
  const el = document.createElement("dashboard-venue-service-settings") as ServiceSettingsPanel;
  el.api = api;
  el.subject = subject;
  host.appendChild(el);
  await settle(el);
  return el;
}

async function settle(el: ServiceSettingsPanel) {
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

/** The alert at the top of the panel: a load failure, or a refusal of a setting. */
function pageAlert(el: ServiceSettingsPanel) {
  return el.shadowRoot!.querySelector('[data-test="page-alert"]')!.textContent!.trim();
}
```

From `venue-operations-screen.test.ts` (lines ~135-202): **cut** the `SettingBox` type (only the describes moved below use it) and paste it here; **copy** `clickChosenRow` and `changesHeardOutside`, which stay in the screen's file too because its zone-dropdown case still calls them (~439 and ~458). Leave `options` where it is: no moved case calls it (`/usr/bin/grep -n 'options(' venue-operations-screen.test.ts` hits only lines outside ~1917-2443). Each goes in unchanged, retyped for `ServiceSettingsPanel` where it names the screen type.

Then **move** — cut from `venue-operations-screen.test.ts` and paste here — these four describes, keeping every `it` and every assertion:
`the setting that allows changes to items already sent to the kitchen`, `the setting for how identical dishes print on a kitchen ticket`, `the setting that prints held groups in advance`, `the setting for the reminder to fire the next group` (~1917-2443). Apply exactly these edits to the moved code and nothing else:

- `VenueOperationsScreen` → `ServiceSettingsPanel`; `VenueServiceView` → `VenueServiceSettingsView`.
- In every api stub and expectation, the method `load` → `loadSettings` (for example `load: vi.fn().mockResolvedValue(model)` → `loadSettings: vi.fn().mockResolvedValue(model)` and `expect(api.load).toHaveBeenCalledTimes(2)` → `expect(api.loadSettings).toHaveBeenCalledTimes(2)`), including the `{ load, liveData }` live-update cases (`const loadSettings = vi.fn()…; mount({ loadSettings, liveData } …)`).
- Delete every `await selectTab(el, "kitchen");` line (the panel has no tabs).
- `expect(host.closest('[slot="kitchen"]')).not.toBeNull();` and `expect(select.closest('[slot="kitchen"]')).not.toBeNull();` → `expect(host.closest('[data-test="kitchen-changes"]')).not.toBeNull();` / the same with `select`.
- The first case's name `shows the stored value on the Changes after sending tab, on by default` → `shows the stored value on the kitchen panel, on by default`.
- A comment saying "the screen" → "the panel"; "at the top of the screen" in a case name → "at the top of the panel".

Also move the `it("gives the two kitchen settings' dropdowns their hints", …)` case (~2668) into a `describe("the kitchen panel's fields", …)` here, applying the same edits; if it uses a `dropdown(root, name)` helper, copy that helper too.

Add the floor cases:

```ts
describe("the setting that leaves tables needing clearing after Finish table", () => {
  function clearingSwitch(el: ServiceSettingsPanel) {
    const host = el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      'wt-switch[name="clearingWorkflow"]',
    )!;
    expect(host).not.toBeNull();
    return { host, input: host.shadowRoot!.querySelector<HTMLInputElement>('[role="switch"]')! };
  }
  const withClearing = (clearingWorkflow: boolean): VenueServiceSettingsView => ({
    ...structuredClone(model),
    clearingWorkflow,
  });

  it("shows only the clearing switch on the floor panel, with its hint, off by default", async () => {
    const el = await mount(
      { loadSettings: vi.fn().mockResolvedValue(model) } as unknown as VenueServiceApi,
      "floor",
    );
    const { host, input } = clearingSwitch(el);
    expect(host.shadowRoot!.querySelector("label")!.textContent).toBe(
      "Tables need clearing after Finish table",
    );
    expect(input.checked).toBe(false);
    expect(el.shadowRoot!.querySelector('[data-test="clearing-workflow-hint"]')!.textContent).toContain(
      "Needs clearing",
    );
    expect(el.shadowRoot!.querySelector('wt-switch[name="editSentLines"]')).toBeNull();
    expect(el.shadowRoot!.querySelector("h1")).toBeNull();
  });

  it("saves the new value at once, disabled until the save finishes, then shows the stored one", async () => {
    let finish!: () => void;
    const api = {
      loadSettings: vi.fn().mockResolvedValueOnce(model).mockResolvedValue(withClearing(true)),
      saveClearingWorkflow: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    } as unknown as VenueServiceApi;
    const el = await mount(api, "floor");
    clearingSwitch(el).input.click();
    await settle(el);
    expect(api.saveClearingWorkflow).toHaveBeenCalledWith(true);
    expect(clearingSwitch(el).host.disabled).toBe(true);
    finish();
    await settle(el);
    expect(api.loadSettings).toHaveBeenCalledTimes(2);
    expect(clearingSwitch(el).input.checked).toBe(true);
    expect(clearingSwitch(el).host.disabled).toBe(false);
  });

  it("says a refused save failed, beside the switch and at the top, and shows the stored value again", async () => {
    const api = {
      loadSettings: vi.fn().mockResolvedValue(model),
      saveClearingWorkflow: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as VenueServiceApi;
    const el = await mount(api, "floor");
    clearingSwitch(el).input.click();
    await settle(el);
    expect(pageAlert(el)).toContain("could not be saved");
    expect(
      el.shadowRoot!.querySelector('[data-field-error="clearingWorkflow"]')!.textContent,
    ).toContain("could not be saved");
    expect(clearingSwitch(el).input.checked).toBe(false);
  });

  it("follows a change another dashboard makes", async () => {
    const liveData = new LiveData();
    const loadSettings = vi.fn().mockResolvedValue(model);
    const el = await mount({ loadSettings, liveData } as unknown as VenueServiceApi, "floor");
    loadSettings.mockResolvedValue(withClearing(true));
    liveData.invalidate([{ type: "service_settings" }]);
    await vi.waitFor(() => expect(clearingSwitch(el).input.checked).toBe(true));
  });

  it("reads in Spanish", async () => {
    setLocale("es");
    const el = await mount(
      { loadSettings: vi.fn().mockResolvedValue(model) } as unknown as VenueServiceApi,
      "floor",
    );
    expect(clearingSwitch(el).host.shadowRoot!.querySelector("label")!.textContent).toBe(
      "Las mesas quedan por recoger tras Cerrar mesa",
    );
  });
});

it("says the settings could not be loaded when the read fails", async () => {
  const el = await mount({
    loadSettings: vi.fn().mockRejectedValue(new Error("offline")),
  } as unknown as VenueServiceApi);
  expect(pageAlert(el)).toContain("could not be loaded");
});
```

Move the four kitchen-tab describes from `venue-operations-screen.a11y.test.ts` — `kitchen changes setting accessibility (%s)` (~36), `kitchen ticket grouping setting accessibility (%s)` (~75), `print held work setting accessibility (%s)` (~124) and `release reminder setting accessibility (%s)` (~167), each of which clicks `[data-key="kitchen"]` — into `service-settings-panel.a11y.test.ts`, with the same edits (mount the panel directly, `load` → `loadSettings` resolving a `VenueServiceSettingsView`, delete the tab click), and add:

```ts
describe.each(["light", "dark"] as const)("floor panel accessibility (%s)", (theme) => {
  it("has no violations", async () => {
    const host = document.createElement("div");
    host.dataset.theme = theme;
    applyTokens(host);
    document.body.append(host);
    try {
      const el = document.createElement("dashboard-venue-service-settings") as ServiceSettingsPanel;
      el.api = {
        loadSettings: vi.fn().mockResolvedValue(model),
      } as unknown as VenueServiceApi;
      el.subject = "floor";
      host.append(el);
      await el.updateComplete;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
      await expectNoA11yViolations(host);
    } finally {
      host.remove();
    }
  });
});
```

   Use the same theme-setting and `expectNoA11yViolations` import the moved describes use (copy their imports and `model`).

In `venue-operations-screen.test.ts`, change the tab-list case (~771) to expect `["status", "departments", "zones"]`, and add to `venue-navigation.test.ts`'s `it.each` of replaced addresses the path `"/manage/venue-operations/view/kitchen"` (the retired tab falls back to Status).

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/venue-service exec vitest run src/dashboard/service-settings-panel.test.ts src/dashboard/venue-operations-screen.test.ts src/dashboard/venue-navigation.test.ts`
Expected: FAIL — `./service-settings-panel.js` does not exist; the screen still has a `kitchen` tab.

- [ ] **Step 3: Add the strings**

`packages/venue-service/src/dashboard/strings.ts`, English (after `venue.print_held_work_hint`):

```ts
  "venue.clearing_workflow": "Tables need clearing after Finish table",
  "venue.clearing_workflow_hint":
    "When on, a table a party leaves — when it finishes, moves to another table or joins another party — shows Needs clearing until someone marks it cleared.",
```

Spanish:

```ts
  "venue.clearing_workflow": "Las mesas quedan por recoger tras Cerrar mesa",
  "venue.clearing_workflow_hint":
    "Si está activado, una mesa que un grupo deja —al Cerrar mesa, al cambiarse a otra mesa o al unirse a otro grupo— aparece Por recoger hasta que alguien la marca como recogida.",
```

The hint names every path the setting governs, not only Finish table: `leaveForClearing` (`apps/server/src/parties.ts` ~506) reads the setting, and it is called by Finish table (`parties.ts` ~566), by moving guests (`moveGuests`, `apps/server/src/table-actions.ts` ~85) and by combining parties with `tables: "leave"` (~218), which is what a move onto a table another party holds does (~74). The label keeps the till's own "Finish table" words.

- [ ] **Step 4: Write the panel**

`packages/venue-service/src/dashboard/service-settings-panel.ts` — the markup and save logic are lifted from `venue-operations-screen.ts` so the moved tests hold unchanged:

```ts
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { QueryController } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { baseStyles } from "@waitron/ui";
import type { KitchenTicketGrouping, VenueServiceApi, VenueServiceSettingsView } from "./client.js";
import { t } from "./strings.js";

const GROUPINGS: KitchenTicketGrouping[] = ["combined", "separate"];
const REMINDER_MINUTES = [5, 10, 15, 20, 30];
type Field =
  | "editSentLines"
  | "kitchenTicketGrouping"
  | "printHeldWork"
  | "releaseReminderMinutes"
  | "clearingWorkflow";

/** The venue-service settings on one Venue settings tab: the kitchen's, or the floor's. */
@customElement("dashboard-venue-service-settings")
export class ServiceSettingsPanel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      section {
        margin-block: var(--wt-space-3);
      }
      .field-error,
      [role="alert"] {
        color: var(--wt-color-danger);
      }
      .field-error {
        margin: 0;
        font-weight: normal;
      }
      .setting {
        margin-top: var(--wt-space-4);
      }
      .hint {
        margin: var(--wt-space-1) 0 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];
  @property({ attribute: false }) api!: VenueServiceApi;
  @property() subject: "kitchen" | "floor" = "kitchen";
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    () => {
      this.loadError = t("venue.load_error");
    },
  );
  #loaded = false;
  @state() private model?: VenueServiceSettingsView;
  @state() private loadError?: string;
  @state() private fieldErrors: Partial<Record<Field, string>> = {};
  @state() private busy = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    try {
      let initial = !this.#loaded;
      this.#loaded = true;
      await this.#queries.watch(
        "settings",
        {
          key: "venue-service:settings",
          dependencies: QUERY_DEPENDENCIES.settings.map((type) => ({ type })),
          refreshMs: 60_000,
          read: () => {
            const api = initial ? this.api : (this.api.background ?? this.api);
            initial = false;
            return api.loadSettings();
          },
        },
        (value) => {
          this.model = value;
          this.loadError = undefined;
        },
      );
    } catch {
      this.loadError = t("venue.load_error");
    }
  }

  /** A failed refresh after a stored change is a load failure, not a failed save. */
  async #save(
    field: Field,
    write: () => Promise<void>,
    stored: Partial<VenueServiceSettingsView>,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.fieldErrors = {};
    try {
      await write();
      this.model = { ...this.model!, ...stored };
      await this.#load();
    } catch {
      this.fieldErrors = { [field]: t("venue.save_error") };
    } finally {
      this.busy = false;
    }
  }

  #fieldError(name: Field) {
    const message = this.fieldErrors[name];
    return message
      ? html`<p id=${`error-${name}`} class="field-error" data-field-error=${name}>${message}</p>`
      : nothing;
  }

  #switch(name: Field, label: string, checked: boolean, save: (value: boolean) => void) {
    return html`<wt-switch
      class="setting"
      name=${name}
      label=${label}
      .checked=${live(checked)}
      .disabled=${this.busy}
      @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
        event.stopPropagation();
        save(event.detail.checked);
      }}
    ></wt-switch>`;
  }

  #kitchen(model: VenueServiceSettingsView): TemplateResult {
    return html`<section data-test="kitchen-changes">
      <h2>${t("venue.kitchen_changes")}</h2>
      ${this.#switch("editSentLines", t("venue.edit_sent_lines"), model.settings.editSentLines, (editSentLines) =>
        void this.#save("editSentLines", () => this.api.saveSettings({ editSentLines }), {
          settings: { editSentLines },
        }),
      )}
      <p class="hint" data-test="edit-sent-lines-hint">${t("venue.edit_sent_lines_hint")}</p>
      ${this.#fieldError("editSentLines")} ${this.#kitchenTicketGrouping(model)}
      ${this.#switch("printHeldWork", t("venue.print_held_work"), model.printHeldWork, (printHeldWork) =>
        void this.#save("printHeldWork", () => this.api.savePrintHeldWork(printHeldWork), {
          printHeldWork,
        }),
      )}
      <p class="hint" data-test="print-held-work-hint">${t("venue.print_held_work_hint")}</p>
      ${this.#fieldError("printHeldWork")} ${this.#releaseReminder(model)}
    </section>`;
  }

  #floor(model: VenueServiceSettingsView): TemplateResult {
    return html`<section data-test="floor-settings">
      ${this.#switch(
        "clearingWorkflow",
        t("venue.clearing_workflow"),
        model.clearingWorkflow,
        (clearingWorkflow) =>
          void this.#save("clearingWorkflow", () => this.api.saveClearingWorkflow(clearingWorkflow), {
            clearingWorkflow,
          }),
      )}
      <p class="hint" data-test="clearing-workflow-hint">${t("venue.clearing_workflow_hint")}</p>
      ${this.#fieldError("clearingWorkflow")}
    </section>`;
  }

  /** Blank is off. A stored value the list does not offer, which setup can bring in, is offered
   * too so the dropdown never shows another. */
  #releaseReminder(model: VenueServiceSettingsView) {
    const stored = model.releaseReminderMinutes;
    const choices =
      stored === null || REMINDER_MINUTES.includes(stored)
        ? REMINDER_MINUTES
        : [...REMINDER_MINUTES, stored].sort((a, b) => a - b);
    const shown = stored === null ? "" : String(stored);
    return html`<wt-combobox
      class="setting"
      name="releaseReminderMinutes"
      label=${t("venue.release_reminder")}
      hint=${t("venue.release_reminder_hint")}
      search="auto"
      placeholder=${t("venue.release_reminder.off")}
      searchPlaceholder=${t("venue.combobox_search")}
      noResultsLabel=${t("venue.combobox_no_results")}
      .options=${[
        { value: "", label: t("venue.release_reminder.off") },
        ...choices.map((minutes) => ({
          value: String(minutes),
          label: t("venue.release_reminder.minutes").replace("{n}", String(minutes)),
        })),
      ]}
      .value=${live(shown)}
      ?disabled=${this.busy}
      error=${this.fieldErrors.releaseReminderMinutes ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        const value = event.detail.value;
        if (value === shown) return;
        const releaseReminderMinutes = value === "" ? null : Number(value);
        void this.#save(
          "releaseReminderMinutes",
          () => this.api.saveReleaseReminderMinutes(releaseReminderMinutes),
          { releaseReminderMinutes },
        );
      }}
    ></wt-combobox>`;
  }

  #kitchenTicketGrouping(model: VenueServiceSettingsView) {
    const stored = model.kitchenTicketGrouping;
    return html`<wt-combobox
      class="setting"
      name="kitchenTicketGrouping"
      label=${t("venue.kitchen_ticket_grouping")}
      hint=${t("venue.kitchen_ticket_grouping_hint")}
      search="auto"
      searchPlaceholder=${t("venue.combobox_search")}
      noResultsLabel=${t("venue.combobox_no_results")}
      .options=${GROUPINGS.map((choice) => ({
        value: choice,
        label: t(`venue.kitchen_ticket_grouping.${choice}`),
      }))}
      .value=${live(stored)}
      ?disabled=${this.busy}
      error=${this.fieldErrors.kitchenTicketGrouping ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        if (event.detail.value === stored) return;
        const kitchenTicketGrouping = event.detail.value as KitchenTicketGrouping;
        void this.#save(
          "kitchenTicketGrouping",
          () => this.api.saveKitchenTicketGrouping(kitchenTicketGrouping),
          { kitchenTicketGrouping },
        );
      }}
    ></wt-combobox>`;
  }

  override render() {
    const messages = [
      ...(this.loadError ? [this.loadError] : []),
      ...Object.values(this.fieldErrors),
    ];
    return html`<div role="alert" data-test="page-alert">
        ${messages.map((message) => html`<p>${message}</p>`)}
      </div>
      ${
        this.model === undefined
          ? nothing
          : this.subject === "kitchen"
            ? this.#kitchen(this.model)
            : this.#floor(this.model)
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-venue-service-settings": ServiceSettingsPanel;
  }
}
```

Note the moved `editSentLines` switch had no `class="setting"`; `#switch` adds it to all three. If a moved test or the a11y suite reads spacing off that class, give `#switch` a `first` flag instead; otherwise leave it.

- [ ] **Step 5: Remove the tab from the Departments and zones screen**

In `venue-operations-screen.ts`:
- `VIEWS` → `["status", "departments", "zones"] as const`.
- Delete `GROUPINGS`, `REMINDER_MINUTES`, `#saveEditSentLines`, `#saveKitchenTicketGrouping`, `#saveReleaseReminderMinutes`, `#savePrintHeldWork`, `#kitchenChanges`, `#releaseReminder`, `#kitchenTicketGrouping`, the `{ key: "kitchen", … }` tab item and the `<div slot="kitchen">…</div>` line, and the `KitchenTicketGrouping` type import if now unused.
- Delete the `.setting` and `.hint` style rules and the `live` import only if nothing else in the file still uses them (`/usr/bin/grep -n 'class="setting"\|class="hint"\|live(' venue-operations-screen.ts`).
- Prune what only the four instant saves needed. With them gone, nothing writes `fieldErrors` while no editor is open: its other writers are `#submit` and the modal's re-check, which run only inside an open editor, and every way an editor closes or opens (`#open` ~186, `#close` ~190, a successful `#save` ~228) calls `#restart`, which empties it. So:
  - the `fieldErrors` doc comment (~125), "The open editor's check results, or with none open, the instant settings' refusals.", becomes "The open editor's check results.";
  - in `#pageAlert` (~1091), the no-editor branch drops `fieldErrors`: `...(this.editor ? [] : this.actionError ? [this.actionError] : [])`. Its doc comment ("a refusal of something saved at once") still holds for `actionError`, a list action's refusal, and stays.
  Re-read the file before deleting: if anything else now writes `fieldErrors` with no editor open, keep the branch and say why in the commit instead.

- [ ] **Step 6: Contribute the panels**

`packages/venue-service/src/dashboard/index.ts`: add `import "./service-settings-panel.js";` and, on `VENUE_SERVICE_DASHBOARD` after `moreScreens`:

```ts
  settingsPanels: [
    {
      id: "venue-service-kitchen",
      tab: "kitchen",
      order: 10,
      requiresPermission: "venue_service.manage",
      create(ctx) {
        const api = new VenueServiceApi(ctx.request, ctx.liveData);
        return {
          render: () =>
            html`<dashboard-venue-service-settings
              subject="kitchen"
              .api=${api}
            ></dashboard-venue-service-settings>`,
        };
      },
    },
    {
      id: "venue-service-floor",
      tab: "floor",
      requiresPermission: "venue_service.manage",
      create(ctx) {
        const api = new VenueServiceApi(ctx.request, ctx.liveData);
        return {
          render: () =>
            html`<dashboard-venue-service-settings
              subject="floor"
              .api=${api}
            ></dashboard-venue-service-settings>`,
        };
      },
    },
  ],
```

`index.test.ts`, add:

```ts
  it("adds a kitchen panel and a floor panel to Venue settings for managers of venue service", () => {
    expect(
      VENUE_SERVICE_DASHBOARD.settingsPanels!.map(({ id, tab, order, requiresPermission }) => ({
        id,
        tab,
        order,
        requiresPermission,
      })),
    ).toEqual([
      { id: "venue-service-kitchen", tab: "kitchen", order: 10, requiresPermission: "venue_service.manage" },
      { id: "venue-service-floor", tab: "floor", order: undefined, requiresPermission: "venue_service.manage" },
    ]);
  });

  it("renders the floor panel on the context's request and live data", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            settings: { editSentLines: true },
            kitchenTicketGrouping: "combined",
            printHeldWork: false,
            releaseReminderMinutes: 10,
            clearingWorkflow: true,
          }),
      } as Response),
    );
    const liveData = new LiveData();
    const handle = VENUE_SERVICE_DASHBOARD.settingsPanels![1]!.create({
      request: createRequest({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      liveData,
    });
    const container = document.createElement("div");
    document.body.append(container);
    containers.push(container);
    render(handle.render(), container);
    const panel = container.querySelector("dashboard-venue-service-settings")!;
    expect(panel.subject).toBe("floor");
    expect(panel.api.liveData).toBe(liveData);
    await vi.waitFor(() =>
      expect(panel.shadowRoot!.querySelector('wt-switch[name="clearingWorkflow"]')).not.toBeNull(),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "/management-api/venue-service",
      expect.objectContaining({ method: "GET" }),
    );
  });
```

- [ ] **Step 7: Run the package's dashboard suites**

Run: `pnpm --filter @waitron/venue-service typecheck && pnpm --filter @waitron/venue-service exec vitest run src/dashboard`
Expected: PASS — every moved assertion passes against the panel; the screen's remaining suites pass with three tabs.

- [ ] **Step 8: Check the panel inside the shell**

Add to `apps/dashboard/src/dashboard-app.test.ts`:

```ts
  it("shows venue service's kitchen panel after the core one, and its Floor tab, to a manager of venue service", async () => {
    history.replaceState(null, "", "/manage/venue-settings/view/kitchen");
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        ...meResponse,
        modules: ["bookings", "venue-service"],
        permissions: ["booking.manage", "venue_service.manage"],
      }),
    });
    // The kitchen panel renders `model.settings.editSentLines`, so it needs the real read's shape;
    // `stubRequest` answers `[]` for every path.
    const request: DashboardRequest = async (path, method, body, options) =>
      path === "/management-api/venue-service"
        ? ({
            departments: [],
            zones: [],
            deviceZones: [],
            hours: [],
            zoneMenus: [],
            readiness: [],
            settings: { editSentLines: true },
            kitchenTicketGrouping: "combined",
            printHeldWork: false,
            releaseReminderMinutes: 10,
            clearingWorkflow: false,
          } as never)
        : stubRequest(path, method, body, options);
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request });
    await flush(el);
    const page = venueSettings(el)!;
    const kitchen = page.shadowRoot!.querySelector('[slot="kitchen"]')!;
    expect([...kitchen.children].map((child) => child.tagName.toLowerCase())).toEqual([
      "dashboard-kitchen-screen",
      "dashboard-venue-service-settings",
    ]);
    expect(page.shadowRoot!.querySelector('[slot="floor"] dashboard-venue-service-settings')).not.toBeNull();
  });
```

The stubbed body is the shape `GET /management-api/venue-service` answers (`packages/venue-service/src/routes.ts` ~401-417, plus the `clearingWorkflow` Task 2 adds). `DashboardRequest` is already imported in that file.

Run: `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "venue service's kitchen panel"`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/venue-service/src/dashboard apps/dashboard/src/dashboard-app.test.ts
git commit -s -m "Venue service: its kitchen and floor settings move to Venue settings, with a switch for clearing tables"
```

---

### Task 7: Adjustment reasons become a Venue settings panel

**Files:**
- Modify: `packages/adjustments/src/dashboard/index.ts`, `index.test.ts`
- Modify: `packages/adjustments/src/dashboard/reasons-screen.ts:132-134, 946`, `reasons-screen.test.ts:364`
- Modify: `packages/adjustments/src/dashboard/strings.ts` (delete `nav.adjustment_reasons` if unused)
- Modify: `packages/dashboard-modules/src/registry.test.ts`

**Interfaces:**
- Consumes: `DashboardSettingsPanel` (Task 5).
- Produces: `ADJUSTMENTS_DASHBOARD.screen` = the report placement `{ id: "adjustment-report", navLabelKey: "nav.adjustment_report", group: "reports", requiresPermission: "report.view" }`, no `moreScreens`; `settingsPanels: [{ id: "adjustment-reasons", tab: "adjustment-reasons", requiresPermission: "adjustment.manage", create }]`.

- [ ] **Step 1: Change the tests**

`packages/adjustments/src/dashboard/index.test.ts`: replace `mounts the reasons screen in the service group for managers of adjustments` with:

```ts
  it("puts the reasons on Venue settings for managers of adjustments, and only the report in the nav", () => {
    expect(ADJUSTMENTS_DASHBOARD.module).toBe("adjustments");
    expect(ADJUSTMENTS_DASHBOARD.screen).toEqual({
      id: "adjustment-report",
      navLabelKey: "nav.adjustment_report",
      group: "reports",
      requiresPermission: "report.view",
    });
    expect(ADJUSTMENTS_DASHBOARD.moreScreens).toBeUndefined();
    expect(
      ADJUSTMENTS_DASHBOARD.settingsPanels!.map(({ id, tab, requiresPermission }) => ({
        id,
        tab,
        requiresPermission,
      })),
    ).toEqual([
      { id: "adjustment-reasons", tab: "adjustment-reasons", requiresPermission: "adjustment.manage" },
    ]);
  });
```

In `create() renders the screen on the context's request and live data`, change `ADJUSTMENTS_DASHBOARD.create({…})` to `ADJUSTMENTS_DASHBOARD.settingsPanels![0]!.create({…})` and rename the case `the reasons panel renders on the context's request and live data`. In `mounts the adjustment report…`, change `const report = ADJUSTMENTS_DASHBOARD.moreScreens![0]!;` to `const report = ADJUSTMENTS_DASHBOARD;`.

`reasons-screen.test.ts:364`: replace the `h1` assertion with

```ts
    expect(el.shadowRoot!.querySelector("h1")).toBeNull();
    expect(table(el).getAttribute("aria-label")).toBe("Motivos de ajuste");
```

(`table(el)` is that file's helper for the `wt-data-table`; the label is `adjustments.title`.)

`packages/dashboard-modules/src/registry.test.ts`: replace the two adjustments cases with:

```ts
  it("puts the adjustment reasons on Venue settings for managers of adjustments", () => {
    const adjustments = DASHBOARD_MODULES.find((c) => c.module === "adjustments");
    expect(adjustments?.settingsPanels?.map((panel) => [panel.tab, panel.requiresPermission])).toEqual([
      ["adjustment-reasons", "adjustment.manage"],
    ]);
  });

  it("registers the adjustment report in the reports group for anyone who may view reports", () => {
    const adjustments = DASHBOARD_MODULES.find((c) => c.module === "adjustments");
    expect(adjustments?.screen).toEqual({
      id: "adjustment-report",
      navLabelKey: "nav.adjustment_report",
      group: "reports",
      requiresPermission: "report.view",
    });
  });
```

In `apps/dashboard/src/dashboard-app.test.ts`, add a request stub that answers the reasons panel's two reads with their real shapes — `GET /management-api/adjustments/reasons?includeInactive=true` answers `{ reasons }` and `GET /management-api/adjustments/settings` answers `readAdjustmentSettings`'s `{ maxBillDiscountBp }` (`packages/adjustments/src/routes.ts` ~219-226 and ~262-265, `packages/adjustments/src/settings.ts` ~12-17) — and the retired-address case for the reasons screen, with adjustments enabled so the case can fail:

```ts
const adjustmentsRequest: DashboardRequest = async (path, method, body, options) =>
  path.startsWith("/management-api/adjustments/reasons")
    ? ({ reasons: [] } as never)
    : path === "/management-api/adjustments/settings"
      ? ({ maxBillDiscountBp: null } as never)
      : stubRequest(path, method, body, options);

  it("treats the retired address /manage/adjustment-reasons as an unknown screen", async () => {
    history.replaceState(null, "", "/manage/adjustment-reasons");
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        ...meResponse,
        modules: ["bookings", "adjustments"],
        permissions: ["booking.manage", "adjustment.manage", "report.view"],
      }),
      liveData: new LiveData(),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api,
      request: adjustmentsRequest,
    });
    await flush(el);
    expect(overview(el)).not.toBeNull();
    expect(location.pathname).toBe("/manage/overview");
  });
```

(`adjustmentsRequest` goes at the top level beside `stubRequest`; the case goes beside Task 4's retired-address `it.each`.)

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/adjustments exec vitest run src/dashboard/index.test.ts src/dashboard/reasons-screen.test.ts && pnpm --filter @waitron/dashboard-modules exec vitest run`
Expected: FAIL — `screen.id` is still `adjustment-reasons`; the reasons screen still has an `h1`.

Run: `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "retired address /manage/adjustment-reasons"`
Expected: FAIL — the adjustments module still owns that screen, so the reasons screen opens and the address stays `/manage/adjustment-reasons`.

- [ ] **Step 3: Reshape the contribution and drop the h1**

`packages/adjustments/src/dashboard/index.ts`:

```ts
export const ADJUSTMENTS_DASHBOARD: DashboardContribution = {
  module: "adjustments",
  screen: {
    id: "adjustment-report",
    navLabelKey: "nav.adjustment_report",
    group: "reports",
    requiresPermission: "report.view",
  },
  strings: ADJUSTMENTS_STRINGS,
  create(ctx) {
    const api = new AdjustmentsApi(ctx.request, ctx.liveData);
    return {
      render: () =>
        html`<dashboard-adjustment-report-screen
          .api=${api}
        ></dashboard-adjustment-report-screen>`,
    };
  },
  settingsPanels: [
    {
      id: "adjustment-reasons",
      tab: "adjustment-reasons",
      requiresPermission: "adjustment.manage",
      create(ctx) {
        const api = new AdjustmentsApi(ctx.request, ctx.liveData);
        return {
          render: () =>
            html`<dashboard-adjustment-reasons-screen
              .api=${api}
            ></dashboard-adjustment-reasons-screen>`,
        };
      },
    },
  ],
};
```

`reasons-screen.ts`: in `render()`, delete `<h1>${t("adjustments.title")}</h1>` (keep the intro paragraph first); delete the `h1 { margin-top: 0; }` style rule.

`strings.ts`: grep `nav.adjustment_reasons` across `packages apps`; if only its two definitions and `strings.test.ts` remain, delete both definitions and the test line that reads it.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm --filter @waitron/adjustments typecheck && pnpm --filter @waitron/adjustments exec vitest run src/dashboard && pnpm --filter @waitron/dashboard-modules exec vitest run && pnpm exec vitest run scripts/dashboard-browser-purity.test.ts`
Expected: PASS.

- [ ] **Step 5: Check it inside the shell**

Add to `apps/dashboard/src/dashboard-app.test.ts`:

```ts
  it("shows Adjustment reasons as a Venue settings tab to a manager of adjustments, and not in the nav", async () => {
    history.replaceState(null, "", "/manage/venue-settings/view/adjustment-reasons");
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        ...meResponse,
        modules: ["bookings", "adjustments"],
        permissions: ["booking.manage", "adjustment.manage", "report.view"],
      }),
      liveData: new LiveData(),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api,
      request: adjustmentsRequest,
    });
    await flush(el);
    expect(navItem(el, "adjustment-reasons")).toBeNull();
    expect(navItem(el, "adjustment-report")).not.toBeNull();
    expect(
      venueSettings(el)!.shadowRoot!.querySelector(
        '[slot="adjustment-reasons"] dashboard-adjustment-reasons-screen',
      ),
    ).not.toBeNull();
    expect(location.pathname).toBe("/manage/venue-settings/view/adjustment-reasons");
  });
```

Run: `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts -t "Adjustment reasons|adjustment-reasons"`
Expected: PASS — this case and Step 1's retired-address case. Both use `adjustmentsRequest` (Step 1), because the reasons panel reads `body.reasons` and the discount limit on connect, and `stubRequest`'s `[]` would hand it `undefined`.

- [ ] **Step 6: Commit**

```bash
git add packages/adjustments/src/dashboard packages/dashboard-modules/src/registry.test.ts apps/dashboard/src/dashboard-app.test.ts
git commit -s -m "Adjustments: the reasons and the bill discount limit move to Venue settings; the report stays in Reporting"
```

---

### Task 8: The sidebar gets a Venue operations group, and an empty group draws no header

**Files:**
- Modify: `apps/dashboard/src/dashboard-app.ts` (types ~144-156; `NAV_GROUPS`; `#shownNav` ~1488-1521)
- Modify: `packages/venue-service/src/dashboard/index.ts`, `index.test.ts`, `strings.ts`
- Modify: `apps/dashboard/src/i18n/strings.ts` (`nav.group.operations`)
- Test: `apps/dashboard/src/dashboard-app.test.ts`, `dashboard-app.module-order.test.ts`, `dashboard-app.module-screens.test.ts` (only if a case names the service group's core items)

**Interfaces:**
- Consumes: everything above.
- Produces: nav group id `operations` (header key `nav.group.operations`); `NavGroup.itemsAmongModules?: (NavItem & { order: number })[]`; venue-service placements `{ id: "venue-operations", navLabelKey: "nav.departments_zones", group: "operations", order: 10 }` and `{ id: "prep-stations", …, group: "operations", order: 30 }`; Floor plan at order 20.

- [ ] **Step 1: Write the failing tests**

In `apps/dashboard/src/dashboard-app.test.ts`:

1. `NAV_GROUP_KEYS`: becomes `["nav.group.reports", "nav.group.service", "nav.group.menu", "nav.group.operations", "nav.group.team", "nav.group.purchasing", "nav.group.configuration"]`.
2. Replace `files every enabled module the session may use into its group, after the core items` with:

```ts
  it("orders the groups as the spec does, and files Venue operations' pages among its modules' pages", async () => {
    const api = stubApi({
      getMe: vi.fn().mockResolvedValue({
        ...meResponse,
        modules: ["bookings", "venue-service"],
        permissions: ["booking.manage", "venue_service.manage"],
      }),
    });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    const items = (group: string) =>
      [
        ...el.shadowRoot!.querySelectorAll<HTMLElement>(`#nav-group-panel-${group} [data-test]`),
      ].map((item) => item.dataset.test);
    expect(
      [...el.shadowRoot!.querySelectorAll<HTMLElement>("button.nav-group")].map(
        (header) => header.dataset.test,
      ),
    ).toEqual([
      "nav-group-reports",
      "nav-group-service",
      "nav-group-menu",
      "nav-group-operations",
      "nav-group-team",
      "nav-group-purchasing",
      "nav-group-configuration",
    ]);
    expect(items("service")).toEqual(["nav-bookings"]);
    expect(items("operations")).toEqual([
      "nav-venue-operations",
      "nav-floor",
      "nav-prep-stations",
      "nav-venue-settings",
    ]);
    expect(navItem(el, "venue-operations")!.textContent!.trim()).toBe("Departamentos y zonas");
    expect(items("configuration")).not.toContain("nav-venue-settings");
  });

  it.each([
    ["Bookings is not enabled", { modules: [], permissions: ["booking.manage"] }],
    ["the session may not open Bookings", { modules: ["bookings"], permissions: [] }],
  ])("draws no Service header when %s", async (_label, me) => {
    const api = stubApi({ getMe: vi.fn().mockResolvedValue({ ...meResponse, ...me }) });
    const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request: stubRequest });
    await flush(el);
    expect(el.shadowRoot!.querySelector('[data-test="nav-group-service"]')).toBeNull();
    expect(el.shadowRoot!.querySelector("#nav-group-panel-service")).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-test="nav-group-operations"]')).not.toBeNull();
  });
```

3. In `describe("the nav search")`, the cleared-term case (~4979) expects headers `["nav-group-reports", "nav-group-service", "nav-group-menu", "nav-group-operations", "nav-group-team", "nav-group-purchasing", "nav-group-configuration"]`; and add:

```ts
  it("finds the moved pages under Venue operations", async () => {
    const el = await mountSession(sessionIn("en-GB"));
    await search(el, "venue");
    expect(shownHeaders(el)).toEqual(["nav-group-operations"]);
    expect(shownItems(el)).toEqual(["nav-floor", "nav-venue-settings"]);
  });
```

   ("venue" matches the group's own header "Venue operations", so every page of the group this session may open shows: Floor plan and Venue settings, the venue-service pages being outside this session's modules.)
4. Rewrite two of Task 4's cases, which name the Settings group:
   - `offers a manager Venue settings in Settings, opening on its Receipts tab` (Task 4 Step 2 item 7): rename it `offers a manager Venue settings in Venue operations, opening on its Receipts tab`, and change `querySelector("#nav-group-panel-configuration")` to `querySelector("#nav-group-panel-operations")`. Everything else in it stays.
   - `offers Content languages in Settings, after Venue settings, …` (Task 4 Step 2 item 9): with Venue settings gone from Settings, `order.indexOf("nav-venue-settings")` is -1, so `indexOf(...) + 1` is 0 and the check would hold for any first item without testing the neighbour. Rename it `offers Content languages first in Settings, to a session holding person.manage, and opens its page`, and replace `expect(order.indexOf("nav-content-languages")).toBe(order.indexOf("nav-venue-settings") + 1);` with `expect(order[0]).toBe("nav-content-languages");`.
5. Any case that opens `/manage/floor` and checks its group: the group is now `operations`. Run `/usr/bin/grep -n "nav-group-service\|group-panel-service" apps/dashboard/src/dashboard-app.test.ts` and keep the bookings-based ones (`starts with a module page's group expanded…` still opens Bookings in Service).

`dashboard-app.module-order.test.ts`: the mocked modules use group `service`, which now has no core item: expected list becomes `["nav-unordered", "nav-first", "nav-second"]`. Add a second case proving interleaving:

```ts
it("sorts a group's core items among its module items by their order", async () => {
  const list = DASHBOARD_MODULES as unknown as DashboardContribution[];
  const original = [...list];
  list.length = 0;
  list.push(
    { ...contribution("before", 19), screen: { ...contribution("before", 19).screen, group: "operations" } },
    { ...contribution("after", 21), screen: { ...contribution("after", 21).screen, group: "operations" } },
  );
  try {
    const { el } = await mountWidget<DashboardApp>("dashboard-app", {
      api: stubApi(["before", "after"]),
      request: async () => [] as never,
    });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("#nav-group-panel-operations [data-test=nav-after]")).not.toBeNull(),
    );
    expect(
      [...el.shadowRoot!.querySelectorAll<HTMLElement>("#nav-group-panel-operations [data-test]")].map(
        (item) => item.dataset.test,
      ),
    ).toEqual(["nav-before", "nav-floor", "nav-after", "nav-venue-settings"]);
  } finally {
    list.length = 0;
    list.push(...original);
  }
});
```

   For this, import `DASHBOARD_MODULES` from `@waitron/dashboard-modules` in that file, and change `stubApi()` to take `modules: string[] = ["second", "unordered", "first"]` and pass it into `getMe`'s `modules`, adding to its stub `getFireControl`, `getBumpMode`, `listCourses`, `listStatuses` resolving as in Task 4 (the core panels make those reads only when the page is open — they are listed so a later change that opens it does not hide a rejection).

`packages/venue-service/src/dashboard/index.test.ts`: in `mounts venue operations in the service navigation group`, expect

```ts
    expect(VENUE_SERVICE_DASHBOARD.screen).toEqual({
      id: "venue-operations",
      navLabelKey: "nav.departments_zones",
      group: "operations",
      order: 10,
      requiresPermission: "venue_service.manage",
    });
    expect(VENUE_SERVICE_DASHBOARD.strings.en["nav.departments_zones"]).toBe("Departments and zones");
    expect(VENUE_SERVICE_DASHBOARD.strings.es["nav.departments_zones"]).toBe("Departamentos y zonas");
```

   (rename the case `places Departments and zones first in the Venue operations group`), and in `opens Prep stations…` expect `group: "operations", order: 30`.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts src/dashboard-app.module-order.test.ts && pnpm --filter @waitron/venue-service exec vitest run src/dashboard/index.test.ts`
Expected: FAIL — no `operations` group; the Service header still shows with no pages; the venue-service placements still name `service`; Venue settings is still in Settings, so the two rewritten Task 4 cases fail too (Content languages is second there, not first).

- [ ] **Step 3: Regroup**

`apps/dashboard/src/dashboard-app.ts`:

1. `NavGroup`:

```ts
type NavGroup = {
  id: NavGroupId;
  headerKey?: StringKey;
  icon?: string;
  items: NavItem[];
  /** Sorted together with the group's module pages by `order`; a tie keeps the core item first. */
  itemsAmongModules?: (NavItem & { order: number })[];
  itemsAfterModules?: NavItem[];
};

const coreItems = (group: NavGroup): NavItem[] => [
  ...group.items,
  ...(group.itemsAmongModules ?? []),
  ...(group.itemsAfterModules ?? []),
];
```

2. `NAV_GROUPS`:

```ts
const NAV_GROUPS: NavGroup[] = [
  { id: "overview", items: [{ screen: "overview", labelKey: "nav.overview" }] },
  {
    id: "reports",
    headerKey: "nav.group.reports",
    items: [
      { screen: "sales", labelKey: "nav.sales" },
      { screen: "vat-return", labelKey: "nav.vat_return", requiresPermission: "report.export" },
    ],
    itemsAfterModules: [{ screen: "orders", labelKey: "nav.orders" }],
  },
  { id: "service", headerKey: "nav.group.service", items: [] },
  {
    id: "menu",
    headerKey: "nav.group.menu",
    items: [
      { screen: "catalogue", labelKey: "nav.catalogue" },
      { screen: "menus", labelKey: "nav.menus", requiresManager: true },
      { screen: "modifiers", labelKey: "nav.modifiers", requiresManager: true },
      { screen: "units", labelKey: "nav.units" },
    ],
  },
  {
    id: "operations",
    headerKey: "nav.group.operations",
    items: [],
    itemsAmongModules: [{ screen: "floor", labelKey: "nav.floor", order: 20 }],
    itemsAfterModules: [
      { screen: "venue-settings", labelKey: "nav.venue_settings" },
    ],
  },
  // team, purchasing: unchanged
  // configuration: unchanged except that the venue-settings item added in Task 4 is removed
];
```

3. `#shownNav`, replacing the `NAV_GROUPS.map(…)` body:

```ts
    return NAV_GROUPS.map((group) => {
      const among = [
        ...(group.itemsAmongModules ?? [])
          .filter((item) => this.#mayOpen(item))
          .map((item) => ({
            order: item.order,
            page: { screen: item.screen, label: t(item.labelKey) },
          })),
        ...(this.#navGroups.get(group.id) ?? []).map((screen) => ({
          order: screen.order ?? 0,
          page: { screen: screen.id, label: tKit(screen.navLabelKey) },
        })),
      ]
        .sort((a, b) => a.order - b.order)
        .map(({ page }) => page);
      const permitted: NavPage[] = [
        ...shown(group.items),
        ...among,
        ...shown(group.itemsAfterModules),
      ];
      if (term === "") return { group, pages: permitted.length > 0 ? permitted : undefined };
      const headerMatches =
        group.headerKey !== undefined && foldForSearch(t(group.headerKey)).includes(term);
      const pages = headerMatches
        ? permitted
        : permitted.filter((page) => foldForSearch(page.label).includes(term));
      return { group, pages: pages.length > 0 ? pages : undefined };
    });
```

   and update its doc comment: "`pages` is undefined for a group with nothing to show — no page this person may open, or none matching the search — and such a group draws no header."

4. `apps/dashboard/src/i18n/strings.ts`: `"nav.group.operations": "Venue operations",` and `"nav.group.operations": "Operaciones del local",` beside the other `nav.group.*` keys.

`packages/venue-service/src/dashboard/index.ts`: the first screen becomes `{ id: "venue-operations", navLabelKey: "nav.departments_zones", group: "operations", order: 10, requiresPermission: "venue_service.manage" }`; Prep stations becomes `{ id: "prep-stations", navLabelKey: "nav.prep_stations", group: "operations", order: 30, requiresPermission: "venue_service.manage" }`.

`packages/venue-service/src/dashboard/strings.ts`: rename `"nav.venue_operations"` to `"nav.departments_zones"` in both blocks with values `"Departments and zones"` / `"Departamentos y zonas"`; set `"venue.title"` to the same two values (Decision C). Then run `/usr/bin/grep -rn "Venue operations\|Operaciones del local\|nav.venue_operations" packages/venue-service/src apps/dashboard/src` and update any test expecting the old heading or tab-strip label to the new words.

- [ ] **Step 4: Run them and see them pass**

Run: `pnpm --filter @waitron/dashboard typecheck && pnpm --filter @waitron/venue-service typecheck && pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts src/dashboard-app.module-order.test.ts src/dashboard-app.module-screens.test.ts src/dashboard-app.settings-panels.test.ts src/dashboard-app.a11y.test.ts && pnpm --filter @waitron/venue-service exec vitest run src/dashboard`
Expected: PASS. If `module-screens.test.ts`'s first case lists the Service group's items, its expectation for `#nav-group-panel-service` becomes `["nav-widgets"]`.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src packages/venue-service/src/dashboard
git commit -s -m "Dashboard sidebar: a Venue operations group holds Departments and zones, Floor plan, Prep stations and Venue settings; an empty group draws no header"
```

---

### Task 9: Retire the stale words in the docs, and run the final checks

**Files:**
- Modify: `docs/developers/design-system.md` (~275-294, 504, 1505, 1600, 1612, 1259-1300 nav section, 1880-1890 example, 1964-1966)
- Modify: `docs/developers/conventions-ui.md:182-185`
- Modify: `docs/developers/testing-guide.md:955-960` (check)
- Modify: `docs/content-and-images.md:63`
- Modify: `docs/backlog.md` (~2038; ~2994; ~4295-4297; the C113 entry ~4622, ~4640, ~4673, ~4694; ~7512; the A261 entry)

**Interfaces:** none.

- [ ] **Step 1: Find every stale sentence**

Run:

```bash
/usr/bin/grep -rn -i "receipts page\|\*\*receipts\*\* page\|kitchen screen\|kitchen page\|statuses page\|statuses screen\|changes after sending\|venue operations screen\|adjustment reasons\|/manage/kitchen\|/manage/receipts\|/manage/statuses\|nav.venue_operations\|Service group\|stations are set up on prep" docs README.md apps/*/README.md packages/*/README.md CLAUDE.md | /usr/bin/grep -v "docs/superpowers\|docs/handoffs"
```

Read each hit in context (CLAUDE.md §1: a behaviour change retires every receipt about the old behaviour; read the paragraph, not the line).

- [ ] **Step 2: Update each one**

- `design-system.md` ~1964-1966: replace "Venue operations uses `status`, `departments`, `zones` and `kitchen` (Changes after sending)." with "Departments and zones (`/manage/venue-operations`) uses `status`, `departments` and `zones`. Venue settings (`/manage/venue-settings`) uses `receipts`, `table-statuses`, `adjustment-reasons`, `kitchen` and `floor`; a tab shows only when a panel on it is visible to the session, and an address naming a tab the session does not see shows the first one it does."
- `design-system.md` ~1505 ("on the Kitchen screen"): "on Venue settings' Kitchen tab".
- `design-system.md` ~504 ("the Venue operations screen's Tills table"): "the Departments and zones screen's Tills table" (the table is still there: `venue-operations-screen.ts` ~729 renders `venue.tills`).
- `design-system.md` ~280 and ~292-294 name `venue-operations-screen.test.ts` and "the venue operations screen"; the file names stand, the screen's name becomes "Departments and zones".
- `design-system.md` ~1887 example `label="Venue operations"`: `label="Departments and zones"`.
- `design-system.md` "Dashboard sidebar navigation": add after the paragraph on headed groups: "A group with no page this session may open draws no header at all, as a group the search empties does. A group can mix module pages and core pages: core items listed in `itemsAmongModules` carry an `order` and sort among the group's module pages (a tie keeps the core item first) — Venue operations uses this."
- `design-system.md` "Tabbed management pages" (after the paragraph on nested strips): "A page whose tabs are filled by panels from several owners — Venue settings — owns the page's only `h1`; its panels draw none, because each tab panel is already named by its tab (`aria-labelledby`)."
- `conventions-ui.md` ~182: "The Venue operations regression" → "The Departments and zones screen's regression".
- `testing-guide.md` ~957-959: file names unchanged; edit only if the surrounding sentence names the screen.
- `docs/content-and-images.md:63`: "on the **Receipts** page" → "on the **Receipts** tab of **Venue settings**".
- `docs/backlog.md`: ~2038 "the venue operations kitchen tab's two dropdown explanations" → "the two dropdown explanations on venue service's Kitchen panel of Venue settings"; ~4295-4297, item (c), "a refused save of a venue operations setting that saves at once shows twice, beside the control and in the screen's alert (`#pageAlert`, `packages/venue-service/src/dashboard/venue-operations-screen.ts`), and existing tests pin both" → "a refused save of a venue service setting that saves at once shows twice, beside the control and in the panel's alert (`render`, `packages/venue-service/src/dashboard/service-settings-panel.ts`), and existing tests pin both (`service-settings-panel.test.ts`)" — Task 6 moved that behaviour and its tests to the panel; in the C113 entry (~4622) "It is set on the **Receipts** page" → "on Venue settings' **Receipts** tab", and the same entry's three other mentions — ~4640 "setup and the Receipts page says", ~4673 "is not shown on the Receipts page", ~4694 "the Receipts page shows it" — "the Receipts page" → "the Receipts tab of Venue settings"; ~2994 "Venue operations' **Changes after sending** tab" → "Venue settings' **Kitchen** tab"; ~7512 "the dashboard's **Receipts** page" → "the dashboard's Venue settings **Receipts** tab"; in the A261 entry, mark step 1 done with "_(Step 1 landed: navigation and Venue settings, PR #<n>.)_" — the PR number is filled in by `/finish-branch`.

`docs/` is ignored by Prettier, so `prettier --check` says nothing about these files (CLAUDE.md §2); re-read each edited paragraph by eye.

- [ ] **Step 3: Format, lint, typecheck and the focused tests**

Check free memory first (`memory_pressure | grep free`). Then:

```bash
pnpm format:check
git diff --name-only main...HEAD -- '*.ts' | xargs pnpm exec eslint
pnpm --filter @waitron/server --filter @waitron/dashboard --filter @waitron/dashboard-kit --filter @waitron/dashboard-modules --filter @waitron/venue-service --filter @waitron/adjustments typecheck
pnpm exec vitest run scripts/live-subscriptions.test.ts scripts/module-seams.test.ts scripts/dashboard-browser-purity.test.ts scripts/native-form-fields.test.ts scripts/claude-md-pointers.test.ts
pnpm --filter @waitron/server exec vitest run src/management-api.test.ts
pnpm --filter @waitron/venue-service exec vitest run src/routes.test.ts src/dashboard
pnpm --filter @waitron/adjustments exec vitest run src/dashboard
pnpm --filter @waitron/dashboard-modules exec vitest run
pnpm --filter @waitron/dashboard exec vitest run src/dashboard-app.test.ts src/dashboard-app.a11y.test.ts src/dashboard-app.module-order.test.ts src/dashboard-app.module-screens.test.ts src/dashboard-app.settings-panels.test.ts src/screens/venue-settings-screen.test.ts src/screens/venue-settings-screen.a11y.test.ts src/screens/kitchen-screen.test.ts src/screens/kitchen-screen.a11y.test.ts src/screens/service-status-screen.test.ts src/screens/service-status-screen.a11y.test.ts src/screens/receipts-screen.test.ts src/screens/receipts-screen.trim.test.ts src/screens/receipts-screen.language.test.ts src/screens/receipts-screen.location.test.ts src/screens/receipts-screen.a11y.test.ts src/api/client-routes.test.ts src/api/live-queries.test.ts
```

Run each line on its own and read each exit status (CLAUDE.md §2: a newline-separated sequence reports only its last status). Every one must exit 0. This is the focused set, not a whole-workspace run; CI runs the package suites and coverage.

- [ ] **Step 4: Look at the page**

Start the dev stack from this worktree with `wa-wt demo waitron-a261-1-venue-settings` (`wa-wt` matches the worktree directory's name exactly), sign in as a manager, and open Venue settings: check each tab in light and dark theme and at phone width (390px), that the Kitchen tab shows courses, bump mode (on the stored value), fire control and then "Changes after sending", that Floor shows the one switch, and that the sidebar reads Overview, Reporting, Service, Products and menus, Venue operations, Team, Purchasing, Settings. Record what you saw in the ledger; a string-only assertion cannot show that a page renders (CLAUDE.md §4).

- [ ] **Step 5: Commit**

```bash
git add docs/developers/design-system.md docs/developers/conventions-ui.md docs/developers/testing-guide.md docs/content-and-images.md docs/backlog.md
git commit -s -m "Docs: Venue settings, the Venue operations group and the Departments and zones name replace the old pages"
```

Then tell the owner the branch is ready for `/finish-branch` (this branch touches a cross-package contract, `packages/dashboard-kit/src/contract.ts`, so it takes the full review path).

---

## Self-review

- **Spec coverage (§11 step 1):** sidebar moves — Task 8; Venue settings with tabs — Tasks 3-5; Receipts and the receipt language on the Receipts tab — Task 4 (the existing Receipts screen already holds the language picker; one language per location, C113); Kitchen — Tasks 1, 4, 6; Table statuses — Task 4; Adjustment reasons — Task 7; Floor — Tasks 2, 6. Venue details (§3) is step 7, Hours step 5: no task, by design. §5's header-line and trading-name sentences wait for step 2 (decision J). The spec's "Statuses page goes", "Kitchen page goes", "Receipts page goes" and the "Changes after sending" tab's removal — Tasks 4 and 6. The Status (readiness) tab stays (decision 6).
- **Placeholders:** the only deferred value is the PR number in the backlog line, filled by `/finish-branch`.
- **Type consistency:** `VenueSettingsPanel { key, tab, render }` (Task 3) is what `#settingsPanels` returns (Tasks 4-5, plus `order`); `DashboardSettingsPanel { id, tab, order?, requiresPermission, create }` (Task 5) is what Tasks 6 and 7 contribute; `VenueServiceSettingsView` and `loadSettings`/`saveClearingWorkflow` (Task 2) are what Task 6's panel calls; `QUERY_DEPENDENCIES.settings` (Task 2) is what the panel watches.
- **Review Focus lines and their tests:** 1 — Task 3 `it.each` of replaced addresses and Task 5 "leaves out a panel…"; 2 — Task 5 (the disabled `gadgets` module); 3 — Task 5 order case and Task 6 Step 8; 4 — Task 4 `allH1` and the a11y case; 5 — Task 8 `it.each` "draws no Service header"; 6 — Task 3 "draws only its heading when no panel is visible"; the sidebar item is not hidden for such a session in this step (decision I), so nothing tests that.
