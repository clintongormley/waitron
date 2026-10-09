import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VenueServiceApi } from "./client.js";
import { zonesModel } from "../testing/department-zones-fixture.js";
import "./department-zones.js";
let el: HTMLElementTagNameMap["department-zones"];
beforeEach(() => setLocale("en"));
afterEach(() => {
  el?.remove();
  setLocale("en");
});
async function mount(zone = "z2") {
  el = document.createElement("department-zones");
  el.model = structuredClone(zonesModel);
  el.departmentId = "d1";
  el.zone = zone;
  applyTokens(el);
  document.body.append(el);
  await el.updateComplete;
  expect(el.shadowRoot).not.toBeNull();
  return el;
}
const button = (id: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(`[data-test=${id}]`)!;
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
it("keeps the server display order, selects the linked zone and excludes other departments", async () => {
  await mount();
  expect(
    [...el.shadowRoot!.querySelectorAll("[data-zone]")].map((n) => n.getAttribute("data-zone")),
  ).toEqual(["z1", "z2", "z3"]);
  expect(button("zone-z2").getAttribute("aria-pressed")).toBe("true");
  expect(button("zone-z1").getAttribute("aria-pressed")).toBe("false");
  expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe("Bar");
  const changes: unknown[] = [];
  el.addEventListener("zone-change", (e) => changes.push((e as CustomEvent).detail));
  button("zone-z1").click();
  await expect.poll(() => changes).toEqual([{ zoneId: "z1" }]);
});
it("selects the first zone when none is named and shows Add in an empty department", async () => {
  await mount("");
  expect(el.shadowRoot!.querySelector("h2")!.textContent).toBe("Terrace");
  el.departmentId = "d3";
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain("No zones yet.");
  expect(button("add-zone").disabled).toBe(true);
  expect(button("add-zone").textContent!.trim()).toBe("+ Add zone");
  el.model = {
    ...el.model!,
    departments: el.model!.departments.map((d) => ({ ...d, active: true })),
  };
  await el.updateComplete;
  const events: unknown[] = [];
  el.addEventListener("add-zone", (e) => events.push((e as CustomEvent).detail));
  button("add-zone").click();
  expect(events).toEqual([{ departmentId: "d3" }]);
});
it("shows only inherited placeholders, clears to null and saves all four settings once", async () => {
  await mount("z3");
  const writes: unknown[] = [];
  el.api = new VenueServiceApi((async (path, method, body) => {
    writes.push({ path, method, body });
  }) as DashboardRequest);
  expect(button("save-zone").disabled).toBe(true);
  expect(button("save-zone").variant).toBe("secondary");
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
  expect(fields().shadowRoot!.textContent).not.toContain("Same as the department");
  expect(button("save-zone").disabled).toBe(false);
  expect(button("save-zone").variant).toBe("primary");
  button("save-zone").click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    {
      path: "/management-api/venue-service/zones/z3/service-settings",
      method: "PUT",
      body: { orderStart: null, paidWhen: null, collectionNumber: null, receiptPrintMode: null },
    },
  ]);
  await expect.poll(() => button("save-zone").disabled).toBe(true);
  button("save-zone").click();
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
it("offers Rename, Move and Disable events without writing settings", async () => {
  await mount();
  const events: unknown[] = [];
  for (const action of ["rename", "move", "disable"]) {
    el.addEventListener(`${action}-zone`, (e) =>
      events.push({ action, detail: (e as CustomEvent).detail }),
    );
    button(`${action}-zone`).click();
  }
  expect(events).toEqual(
    ["rename", "move", "disable"].map((action) => ({ action, detail: { zoneId: "z2" } })),
  );
  el.model = {
    ...el.model!,
    departments: el.model!.departments.map((d) => (d.id === "d1" ? d : { ...d, active: false })),
  };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=move-zone]")).toBeNull();
});
it("a disabled zone stays visible and read-only, offering Enable only under an active department", async () => {
  await mount();
  el.model = { ...el.model!, zones: el.model!.zones.map((z) => ({ ...z, active: false })) };
  await el.updateComplete;
  expect(button("zone-z2").textContent).toContain("(Disabled)");
  expect(fields().disabled).toBe(true);
  expect(button("save-zone").disabled).toBe(true);
  expect(el.shadowRoot!.querySelector('[data-test="disable-zone"]')).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-test="enable-zone"]')!.textContent!.trim()).toBe(
    "Enable",
  );
  const events: unknown[] = [];
  el.addEventListener("enable-zone", (e) => events.push((e as CustomEvent).detail));
  button("enable-zone").click();
  expect(events).toEqual([{ zoneId: "z2" }]);
  el.model = {
    ...el.model!,
    departments: el.model!.departments.map((d) => ({ ...d, active: false })),
  };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=enable-zone]")).toBeNull();
  await change({ orderStart: "counter" });
  expect(fields().value.orderStart).toBe(null);
});
it("marks a field refusal, keeps retry available and shows a bottom message", async () => {
  await mount();
  el.api = new VenueServiceApi((async () => {
    throw { code: "management.request_invalid", params: { field: "paidWhen" } };
  }) as DashboardRequest);
  await change({ paidWhen: "ticket_then_pay" });
  button("save-zone").click();
  await expect
    .poll(() => fields().errors.paidWhen)
    .toBe("This value was not accepted. Change it and save again.");
  expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
    "Correct the highlighted fields to continue.",
  );
  expect(button("save-zone").disabled).toBe(false);
  await change({ paidWhen: "prepay" });
  expect(fields().errors.paidWhen).toBeUndefined();
});
it("keeps a draft over a live refresh, but a pristine editor takes new values", async () => {
  await mount();
  el.model!.salePolicies.zones[1]!.paidWhen = "ticket_then_pay";
  el.model = structuredClone(el.model!);
  await el.updateComplete;
  expect(fields().value.paidWhen).toBe("ticket_then_pay");
  expect(button("save-zone").disabled).toBe(true);
  await change({ paidWhen: "prepay" });
  el.model!.salePolicies.zones[1]!.paidWhen = null;
  el.model = structuredClone(el.model!);
  await el.updateComplete;
  expect(fields().value.paidWhen).toBe("prepay");
  expect(button("save-zone").disabled).toBe(false);
});
it("a save locks row actions and zone switching until it settles", async () => {
  await mount();
  let finish!: () => void;
  el.api = new VenueServiceApi(
    (() => new Promise<void>((resolve) => (finish = resolve))) as DashboardRequest,
  );
  await change({ orderStart: "counter" });
  const events: unknown[] = [];
  for (const name of ["rename-zone", "move-zone", "disable-zone", "zone-change", "add-zone"])
    el.addEventListener(name, (event) => events.push((event as CustomEvent).detail));
  button("save-zone").click();
  await el.updateComplete;
  expect(button("rename-zone").disabled).toBe(true);
  expect(button("move-zone").disabled).toBe(true);
  expect(button("disable-zone").disabled).toBe(true);
  for (const action of ["rename-zone", "move-zone", "disable-zone", "zone-z1", "add-zone"])
    button(action).click();
  expect(events).toEqual([]);
  finish();
  await expect.poll(() => button("rename-zone").disabled).toBe(false);
});
it("a refused setting focuses its native control", async () => {
  await mount();
  el.api = new VenueServiceApi((async () => {
    throw { code: "management.request_invalid", params: { field: "paidWhen" } };
  }) as DashboardRequest);
  await change({ paidWhen: "ticket_then_pay" });
  button("save-zone").click();
  await expect
    .poll(() => fields().errors.paidWhen)
    .toBe("This value was not accepted. Change it and save again.");
  const combo =
    fields().shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=paidWhen]")!;
  await expect.poll(() => combo.shadowRoot!.activeElement?.tagName).toBe("BUTTON");
});
it("Cancel without a shell restores the baseline, and choice Enter does not submit settings", async () => {
  await mount();
  await change({ orderStart: "counter" });
  button("cancel-zone").click();
  await el.updateComplete;
  expect(fields().value.orderStart).toBe(null);
  expect(button("save-zone").disabled).toBe(true);
  const writes: unknown[] = [];
  el.api = new VenueServiceApi((async (_path, _method, body) => {
    writes.push(body);
  }) as DashboardRequest);
  await change({ paidWhen: "ticket_then_pay" });
  fields().dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true, cancelable: true }),
  );
  expect(writes).toEqual([]);
  expect(button("save-zone").disabled).toBe(false);
  button("save-zone").click();
  await expect
    .poll(() => writes)
    .toEqual([
      {
        orderStart: null,
        paidWhen: "ticket_then_pay",
        collectionNumber: null,
        receiptPrintMode: "on_request",
      },
    ]);
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
  el.departmentId = "d2";
  await el.updateComplete;
  expect(fields().value).toEqual({
    orderStart: null,
    paidWhen: null,
    collectionNumber: null,
    receiptPrintMode: null,
  });
  el.model = { ...el.model!, zones: [] };
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("dashboard-service-settings-fields")).toBeNull();
  expect(el.shadowRoot!.textContent).toContain("No zones yet.");
  el.departmentId = "missing";
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toBe("");
});
it("an unshown field refusal stays at the bottom instead of marking a service field", async () => {
  await mount();
  el.api = new VenueServiceApi((async () => {
    throw { code: "management.request_invalid", params: { field: "name" } };
  }) as DashboardRequest);
  await change({ orderStart: "counter" });
  button("save-zone").click();
  await expect
    .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
    .toBe("The change could not be saved.");
  expect(fields().errors).toEqual({});
  expect(button("save-zone").disabled).toBe(false);
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
    el.api = new VenueServiceApi((async () => {
      throw { code: "management.request_invalid", params: { field: refused } };
    }) as DashboardRequest);
    await change({ orderStart: "table" });
    button("save-zone").click();
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
    expect(button("save-zone").disabled).toBe(false);
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
    expect(button("save-zone").disabled).toBe(false);
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
    el.api = new VenueServiceApi((async (path, method, body) => {
      writes.push({ path, method, body });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }) as DashboardRequest);
    const state = async () => {
      const save = button("save-zone");
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
    button("save-zone").dispatchEvent(new MouseEvent("click"));
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
    button("save-zone").click();
    try {
      await expect.poll(() => writes.length).toBe(1);
      await el.updateComplete;
      await fields().updateComplete;
      await control.updateComplete;
      expect(control.disabled).toBe(false);
      expect(control.shadowRoot!.querySelector("button")!.disabled).toBe(false);
      expect((await state()).innerDisabled).toBe(true);
      await button("cancel-zone").updateComplete;
      expect(button("cancel-zone").shadowRoot!.querySelector("button")!.disabled).toBe(true);
      button("save-zone").dispatchEvent(new MouseEvent("click"));
      await pick(newer);
      finish();
      await expect.poll(() => button("save-zone").disabled).toBe(false);
      expect(control.value).toBe(newer);
      expect(await state()).toEqual(ready);
      await pick(submitted);
      await el.updateComplete;
      expect(await state()).toEqual(quiet);
      expect(writes).toEqual([
        {
          path: "/management-api/venue-service/zones/z3/service-settings",
          method: "PUT",
          body: {
            orderStart: null,
            paidWhen: null,
            collectionNumber: null,
            receiptPrintMode: null,
            [kind]: submitted,
          },
        },
      ]);
      el.api = new VenueServiceApi((async (path, method, body) => {
        writes.push({ path, method, body });
        throw { code: "connection.failed" };
      }) as DashboardRequest);
      await pick(newer);
      button("save-zone").click();
      await expect
        .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
        .toBe("The change could not be saved.");
      expect(await state()).toEqual(ready);
      expect(fields().errors).toEqual({});
      expect(control.value).toBe(newer);
      expect(writes).toHaveLength(2);
      expect(writes[1]).toEqual({
        path: "/management-api/venue-service/zones/z3/service-settings",
        method: "PUT",
        body: {
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
    el.api = new VenueServiceApi((async (path, method, body) => {
      writes.push({ path, method, body });
      throw new Error("offline");
    }) as DashboardRequest);
    await fields().updateComplete;
    const box = fields().shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      `wt-combobox[name=${name}]`,
    )!;
    await chooseOption(box, changed);
    await el.updateComplete;
    button("save-zone").click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("wt-form-actions")!.error)
      .toBe("The change could not be saved.");
    expect(box.value).toBe(changed);
    expect(writes).toEqual([
      {
        path: "/management-api/venue-service/zones/z3/service-settings",
        method: "PUT",
        body: {
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
    button("save-zone").click();
    await el.updateComplete;
    expect(box.value).toBe("");
    expect(box.placeholder).not.toBe("");
    expect(writes).toHaveLength(1);
    expect(button("save-zone").disabled).toBe(true);
    expect(button("save-zone").variant).toBe("secondary");
    expect(el.shadowRoot!.querySelector("wt-form-actions")!.error).toBe("");
  },
);

it("zone menus retain Rename under a disabled parent, call the command Disable, and omit receipt-only details", async () => {
  await mount();
  expect(button("disable-zone").textContent!.trim()).toBe("Disable");
  expect(el.shadowRoot!.querySelector("wt-row-actions")!.textContent).not.toContain("Remove");
  expect(el.shadowRoot!.querySelector("[name=printTradingName]")).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain("Casa");
  expect(el.shadowRoot!.textContent).not.toContain("Every zone");
  el.model = {
    ...el.model!,
    departments: el.model!.departments.map((d) => ({ ...d, active: false })),
    zones: el.model!.zones.map((z) => ({ ...z, active: false })),
  };
  await el.updateComplete;
  expect(button("rename-zone").disabled).toBe(false);
  expect(el.shadowRoot!.querySelector("[data-test=enable-zone]")).toBeNull();
  expect(button("zone-z2").textContent).toContain("(Disabled)");
  expect(button("zone-z2").textContent).not.toContain("Inactive");
});
