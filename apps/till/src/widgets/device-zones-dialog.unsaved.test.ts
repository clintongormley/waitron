import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LeaveController, type LeaveReason } from "@waitron/ui";
import type { DeviceZoneSelection } from "@waitron/venue-service";
import { DeviceZonesDialog } from "./device-zones-dialog.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";

const selection: DeviceZoneSelection = {
  profileId: "profile",
  snapshot: "scope",
  selectedZoneIds: ["bar", "room"],
  startingZoneId: "bar",
  adjusted: false,
  zones: [
    {
      id: "bar",
      name: "Bar",
      departmentId: "dept",
      departmentName: "Venue",
      serviceMode: "prepay",
    },
    {
      id: "room",
      name: "Room",
      departmentId: "dept",
      departmentName: "Venue",
      serviceMode: "table_tab",
    },
  ],
};
class ZonesLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  closes = 0;
  writes = 0;
  override render() {
    return html`<till-device-zones-dialog
        .open=${true}
        .selection=${selection}
        @close-device-zones=${() => this.closes++}
        @save-device-zones=${() => this.writes++}
      ></till-device-zones-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("device-zones-leave-test-app", ZonesLeaveApp);
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
async function mount() {
  setLocale("en");
  const { el: app } = await mountWidget<ZonesLeaveApp>("device-zones-leave-test-app", {});
  const form = app.shadowRoot!.querySelector<DeviceZonesDialog>("till-device-zones-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  await userEvent.click(
    form.shadowRoot!.querySelector<HTMLInputElement>('input[name="starting-zone"][value="room"]')!,
  );
  return { app, form };
}
async function question(app: ZonesLeaveApp) {
  await app.updateComplete;
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await question.updateComplete;
  await question.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return question;
}
for (const way of ["Cancel", "Escape"] as const) {
  it(`${way} keeps the draft until Discard, without writing`, async () => {
    const { app, form } = await mount();
    if (way === "Escape") await userEvent.keyboard("{Escape}");
    else await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-zones-cancel]")!);
    const q = await question(app);
    expect(q.open).toBe(true);
    await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!);
    expect(
      form.shadowRoot!.querySelector<HTMLInputElement>('input[value="room"][type="radio"]')!
        .checked,
    ).toBe(true);
    expect(app.closes).toBe(0);
    await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-zones-cancel]")!);
    await question(app);
    const closed = new Promise<void>((resolve) =>
      form.addEventListener("close-device-zones", () => resolve(), { once: true }),
    );
    await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!);
    await closed;
    expect(app.closes).toBe(1);
    expect(app.writes).toBe(0);
    expect(app.leave.coordinator.isDirty()).toBe(false);
  });
}
it.each(["navigation", "signout"] as LeaveReason[])(
  "a %s request protects the same draft",
  async (reason) => {
    const { app, form } = await mount();
    let left = 0;
    const keep = app.leave.coordinator.request({
      scopes: "all",
      reason,
      proceed: () => {
        left++;
      },
    });
    const q = await question(app);
    await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>('[data-choice="keep"]')!);
    await keep;
    expect(left).toBe(0);
    expect(
      form.shadowRoot!.querySelector<HTMLInputElement>('input[value="room"][type="radio"]')!
        .checked,
    ).toBe(true);
    const discard = app.leave.coordinator.request({
      scopes: "all",
      reason,
      proceed: () => {
        left++;
      },
    });
    await question(app);
    await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>('[data-choice="discard"]')!);
    await discard;
    expect(left).toBe(1);
    expect(app.writes).toBe(0);
  },
);
it("a saved snapshot retires its warning before a refresh can fail", async () => {
  const { app, form } = await mount();
  expect(app.leave.coordinator.isDirty()).toBe(true);
  form.acceptSaved({
    profileId: "profile",
    snapshot: "scope",
    selectedZoneIds: ["bar", "room"],
    startingZoneId: "room",
  });
  expect(app.leave.coordinator.isDirty()).toBe(false);
  await form.updateComplete;
  expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
});
it("security teardown invalidates an unanswered close and leaves no unload warning", async () => {
  const { app, form } = await mount();
  await userEvent.click(form.shadowRoot!.querySelector<HTMLElement>("[data-zones-cancel]")!);
  const q = await question(app);
  expect(q.open).toBe(true);
  app.leave.forceReset();
  form.remove();
  await app.updateComplete;
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(app.closes).toBe(0);
  expect(app.writes).toBe(0);
});
