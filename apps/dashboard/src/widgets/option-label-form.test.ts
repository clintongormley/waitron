import { afterEach, expect, it } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
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

function disclosure(el: OptionLabelForm): HTMLElementTagNameMap["wt-disclosure"] {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
    '[data-test="names-section"]',
  )!;
}

function summary(el: OptionLabelForm): string[] {
  const box = el.shadowRoot!.querySelector("wt-form-error-summary")!;
  return [...box.shadowRoot!.querySelectorAll("li")].map((item) => item.textContent!.trim());
}

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

it("opens an option with its name, a closed section holding its other names, and its availability", async () => {
  const { el } = await mount({ value: { ...rare, customerName: { es: "Poco hecho" } } });

  expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(true);
  expect(heading(el)).toBe(t("options.edit_option"));
  expect(field(el, "label-name").value).toBe("Rare");
  expect(field(el, "label-name").closest("wt-disclosure")).toBeNull();
  const section = disclosure(el);
  expect(section.open).toBe(false);
  expect(section.heading).toBe(t("options.names_section"));
  expect(section.summary).toBe(
    t("options.names_summary").replace("{filled}", "2").replace("{total}", "3"),
  );
  for (const name of ["label-customer-name-en", "label-customer-name-es", "label-kitchen-name"])
    expect(field(el, name).closest("wt-disclosure"), name).toBe(section);
  expect(field(el, "label-customer-name-en").value).toBe("");
  expect(field(el, "label-customer-name-es").value).toBe("Poco hecho");
  expect(field(el, "label-kitchen-name").value).toBe("R");
  expect(field(el, "label-kitchen-name").placeholder).toBe("Rare");
  expect(field<HTMLElementTagNameMap["wt-switch"]>(el, "label-available").checked).toBe(true);

  await type(el, "label-customer-name-en", "Barely cooked");
  expect(section.summary).toBe(
    t("options.names_summary").replace("{filled}", "3").replace("{total}", "3"),
  );
  await type(el, "label-kitchen-name", " ");
  expect(section.summary).toBe(
    t("options.names_summary").replace("{filled}", "2").replace("{total}", "3"),
  );
});

it("opens empty and headed Add option when it is given no option", async () => {
  const { el } = await mount({ value: null });

  expect(heading(el)).toBe(t("options.add_option"));
  expect(field(el, "label-name").value).toBe("");
  expect(field(el, "label-kitchen-name").value).toBe("");
  expect(field<HTMLElementTagNameMap["wt-switch"]>(el, "label-available").checked).toBe(true);
});

it("refuses a blank name beside the name and in the summary, and emits nothing", async () => {
  const { el, host } = await mount({ value: rare });
  const submitted = record(host);

  await type(el, "label-name", "   ");
  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(field(el, "label-name").error).toBe(t("options.label_name_required"));
  expect(field(el, "label-name").invalid).toBe(true);
  expect(summary(el)).toEqual([t("options.label_name_required")]);

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

it.each([
  ["label-customer-name-en", true],
  ["label-kitchen-name", true],
  ["label-name", false],
])("shows an error given for %s beside it, opening the names section: %s", async (key, opened) => {
  const { el } = await mount({ value: rare, errors: { [key]: "Refused." } });
  await disclosure(el).updateComplete;

  expect(field(el, key).error).toBe("Refused.");
  expect(summary(el)).toEqual(["Refused."]);
  expect({ hasError: disclosure(el).hasError, open: disclosure(el).open }).toEqual({
    hasError: opened,
    open: opened,
  });
});

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

  field(el, "label-name")
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await el.updateComplete;

  expect(submitted.map((label) => label.id)).toEqual([RARE]);
});
