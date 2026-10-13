import { afterEach, beforeEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { TableState, TableToday } from "../api/client.js";
import "./split-joined-dialog.js";
import type { SplitJoinedDetail, TillSplitJoinedDialog } from "./split-joined-dialog.js";

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
    status: null,
    nextReservation: null,
    today: todayRow,
    signals: [],
    party: null,
  };
}
const joined = table(
  "long",
  "Long table",
  today(10, { joined: { parts: ["c3", "c4", "c5"], splitOff: [], apart: false } }),
);
const parts = [
  table("c3", "Counter 3", today(2, { inJoinedTable: "Long table" })),
  table("c4", "Counter 4", today(6, { inJoinedTable: "Long table" })),
  table("c5", "Counter 5", today(4, { inJoinedTable: "Long table" })),
];

class SplitJoinedLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  confirmed: SplitJoinedDetail[] = [];
  override render() {
    return html`<till-split-joined-dialog
        .joined=${joined}
        .parts=${parts}
        @split-joined-cancel=${() => this.closes++}
        @split-joined-confirm=${(e: CustomEvent<SplitJoinedDetail>) => this.confirmed.push(e.detail)}
      ></till-split-joined-dialog
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("split-joined-leave-test-app", SplitJoinedLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

async function mount() {
  const { el: app } = await mountWidget<SplitJoinedLeaveApp>("split-joined-leave-test-app", {});
  const form = app.shadowRoot!.querySelector<TillSplitJoinedDialog>("till-split-joined-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
async function choose(form: TillSplitJoinedDialog, values: string[]) {
  form
    .shadowRoot!.querySelector("wt-combobox")!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { values }, bubbles: true, composed: true }),
    );
  await form.updateComplete;
}
function cancel(form: TillSplitJoinedDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-split-cancel]")!.click();
}
async function question(app: SplitJoinedLeaveApp) {
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

it("closing with a choice asks first", async () => {
  const { app, form } = await mount();
  await choose(form, ["c4", "c5"]);
  expect(unload()).toBe(true);
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(form.shadowRoot!.querySelector("wt-combobox")!.values).toEqual(["c4", "c5"]);
  expect(app.closes).toBe(0);
  cancel(form);
  await question(app);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => app.closes).toBe(1);
  expect(app.confirmed).toEqual([]);
  expect(unload()).toBe(false);
});

it("closing with none chosen does not ask", async () => {
  const { app, form } = await mount();
  expect(unload()).toBe(false);
  await choose(form, ["c5"]);
  await choose(form, []);
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});

it("after commit() nothing is left unsaved", async () => {
  const { app, form } = await mount();
  await choose(form, ["c4", "c5"]);
  form.shadowRoot!.querySelector<HTMLElement>("[data-split-action]")!.click();
  expect(app.confirmed).toEqual([{ partIds: ["c4", "c5"], seats: null }]);
  expect(unload()).toBe(true);
  form.commit();
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
