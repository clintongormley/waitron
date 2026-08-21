import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { FloorTable } from "../floor.js";
import "./wt-floor-canvas.js";

afterEach(cleanup);

interface Canvas extends HTMLElement {
  tables: FloorTable[];
  editable: boolean;
  gridSnap: boolean;
  updateComplete: Promise<unknown>;
}

const tables: FloorTable[] = [
  {
    id: "t1",
    label: "1",
    capacity: 2,
    posX: 200,
    posY: 300,
    shape: "round",
    rotation: 0,
    zoneId: "terrace",
    state: "free",
    pendingToServe: 0,
    status: null,
  },
  {
    id: "t2",
    label: "2",
    capacity: 6,
    posX: 700,
    posY: 600,
    shape: "rect",
    rotation: 15,
    zoneId: "terrace",
    state: "open-tab",
    tabTotal: "47.50",
    pendingToServe: 3,
    status: { id: "s1", label: "Reservada", color: "rgb(120, 90, 200)" },
  },
];

async function mountCanvas(
  theme: "light" | "dark",
  props: { editable?: boolean } = {},
): Promise<Canvas> {
  const el = (await mountThemed("<wt-floor-canvas></wt-floor-canvas>", theme)) as Canvas;
  el.tables = tables;
  if (props.editable) el.editable = true;
  await el.updateComplete;
  return el;
}

describe.each(["light", "dark"] as const)("wt-floor-canvas a11y (%s theme)", (theme) => {
  test("view mode: placed tables are labelled and reachable", async () => {
    await mountCanvas(theme);
    await expectNoA11yViolations(host);
  });

  test("edit mode: the selection inspector is fully accessible", async () => {
    const el = await mountCanvas(theme, { editable: true });
    // Open the inspector on a table so its palette / zone / actions are in the tree.
    el.shadowRoot!.querySelector<HTMLElement>('[data-table="t2"]')!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector(".inspector")).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
