import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, LeaveController, type WtInput } from "@waitron/ui";
import type { HoursModel, WeekDay } from "../hours-types.js";
import { HoursApi } from "./hours-client.js";
import type { HoursScreen } from "./hours-screen.js";
import "./hours-screen.js";

const days = Array.from({ length: 7 }, (_, weekday): WeekDay => ({
  weekday,
  cell:
    weekday === 0
      ? {
          mode: "periods" as const,
          periods: [{ id: "period", opensAt: "09:00", closesAt: "18:00" }],
        }
      : { mode: "closed" as const, periods: [] },
}));
const model: HoursModel = {
  timeZone: "Europe/Madrid",
  dayCutover: "06:00",
  civilDate: "2026-10-07",
  clockReadable: true,
  subjects: [{ kind: "department", id: "d1", name: "Restaurant", active: true, isDefault: true }],
  week: [{ subject: { kind: "department", id: "d1" }, days }],
  days: [],
  specialDates: [],
  specialCells: [],
};
class HoursLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: HoursApi;
  override render() {
    return html`<dashboard-hours-screen .api=${this.api}></dashboard-hours-screen>
      ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("hours-leave-test-app", HoursLeaveApp);
let app: HoursLeaveApp;
afterEach(() => app?.remove());
async function mount(write: () => Promise<void> = async () => {}, refreshFails = false) {
  setLocale("en");
  const writes: unknown[] = [];
  let reads = 0;
  const request = async (path: string, method: string, body?: unknown) => {
    if (method === "GET") {
      if (++reads > 1 && refreshFails) throw { code: "connection.failed" };
      return structuredClone(model);
    }
    writes.push([path, body]);
    await write();
  };
  app = document.createElement("hours-leave-test-app") as HoursLeaveApp;
  app.api = new HoursApi(request as DashboardRequest);
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const screen = app.shadowRoot!.querySelector<HoursScreen>("dashboard-hours-screen")!;
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=week-grid]")).not.toBeNull();
  return { screen, writes };
}
async function open(screen: HoursScreen) {
  screen
    .shadowRoot!.querySelector<HTMLButtonElement>(
      'td[data-subject="department:d1"][data-weekday="0"] button',
    )!
    .click();
  await screen.updateComplete;
  const modal = screen.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  const cell = modal.querySelector("hours-cell-editor")!;
  await cell.updateComplete;
  return { modal, cell };
}
async function change(screen: HoursScreen, value: string) {
  const cell = screen.shadowRoot!.querySelector("hours-cell-editor")!;
  const input = cell.shadowRoot!.querySelector<WtInput>('[name="sunday.periods.0.opensAt"]')!;
  input.value = value;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await screen.updateComplete;
  await cell.updateComplete;
}
function value(screen: HoursScreen) {
  return screen
    .shadowRoot!.querySelector("hours-cell-editor")!
    .shadowRoot!.querySelector<WtInput>('[name="sunday.periods.0.opensAt"]')!.value;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function question() {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  return q;
}
async function choose(decision: "keep" | "discard") {
  const q = await question();
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
const expected = [
  "/management-api/venue-service/hours/week",
  {
    subject: { kind: "department", id: "d1" },
    days: days.map((day) =>
      day.weekday === 0
        ? {
            ...day,
            cell: {
              mode: "periods",
              periods: [{ id: "period", opensAt: "10:00", closesAt: "18:00" }],
            },
          }
        : day,
    ),
  },
];

it("weekday Hours keeps actual input through native Escape and Cancel, then discards without writing", async () => {
  const { screen, writes } = await mount();
  const { modal } = await open(screen);
  await change(screen, "10:00");
  expect(unload()).toBe(true);
  await userEvent.keyboard("{Escape}");
  expect((await question()).open).toBe(true);
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  await choose("keep");
  expect(value(screen)).toBe("10:00");
  modal.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await choose("discard");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});
it("weekday Hours clean and reverted submitted values close without a question", async () => {
  const { screen } = await mount();
  let { modal } = await open(screen);
  modal.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  ({ modal } = await open(screen));
  await change(screen, "10:00");
  await change(screen, "09:00");
  expect(unload()).toBe(false);
  modal.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect((await question()).open).toBe(false);
});
it("weekday Hours commits its exact submitted body before a failed refresh", async () => {
  const { screen, writes } = await mount(undefined, true);
  const { modal } = await open(screen);
  await change(screen, "10:00");
  modal.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(writes).toEqual([expected]);
  expect(unload()).toBe(false);
  expect((await question()).open).toBe(false);
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=page-alert]"))
    .not.toBeNull();
});
it("weekday Hours retains a refused write as dirty", async () => {
  const { screen, writes } = await mount(async () => {
    throw { code: "connection.failed" };
  });
  const { modal } = await open(screen);
  await change(screen, "10:00");
  modal.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
  await expect
    .poll(
      () =>
        modal.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=cancel-editor]")!
          .disabled,
    )
    .toBe(false);
  modal.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await choose("keep");
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(value(screen)).toBe("10:00");
  expect(unload()).toBe(true);
  expect(writes).toEqual([expected]);
});
it("clear standard Hours confirmation closes directly without a second warning or write", async () => {
  const { screen, writes } = await mount();
  const action = screen.shadowRoot!.querySelector<HTMLElement>("[data-test=clear]")!;
  action.closest("wt-row-actions")!.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  action.click();
  await screen.updateComplete;
  const modal = screen.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  expect(unload()).toBe(false);
  modal.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect((await question()).open).toBe(false);
  expect(writes).toEqual([]);
});
function heldWrite() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it("an accepted weekday write retains newer input dirty against the submitted snapshot", async () => {
  const write = heldWrite();
  const { screen, writes } = await mount(() => write.promise);
  const { modal } = await open(screen);
  await change(screen, "10:00");
  modal.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
  await expect.poll(() => writes.length).toBe(1);
  await change(screen, "11:00");
  write.resolve();
  await expect
    .poll(
      () =>
        modal.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=cancel-editor]")!
          .disabled,
    )
    .toBe(false);
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(value(screen)).toBe("11:00");
  expect(unload()).toBe(true);
  expect(writes).toEqual([expected]);
  await change(screen, "10:00");
  expect(unload()).toBe(false);
});
it("disconnect aborts the weekday question; reconnect protects retained input against the original baseline", async () => {
  const { screen } = await mount();
  const { modal } = await open(screen);
  await change(screen, "10:00");
  modal.querySelector<HTMLElement>("[data-test=cancel-editor]")!.click();
  expect((await question()).open).toBe(true);
  screen.remove();
  expect(unload()).toBe(false);
  expect((await question()).open).toBe(false);
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  expect(value(screen)).toBe("10:00");
  expect(unload()).toBe(true);
  await change(screen, "09:00");
  expect(unload()).toBe(false);
});
it("a departed successful weekday reply cannot close a replacement editor or release its busy state", async () => {
  const first = heldWrite();
  const second = heldWrite();
  let attempts = 0;
  const { screen, writes } = await mount(() => (++attempts === 1 ? first.promise : second.promise));
  const { modal } = await open(screen);
  await change(screen, "10:00");
  modal.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
  await expect.poll(() => writes.length).toBe(1);
  screen.remove();
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  await change(screen, "09:00");
  const replacement = await open(screen);
  await change(screen, "11:00");
  replacement.modal.querySelector<HTMLElement>("[data-test=save-editor]")!.click();
  await expect.poll(() => writes.length).toBe(2);
  first.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(replacement.modal.isConnected).toBe(true);
  expect(value(screen)).toBe("11:00");
  expect(
    replacement.modal.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=cancel-editor]",
    )!.disabled,
  ).toBe(true);
  second.resolve();
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
});
it("departed weekday Enter and close reports cannot save or close a replacement", async () => {
  const { screen, writes } = await mount();
  const old = await open(screen);
  const oldSave = old.modal.querySelector<HTMLElement>("[data-test=save-editor]")!;
  screen.remove();
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  const replacement = await open(screen);
  oldSave.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  old.modal.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await screen.updateComplete;
  expect(writes).toEqual([]);
  expect(replacement.modal.isConnected).toBe(true);
});
it("weekday period property order does not make unchanged values dirty", async () => {
  const { screen } = await mount();
  const { cell } = await open(screen);
  cell.dispatchEvent(
    new CustomEvent("hours-cell-change", {
      detail: {
        cell: { periods: [{ closesAt: "18:00", opensAt: "09:00", id: "period" }], mode: "periods" },
      },
      bubbles: true,
      composed: true,
    }),
  );
  await screen.updateComplete;
  expect(unload()).toBe(false);
});
it("opening another weekday asks before replacing an edited Hours draft", async () => {
  const { screen, writes } = await mount();
  const { modal } = await open(screen);
  await change(screen, "10:00");
  const trigger = screen.shadowRoot!.querySelector<HTMLButtonElement>(
    'td[data-subject="department:d1"][data-weekday="0"] button',
  )!;
  trigger.click();
  await choose("keep");
  expect(modal.isConnected).toBe(true);
  expect(value(screen)).toBe("10:00");
  trigger.click();
  await choose("discard");
  await screen.updateComplete;
  expect(modal.isConnected).toBe(false);
  expect(value(screen)).toBe("09:00");
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});
