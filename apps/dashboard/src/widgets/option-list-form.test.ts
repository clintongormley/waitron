import { userEvent } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import (not `import type`): pulls the module in for its `@customElement` side effect, so
// `mountWidget` can create `dashboard-option-list-form`.
import { OptionListForm } from "./option-list-form.js";
import type { OptionList, OptionListInput } from "../api/client.js";
import { t } from "../i18n/t.js";

afterEach(cleanupWidgets);

/** The shape `crypto.randomUUID()` produces, which is what `parseOptionListInput`'s `id()` accepts
 * (`isUuid` in packages/shared/src/ids.ts). */
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

/** Every message the summary is showing, in order. */
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
  // The point of minting: `parseOptionListInput` refuses a `defaultLabelId` that names no label in
  // the submitted array (option-contract.ts), so a never-saved label can only be preselected if the
  // form sends it with an id of its own.
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

  // The same list is savable the moment it is not being offered — which is what the server does
  // too (`if (list.active && !labels.some(...))` in option-contract.ts).
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
    // The paths `parseOptionListInput` reports (option-contract.ts), as the screen receives them in
    // `AppError.params.field`.
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
  // `parseOptionListInput` would drop this to null anyway; sending null means the screen and the
  // stored row already agree, with nothing refused on the way.
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
 * `accent-color` hands that drawing the brand colour — the same declaration
 * packages/ui/src/components/wt-data-table.ts and apps/dashboard/src/screens/printers-screen.ts give
 * their own native controls. The UNCHECKED fill is a separate matter settled by `color-scheme`
 * (packages/ui/src/tokens/colors.test.ts), which this says nothing about.
 */
it("hands the preselect radio the brand colour to draw its checked dot with", async () => {
  const { el, host } = await mount({ value: cooked });
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");

  const radio = el.shadowRoot!.querySelector<HTMLInputElement>('[data-test="label-0-default"]')!;
  expect(getComputedStyle(radio).accentColor).toBe("rgb(1, 2, 3)");
});

/**
 * Found by opening the form and reading it: the two single-input cells carried no minimum width, so
 * the table's automatic layout collapsed each to `wt-input`'s own `--wt-tap-min` floor and a real
 * label's name was cut off mid-word — at 1280px, with unused space to the right of the table.
 * Measured before the fix: a 68px box around a 105px value ("Poco hecho" rendered as "Poco h"). The
 * customer-name cell beside it was never affected, because `.cell-stack` already carries the shared
 * sizing token. The kitchen-name field takes the same room: its placeholder is the STAFF name, so a
 * blank one shows the same string this test measures.
 */
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
