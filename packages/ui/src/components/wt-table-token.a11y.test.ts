import { afterEach, describe, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { FloorTable } from "../floor.js";
import "./wt-table-token.js";

afterEach(cleanup);

interface Token extends HTMLElement {
  table: FloorTable;
  labels: { covers?: string; toServe?: string; reserved?: string; forgotten?: string };
  updateComplete: Promise<unknown>;
}

/** A fully-typed floor table; overrides tweak the occupancy/status fields a case exercises. */
function tableData(overrides: Partial<FloorTable> = {}): FloorTable {
  return {
    id: "t1",
    label: "4",
    capacity: 4,
    posX: 500,
    posY: 500,
    shape: "round",
    rotation: 0,
    zoneId: null,
    state: "free",
    pendingToServe: 0,
    status: null,
    ...overrides,
  };
}

/** Mounts a themed token and assigns its `.table`/`.labels` (the element renders `nothing` until the
 *  table prop is set, so a second `updateComplete` is awaited after assignment). */
async function mountToken(t: FloorTable, theme: "light" | "dark"): Promise<Token> {
  const el = (await mountThemed("<wt-table-token></wt-table-token>", theme)) as Token;
  el.table = t;
  el.labels = { covers: "plazas", toServe: "por servir", reserved: "Reservada" };
  await el.updateComplete;
  return el;
}

// The canvas a11y suite covers the token AS DRAWN ON THE MAP; this is the primitive-specific check the
// canvas suite does not replace — the token contrast/labelling on its own, across both themes.
describe.each(["light", "dark"] as const)("wt-table-token a11y (%s theme)", (theme) => {
  test("a rich open-tab token (total + to-serve badge + status badge) is accessible", async () => {
    // The busiest variant: state accent, running total, the to-serve badge, and a DATA-coloured manual
    // status badge (whose arbitrary colour rides an inline border/swatch, never the text background).
    await mountToken(
      tableData({
        state: "open-tab",
        tabTotal: "47.50",
        pendingToServe: 3,
        reservedTime: "20:30",
        status: { id: "s1", label: "Reservada", color: "rgb(120, 90, 200)" },
      }),
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("a free token with no capacity and no badges is accessible", async () => {
    await mountToken(tableData({ state: "free", capacity: null }), theme);
    await expectNoA11yViolations(host);
  });

  test("a delivery-pending token is accessible", async () => {
    await mountToken(tableData({ state: "delivery-pending", pendingToServe: 2 }), theme);
    await expectNoA11yViolations(host);
  });

  // KDS order-timing alerts (design §7.3, fix round 1): the map/canvas token's order-timing accent +
  // forgotten marker, across both themes — the a11y case the LIST-card suite cannot cover.
  test("a warm-band token (steady accent, no marker) is accessible", async () => {
    await mountToken(tableData({ state: "open-tab", timingBand: "warm" }), theme);
    await expectNoA11yViolations(host);
  });

  test("a forgotten-band token with a DECORATIVE marker (no consumer label) is accessible", async () => {
    await mountToken(tableData({ state: "open-tab", timingBand: "forgotten" }), theme);
    await expectNoA11yViolations(host);
  });

  test("a forgotten-band token with a LABELLED marker (app-supplied accessible name) is accessible", async () => {
    const el = await mountToken(tableData({ state: "open-tab", timingBand: "forgotten" }), theme);
    el.labels = { ...el.labels, forgotten: "Olvidada" };
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
