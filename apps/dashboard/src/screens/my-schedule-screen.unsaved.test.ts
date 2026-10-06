import { afterEach, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, MyShift } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./my-schedule-screen.js";

class ScheduleLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-my-schedule-screen
        .api=${this.api}
        myPersonId="me"
      ></dashboard-my-schedule-screen
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("schedule-leave-test-app", ScheduleLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});

const shift: MyShift = {
  id: "shift-1",
  locationId: "loc-1",
  startsAt: "2026-10-07T09:00:00Z",
  endsAt: "2026-10-07T17:00:00Z",
  startsOffsetMinutes: 0,
  endsOffsetMinutes: 0,
  role: "bar",
  rosterVersionId: null,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(overrides: Partial<DashboardApi> = {}) {
  const liveData = new LiveData();
  const api = {
    liveData,
    getStaffRoster: async () => [
      { personId: "me", displayName: "Me" },
      { personId: "colleague", displayName: "Colleague" },
    ],
    listMyShifts: async () => [shift],
    listMySwaps: async () => [],
    listMyAbsences: async () => [],
    requestSwap: async () => ({ swapId: "swap-1" }),
    requestAbsence: async () => ({ absenceId: "absence-1" }),
    acceptSwap: async () => {},
    ...overrides,
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<ScheduleLeaveApp>("schedule-leave-test-app", { api });
  const screen = app.shadowRoot!.querySelector("dashboard-my-schedule-screen")!;
  await expect
    .poll(() => screen.shadowRoot?.querySelector("[data-test=shift-shift-1]"))
    .toBeTruthy();
  return { app, screen, liveData };
}
type Screen = HTMLElementTagNameMap["dashboard-my-schedule-screen"];
async function change(screen: Screen, name: string, value: string) {
  screen
    .shadowRoot!.querySelector(`[data-test=${name}]`)!
    .dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
  await screen.updateComplete;
}
function value(screen: Screen, name: string) {
  return (
    screen.shadowRoot!.querySelector(`[data-test=${name}]`) as HTMLElement & { value: string }
  ).value;
}
function click(screen: Screen, name: string) {
  screen.shadowRoot!.querySelector<HTMLElement>(`[data-test=${name}]`)!.click();
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function choose(app: ScheduleLeaveApp, decision: "keep" | "discard") {
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")?.open).toBe(true);
  app
    .shadowRoot!.querySelector("wt-unsaved-changes")!
    .dispatchEvent(
      new CustomEvent("wt-unsaved-choice", { detail: { decision }, bubbles: true, composed: true }),
    );
  await app.updateComplete;
}
async function cover(screen: Screen) {
  await change(screen, "cover-shift", "shift-1");
  await change(screen, "cover-colleague", "colleague");
}
async function absence(screen: Screen) {
  await change(screen, "abs-from", "2026-10-10");
  await change(screen, "abs-to", "2026-10-12");
  await change(screen, "abs-note", "Family visit");
}

for (const name of [
  "cover-shift",
  "cover-colleague",
  "abs-kind",
  "abs-from",
  "abs-to",
  "abs-note",
]) {
  it(`protects ${name} and stops warning after its exact revert`, async () => {
    const { screen } = await mount();
    const initial = value(screen, name);
    expect(unload()).toBe(false);
    const changed = {
      "cover-shift": "shift-1",
      "cover-colleague": "colleague",
      "abs-kind": "sick_leave",
      "abs-from": "2026-10-10",
      "abs-to": "2026-10-12",
      "abs-note": " ",
    }[name]!;
    await change(screen, name, changed);
    expect(unload()).toBe(true);
    await change(screen, name, initial);
    expect(unload()).toBe(false);
  });
}
it("Keep retains both drafts and Discard restores both before leaving once", async () => {
  const { app, screen } = await mount();
  await cover(screen);
  await absence(screen);
  let left = 0;
  const request = () =>
    app.leave.coordinator.request({
      scopes: "all",
      reason: "navigation",
      proceed() {
        left++;
      },
    });
  const kept = request();
  await choose(app, "keep");
  expect(await kept).toBe("kept");
  expect(left).toBe(0);
  expect(value(screen, "cover-shift")).toBe("shift-1");
  expect(value(screen, "abs-note")).toBe("Family visit");
  const discarded = request();
  await choose(app, "discard");
  expect(await discarded).toBe("proceeded");
  await screen.updateComplete;
  expect(left).toBe(1);
  for (const name of ["cover-shift", "cover-colleague", "abs-from", "abs-to", "abs-note"])
    expect(value(screen, name)).toBe("");
  expect(unload()).toBe(false);
});
for (const kind of ["cover", "absence"] as const) {
  it(`successful ${kind} request commits before failed refresh while preserving the other draft`, async () => {
    let body: unknown;
    let written = false;
    const { app, screen } = await mount({
      requestSwap: async (input) => {
        body = input;
        written = true;
        return { swapId: "swap-1" };
      },
      requestAbsence: async (input) => {
        body = input;
        written = true;
        return { absenceId: "absence-1" };
      },
      listMySwaps: async () => {
        if (written) throw { code: "connection.failed" };
        return [];
      },
    });
    await cover(screen);
    await absence(screen);
    if (kind === "absence") await change(screen, "abs-kind", "sick_leave");
    click(screen, kind === "cover" ? "cover-submit" : "abs-submit");
    await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=notice]")).toBeTruthy();
    expect(body).toEqual(
      kind === "cover"
        ? { fromShiftId: "shift-1", toPersonId: "colleague", toShiftId: null }
        : {
            kind: "sick_leave",
            startsOn: "2026-10-10",
            endsOn: "2026-10-12",
            note: "Family visit",
          },
    );
    expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
    expect(unload()).toBe(true);
    if (kind === "cover") {
      expect(value(screen, "cover-shift")).toBe("");
      expect(value(screen, "abs-note")).toBe("Family visit");
      await change(screen, "abs-from", "");
      await change(screen, "abs-to", "");
      await change(screen, "abs-note", "");
    } else {
      expect(value(screen, "abs-note")).toBe("");
      expect(value(screen, "cover-shift")).toBe("shift-1");
      await change(screen, "cover-shift", "");
      await change(screen, "cover-colleague", "");
    }
    expect(unload()).toBe(false);
  });
  it(`a refused ${kind} request retains its values and protection`, async () => {
    const refuse = async () => {
      throw { code: "connection.failed" };
    };
    const { screen } = await mount({ requestSwap: refuse, requestAbsence: refuse });
    if (kind === "cover") await cover(screen);
    else await absence(screen);
    click(screen, kind === "cover" ? "cover-submit" : "abs-submit");
    await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=notice]")).toBeTruthy();
    expect(value(screen, kind === "cover" ? "cover-colleague" : "abs-note")).toBe(
      kind === "cover" ? "colleague" : "Family visit",
    );
    expect(unload()).toBe(true);
  });
}
it("later note input survives an accepted time-off request and is still protected", async () => {
  const write = deferred<{ absenceId: string }>();
  let reads = 0;
  const { screen } = await mount({
    requestAbsence: () => write.promise,
    listMySwaps: async () => {
      reads++;
      return [];
    },
  });
  await absence(screen);
  click(screen, "abs-submit");
  await change(screen, "abs-note", "New request note");
  write.resolve({ absenceId: "absence-1" });
  await expect.poll(() => reads).toBe(2);
  await screen.updateComplete;
  expect(value(screen, "abs-note")).toBe("New request note");
  expect(unload()).toBe(true);
  await change(screen, "abs-note", "Family visit");
  expect(unload()).toBe(false);
});
it("disconnect disposes scopes and an older request cannot clear a reconnected draft", async () => {
  const write = deferred<{ absenceId: string }>();
  const { app, screen } = await mount({ requestAbsence: () => write.promise });
  await absence(screen);
  click(screen, "abs-submit");
  screen.remove();
  expect(unload()).toBe(false);
  app.shadowRoot!.prepend(screen);
  await screen.updateComplete;
  await change(screen, "abs-note", "Replacement request");
  write.resolve({ absenceId: "absence-1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await screen.updateComplete;
  expect(value(screen, "abs-note")).toBe("Replacement request");
  expect(unload()).toBe(true);
  await change(screen, "abs-note", "");
  expect(unload()).toBe(false);
});
it("live list recovery retains the time-off draft and its original baseline", async () => {
  let reads = 0;
  const { screen, liveData } = await mount({
    listMyAbsences: async () => {
      reads++;
      return [];
    },
  });
  await change(screen, "abs-note", "Still writing");
  liveData.invalidate([{ type: "absences", id: "other" }]);
  await expect.poll(() => reads).toBe(2);
  expect(value(screen, "abs-note")).toBe("Still writing");
  expect(unload()).toBe(true);
  await change(screen, "abs-note", "");
  expect(unload()).toBe(false);
});

it("an unchanged live roster refresh cannot dismiss a time-off leave question", async () => {
  let reads = 0;
  const { app, screen, liveData } = await mount({
    getStaffRoster: async () => {
      reads++;
      return [{ personId: "me", displayName: "Me" }];
    },
  });
  await change(screen, "abs-note", "Still writing");
  const pending = app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {},
  });
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  liveData.invalidate([{ type: "persons", id: "me" }]);
  await expect.poll(() => reads).toBe(2);
  await screen.updateComplete;
  await app.updateComplete;
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  await choose(app, "keep");
  expect(await pending).toBe("kept");
  expect(value(screen, "abs-note")).toBe("Still writing");
});

it("a clean schedule leaves directly without a question or unload warning", async () => {
  const { app } = await mount();
  let left = 0;
  const result = await app.leave.coordinator.request({
    scopes: "all",
    reason: "navigation",
    proceed() {
      left++;
    },
  });
  expect(result).toBe("proceeded");
  expect(left).toBe(1);
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(unload()).toBe(false);
});
