import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, mountInShadowRoot } from "@waitron/ui/src/test-helpers.js";
import type { ServiceSettingsFields, ServiceSettingsValue } from "./service-settings-fields.js";

import "./service-settings-fields.js";
const department: ServiceSettingsValue = {
  orderStart: "table",
  paidWhen: "prepay",
  collectionNumber: "numbered",
  receiptPrintMode: "auto",
};
const inherited: ServiceSettingsValue = {
  orderStart: null,
  paidWhen: null,
  collectionNumber: null,
  receiptPrintMode: null,
};
const fields = ["orderStart", "paidWhen", "collectionNumber", "receiptPrintMode"] as const;
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanup();
  setLocale("en");
});
async function mount(value = department, follows?: ServiceSettingsValue, disabled = false) {
  expect(
    customElements.get("dashboard-service-settings-fields"),
    "shared service fields are registered",
  ).toBeDefined();
  const el = (await mountInShadowRoot(
    "<dashboard-service-settings-fields></dashboard-service-settings-fields>",
  )) as ServiceSettingsFields;
  applyTokens(el);
  el.value = { ...value };
  el.follows = follows;
  el.disabled = disabled;
  await settle(el);
  return el;
}
async function settle(el: ServiceSettingsFields) {
  await el.updateComplete;
  await Promise.all(
    [
      ...el.shadowRoot!.querySelectorAll<HTMLElement & { updateComplete: Promise<unknown> }>(
        "wt-combobox, wt-switch",
      ),
    ].map((control) => control.updateComplete),
  );
}
function box(el: ServiceSettingsFields, field: keyof ServiceSettingsValue) {
  const control = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    `wt-combobox[name="${field}"]`,
  );
  expect(control, field).not.toBeNull();
  return control!;
}
async function choose(el: ServiceSettingsFields, field: keyof ServiceSettingsValue, value: string) {
  const control = box(el, field);
  await userEvent.click(control.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!);
  await control.updateComplete;
  const label = control.options.find((option) => option.value === value)!.label;
  const option = [...control.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (row) => row.textContent!.trim() === label,
  );
  expect(option, `${field}: ${value}`).toBeDefined();
  await userEvent.click(option!);
  await settle(el);
}
async function emitted(
  el: ServiceSettingsFields,
  action: () => Promise<void>,
  want: ServiceSettingsValue,
) {
  const heard: unknown[] = [];
  const raw: unknown[] = [];
  const listen = (event: Event) => heard.push((event as CustomEvent).detail);
  const primitive = (event: Event) => raw.push(event);
  document.addEventListener("service-settings-change", listen);
  document.addEventListener("wt-change", primitive);
  try {
    await action();
  } finally {
    document.removeEventListener("service-settings-change", listen);
    document.removeEventListener("wt-change", primitive);
  }
  expect(heard).toEqual([{ value: want }]);
  expect(raw).toEqual([]);
  expect(el.value).toEqual(want);
}

it("draws the department's stored choices, with semantic names and no empty choice", async () => {
  const el = await mount();
  for (const [field, text] of [
    ["orderStart", "Table service"],
    ["paidWhen", "Paid before preparation"],
    ["receiptPrintMode", "Always"],
  ] as const) {
    const control = box(el, field);
    expect(control.shadowRoot!.querySelector(".value")!.textContent).toBe(text);
    expect(control.shadowRoot!.querySelector("button")!.name).toBe(field);
    expect(control.options.map((option) => option.value)).not.toContain("");
    expect(control.required).toBe(true);
  }
  const control = el.shadowRoot!.querySelector('wt-switch[name="collectionNumber"]')!;
  const input = control.shadowRoot!.querySelector("input")!;
  expect(input.checked).toBe(true);
  expect(input.name).toBe("collectionNumber");
  expect(input.getAttribute("aria-label")).toBe("Print a numbered collection ticket");
});
it.each([
  ["orderStart", "counter"],
  ["paidWhen", "ticket_then_pay"],
  ["receiptPrintMode", "on_request"],
] as const)("changing department %s forwards exactly one whole value", async (field, value) => {
  const el = await mount();
  await emitted(el, () => choose(el, field, value), { ...department, [field]: value });
});
it.each(["numbered", "none"] as const)(
  "the department collection switch changes %s to its opposite",
  async (collectionNumber) => {
    const value = { ...department, collectionNumber };
    const el = await mount(value);
    await emitted(
      el,
      () =>
        userEvent.click(
          el.shadowRoot!.querySelector("wt-switch")!.shadowRoot!.querySelector("label")!,
        ),
      { ...value, collectionNumber: collectionNumber === "numbered" ? "none" : "numbered" },
    );
  },
);
describe.each([
  ["en", ["Table service", "Paid before preparation", "Print", "Always"], "Clear"],
  ["es", ["Servicio de mesa", "Se paga antes de preparar", "Imprimir", "Siempre"], "Borrar"],
] as const)("zone inheritance in %s", (locale, placeholders, clearLabel) => {
  it("paints only the localized department value as each empty trigger's placeholder", async () => {
    setLocale(locale);
    const el = await mount(inherited, department);
    for (const [index, field] of fields.entries()) {
      const control = box(el, field);
      expect(control.value).toBe("");
      expect(control.required).toBe(false);
      expect(control.hint).toBe("");
      expect(control.shadowRoot!.querySelector(".value.placeholder")!.textContent).toBe(
        placeholders[index],
      );
      expect(control.options.find((option) => option.value === "")!.label).toBe(clearLabel);
    }
  });
  it("uses the other inherited choices as placeholders too", async () => {
    setLocale(locale);
    const el = await mount(inherited, {
      orderStart: "counter",
      paidWhen: "ticket_then_pay",
      collectionNumber: "none",
      receiptPrintMode: "on_request",
    });
    const want =
      locale === "en"
        ? ["Counter service", "Paid at collection", "Don't print", "On request"]
        : ["Servicio en mostrador", "Se paga al recoger", "No imprimir", "A petición"];
    fields.forEach((field, index) =>
      expect(box(el, field).shadowRoot!.querySelector(".value.placeholder")!.textContent).toBe(
        want[index],
      ),
    );
  });
});
it.each(fields)(
  "clearing zone %s sends null and returns to the inherited placeholder",
  async (field) => {
    const el = await mount(department, department);
    await emitted(el, () => choose(el, field, ""), { ...department, [field]: null });
    expect(box(el, field).shadowRoot!.querySelector(".value.placeholder")).not.toBeNull();
  },
);
it.each([
  ["numbered", "Print"],
  ["none", "Don't print"],
] as const)("zone collection choice %s sends its value", async (value, label) => {
  const el = await mount(inherited, department);
  expect(box(el, "collectionNumber").options.find((option) => option.value === value)!.label).toBe(
    label,
  );
  await emitted(el, () => choose(el, "collectionNumber", value), {
    ...inherited,
    collectionNumber: value,
  });
});
it.each([false, true])("receipt choices send only auto/on_request (zone=%s)", async (zone) => {
  const el = await mount(zone ? inherited : department, zone ? department : undefined);
  const control = box(el, "receiptPrintMode");
  expect(control.options.filter((option) => option.value).map((option) => option.value)).toEqual([
    "auto",
    "on_request",
  ]);
  for (const value of ["on_request", "auto"] as const) {
    await emitted(el, () => choose(el, "receiptPrintMode", value), {
      ...el.value,
      receiptPrintMode: value,
    });
  }
});
it.each(["en", "es"] as const)(
  "department table-service hint and field labels in %s",
  async (locale) => {
    setLocale(locale);
    const el = await mount();
    expect(box(el, "orderStart").label).toBe(
      locale === "en" ? "How orders start" : "Cómo empiezan los pedidos",
    );
    expect(box(el, "paidWhen").label).toBe(
      locale === "en" ? "When counter service is used" : "Cuando se usa el servicio en mostrador",
    );
    expect(box(el, "receiptPrintMode").label).toBe(
      locale === "en" ? "Print a receipt" : "Imprimir el recibo",
    );
    expect(box(el, "paidWhen").hint).toBe(
      locale === "en"
        ? "Also used by zones set to counter service"
        : "También se usa en las zonas con servicio en mostrador",
    );
    await choose(el, "orderStart", "counter");
    expect(box(el, "paidWhen").hint).toBe("");
  },
);
it.each([false, true])(
  "disables all four native controls and blocks synthetic changes (zone=%s)",
  async (zone) => {
    const el = await mount(department, zone ? department : undefined, true);
    const heard: unknown[] = [];
    el.addEventListener("service-settings-change", (event) =>
      heard.push((event as CustomEvent).detail),
    );
    for (const field of fields) {
      const control = el.shadowRoot!.querySelector(`[name="${field}"]`)!;
      const native = control.shadowRoot!.querySelector<HTMLButtonElement | HTMLInputElement>(
        "button, input",
      )!;
      expect(native.disabled, field).toBe(true);
      native.click();
      control.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: field === "collectionNumber" && !zone ? { checked: false } : { value: "" },
          bubbles: true,
          composed: true,
        }),
      );
    }
    expect(heard).toEqual([]);
    expect(el.value).toEqual(department);
  },
);
it.each([false, true])(
  "shows every supplied field error beside its field (zone=%s)",
  async (zone) => {
    const el = await mount(department, zone ? department : undefined);
    el.errors = {
      orderStart: "Choose how orders start.",
      paidWhen: "Choose when payment happens.",
      collectionNumber: "Choose whether to print a ticket.",
      receiptPrintMode: "Choose when to print receipts.",
    };
    await settle(el);
    for (const field of fields) {
      const control = el.shadowRoot!.querySelector(`[name="${field}"]`)!;
      if (field === "collectionNumber" && !zone) {
        expect(
          el
            .shadowRoot!.querySelector('[data-field-error="collectionNumber"]')!
            .textContent!.trim(),
        ).toBe(el.errors[field]);
        expect(control.shadowRoot!.querySelector('[id$="-description"]')!.textContent).toBe(
          el.errors[field],
        );
      } else
        expect(control.shadowRoot!.querySelector(".error")!.textContent!.trim()).toBe(
          el.errors[field],
        );
    }
  },
);
