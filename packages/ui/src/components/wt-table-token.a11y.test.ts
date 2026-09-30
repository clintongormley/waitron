import { afterEach, describe, expect, test } from "vitest";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import type { FloorTable } from "../floor.js";
import "./wt-table-token.js";

afterEach(cleanup);

interface Token extends HTMLElement {
  table: FloorTable;
  labels: {
    covers?: string;
    toServe?: string;
    reserved?: string;
    forgotten?: string;
    unsent?: string;
    fireDue?: string;
  };
  updateComplete: Promise<unknown>;
}

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

/** The token renders nothing until `.table` is set, hence the second `updateComplete`. */
async function mountToken(t: FloorTable, theme: "light" | "dark"): Promise<Token> {
  const el = (await mountThemed("<wt-table-token></wt-table-token>", theme)) as Token;
  el.table = t;
  el.labels = { covers: "plazas", toServe: "por servir", reserved: "Reservada" };
  await el.updateComplete;
  return el;
}

describe.each(["light", "dark"] as const)("wt-table-token a11y (%s theme)", (theme) => {
  test("a rich open-tab token (total + to-serve badge + status badge) is accessible", async () => {
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

  test("a warm-band token (steady accent, no marker) is accessible", async () => {
    await mountToken(tableData({ state: "open-tab", timingBand: "warm" }), theme);
    await expectNoA11yViolations(host);
  });

  test("a forgotten-band token with a DECORATIVE marker (no consumer label) is accessible", async () => {
    await mountToken(tableData({ state: "open-tab", timingBand: "forgotten" }), theme);
    await expectNoA11yViolations(host);
  });

  test("a token with an unsent-order mark naming two people is accessible", async () => {
    const el = await mountToken(
      tableData({ state: "open-tab", tabTotal: "12.00", unsentDrafts: ["Alex", "Sam"] }),
      theme,
    );
    el.labels = { ...el.labels, unsent: "Sin enviar" };
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });

  test("a token with an unsent-order mark naming people but given no label is accessible", async () => {
    await mountToken(
      tableData({ state: "open-tab", tabTotal: "12.00", unsentDrafts: ["Alex", "Sam"] }),
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("a token with a DECORATIVE unsent-order mark (no label, no names) is accessible", async () => {
    await mountToken(
      tableData({ state: "open-tab", tabTotal: "12.00", unsentDrafts: [""] }),
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("a token whose party's reminder is due, with the chip's words, is accessible", async () => {
    const el = await mountToken(
      tableData({ state: "open-tab", tabTotal: "12.00", pendingToServe: 2, fireDue: true }),
      theme,
    );
    el.labels = { ...el.labels, fireDue: "Fire now" };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-fire-due]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("a token whose party's reminder is due, with a DECORATIVE chip (no label), is accessible", async () => {
    const el = await mountToken(
      tableData({ state: "open-tab", tabTotal: "12.00", fireDue: true }),
      theme,
    );
    expect(el.shadowRoot!.querySelector("[data-fire-due]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  test("a token carrying a chip of every tone is accessible", async () => {
    const el = await mountToken(
      tableData({
        state: "open-tab",
        tabTotal: "12.00",
        chips: [
          { key: "take-order", text: "Take order", tone: "primary" },
          { key: "ready", text: "Bar: 3 ready", tone: "success" },
          { key: "wait", text: "Waiting", tone: "warning" },
          { key: "unavailable", text: "Unavailable: Steak", tone: "danger" },
          { key: "bill", text: "Bill requested", tone: "primary-filled" },
        ],
      }),
      theme,
    );
    expect(el.shadowRoot!.querySelectorAll("[data-chip]").length).toBe(5);
    await expectNoA11yViolations(host);
  });

  test("a token naming the party seated there is accessible", async () => {
    await mountToken(tableData({ state: "open-tab", tabTotal: "12.00", partyName: "Ana" }), theme);
    await expectNoA11yViolations(host);
  });

  test("a forgotten-band token with a LABELLED marker (app-supplied accessible name) is accessible", async () => {
    const el = await mountToken(tableData({ state: "open-tab", timingBand: "forgotten" }), theme);
    el.labels = { ...el.labels, forgotten: "Olvidada" };
    await el.updateComplete;
    await expectNoA11yViolations(host);
  });
});
