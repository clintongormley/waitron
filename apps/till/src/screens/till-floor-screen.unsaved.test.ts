import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { TableState } from "../api/client.js";
import "./till-floor-screen.js";

const freeTable: TableState = {
  id: "t1",
  label: "4",
  zoneId: "z1",
  capacity: 4,
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
  posX: null,
  posY: null,
  shape: null,
  rotation: null,
  signals: [],
  party: null,
};
class FloorLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  opened: unknown[] = [];
  override render() {
    return html`<till-floor-screen
        .zones=${[{ id: "z1", name: "Dining room", displayOrder: 0, active: true }]}
        .tables=${[freeTable]}
        @open-table=${(event: CustomEvent) => this.opened.push(event.detail)}
      ></till-floor-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("floor-leave-test-app", FloorLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
it("the actual floor keeps a typed seating count on Keep, discards without opening, and seats the fresh form directly", async () => {
  const { el: app } = await mountWidget<FloorLeaveApp>("floor-leave-test-app", {});
  const floor = app.shadowRoot!.querySelector("till-floor-screen")!;
  await floor.updateComplete;
  const tap = async () => {
    floor.shadowRoot!.querySelector<HTMLElement>('[data-table="t1"]')!.click();
    await floor.updateComplete;
    const form = floor.shadowRoot!.querySelector("till-seat-dialog")!;
    await form.updateComplete;
    await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
    const field = form.shadowRoot!.querySelector("wt-input")!;
    await field.updateComplete;
    return { form, input: field.shadowRoot!.querySelector<HTMLInputElement>("input")! };
  };
  const { form, input } = await tap();
  await userEvent.fill(page.elementLocator(input), "3");
  form.shadowRoot!.querySelector<HTMLElement>("[data-seat-cancel]")!.click();
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  expect(q.open).toBe(true);
  expect(app.opened).toEqual([]);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(floor.shadowRoot!.querySelector("till-seat-dialog")).toBe(form);
  expect(input.value).toBe("3");
  form.shadowRoot!.querySelector<HTMLElement>("[data-seat-cancel]")!.click();
  await expect.poll(() => q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => floor.shadowRoot!.querySelector("till-seat-dialog")).toBeNull();
  expect(app.opened).toEqual([]);
  const fresh = await tap();
  expect(fresh.input.value).toBe("");
  await userEvent.fill(page.elementLocator(fresh.input), "2");
  fresh.form.shadowRoot!.querySelector<HTMLElement>("[data-seat-confirm]")!.click();
  await expect.poll(() => floor.shadowRoot!.querySelector("till-seat-dialog")).toBeNull();
  expect(app.opened).toEqual([{ tableId: "t1", seated: false, guestCount: 2 }]);
  expect(q.open).toBe(false);
});
