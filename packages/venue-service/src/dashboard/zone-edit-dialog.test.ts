import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { VenueServiceApi } from "./client.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import {
  cleanupZoneEditors,
  mountZoneEditor,
  editZoneName,
  zoneSave,
  zoneFields,
} from "../testing/zone-edit-fixture.js";
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupZoneEditors();
  setLocale("en");
  vi.restoreAllMocks();
});
it("shows no season sentence, hours link, floor-plan link or preview, and reads neither", async () => {
  const plans = vi.spyOn(VenueServiceApi.prototype, "watchZoneFloorPlan");
  const hours = vi.spyOn(OpeningHoursApi.prototype, "watchOpeningHours");
  const { el } = await mountZoneEditor();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await el.updateComplete;
  const root = el.shadowRoot!;
  expect(root.querySelector("[data-test=closed-week-summary]")).toBeNull();
  expect(root.querySelector("[data-test=zone-opening-hours]")).toBeNull();
  expect(root.querySelector("[data-test=zone-floor-plan]")).toBeNull();
  expect(root.querySelector("wt-floor-plan-preview")).toBeNull();
  expect(root.querySelector("a")).toBeNull();
  expect(plans).not.toHaveBeenCalled();
  expect(hours).not.toHaveBeenCalled();
});
it.each([1280, 390])("Save's right edge lines up with the last field's at %i px", async (width) => {
  const old = [window.innerWidth, window.innerHeight];
  try {
    await page.viewport(width, 900);
    expect(window.innerWidth).toBe(width);
    const { el } = await mountZoneEditor();
    const fields = await zoneFields(el);
    const choices = fields.shadowRoot!.querySelectorAll("wt-combobox");
    const last = choices[choices.length - 1]!;
    await last.updateComplete;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const save = zoneSave(el).getBoundingClientRect().right;
    expect(Math.abs(save - last.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  } finally {
    await page.viewport(old[0]!, old[1]!);
  }
});
it("opens the selected zone with name and four raw overrides, offering each department value explicitly", async () => {
  const { el, modal, writes } = await mountZoneEditor();
  expect(modal.heading).toBe("Edit zone: Terrace");
  const name = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
  expect(name.required).toBe(true);
  expect(name.value).toBe("Terrace");
  const fields = await zoneFields(el);
  const choices = [...fields.shadowRoot!.querySelectorAll("wt-combobox")];
  expect(choices.map((f) => f.name)).toEqual([
    "orderStart",
    "paidWhen",
    "collectionNumber",
    "receiptPrintMode",
  ]);
  expect(choices.map((f) => f.value)).toEqual(["counter", "", "", ""]);
  expect(choices.map((f) => f.options[0])).toEqual([
    { value: "", label: "Same as department (Table service)" },
    { value: "", label: "Same as department (Paid before preparation)" },
    { value: "", label: "Same as department (Don't print)" },
    { value: "", label: "Same as department (Always)" },
  ]);
  expect(zoneSave(el).disabled).toBe(true);
  expect(zoneSave(el).variant).toBe("secondary");
  expect(writes).toEqual([]);
});
it("saves trimmed name and nullable policies in one request and closes before notifying its host", async () => {
  const { el, modal, writes } = await mountZoneEditor();
  const openWhenSaved: boolean[] = [];
  el.addEventListener("saved", () => openWhenSaved.push(modal.open));
  await editZoneName(el, "  Garden  ");
  zoneSave(el).click();
  await expect.poll(() => openWhenSaved).toEqual([false]);
  expect(writes).toEqual([
    [
      "/management-api/venue-service/zones/z1/settings",
      "PUT",
      {
        name: "Garden",
        orderStart: "counter",
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: null,
      },
    ],
  ]);
});
it("blank name explains the field and bottom summary, disables Save until corrected and never writes", async () => {
  const { el, modal, writes } = await mountZoneEditor();
  await editZoneName(el, " ");
  zoneSave(el).click();
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.error,
  ).toBe("This field is required.");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
    "Correct the highlighted fields to continue.",
  );
  expect(zoneSave(el).disabled).toBe(true);
  expect(modal.open).toBe(true);
  expect(writes).toEqual([]);
  await editZoneName(el, "Garden");
  expect(zoneSave(el).disabled).toBe(false);
});
it("a live deletion removes the dialog, releases its draft and reports the removed zone", async () => {
  const { el, app } = await mountZoneEditor();
  const gone = vi.fn();
  el.addEventListener("gone", gone);
  await editZoneName(el, "Draft");
  const view = structuredClone(el.model);
  view.zones[0]!.active = false;
  el.model = view;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(gone).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ detail: { zoneId: "z1" } }),
  );
});
it.each(["zone.name_taken", "management.request_invalid", "server.internal"])(
  "a %s refusal stays open and permits retry while naming any refused field",
  async (code) => {
    let calls = 0;
    const { el, modal } = await mountZoneEditor((async (_path, method = "GET") => {
      if (method === "GET") return { tables: [] };
      calls++;
      throw { code, params: { field: "paidWhen" } };
    }) as import("@waitron/dashboard-kit").DashboardRequest);
    await editZoneName(el, "Garden");
    zoneSave(el).click();
    await expect.poll(() => calls).toBe(1);
    await expect.poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
    const fields = await zoneFields(el);
    expect(
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.error,
    ).toBe(code === "zone.name_taken" ? "A zone with this name already exists." : "");
    expect(fields.errors.paidWhen ?? "").toBe(
      code === "management.request_invalid"
        ? "This value was not accepted. Change it and save again."
        : "",
    );
    expect(modal.open).toBe(true);
    expect(zoneSave(el).disabled).toBe(false);
    zoneSave(el).click();
    await expect.poll(() => calls).toBe(2);
  },
);
it("an explicit value equal to the department remains explicit and choosing inheritance submits null", async () => {
  const { el, writes } = await mountZoneEditor();
  el.zoneId = "z3";
  await el.updateComplete;
  const fields = await zoneFields(el);
  const paid =
    fields.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=paidWhen]")!;
  expect(paid.value).toBe("prepay");
  paid.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "" }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  zoneSave(el).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    [
      "/management-api/venue-service/zones/z3/settings",
      "PUT",
      {
        name: "Same",
        orderStart: "table",
        paidWhen: null,
        collectionNumber: "none",
        receiptPrintMode: "auto",
      },
    ],
  ]);
});
it("a completed save for an old zone cannot close the replacement editor", async () => {
  let finish!: () => void;
  const { el } = await mountZoneEditor((async (_path, method = "GET") => {
    if (method === "GET") return { tables: [] };
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  }) as import("@waitron/dashboard-kit").DashboardRequest);
  const saved = vi.fn();
  el.addEventListener("saved", saved);
  await editZoneName(el, "Submitted");
  zoneSave(el).click();
  await expect.poll(() => !!finish).toBe(true);
  el.zoneId = "z2";
  await el.updateComplete;
  await editZoneName(el, "New draft");
  finish();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("New draft");
  expect(saved).not.toHaveBeenCalled();
});
it("an old native close cannot dismiss a replacement zone", async () => {
  const { el, modal } = await mountZoneEditor();
  const closed = vi.fn();
  el.addEventListener("closed", closed);
  el.zoneId = "z2";
  await el.updateComplete;
  const next = el.shadowRoot!.querySelector("wt-modal")!;
  modal.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(next.open).toBe(true);
  expect(closed).not.toHaveBeenCalled();
});

it("a deleted zone shows no fields, and switching to a surviving zone shows its own", async () => {
  const { el } = await mountZoneEditor();
  el.model!.zones[0]!.active = false;
  el.model = structuredClone(el.model!);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dashboard-service-settings-fields")).toBeNull();
  el.zoneId = "z2";
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dashboard-service-settings-fields")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("wt-modal")!.heading).toBe("Edit zone: Bar");
});
it("a pending save visibly reports loading, disables duplicate Save and Cancel, then clears loading", async () => {
  let finish!: () => void;
  let writes = 0;
  const { el, modal } = await mountZoneEditor((async (_path, method = "GET") => {
    if (method === "GET") return { tables: [] };
    writes++;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  }) as import("@waitron/dashboard-kit").DashboardRequest);
  await editZoneName(el, "Submitted");
  zoneSave(el).click();
  await expect.poll(() => !!finish).toBe(true);
  expect(zoneSave(el).loading).toBe(true);
  expect(zoneSave(el).disabled).toBe(true);
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[slot="cancel"]')!.disabled,
  ).toBe(true);
  zoneSave(el).click();
  expect(writes).toBe(1);
  finish();
  await expect.poll(() => modal.open).toBe(false);
  expect(zoneSave(el).loading).toBe(false);
});
it("a clean live snapshot adopts the zone name and raw policies, without a save", async () => {
  const { el, writes } = await mountZoneEditor();
  const view = structuredClone(el.model);
  view.zones[0]!.name = "Live terrace";
  view.salePolicies.zones[0]!.orderStart = null;
  view.salePolicies.zones[0]!.receiptPrintMode = "on_request";
  el.model = view;
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("Live terrace");
  const fields = await zoneFields(el);
  expect(fields.value).toMatchObject({ orderStart: null, receiptPrintMode: "on_request" });
  expect(zoneSave(el).disabled).toBe(true);
  expect(writes).toEqual([]);
});
it("a parent removed while this zone is dirty closes the editor and releases its scope", async () => {
  const { el, app } = await mountZoneEditor();
  const gone = vi.fn();
  el.addEventListener("gone", gone);
  await editZoneName(el, "Draft");
  el.model = { ...el.model, departments: el.model.departments.filter((row) => row.id !== "d1") };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  expect(app.leave.coordinator.isDirty()).toBe(false);
  expect(gone.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual([
    { zoneId: "z1" },
  ]);
});
it("changed policy events stay inside the editor and an explicit policy saves with the name", async () => {
  const { el, app, writes } = await mountZoneEditor();
  const outside = vi.fn();
  app.addEventListener("service-settings-change", outside);
  const fields = await zoneFields(el);
  fields.dispatchEvent(
    new CustomEvent("service-settings-change", {
      detail: { value: { ...fields.value, receiptPrintMode: "on_request" } },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  zoneSave(el).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    [
      "/management-api/venue-service/zones/z1/settings",
      "PUT",
      {
        name: "Terrace",
        orderStart: "counter",
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: "on_request",
      },
    ],
  ]);
  expect(outside).not.toHaveBeenCalled();
});

it.each(["en", "es"])(
  "a late zone name clash does not mark newer native input in %s",
  async (locale) => {
    setLocale(locale);
    let reject!: (error: unknown) => void;
    const writes: unknown[][] = [];
    const { el, modal } = await mountZoneEditor((async (path, method = "GET", body) => {
      if (method === "GET") return { tables: [] };
      writes.push([path, method, body]);
      await new Promise<void>((_resolve, refuse) => {
        reject = refuse;
      });
    }) as import("@waitron/dashboard-kit").DashboardRequest);
    const change = async (value: string) => {
      await editZoneName(el, value);
    };
    await change("Reserved");
    zoneSave(el).click();
    await expect.poll(() => writes.length).toBe(1);
    await change("Available now");
    reject({ code: "zone.name_taken", params: { name: "Reserved" } });
    await expect.poll(() => zoneSave(el).disabled).toBe(false);
    const name = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!;
    await name.updateComplete;
    expect(name.error).toBe("");
    expect(name.shadowRoot!.querySelector("input")!.value).toBe("Available now");
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
    expect(el.shadowRoot!.querySelector("[data-test=enable-name-clash]")).toBeNull();
    expect(modal.open).toBe(true);
    expect(zoneSave(el).variant).toBe("primary");
    expect(writes).toHaveLength(1);
    expect((writes[0]![2] as { name: string }).name).toBe("Reserved");
  },
);
