import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { TableState, TableToday } from "../api/client.js";
import "./reset-table-dialog.js";
import type { ResetTableDetail, TillResetTableDialog } from "./reset-table-dialog.js";

function today(seats: number, over: Partial<TableToday> = {}): TableToday {
  return {
    placement: { x: 0, y: 0, width: 2, height: 2, shape: "rect", rotation: 0 },
    seats,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    inJoinedTable: null,
    joined: null,
    splitOffFrom: null,
    zoneRevision: 0,
    ...over,
  };
}
function table(id: string, label: string, todayRow: TableToday): TableState {
  return {
    id,
    label,
    zoneId: "z1",
    state: "free",
    condition: "free",
    hasOpenTab: false,
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    enRoute: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: todayRow,
    signals: [],
    party: null,
  };
}
const joined = table(
  "long",
  "Long table",
  today(2, { joined: { parts: ["c3"], splitOff: ["c4", "c5"], apart: true } }),
);
const apart = [
  {
    table: table("c5", "Counter 5", today(4, { splitOffFrom: "long" })),
    reason: "guests" as const,
  },
];

class ResetTableLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  confirmed: ResetTableDetail[] = [];
  override render() {
    return html`<till-reset-table-dialog
        .joined=${joined}
        .apart=${apart}
        @reset-table-cancel=${() => this.closes++}
        @reset-table-confirm=${(e: CustomEvent<ResetTableDetail>) => this.confirmed.push(e.detail)}
      ></till-reset-table-dialog
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("reset-table-leave-test-app", ResetTableLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

async function mount() {
  const { el: app } = await mountWidget<ResetTableLeaveApp>("reset-table-leave-test-app", {});
  const form = app.shadowRoot!.querySelector<TillResetTableDialog>("till-reset-table-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function typeSeats(form: TillResetTableDialog, value: string) {
  const input = form
    .shadowRoot!.querySelector("wt-number-stepper")!
    .shadowRoot!.querySelector<HTMLInputElement>("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await form.updateComplete;
}
function cancel(form: TillResetTableDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-reset-table-cancel]")!.click();
}
async function question(app: ResetTableLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function unload() {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

it("closing with seats typed asks first", async () => {
  const { app, form } = await mount();
  await typeSeats(form, "8");
  expect(unload()).toBe(true);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(form.shadowRoot!.querySelector("wt-number-stepper")!.value).toBe("8");
  expect(app.closes).toBe(0);
  cancel(form);
  await question(app);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => app.closes).toBe(1);
  expect(app.confirmed).toEqual([]);
  expect(unload()).toBe(false);
});

it("closing untouched does not ask", async () => {
  const { app, form } = await mount();
  expect(unload()).toBe(false);
  await typeSeats(form, "8");
  await typeSeats(form, "");
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});

it("after commit() nothing is left unsaved", async () => {
  const { app, form } = await mount();
  await typeSeats(form, "8");
  form.shadowRoot!.querySelector<HTMLElement>("[data-reset-table-action]")!.click();
  expect(app.confirmed).toEqual([{ seats: 8 }]);
  expect(unload()).toBe(true);
  form.commit();
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
