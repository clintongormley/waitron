import { afterEach, expect, it } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
// Value import (not `import type`): pulls the module in for its `@customElement` side effect, so
// `mountWidget` can create `dashboard-option-label-form`.
import { OptionLabelForm, type DraftLabel } from "./option-label-form.js";
import { t } from "../i18n/t.js";

registerIcons(DASHBOARD_ICONS);
afterEach(cleanupWidgets);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RARE = "11111111-1111-4111-8111-111111111111";

/** The three names read DIFFERENTLY (CLAUDE.md §3), so a field seeded from the wrong one fails. */
const rare: DraftLabel = {
  id: RARE,
  name: "Rare",
  customerName: { en: "Barely cooked", es: "Poco hecho" },
  kitchenName: "R",
  available: true,
};

const languages = { defaultLanguage: "en", languages: ["en", "es"] };

async function mount(props: Partial<OptionLabelForm> = {}) {
  return mountWidget<OptionLabelForm>("dashboard-option-label-form", {
    open: true,
    languages,
    ...props,
  });
}

function field<T extends Element = HTMLElementTagNameMap["wt-input"]>(
  el: OptionLabelForm,
  name: string,
): T {
  return el.shadowRoot!.querySelector<T>(`[name="${name}"]`)!;
}

async function type(el: OptionLabelForm, name: string, value: string): Promise<void> {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function toggle(el: OptionLabelForm, name: string, checked: boolean): Promise<void> {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function click(el: OptionLabelForm, testId: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${testId}"]`)!.click();
  await el.updateComplete;
}

async function bottomOf(el: OptionLabelForm): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}

const saveOf = (el: OptionLabelForm): HTMLElementTagNameMap["wt-button"] =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!;

/** The native input a `wt-input` field wraps, which is what focus lands on. */
const inputOf = (el: OptionLabelForm, name: string): HTMLInputElement =>
  field(el, name).shadowRoot!.querySelector("input")!;

/** Counts submissions as well as capturing them: a composed event re-emitted without stopping the
 * original arrives twice, and a single-shot listener cannot see that. */
function record(host: HTMLElement) {
  const seen: DraftLabel[] = [];
  host.addEventListener("wt-submit", (event) => {
    seen.push((event as CustomEvent<{ value: DraftLabel }>).detail.value);
  });
  return seen;
}

function heading(el: OptionLabelForm): string {
  return el.shadowRoot!.querySelector("wt-modal")!.heading;
}

it("opens an option with its name, its other names and its availability", async () => {
  const { el } = await mount({ value: { ...rare, customerName: { es: "Poco hecho" } } });

  expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
  expect(heading(el)).toBe(t("options.edit_option"));
  expect(field(el, "label-name").value).toBe("Rare");
  expect(field(el, "label-name").closest("wt-disclosure")).toBeNull();
  expect(field(el, "label-customer-name-en").value).toBe("");
  expect(field(el, "label-customer-name-es").value).toBe("Poco hecho");
  expect(field(el, "label-kitchen-name").value).toBe("R");
  expect(field(el, "label-kitchen-name").placeholder).toBe("Rare");
  expect(field<HTMLElementTagNameMap["wt-switch"]>(el, "label-available").checked).toBe(true);
});

it("hints each blank name with what it falls back to, following the fields it copies as they are typed", async () => {
  const { el } = await mount({ value: { ...rare, customerName: {}, kitchenName: "" } });
  const hints = () =>
    ["label-kitchen-name", "label-customer-name-en", "label-customer-name-es"].map(
      (name) => field(el, name).placeholder,
    );

  expect(hints()).toEqual(["Rare", "Rare", "Rare"]);
  await type(el, "label-customer-name-en", "Barely cooked");
  expect(hints()).toEqual(["Rare", "Rare", "Barely cooked"]);
  await type(el, "label-name", "Blue");
  expect(hints()).toEqual(["Blue", "Blue", "Barely cooked"]);
  await type(el, "label-customer-name-en", " ");
  expect(hints()).toEqual(["Blue", "Blue", "Blue"]);
});

it("never hints a customer-facing name with the kitchen name, which keeps its own text", async () => {
  const { el } = await mount({ value: { ...rare, customerName: {} } });
  const hints = () =>
    ["label-customer-name-en", "label-customer-name-es"].map((name) => field(el, name).placeholder);

  expect(field(el, "label-kitchen-name").value).toBe("R");
  expect(hints()).toEqual(["Rare", "Rare"]);
  await type(el, "label-customer-name-en", "Barely cooked");
  expect(hints()).toEqual(["Rare", "Barely cooked"]);
  await type(el, "label-kitchen-name", "BLEU");
  expect(field(el, "label-kitchen-name").value).toBe("BLEU");
  expect(hints()).toEqual(["Rare", "Barely cooked"]);
});

it.each([
  ["Edit option", rare],
  ["Add option", null],
])(
  "%s shows every name with no fold: Name, Kitchen name, the customer-facing names under their heading, then Available",
  async (_, value) => {
    const { el } = await mount({ value });
    await el.updateComplete;

    expect(el.shadowRoot!.querySelector("wt-disclosure")).toBeNull();
    const heading = el.shadowRoot!.querySelector<HTMLElement>(
      '[data-test="customer-names-heading"]',
    )!;
    expect(heading.textContent!.trim()).toBe(t("options.customer_names"));
    const order = [
      ...el.shadowRoot!.querySelectorAll<HTMLElement>(
        '.fields [name], .fields [data-test="customer-names-heading"]',
      ),
    ].map((node) => node.getAttribute("name") ?? node.dataset.test);
    expect(order).toEqual([
      "label-name",
      "label-kitchen-name",
      "customer-names-heading",
      "label-customer-name-en",
      "label-customer-name-es",
      "label-available",
    ]);
    for (const node of [
      heading,
      field(el, "label-kitchen-name"),
      field(el, "label-customer-name-en"),
      field(el, "label-customer-name-es"),
    ])
      expect(node.checkVisibility(), node.getAttribute("name") ?? "heading").toBe(true);
  },
);

it("opens empty and headed Add option when it is given no option", async () => {
  const { el } = await mount({ value: null });

  expect(heading(el)).toBe(t("options.add_option"));
  expect(field(el, "label-name").value).toBe("");
  expect(field(el, "label-kitchen-name").value).toBe("");
  expect(field<HTMLElementTagNameMap["wt-switch"]>(el, "label-available").checked).toBe(true);
});

it("refuses a blank name beside the name and in the bottom message, and emits nothing", async () => {
  const { el, host } = await mount({ value: rare });
  const submitted = record(host);

  await type(el, "label-name", "   ");
  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(field(el, "label-name").error).toBe(t("options.label_name_required"));
  expect(field(el, "label-name").invalid).toBe(true);
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();

  await type(el, "label-name", "Rare");
  expect(field(el, "label-name").error).toBe("");
});

it("submits the edited option once, under the id it was given", async () => {
  const { el, host } = await mount({ value: rare });
  const submitted = record(host);

  await type(el, "label-name", "Very rare");
  await type(el, "label-customer-name-en", "Blue");
  await type(el, "label-kitchen-name", "VR");
  await toggle(el, "label-available", false);
  await click(el, "save");

  expect(submitted).toEqual([
    {
      id: RARE,
      name: "Very rare",
      customerName: { en: "Blue", es: "Poco hecho" },
      kitchenName: "VR",
      available: false,
    },
  ]);
});

it("gives a new option an id of its own", async () => {
  const { el, host } = await mount({ value: null });
  const submitted = record(host);

  await type(el, "label-name", "Well done");
  await click(el, "save");

  expect(submitted).toEqual([
    {
      id: expect.stringMatching(UUID),
      name: "Well done",
      customerName: {},
      kitchenName: "",
      available: true,
    },
  ]);
});

it("emits one wt-cancel from Cancel, and neither event while it is saving", async () => {
  const { el, host } = await mount({ value: rare, busy: true });
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

it("does not report a cancel when it is closed by the form that opened it", async () => {
  const { el, host } = await mount({ value: rare });
  let cancels = 0;
  host.addEventListener("wt-cancel", () => cancels++);

  el.open = false;
  await el.updateComplete;
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  await closeReportsDelivered();

  expect(cancels).toBe(0);
});

it("reports a cancel when its own dialog is dismissed", async () => {
  const { el, host } = await mount({ value: rare });
  let cancels = 0;
  host.addEventListener("wt-cancel", () => cancels++);

  el.shadowRoot!.querySelector("wt-modal")!.dispatchEvent(
    new CustomEvent("wt-close", { bubbles: true, composed: true }),
  );

  expect(cancels).toBe(1);
});

it.each(["label-customer-name-en", "label-kitchen-name", "label-name"])(
  "shows an error given for %s beside it, in sight, with Save working throughout",
  async (key) => {
    const { el } = await mount({ value: rare, errors: { [key]: "Refused." } });

    expect(field(el, key).error).toBe("Refused.");
    expect(saveOf(el).disabled).toBe(false);
    expect(saveOf(el).variant).toBe("primary");

    await toggle(el, "label-available", false);
    expect(field(el, key).error).toBe("Refused.");
    expect(await bottomOf(el)).toBe(t("form.fix_fields"));
    expect(saveOf(el).disabled).toBe(false);
    expect(field(el, key).invalid).toBe(true);
    expect(field(el, key).checkVisibility()).toBe(true);
  },
);

it("reseeds from a new option each time it opens", async () => {
  const { el } = await mount({ value: rare });
  await type(el, "label-name", "Changed");

  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;
  expect(field(el, "label-name").value).toBe("Rare");

  el.value = { ...rare, id: "22222222-2222-4222-8222-222222222222", name: "Medium" };
  await el.updateComplete;
  expect(field(el, "label-name").value).toBe("Medium");
});

it("holds the dialog open against Escape only while it is saving", async () => {
  const { el } = await mount({ value: rare });
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

it("saves on Enter in a field", async () => {
  const { el, host } = await mount({ value: rare });
  const submitted = record(host);
  await type(el, "label-kitchen-name", "RR");

  field(el, "label-name")
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await el.updateComplete;

  expect(submitted.map((label) => label.id)).toEqual([RARE]);
});

it("says nothing about errors before the first submission, and Save works", async () => {
  const { el } = await mount({ value: rare });
  await type(el, "label-name", "");

  expect(field(el, "label-name").error).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("on an invalid submission focuses the name, keeps what was typed and disables Save", async () => {
  const { el } = await mount({ value: rare });
  await type(el, "label-customer-name-en", "Blue");
  await type(el, "label-name", " ");
  await click(el, "save");
  await new Promise((resolve) => setTimeout(resolve));

  expect(field(el, "label-name").shadowRoot!.activeElement).toBe(inputOf(el, "label-name"));
  expect(field(el, "label-customer-name-en").value).toBe("Blue");
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);
});

it("re-checks every change after a failed submission, and Save works again once the name is fixed", async () => {
  const { el } = await mount({ value: null });
  await type(el, "label-kitchen-name", "WD");
  await click(el, "save");
  expect(field(el, "label-name").error).toBe(t("options.label_name_required"));

  await type(el, "label-name", "Rare");
  expect(field(el, "label-name").error).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);

  await type(el, "label-name", " ");
  expect(field(el, "label-name").error).toBe(t("options.label_name_required"));
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);
});

it("keeps a field's refusal until that field changes, with Save working throughout", async () => {
  const { el } = await mount({ value: rare, errors: { "label-kitchen-name": "Too long." } });
  expect(field(el, "label-kitchen-name").error).toBe("Too long.");
  expect(saveOf(el).disabled).toBe(false);
  expect(saveOf(el).variant).toBe("primary");

  await type(el, "label-name", "Very rare");
  expect(field(el, "label-kitchen-name").error).toBe("Too long.");
  expect(saveOf(el).disabled).toBe(false);

  await type(el, "label-kitchen-name", "VR");
  expect(field(el, "label-kitchen-name").error).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("clears a translated name's refusal only when that language's value changes", async () => {
  const { el } = await mount({
    value: rare,
    errors: { "label-customer-name-en": "Rejected English." },
  });

  await type(el, "label-customer-name-es", "Muy poco hecho");
  expect(field(el, "label-customer-name-en").error).toBe("Rejected English.");
  expect(saveOf(el).disabled).toBe(false);

  await type(el, "label-customer-name-en", "Very rare");
  expect(field(el, "label-customer-name-en").error).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("keeps a dismissed refusal dismissed when handed the same messages as a new object", async () => {
  const { el } = await mount({ value: rare, errors: { "label-kitchen-name": "Too long." } });
  await type(el, "label-kitchen-name", "VR");

  el.errors = { "label-kitchen-name": "Too long." };
  await el.updateComplete;
  expect(field(el, "label-kitchen-name").error).toBe("");

  el.errors = { "label-kitchen-name": "Still too long." };
  await el.updateComplete;
  expect(field(el, "label-kitchen-name").error).toBe("Still too long.");
});

it("focuses the field a refusal names when the refusal arrives", async () => {
  const { el } = await mount({ value: rare });
  el.errors = { "label-kitchen-name": "Too long." };
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve));

  expect(field(el, "label-kitchen-name").shadowRoot!.activeElement).toBe(
    inputOf(el, "label-kitchen-name"),
  );
});

it("keeps a refusal naming no field in the bottom message alone, leaving Save working until it is submitted again", async () => {
  const { el, host } = await mount({ value: rare, errors: { "label-available": "Refused." } });
  const submitted = record(host);

  expect(await bottomOf(el)).toBe("Refused.");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);

  await type(el, "label-kitchen-name", "RR");
  expect(await bottomOf(el)).toBe("Refused.");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);

  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(await bottomOf(el)).toBe("");
});

it("shows a refusal naming no field and the generic sentence together when both apply", async () => {
  const { el } = await mount({
    value: rare,
    errors: { "label-available": "Refused.", "label-name": "Already used." },
  });

  expect(await bottomOf(el)).toBe(`Refused. ${t("form.fix_fields")}`);
});

it("starts again when reopened: no messages, Save quiet, and working after an edit", async () => {
  const { el } = await mount({ value: null });
  await type(el, "label-kitchen-name", "WD");
  await click(el, "save");
  expect(field(el, "label-name").error).toBe(t("options.label_name_required"));
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);

  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;

  expect(field(el, "label-name").error).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);
  expect(saveOf(el).variant).toBe("secondary");

  await type(el, "label-name", "Well done");
  expect(field(el, "label-name").error).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});
