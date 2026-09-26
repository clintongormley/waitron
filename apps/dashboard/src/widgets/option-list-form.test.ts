import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import (not `import type`): pulls the module in for its `@customElement` side effect, so
// `mountWidget` can create `dashboard-option-list-form`.
import { OptionListForm } from "./option-list-form.js";
import type { OptionLabelForm } from "./option-label-form.js";
import type { OptionList, OptionListInput } from "../api/client.js";
import { t } from "../i18n/t.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const RARE = "11111111-1111-4111-8111-111111111111";
const MEDIUM = "22222222-2222-4222-8222-222222222222";
const WELL = "55555555-5555-4555-8555-555555555555";

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

const wellDone = {
  id: WELL,
  name: "Well done",
  customerName: {},
  kitchenName: "W",
  available: true,
};

const languages = { defaultLanguage: "en", languages: ["en", "es"] };

async function mount(props: Partial<OptionListForm> = {}) {
  return mountWidget<OptionListForm>("dashboard-option-list-form", {
    open: true,
    languages,
    ...props,
  });
}

function field<T extends Element = HTMLElementTagNameMap["wt-input"]>(
  el: OptionListForm | OptionLabelForm,
  name: string,
): T {
  return el.shadowRoot!.querySelector<T>(`[name="${name}"]`)!;
}

/** Type into a `wt-input` the way the primitive announces a change. */
async function type(el: OptionListForm | OptionLabelForm, name: string, value: string) {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

/** Flip a `wt-switch` the way the primitive announces a change. */
async function toggle(el: OptionListForm | OptionLabelForm, name: string, checked: boolean) {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function click(el: OptionListForm | OptionLabelForm, testId: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${testId}"]`)!.click();
  await el.updateComplete;
}

function summary(el: OptionListForm | OptionLabelForm): string[] {
  const box = el.shadowRoot!.querySelector("wt-form-error-summary")!;
  return [...box.shadowRoot!.querySelectorAll("li")].map((item) => item.textContent!.trim());
}

function editor(el: OptionListForm): OptionLabelForm {
  return el.shadowRoot!.querySelector<OptionLabelForm>("dashboard-option-label-form")!;
}

/** Opens the option editor from a row's Edit action, or empty from Add option. */
async function openEditor(el: OptionListForm, index: number | "new"): Promise<OptionLabelForm> {
  await click(el, index === "new" ? "add-option" : `edit-label-${index}`);
  await editor(el).updateComplete;
  return editor(el);
}

async function saveEditor(el: OptionListForm): Promise<void> {
  await click(editor(el), "save");
  await el.updateComplete;
}

/** Adds an option through the editor, as the operator does. */
async function addOption(
  el: OptionListForm,
  name: string,
  fill?: (form: OptionLabelForm) => Promise<void>,
) {
  const form = await openEditor(el, "new");
  await type(form, "label-name", name);
  if (fill) await fill(form);
  await saveEditor(el);
}

/** Edits one option through its row's editor. */
async function editOption(
  el: OptionListForm,
  index: number,
  fill: (form: OptionLabelForm) => Promise<void>,
) {
  const form = await openEditor(el, index);
  await fill(form);
  await saveEditor(el);
}

function text(el: OptionListForm, testId: string): string {
  return el.shadowRoot!.querySelector(`[data-test="${testId}"]`)!.textContent!.trim();
}

function rowErrors(el: OptionListForm, index: number): string[] {
  return [...el.shadowRoot!.querySelectorAll(`[data-test="label-${index}-error"]`)].map((node) =>
    node.textContent!.trim(),
  );
}

function radio(el: OptionListForm, index: number): HTMLInputElement {
  return el.shadowRoot!.querySelector<HTMLInputElement>(`[data-test="label-${index}-default"]`)!;
}

function checkedDefault(el: OptionListForm): number[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
    .map((input, index) => (input.checked ? index : -1))
    .filter((index) => index >= 0);
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

it("submits a new list once, minting an id for every option so a brand-new one can be the default", async () => {
  const { el, host } = await mount();
  const submitted = record(host);

  await type(el, "name", "Cooked");
  await type(el, "customer-name-en", "How would you like it?");
  await type(el, "customer-name-es", "¿En qué punto?");
  await type(el, "kitchen-name", "COOK");
  await addOption(el, "Rare", async (form) => {
    await type(form, "label-customer-name-en", "Barely cooked");
    await type(form, "label-kitchen-name", "R");
  });
  await addOption(el, "Medium", async (form) => {
    await type(form, "label-customer-name-es", "Al punto");
    await type(form, "label-kitchen-name", "M");
  });
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

  await editOption(el, 0, (form) => type(form, "label-kitchen-name", "RR"));
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

it("refuses an active list with no available option itself, beside the options and in the summary", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  await editOption(el, 0, (form) => toggle(form, "label-available", false));
  await editOption(el, 1, (form) => toggle(form, "label-available", false));
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

  await addOption(el, "Rare");
  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(field(el, "name").error).toBe(t("options.name_required"));
  expect(summary(el)).toEqual([t("options.name_required")]);
});

it("shows each option as text with a Default radio, an Unavailable lozenge only when it is off, and a menu of actions", async () => {
  const { el } = await mount({
    value: { ...cooked, labels: [...cooked.labels, { ...wellDone, available: false }] },
  });

  expect(el.shadowRoot!.querySelector(".table-wrap")!.getAttribute("aria-label")).toBe(
    t("options.list_options"),
  );
  const rows = [...el.shadowRoot!.querySelectorAll("tbody tr")];
  expect(rows).toHaveLength(3);
  for (const row of rows) expect(row.querySelector("wt-input")).toBeNull();
  expect([0, 1, 2].map((index) => text(el, `label-${index}-name`))).toEqual([
    "Rare",
    "Medium",
    "Well done",
  ]);
  expect(
    [0, 1, 2].map(
      (index) =>
        el.shadowRoot!.querySelector(`[data-test="label-${index}-unavailable"]`)?.tagName ?? null,
    ),
  ).toEqual([null, null, "WT-LOZENGE"]);
  expect(text(el, "label-2-unavailable")).toBe(t("options.unavailable"));
  expect(checkedDefault(el)).toEqual([1]);
  expect(radio(el, 2).disabled).toBe(true);
  expect(radio(el, 0).getAttribute("aria-label")).toBe(`${t("options.default")}: Rare`);

  const actions = rows[0]!.querySelector("wt-row-actions")!;
  expect(actions.label).toBe(`${t("options.option_actions")}: Rare`);
  expect(
    [...actions.querySelectorAll("wt-button")].map((button) => [
      button.dataset.test,
      button.textContent!.trim(),
    ]),
  ).toEqual([
    ["edit-label-0", t("action.edit")],
    ["remove-label-0", t("action.delete")],
  ]);
});

it("folds the list's customer-facing and kitchen names into a closed section that counts them", async () => {
  const { el } = await mount({ value: { ...cooked, customerName: { es: "¿En qué punto?" } } });
  const section = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
    '[data-test="names-section"]',
  )!;

  expect(section.tagName).toBe("WT-DISCLOSURE");
  expect(section.open).toBe(false);
  expect(section.heading).toBe(t("options.names_section"));
  for (const name of ["customer-name-en", "customer-name-es", "kitchen-name"])
    expect(field(el, name).closest("wt-disclosure"), name).toBe(section);
  expect(field(el, "name").closest("wt-disclosure")).toBeNull();
  expect(section.summary).toBe(
    t("options.names_summary").replace("{filled}", "2").replace("{total}", "3"),
  );
  await type(el, "customer-name-en", "How would you like it?");
  expect(section.summary).toBe(
    t("options.names_summary").replace("{filled}", "3").replace("{total}", "3"),
  );
});

it.each([
  ["customerName", true],
  ["kitchenName", true],
  ["name", false],
])("opens the list's names section when the server refuses %s: %s", async (path, opened) => {
  const { el } = await mount({ value: cooked, fieldErrors: { [path]: "Refused." } });
  const section = el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
    '[data-test="names-section"]',
  )!;
  await section.updateComplete;
  expect({ hasError: section.hasError, open: section.open }).toEqual({
    hasError: opened,
    open: opened,
  });
});

it("opens the option editor empty from Add option, and its Save appends the option", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  const add = el.shadowRoot!.querySelector('[data-test="add-option"]')!;
  expect(add.textContent!.trim()).toBe(t("options.add_option"));
  expect(editor(el).open).toBe(false);
  const form = await openEditor(el, "new");
  expect(form.open).toBe(true);
  expect(form.value).toBeNull();
  expect(form.languages).toEqual(languages);
  await type(form, "label-name", "Well done");
  await saveEditor(el);

  expect(form.open).toBe(false);
  expect(submitted).toEqual([]);
  expect(text(el, "label-2-name")).toBe("Well done");
  await click(el, "save");
  expect(submitted[0]!.labels.map((label) => label.name)).toEqual(["Rare", "Medium", "Well done"]);
});

it("opens the option editor on a row's option, and its Save replaces that row without sending the list", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  const form = await openEditor(el, 1);
  expect(form.open).toBe(true);
  expect(form.value).toEqual({ ...cooked.labels[1]!, kitchenName: "M" });
  expect(form.errors).toEqual({});
  await type(form, "label-name", "Medium rare");
  await saveEditor(el);

  expect(submitted).toEqual([]);
  expect(form.open).toBe(false);
  expect(text(el, "label-1-name")).toBe("Medium rare");
  expect(el.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(2);
  await click(el, "save");
  expect(submitted[0]!.labels.map((label) => [label.id, label.name])).toEqual([
    [RARE, "Rare"],
    [MEDIUM, "Medium rare"],
  ]);
});

it("changes nothing when the option editor is cancelled", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);
  let cancels = 0;
  host.addEventListener("wt-cancel", () => cancels++);

  const form = await openEditor(el, 0);
  await type(form, "label-name", "Changed");
  await click(form, "cancel");
  await el.updateComplete;

  expect(form.open).toBe(false);
  // The editor's own cancel is the list's business, not the screen's: the list stays open.
  expect(cancels).toBe(0);
  expect(text(el, "label-0-name")).toBe("Rare");
  await click(el, "save");
  expect(submitted[0]!.labels[0]!.name).toBe("Rare");
});

it("offers no Clear default: an available option is always the default", async () => {
  const { el } = await mount({ value: cooked });
  expect(el.shadowRoot!.querySelector('[data-test="clear-default"]')).toBeNull();
  expect(checkedDefault(el)).toEqual([1]);
});

it("makes a new list's first option its default", async () => {
  const { el, host } = await mount();
  const submitted = record(host);

  await type(el, "name", "Cooked");
  await addOption(el, "Rare");
  await addOption(el, "Medium");
  expect(checkedDefault(el)).toEqual([0]);
  await click(el, "save");

  expect(submitted[0]!.defaultLabelId).toBe(submitted[0]!.labels[0]!.id);
});

it("makes a newly added option the default when no option was available", async () => {
  const { el, host } = await mount({
    value: {
      ...cooked,
      active: false,
      defaultLabelId: null,
      labels: [{ ...cooked.labels[0]!, available: false }],
    },
  });
  const submitted = record(host);
  expect(checkedDefault(el)).toEqual([]);

  await addOption(el, "Medium");
  await click(el, "save");

  expect(submitted[0]!.defaultLabelId).toBe(submitted[0]!.labels[1]!.id);
});

it("moves the default to the first available option when the default option is removed", async () => {
  const { el, host } = await mount({
    value: {
      ...cooked,
      defaultLabelId: WELL,
      labels: [{ ...cooked.labels[0]!, available: false }, cooked.labels[1]!, wellDone],
    },
  });
  const submitted = record(host);

  await click(el, "remove-label-2");
  await click(el, "save");

  expect(submitted[0]!.labels.map((label) => label.id)).toEqual([RARE, MEDIUM]);
  expect(submitted[0]!.defaultLabelId).toBe(MEDIUM);
});

it("moves the default to the first available option when the option editor switches it off", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  await editOption(el, 1, (form) => toggle(form, "label-available", false));
  expect(checkedDefault(el)).toEqual([0]);
  await click(el, "save");

  expect(submitted[0]!.defaultLabelId).toBe(RARE);
  expect(summary(el)).toEqual([]);
});

it("keeps the chosen default when another option is switched off", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  await editOption(el, 0, (form) => toggle(form, "label-available", false));
  await click(el, "save");

  expect(submitted[0]!.defaultLabelId).toBe(MEDIUM);
});

it("leaves no default once the last available option is removed", async () => {
  const { el, host } = await mount({
    value: { ...cooked, labels: [{ ...cooked.labels[0]!, available: false }, cooked.labels[1]!] },
  });
  const submitted = record(host);

  await click(el, "remove-label-1");
  await toggle(el, "active", false);
  await click(el, "save");

  expect(submitted[0]!.labels.map((label) => label.id)).toEqual([RARE]);
  expect(submitted[0]!.defaultLabelId).toBeNull();
});

it("opens a list whose stored default is empty with the default the server would store", async () => {
  const { el, host } = await mount({ value: { ...cooked, defaultLabelId: null } });
  const submitted = record(host);

  expect(checkedDefault(el)).toEqual([0]);
  await click(el, "save");
  expect(submitted[0]!.defaultLabelId).toBe(RARE);
});

it("opens a list whose default is unavailable on the first available option, not as an error", async () => {
  const withdrawn: OptionList = {
    ...cooked,
    labels: [cooked.labels[0]!, { ...cooked.labels[1]!, available: false }],
  };
  const { el, host } = await mount({ value: withdrawn });
  const submitted = record(host);

  expect(radio(el, 1).checked).toBe(false);
  expect(radio(el, 1).disabled).toBe(true);
  expect(radio(el, 0).checked).toBe(true);
  expect(summary(el)).toEqual([]);
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')).toBeNull();

  await click(el, "save");
  expect(submitted[0]!.defaultLabelId).toBe(RARE);
});

it("shows a refusal naming an option's field under its row and in the summary, and beside the field in its editor", async () => {
  const { el } = await mount({
    value: cooked,
    fieldErrors: { kitchenName: "Too long for the kitchen.", "labels.1.name": "Already used." },
  });

  expect(field(el, "kitchen-name").error).toBe("Too long for the kitchen.");
  expect(rowErrors(el, 1)).toEqual(["Already used."]);
  expect(rowErrors(el, 0)).toEqual([]);
  expect(summary(el).sort()).toEqual(["Already used.", "Too long for the kitchen."]);

  const form = await openEditor(el, 1);
  expect(form.errors).toEqual({ "label-name": "Already used." });
  expect(field(form, "label-name").error).toBe("Already used.");
  await click(form, "cancel");
  const other = await openEditor(el, 0);
  expect(other.errors).toEqual({});
});

it("keeps a rejected option's message on that option after it is moved", async () => {
  const { el } = await mount({ value: cooked, fieldErrors: { "labels.1.name": "Already used." } });

  const handle = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${MEDIUM}"]`)!;
  handle.focus();
  await userEvent.keyboard("{ArrowUp}");
  await el.updateComplete;

  expect(rowErrors(el, 0)).toEqual(["Already used."]);
  expect(rowErrors(el, 1)).toEqual([]);
  expect((await openEditor(el, 0)).errors).toEqual({ "label-name": "Already used." });
});

it("submits the options in the order the operator moved them into", async () => {
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

it("removes an option, and the list it submits no longer carries it", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  await click(el, "remove-label-1");
  await click(el, "save");

  expect(submitted[0]!.labels.map((label) => label.id)).toEqual([RARE]);
  expect(submitted[0]!.defaultLabelId).toBe(RARE);
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
  const { el, host } = await mount({
    value: cooked,
    fieldErrors: { "labels.0.name": "Already used." },
  });
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-tap-min", "44px");

  await editOption(el, 0, (form) => toggle(form, "label-available", false));
  await editOption(el, 1, (form) => toggle(form, "label-available", false));
  await click(el, "save");

  for (const testId of ["labels-error", "label-0-error"]) {
    const error = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${testId}"]`)!;
    expect({ testId, color: getComputedStyle(error).color }).toEqual({
      testId,
      color: "rgb(13, 14, 15)",
    });
  }

  const actions = el
    .shadowRoot!.querySelector("wt-row-actions")!
    .shadowRoot!.querySelector("button")!;
  for (const [testId, box] of [
    [`drag-${RARE}`, el.shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${RARE}"]`)!],
    ["label-0-pick", el.shadowRoot!.querySelector<HTMLElement>('[data-test="label-0-pick"]')!],
    ["actions", actions],
  ] as const) {
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

  expect(getComputedStyle(radio(el, 0)).accentColor).toBe("rgb(1, 2, 3)");
});

it("puts a customer-name refusal beside the first language, and an active one in the summary", async () => {
  const { el } = await mount({
    value: cooked,
    fieldErrors: {
      customerName: "Needs a customer-facing name.",
      active: "Cannot be switched off.",
      "labels.0.customerName": "The option needs one too.",
    },
  });

  expect(field(el, "customer-name-en").error).toBe("Needs a customer-facing name.");
  expect(field(el, "customer-name-es").error).toBe("");
  expect(rowErrors(el, 0)).toEqual(["The option needs one too."]);
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')).toBeNull();
  expect(summary(el).sort()).toEqual([
    "Cannot be switched off.",
    "Needs a customer-facing name.",
    "The option needs one too.",
  ]);

  const form = await openEditor(el, 0);
  expect(form.errors).toEqual({ "label-customer-name-en": "The option needs one too." });
  expect(field(form, "label-customer-name-en").error).toBe("The option needs one too.");
});

it.each([
  ["an option as a whole", "labels.0"],
  ["an option field with no input", "labels.0.available"],
  ["an option the form does not hold", "labels.9.name"],
])("shows a refusal naming %s under the options table", async (_what, path) => {
  const { el } = await mount({ value: cooked, fieldErrors: { [path]: "Something is wrong." } });

  expect(text(el, "labels-error")).toBe("Something is wrong.");
  expect(summary(el)).toEqual(["Something is wrong."]);
});

it("moves a rejected option's message under the options table once that option is removed", async () => {
  const { el } = await mount({ value: cooked, fieldErrors: { "labels.1.name": "Already used." } });
  expect(el.shadowRoot!.querySelector('[data-test="labels-error"]')).toBeNull();

  await click(el, "remove-label-1");

  expect(text(el, "labels-error")).toBe("Already used.");
  expect(summary(el)).toEqual(["Already used."]);
});

it("reads an option with no kitchen name as blank and submits blank kitchen names as null", async () => {
  const { el, host } = await mount({
    value: { ...cooked, labels: [{ ...cooked.labels[0]!, kitchenName: null }, cooked.labels[1]!] },
  });
  const submitted = record(host);
  const form = await openEditor(el, 0);
  expect(field(form, "label-kitchen-name").value).toBe("");
  await click(form, "cancel");

  await type(el, "kitchen-name", "  ");
  await editOption(el, 1, (other) => type(other, "label-kitchen-name", " "));
  await click(el, "save");

  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.kitchenName).toBeNull();
  expect(submitted[0]!.labels.map((label) => label.kitchenName)).toEqual([null, null]);
});

it("trims an option's name when the list is saved", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);

  await editOption(el, 0, (form) => type(form, "label-name", "  Blue  "));
  await click(el, "save");

  expect(submitted[0]!.labels[0]!.name).toBe("Blue");
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
  const { el, host } = await mount({ value: { ...cooked, labels: [...cooked.labels, wellDone] } });
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

// ---------------------------------------------------------------------------
// The option editor stacked over the list

function dialogOf(form: OptionListForm | OptionLabelForm): HTMLDialogElement {
  return form.shadowRoot!.querySelector("wt-modal")!.shadowRoot!.querySelector("dialog")!;
}

/** Opens a row's editor the way a person does — real clicks on the kebab and then on Edit — so the
 * browser treats the second dialog as opened by the user. */
async function openByHand(
  el: OptionListForm,
  index: number,
): Promise<HTMLElementTagNameMap["wt-row-actions"]> {
  const actions = el.shadowRoot!.querySelectorAll("wt-row-actions")[index]!;
  await userEvent.click(actions.shadowRoot!.querySelector("button")!);
  await userEvent.click(el.shadowRoot!.querySelector(`[data-test="edit-label-${index}"]`)!);
  await el.updateComplete;
  await editor(el).updateComplete;
  await vi.waitFor(() => expect(dialogOf(editor(el)).open).toBe(true));
  return actions;
}

it("closes only the option editor on Escape, and puts focus back on that row's actions", async () => {
  const { el, host } = await mount({ value: cooked });
  let cancels = 0;
  host.addEventListener("wt-cancel", () => cancels++);
  const actions = await openByHand(el, 1);

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(editor(el).open).toBe(false));
  await vi.waitFor(() => expect(dialogOf(editor(el)).open).toBe(false));

  expect(dialogOf(el).open).toBe(true);
  expect(el.open).toBe(true);
  expect(cancels).toBe(0);
  await vi.waitFor(() => {
    expect(el.shadowRoot!.activeElement).toBe(actions);
    expect(actions.shadowRoot!.activeElement).toBe(actions.shadowRoot!.querySelector("button"));
  });
});

it("puts focus back on that row's actions after the option editor saves", async () => {
  const { el } = await mount({ value: cooked });
  const actions = await openByHand(el, 0);

  await type(editor(el), "label-name", "Blue");
  await userEvent.click(editor(el).shadowRoot!.querySelector('[data-test="save"]')!);
  await vi.waitFor(() => expect(dialogOf(editor(el)).open).toBe(false));

  expect(text(el, "label-0-name")).toBe("Blue");
  await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(actions));
});

it("puts focus back on Add option after a new option is saved", async () => {
  const { el } = await mount({ value: cooked });
  const add = el.shadowRoot!.querySelector<HTMLElement>('[data-test="add-option"]')!;
  await userEvent.click(add);
  await editor(el).updateComplete;
  await vi.waitFor(() => expect(dialogOf(editor(el)).open).toBe(true));

  await type(editor(el), "label-name", "Well done");
  await userEvent.click(editor(el).shadowRoot!.querySelector('[data-test="save"]')!);
  await vi.waitFor(() => expect(dialogOf(editor(el)).open).toBe(false));

  await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(add));
});

it("renders the option editor outside the list's saving wrapper, and passes it the saving state", async () => {
  const { el } = await mount({ value: cooked });
  const form = editor(el);

  expect(form.closest(".fields")).toBeNull();
  expect(form.closest("[inert]")).toBeNull();
  expect(form.busy).toBe(false);
  el.busy = true;
  await el.updateComplete;
  expect(form.busy).toBe(true);
  expect(form.closest("[inert]")).toBeNull();
  expect(el.shadowRoot!.querySelector(".fields")!.hasAttribute("inert")).toBe(true);
});

it("keeps the option editor's own save and cancel from reaching the screen", async () => {
  const { el, host } = await mount({ value: cooked });
  const submitted = record(host);
  let cancels = 0;
  host.addEventListener("wt-cancel", () => cancels++);

  await editOption(el, 0, (form) => type(form, "label-name", "Blue"));
  const form = await openEditor(el, 1);
  await click(form, "cancel");

  expect(submitted).toEqual([]);
  expect(cancels).toBe(0);
});

it("closes the option editor when the list is closed or reopened", async () => {
  const { el } = await mount({ value: cooked });
  await openEditor(el, 0);
  expect(editor(el).open).toBe(true);

  el.open = false;
  await el.updateComplete;
  expect(editor(el).open).toBe(false);

  await openEditor(el, 0);
  el.open = true;
  await el.updateComplete;
  expect(editor(el).open).toBe(false);
});

it.each([1280, 390])(
  "centres an option's name, radio and menu on one line at %ipx",
  async (frame) => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(frame, 844);
    try {
      const { el } = await mount({ value: cooked });
      const row = el.shadowRoot!.querySelector(`tr[data-label="${RARE}"]`)!;
      const middle = (node: Element) => {
        const box = node.getBoundingClientRect();
        return box.top + box.height / 2;
      };
      const name = middle(row.querySelector('[data-test="label-0-name"]')!);
      const pick = middle(row.querySelector('[data-test="label-0-default"]')!);
      const menu = middle(
        row.querySelector("wt-row-actions")!.shadowRoot!.querySelector("button")!,
      );

      expect(window.innerWidth).toBe(frame);
      expect(Math.abs(pick - name), "radio").toBeLessThanOrEqual(1);
      expect(Math.abs(menu - name), "menu").toBeLessThanOrEqual(1);
    } finally {
      await page.viewport(width, height);
    }
  },
);
