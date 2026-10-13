import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi } from "./client.js";
import { placedZonePlan, zonesModel } from "../testing/department-zones-fixture.js";
import "./zone-edit-dialog.js";
function settingsApi(request: DashboardRequest) {
  return new VenueServiceApi(((path, method, body, options) => {
    if (path === "/management-api/venue-service/opening-hours")
      return Promise.resolve({
        businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
        clockRevision: 0,
        currentBusinessDay: "2026-10-12",
        pending: null,
        timeZone: "Europe/Madrid",
        clockReadable: true,
        dayCutover: "06:00",
        menus: [],
        departments: [],
      });
    if (path.endsWith("/floor-plan")) return Promise.resolve(structuredClone(placedZonePlan));
    return request(path, method, body, options);
  }) as DashboardRequest);
}
let el: HTMLElementTagNameMap["zone-edit-dialog"];
beforeEach(() => setLocale("en"));
afterEach(() => {
  el?.remove();
  setLocale("en");
});
async function mount(zone = "z2") {
  el = document.createElement("zone-edit-dialog");
  el.model = structuredClone(zonesModel);
  el.zoneId = zone;
  applyTokens(el);
  document.body.append(el);
  await el.updateComplete;
  expect(el.shadowRoot).not.toBeNull();
  return el;
}
const button = (id: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    id === "cancel-editor" ? "wt-button[slot=cancel]" : `[data-test=${id}]`,
  )!;
const fields = () => el.shadowRoot!.querySelector("dashboard-service-settings-fields")!;
async function change(value: Partial<import("./service-settings-fields.js").ServiceSettingsValue>) {
  fields().dispatchEvent(
    new CustomEvent("service-settings-change", {
      detail: { value: { ...fields().value, ...value } },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
}
it("shows only inherited placeholders, clears to null and saves all four settings once", async () => {
  await mount("z3");
  const writes: unknown[] = [];
  el.api = settingsApi((async (path, method, body) => {
    writes.push({ path, method, body });
  }) as DashboardRequest);
  expect(button("save-editor").disabled).toBe(true);
  expect(button("save-editor").variant).toBe("secondary");
  expect(
    [...el.shadowRoot!.querySelector("wt-form-actions")!.children].map((n) =>
      n.textContent!.trim(),
    ),
  ).toEqual(["Cancel", "Save"]);
  await change({
    orderStart: null,
    paidWhen: null,
    collectionNumber: null,
    receiptPrintMode: null,
  });
  await fields().updateComplete;
  const combos = [...fields().shadowRoot!.querySelectorAll("wt-combobox")];
  expect(combos.map((c) => c.value)).toEqual(["", "", "", ""]);
  expect(combos.map((c) => c.placeholder)).toEqual([
    "Table service",
    "Paid before preparation",
    "Don't print",
    "Always",
  ]);
  expect(combos.map((c) => c.options[0]!.label)).toEqual([
    "Same as department (Table service)",
    "Same as department (Paid before preparation)",
    "Same as department (Don't print)",
    "Same as department (Always)",
  ]);
  expect(button("save-editor").disabled).toBe(false);
  expect(button("save-editor").variant).toBe("primary");
  button("save-editor").click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    {
      path: "/management-api/venue-service/zones/z3/settings",
      method: "PUT",
      body: {
        name: "Same",
        orderStart: null,
        paidWhen: null,
        collectionNumber: null,
        receiptPrintMode: null,
      },
    },
  ]);
  await expect.poll(() => button("save-editor").disabled).toBe(true);
  button("save-editor").click();
  expect(writes).toHaveLength(1);
});
it("renders inherited On request and Print from a refreshed department", async () => {
  await mount();
  el.model!.salePolicies.departments[0]!.receiptPrintMode = "on_request";
  el.model!.salePolicies.departments[0]!.collectionNumber = "numbered";
  el.model = structuredClone(el.model!);
  await el.updateComplete;
  await fields().updateComplete;
  expect(
    fields().shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "[name=collectionNumber]",
    )!.placeholder,
  ).toBe("Print");
  expect(
    fields().shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "[name=receiptPrintMode]",
    )!.placeholder,
  ).toBe("On request");
});
it("a deleted zone is absent and has no Enable action", async () => {
  await mount("z1");
  const view = structuredClone(el.model!);
  view.zones.find((z) => z.id === "z1")!.active = false;
  const floor = view.floorZones.find((z) => z.id === "z1");
  if (floor) floor.active = false;
  el.model = view;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[data-zone="z1"]')).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=enable-zone]")).toBeNull();
});
it("marks a field refusal, keeps retry available and shows a bottom message", async () => {
  await mount();
  el.api = settingsApi((async () => {
    throw { code: "management.request_invalid", params: { field: "paidWhen" } };
  }) as DashboardRequest);
  await change({ paidWhen: "ticket_then_pay" });
  button("save-editor").click();
  await expect
    .poll(() => fields().errors.paidWhen)
    .toBe("This value was not accepted. Change it and save again.");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
    "Correct the highlighted fields to continue.",
  );
  expect(button("save-editor").disabled).toBe(false);
  await change({ paidWhen: "prepay" });
  expect(fields().errors.paidWhen).toBeUndefined();
});
it("keeps a draft over a live refresh, but a pristine editor takes new values", async () => {
  await mount();
  el.model!.salePolicies.zones[1]!.paidWhen = "ticket_then_pay";
  el.model = structuredClone(el.model!);
  await el.updateComplete;
  expect(fields().value.paidWhen).toBe("ticket_then_pay");
  expect(button("save-editor").disabled).toBe(true);
  await change({ paidWhen: "prepay" });
  el.model!.salePolicies.zones[1]!.paidWhen = null;
  el.model = structuredClone(el.model!);
  await el.updateComplete;
  expect(fields().value.paidWhen).toBe("prepay");
  expect(button("save-editor").disabled).toBe(false);
});
it("a refused setting focuses its native control", async () => {
  await mount();
  el.api = settingsApi((async () => {
    throw { code: "management.request_invalid", params: { field: "paidWhen" } };
  }) as DashboardRequest);
  await change({ paidWhen: "ticket_then_pay" });
  button("save-editor").click();
  await expect
    .poll(() => fields().errors.paidWhen)
    .toBe("This value was not accepted. Change it and save again.");
  const combo =
    fields().shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=paidWhen]")!;
  await expect.poll(() => combo.shadowRoot!.activeElement?.tagName).toBe("BUTTON");
});
it.each(["prepay", "ticket_then_pay", "table_tab"] as const)(
  "a department without a policy ignores retired %s and uses current default hints",
  async (mode) => {
    await mount();
    el.model!.salePolicies.departments = [];
    Object.assign(el.model!.departments[0]!, { defaultServiceMode: mode });
    el.model = structuredClone(el.model!);
    await el.updateComplete;
    expect(fields().follows).toEqual({
      orderStart: "counter",
      paidWhen: "prepay",
      collectionNumber: "none",
      receiptPrintMode: "auto",
    });
  },
);
it("a removed zone releases its form, while a zone with no policy starts by inheriting", async () => {
  await mount("z4");
  await el.updateComplete;
  expect(fields().value).toEqual({
    name: "Other",
    orderStart: null,
    paidWhen: null,
    collectionNumber: null,
    receiptPrintMode: null,
  });
  el.model = { ...el.model!, zones: [] };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dashboard-service-settings-fields")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toBe("");
});
it("an unshown field refusal stays at the bottom instead of marking a service field", async () => {
  await mount();
  el.api = settingsApi((async () => {
    throw { code: "management.request_invalid", params: { field: "unshown" } };
  }) as DashboardRequest);
  await change({ orderStart: "counter" });
  button("save-editor").click();
  await expect
    .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
    .toBe("The change could not be saved.");
  expect(fields().errors).toEqual({});
  expect(button("save-editor").disabled).toBe(false);
});

it.each([
  ["orderStart", "counter", "paidWhen", "ticket_then_pay"],
  ["paidWhen", "ticket_then_pay", "collectionNumber", "numbered"],
  ["collectionNumber", "numbered", "paidWhen", "ticket_then_pay"],
  ["receiptPrintMode", "auto", "paidWhen", "ticket_then_pay"],
] as const)(
  "a refused %s survives a different service edit until its own value changes",
  async (refused, corrected, other, value) => {
    await mount();
    el.api = settingsApi((async () => {
      throw { code: "management.request_invalid", params: { field: refused } };
    }) as DashboardRequest);
    await change({ orderStart: "table" });
    button("save-editor").click();
    const message = "This value was not accepted. Change it and save again.";
    await expect.poll(() => fields().errors[refused]).toBe(message);
    await fields().updateComplete;
    await chooseOption(
      fields().shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(`[name=${other}]`)!,
      value,
    );
    await el.updateComplete;
    expect(fields().errors[refused]).toBe(message);
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
      "Correct the highlighted fields to continue.",
    );
    expect(button("save-editor").disabled).toBe(false);
    await fields().updateComplete;
    await chooseOption(
      fields().shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
        `[name=${refused}]`,
      )!,
      corrected,
    );
    await el.updateComplete;
    expect(fields().errors[refused]).toBeUndefined();
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
    expect(button("save-editor").disabled).toBe(false);
  },
);

it.each([
  ["orderStart", "table", "counter"],
  ["paidWhen", "prepay", "ticket_then_pay"],
  ["collectionNumber", "none", "numbered"],
  ["receiptPrintMode", "auto", "on_request"],
] as const)(
  "native %s edits during Save remain dirty against the submitted zone snapshot",
  async (kind, submitted, newer) => {
    await mount("z3");
    el.model = {
      ...el.model!,
      salePolicies: {
        ...el.model!.salePolicies,
        zones: el.model!.salePolicies.zones.map((zone) =>
          zone.zoneId === "z3"
            ? {
                ...zone,
                orderStart: null,
                paidWhen: null,
                collectionNumber: null,
                receiptPrintMode: null,
              }
            : zone,
        ),
      },
    };
    await el.updateComplete;
    let finish!: () => void;
    const writes: unknown[] = [];
    el.api = settingsApi((async (path, method, body) => {
      writes.push({ path, method, body });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }) as DashboardRequest);
    const state = async () => {
      const save = button("save-editor");
      await save.updateComplete;
      return {
        variant: save.variant,
        disabled: save.disabled,
        innerDisabled: save.shadowRoot!.querySelector("button")!.disabled,
      };
    };
    await fields().updateComplete;
    const control = fields().shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      `[name=${kind}]`,
    )!;
    const pick = async (value: string) => {
      await control.updateComplete;
      await userEvent.click(
        page.elementLocator(control.shadowRoot!.querySelector<HTMLElement>(".trigger")!),
      );
      await control.updateComplete;
      const label = control.options.find((option) => option.value === value)!.label;
      const option = [...control.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (node) => node.textContent!.trim() === label,
      )!;
      await userEvent.click(page.elementLocator(option));
      await el.updateComplete;
    };
    const quiet = { variant: "secondary", disabled: true, innerDisabled: true };
    const ready = { variant: "primary", disabled: false, innerDisabled: false };
    expect(await state()).toEqual(quiet);
    button("save-editor").dispatchEvent(new MouseEvent("click"));
    await el.updateComplete;
    expect(writes).toEqual([]);
    expect(fields().errors).toEqual({});
    await pick(submitted);
    await el.updateComplete;
    expect(await state()).toEqual(ready);
    await pick("");
    await el.updateComplete;
    expect(await state()).toEqual(quiet);
    await pick(submitted);
    button("save-editor").click();
    try {
      await expect.poll(() => writes.length).toBe(1);
      await el.updateComplete;
      await fields().updateComplete;
      await control.updateComplete;
      expect(control.disabled).toBe(false);
      expect(control.shadowRoot!.querySelector("button")!.disabled).toBe(false);
      expect((await state()).innerDisabled).toBe(true);
      await button("cancel-editor").updateComplete;
      expect(button("cancel-editor").shadowRoot!.querySelector("button")!.disabled).toBe(true);
      button("save-editor").dispatchEvent(new MouseEvent("click"));
      await pick(newer);
      finish();
      await expect.poll(() => button("save-editor").disabled).toBe(false);
      expect(control.value).toBe(newer);
      expect(await state()).toEqual(ready);
      await pick(submitted);
      await el.updateComplete;
      expect(await state()).toEqual(quiet);
      expect(writes).toEqual([
        {
          path: "/management-api/venue-service/zones/z3/settings",
          method: "PUT",
          body: {
            name: "Same",
            orderStart: null,
            paidWhen: null,
            collectionNumber: null,
            receiptPrintMode: null,
            [kind]: submitted,
          },
        },
      ]);
      el.api = settingsApi((async (path, method, body) => {
        writes.push({ path, method, body });
        throw { code: "connection.failed" };
      }) as DashboardRequest);
      await pick(newer);
      button("save-editor").click();
      await expect
        .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
        .toBe("The change could not be saved.");
      expect(await state()).toEqual(ready);
      expect(fields().errors).toEqual({});
      expect(control.value).toBe(newer);
      expect(writes).toHaveLength(2);
      expect(writes[1]).toEqual({
        path: "/management-api/venue-service/zones/z3/settings",
        method: "PUT",
        body: {
          name: "Same",
          orderStart: null,
          paidWhen: null,
          collectionNumber: null,
          receiptPrintMode: null,
          [kind]: newer,
        },
      });
    } finally {
      finish?.();
    }
  },
);

it.each([
  ["paidWhen", "ticket_then_pay"],
  ["collectionNumber", "numbered"],
  ["receiptPrintMode", "on_request"],
] as const)(
  "a refused zone %s clears back to inheritance without another write",
  async (name, changed) => {
    await mount("z3");
    el.model = { ...el.model!, salePolicies: { ...el.model!.salePolicies, zones: [] } };
    await el.updateComplete;
    const writes: unknown[] = [];
    el.api = settingsApi((async (path, method, body) => {
      writes.push({ path, method, body });
      throw new Error("offline");
    }) as DashboardRequest);
    await fields().updateComplete;
    const box = fields().shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      `wt-combobox[name=${name}]`,
    )!;
    await chooseOption(box, changed);
    await el.updateComplete;
    button("save-editor").click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
      .toBe("The change could not be saved.");
    expect(box.value).toBe(changed);
    expect(writes).toEqual([
      {
        path: "/management-api/venue-service/zones/z3/settings",
        method: "PUT",
        body: {
          name: "Same",
          orderStart: null,
          paidWhen: null,
          collectionNumber: null,
          receiptPrintMode: null,
          [name]: changed,
        },
      },
    ]);
    await chooseOption(box, "");
    await el.updateComplete;
    button("save-editor").click();
    await el.updateComplete;
    expect(box.value).toBe("");
    expect(box.placeholder).not.toBe("");
    expect(writes).toHaveLength(1);
    expect(button("save-editor").disabled).toBe(true);
    expect(button("save-editor").variant).toBe("secondary");
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
  },
);
