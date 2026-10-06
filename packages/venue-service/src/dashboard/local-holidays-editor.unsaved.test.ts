import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens, LeaveController, NavigationGuard, type WtInput } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { LocalHolidayModel } from "../holiday-types.js";
import { HoursApi } from "./hours-client.js";
import "./local-holidays-editor.js";
import "./hours-screen.js";

const model: LocalHolidayModel = {
  venue: { country: "ES", provinceCode: "41", city: "Sevilla" },
  localEntryLimit: 2,
  areaOptions: [],
  areaRequired: false,
  geographies: [
    {
      id: "g1",
      country: "ES",
      provinceCode: "41",
      city: "Sevilla",
      areaKey: null,
      matchesVenue: true,
    },
  ],
  entries: [{ id: "e1", geographyId: "g1", date: "2026-05-30", name: "San Fernando" }],
};
class HolidayLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: HoursApi;
  hours = false;
  override render() {
    return html`${this.hours ? html`<dashboard-hours-screen .api=${this.api}></dashboard-hours-screen>` : html`<local-holidays-editor .api=${this.api}></local-holidays-editor>`}
    ${this.leave.render({ heading: "Unsaved changes", message: "Discard unsaved changes?", keepLabel: "Keep editing", discardLabel: "Discard changes" })}`;
  }
}
customElements.define("holiday-leave-test-app", HolidayLeaveApp);
let app: HolidayLeaveApp;
let guard: NavigationGuard | undefined;
afterEach(() => {
  guard?.dispose();
  guard = undefined;
  app?.remove();
});
async function mount(
  write: () => Promise<void> = async () => {},
  refreshFails = false,
  initial = model,
  hours = false,
) {
  setLocale("en");
  let written = false;
  let current = structuredClone(initial);
  const writes: unknown[] = [];
  const request = async (path: string, method: string, body?: unknown) => {
    if (method === "GET") {
      if (hours && !path.endsWith("/local-holidays"))
        return {
          timeZone: "Europe/Madrid",
          dayCutover: "06:00",
          civilDate: "2026-10-07",
          clockReadable: true,
          subjects: [],
          week: [],
          days: [],
          specialDates: [],
          specialCells: [],
          holidayCoverage: [],
          holidaySources: [],
        };
      if (written && refreshFails) throw { code: "connection.failed" };
      return structuredClone(current);
    }
    writes.push([path, body]);
    await write();
    written = true;
  };
  app = document.createElement("holiday-leave-test-app") as HolidayLeaveApp;
  app.api = new HoursApi(request as DashboardRequest);
  app.hours = hours;
  applyTokens(app);
  document.body.append(app);
  await app.updateComplete;
  const owner = hours ? app.shadowRoot!.querySelector("dashboard-hours-screen")! : app;
  if (hours)
    await expect.poll(() => owner.shadowRoot?.querySelector("local-holidays-editor")).toBeTruthy();
  const screen = owner.shadowRoot!.querySelector("local-holidays-editor")!;
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=add-local]")).toBeTruthy();
  return {
    screen,
    writes,
    refresh: async (next = current) => {
      current = next;
      app.api.rereadWatches();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await screen.updateComplete;
    },
  };
}
type Screen = HTMLElementTagNameMap["local-holidays-editor"];
async function open(screen: Screen, edit = false) {
  if (edit) {
    const table = screen.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    table.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-local]")!.click();
  } else screen.shadowRoot!.querySelector<HTMLElement>("[data-test=add-local]")!.click();
  await screen.updateComplete;
  await modal(screen)!.updateComplete;
}
const modal = (screen: Screen) => screen.shadowRoot!.querySelector("wt-modal");
const field = (screen: Screen, name = "holidayName") =>
  screen.shadowRoot!.querySelector<WtInput>(`[name=${name}]`)!;
async function input(screen: Screen, value: string, name = "holidayName") {
  const host = field(screen, name);
  await host.updateComplete;
  await userEvent.fill(page.elementLocator(host.shadowRoot!.querySelector("input")!), value);
  await screen.updateComplete;
}
const cancel = (screen: Screen) =>
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-local]")!.click();
const save = (screen: Screen) =>
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save-local]")!.click();
async function question() {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
async function choose(decision: "keep" | "discard") {
  const q = await question();
  q.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => q.open).toBe(false);
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

for (const route of ["cancel", "escape"] as const) {
  it(`local holiday ${route} retains its draft until Discard, without a write`, async () => {
    const { screen, writes } = await mount();
    await open(screen);
    await input(screen, "Feria");
    if (route === "cancel") cancel(screen);
    else await userEvent.keyboard("{Escape}");
    expect((await question()).open).toBe(true);
    expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
    await choose("keep");
    expect(field(screen).value).toBe("Feria");
    cancel(screen);
    expect((await question()).open).toBe(true);
    await choose("discard");
    await expect.poll(() => modal(screen)).toBeNull();
    expect(writes).toEqual([]);
    expect(unload()).toBe(false);
  });
}

it("clean creation and a trimmed edit revert close without a question", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  cancel(screen);
  await expect.poll(() => modal(screen)).toBeNull();
  await open(screen, true);
  await input(screen, "Different holiday");
  expect(unload()).toBe(true);
  await input(screen, " San Fernando ");
  expect(unload()).toBe(false);
  cancel(screen);
  await expect.poll(() => modal(screen)).toBeNull();
  expect((await question()).open).toBe(false);
  expect(writes).toEqual([]);
});

it("an unchanged entry closes without any question or write", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  expect(unload()).toBe(false);
  cancel(screen);
  await expect.poll(() => modal(screen)).toBeNull();
  expect((await question()).open).toBe(false);
  expect(writes).toEqual([]);
});

it("page leave restores only the local entry, and Keep retains date and name", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  await input(screen, "2026-09-08", "holidayDate");
  await input(screen, "Feria");
  let left = false;
  const leave = () =>
    app.leave.coordinator.request({
      scopes: [screen],
      reason: "navigation",
      proceed: () => {
        left = true;
      },
    });
  const first = leave();
  expect((await question()).open).toBe(true);
  await choose("keep");
  expect(await first).toBe("kept");
  expect(left).toBe(false);
  expect(field(screen).value).toBe("Feria");
  expect(field(screen, "holidayDate").value).toBe("2026-09-08");
  const second = leave();
  await choose("discard");
  expect(await second).toBe("proceeded");
  expect(left).toBe(true);
  expect(field(screen).value).toBe("");
  expect(field(screen, "holidayDate").value).toBe("");
  expect(writes).toEqual([]);
});

for (const succeeds of [true, false]) {
  it(`local holiday ${succeeds ? "commits before a failed refresh" : "refusal keeps the entry protected"}`, async () => {
    const { screen, writes } = await mount(async () => {
      if (!succeeds) throw { code: "holiday.date_taken", params: { date: "2026-09-08" } };
    }, succeeds);
    await open(screen);
    await input(screen, "2026-09-08", "holidayDate");
    await input(screen, " Feria ");
    save(screen);
    await expect
      .poll(() => writes)
      .toEqual([
        ["/management-api/venue-service/local-holidays", { date: "2026-09-08", name: "Feria" }],
      ]);
    if (succeeds) {
      await expect.poll(() => modal(screen)).toBeNull();
      expect(unload()).toBe(false);
      await expect
        .poll(() => screen.shadowRoot!.querySelector("[data-test=local-alert]")?.textContent)
        .toContain("could not be loaded");
    } else {
      await expect
        .poll(() => field(screen, "holidayDate").error)
        .toContain("already has a local holiday");
      cancel(screen);
      expect((await question()).open).toBe(true);
      expect(field(screen).value).toBe(" Feria ");
    }
  });
}

it("the actual Hours tab keeps the local entry visible until its URL is accepted", async () => {
  history.replaceState(null, "", "/manage/hours/view/dates");
  const { screen, writes } = await mount(undefined, false, model, true);
  guard = new NavigationGuard(window, {
    isDirty: () => app.leave.coordinator.isDirty(),
    request: (proceed, signal) =>
      app.leave.coordinator.request({ scopes: [screen], reason: "navigation", proceed, signal }),
  });
  const hours = app.shadowRoot!.querySelector("dashboard-hours-screen")!;
  const tabs = hours.shadowRoot!.querySelector("wt-tabs")!;
  await tabs.updateComplete;
  await open(screen);
  await input(screen, "Feria");
  const select = async () => {
    tabs.shadowRoot!.querySelector<HTMLButtonElement>("[data-key=calendar]")!.click();
    await hours.updateComplete;
    await tabs.updateComplete;
  };
  await select();
  expect((await question()).open).toBe(true);
  expect(tabs.value).toBe("dates");
  expect(screen.isConnected).toBe(true);
  expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect(location.pathname).toBe("/manage/hours/view/dates");
  await choose("keep");
  expect(field(screen).value).toBe("Feria");
  expect(tabs.value).toBe("dates");
  await select();
  await choose("discard");
  await expect.poll(() => tabs.value).toBe("calendar");
  expect(screen.isConnected).toBe(false);
  expect(location.pathname).toBe("/manage/hours/view/calendar");
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});

it("a live entry change cannot replace the opening baseline or invalidate its pending question", async () => {
  const { screen, refresh } = await mount();
  await open(screen, true);
  await input(screen, "Feria");
  cancel(screen);
  expect((await question()).open).toBe(true);
  await refresh({ ...model, entries: [{ ...model.entries[0]!, name: "Feria" }] });
  expect((await question()).open).toBe(true);
  await choose("keep");
  expect(field(screen).value).toBe("Feria");
  expect(unload()).toBe(true);
  await input(screen, "San Fernando");
  expect(unload()).toBe(false);
});

it("disconnect releases the entry and makes its pending discard inert", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  await input(screen, "Feria");
  cancel(screen);
  const oldQuestion = await question();
  expect(oldQuestion.open).toBe(true);
  screen.remove();
  await expect.poll(() => oldQuestion.open).toBe(false);
  expect(unload()).toBe(false);
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  await open(screen);
  await input(screen, "New holiday");
  oldQuestion.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(field(screen).value).toBe("New holiday");
  expect(unload()).toBe(true);
  expect(writes).toEqual([]);
});

it("retained input, Cancel and Save controls cannot alter the next editor", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  const oldField = field(screen);
  const oldCancel = screen.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-local]")!;
  const oldSave = screen.shadowRoot!.querySelector<HTMLElement>("[data-test=save-local]")!;
  cancel(screen);
  await expect.poll(() => modal(screen)).toBeNull();
  await open(screen);
  await input(screen, "2026-09-08", "holidayDate");
  await input(screen, "New holiday");
  oldField.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Old holiday" },
      bubbles: true,
      composed: true,
    }),
  );
  oldCancel.click();
  oldSave.click();
  await screen.updateComplete;
  expect(field(screen).value).toBe("New holiday");
  expect(modal(screen)!.open).toBe(true);
  expect(writes).toEqual([]);
  expect(unload()).toBe(true);
});

it("a disconnected save reply cannot close or commit its replacement", async () => {
  let finish!: () => void;
  const { screen, writes } = await mount(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await open(screen);
  await input(screen, "2026-09-08", "holidayDate");
  await input(screen, "Old holiday");
  save(screen);
  await expect.poll(() => writes.length).toBe(1);
  screen.remove();
  app.shadowRoot!.append(screen);
  await screen.updateComplete;
  await open(screen);
  await input(screen, "New holiday");
  finish();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await screen.updateComplete;
  expect(modal(screen)!.open).toBe(true);
  expect(field(screen).value).toBe("New holiday");
  expect(unload()).toBe(true);
});

it("a busy entry stays open without an extra discard question", async () => {
  let finish!: () => void;
  const { screen, writes } = await mount(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await open(screen);
  await input(screen, "2026-09-08", "holidayDate");
  await input(screen, "Feria");
  save(screen);
  await expect.poll(() => writes.length).toBe(1);
  await screen.updateComplete;
  cancel(screen);
  field(screen).focus();
  await userEvent.keyboard("{Escape}");
  expect(modal(screen)!.shadowRoot!.querySelector("dialog")!.open).toBe(true);
  expect((await question()).open).toBe(false);
  finish();
  await expect.poll(() => modal(screen)).toBeNull();
  expect(unload()).toBe(false);
});

it("an accepted entry save invalidates an unanswered leave decision", async () => {
  const { screen, writes } = await mount();
  await open(screen);
  await input(screen, "2026-09-08", "holidayDate");
  await input(screen, "Feria");
  cancel(screen);
  const q = await question();
  expect(q.open).toBe(true);
  save(screen);
  await expect.poll(() => modal(screen)).toBeNull();
  await expect.poll(() => q.open).toBe(false);
  q.dispatchEvent(
    new CustomEvent("wt-unsaved-choice", {
      detail: { decision: "discard" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(writes).toEqual([
    ["/management-api/venue-service/local-holidays", { date: "2026-09-08", name: "Feria" }],
  ]);
  expect(unload()).toBe(false);
});

it("remove confirmation is exempt and closes without another question", async () => {
  const { screen, writes } = await mount();
  const table = screen.shadowRoot!.querySelector("wt-data-table")!;
  await table.updateComplete;
  table.shadowRoot!.querySelector<HTMLElement>("[data-test=remove-local]")!.click();
  await screen.updateComplete;
  await modal(screen)!.updateComplete;
  expect(unload()).toBe(false);
  cancel(screen);
  await expect.poll(() => modal(screen)).toBeNull();
  expect((await question()).open).toBe(false);
  expect(writes).toEqual([]);
});

for (const succeeds of [true, false]) {
  it(`immediate holiday area ${succeeds ? "save" : "refusal"} is exempt from draft warnings`, async () => {
    const { screen, writes } = await mount(
      async () => {
        if (!succeeds) throw { code: "holiday.invalid", params: { field: "areaKey" } };
      },
      false,
      {
        ...model,
        areaOptions: [{ key: "aran", name: "Arán" }],
        areaRequired: true,
      },
    );
    const area =
      screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=holidayArea]")!;
    await chooseOption(area, "aran");
    await expect
      .poll(() => writes)
      .toEqual([["/management-api/venue-service/holiday-area", { areaKey: "aran" }]]);
    if (!succeeds) await expect.poll(() => area.error).toBe("Choose one of the areas offered.");
    expect(unload()).toBe(false);
    let left = false;
    expect(
      await app.leave.coordinator.request({
        scopes: [screen],
        reason: "navigation",
        proceed: () => {
          left = true;
        },
      }),
    ).toBe("proceeded");
    expect(left).toBe(true);
    expect((await question()).open).toBe(false);
  });
}
