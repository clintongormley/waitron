import { userEvent } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import (not `import type`): pulls the module in for its `@customElement` side effect, so
// `mountWidget` can create `dashboard-option-list-form`.
import { OptionListForm } from "./option-list-form.js";
import type { OptionList, OptionListInput } from "../api/client.js";
import { t } from "../i18n/t.js";

afterEach(cleanupWidgets);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const RARE = "11111111-1111-4111-8111-111111111111";
const MEDIUM = "22222222-2222-4222-8222-222222222222";

/**
 * The three names read DIFFERENTLY everywhere in this fixture (CLAUDE.md §3): a surface that shows
 * the staff name where the customer name belongs fails instead of passing by coincidence.
 */
const cooked: OptionList = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Cooked",
  customerName: { en: "How would you like it?", es: "¿En qué punto?" },
  kitchenName: "COOK",
  defaultLabelId: MEDIUM,
  active: true,
  labels: [
    {
      id: RARE,
      name: "Rare",
      customerName: { en: "Barely cooked", es: "Poco hecho" },
      kitchenName: "R",
      available: true,
    },
    {
      id: MEDIUM,
      name: "Medium",
      customerName: { en: "Pink in the middle", es: "Al punto" },
      kitchenName: "M",
      available: true,
    },
  ],
};

const languages = { defaultLanguage: "en", languages: ["en", "es"] };

async function mount(props: Partial<OptionListForm> = {}) {
  return mountWidget<OptionListForm>("dashboard-option-list-form", {
    open: true,
    languages,
    ...props,
  });
}

function field<T extends Element>(el: OptionListForm, name: string): T {
  return el.shadowRoot!.querySelector<T>(`[name="${name}"]`)!;
}

/** Type into a `wt-input` the way the primitive announces a change. */
async function type(el: OptionListForm, name: string, value: string): Promise<void> {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

/** Flip a `wt-switch` the way the primitive announces a change. */
async function toggle(el: OptionListForm, name: string, checked: boolean): Promise<void> {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function click(el: OptionListForm, testId: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${testId}"]`)!.click();
  await el.updateComplete;
}

function summary(el: OptionListForm): string[] {
  const box = el.shadowRoot!.querySelector("wt-form-error-summary")!;
  return [...box.shadowRoot!.querySelectorAll("li")].map((item) => item.textContent!.trim());
}

/** Counts submissions as well as capturing the last one: a composed event re-emitted without
 * stopping the original arrives twice, and a single-shot listener cannot see that. */
function record(host: HTMLElement) {
  const seen: OptionListInput[] = [];
  host.addEventListener("wt-submit", (event) => {
    seen.push((event as CustomEvent<{ value: OptionListInput }>).detail.value);
  });
  return seen;
}

it("submits a new list once, minting an id for every label so a brand-new one can be preselected", async () => {
  const { el, host } = await mount();
  const submitted = record(host);

  await type(el, "name", "Cooked");
  await type(el, "customer-name-en", "How would you like it?");
  await type(el, "customer-name-es", "¿En qué punto?");
  await type(el, "kitchen-name", "COOK");
  await click(el, "add-label");
  await type(el, "label-0-name", "Rare");
  await type(el, "label-0-customer-name-en", "Barely cooked");
  await type(el, "label-0-kitchen-name", "R");
  await click(el, "add-label");
  await type(el, "label-1-name", "Medium");
  await type(el, "label-1-customer-name-es", "Al punto");
  await type(el, "label-1-kitchen-name", "M");
  await click(el, "label-1-default");
  await click(el, "save");

  expect(submitted).toHaveLength(1);
  const value = submitted[0]!;
  expect(value.labels.map((label) => label.id)).toEqual([
    expect.stringMatching(UUID),
    expect.stringMatching(UUID),
  ]);
  expect(value.defaultLabelId).toBe(value.labels[1]!.id);
  expect(value).toEqual({
    name: "Cooked",
    customerName: { en: "How would you like it?", es: "¿En qué punto?" },
    kitchenName: "COOK",
    active: true,
    defaultLabelId: value.labels[1]!.id,
    labels: [
      {
        id: value.labels[0]!.id,
        name: "Rare",
        customerName: { en: "Barely cooked" },
        kitchenName: "R",
        available: true,
      },
      {
        id: value.labels[1]!.id,
        name: "Medium",
        customerName: { es: "Al punto" },
        kitchenName: "M",
        available: true,
      },
    ],
  });
});

it("submits an edit under the ids it was given, keeping the names it did not touch", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  await type(el, "label-0-kitchen-name", "RR");
  await toggle(el, "active", false);
  await click(el, "save");

  expect(submitted).toEqual([
    {
      name: "Cooked",
      customerName: cooked.customerName,
      kitchenName: "COOK",
      active: false,
      defaultLabelId: MEDIUM,
      labels: [{ ...cooked.labels[0]!, kitchenName: "RR" }, { ...cooked.labels[1]! }],
    },
  ]);
});

it("refuses an active list with no available label itself, beside the labels and in the summary", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  await toggle(el, "label-0-available", false);
  await toggle(el, "label-1-available", false);
  await click(el, "save");

  expect(submitted).toEqual([]);
  const message = t("options.labels_required");
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')!.textContent).toContain(
    message,
  );
  expect(summary(el)).toContain(message);

  await toggle(el, "active", false);
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.active).toBe(false);
});

it("refuses a list with no staff name, beside the name field and in the summary", async () => {
  const { el, host } = await mount();
  const submitted = record(host);

  await click(el, "add-label");
  await type(el, "label-0-name", "Rare");
  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "name").error).toBe(
    t("options.name_required"),
  );
  expect(summary(el)).toEqual([t("options.name_required")]);
});

it("refuses a label with no name of its own, beside that label's name field", async () => {
  const { el, host } = await mount();
  const submitted = record(host);

  await type(el, "name", "Cooked");
  await click(el, "add-label");
  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "label-0-name").error).toBe(
    t("options.label_name_required"),
  );
  expect(summary(el)).toEqual([t("options.label_name_required")]);
});

it("puts a rejected field's message beside the input the server named and in the summary", async () => {
  const { el } = await mount({
    value: cooked,
    fieldErrors: { kitchenName: "Too long for the kitchen.", "labels.1.name": "Already used." },
  });

  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "kitchen-name").error).toBe(
    "Too long for the kitchen.",
  );
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "label-1-name").error).toBe("Already used.");
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "label-0-name").error).toBe("");
  expect(summary(el).sort()).toEqual(["Already used.", "Too long for the kitchen."]);
});

it("keeps a rejected label's message on that label after it is moved", async () => {
  const { el } = await mount({ value: cooked, fieldErrors: { "labels.1.name": "Already used." } });

  const handle = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${MEDIUM}"]`)!;
  handle.focus();
  await userEvent.keyboard("{ArrowUp}");
  await el.updateComplete;

  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "label-0-name").error).toBe("Already used.");
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "label-1-name").error).toBe("");
});

it("submits the labels in the order the operator moved them into", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  const handle = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${RARE}"]`)!;
  handle.focus();
  await userEvent.keyboard("{ArrowDown}");
  await el.updateComplete;
  await click(el, "save");

  expect(submitted[0]!.labels.map((label) => label.id)).toEqual([MEDIUM, RARE]);
  expect(submitted[0]!.labels.map((label) => label.name)).toEqual(["Medium", "Rare"]);
});

it("shows a default whose label is unavailable as no preselection rather than as an error", async () => {
  const withdrawn: OptionList = {
    ...cooked,
    labels: [cooked.labels[0]!, { ...cooked.labels[1]!, available: false }],
  };
  const { el, host } = await mount({ value: withdrawn });
  const submitted = record(host);

  const radio = el.shadowRoot!.querySelector<HTMLInputElement>('[data-test="label-1-default"]')!;
  expect(radio.checked).toBe(false);
  expect(radio.disabled).toBe(true);
  expect(summary(el)).toEqual([]);
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')).toBeNull();

  await click(el, "save");
  expect(submitted[0]!.defaultLabelId).toBeNull();
});

it("drops the preselection when the preselected label is withdrawn", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  await toggle(el, "label-1-available", false);
  await click(el, "save");

  expect(submitted[0]!.defaultLabelId).toBeNull();
  expect(summary(el)).toEqual([]);
});

it("clears the preselection on request, which a radio group cannot do on its own", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  await click(el, "clear-default");
  expect(el.shadowRoot!.querySelector('[data-test="clear-default"]')).toBeNull();
  await click(el, "save");

  expect(submitted[0]!.defaultLabelId).toBeNull();
});

it("removes a label, and the list it submits no longer carries it", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  await click(el, "remove-label-1");
  await click(el, "save");

  expect(submitted[0]!.labels.map((label) => label.id)).toEqual([RARE]);
  expect(submitted[0]!.defaultLabelId).toBeNull();
});

it("emits one wt-cancel, and neither event while it is saving", async () => {
  const { el, host } = await mount({ value: cooked, busy: true });
  let cancels = 0;
  host.addEventListener("wt-cancel", () => cancels++);
  const submitted = record(host);

  await click(el, "cancel");
  await click(el, "save");
  expect(cancels).toBe(0);
  expect(submitted).toEqual([]);

  el.busy = false;
  await el.updateComplete;
  await click(el, "cancel");
  expect(cancels).toBe(1);
});

it("paints its own error text with the danger token and keeps the row controls tappable", async () => {
  const { el, host } = await mount({ value: cooked });
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-tap-min", "44px");

  await toggle(el, "label-0-available", false);
  await toggle(el, "label-1-available", false);
  await click(el, "save");

  const error = el.shadowRoot!.querySelector<HTMLElement>('[data-test="labels-error"]')!;
  expect(getComputedStyle(error).color).toBe("rgb(13, 14, 15)");

  for (const testId of [`drag-${RARE}`, "label-0-pick"]) {
    const box = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${testId}"]`)!;
    const { width, height } = box.getBoundingClientRect();
    expect({ testId, width: width >= 44, height: height >= 44 }).toEqual({
      testId,
      width: true,
      height: true,
    });
  }
});

/**
 * The preselect control is a native radio, so the user agent draws its CHECKED dot and only
 * `accent-color` hands that drawing the brand colour. The UNCHECKED fill is a separate matter settled
 * by `color-scheme`, which this says nothing about.
 */
it("hands the preselect radio the brand colour to draw its checked dot with", async () => {
  const { el, host } = await mount({ value: cooked });
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");

  const radio = el.shadowRoot!.querySelector<HTMLInputElement>('[data-test="label-0-default"]')!;
  expect(getComputedStyle(radio).accentColor).toBe("rgb(1, 2, 3)");
});

it("leaves the staff-name field wide enough for a real label name", async () => {
  const { el } = await mount({
    value: { ...cooked, labels: [{ ...cooked.labels[0]!, name: "Poco hecho" }] },
  });
  const input = field<HTMLElement>(el, "label-0-name").shadowRoot!.querySelector("input")!;
  expect(input.value).toBe("Poco hecho");
  // scrollWidth is what the value needs; clientWidth is what the box gives it.
  expect({
    needs: input.scrollWidth,
    has: input.clientWidth,
    fits: input.scrollWidth <= input.clientWidth,
  }).toEqual({
    needs: input.scrollWidth,
    has: input.clientWidth,
    fits: true,
  });
});

it("sizes both single-input cells from the shared sizing token, not a literal width", async () => {
  const { el } = await mount({ value: cooked });
  // Read the token off the element rather than restating its number, so the comparison below can
  // never pass on two blanks.
  const token = getComputedStyle(el).getPropertyValue("--wt-cell-name-max-width").trim();
  expect(token).not.toBe("");
  const widths = ["label-0-name", "label-0-kitchen-name"].map((name) => [
    name,
    getComputedStyle(field(el, name)).minWidth,
  ]);
  expect(widths).toEqual([
    ["label-0-name", token],
    ["label-0-kitchen-name", token],
  ]);
});

function text(el: OptionListForm, testId: string): string {
  return el.shadowRoot!.querySelector(`[data-test="${testId}"]`)!.textContent!.trim();
}

it("puts a customer-name refusal beside the first language, and an active one in the summary", async () => {
  const { el } = await mount({
    value: cooked,
    fieldErrors: {
      customerName: "Needs a customer-facing name.",
      active: "Cannot be switched off.",
      "labels.0.customerName": "The label needs one too.",
    },
  });

  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "customer-name-en").error).toBe(
    "Needs a customer-facing name.",
  );
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "customer-name-es").error).toBe("");
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "label-0-customer-name-en").error).toBe(
    "The label needs one too.",
  );
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')).toBeNull();
  expect(summary(el).sort()).toEqual([
    "Cannot be switched off.",
    "Needs a customer-facing name.",
    "The label needs one too.",
  ]);
});

it.each([
  ["a label as a whole", "labels.0"],
  ["a label field with no input", "labels.0.available"],
  ["a label the form does not hold", "labels.9.name"],
])("shows a refusal naming %s under the labels table", async (_what, path) => {
  const { el } = await mount({ value: cooked, fieldErrors: { [path]: "Something is wrong." } });

  expect(text(el, "labels-error")).toBe("Something is wrong.");
  expect(summary(el)).toEqual(["Something is wrong."]);
});

it("moves a rejected label's message under the labels table once that label is removed", async () => {
  const { el } = await mount({ value: cooked, fieldErrors: { "labels.1.name": "Already used." } });
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')).toBeNull();

  await click(el, "remove-label-1");

  expect(text(el, "labels-error")).toBe("Already used.");
  expect(summary(el)).toEqual(["Already used."]);
});

it("reads a label with no kitchen name as blank and submits blank kitchen names as null", async () => {
  const { el, host } = await mount({
    value: { ...cooked, labels: [{ ...cooked.labels[0]!, kitchenName: null }, cooked.labels[1]!] },
  });
  const submitted = record(host);
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "label-0-kitchen-name").value).toBe("");

  await type(el, "kitchen-name", "  ");
  await type(el, "label-1-kitchen-name", " ");
  await click(el, "save");

  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.kitchenName).toBeNull();
  expect(submitted[0]!.labels.map((label) => label.kitchenName)).toEqual([null, null]);
});

it("holds the dialog open against Escape only while it is saving", async () => {
  const { el } = await mount({ value: cooked });
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  const press = (key: string) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    modal.dispatchEvent(event);
    return event.defaultPrevented;
  };

  expect(press("Escape")).toBe(false);
  el.busy = true;
  await el.updateComplete;
  expect(press("Escape")).toBe(true);
  expect(press("Enter")).toBe(false);
});

it("ignores a drag whose row was removed mid-gesture, leaving the save's messages in place", async () => {
  const WELL = "55555555-5555-4555-8555-555555555555";
  const { el, host } = await mount({
    value: {
      ...cooked,
      labels: [
        ...cooked.labels,
        { id: WELL, name: "Well done", customerName: {}, kitchenName: "W", available: true },
      ],
    },
  });
  const submitted = record(host);
  const handle = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${RARE}"]`)!;
  handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));

  await click(el, "remove-label-0");
  await type(el, "name", "");
  await click(el, "save");
  expect(summary(el)).toEqual([t("options.name_required")]);

  const firstRow = el.shadowRoot!.querySelector("tbody tr")!.getBoundingClientRect();
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 1,
      clientY: firstRow.top + firstRow.height / 2,
    }),
  );
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  await el.updateComplete;

  expect(summary(el)).toEqual([t("options.name_required")]);
  await type(el, "name", "Cooked");
  await click(el, "save");
  expect(submitted[0]!.labels.map((label) => label.id)).toEqual([MEDIUM, WELL]);
});
