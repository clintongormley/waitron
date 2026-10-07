import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import type { Station } from "../api/client.js";
import "./station-choice-dialog.js";
import type { TillStationChoiceDialog } from "./station-choice-dialog.js";

const stations: Station[] = [
  { id: "grill", name: "Grill", displayOrder: 0, isDefault: true, active: true, open: true },
  { id: "bar", name: "Bar", displayOrder: 1, isDefault: false, active: true, open: false },
];
class StationLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  mode: "move" | "make-at" = "make-at";
  currentStationId: string | null = "grill";
  stations = stations;
  closes = 0;
  chosen: unknown[] = [];
  override render() {
    return html`<till-station-choice-dialog
        .mode=${this.mode}
        .dishName=${"Soup"}
        .stations=${this.stations}
        .currentStationId=${this.currentStationId}
        @close=${() => this.closes++}
        @station-chosen=${(e: CustomEvent) => this.chosen.push(e.detail)}
      ></till-station-choice-dialog
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("station-leave-test-app", StationLeaveApp);
beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);
async function mount(props: Partial<StationLeaveApp> = {}) {
  const { el: app } = await mountWidget<StationLeaveApp>("station-leave-test-app", props);
  const form = app.shadowRoot!.querySelector<TillStationChoiceDialog>(
    "till-station-choice-dialog",
  )!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  return { app, form };
}
function field(form: TillStationChoiceDialog) {
  return form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox")!;
}
async function choose(form: TillStationChoiceDialog, value: string | null) {
  const f = field(form);
  f.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
  await f.updateComplete;
  const index = f.options.findIndex((o) =>
    value === null ? o.value !== "grill" && o.value !== "bar" : o.value === value,
  );
  f.shadowRoot!.querySelectorAll<HTMLElement>("[role=option]")[index]!.click();
  await form.updateComplete;
}
function cancel(form: TillStationChoiceDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-cancel]")!.click();
}
function submit(form: TillStationChoiceDialog) {
  form.shadowRoot!.querySelector<HTMLElement>("[data-submit]")!.click();
}
async function question(app: StationLeaveApp) {
  await app.updateComplete;
  const q = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await q.updateComplete;
  await q.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  return q;
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
for (const mode of ["make-at", "move"] as const) {
  for (const action of ["Cancel", "Escape"]) {
    it(`${mode} ${action} keeps the selected station then discards without submitting`, async () => {
      const { app, form } = await mount({ mode });
      await choose(form, "bar");
      if (action === "Cancel") cancel(form);
      else await userEvent.keyboard("{Escape}");
      const q = await question(app);
      expect(q.open).toBe(true);
      expect(app.closes).toBe(0);
      expect(app.chosen).toEqual([]);
      q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
      await expect.poll(() => q.open).toBe(false);
      expect(field(form).value).toBe("bar");
      expect(unload()).toBe(true);
      cancel(form);
      await question(app);
      q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
      await expect.poll(() => app.closes).toBe(1);
      await form.updateComplete;
      expect(field(form).value).toBe("grill");
      expect(form.shadowRoot!.querySelector("wt-dialog")!.open).toBe(false);
      expect(app.chosen).toEqual([]);
      expect(unload()).toBe(false);
    });
  }
  it(`${mode} clean and reverted choices close directly`, async () => {
    const { app, form } = await mount({ mode });
    await choose(form, "bar");
    expect(unload()).toBe(true);
    await choose(form, "grill");
    expect(unload()).toBe(false);
    cancel(form);
    await expect.poll(() => app.closes).toBe(1);
    expect((await question(app)).open).toBe(false);
  });
}
it("rules are a distinct choice and Save commits null without a warning", async () => {
  const { app, form } = await mount();
  await choose(form, null);
  expect(unload()).toBe(true);
  submit(form);
  expect(app.chosen).toEqual([{ stationId: null }]);
  expect(unload()).toBe(false);
  cancel(form);
  await expect.poll(() => app.closes).toBe(1);
  expect((await question(app)).open).toBe(false);
});
it("a Move refusal retains its uncommitted destination", async () => {
  const { app, form } = await mount({ mode: "move" });
  await choose(form, "bar");
  submit(form);
  expect(app.chosen).toEqual([{ stationId: "bar" }]);
  expect((await question(app)).open).toBe(false);
  form.refusal = "ticket.already_started";
  await form.updateComplete;
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(field(form).value).toBe("bar");
  expect(app.closes).toBe(0);
});
it("background current station and option ordering do not replace the opening selection", async () => {
  const { app, form } = await mount();
  app.currentStationId = "bar";
  app.stations = [...stations].reverse();
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  expect(field(form).value).toBe("grill");
  expect(unload()).toBe(false);
  await choose(form, "bar");
  cancel(form);
  expect((await question(app)).open).toBe(true);
});
it("reconnect retains the opening baseline and departed controls cannot submit", async () => {
  const { app, form } = await mount();
  await choose(form, "bar");
  cancel(form);
  const q = await question(app);
  expect(q.open).toBe(true);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  form.remove();
  expect(unload()).toBe(false);
  submit(form);
  cancel(form);
  oldDiscard.click();
  await app.updateComplete;
  expect(app.chosen).toEqual([]);
  expect(app.closes).toBe(0);
  app.shadowRoot!.prepend(form);
  await form.updateComplete;
  cancel(form);
  expect((await question(app)).open).toBe(true);
  expect(field(form).value).toBe("bar");
});
it("a local Save invalidates a pending discard and newer changes compare against the saved choice", async () => {
  const { app, form } = await mount();
  await choose(form, "bar");
  cancel(form);
  const q = await question(app);
  const oldDiscard = q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!;
  submit(form);
  await expect.poll(() => q.open).toBe(false);
  oldDiscard.click();
  expect(app.closes).toBe(0);
  expect(app.chosen).toEqual([{ stationId: "bar" }]);
  expect(unload()).toBe(false);
  await choose(form, "grill");
  expect(unload()).toBe(true);
  cancel(form);
  await question(app);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => app.closes).toBe(1);
  await form.updateComplete;
  expect(field(form).value).toBe("bar");
});
it("departed selection events cannot change the draft", async () => {
  const { app, form } = await mount();
  const f = field(form);
  form.remove();
  f.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bar" } }));
  app.shadowRoot!.prepend(form);
  await form.updateComplete;
  expect(field(form).value).toBe("grill");
  expect(unload()).toBe(false);
});
it("discarding station choice leaves an independent parent draft dirty", async () => {
  const { app, form } = await mount();
  let value = "saved";
  const scope = app.leave.coordinator.register({
    id: app,
    current: () => value,
    snapshot: (v) => v,
    equal: (a, b) => a === b,
    restore: (v) => {
      value = v;
    },
  });
  value = "edited";
  scope.changed();
  await choose(form, "bar");
  cancel(form);
  const q = await question(app);
  q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => app.closes).toBe(1);
  expect(value).toBe("edited");
  expect(unload()).toBe(true);
  scope.dispose();
});
it("removing the opening station updates unload protection for the actual null submission", async () => {
  const { app, form } = await mount();
  app.stations = stations.filter((station) => station.id !== "grill");
  app.requestUpdate();
  await app.updateComplete;
  await form.updateComplete;
  expect(field(form).value).not.toBe("grill");
  expect(unload()).toBe(true);
  cancel(form);
  expect((await question(app)).open).toBe(true);
  submit(form);
  expect(app.chosen).toEqual([{ stationId: null }]);
  expect(unload()).toBe(false);
});
