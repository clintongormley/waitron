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
  departments: [],
  subjects: [{ kind: "station", id: "d1", name: "Restaurant", active: true, isDefault: false }],
  week: [{ subject: { kind: "station", id: "d1" }, days }],
  days: [],
  specialDates: [],
  specialCells: [],
  holidayCoverage: [],
  holidaySources: [],
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
async function mount(
  write: () => Promise<void> = async () => {},
  refreshFails = false,
  initialModel = model,
) {
  setLocale("en");
  const writes: unknown[] = [];
  let reads = 0;
  const request = async (path: string, method: string, body?: unknown) => {
    if (method === "GET") {
      if (path.endsWith("/local-holidays"))
        return {
          venue: { country: "ES", provinceCode: "41", city: "Sevilla" },
          localEntryLimit: 2,
          areaOptions: [],
          areaRequired: false,
          geographies: [],
          entries: [],
        };
      if (path.includes("/holidays?")) return { facts: [], coverage: [], sources: [] };
      if (++reads > 1 && refreshFails) throw { code: "connection.failed" };
      return structuredClone(initialModel);
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
      'td[data-subject="station:d1"][data-weekday="0"] button',
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
  const cell = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["hours-cell-editor"]>(
    'hours-cell-editor[field-prefix="sunday"]',
  )!;
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
    .shadowRoot!.querySelector('hours-cell-editor[field-prefix="sunday"]')!
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
    subject: { kind: "station", id: "d1" },
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
    'td[data-subject="station:d1"][data-weekday="0"] button',
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

const unconfigured: HoursModel = {
  ...model,
  week: [
    {
      subject: { kind: "station", id: "d1" },
      days: days.map(({ weekday }) => ({
        weekday,
        cell: { mode: "not_set", periods: [] },
      })),
    },
  ],
};
async function configure(write?: () => Promise<void>, refreshFails = false) {
  const mounted = await mount(write, refreshFails, unconfigured);
  const { modal } = await open(mounted.screen);
  return { ...mounted, modal };
}
async function mode(screen: HoursScreen, prefix: string, value: string) {
  const cell = [...screen.shadowRoot!.querySelectorAll("hours-cell-editor")].find(
    (entry) => entry.fieldPrefix === prefix,
  )!;
  await cell.updateComplete;
  const input = cell.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    `[name="${prefix}.mode"]`,
  )!;
  input.value = value;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await screen.updateComplete;
  await cell.updateComplete;
}
function configureMode(screen: HoursScreen, prefix: string) {
  return [...screen.shadowRoot!.querySelectorAll("hours-cell-editor")].find(
    (entry) => entry.fieldPrefix === prefix,
  )!.cell.mode;
}
function action(modal: HTMLElement, kind: "save" | "cancel") {
  modal.querySelector<HTMLElement>(`[data-test=${kind}-editor]`)!.click();
}
const configuredBody = [
  "/management-api/venue-service/hours/week",
  {
    subject: { kind: "station", id: "d1" },
    days: [
      { weekday: 0, cell: { mode: "closed", periods: [] } },
      { weekday: 1, cell: { mode: "all_day", periods: [] } },
      { weekday: 2, cell: { mode: "closed", periods: [] } },
      { weekday: 3, cell: { mode: "closed", periods: [] } },
      { weekday: 4, cell: { mode: "closed", periods: [] } },
      { weekday: 5, cell: { mode: "closed", periods: [] } },
      { weekday: 6, cell: { mode: "closed", periods: [] } },
    ],
  },
];
it("Configure hours keeps all seven-day values through Cancel and native Escape, then discards without a write", async () => {
  const { screen, modal, writes } = await configure();
  await mode(screen, "monday", "all_day");
  expect(unload()).toBe(true);
  action(modal, "cancel");
  await choose("keep");
  expect(configureMode(screen, "monday")).toBe("all_day");
  await userEvent.keyboard("{Escape}");
  expect((await question()).open).toBe(true);
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  await choose("discard");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});
it("Configure hours clean and reverted values close without warning", async () => {
  const { screen, modal, writes } = await configure();
  await mode(screen, "monday", "all_day");
  await mode(screen, "monday", "closed");
  expect(unload()).toBe(false);
  action(modal, "cancel");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect((await question()).open).toBe(false);
  const clean = await open(screen);
  action(clean.modal, "cancel");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(writes).toEqual([]);
});
it("Configure hours confirmation Back retains the draft; Escape still protects it", async () => {
  const { screen, modal, writes } = await configure();
  await mode(screen, "monday", "all_day");
  action(modal, "save");
  await screen.updateComplete;
  expect(modal.querySelector("[data-test=confirm-text]")).not.toBeNull();
  action(modal, "cancel");
  await screen.updateComplete;
  expect((await question()).open).toBe(false);
  expect(configureMode(screen, "monday")).toBe("all_day");
  expect(unload()).toBe(true);
  action(modal, "save");
  await screen.updateComplete;
  await userEvent.keyboard("{Escape}");
  await choose("keep");
  expect(modal.querySelector("[data-test=confirm-text]")).not.toBeNull();
  expect(writes).toEqual([]);
});
it("Configure hours commits the accepted seven-day body before a failed refresh", async () => {
  const { screen, modal, writes } = await configure(undefined, true);
  await mode(screen, "monday", "all_day");
  action(modal, "save");
  await screen.updateComplete;
  action(modal, "save");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(writes).toEqual([configuredBody]);
  expect(unload()).toBe(false);
  expect((await question()).open).toBe(false);
  await expect
    .poll(() => screen.shadowRoot!.querySelector("[data-test=page-alert]"))
    .not.toBeNull();
});
it("Configure hours refused writes retain the draft and warning", async () => {
  const { screen, modal, writes } = await configure(async () => {
    throw { code: "connection.failed" };
  });
  await mode(screen, "monday", "all_day");
  action(modal, "save");
  await screen.updateComplete;
  action(modal, "save");
  await expect
    .poll(
      () =>
        modal.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=cancel-editor]")!
          .disabled,
    )
    .toBe(false);
  await userEvent.keyboard("{Escape}");
  await choose("keep");
  action(modal, "cancel");
  await screen.updateComplete;
  expect(configureMode(screen, "monday")).toBe("all_day");
  expect(writes).toEqual([configuredBody]);
  expect(unload()).toBe(true);
});
it("Configure hours reconnect preserves the original defaults and invalidates a pending answer", async () => {
  const { screen, modal } = await configure();
  await mode(screen, "monday", "all_day");
  action(modal, "cancel");
  expect((await question()).open).toBe(true);
  screen.remove();
  expect((await question()).open).toBe(false);
  expect(unload()).toBe(false);
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  expect(configureMode(screen, "monday")).toBe("all_day");
  expect(unload()).toBe(true);
  await mode(screen, "monday", "closed");
  expect(unload()).toBe(false);
});

it("Configure hours starting its explicit write invalidates an unanswered discard", async () => {
  const write = heldWrite();
  const { screen, modal, writes } = await configure(() => write.promise);
  await mode(screen, "monday", "all_day");
  action(modal, "cancel");
  expect((await question()).open).toBe(true);
  action(modal, "save");
  await screen.updateComplete;
  action(modal, "save");
  await expect.poll(() => writes.length).toBe(1);
  expect((await question()).open).toBe(false);
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  await userEvent.keyboard("{Escape}");
  expect((await question()).open).toBe(false);
  expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  write.resolve();
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(writes).toEqual([configuredBody]);
  expect(unload()).toBe(false);
});
it("Configure hours old write completion cannot close a replacement opening", async () => {
  const write = heldWrite();
  const { screen, modal, writes } = await configure(() => write.promise);
  await mode(screen, "monday", "all_day");
  action(modal, "save");
  await screen.updateComplete;
  action(modal, "save");
  await expect.poll(() => writes.length).toBe(1);
  screen.remove();
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  action(screen.shadowRoot!.querySelector("wt-modal")!, "cancel");
  await screen.updateComplete;
  await mode(screen, "monday", "closed");
  const replacement = await open(screen);
  await mode(screen, "tuesday", "all_day");
  write.resolve();
  await new Promise((done) => setTimeout(done, 0));
  await screen.updateComplete;
  expect(replacement.modal.isConnected).toBe(true);
  expect(configureMode(screen, "tuesday")).toBe("all_day");
  expect(unload()).toBe(true);
});
it("Configure hours asks before a second Configure opening replaces its draft", async () => {
  const { screen, modal, writes } = await configure();
  await mode(screen, "monday", "all_day");
  const trigger = screen.shadowRoot!.querySelector<HTMLButtonElement>(
    'td[data-subject="station:d1"][data-weekday="0"] button',
  )!;
  trigger.click();
  await choose("keep");
  expect(modal.isConnected).toBe(true);
  expect(configureMode(screen, "monday")).toBe("all_day");
  trigger.click();
  await choose("discard");
  await screen.updateComplete;
  expect(modal.isConnected).toBe(false);
  expect(configureMode(screen, "monday")).toBe("closed");
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});

it.each(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"])(
  "Configure hours tracks %s independently and clears a reverted day",
  async (day) => {
    const { screen, modal, writes } = await configure();
    await mode(screen, day, "all_day");
    expect(unload()).toBe(true);
    await mode(screen, day, "closed");
    expect(unload()).toBe(false);
    action(modal, "cancel");
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect(writes).toEqual([]);
    expect((await question()).open).toBe(false);
  },
);
it("Configure hours retains invalid period input and ignores it only when the submitted mode excludes it", async () => {
  const { screen, modal, writes } = await configure();
  await mode(screen, "sunday", "periods");
  await change(screen, "");
  expect(value(screen)).toBe("");
  expect(unload()).toBe(true);
  action(modal, "cancel");
  await choose("keep");
  expect(value(screen)).toBe("");
  await mode(screen, "sunday", "closed");
  expect(unload()).toBe(false);
  action(modal, "cancel");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(writes).toEqual([]);
});
it("Configure hours background refresh leaves the edited seven-day draft protected", async () => {
  const { screen, modal, writes } = await configure();
  await mode(screen, "monday", "all_day");
  screen.api.rereadWatches();
  await new Promise((done) => setTimeout(done, 0));
  await screen.updateComplete;
  expect(configureMode(screen, "monday")).toBe("all_day");
  expect(unload()).toBe(true);
  action(modal, "cancel");
  await choose("keep");
  expect(configureMode(screen, "monday")).toBe("all_day");
  expect(writes).toEqual([]);
});

const specialModel: HoursModel = {
  ...model,
  specialDates: [
    { id: "fiesta", date: "2026-10-12", name: "Fiesta", colour: "red", closeWholeVenue: false },
  ],
  specialCells: [
    {
      specialDateId: "fiesta",
      cells: [{ subject: { kind: "station", id: "d1" }, cell: { mode: "closed", periods: [] } }],
    },
  ],
};
async function dateEditor(
  kind: "add" | "edit" | "duplicate",
  write?: () => Promise<void>,
  refreshFails = false,
) {
  history.replaceState(null, "", "/manage/hours");
  const mounted = await mount(write, refreshFails, specialModel);
  const { screen } = mounted;
  const tabs = screen.shadowRoot!.querySelector("wt-tabs")!;
  tabs.dispatchEvent(
    new CustomEvent("wt-tab-change", { detail: { value: "dates" }, bubbles: true, composed: true }),
  );
  await screen.updateComplete;
  if (kind === "add")
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=add-date]")!.click();
  else {
    const table = screen.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    const button = table.shadowRoot!.querySelector<HTMLElement>(
      `[data-test=${kind === "edit" ? "edit-date" : "duplicate-date"}]`,
    )!;
    button
      .closest("wt-row-actions")!
      .shadowRoot!.querySelector<HTMLButtonElement>("button")!
      .click();
    button.click();
  }
  await screen.updateComplete;
  const modal = screen.shadowRoot!.querySelector("wt-modal")!;
  await modal.updateComplete;
  return { ...mounted, modal };
}
async function dateField(screen: HoursScreen, name: string, value: string) {
  const input = screen.shadowRoot!.querySelector<WtInput>(`[name="${name}"]`)!;
  input.value = value;
  input.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await screen.updateComplete;
  await input.updateComplete;
}
function dateValue(screen: HoursScreen, name: string) {
  return screen
    .shadowRoot!.querySelector<WtInput>(`[name="${name}"]`)!
    .shadowRoot!.querySelector<HTMLInputElement>("input")!.value;
}
it.each(["add", "edit", "duplicate"] as const)(
  "special-date %s keeps actual values through Cancel/native Escape then discards without writing",
  async (kind) => {
    const { screen, modal, writes } = await dateEditor(kind);
    const name = kind === "duplicate" ? "dates.0" : "name";
    const value = kind === "duplicate" ? "2026-10-20" : "Changed fiesta";
    await dateField(screen, name, value);
    expect(unload()).toBe(true);
    action(modal, "cancel");
    await choose("keep");
    expect(dateValue(screen, name)).toBe(value);
    await userEvent.keyboard("{Escape}");
    expect((await question()).open).toBe(true);
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await choose("discard");
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect(unload()).toBe(false);
    expect(writes).toEqual([]);
  },
);
it.each(["add", "edit", "duplicate"] as const)(
  "special-date %s reverts to a clean opening",
  async (kind) => {
    const { screen, modal, writes } = await dateEditor(kind);
    const name = kind === "duplicate" ? "dates.0" : "name";
    await dateField(screen, name, kind === "duplicate" ? "2026-10-20" : "Changed");
    await dateField(screen, name, kind === "edit" ? "  Fiesta  " : "");
    expect(unload()).toBe(false);
    action(modal, "cancel");
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect((await question()).open).toBe(false);
    expect(writes).toEqual([]);
  },
);
const editedDateBody = [
  "/management-api/venue-service/special-dates/fiesta",
  {
    date: "2026-10-12",
    name: "Changed fiesta",
    colour: "red",
    closeWholeVenue: false,
    cells: [{ subject: { kind: "station", id: "d1" }, cell: { mode: "closed", periods: [] } }],
  },
];
it("special-date Edit commits the exact accepted body before a failed refresh", async () => {
  const { screen, modal, writes } = await dateEditor("edit", undefined, true);
  await dateField(screen, "name", "  Changed fiesta  ");
  action(modal, "save");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(writes).toEqual([editedDateBody]);
  expect(unload()).toBe(false);
  expect((await question()).open).toBe(false);
});
it("special-date Edit refused save retains input and its warning", async () => {
  const { screen, modal, writes } = await dateEditor("edit", async () => {
    throw { code: "connection.failed" };
  });
  await dateField(screen, "name", "Changed fiesta");
  action(modal, "save");
  await expect
    .poll(
      () =>
        modal.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=cancel-editor]")!
          .disabled,
    )
    .toBe(false);
  action(modal, "cancel");
  await choose("keep");
  expect(dateValue(screen, "name")).toBe("Changed fiesta");
  expect(unload()).toBe(true);
  expect(writes).toEqual([editedDateBody]);
});
it("special-date Edit reconnect protects retained values against the original opening", async () => {
  const { screen, modal } = await dateEditor("edit");
  await dateField(screen, "name", "Changed fiesta");
  action(modal, "cancel");
  expect((await question()).open).toBe(true);
  screen.remove();
  expect((await question()).open).toBe(false);
  expect(unload()).toBe(false);
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  expect(dateValue(screen, "name")).toBe("Changed fiesta");
  expect(unload()).toBe(true);
  await dateField(screen, "name", "Fiesta");
  expect(unload()).toBe(false);
});

it.each(["date", "name", "colour", "closeWholeVenue", "cell"])(
  "special-date Edit tracks and reverts %s independently",
  async (field) => {
    const { screen, modal } = await dateEditor("edit");
    const set = async (changed: boolean) => {
      if (field === "closeWholeVenue") {
        const control = modal.querySelector("wt-switch")!;
        control.dispatchEvent(
          new CustomEvent("wt-change", {
            detail: { checked: changed },
            bubbles: true,
            composed: true,
          }),
        );
      } else if (field === "cell") await mode(screen, "station.d1", changed ? "all_day" : "closed");
      else
        await dateField(
          screen,
          field,
          changed
            ? field === "date"
              ? "2026-10-20"
              : field === "colour"
                ? "blue"
                : "Changed"
            : field === "date"
              ? "2026-10-12"
              : field === "colour"
                ? "red"
                : "Fiesta",
        );
      await screen.updateComplete;
    };
    await set(true);
    expect(unload()).toBe(true);
    action(modal, "cancel");
    await choose("keep");
    await set(false);
    expect(unload()).toBe(false);
  },
);
it.each(["edit", "duplicate"] as const)(
  "special-date %s accepted write preserves newer input against the submitted snapshot",
  async (kind) => {
    const write = heldWrite();
    const { screen, modal, writes } = await dateEditor(kind, () => write.promise);
    const name = kind === "edit" ? "name" : "dates.0";
    const submitted = kind === "edit" ? "Changed fiesta" : "2026-10-20";
    await dateField(screen, name, submitted);
    action(modal, "save");
    await expect.poll(() => writes.length).toBe(1);
    await dateField(screen, name, kind === "edit" ? "Newer" : "2026-10-21");
    write.resolve();
    await expect
      .poll(
        () =>
          modal.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=cancel-editor]")!
            .disabled,
      )
      .toBe(false);
    expect(modal.isConnected).toBe(true);
    expect(unload()).toBe(true);
    expect(writes).toEqual([
      kind === "edit"
        ? editedDateBody
        : [
            "/management-api/venue-service/special-dates/fiesta/duplicate",
            { dates: ["2026-10-20"] },
          ],
    ]);
    await dateField(screen, name, submitted);
    expect(unload()).toBe(false);
  },
);
it("special-date Duplicate protects multiple ordered target dates including blank invalid input", async () => {
  const { screen, modal, writes } = await dateEditor("duplicate");
  modal.querySelector<HTMLElement>("[data-test=add-target]")!.click();
  await screen.updateComplete;
  expect(unload()).toBe(true);
  await dateField(screen, "dates.0", "2026-10-20");
  await dateField(screen, "dates.1", "2026-10-21");
  action(modal, "cancel");
  await choose("keep");
  expect(dateValue(screen, "dates.1")).toBe("2026-10-21");
  action(modal, "save");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(writes).toEqual([
    [
      "/management-api/venue-service/special-dates/fiesta/duplicate",
      { dates: ["2026-10-20", "2026-10-21"] },
    ],
  ]);
  expect(unload()).toBe(false);
});
it("special-date Edit asks before replacement and ancestor leave", async () => {
  const { screen, modal, writes } = await dateEditor("edit");
  await dateField(screen, "name", "Changed fiesta");
  const add = screen.shadowRoot!.querySelector<HTMLElement>("[data-test=add-date]")!;
  add.click();
  await choose("keep");
  expect(modal.isConnected).toBe(true);
  expect(dateValue(screen, "name")).toBe("Changed fiesta");
  let left = false;
  void app.leave.coordinator.request({
    scopes: [screen],
    reason: "navigation",
    proceed: () => {
      left = true;
    },
  });
  await choose("keep");
  expect(left).toBe(false);
  add.click();
  await choose("discard");
  await screen.updateComplete;
  expect(modal.isConnected).toBe(false);
  expect(dateValue(screen, "name")).toBe("");
  expect(unload()).toBe(false);
  expect(writes).toEqual([]);
});
it("special-date departed fields cannot mutate a replacement draft", async () => {
  const { screen, modal } = await dateEditor("edit");
  const old = modal.querySelector<WtInput>('[name="name"]')!;
  action(modal, "cancel");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=add-date]")!.click();
  await screen.updateComplete;
  old.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Departed" }, bubbles: true, composed: true }),
  );
  await screen.updateComplete;
  expect(dateValue(screen, "name")).toBe("");
  expect(unload()).toBe(false);
});

it("special-date departed Duplicate controls cannot replace the current editor", async () => {
  const { screen, modal, writes } = await dateEditor("duplicate");
  const add = modal.querySelector<HTMLElement>("[data-test=add-target]")!;
  action(modal, "cancel");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=add-date]")!.click();
  await screen.updateComplete;
  add.click();
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector('[name="name"]')).not.toBeNull();
  expect(screen.shadowRoot!.querySelector('[name="dates.1"]')).toBeNull();
  expect(unload()).toBe(false);
  expect(writes).toEqual([]);
});

it.each(["make_special", "edit", "duplicate"] as const)(
  "calendar %s protects the editor reached through its actual day panel",
  async (kind) => {
    history.replaceState(null, "", "/manage/hours");
    const calendarModel = {
      ...specialModel,
      days: [
        {
          date: "2026-10-12",
          specialDate: specialModel.specialDates[0]!,
          holidays: [],
          tone: "red" as const,
        },
      ],
    };
    const { screen, writes } = await mount(undefined, false, calendarModel);
    screen.shadowRoot!.querySelector("wt-tabs")!.dispatchEvent(
      new CustomEvent("wt-tab-change", {
        detail: { value: "calendar" },
        bubbles: true,
        composed: true,
      }),
    );
    await screen.updateComplete;
    const calendar = screen.shadowRoot!.querySelector("hours-calendar")!;
    await expect
      .poll(() => calendar.shadowRoot!.querySelector("td[data-date] button"))
      .not.toBeNull();
    const date = kind === "make_special" ? "2026-10-20" : "2026-10-12";
    calendar
      .shadowRoot!.querySelector<HTMLButtonElement>(`td[data-date="${date}"] button`)!
      .click();
    await calendar.updateComplete;
    calendar.shadowRoot!.querySelector<HTMLElement>(`[data-test=calendar-${kind}]`)!.click();
    await screen.updateComplete;
    const modal = screen.shadowRoot!.querySelector("wt-modal")!;
    await modal.updateComplete;
    const name = kind === "duplicate" ? "dates.0" : "name";
    const value = kind === "duplicate" ? "2026-10-21" : "Changed fiesta";
    await dateField(screen, name, value);
    action(modal, "cancel");
    await choose("keep");
    expect(dateValue(screen, name)).toBe(value);
    expect(unload()).toBe(true);
    await userEvent.keyboard("{Escape}");
    await choose("discard");
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect(writes).toEqual([]);
    expect(unload()).toBe(false);
  },
);
it("special-date Add saves its exact input and retires protection", async () => {
  const { screen, modal, writes } = await dateEditor("add");
  await dateField(screen, "name", "  Holiday  ");
  await dateField(screen, "date", "2026-10-20");
  await dateField(screen, "colour", "blue");
  action(modal, "save");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(writes).toEqual([
    [
      "/management-api/venue-service/special-dates",
      { date: "2026-10-20", name: "Holiday", colour: "blue", closeWholeVenue: false, cells: [] },
    ],
  ]);
  expect(unload()).toBe(false);
  expect((await question()).open).toBe(false);
});
it("special-date Delete remains an exempt confirmation", async () => {
  const { screen, modal, writes } = await dateEditor("edit");
  action(modal, "cancel");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  const table = screen.shadowRoot!.querySelector("wt-data-table")!;
  const button = table.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-date]")!;
  button.closest("wt-row-actions")!.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  button.click();
  await screen.updateComplete;
  const confirmation = screen.shadowRoot!.querySelector("wt-modal")!;
  await confirmation.updateComplete;
  expect(unload()).toBe(false);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect((await question()).open).toBe(false);
  expect(writes).toEqual([]);
});

it.each(["edit", "duplicate"] as const)(
  "special-date %s write blocks close and invalidates unanswered discard",
  async (kind) => {
    const write = heldWrite();
    const { screen, modal, writes } = await dateEditor(kind, () => write.promise);
    await dateField(
      screen,
      kind === "edit" ? "name" : "dates.0",
      kind === "edit" ? "Changed fiesta" : "2026-10-20",
    );
    action(modal, "cancel");
    expect((await question()).open).toBe(true);
    action(modal, "save");
    await expect.poll(() => writes.length).toBe(1);
    expect((await question()).open).toBe(false);
    await userEvent.keyboard("{Escape}");
    expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    expect((await question()).open).toBe(false);
    write.resolve();
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    expect(unload()).toBe(false);
  },
);
it.each(["edit", "duplicate"] as const)(
  "special-date %s departed successful reply cannot close a replacement opening",
  async (kind) => {
    const write = heldWrite();
    const { screen, modal, writes } = await dateEditor(kind, () => write.promise);
    await dateField(
      screen,
      kind === "edit" ? "name" : "dates.0",
      kind === "edit" ? "Changed fiesta" : "2026-10-20",
    );
    action(modal, "save");
    await expect.poll(() => writes.length).toBe(1);
    screen.remove();
    app.shadowRoot!.append(screen);
    await screen.updateComplete;
    action(screen.shadowRoot!.querySelector("wt-modal")!, "cancel");
    await choose("discard");
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
    screen.shadowRoot!.querySelector<HTMLElement>("[data-test=add-date]")!.click();
    await screen.updateComplete;
    await dateField(screen, "name", "New opening");
    write.resolve();
    await new Promise((done) => setTimeout(done, 0));
    await screen.updateComplete;
    expect(dateValue(screen, "name")).toBe("New opening");
    expect(unload()).toBe(true);
  },
);

async function saveButton(screen: HoursScreen) {
  const button =
    screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
      "[data-test=save-editor]",
    )!;
  await button.updateComplete;
  return button;
}
async function expectSave(screen: HoursScreen, changed: boolean) {
  const button = await saveButton(screen);
  expect(button.variant).toBe(changed ? "primary" : "secondary");
  expect(button.shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(!changed);
}

it.each([false, true])(
  "weekday Save follows changed values outside the dashboard shell=%s",
  async (standalone) => {
    history.replaceState(null, "", "/manage/hours");
    const { screen, writes } = await mount();
    if (standalone) {
      screen.remove();
      document.body.append(screen);
      await screen.updateComplete;
    }
    try {
      await open(screen);
      await expectSave(screen, false);
      (await saveButton(screen)).click();
      await screen.updateComplete;
      expect(writes).toEqual([]);
      expect(screen.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
      await change(screen, "10:00");
      await expectSave(screen, true);
      await change(screen, "09:00");
      await expectSave(screen, false);
      await change(screen, "10:00");
      screen.remove();
      (standalone ? document.body : app.shadowRoot!).append(screen);
      await screen.updateComplete;
      expect(value(screen)).toBe("10:00");
      await expectSave(screen, true);
      await change(screen, "09:00");
      await expectSave(screen, false);
      action(screen.shadowRoot!.querySelector("wt-modal")!, "cancel");
      await expect.poll(() => screen.shadowRoot!.querySelector("wt-modal")).toBeNull();
      expect(writes).toEqual([]);
    } finally {
      if (standalone) screen.remove();
    }
  },
);

it("Configure Save waits for a changed day and retains it through confirmation and reconnect", async () => {
  history.replaceState(null, "", "/manage/hours");
  const { screen, modal, writes } = await configure();
  await expectSave(screen, false);
  action(modal, "save");
  await screen.updateComplete;
  expect(modal.querySelector("[data-test=confirm-text]")).toBeNull();
  expect(writes).toEqual([]);
  await mode(screen, "monday", "all_day");
  await expectSave(screen, true);
  action(modal, "save");
  await screen.updateComplete;
  await expectSave(screen, true);
  action(modal, "cancel");
  await screen.updateComplete;
  screen.remove();
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  expect(configureMode(screen, "monday")).toBe("all_day");
  await expectSave(screen, true);
  await mode(screen, "monday", "closed");
  await expectSave(screen, false);
});

it.each(["add", "edit", "duplicate"] as const)(
  "special-date %s Save follows its draft through reconnect and blocks unchanged host clicks",
  async (kind) => {
    const { screen, modal, writes } = await dateEditor(kind);
    await expectSave(screen, false);
    action(modal, "save");
    await screen.updateComplete;
    expect(writes).toEqual([]);
    expect(modal.querySelector("[invalid]")).toBeNull();
    const name = kind === "duplicate" ? "dates.0" : "name";
    const changed = kind === "duplicate" ? "2026-10-20" : "Changed fiesta";
    await dateField(screen, name, changed);
    await expectSave(screen, true);
    screen.remove();
    app.shadowRoot!.append(screen);
    await screen.updateComplete;
    expect(dateValue(screen, name)).toBe(changed);
    await expectSave(screen, true);
    expect(unload()).toBe(true);
    action(screen.shadowRoot!.querySelector("wt-modal")!, "cancel");
    await choose("keep");
    expect(dateValue(screen, name)).toBe(changed);
    await dateField(screen, name, kind === "edit" ? "  Fiesta  " : "");
    await expectSave(screen, false);
    expect(unload()).toBe(false);
  },
);

it("weekday edits made after reconnect still ask before discarding", async () => {
  history.replaceState(null, "", "/manage/hours");
  const { screen, writes } = await mount();
  await open(screen);
  screen.remove();
  await screen.updateComplete;
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  await expectSave(screen, false);
  await change(screen, "10:00");
  action(screen.shadowRoot!.querySelector("wt-modal")!, "cancel");
  await choose("keep");
  expect(value(screen)).toBe("10:00");
  expect(writes).toEqual([]);
});
it.each(["add", "edit", "duplicate"] as const)(
  "special-date %s edits made after reconnect still ask before discarding",
  async (kind) => {
    const { screen, writes } = await dateEditor(kind);
    screen.remove();
    await screen.updateComplete;
    app.shadowRoot!.append(screen);
    await screen.updateComplete;
    await expectSave(screen, false);
    const name = kind === "duplicate" ? "dates.0" : "name";
    const changed = kind === "duplicate" ? "2026-10-20" : "Changed fiesta";
    await dateField(screen, name, changed);
    action(screen.shadowRoot!.querySelector("wt-modal")!, "cancel");
    await choose("keep");
    expect(dateValue(screen, name)).toBe(changed);
    expect(writes).toEqual([]);
  },
);
it("a refused weekday Save remains primary and enabled for retry", async () => {
  history.replaceState(null, "", "/manage/hours");
  const pending = heldWrite();
  const { screen, writes } = await mount(async () => {
    await pending.promise;
    throw { code: "connection.failed" };
  });
  const { modal } = await open(screen);
  await change(screen, "10:00");
  action(modal, "save");
  await expect.poll(() => writes.length).toBe(1);
  const button = await saveButton(screen);
  expect(button.variant).toBe("primary");
  expect(button.shadowRoot!.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
  pending.resolve();
  await expect.poll(() => button.disabled).toBe(false);
  await expectSave(screen, true);
  expect(writes).toEqual([expected]);
});
