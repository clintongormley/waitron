import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import type { DashboardApi, RosterSnapshot, Shift } from "../api/client.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./roster-screen.js";

const shift: Shift = {
  id: "s1",
  personId: "p1",
  locationId: "loc-1",
  rosterVersionId: "v1",
  startsAt: "2027-01-04T07:00:00Z",
  startsOffsetMinutes: 120,
  endsAt: "2027-01-04T15:00:00Z",
  endsOffsetMinutes: 120,
  role: "bar",
};
const snapshot: RosterSnapshot = {
  version: {
    id: "v1",
    locationId: "loc-1",
    periodStart: "2027-01-04",
    periodEnd: "2027-01-10",
    status: "draft",
    publishedAt: null,
    publishedByPersonId: null,
  },
  shifts: [shift],
};
class RosterLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-roster-screen .api=${this.api}></dashboard-roster-screen
      >${this.leave.render({
        heading: t("unsaved.heading"),
        message: t("unsaved.message"),
        keepLabel: t("unsaved.keep"),
        discardLabel: t("unsaved.discard"),
      })}`;
  }
}
customElements.define("roster-leave-test-app", RosterLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
async function mount(
  write: (method: string, body: unknown) => Promise<unknown>,
  refresh: () => void = () => {},
) {
  let reads = 0;
  const api = {
    getLocations: async () => [{ id: "loc-1", name: "Main" }],
    listStaff: async () => [],
    getRoster: async () => {
      if (reads++ > 0) refresh();
      return snapshot;
    },
    addShift: async (_version: string, body: unknown) => write("add", body),
    updateShift: async (_id: string, body: unknown) => write("update", body),
    removeShift: async (id: string) => write("remove", id),
  } as unknown as DashboardApi;
  setLocale("en-GB");
  const { el: app } = await mountWidget<RosterLeaveApp>("roster-leave-test-app", { api });
  const screen = app.shadowRoot!.querySelector("dashboard-roster-screen")!;
  await expect.poll(() => reads).toBe(1);
  await screen.updateComplete;
  return { app, screen };
}
async function editor(screen: HTMLElementTagNameMap["dashboard-roster-screen"], add = false) {
  screen.openCell("p1", "2027-01-04", add ? null : shift);
  await screen.updateComplete;
  const form = screen.shadowRoot!.querySelector("dashboard-shift-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  const field =
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=shift-role]")!;
  await field.updateComplete;
  await userEvent.fill(page.elementLocator(field.shadowRoot!.querySelector("input")!), "kitchen");
  if (add)
    for (const [name, value] of [
      ["start", "09:00"],
      ["end", "17:00"],
    ]) {
      const time = form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
        `[data-test=shift-${name}]`,
      )!;
      await time.updateComplete;
      await userEvent.fill(page.elementLocator(time.shadowRoot!.querySelector("input")!), value!);
    }
  await form.updateComplete;
  return form;
}
for (const method of ["add", "update", "remove"]) {
  it(`a successful ${method} shift clears its warning before the refresh begins`, async () => {
    let writeBody: unknown;
    let warnedDuringRefresh: boolean | undefined;
    const { app, screen } = await mount(
      async (name, body) => {
        expect(name).toBe(method);
        writeBody = body;
        return { shiftId: "s1" };
      },
      () => {
        warnedDuringRefresh = unload();
      },
    );
    const form = await editor(screen, method === "add");
    expect(unload()).toBe(true);
    form
      .shadowRoot!.querySelector<HTMLElement>(
        `[data-test=${method === "remove" ? "remove" : "confirm"}]`,
      )!
      .click();
    await expect.poll(() => warnedDuringRefresh).toBe(false);
    await expect.poll(() => form.open).toBe(false);
    expect(app.leave.coordinator.isDirty()).toBe(false);
    if (method === "remove") expect(writeBody).toBe("s1");
    else
      expect(writeBody).toEqual({
        ...(method === "add" ? { personId: "p1", locationId: "loc-1" } : {}),
        startsAt: method === "add" ? "2027-01-04T09:00:00Z" : "2027-01-04T07:00:00Z",
        startsOffsetMinutes: method === "add" ? 0 : 120,
        endsAt: method === "add" ? "2027-01-04T17:00:00Z" : "2027-01-04T15:00:00Z",
        endsOffsetMinutes: method === "add" ? 0 : 120,
        role: "kitchen",
      });
  });
}
it("a refused shift write retains edited values and asks on Escape", async () => {
  const { app, screen } = await mount(async () => {
    throw { code: "shift.invalid" };
  });
  const form = await editor(screen);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("[data-test=error]")).not.toBeNull();
  expect(form.open).toBe(true);
  expect(unload()).toBe(true);
  await userEvent.keyboard("{Escape}");
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  expect(q.open).toBe(true);
  q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!.click();
  await expect.poll(() => q.open).toBe(false);
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=shift-role]")!
      .value,
  ).toBe("kitchen");
});

it("a late shift write cannot close the replacement editor", async () => {
  let finish!: (value: unknown) => void;
  let started = false;
  const { app, screen } = await mount(() => {
    started = true;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const form = await editor(screen);
  form.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm]")!.click();
  await expect.poll(() => started).toBe(true);
  screen.openCell("p1", "2027-01-04", { ...shift, id: "s2", role: "terrace" });
  await screen.updateComplete;
  await form.updateComplete;
  expect(form.open).toBe(true);
  finish(undefined);
  await expect.poll(() => form.busy).toBe(false);
  expect(form.open).toBe(true);
  expect(form.shift?.id).toBe("s2");
  expect(
    form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[data-test=shift-role]")!
      .value,
  ).toBe("terrace");
  expect(app.leave.coordinator.isDirty()).toBe(false);
});
