import { LitElement, html } from "lit";
import { afterEach, expect, it } from "vitest";
import { LeaveController, type WtInput } from "@waitron/ui";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi, VenueDetailWrite, VenueDetailsModel } from "../api/client.js";
import { venueDetailsFixture, venueClockPreviewFixture } from "../testing/venue-details-fixture.js";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { setLocale, t } from "../i18n/t.js";
import "./venue-details-panel.js";
import { codeMessage } from "../i18n/codes.js";

class VenueDetailsLeaveApp extends LitElement {
  readonly leave = new LeaveController(this);
  api!: DashboardApi;
  override render() {
    return html`<dashboard-venue-details-panel .api=${this.api}></dashboard-venue-details-panel>
      ${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("venue-details-leave-test-app", VenueDetailsLeaveApp);
afterEach(() => {
  cleanupWidgets();
  setLocale("en-GB");
});
type Panel = HTMLElementTagNameMap["dashboard-venue-details-panel"];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function mount(overrides: Partial<DashboardApi> = {}) {
  let stored = venueDetailsFixture();
  const writes: VenueDetailWrite[] = [];
  const liveData = new LiveData();
  const api = {
    liveData,
    getVenueDetails: async () => structuredClone(stored),
    getVenueClockPreview: async () => venueClockPreviewFixture(),
    patchVenueDetails: async (body: VenueDetailWrite) => {
      writes.push(structuredClone(body));
      const result = overrides.patchVenueDetails
        ? await overrides.patchVenueDetails(body)
        : { changed: true, model: { ...stored, details: { ...stored.details, ...body.changes } } };
      stored = result.model;
      return result;
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "patchVenueDetails")),
  } as unknown as DashboardApi;
  const { el: app } = await mountWidget<VenueDetailsLeaveApp>("venue-details-leave-test-app", {
    api,
  });
  const panel = app.shadowRoot!.querySelector("dashboard-venue-details-panel")!;
  await expect.poll(() => panel.shadowRoot?.querySelector("[data-test=edit]")).toBeTruthy();
  click(panel, "edit");
  await panel.updateComplete;
  return { app, panel, writes, liveData };
}
function field(panel: Panel, name: string) {
  return panel.shadowRoot!.querySelector<WtInput>(`[name=${name}]`)!;
}
async function change(panel: Panel, name: string, value: string) {
  field(panel, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await panel.updateComplete;
}
function click(panel: Panel, action: string) {
  panel.shadowRoot!.querySelector<HTMLElement>(`[data-test=${action}]`)!.click();
}
function unload() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function leave(app: VenueDetailsLeaveApp) {
  return app.leave.coordinator.request({ scopes: "all", reason: "navigation", proceed() {} });
}
async function choose(app: VenueDetailsLeaveApp, decision: "keep" | "discard") {
  const warning = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await expect.poll(() => warning.open).toBe(true);
  await warning.updateComplete;
  warning.shadowRoot!.querySelector<HTMLElement>(`[data-choice=${decision}]`)!.click();
  await expect.poll(() => warning.open).toBe(false);
}

for (const [name, value, original] of [
  ["venueName", "Changed venue", " Venue "],
  ["addressLine1", "Different street", " Calle Mayor 1 "],
  ["addressLine2", "Floor 2", "   "],
  ["city", "Barcelona", "Madrid"],
  ["postalCode", "28002", " 28001 "],
  ["timeZone", "invalid-zone", "Europe/Madrid"],
  ["dayCutover", "not a time", "06:00:00"],
] as const) {
  it(`protects ${name}, including invalid values, and exempts its normalized revert`, async () => {
    const { app, panel } = await mount();
    expect(unload()).toBe(false);
    await change(panel, name, value);
    expect(unload()).toBe(true);
    const request = leave(app);
    await choose(app, "keep");
    expect(await request).toBe("kept");
    expect(field(panel, name).value).toBe(value);
    await change(panel, name, original);
    expect(unload()).toBe(false);
    expect(await leave(app)).toBe("proceeded");
  });
}
it("Cancel keeps the draft and Discard closes without writing", async () => {
  const { app, panel, writes } = await mount();
  await change(panel, "addressLine1", "Different street");
  click(panel, "cancel");
  await choose(app, "keep");
  expect(field(panel, "addressLine1").value).toBe("Different street");
  click(panel, "cancel");
  await choose(app, "discard");
  await expect.poll(() => panel.shadowRoot!.querySelector("wt-input")).toBeNull();
  expect(writes).toEqual([]);
  expect(unload()).toBe(false);
});
it("page discard restores the opening values in a retained editor", async () => {
  const { app, panel } = await mount();
  await change(panel, "addressLine1", "Different street");
  const request = leave(app);
  await choose(app, "discard");
  expect(await request).toBe("proceeded");
  await panel.updateComplete;
  expect(
    field(panel, "addressLine1").shadowRoot!.querySelector<HTMLInputElement>("input")!.value,
  ).toBe("Calle Mayor 1");
  expect(unload()).toBe(false);
});
it("an accepted write clears protection before a failed refresh", async () => {
  let reads = 0;
  const { panel, writes, app } = await mount({
    getVenueDetails: async () => {
      if (++reads > 1) throw { code: "connection.failed" };
      return venueDetailsFixture();
    },
  });
  await change(panel, "addressLine1", "Different street");
  click(panel, "save");
  await expect.poll(() => panel.shadowRoot!.querySelector("[data-test=read-error]")).toBeTruthy();
  expect(writes).toEqual([
    { changes: { addressLine1: "Different street" }, expected: venueDetailsFixture().details },
  ]);
  expect(panel.shadowRoot!.querySelector("wt-input")).toBeNull();
  expect(unload()).toBe(false);
  expect(await leave(app)).toBe("proceeded");
});
it("a refused write keeps the submitted values protected", async () => {
  const { app, panel } = await mount({
    patchVenueDetails: async () => {
      throw { code: "venue.detail_changed" };
    },
  });
  await change(panel, "addressLine1", "Different street");
  click(panel, "save");
  await expect.poll(() => panel.shadowRoot!.querySelector("wt-form-actions")?.error).toBeTruthy();
  expect(unload()).toBe(true);
  const request = leave(app);
  await choose(app, "keep");
  expect(await request).toBe("kept");
  expect(field(panel, "addressLine1").value).toBe("Different street");
});
for (const code of [
  "venue.detail_locked",
  "venue.detail_invalid",
  "venue.detail_read_only",
  "connection.failed",
] as const) {
  for (const fieldError of [false, true]) {
    it(`${code} ${fieldError ? "field" : "form"} refusal preserves the venue draft until Discard`, async () => {
      const { app, panel, writes } = await mount({
        patchVenueDetails: async () => {
          throw { code, params: fieldError ? { field: "addressLine1" } : undefined };
        },
      });
      await change(panel, "addressLine1", "Different street");
      click(panel, "save");
      const expected =
        code === "venue.detail_locked" || code === "venue.detail_read_only"
          ? t("venue_details.read_only")
          : code === "venue.detail_invalid"
            ? t("venue_details.invalid")
            : codeMessage(code);
      await expect
        .poll(() =>
          fieldError
            ? field(panel, "addressLine1").error
            : panel.shadowRoot!.querySelector("wt-form-actions")?.error,
        )
        .toBe(expected);
      expect(field(panel, "addressLine1").value).toBe("Different street");
      expect(unload()).toBe(true);
      expect(writes).toEqual([
        { changes: { addressLine1: "Different street" }, expected: venueDetailsFixture().details },
      ]);
      click(panel, "cancel");
      await choose(app, "discard");
      await expect.poll(() => panel.shadowRoot!.querySelector("wt-input")).toBeNull();
      expect(unload()).toBe(false);
    });
  }
}
it("live values do not reset the opening baseline, and disconnect invalidates a question", async () => {
  const model = venueDetailsFixture();
  let current: VenueDetailsModel = model;
  const { app, panel, liveData } = await mount({ getVenueDetails: async () => current });
  await change(panel, "addressLine1", "Different street");
  current = venueDetailsFixture({ addressLine1: "Live street" });
  liveData.invalidate([{ type: "locations" }]);
  const request = leave(app);
  await expect.poll(() => app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(true);
  panel.remove();
  expect(await request).toBe("stale");
  expect(unload()).toBe(false);
  app.shadowRoot!.prepend(panel);
  await panel.updateComplete;
  expect(unload()).toBe(true);
  const discarded = leave(app);
  await choose(app, "discard");
  expect(await discarded).toBe("proceeded");
  await panel.updateComplete;
  expect(field(panel, "addressLine1").value).toBe("Calle Mayor 1");
});
it("a pending write keeps Cancel disabled and older completion cannot close a reconnected draft", async () => {
  const write = deferred<{ changed: boolean; model: VenueDetailsModel }>();
  const { panel } = await mount({ patchVenueDetails: async () => write.promise });
  await change(panel, "addressLine1", "Different street");
  click(panel, "save");
  await panel.updateComplete;
  expect(panel.shadowRoot!.querySelector("[data-test=cancel]")!.hasAttribute("disabled")).toBe(
    true,
  );
  panel.remove();
  document.querySelector("venue-details-leave-test-app")!.shadowRoot!.prepend(panel);
  await panel.updateComplete;
  write.resolve({
    changed: true,
    model: venueDetailsFixture({ addressLine1: "Different street" }),
  });
  await expect.poll(() => field(panel, "addressLine1").value).toBe("Different street");
  expect(unload()).toBe(true);
});

it("a detached input cannot edit a replacement opening", async () => {
  const { panel } = await mount();
  const old = field(panel, "addressLine1");
  click(panel, "cancel");
  await panel.updateComplete;
  click(panel, "edit");
  await panel.updateComplete;
  old.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Stale street" },
      bubbles: true,
      composed: true,
    }),
  );
  await panel.updateComplete;
  expect(field(panel, "addressLine1").value).toBe("Calle Mayor 1");
  expect(unload()).toBe(false);
});

it("detached Cancel and Save controls cannot act on a replacement draft", async () => {
  const { app, panel, writes } = await mount();
  const oldCancel = panel.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!;
  const oldSave = panel.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!;
  click(panel, "cancel");
  await panel.updateComplete;
  click(panel, "edit");
  await panel.updateComplete;
  await change(panel, "addressLine1", "Different street");
  oldSave.click();
  await panel.updateComplete;
  expect(writes).toEqual([]);
  oldCancel.click();
  await app.updateComplete;
  await panel.updateComplete;
  expect(app.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(field(panel, "addressLine1").value).toBe("Different street");
  expect(unload()).toBe(true);
});
