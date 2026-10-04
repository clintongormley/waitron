import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "./wt-combobox.js";
import {
  DROPDOWN_ICONS,
  SEARCH_THRESHOLD,
  type ComboboxOption,
  type WtCombobox,
} from "./wt-combobox.js";
import { registerIcons } from "./wt-icon.js";
import "./wt-dialog.js";
import type { WtDialog } from "./wt-dialog.js";
import "./wt-input.js";
import { focusFirstInvalid } from "../interactive.js";
import { submitOnEnter } from "../submit-on-enter.js";

test("the dropdown chevron paints wide enough to read", async () => {
  registerIcons({ "test-dropdown-chevron": DROPDOWN_ICONS["chevron-down"]! });
  const icon = await mount('<wt-icon name="test-dropdown-chevron" size="lg"></wt-icon>');
  const path = icon.shadowRoot!.querySelector("path")!;
  expect(path.getBoundingClientRect().width).toBeGreaterThanOrEqual(13);
});

test("the closed field gives its chevron a larger slot", async () => {
  const { el } = await mountCombobox();
  const chevron = el.shadowRoot!.querySelector<HTMLElement>(".chevron")!;
  expect(chevron.getBoundingClientRect().width).toBeGreaterThanOrEqual(18);
});

afterEach(cleanup);

async function mountCombobox(html = '<wt-combobox label="Dietary tags"></wt-combobox>') {
  const el = (await mount(html)) as WtCombobox;
  const trigger = el.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!;
  const popup = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  return { el, trigger, popup };
}

test("renders its label", async () => {
  const { el } = await mountCombobox();
  expect(el.shadowRoot!.querySelector("label")?.textContent?.trim()).toBe("Dietary tags");
});

test("associates the visible label with the trigger, so clicking the label opens the panel", async () => {
  const { el, trigger, popup } = await mountCombobox();
  const label = el.shadowRoot!.querySelector("label")!;
  expect(trigger.id).toMatch(/^wt-combobox-trigger-\d+$/);
  expect(label.htmlFor).toBe(trigger.id);
  await userEvent.click(label);
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
});

test("a named combobox uses that semantic name for the trigger's id and name attribute", async () => {
  const { el, trigger } = await mountCombobox(
    '<wt-combobox label="Dietary tags" name="tags"></wt-combobox>',
  );
  expect(trigger.id).toBe("tags");
  expect(trigger.getAttribute("name")).toBe("tags");
  expect(el.shadowRoot!.querySelector("label")!.htmlFor).toBe("tags");
});

test("falls back to a forwarded aria-label when there is no visible label", async () => {
  const el = await mount('<wt-combobox aria-label="Dietary tags"></wt-combobox>');
  const trigger = el.shadowRoot!.querySelector(".trigger")!;
  expect(trigger.getAttribute("aria-label")).toBe("Dietary tags");
  expect(trigger.hasAttribute("aria-labelledby")).toBe(false);
  // The panel's search box takes the same fallback, so it is not left called just "Search".
  expect(el.shadowRoot!.querySelector(".search")!.getAttribute("aria-label")).toBe("Dietary tags");
});

test("a visible label takes precedence over a forwarded aria-label", async () => {
  const el = await mount('<wt-combobox label="Dietary tags" aria-label="Ignored"></wt-combobox>');
  const trigger = el.shadowRoot!.querySelector(".trigger")!;
  expect(trigger.hasAttribute("aria-label")).toBe(false);
  expect(trigger.getAttribute("aria-labelledby")).toBe(el.shadowRoot!.querySelector("label")!.id);
});

test("opens the panel on trigger click and reflects aria-expanded", async () => {
  const { trigger, popup } = await mountCombobox();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  await userEvent.click(trigger);
  await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
  expect(popup.matches(":popover-open")).toBe(true);
  await userEvent.click(trigger);
  await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
});

test("closes on Escape and returns focus to the trigger", async () => {
  const { el, trigger, popup } = await mountCombobox();
  await userEvent.click(trigger);
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
  expect(el.shadowRoot!.activeElement).toBe(trigger);
});

test("positions the popup against the trigger before the first painted frame", async () => {
  const { trigger, popup } = await mountCombobox();
  const firstFrame = new Promise<DOMRect>((resolve) => {
    trigger.addEventListener(
      "click",
      () => requestAnimationFrame(() => resolve(popup.getBoundingClientRect())),
      { once: true },
    );
  });
  await userEvent.click(trigger);
  const bounds = await firstFrame;
  const anchor = trigger.getBoundingClientRect();
  expect(bounds.top).toBeCloseTo(anchor.bottom, 0);
  expect(bounds.left).toBeCloseTo(anchor.left, 0);
});

test("does not open when disabled", async () => {
  const { trigger, popup } = await mountCombobox(
    '<wt-combobox label="Dietary tags" disabled></wt-combobox>',
  );
  await userEvent.click(trigger, { force: true });
  expect(popup.matches(":popover-open")).toBe(false);
});

test("meets the tap target and paints from the theme tokens", async () => {
  const { el, trigger } = await mountCombobox();
  host.style.setProperty("--wt-tap-min", "52px");
  host.style.setProperty("--wt-color-field-fill", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-field-line", "rgb(4, 5, 6)");
  expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
  const field = el.shadowRoot!.querySelector(".field")!;
  expect(getComputedStyle(field).backgroundColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(field).boxShadow).toBe("rgb(4, 5, 6) 0px -1px 0px 0px inset");
  expect(getComputedStyle(trigger).borderStyle).toBe("none");
});

const TAGS = [
  { value: "gluten-free", label: "Gluten-free" },
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarian" },
];

async function mountWithOptions() {
  const mounted = await mountCombobox();
  mounted.el.options = TAGS;
  await mounted.el.updateComplete;
  return mounted;
}

test("an option row paints the page-background token on hover", async () => {
  const { el, trigger } = await mountWithOptions();
  // --wt-color-surface-raised equals the panel's own white in the light theme, so it would be
  // invisible there.
  host.style.setProperty("--wt-color-bg", "rgb(4, 5, 6)");
  await userEvent.click(trigger);
  const option = el.shadowRoot!.querySelector<HTMLElement>(".option")!;
  expect(getComputedStyle(option).backgroundColor).not.toBe("rgb(4, 5, 6)");
  await userEvent.hover(option);
  expect(getComputedStyle(option).backgroundColor).toBe("rgb(4, 5, 6)");
});

test("lists every option when the panel opens", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const rows = el.shadowRoot!.querySelectorAll('[role="option"]');
  expect([...rows].map((row) => row.textContent?.trim())).toEqual([
    "Gluten-free",
    "Vegan",
    "Vegetarian",
  ]);
});

test("filters the option list as the search box is typed into", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "veg");
  const rows = el.shadowRoot!.querySelectorAll('[role="option"]');
  expect([...rows].map((row) => row.textContent?.trim())).toEqual(["Vegan", "Vegetarian"]);
});

test("filtering is case-insensitive", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "VEG");
  expect(el.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(2);
});

test("shows noResultsLabel when nothing matches and allowAdd is off", async () => {
  const { el, trigger } = await mountWithOptions();
  el.noResultsLabel = "Nothing found";
  await el.updateComplete;
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "zzz");
  expect(el.shadowRoot!.querySelector(".empty")?.textContent).toBe("Nothing found");
  expect(el.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(0);
});

test("focuses the search box on open, and Escape returns focus to the trigger from there", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  expect(el.shadowRoot!.activeElement).toBe(search);
  await userEvent.type(search, "veg");
  await userEvent.keyboard("{Escape}");
  expect(el.shadowRoot!.activeElement).toBe(trigger);
});

test("resets the search box each time the panel is reopened", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "veg");
  await userEvent.keyboard("{Escape}");
  await userEvent.click(trigger);
  expect(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!.value).toBe("");
  expect(el.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(3);
});

test("arrow keys move the active option, reflected in aria-activedescendant", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  search.focus();
  await userEvent.keyboard("{ArrowDown}");
  const rows = el.shadowRoot!.querySelectorAll('[role="option"]');
  expect(search.getAttribute("aria-activedescendant")).toBe(rows[0].id);
  expect(rows[0].classList.contains("active")).toBe(true);
  await userEvent.keyboard("{ArrowDown}");
  expect(search.getAttribute("aria-activedescendant")).toBe(rows[1].id);
  await userEvent.keyboard("{ArrowUp}");
  expect(search.getAttribute("aria-activedescendant")).toBe(rows[0].id);
});

test("ArrowUp with no row active goes to the last row, and the arrows wrap at both ends", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  search.focus();
  const active = () =>
    [...el.shadowRoot!.querySelectorAll('[role="option"]')].map((row) =>
      row.classList.contains("active"),
    );
  await userEvent.keyboard("{ArrowUp}");
  expect(active()).toEqual([false, false, true]);
  await userEvent.keyboard("{End}");
  expect(active()).toEqual([false, false, true]);
  await userEvent.keyboard("{ArrowDown}");
  expect(active()).toEqual([true, false, false]);
  await userEvent.keyboard("{ArrowUp}");
  expect(active()).toEqual([false, false, true]);
});

test("Home and End jump to the first and last option", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  search.focus();
  await userEvent.keyboard("{End}");
  const rows = el.shadowRoot!.querySelectorAll('[role="option"]');
  expect(rows[rows.length - 1].classList.contains("active")).toBe(true);
  await userEvent.keyboard("{Home}");
  expect(el.shadowRoot!.querySelectorAll('[role="option"]')[0].classList.contains("active")).toBe(
    true,
  );
});

test("typing resets the active row to the first match", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "veg");
  expect(el.shadowRoot!.querySelectorAll('[role="option"]')[0].classList.contains("active")).toBe(
    true,
  );
});

test("the search input carries combobox ARIA wiring", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  expect(search.getAttribute("role")).toBe("combobox");
  expect(search.getAttribute("aria-expanded")).toBe("true");
  expect(search.getAttribute("aria-controls")).toBe(
    el.shadowRoot!.querySelector('[role="listbox"]')!.id,
  );
});

test("clicking an option selects it, closes the panel, and emits wt-change (single-select)", async () => {
  const { el, trigger, popup } = await mountWithOptions();
  let received: string | undefined;
  el.addEventListener("wt-change", (e) => {
    received = (e as CustomEvent<{ value: string }>).detail.value;
  });
  await userEvent.click(trigger);
  await userEvent.click(el.shadowRoot!.querySelectorAll('[role="option"]')[1]);
  expect(received).toBe("vegan");
  expect(el.value).toBe("vegan");
  expect(popup.matches(":popover-open")).toBe(false);
  expect(el.shadowRoot!.querySelector(".value")!.textContent?.trim()).toBe("Vegan");
});

test("Enter on the active option selects it", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(el.value).toBe("gluten-free");
  void search;
});

test("shows the placeholder when nothing is selected", async () => {
  const { el } = await mountWithOptions();
  el.placeholder = "Choose a tag";
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".value")!.textContent?.trim()).toBe("Choose a tag");
});

test("multi-select: clicking an option toggles it, keeps the panel open, and emits values", async () => {
  const { el, trigger, popup } = await mountCombobox(
    '<wt-combobox label="Dietary tags" multiple></wt-combobox>',
  );
  el.options = TAGS;
  await el.updateComplete;
  const received: string[][] = [];
  el.addEventListener("wt-change", (e) => {
    received.push((e as CustomEvent<{ values: string[] }>).detail.values);
  });
  await userEvent.click(trigger);
  const rows = el.shadowRoot!.querySelectorAll('[role="option"]');
  await userEvent.click(rows[0]);
  await userEvent.click(rows[1]);
  expect(el.values).toEqual(["gluten-free", "vegan"]);
  expect(received).toEqual([["gluten-free"], ["gluten-free", "vegan"]]);
  expect(popup.matches(":popover-open")).toBe(true);
  await userEvent.click(rows[0]);
  expect(el.values).toEqual(["vegan"]);
});

test("the listbox is aria-multiselectable only in multiple mode", async () => {
  const { el: single, trigger: singleTrigger } = await mountWithOptions();
  await userEvent.click(singleTrigger);
  expect(
    single.shadowRoot!.querySelector('[role="listbox"]')!.getAttribute("aria-multiselectable"),
  ).toBe("false");
  // The open panel is a fixed overlay covering where the second combobox mounts, and would swallow
  // the click below.
  await userEvent.keyboard("{Escape}");

  const { el: multi, trigger: multiTrigger } = await mountCombobox(
    '<wt-combobox label="Dietary tags" multiple></wt-combobox>',
  );
  multi.options = TAGS;
  await multi.updateComplete;
  await userEvent.click(multiTrigger);
  expect(
    multi.shadowRoot!.querySelector('[role="listbox"]')!.getAttribute("aria-multiselectable"),
  ).toBe("true");
});

test("multi-select renders a selection indicator per option reflecting its selected state", async () => {
  const { el, trigger } = await mountCombobox(
    '<wt-combobox label="Dietary tags" multiple></wt-combobox>',
  );
  el.options = TAGS;
  el.values = ["vegan"];
  await el.updateComplete;
  await userEvent.click(trigger);
  const marks = el.shadowRoot!.querySelectorAll<HTMLElement>(".option .check");
  expect([...marks].map((mark) => mark.classList.contains("checked"))).toEqual([
    false,
    true,
    false,
  ]);
});

test("the multi-select indicator is decorative, not a nested interactive control", async () => {
  const { el, trigger } = await mountCombobox(
    '<wt-combobox label="Dietary tags" multiple></wt-combobox>',
  );
  el.options = TAGS;
  await el.updateComplete;
  await userEvent.click(trigger);
  expect(el.shadowRoot!.querySelectorAll('.option input, .option [role="checkbox"]')).toHaveLength(
    0,
  );
  const mark = el.shadowRoot!.querySelector<HTMLElement>(".option .check")!;
  expect(mark.getAttribute("aria-hidden")).toBe("true");
  expect(mark.hasAttribute("tabindex")).toBe(false);
});

test("multi-select shows the single label for one selection and countLabel for more than one", async () => {
  const { el } = await mountCombobox('<wt-combobox label="Dietary tags" multiple></wt-combobox>');
  el.options = TAGS;
  el.countLabel = (count) => `${count} tags`;
  el.values = ["vegan"];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".value")!.textContent?.trim()).toBe("Vegan");
  el.values = ["vegan", "vegetarian"];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".value")!.textContent?.trim()).toBe("2 tags");
});

test("wt-change bubbles and crosses shadow boundaries", async () => {
  const el = (await mountInShadowRoot(
    '<wt-combobox label="Dietary tags"></wt-combobox>',
  )) as WtCombobox;
  el.options = TAGS;
  await el.updateComplete;
  let received: CustomEvent<{ value: string }> | undefined;
  document.addEventListener(
    "wt-change",
    (e) => {
      received = e as CustomEvent<{ value: string }>;
    },
    { once: true },
  );
  // Clicked programmatically: a nested shadow root is outside applyTokens' reach, so the trigger has
  // no box for a real pointer click to land on.
  const trigger = el.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!;
  trigger.click();
  await el.updateComplete;
  el.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')[0].click();
  expect(received?.detail.value).toBe("gluten-free");
});

test("the add row is hidden unless allowAdd is set", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "kosher");
  expect(el.shadowRoot!.querySelector(".add")).toBeNull();
});

test("the add row appears for unmatched text once allowAdd is set, and not for an exact match", async () => {
  const { el, trigger } = await mountWithOptions();
  el.allowAdd = true;
  await el.updateComplete;
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "kosher");
  expect(el.shadowRoot!.querySelector(".add")?.textContent?.trim()).toBe("Add 'kosher'");
  await userEvent.clear(search);
  await userEvent.type(search, "Vegan");
  expect(el.shadowRoot!.querySelector(".add")).toBeNull();
});

test("the add row replaces noResultsLabel, never shows both", async () => {
  const { el, trigger } = await mountWithOptions();
  el.allowAdd = true;
  await el.updateComplete;
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "kosher");
  expect(el.shadowRoot!.querySelector(".empty")).toBeNull();
});

test("activating the add row emits wt-combobox-add with the typed text and never creates the option itself", async () => {
  const { el, trigger } = await mountWithOptions();
  el.allowAdd = true;
  await el.updateComplete;
  let received: string | undefined;
  el.addEventListener("wt-combobox-add", (e) => {
    received = (e as CustomEvent<{ text: string }>).detail.text;
  });
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "kosher");
  await userEvent.click(el.shadowRoot!.querySelector(".add")!);
  expect(received).toBe("kosher");
  expect(el.options).toEqual(TAGS);
  expect(el.value).toBe("");
});

test("activating add closes a single-select panel but leaves a multi-select panel open", async () => {
  const single = await mountWithOptions();
  single.el.allowAdd = true;
  await single.el.updateComplete;
  await userEvent.click(single.trigger);
  await userEvent.type(single.el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "kosher");
  await userEvent.click(single.el.shadowRoot!.querySelector(".add")!);
  expect(single.popup.matches(":popover-open")).toBe(false);

  const multi = await mountCombobox('<wt-combobox label="Dietary tags" multiple></wt-combobox>');
  multi.el.options = TAGS;
  multi.el.allowAdd = true;
  await multi.el.updateComplete;
  await userEvent.click(multi.trigger);
  await userEvent.type(multi.el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "kosher");
  await userEvent.click(multi.el.shadowRoot!.querySelector(".add")!);
  expect(multi.popup.matches(":popover-open")).toBe(true);
});

test("Enter on the active add row also activates it", async () => {
  const { el, trigger } = await mountWithOptions();
  el.allowAdd = true;
  await el.updateComplete;
  let received: string | undefined;
  el.addEventListener("wt-combobox-add", (e) => {
    received = (e as CustomEvent<{ text: string }>).detail.text;
  });
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "kosher");
  await userEvent.keyboard("{End}{Enter}");
  expect(received).toBe("kosher");
});

test("marks a required field with a visible asterisk and the search box's aria-required", async () => {
  const { el, trigger } = await mountCombobox(
    '<wt-combobox label="Dietary tags" required></wt-combobox>',
  );
  expect(el.shadowRoot!.querySelector("[data-required]")?.textContent).toBe("*");
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  expect(search.getAttribute("aria-required")).toBe("true");
});

test("links explanatory error text to the trigger and sets aria-invalid", async () => {
  const { el } = await mountCombobox(
    '<wt-combobox label="Dietary tags" error="Choose at least one tag"></wt-combobox>',
  );
  const trigger = el.shadowRoot!.querySelector(".trigger")!;
  const error = el.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  expect(trigger.getAttribute("aria-invalid")).toBe("true");
  expect(trigger.getAttribute("aria-describedby")).toBe(error.id);
  expect(error.textContent).toBe("Choose at least one tag");
});

test("wires the invalid property to aria-invalid independently of error text", async () => {
  const el = await mount("<wt-combobox invalid></wt-combobox>");
  expect(el.shadowRoot!.querySelector(".trigger")!.getAttribute("aria-invalid")).toBe("true");
});

test("invalid state paints the bottom line and the label from the danger token", async () => {
  const el = await mount('<wt-combobox label="Dietary tags" invalid></wt-combobox>');
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-field-line-width-active", "3px");
  const field = el.shadowRoot!.querySelector(".field")!;
  expect(getComputedStyle(field).boxShadow).toBe("rgb(13, 14, 15) 0px -3px 0px 0px inset");
  expect(getComputedStyle(el.shadowRoot!.querySelector("label")!).color).toBe("rgb(13, 14, 15)");
});

test("a disabled trigger paints the paler fill, a dashed line and muted text, at full opacity", async () => {
  const el = await mount('<wt-combobox label="Dietary tags" disabled></wt-combobox>');
  host.style.setProperty("--wt-opacity-disabled", "0.3");
  host.style.setProperty("--wt-color-field-fill-disabled", "rgb(21, 22, 23)");
  host.style.setProperty("--wt-color-text-muted", "rgb(24, 25, 26)");
  const field = el.shadowRoot!.querySelector(".field")!;
  const trigger = el.shadowRoot!.querySelector(".trigger")!;
  expect(field.hasAttribute("data-disabled")).toBe(true);
  expect(getComputedStyle(field).backgroundColor).toBe("rgb(21, 22, 23)");
  expect(getComputedStyle(field, "::after").borderBottomStyle).toBe("dashed");
  expect(getComputedStyle(trigger).color).toBe("rgb(24, 25, 26)");
  expect(getComputedStyle(trigger).opacity).toBe("1");
  expect(getComputedStyle(trigger).cursor).toBe("not-allowed");
});

async function mountWithManyOptions(count = 20) {
  const mounted = await mountCombobox();
  mounted.el.options = Array.from({ length: count }, (_, index) => ({
    value: String(index),
    label: `Option ${index}`,
  }));
  await mounted.el.updateComplete;
  return mounted;
}

test("keyboard navigation keeps the active option inside the scrolling list", async () => {
  const { el, trigger } = await mountWithManyOptions();
  await userEvent.click(trigger);
  await userEvent.keyboard("{End}");
  await vi.waitFor(() => {
    const list = el.shadowRoot!.querySelector(".list")!.getBoundingClientRect();
    const active = el.shadowRoot!.querySelector(".option.active")!.getBoundingClientRect();
    expect(active.bottom).toBeLessThanOrEqual(list.bottom);
  });
});

/** Holds that `row` lies inside the list's visible box. */
function expectRowInView(el: WtCombobox, row: Element) {
  const list = el.shadowRoot!.querySelector(".list")!;
  const listBox = list.getBoundingClientRect();
  const box = row.getBoundingClientRect();
  expect(list.scrollHeight, "the list scrolls").toBeGreaterThan(list.clientHeight);
  expect(box.top).toBeGreaterThanOrEqual(listBox.top);
  expect(box.bottom).toBeLessThanOrEqual(listBox.bottom);
}

for (const search of ["always", "never"] as const) {
  test(`a click opens a list (search="${search}") scrolled to its chosen row, with no row active`, async () => {
    const { el, trigger } = await mountWithManyOptions();
    el.search = search;
    el.value = "18";
    await el.updateComplete;
    await userEvent.click(trigger);
    await vi.waitFor(() => {
      const chosen = el.shadowRoot!.querySelector('.option[aria-selected="true"]')!;
      expect(chosen.textContent!.trim()).toBe("Option 18");
      expectRowInView(el, chosen);
    });
    expect(el.shadowRoot!.querySelector(".option.active")).toBeNull();
    expect(el.shadowRoot!.querySelector("[aria-activedescendant]")).toBeNull();
  });
}

test("a click opens a multiple choice scrolled to its first chosen row, with no row active", async () => {
  const { el, trigger } = await mountWithManyOptions();
  el.multiple = true;
  el.values = ["19", "10"];
  await el.updateComplete;
  await userEvent.click(trigger);
  await vi.waitFor(() => {
    const chosen = [...el.shadowRoot!.querySelectorAll('.option[aria-selected="true"]')];
    expect(chosen.map((row) => row.textContent!.trim())).toEqual(["Option 10", "Option 19"]);
    expectRowInView(el, chosen[0]!);
  });
  expect(el.shadowRoot!.querySelector(".option.active")).toBeNull();
});

function searchBox(el: WtCombobox): HTMLInputElement {
  return el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
}

/** Reports, per key, whether a listener cancelled it. */
function pressAt(target: HTMLElement, ...keys: string[]): boolean[] {
  return keys.map(
    (key) =>
      !target.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true }),
      ),
  );
}

test("disabling an open panel closes it, so nothing further can be selected", async () => {
  const { el, trigger, popup } = await mountCombobox(
    '<wt-combobox label="Dietary tags" multiple></wt-combobox>',
  );
  el.options = TAGS;
  await el.updateComplete;
  await userEvent.click(trigger);
  el.disabled = true;
  await el.updateComplete;
  expect(popup.matches(":popover-open")).toBe(false);
  // A real keystroke can reach the hidden search box only in the moment after the panel closes, so
  // the keys are dispatched at it, to reach it every time.
  const changed = vi.fn();
  el.addEventListener("wt-change", changed);
  // Only the search box's own key handler cancels these keys, so a cancelled key reached it.
  expect(pressAt(searchBox(el), "ArrowDown", "Enter")).toEqual([true, true]);
  expect(el.values).toEqual([]);
  expect(changed).not.toHaveBeenCalled();
});

test("disabling an open panel also stops the add row announcing a new option", async () => {
  const { el, trigger, popup } = await mountCombobox(
    '<wt-combobox label="Dietary tags" allow-add multiple></wt-combobox>',
  );
  el.options = TAGS;
  await el.updateComplete;
  const added = vi.fn();
  el.addEventListener("wt-combobox-add", added);
  await userEvent.click(trigger);
  await userEvent.type(searchBox(el), "kosher");
  el.disabled = true;
  await el.updateComplete;
  expect(popup.matches(":popover-open")).toBe(false);
  expect(pressAt(searchBox(el), "End", "Enter")).toEqual([true, true]);
  expect(added).not.toHaveBeenCalled();
});

test("navigating an empty list never points aria-activedescendant at a missing row", async () => {
  const { el, trigger } = await mountCombobox();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.keyboard("{ArrowUp}");
  await el.updateComplete;
  expect(search.getAttribute("aria-activedescendant")).toBeNull();
  await userEvent.keyboard("{Home}");
  await el.updateComplete;
  expect(search.getAttribute("aria-activedescendant")).toBeNull();
});

test("without show-empty-option, an empty value uses the placeholder even when an option carries it", async () => {
  const { el } = await mountCombobox(
    '<wt-combobox label="Dietary tags" placeholder="Choose a tag"></wt-combobox>',
  );
  el.options = [{ value: "", label: "Unset" }];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".value")!.textContent?.trim()).toBe("Choose a tag");
});

test("the popup stays inside the bottom gutter once its width is set", async () => {
  const { el, trigger, popup } = await mountCombobox();
  el.options = TAGS.map((tag) => ({
    ...tag,
    label: "A long option label that wraps onto several lines",
  }));
  el.style.cssText = `position: fixed; left: 20px; top: ${innerHeight - 100}px; width: 150px`;
  await el.updateComplete;
  // Pressed near the chevron: at this width the resting label covers the trigger's middle.
  const { width, height } = trigger.getBoundingClientRect();
  await userEvent.click(trigger, { position: { x: width - 20, y: height - 8 } });
  await new Promise(requestAnimationFrame);
  expect(popup.matches(":popover-open")).toBe(true);
  expect(popup.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight - 8);
});

test("a panel whose rows wrap at its widest stays inside the bottom gutter after the window narrows", async () => {
  const [viewportWidth, viewportHeight] = [innerWidth, innerHeight];
  const { el, trigger, popup } = await mountCombobox();
  el.options = TAGS.map((tag) => ({
    ...tag,
    label: `${tag.label}: a description long enough to run well past the right edge of a narrow window, so that it wraps onto several lines there`,
  }));
  const openNearTheBottom = async () => {
    el.style.cssText = `position: fixed; left: 20px; top: ${innerHeight - 100}px; width: 150px`;
    await el.updateComplete;
    const { width, height } = trigger.getBoundingClientRect();
    await userEvent.click(trigger, { position: { x: width - 20, y: height - 8 } });
    await new Promise(requestAnimationFrame);
  };
  // A first opening alone cannot show that the width is set before the panel is measured: unsized,
  // the panel is as wide as the viewport, within 16px of its final width, so these rows wrap the same.
  // Opened first in a window wide enough for each row to fit on one line, it keeps the width limit
  // set for that window.
  await page.viewport(1600, viewportHeight);
  try {
    await openNearTheBottom();
    await userEvent.keyboard("{Escape}");
    await page.viewport(viewportWidth, viewportHeight);
    await openNearTheBottom();
    const lines = document.createRange();
    lines.selectNodeContents(el.shadowRoot!.querySelector(".option-label")!);
    expect(lines.getClientRects().length).toBeGreaterThan(1);
    expect(popup.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight - 8);
  } finally {
    await page.viewport(viewportWidth, viewportHeight);
  }
});

test("reopening after a filtered search fits the full list, not the filtered one", async () => {
  const { el, trigger, popup } = await mountWithManyOptions();
  el.style.cssText = `position: fixed; left: 20px; top: ${innerHeight - 100}px; width: 250px`;
  await el.updateComplete;
  await userEvent.click(trigger);
  await userEvent.type(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "Option 19");
  await userEvent.keyboard("{Escape}");
  await userEvent.click(trigger);
  await new Promise(requestAnimationFrame);
  expect(popup.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight - 8);
});

test("names each part it points ARIA at with its own generated id", async () => {
  const { el } = await mountCombobox(
    '<wt-combobox label="Dietary tags" error="Choose at least one tag"></wt-combobox>',
  );
  expect(el.shadowRoot!.querySelector("label")!.id).toMatch(/^wt-combobox-label-\d+$/);
  expect(el.shadowRoot!.querySelector('[role="listbox"]')!.id).toMatch(/^wt-combobox-listbox-\d+$/);
  expect(el.shadowRoot!.querySelector("[data-error]")!.id).toMatch(/^wt-combobox-error-\d+$/);
});

test("labels the search box and the empty list with its default wording", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  expect(search.placeholder).toBe("Search");
  await userEvent.type(search, "zzz");
  expect(el.shadowRoot!.querySelector(".empty")!.textContent!.trim()).toBe("No results");
});

test("counts a multiple selection with its default wording", async () => {
  const { el } = await mountCombobox('<wt-combobox label="Dietary tags" multiple></wt-combobox>');
  el.options = TAGS;
  el.values = ["gluten-free", "vegan"];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".value")!.textContent!.trim()).toBe("2 selected");
});

test("shows nothing in the trigger when nothing is selected and no placeholder was given", async () => {
  const { el } = await mountWithOptions();
  expect(el.shadowRoot!.querySelector(".value")!.textContent!.trim()).toBe("");
});

test("a combobox that has never been opened lists everything and has no active row", async () => {
  const { el } = await mountWithOptions();
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  expect(search.value).toBe("");
  expect(search.hasAttribute("aria-activedescendant")).toBe(false);
  expect(el.shadowRoot!.querySelectorAll('[role="option"]')).toHaveLength(3);
  expect(el.shadowRoot!.querySelector(".option.active")).toBeNull();
});

test("ignores the spaces around the typed text when filtering and when offering to add it", async () => {
  const { el, trigger } = await mountWithOptions();
  el.allowAdd = true;
  await el.updateComplete;
  let added: string | undefined;
  el.addEventListener("wt-combobox-add", (e) => {
    added = (e as CustomEvent<{ text: string }>).detail.text;
  });
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "  veg  ");
  expect(
    [...el.shadowRoot!.querySelectorAll('[role="option"]')].map((r) => r.textContent!.trim()),
  ).toEqual(["Vegan", "Vegetarian", "Add 'veg'"]);
  await userEvent.click(el.shadowRoot!.querySelector(".add")!);
  expect(added).toBe("veg");
});

test("an exact match surrounded by spaces still offers no add row", async () => {
  const { el, trigger } = await mountWithOptions();
  el.allowAdd = true;
  await el.updateComplete;
  await userEvent.click(trigger);
  await userEvent.type(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "  Vegan  ");
  expect(el.shadowRoot!.querySelector(".add")).toBeNull();
});

test("single-select marks only the chosen row as selected", async () => {
  const { el, trigger } = await mountWithOptions();
  el.value = "vegan";
  await el.updateComplete;
  await userEvent.click(trigger);
  const rows = el.shadowRoot!.querySelectorAll('[role="option"]');
  expect([...rows].map((row) => row.getAttribute("aria-selected"))).toEqual([
    "false",
    "true",
    "false",
  ]);
});

test("multi-select with nothing chosen shows the placeholder, not a count of zero", async () => {
  const { el } = await mountCombobox(
    '<wt-combobox label="Dietary tags" multiple placeholder="Choose tags"></wt-combobox>',
  );
  el.options = TAGS;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".value")!.textContent!.trim()).toBe("Choose tags");
});

test("a single-select value no longer among the options shows the placeholder", async () => {
  const { el } = await mountCombobox(
    '<wt-combobox label="Dietary tags" placeholder="Choose a tag" value="halal"></wt-combobox>',
  );
  el.options = TAGS;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".value")!.textContent!.trim()).toBe("Choose a tag");
});

test("a multi-select value no longer among the options shows the placeholder", async () => {
  const { el } = await mountCombobox(
    '<wt-combobox label="Dietary tags" multiple placeholder="Choose tags"></wt-combobox>',
  );
  el.options = TAGS;
  el.values = ["halal"];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".value")!.textContent!.trim()).toBe("Choose tags");
});

test("a combobox with no error text has no error paragraph and describes its trigger with nothing", async () => {
  const { el, trigger } = await mountCombobox();
  expect(el.shadowRoot!.querySelector("[data-error]")).toBeNull();
  expect(trigger.hasAttribute("aria-describedby")).toBe(false);
});

test("the panel does not say there are no results while it is listing options", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  expect(el.shadowRoot!.querySelector(".empty")).toBeNull();
});

test("only the row the keyboard is on carries the active outline", async () => {
  const { el, trigger } = await mountWithOptions();
  // The class alone is not the promise in this test's name: with the `.active` outline rule
  // deleted the class assertion below still passes, so the painted outline is asserted too.
  host.style.setProperty("--wt-focus-ring", "3px solid rgb(1, 2, 3)");
  await userEvent.click(trigger);
  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  const rows = [...el.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(rows.map((row) => row.classList.contains("active"))).toEqual([false, true, false]);
  expect(rows.map((row) => getComputedStyle(row).outlineStyle)).toEqual(["none", "solid", "none"]);
  expect(getComputedStyle(rows[1]!).outlineColor).toBe("rgb(1, 2, 3)");
});

test("the add row takes the active outline only when the keyboard is on it", async () => {
  const { el, trigger } = await mountWithOptions();
  host.style.setProperty("--wt-focus-ring", "3px solid rgb(1, 2, 3)");
  el.allowAdd = true;
  await el.updateComplete;
  await userEvent.click(trigger);
  await userEvent.type(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "veg");
  expect(el.shadowRoot!.querySelector(".add")!.classList.contains("active")).toBe(false);
  await userEvent.keyboard("{End}");
  const rows = [...el.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(rows.map((row) => row.classList.contains("active"))).toEqual([false, false, true]);
  expect(el.shadowRoot!.querySelector(".add.active")).not.toBeNull();
  expect(rows.map((row) => getComputedStyle(row).outlineStyle)).toEqual(["none", "none", "solid"]);
});

/** A throw inside one of the component's async keydown handlers escapes as a promise rejection
    nothing awaits, so this is the only place a test can see it. */
function collectEscapedErrors(): { reasons: unknown[]; stop: () => void } {
  const reasons: unknown[] = [];
  const onRejection = (event: PromiseRejectionEvent) => {
    reasons.push(event.reason);
    event.preventDefault();
  };
  window.addEventListener("unhandledrejection", onRejection);
  return { reasons, stop: () => window.removeEventListener("unhandledrejection", onRejection) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the panel keeps its navigation keys and leaves ordinary typing alone", async () => {
  const { el, trigger } = await mountCombobox(
    '<wt-combobox label="Dietary tags" multiple></wt-combobox>',
  );
  el.options = TAGS;
  await el.updateComplete;
  await userEvent.click(trigger);
  const seen: [string, boolean][] = [];
  const record = (event: Event) => {
    const key = event as KeyboardEvent;
    seen.push([key.key, key.defaultPrevented]);
  };
  // Listening on the search box itself, not on an ancestor: selecting with Enter stops the
  // keydown propagating, which would hide that key from any listener further up.
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  search.addEventListener("keydown", record);
  await userEvent.keyboard("{ArrowDown}{ArrowUp}{Home}{End}{Enter}a");
  expect(seen).toEqual([
    ["ArrowDown", true],
    ["ArrowUp", true],
    ["Home", true],
    ["End", true],
    ["Enter", true],
    ["a", false],
  ]);
});

test("ArrowUp steps back one row rather than jumping to the first", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  await userEvent.keyboard("{End}{ArrowUp}");
  const rows = el.shadowRoot!.querySelectorAll('[role="option"]');
  expect([...rows].map((row) => row.classList.contains("active"))).toEqual([false, true, false]);
});

test("Enter with no row chosen selects nothing, adds nothing and raises nothing", async () => {
  const { el, trigger, popup } = await mountWithOptions();
  const changed = vi.fn();
  const added = vi.fn();
  el.addEventListener("wt-change", changed);
  el.addEventListener("wt-combobox-add", added);
  const escaped = collectEscapedErrors();
  try {
    await userEvent.click(trigger);
    await userEvent.keyboard("{Enter}");
    await settle();
  } finally {
    escaped.stop();
  }
  expect(escaped.reasons).toEqual([]);
  expect(changed).not.toHaveBeenCalled();
  expect(added).not.toHaveBeenCalled();
  expect(el.value).toBe("");
  expect(popup.matches(":popover-open")).toBe(true);
});

test("switching adding off stops Enter announcing what was the add row", async () => {
  const { el, trigger } = await mountWithOptions();
  el.allowAdd = true;
  await el.updateComplete;
  const added = vi.fn();
  el.addEventListener("wt-combobox-add", added);
  await userEvent.click(trigger);
  await userEvent.type(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "kosher");
  el.allowAdd = false;
  await el.updateComplete;
  await userEvent.keyboard("{Enter}");
  await settle();
  expect(added).not.toHaveBeenCalled();
});

test("arrowing up after the option list is replaced with a shorter one raises nothing", async () => {
  const { el, trigger, popup } = await mountWithManyOptions();
  const escaped = collectEscapedErrors();
  try {
    await userEvent.click(trigger);
    await userEvent.keyboard("{End}");
    el.options = TAGS;
    await el.updateComplete;
    await userEvent.keyboard("{ArrowUp}");
    await settle();
  } finally {
    escaped.stop();
  }
  expect(escaped.reasons).toEqual([]);
  expect(popup.matches(":popover-open")).toBe(true);
});

test("the click that activates the add row is not left to the page behind the panel", async () => {
  const { el, trigger } = await mountWithOptions();
  el.allowAdd = true;
  await el.updateComplete;
  let added: string | undefined;
  el.addEventListener("wt-combobox-add", (e) => {
    added = (e as CustomEvent<{ text: string }>).detail.text;
  });
  const pageClicks = vi.fn();
  document.addEventListener("click", pageClicks);
  try {
    await userEvent.click(trigger);
    await userEvent.type(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "kosher");
    pageClicks.mockClear();
    await userEvent.click(el.shadowRoot!.querySelector(".add")!);
  } finally {
    document.removeEventListener("click", pageClicks);
  }
  expect(added).toBe("kosher");
  expect(pageClicks).not.toHaveBeenCalled();
});

test("wt-combobox-add bubbles and crosses shadow boundaries", async () => {
  const el = (await mountInShadowRoot(
    '<wt-combobox label="Dietary tags" allow-add></wt-combobox>',
  )) as WtCombobox;
  el.options = TAGS;
  await el.updateComplete;
  let received: CustomEvent<{ text: string }> | undefined;
  document.addEventListener(
    "wt-combobox-add",
    (e) => {
      received = e as CustomEvent<{ text: string }>;
    },
    { once: true },
  );
  // Driven programmatically for the same reason as the wt-change test above: this nested shadow
  // root is outside applyTokens' reach, so the trigger has no box for a real pointer to land on.
  el.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.click();
  await el.updateComplete;
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  search.value = "kosher";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await el.updateComplete;
  el.shadowRoot!.querySelector<HTMLElement>(".add")!.click();
  expect(received?.detail.text).toBe("kosher");
});

test("choosing an option returns focus to the trigger", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  await userEvent.click(el.shadowRoot!.querySelectorAll('[role="option"]')[1]);
  expect(el.shadowRoot!.activeElement).toBe(trigger);
});

test("a selection made after the panel has closed still hands focus back to the trigger", async () => {
  const { el, trigger, popup } = await mountWithOptions();
  await userEvent.click(trigger);
  await userEvent.keyboard("{ArrowDown}");
  el.disabled = true;
  await el.updateComplete;
  el.disabled = false;
  await el.updateComplete;
  expect(popup.matches(":popover-open")).toBe(false);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  expect(el.shadowRoot!.activeElement).toBe(search);
  // Dispatched at the search box because that is where the closed panel left the shadow root's
  // focus, asserted directly above.
  search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await el.updateComplete;
  expect(el.value).toBe("gluten-free");
  expect(el.shadowRoot!.activeElement).toBe(trigger);
});

test("a panel stays open when the field is disabled and re-enabled before the next render", async () => {
  const { el, trigger, popup } = await mountWithOptions();
  await userEvent.click(trigger);
  el.disabled = true;
  el.disabled = false;
  await el.updateComplete;
  expect(popup.matches(":popover-open")).toBe(true);
});

test("a click delivered to a disabled trigger does not open the panel", async () => {
  const { trigger, popup } = await mountCombobox(
    '<wt-combobox label="Dietary tags" disabled></wt-combobox>',
  );
  // Dispatched, because a browser never delivers a click to a disabled button: what is under test
  // is the component's own refusal, not the button's disabled attribute.
  trigger.dispatchEvent(
    new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }),
  );
  expect(popup.matches(":popover-open")).toBe(false);
});

test("the Escape that closes the panel is consumed and never reaches the page behind it", async () => {
  const { trigger, popup } = await mountWithOptions();
  const pageKeys = vi.fn();
  let panelKey: KeyboardEvent | undefined;
  popup.addEventListener("keydown", (event) => {
    panelKey = event as KeyboardEvent;
  });
  document.addEventListener("keydown", pageKeys);
  try {
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
  } finally {
    document.removeEventListener("keydown", pageKeys);
  }
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
  expect(panelKey?.defaultPrevented).toBe(true);
  expect(pageKeys).not.toHaveBeenCalled();
});

test("Home scrolls the first option back into view", async () => {
  const { el, trigger } = await mountWithManyOptions();
  await userEvent.click(trigger);
  const list = el.shadowRoot!.querySelector<HTMLElement>(".list")!;
  await userEvent.keyboard("{End}");
  await vi.waitFor(() => expect(list.scrollTop).toBeGreaterThan(0));
  await userEvent.keyboard("{Home}");
  await vi.waitFor(() => expect(list.scrollTop).toBe(0));
});

test("moving to an option that is already in view does not jog the list", async () => {
  const { el, trigger } = await mountWithManyOptions();
  await userEvent.click(trigger);
  const list = el.shadowRoot!.querySelector<HTMLElement>(".list")!;
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  await userEvent.keyboard("{Home}{ArrowDown}");
  await settle();
  expect(list.scrollTop).toBe(0);
});

test("a panel whose rows are narrower than its trigger is as wide as the trigger and sits under it when there is room", async () => {
  const { el, trigger, popup } = await mountCombobox();
  el.options = [{ value: "a", label: "A" }];
  el.style.cssText = "position: fixed; left: 120px; top: 40px; width: 240px";
  await el.updateComplete;
  await userEvent.click(trigger);
  await new Promise(requestAnimationFrame);
  const box = popup.getBoundingClientRect();
  expect(box.width).toBeCloseTo(240, 0);
  expect(box.left).toBeCloseTo(120, 0);
  expect(box.top).toBeCloseTo(trigger.getBoundingClientRect().bottom, 0);
});

test("a panel whose trigger overhangs the right edge stops at the viewport's 8px gutter", async () => {
  const { el, trigger, popup } = await mountCombobox();
  el.options = [{ value: "a", label: "A" }];
  // Far enough over the edge to need the clamp, with the trigger's midpoint still on screen
  // for the click to land on.
  el.style.cssText = `position: fixed; left: ${innerWidth - 160}px; top: 40px; width: 240px`;
  await el.updateComplete;
  await userEvent.click(trigger);
  await new Promise(requestAnimationFrame);
  const box = popup.getBoundingClientRect();
  // The exact margin, plus the width: a panel that merely wrapped narrower at the edge would
  // satisfy "inside the viewport" without having been moved at all.
  expect(box.width).toBeCloseTo(240, 0);
  expect(box.right).toBeCloseTo(innerWidth - 8, 0);
});

test("a panel whose trigger overhangs the left edge starts at the viewport edge", async () => {
  const { el, trigger, popup } = await mountCombobox();
  el.options = [{ value: "a", label: "A" }];
  el.style.cssText = "position: fixed; left: -60px; top: 40px; width: 240px";
  await el.updateComplete;
  await userEvent.click(trigger);
  await new Promise(requestAnimationFrame);
  const box = popup.getBoundingClientRect();
  expect(box.width).toBeCloseTo(240, 0);
  expect(box.left).toBeCloseTo(0, 0);
});

/** Opens a compact combobox whose trigger is `width` px wide at `left`, with a short chosen row
 * and one long row. */
async function openNarrow(left: number, width: number, longLabel: string, search = "never") {
  const { el, trigger, popup } = await mountCombobox(
    `<wt-combobox label="Pricing unit" hide-label search="${search}"></wt-combobox>`,
  );
  el.options = [
    { value: "kg", label: "kg" },
    { value: "__add__", label: longLabel, action: true },
  ];
  el.value = "kg";
  el.style.cssText = `position: fixed; left: ${left}px; top: 40px; width: ${width}px`;
  await el.updateComplete;
  await userEvent.click(trigger);
  await new Promise(requestAnimationFrame);
  const [short, long] = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".option-label")];
  return { el, trigger, popup, short: short!, long: long! };
}

test("a narrow trigger's panel widens to fit its longest row on one line, inside the viewport", async () => {
  const { trigger, popup, short, long } = await openNarrow(120, 60, "Add a new unit of measure");
  const box = popup.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(trigger.getBoundingClientRect().width + 60);
  // One line: the long label is no taller than the one-word label above it.
  expect(long.getBoundingClientRect().height).toBeCloseTo(short.getBoundingClientRect().height, 0);
  expect(box.left).toBeCloseTo(120, 0);
  expect(box.right).toBeLessThanOrEqual(innerWidth - 8);
});

test("a narrow trigger near the right edge moves its widened panel left rather than wrapping a row", async () => {
  const left = innerWidth - 100;
  const { popup, short, long } = await openNarrow(left, 60, "Add a new unit of measure");
  const box = popup.getBoundingClientRect();
  expect(long.getBoundingClientRect().height).toBeCloseTo(short.getBoundingClientRect().height, 0);
  expect(box.left).toBeLessThan(left);
  expect(box.right).toBeCloseTo(innerWidth - 8, 0);
});

test("reopened near the right edge after a longer option arrives, the panel is measured at full width", async () => {
  const left = innerWidth - 100;
  const { el, trigger, popup } = await openNarrow(left, 60, "Add");
  // Closed with the panel's position from this opening still written on it.
  await userEvent.keyboard("{Escape}");
  el.options = [
    { value: "kg", label: "kg" },
    { value: "__add__", label: "Add a new unit of measure", action: true },
  ];
  await el.updateComplete;
  await userEvent.click(trigger);
  await new Promise(requestAnimationFrame);
  const [short, long] = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".option-label")];
  expect(long!.getBoundingClientRect().height).toBeCloseTo(
    short!.getBoundingClientRect().height,
    0,
  );
  expect(popup.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth - 8);
});

test("a panel whose longest row is wider than the screen stops at both 8px gutters", async () => {
  const { popup, long } = await openNarrow(120, 60, "Add a new unit ".repeat(20).trim());
  const box = popup.getBoundingClientRect();
  expect(box.left).toBeCloseTo(8, 0);
  expect(box.right).toBeCloseTo(innerWidth - 8, 0);
  // The row wraps inside the panel rather than running past it.
  expect(long.getBoundingClientRect().right).toBeLessThanOrEqual(box.right);
});

test("the search box does not widen a narrow trigger's panel", async () => {
  const { trigger, popup } = await openNarrow(120, 100, "Add", "always");
  expect(popup.getBoundingClientRect().width).toBeCloseTo(trigger.getBoundingClientRect().width, 0);
});

// The filled field box, the list panel, and what a native select needs (A178).

registerIcons({
  check: "M2 8 L6 12 L14 4",
  "chevron-down": "M3 6 L8 11 L13 6",
  leaf: "M2 14 L14 2",
});

function fieldParts(el: WtCombobox) {
  const root = el.shadowRoot!;
  return {
    field: root.querySelector<HTMLElement>(".field")!,
    label: root.querySelector<HTMLLabelElement>("label"),
    trigger: root.querySelector<HTMLButtonElement>(".trigger")!,
    value: root.querySelector<HTMLElement>(".value")!,
    chevron: root.querySelector<HTMLElement>(".chevron")!,
    popup: root.querySelector<HTMLElement>("[popover]")!,
  };
}

async function mountWith(html: string, options: ComboboxOption[] = TAGS) {
  const el = (await mount(html)) as WtCombobox;
  el.options = options;
  await el.updateComplete;
  return el;
}

function optionRows(el: WtCombobox): HTMLElement[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')];
}

test("an empty dropdown's resting label is drawn at the size its chosen value is drawn at", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  const { field, label, value } = fieldParts(el);
  expect(field.getAttribute("data-label")).toBe("rest");
  expect(getComputedStyle(label!).fontSize).toBe(getComputedStyle(value).fontSize);
  host.style.setProperty("--wt-font-size-md", "15px");
  expect(getComputedStyle(value).fontSize).toBe("15px");
  expect(getComputedStyle(label!).fontSize).toBe("15px");
});

test("the trigger is the control of a filled field box, with the label resting while nothing is chosen", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  host.style.setProperty("--wt-field-height", "70px");
  host.style.setProperty("--wt-font-size-md", "17px");
  const { field, label, trigger } = fieldParts(el);
  expect(field.getAttribute("part")).toBe("field");
  expect(field.contains(trigger)).toBe(true);
  expect(field.contains(label)).toBe(true);
  expect(trigger.classList.contains("field-control")).toBe(true);
  expect(field.getAttribute("data-label")).toBe("rest");
  expect(field.hasAttribute("data-compact")).toBe(false);
  expect(field.getBoundingClientRect().height).toBe(70);
  expect(getComputedStyle(label!).fontSize).toBe("17px");
  const fieldBox = field.getBoundingClientRect();
  const triggerBox = trigger.getBoundingClientRect();
  expect(triggerBox.width).toBe(fieldBox.width);
  expect(triggerBox.height).toBe(fieldBox.height);
});

for (const [what, attrs] of [
  ["a chosen value", 'value="vegan"'],
  ["a hint", 'hint="Pick the main one"'],
  ["a placeholder", 'placeholder="Choose a tag"'],
] as const) {
  test(`with ${what}, the trigger's label floats small at the top`, async () => {
    const el = await mountWith(`<wt-combobox label="Dietary tags" ${attrs}></wt-combobox>`);
    host.style.setProperty("--wt-font-size-sm", "11px");
    const { field, label } = fieldParts(el);
    expect(field.getAttribute("data-label")).toBe("float");
    expect(getComputedStyle(label!).fontSize).toBe("11px");
    expect(label!.getBoundingClientRect().top).toBeLessThan(
      field.getBoundingClientRect().top + field.getBoundingClientRect().height / 2,
    );
  });
}

test("a value chosen in the list, or set from code after the first render, floats the label", async () => {
  const picked = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  await userEvent.click(fieldParts(picked).trigger);
  await userEvent.click(optionRows(picked)[1]!);
  expect(fieldParts(picked).field.getAttribute("data-label")).toBe("float");

  const coded = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  expect(fieldParts(coded).field.getAttribute("data-label")).toBe("rest");
  coded.value = "vegan";
  await coded.updateComplete;
  expect(fieldParts(coded).field.getAttribute("data-label")).toBe("float");
});

test("a value naming no option leaves the label resting", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags" value="halal"></wt-combobox>');
  expect(fieldParts(el).field.getAttribute("data-label")).toBe("rest");
});

test("the chevron sits inside the field box, at least --wt-space-3 from its trailing edge", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags" value="vegan"></wt-combobox>');
  host.style.setProperty("--wt-space-3", "13px");
  const { field, chevron, trigger } = fieldParts(el);
  expect(trigger.contains(chevron)).toBe(true);
  const fieldBox = field.getBoundingClientRect();
  const chevronBox = chevron.getBoundingClientRect();
  expect(chevronBox.width).toBeGreaterThan(0);
  expect(fieldBox.right - chevronBox.right).toBeGreaterThanOrEqual(13);
  expect(chevronBox.left).toBeGreaterThan(fieldBox.left + fieldBox.width / 2);
  expect(chevronBox.top).toBeGreaterThanOrEqual(fieldBox.top);
  expect(chevronBox.bottom).toBeLessThanOrEqual(fieldBox.bottom);
});

test("focusing the closed trigger draws the focus line and label colour, and no focus ring of its own", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-field-label-focus", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-field-line-width-active", "3px");
  const { field, label, trigger } = fieldParts(el);
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(trigger);
  expect(getComputedStyle(field).boxShadow).toBe("rgb(1, 2, 3) 0px -3px 0px 0px inset");
  expect(getComputedStyle(label!).color).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(trigger).outlineStyle).toBe("none");
});

test("opening sets data-open, and with a search box the field box drops its focus marking while the list is open", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  host.style.setProperty("--wt-color-field-line", "rgb(7, 7, 7)");
  host.style.setProperty("--wt-color-text-muted", "rgb(8, 8, 8)");
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  const { field, label, trigger, popup } = fieldParts(el);
  expect(field.hasAttribute("data-open")).toBe(false);
  await userEvent.click(trigger);
  await vi.waitFor(() => expect(field.hasAttribute("data-open")).toBe(true));
  // Focus back on the trigger with the list still open is the one state where the field box holds
  // focus while open, so it is what tells data-open's override apart from plain focus-within.
  trigger.focus();
  expect(popup.matches(":popover-open")).toBe(true);
  expect(field.matches(":focus-within")).toBe(true);
  expect(getComputedStyle(field).boxShadow).toBe("rgb(7, 7, 7) 0px -1px 0px 0px inset");
  expect(getComputedStyle(label!).color).toBe("rgb(8, 8, 8)");
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(field.hasAttribute("data-open")).toBe(false));
  expect(getComputedStyle(field).boxShadow).toBe("rgb(1, 2, 3) 0px -2px 0px 0px inset");
});

test("with no search box, the field box keeps its focus marking while the list is open", async () => {
  const el = await mountWith('<wt-combobox label="Paper" search="never"></wt-combobox>');
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-field-label-focus", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-field-line-width-active", "3px");
  const { field, label, trigger, popup } = fieldParts(el);
  await userEvent.click(trigger);
  await vi.waitFor(() => expect(field.hasAttribute("data-open")).toBe(true));
  expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector('[role="listbox"]'));
  expect(getComputedStyle(field).boxShadow).toBe("rgb(1, 2, 3) 0px -3px 0px 0px inset");
  expect(getComputedStyle(label!).color).toBe("rgb(4, 5, 6)");
  trigger.focus();
  expect(popup.matches(":popover-open")).toBe(true);
  expect(getComputedStyle(field).boxShadow).toBe("rgb(1, 2, 3) 0px -3px 0px 0px inset");
});

test("with no search box, disabling the field closes its list without a focus line in between", async () => {
  const el = await mountWith('<wt-combobox label="Paper" search="never"></wt-combobox>');
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-field-label-focus", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-text-muted", "rgb(16, 17, 18)");
  host.style.setProperty("--wt-field-line-width-active", "3px");
  const { field, label, trigger, popup } = fieldParts(el);
  await userEvent.click(trigger);
  await vi.waitFor(() => expect(field.hasAttribute("data-open")).toBe(true));
  el.disabled = true;
  await el.updateComplete;
  expect(popup.matches(":popover-open")).toBe(false);
  expect(field.hasAttribute("data-open")).toBe(true);
  expect(field.hasAttribute("data-disabled")).toBe(true);
  expect(getComputedStyle(field).boxShadow).toBe("none");
  expect(getComputedStyle(label!).color).toBe("rgb(16, 17, 18)");
});

test("with no search box, an invalid field keeps the danger line while the list is open", async () => {
  const el = await mountWith('<wt-combobox label="Paper" search="never" invalid></wt-combobox>');
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-field-line-width-active", "3px");
  const { field, label, trigger } = fieldParts(el);
  await userEvent.click(trigger);
  await vi.waitFor(() => expect(field.hasAttribute("data-open")).toBe(true));
  expect(getComputedStyle(field).boxShadow).toBe("rgb(13, 14, 15) 0px -3px 0px 0px inset");
  expect(getComputedStyle(label!).color).toBe("rgb(13, 14, 15)");
});

test("an error marks the field box invalid as the invalid property does", async () => {
  const withError = await mountWith(
    '<wt-combobox label="Dietary tags" error="Choose one"></wt-combobox>',
  );
  const plain = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  expect(fieldParts(withError).field.hasAttribute("data-invalid")).toBe(true);
  expect(fieldParts(plain).field.hasAttribute("data-invalid")).toBe(false);
});

test("a focused invalid trigger keeps the danger line and label", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags" invalid></wt-combobox>');
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-field-line-width-active", "3px");
  el.focus();
  const { field, label } = fieldParts(el);
  expect(getComputedStyle(field).boxShadow).toBe("rgb(13, 14, 15) 0px -3px 0px 0px inset");
  expect(getComputedStyle(label!).color).toBe("rgb(13, 14, 15)");
});

test("the chosen label paints from the field-value token, and the placeholder muted and italic", async () => {
  const chosen = await mountWith('<wt-combobox label="Dietary tags" value="vegan"></wt-combobox>');
  host.style.setProperty("--wt-color-field-value", "rgb(31, 32, 33)");
  expect(getComputedStyle(fieldParts(chosen).value).color).toBe("rgb(31, 32, 33)");
  expect(getComputedStyle(fieldParts(chosen).value).fontStyle).toBe("normal");

  const empty = await mountWith(
    '<wt-combobox label="Dietary tags" placeholder="Choose a tag"></wt-combobox>',
  );
  host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  expect(getComputedStyle(fieldParts(empty).value).color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(fieldParts(empty).value).fontStyle).toBe("italic");
});

test("each row is the dropdown row height tall, and a hovered row paints the page background", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  host.style.setProperty("--wt-dropdown-row-height", "53px");
  host.style.setProperty("--wt-color-bg", "rgb(4, 5, 6)");
  await userEvent.click(fieldParts(el).trigger);
  const rows = optionRows(el);
  expect(rows.map((row) => row.getBoundingClientRect().height)).toEqual([53, 53, 53]);
  await userEvent.hover(rows[2]!);
  expect(getComputedStyle(rows[2]!).backgroundColor).toBe("rgb(4, 5, 6)");
});

test("the chosen row's label is bold with a tick at its trailing end, and no other row has either", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags" value="vegan"></wt-combobox>');
  host.style.setProperty("--wt-font-weight-bold", "800");
  host.style.setProperty("--wt-space-3", "13px");
  await userEvent.click(fieldParts(el).trigger);
  const rows = optionRows(el);
  const labelOf = (row: HTMLElement) => row.querySelector<HTMLElement>(".option-label")!;
  expect(rows.map((row) => getComputedStyle(labelOf(row)).fontWeight)).toEqual([
    "400",
    "800",
    "400",
  ]);
  expect(rows.map((row) => row.querySelectorAll('wt-icon[name="check"]').length)).toEqual([
    0, 1, 0,
  ]);
  const tick = rows[1]!.querySelector<HTMLElement>('wt-icon[name="check"]')!;
  expect(tick.getAttribute("aria-hidden")).toBe("true");
  expect(rows[1]!.lastElementChild).toBe(tick);
  expect(rows[1]!.getBoundingClientRect().right - tick.getBoundingClientRect().right).toBeCloseTo(
    13,
    0,
  );
});

test("the search box is outlined in the primary colour on the surface, and its area carries the first shadow", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  host.style.setProperty("--wt-color-surface", "rgb(1, 1, 1)");
  host.style.setProperty("--wt-color-primary", "rgb(2, 2, 2)");
  host.style.setProperty("--wt-field-line-width", "3px");
  host.style.setProperty("--wt-radius-md", "7px");
  host.style.setProperty("--wt-shadow-1", "rgb(3, 3, 3) 0px 2px 0px 0px");
  await userEvent.click(fieldParts(el).trigger);
  const search = searchBox(el);
  const style = getComputedStyle(search);
  expect(style.backgroundColor).toBe("rgb(1, 1, 1)");
  for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
    expect(style[`border${side}Color`]).toBe("rgb(2, 2, 2)");
    expect(style[`border${side}Style`]).toBe("solid");
    expect(style[`border${side}Width`]).toBe("3px");
  }
  expect(style.borderTopLeftRadius).toBe("7px");
  expect(style.borderBottomRightRadius).toBe("7px");
  const area = el.shadowRoot!.querySelector<HTMLElement>(".search-area")!;
  expect(area.contains(search)).toBe(true);
  expect(getComputedStyle(area).boxShadow).toBe("rgb(3, 3, 3) 0px 2px 0px 0px");
  expect(el.shadowRoot!.activeElement).toBe(search);
  expect(search.matches(":focus-visible")).toBe(true);
  expect(style.outlineStyle).toBe("none");
});

function manyOptions(count: number): ComboboxOption[] {
  return Array.from({ length: count }, (_, index) => ({
    value: String(index),
    label: `Option ${index}`,
  }));
}

test("the search box shows by default whatever the number of options", async () => {
  const el = await mountWith('<wt-combobox label="Paper"></wt-combobox>', manyOptions(2));
  expect(el.search).toBe("always");
  expect(el.shadowRoot!.querySelector(".search")).not.toBeNull();
});

test(`search="auto" shows the search box only above ${SEARCH_THRESHOLD} options`, async () => {
  expect(SEARCH_THRESHOLD).toBe(7);
  const seven = await mountWith(
    '<wt-combobox label="Paper" search="auto"></wt-combobox>',
    manyOptions(7),
  );
  expect(seven.shadowRoot!.querySelector(".search")).toBeNull();
  const eight = await mountWith(
    '<wt-combobox label="Paper" search="auto"></wt-combobox>',
    manyOptions(8),
  );
  expect(eight.shadowRoot!.querySelector(".search")).not.toBeNull();
});

test('search="never" shows no search box, even with many options or for a multiple choice', async () => {
  const many = await mountWith(
    '<wt-combobox label="Paper" search="never"></wt-combobox>',
    manyOptions(20),
  );
  expect(many.shadowRoot!.querySelector(".search")).toBeNull();
  const multiple = await mountWith(
    '<wt-combobox label="Paper" search="never" multiple></wt-combobox>',
    manyOptions(20),
  );
  expect(multiple.shadowRoot!.querySelector(".search")).toBeNull();
});

test('allow-add shows the search box even with search="never"', async () => {
  const el = await mountWith(
    '<wt-combobox label="Paper" search="never" allow-add></wt-combobox>',
    manyOptions(2),
  );
  expect(el.shadowRoot!.querySelector(".search")).not.toBeNull();
});

test("a list without a search box still opens and picks a clicked row", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags" search="never"></wt-combobox>');
  const { trigger, popup } = fieldParts(el);
  await userEvent.click(trigger);
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
  await userEvent.click(optionRows(el)[2]!);
  expect(el.value).toBe("vegetarian");
  expect(popup.matches(":popover-open")).toBe(false);
});

test("an option's icon is drawn before its label and hidden from screen readers", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>', [
    { value: "vegan", label: "Vegan", icon: "leaf" },
    { value: "halal", label: "Halal" },
  ]);
  await userEvent.click(fieldParts(el).trigger);
  const [withIcon, without] = optionRows(el);
  const icon = withIcon!.querySelector<HTMLElement>('wt-icon[name="leaf"]')!;
  expect(icon.getAttribute("aria-hidden")).toBe("true");
  const label = withIcon!.querySelector<HTMLElement>(".option-label")!;
  expect(icon.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(icon.getBoundingClientRect().right).toBeLessThanOrEqual(
    label.getBoundingClientRect().left,
  );
  expect(without!.querySelector("wt-icon")).toBeNull();
  expect(withIcon!.textContent!.trim()).toBe("Vegan");
});

const DESCRIBED: ComboboxOption[] = [
  { value: "public", label: "Public", description: "Can be ordered on its own." },
  { value: "staff", label: "Staff only", description: "Only staff can order it on its own." },
  { value: "plain", label: "Plain" },
];

test("an option's description is a second line under its label, inside the row, muted and small", async () => {
  const el = await mountWith(
    '<wt-combobox label="Ordering" value="staff"></wt-combobox>',
    DESCRIBED,
  );
  host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-font-size-sm", "11px");
  host.style.setProperty("--wt-font-weight-bold", "800");
  await userEvent.click(fieldParts(el).trigger);
  const [, staff] = optionRows(el);
  const label = staff!.querySelector<HTMLElement>(".option-label")!;
  const description = staff!.querySelector<HTMLElement>(".option-description")!;
  expect(description.textContent!.trim()).toBe("Only staff can order it on its own.");
  const row = staff!.getBoundingClientRect();
  const labelBox = label.getBoundingClientRect();
  const lineBox = description.getBoundingClientRect();
  expect(lineBox.top).toBeGreaterThanOrEqual(labelBox.bottom);
  expect(lineBox.left).toBeCloseTo(labelBox.left, 0);
  expect(lineBox.top).toBeGreaterThanOrEqual(row.top);
  expect(lineBox.bottom).toBeLessThanOrEqual(row.bottom);
  expect(getComputedStyle(description).color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(description).fontSize).toBe("11px");
  // The chosen row's label is bold; its description is not.
  expect(getComputedStyle(label).fontWeight).toBe("800");
  expect(getComputedStyle(description).fontWeight).toBe("400");
  // The tick still ends the row.
  expect(staff!.lastElementChild).toBe(staff!.querySelector('wt-icon[name="check"]'));
});

test("a screen reader names a described option by its label and reads the description with it", async () => {
  const el = await mountWith('<wt-combobox label="Ordering"></wt-combobox>', DESCRIBED);
  await userEvent.click(fieldParts(el).trigger);
  const [, staff, plain] = optionRows(el);
  await expect.element(page.elementLocator(staff!)).toHaveAccessibleName("Staff only");
  await expect
    .element(page.elementLocator(staff!))
    .toHaveAccessibleDescription("Only staff can order it on its own.");
  await expect.element(page.elementLocator(plain!)).toHaveAccessibleName("Plain");
  await expect.element(page.elementLocator(plain!)).toHaveAccessibleDescription("");
});

test("after filtering, the active row is still named by its own label and described by its own line", async () => {
  const el = await mountWith('<wt-combobox label="Ordering" search="always"></wt-combobox>', [
    ...DESCRIBED,
    { value: "meal", label: "Staff meal", description: "Given to staff at no charge." },
  ]);
  await userEvent.click(fieldParts(el).trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "staff");
  await userEvent.keyboard("{ArrowDown}");
  expect(optionRows(el).map((row) => row.querySelector(".option-label")!.textContent)).toEqual([
    "Staff only",
    "Staff meal",
  ]);
  const active = el.shadowRoot!.getElementById(search.getAttribute("aria-activedescendant")!)!;
  expect(active).toBe(optionRows(el)[1]);
  await expect.element(page.elementLocator(active)).toHaveAccessibleName("Staff meal");
  await expect
    .element(page.elementLocator(active))
    .toHaveAccessibleDescription("Given to staff at no charge.");
});

test("an option without a description, or with an empty one, draws its label alone, with no second line and no labelledby or describedby", async () => {
  const el = await mountWith('<wt-combobox label="Ordering"></wt-combobox>', [
    ...DESCRIBED,
    { value: "blank", label: "Blank", description: "" },
  ]);
  await userEvent.click(fieldParts(el).trigger);
  for (const row of optionRows(el).slice(2)) {
    expect(row.querySelector(".option-description")).toBeNull();
    expect(row.hasAttribute("aria-describedby")).toBe(false);
    expect(row.hasAttribute("aria-labelledby")).toBe(false);
    expect([...row.children].map((child) => child.className)).toEqual(["option-label"]);
  }
});

test("the closed field shows the chosen option's label alone, without its description", async () => {
  const el = await mountWith(
    '<wt-combobox label="Ordering" value="public"></wt-combobox>',
    DESCRIBED,
  );
  expect(fieldParts(el).value.textContent!.trim()).toBe("Public");
  expect(fieldParts(el).trigger.hasAttribute("aria-describedby")).toBe(false);
  // Closed, the list is not drawn, so its descriptions are not on screen either.
  expect(fieldParts(el).popup.checkVisibility()).toBe(false);
});

test("a long description wraps inside the panel rather than widening it", async () => {
  const { el, trigger, popup } = await mountCombobox(
    '<wt-combobox label="Ordering" search="never"></wt-combobox>',
  );
  el.options = [
    { value: "a", label: "A", description: "Only staff can order it on its own. ".repeat(4) },
  ];
  el.style.cssText = "position: fixed; left: 40px; top: 40px; width: 240px";
  await el.updateComplete;
  await userEvent.click(trigger);
  await new Promise(requestAnimationFrame);
  const description = el.shadowRoot!.querySelector<HTMLElement>(".option-description")!;
  expect(popup.getBoundingClientRect().width).toBeCloseTo(240, 0);
  expect(description.getBoundingClientRect().right).toBeLessThanOrEqual(
    popup.getBoundingClientRect().right,
  );
  expect(description.getClientRects().length).toBeGreaterThan(0);
  expect(description.getBoundingClientRect().height).toBeGreaterThan(
    2 * el.shadowRoot!.querySelector<HTMLElement>(".option-label")!.getBoundingClientRect().height,
  );
});

const WITH_DISABLED: ComboboxOption[] = [
  { value: "rye", label: "Rye" },
  { value: "wine", label: "Wine", disabled: true, description: "Has variants." },
  { value: "olives", label: "Olives" },
];

/** Playwright waits for an aria-disabled element to become enabled before clicking it; a person can
 * still press a greyed row. */
const FORCE = { force: true } as const;

function changesOf(el: WtCombobox): unknown[] {
  const changes: unknown[] = [];
  el.addEventListener("wt-change", (event) => changes.push((event as CustomEvent).detail));
  return changes;
}

test("a disabled option is marked aria-disabled and drawn in the muted token, its label and its description alike", async () => {
  const el = await mountWith('<wt-combobox label="Product"></wt-combobox>', WITH_DISABLED);
  host.style.setProperty("--wt-color-text", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  await userEvent.click(fieldParts(el).trigger);
  const [rye, wine] = optionRows(el);
  expect(wine!.getAttribute("aria-disabled")).toBe("true");
  expect(rye!.hasAttribute("aria-disabled")).toBe(false);
  expect(getComputedStyle(wine!.querySelector(".option-label")!).color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(wine!.querySelector(".option-description")!).color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(rye!.querySelector(".option-label")!).color).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(wine!).cursor).toBe("not-allowed");
  expect(getComputedStyle(rye!).cursor).toBe("pointer");
});

test("a hovered disabled option does not paint the hover background a choosable one does", async () => {
  const el = await mountWith('<wt-combobox label="Product"></wt-combobox>', WITH_DISABLED);
  host.style.setProperty("--wt-color-bg", "rgb(4, 5, 6)");
  await userEvent.click(fieldParts(el).trigger);
  const [rye, wine] = optionRows(el);
  await userEvent.hover(wine!);
  expect(getComputedStyle(wine!).backgroundColor).not.toBe("rgb(4, 5, 6)");
  await userEvent.hover(rye!);
  expect(getComputedStyle(rye!).backgroundColor).toBe("rgb(4, 5, 6)");
});

test("a disabled primary row draws its label and icon in the muted token, not the primary one", async () => {
  const el = await mountWith('<wt-combobox label="Members"></wt-combobox>', [
    { value: "new-staff", label: "New member…", icon: "leaf", primary: true, disabled: true },
    { value: "new-station", label: "New station…", icon: "leaf", primary: true },
  ]);
  host.style.setProperty("--wt-color-text-muted", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-primary-text", "rgb(7, 8, 9)");
  await userEvent.click(fieldParts(el).trigger);
  const [disabled, enabled] = optionRows(el);
  expect(disabled!.getAttribute("aria-disabled")).toBe("true");
  expect(getComputedStyle(disabled!).color).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(disabled!.querySelector("wt-icon")!).color).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(enabled!).color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(enabled!.querySelector("wt-icon")!).color).toBe("rgb(7, 8, 9)");
});

test("clicking a disabled option chooses nothing, sends no change and leaves the list open", async () => {
  const el = await mountWith('<wt-combobox label="Product"></wt-combobox>', WITH_DISABLED);
  const changes = changesOf(el);
  await userEvent.click(fieldParts(el).trigger);
  await userEvent.click(optionRows(el)[1]!, FORCE);
  expect(el.value).toBe("");
  expect(changes).toEqual([]);
  expect(fieldParts(el).popup.matches(":popover-open")).toBe(true);
  // A choosable row still chooses afterwards.
  await userEvent.click(optionRows(el)[2]!);
  expect(changes).toEqual([{ value: "olives" }]);
});

test("the arrows reach a disabled option, and Enter on it chooses nothing and submits nothing", async () => {
  const el = await mountWith('<wt-combobox label="Product"></wt-combobox>', WITH_DISABLED);
  const changes = changesOf(el);
  await userEvent.click(fieldParts(el).trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  expect(search.getAttribute("aria-activedescendant")).toBe(optionRows(el)[1]!.id);
  const [enterPrevented] = pressKeys(search, "Enter");
  expect(enterPrevented).toBe(true);
  await el.updateComplete;
  expect(el.value).toBe("");
  expect(changes).toEqual([]);
  expect(fieldParts(el).popup.matches(":popover-open")).toBe(true);
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(changes).toEqual([{ value: "olives" }]);
});

test("without a search box, Enter and Space on a disabled option choose nothing", async () => {
  const el = await mountWith(
    '<wt-combobox label="Product" search="never"></wt-combobox>',
    WITH_DISABLED,
  );
  const changes = changesOf(el);
  await userEvent.click(fieldParts(el).trigger);
  const list = el.shadowRoot!.querySelector<HTMLElement>(".list")!;
  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  expect(list.getAttribute("aria-activedescendant")).toBe(optionRows(el)[1]!.id);
  expect(pressKeys(list, "Enter", " ")).toEqual([true, true]);
  await el.updateComplete;
  expect(el.value).toBe("");
  expect(changes).toEqual([]);
  expect(fieldParts(el).popup.matches(":popover-open")).toBe(true);
});

test("in a multiple choice, a disabled option is never toggled on", async () => {
  const el = await mountWith('<wt-combobox label="Product" multiple></wt-combobox>', WITH_DISABLED);
  const changes = changesOf(el);
  await userEvent.click(fieldParts(el).trigger);
  await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
  await userEvent.click(optionRows(el)[1]!, FORCE);
  expect(el.values).toEqual([]);
  expect(changes).toEqual([]);
});

test("a disabled action row sends no action", async () => {
  const el = await mountWith('<wt-combobox label="Unit"></wt-combobox>', [
    { value: "add-unit", label: "Add unit…", action: true, disabled: true },
  ]);
  const actions = vi.fn();
  el.addEventListener("wt-combobox-action", actions);
  await userEvent.click(fieldParts(el).trigger);
  await userEvent.click(optionRows(el)[0]!, FORCE);
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(actions).not.toHaveBeenCalled();
});

test("a search finds a disabled option and shows it with its description, named by its label", async () => {
  const el = await mountWith('<wt-combobox label="Product"></wt-combobox>', WITH_DISABLED);
  await userEvent.click(fieldParts(el).trigger);
  await userEvent.type(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "wi");
  const rows = optionRows(el);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.getAttribute("aria-disabled")).toBe("true");
  expect(el.shadowRoot!.querySelector(".empty")).toBeNull();
  await expect.element(page.elementLocator(rows[0]!)).toHaveAccessibleName("Wine");
  await expect.element(page.elementLocator(rows[0]!)).toHaveAccessibleDescription("Has variants.");
});

test("type-ahead on a closed list without a search box steps over a disabled option", async () => {
  const el = await mountWith('<wt-combobox label="Pantry" search="never"></wt-combobox>', [
    { value: "pepper", label: "Pepper", disabled: true },
    { value: "paper", label: "Paper" },
  ]);
  const changes = changesOf(el);
  fieldParts(el).trigger.focus();
  pressKeys(fieldParts(el).trigger, "p");
  await el.updateComplete;
  expect(el.value).toBe("paper");
  expect(changes).toEqual([{ value: "paper" }]);
});

test("type-ahead in an open list without a search box moves onto a disabled option, as the arrows do", async () => {
  const el = await mountWith('<wt-combobox label="Pantry" search="never"></wt-combobox>', [
    { value: "pepper", label: "Pepper", disabled: true },
    { value: "paper", label: "Paper" },
  ]);
  const changes = changesOf(el);
  await userEvent.click(fieldParts(el).trigger);
  const list = el.shadowRoot!.querySelector<HTMLElement>(".list")!;
  pressKeys(list, "p");
  await el.updateComplete;
  expect(list.getAttribute("aria-activedescendant")).toBe(optionRows(el)[0]!.id);
  expect(changes).toEqual([]);
});

const GROUPED: ComboboxOption[] = [
  { value: "ana", label: "Ana", group: "Staff" },
  { value: "luis", label: "Luis", group: "Staff" },
  { value: "bar", label: "Bar", group: "Stations" },
  { value: "grill", label: "Grill", group: "Stations" },
];

test("options sharing a group render under one heading, inside a group the heading names", async () => {
  const el = await mountWith('<wt-combobox label="Members"></wt-combobox>', GROUPED);
  await userEvent.click(fieldParts(el).trigger);
  const groups = [...el.shadowRoot!.querySelectorAll<HTMLElement>('[role="group"]')];
  expect(groups).toHaveLength(2);
  const listbox = el.shadowRoot!.querySelector('[role="listbox"]')!;
  for (const [index, name] of ["Staff", "Stations"].entries()) {
    const group = groups[index]!;
    expect(listbox.contains(group)).toBe(true);
    const heading = el.shadowRoot!.getElementById(group.getAttribute("aria-labelledby")!)!;
    expect(heading.textContent!.trim()).toBe(name);
    expect(heading.getAttribute("role")).not.toBe("option");
    expect(heading.closest('[role="option"]')).toBeNull();
  }
  expect(
    groups.map((group) =>
      [...group.querySelectorAll('[role="option"]')].map((row) => row.textContent!.trim()),
    ),
  ).toEqual([
    ["Ana", "Luis"],
    ["Bar", "Grill"],
  ]);
});

test("ungrouped options render without a group", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  await userEvent.click(fieldParts(el).trigger);
  expect(el.shadowRoot!.querySelector('[role="group"]')).toBeNull();
});

test("a group split by an ungrouped option starts a new heading when it resumes", async () => {
  const el = await mountWith('<wt-combobox label="Members"></wt-combobox>', [
    { value: "ana", label: "Ana", group: "Staff" },
    { value: "none", label: "Nobody" },
    { value: "luis", label: "Luis", group: "Staff" },
  ]);
  await userEvent.click(fieldParts(el).trigger);
  const groups = [...el.shadowRoot!.querySelectorAll('[role="group"]')];
  expect(groups.map((group) => group.textContent!.replace(/\s+/g, " ").trim())).toEqual([
    "Staff Ana",
    "Staff Luis",
  ]);
  expect(optionRows(el).map((row) => row.textContent!.trim())).toEqual(["Ana", "Nobody", "Luis"]);
});

const WITH_PRIMARY: ComboboxOption[] = [
  { value: "ana", label: "Ana", group: "Staff" },
  { value: "new-staff", label: "New member…", group: "Staff", icon: "check", primary: true },
  { value: "bar", label: "Bar", group: "Stations" },
];

test("a primary row paints its label and icon in the primary token, hovered or not, and no other row does", async () => {
  const el = await mountWith('<wt-combobox label="Members"></wt-combobox>', WITH_PRIMARY);
  host.style.setProperty("--wt-color-primary-text", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-bg", "rgb(4, 5, 6)");
  await userEvent.click(fieldParts(el).trigger);
  const [plain, primary, other] = optionRows(el);
  expect(getComputedStyle(primary!).color).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(primary!.querySelector("wt-icon")!).color).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(plain!).color).not.toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(other!).color).not.toBe("rgb(1, 2, 3)");
  await userEvent.hover(primary!);
  expect(getComputedStyle(primary!).backgroundColor).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(primary!).color).toBe("rgb(1, 2, 3)");
});

test("an action row is not painted in the primary token unless it asks to be", async () => {
  const el = await mountWith('<wt-combobox label="Unit"></wt-combobox>', [
    { value: "kg", label: "Kilogram" },
    { value: "add-unit", label: "Add unit…", action: true },
  ]);
  host.style.setProperty("--wt-color-primary-text", "rgb(1, 2, 3)");
  await userEvent.click(fieldParts(el).trigger);
  expect(getComputedStyle(optionRows(el)[1]!).color).not.toBe("rgb(1, 2, 3)");
});

test("a primary row sharing a group sits last inside that group", async () => {
  const el = await mountWith('<wt-combobox label="Members"></wt-combobox>', WITH_PRIMARY);
  await userEvent.click(fieldParts(el).trigger);
  const groups = [...el.shadowRoot!.querySelectorAll<HTMLElement>('[role="group"]')];
  expect(
    groups.map((group) =>
      [...group.querySelectorAll('[role="option"]')].map((row) => row.textContent!.trim()),
    ),
  ).toEqual([["Ana", "New member…"], ["Bar"]]);
});

const WITH_ACTION: ComboboxOption[] = [
  { value: "kg", label: "Kilogram" },
  { value: "add-unit", label: "Add unit…", action: true },
];

test("clicking an action row announces it, closes the list, and never changes the value", async () => {
  const el = await mountWith('<wt-combobox label="Unit" value="kg"></wt-combobox>', WITH_ACTION);
  const changed = vi.fn();
  const actions: string[] = [];
  el.addEventListener("wt-change", changed);
  el.addEventListener("wt-combobox-action", (event) =>
    actions.push((event as CustomEvent<{ value: string }>).detail.value),
  );
  const { trigger, popup } = fieldParts(el);
  await userEvent.click(trigger);
  const row = optionRows(el)[1]!;
  expect(row.getAttribute("aria-selected")).toBe("false");
  await userEvent.click(row);
  expect(actions).toEqual(["add-unit"]);
  expect(el.value).toBe("kg");
  expect(changed).not.toHaveBeenCalled();
  expect(popup.matches(":popover-open")).toBe(false);
  expect(el.shadowRoot!.activeElement).toBe(trigger);
});

test("an action row is never shown as chosen, even when the value matches it", async () => {
  const el = await mountWith(
    '<wt-combobox label="Unit" value="add-unit"></wt-combobox>',
    WITH_ACTION,
  );
  await userEvent.click(fieldParts(el).trigger);
  expect(optionRows(el).map((row) => row.getAttribute("aria-selected"))).toEqual([
    "false",
    "false",
  ]);
  expect(el.shadowRoot!.querySelector('wt-icon[name="check"]')).toBeNull();
});

test("wt-combobox-action bubbles out of shadow roots, and its click stops at the component", async () => {
  const el = (await mountInShadowRoot('<wt-combobox label="Unit"></wt-combobox>')) as WtCombobox;
  el.options = WITH_ACTION;
  await el.updateComplete;
  let received: CustomEvent<{ value: string }> | undefined;
  const listener = (event: Event) => (received = event as CustomEvent<{ value: string }>);
  document.addEventListener("wt-combobox-action", listener, { once: true });
  const pageClicks = vi.fn();
  document.addEventListener("click", pageClicks);
  try {
    el.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.click();
    await el.updateComplete;
    pageClicks.mockClear();
    optionRows(el)[1]!.click();
  } finally {
    document.removeEventListener("click", pageClicks);
  }
  expect(received?.detail).toEqual({ value: "add-unit" });
  expect(received?.bubbles).toBe(true);
  expect(received?.composed).toBe(true);
  expect(pageClicks).not.toHaveBeenCalled();
});

test("a disabled combobox refuses an action row", async () => {
  const el = await mountWith('<wt-combobox label="Unit"></wt-combobox>', WITH_ACTION);
  const actions = vi.fn();
  el.addEventListener("wt-combobox-action", actions);
  el.disabled = true;
  await el.updateComplete;
  optionRows(el)[1]!.click();
  expect(actions).not.toHaveBeenCalled();
});

test("a hint describes the trigger through a hidden paragraph, before the error", async () => {
  const el = await mountWith(
    '<wt-combobox label="Dietary tags" hint="Pick the main one" error="Choose one"></wt-combobox>',
  );
  const { trigger } = fieldParts(el);
  const hint = el.shadowRoot!.querySelector<HTMLElement>("[data-hint]")!;
  const error = el.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  expect(hint.textContent).toBe("Pick the main one");
  expect(trigger.getAttribute("aria-describedby")).toBe(`${hint.id} ${error.id}`);
  expect(hint.id).toMatch(/^wt-combobox-hint-\d+$/);
  expect(hint.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  expect(getComputedStyle(hint).position).toBe("absolute");
});

test("the hint shows as the trigger's placeholder while nothing is chosen, and a placeholder wins over it", async () => {
  const el = await mountWith(
    '<wt-combobox label="Dietary tags" hint="Pick the main one"></wt-combobox>',
  );
  const { value } = fieldParts(el);
  expect(value.textContent!.trim()).toBe("Pick the main one");
  expect(value.classList.contains("placeholder")).toBe(true);
  el.value = "vegan";
  await el.updateComplete;
  expect(value.textContent!.trim()).toBe("Vegan");

  const both = await mountWith(
    '<wt-combobox label="Dietary tags" hint="Pick the main one" placeholder="Choose a tag"></wt-combobox>',
  );
  expect(fieldParts(both).value.textContent!.trim()).toBe("Choose a tag");
});

test("a combobox with no hint renders no hint paragraph", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  expect(el.shadowRoot!.querySelector("[data-hint]")).toBeNull();
});

test("hide-label draws no label, names the trigger by its label, and makes the field compact", async () => {
  const el = await mountWith('<wt-combobox label="Course" hide-label></wt-combobox>');
  host.style.setProperty("--wt-tap-min", "47px");
  const { field, trigger } = fieldParts(el);
  expect(el.shadowRoot!.querySelector("label")).toBeNull();
  expect(trigger.getAttribute("aria-label")).toBe("Course");
  expect(trigger.hasAttribute("aria-labelledby")).toBe(false);
  expect(field.hasAttribute("data-compact")).toBe(true);
  expect(field.getBoundingClientRect().height).toBe(47);
  expect(trigger.getBoundingClientRect().height).toBe(47);
});

test("a combobox named only by aria-label is compact too", async () => {
  const el = await mountWith('<wt-combobox aria-label="Course"></wt-combobox>');
  host.style.setProperty("--wt-tap-min", "47px");
  const { field } = fieldParts(el);
  expect(field.hasAttribute("data-compact")).toBe(true);
  expect(field.getBoundingClientRect().height).toBe(47);
});

test("places field help beside the field box, nesting it in neither the label nor the box", async () => {
  const el = (await mount(
    '<wt-combobox label="Dietary tags"><button slot="help">?</button></wt-combobox>',
  )) as WtCombobox;
  const { field, label } = fieldParts(el);
  const slot = el.shadowRoot!.querySelector<HTMLSlotElement>('slot[name="help"]')!;
  expect(label!.contains(slot)).toBe(false);
  expect(field.contains(slot)).toBe(false);
  expect(slot.assignedElements()[0]?.textContent).toBe("?");
});

test("field help sits outside the field box, at its trailing side and centred on it", async () => {
  const el = (await mount(
    '<wt-combobox label="Dietary tags"><button slot="help">?</button></wt-combobox>',
  )) as WtCombobox;
  const fieldBox = fieldParts(el).field.getBoundingClientRect();
  const helpBox = el.querySelector("button")!.getBoundingClientRect();
  expect(helpBox.left).toBeGreaterThanOrEqual(fieldBox.right);
  expect(
    Math.abs(helpBox.top + helpBox.height / 2 - (fieldBox.top + fieldBox.height / 2)),
  ).toBeLessThanOrEqual(1);
});

test("a long chosen label at phone width is one line cut with an ellipsis, ending before the chevron", async () => {
  const long =
    "Set lunch with a starter, a main course, a dessert, bread and a drink included for the table "
      .repeat(2)
      .slice(0, 120);
  expect(long).toHaveLength(120);
  const el = await mountWith('<wt-combobox label="Menu" value="long"></wt-combobox>', [
    { value: "long", label: long },
  ]);
  host.style.width = "390px";
  const short = await mountWith('<wt-combobox label="Menu" value="short"></wt-combobox>', [
    { value: "short", label: "Menú" },
  ]);
  host.style.width = "390px";
  const { value, chevron, field } = fieldParts(el);
  expect(value.textContent!.trim()).toBe(long);
  expect(getComputedStyle(value).textOverflow).toBe("ellipsis");
  expect(value.scrollWidth).toBeGreaterThan(value.clientWidth);
  expect(value.getBoundingClientRect().height).toBe(
    fieldParts(short).value.getBoundingClientRect().height,
  );
  expect(value.getBoundingClientRect().right).toBeLessThanOrEqual(
    chevron.getBoundingClientRect().left,
  );
  expect(field.getBoundingClientRect().width).toBeLessThanOrEqual(390);
});

test("a long label stops short of the chevron", async () => {
  const el = await mountWith(
    `<wt-combobox label="${"The kitchen station this product is sent to ".repeat(3)}" value="vegan"></wt-combobox>`,
  );
  host.style.width = "390px";
  const { label, chevron } = fieldParts(el);
  expect(label!.getBoundingClientRect().right).toBeLessThanOrEqual(
    chevron.getBoundingClientRect().left,
  );
});

test("a press on a narrow field's resting label, where it covers the trigger's middle, opens the list", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  el.style.cssText = "position: fixed; left: 20px; top: 40px; width: 150px";
  await el.updateComplete;
  const { trigger, label, popup, field } = fieldParts(el);
  expect(field.getAttribute("data-label")).toBe("rest");
  const box = trigger.getBoundingClientRect();
  const atMiddle = el.shadowRoot!.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
  expect(label!.contains(atMiddle)).toBe(true);
  // Forced only past Playwright's own check that nothing covers the trigger: the press still lands
  // at the trigger's middle, on the label, which is the path under test.
  await userEvent.click(trigger, { force: true });
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
  expect(popup.getBoundingClientRect().height).toBeGreaterThan(0);
});

// The keyboard and screen-reader behaviour of a select (A178, spec section 7.2).

function listbox(el: WtCombobox): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>('[role="listbox"]')!;
}

function activeRowText(el: WtCombobox, owner: HTMLElement): string | undefined {
  const id = owner.getAttribute("aria-activedescendant");
  if (id === null) return undefined;
  const row = el.shadowRoot!.getElementById(id);
  expect(row?.getAttribute("role")).toBe("option");
  return row!.textContent!.trim();
}

/** Lets a key's release, and any click it would cause, run before the list is looked at. */
const afterRelease = () => new Promise((resolve) => setTimeout(resolve, 50));

for (const [name, keys] of [
  ["ArrowDown", "{ArrowDown}"],
  ["ArrowUp", "{ArrowUp}"],
  ["Alt+ArrowDown", "{Alt>}{ArrowDown}{/Alt}"],
  ["Enter", "{Enter}"],
  ["Space", " "],
] as const) {
  test(`${name} on the closed trigger opens the list with the chosen row active, and it stays open once released`, async () => {
    const el = await mountWith('<wt-combobox label="Dietary tags" value="vegan"></wt-combobox>');
    const { trigger, popup } = fieldParts(el);
    trigger.focus();
    await userEvent.keyboard(keys);
    await afterRelease();
    expect(popup.matches(":popover-open")).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(el.shadowRoot!.activeElement).toBe(searchBox(el));
    expect(activeRowText(el, searchBox(el))).toBe("Vegan");
    expect(el.value).toBe("vegan");
  });
}

test("Space on the closed trigger leaves the search box it opens empty", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  const { trigger } = fieldParts(el);
  trigger.focus();
  await userEvent.keyboard(" ");
  await afterRelease();
  expect(el.shadowRoot!.activeElement).toBe(searchBox(el));
  expect(searchBox(el).value).toBe("");
});

test("opening from the keyboard with nothing chosen makes the first row active", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  fieldParts(el).trigger.focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(activeRowText(el, searchBox(el))).toBe("Gluten-free");
});

test("opening a multiple choice from the keyboard makes its first chosen row active", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags" multiple></wt-combobox>');
  el.values = ["vegetarian", "vegan"];
  await el.updateComplete;
  fieldParts(el).trigger.focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(activeRowText(el, searchBox(el))).toBe("Vegan");
});

test("opening an empty list from the keyboard makes no row active", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>', []);
  fieldParts(el).trigger.focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(fieldParts(el).popup.matches(":popover-open")).toBe(true);
  expect(searchBox(el).hasAttribute("aria-activedescendant")).toBe(false);
});

test("opening from the keyboard places the list under the trigger", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  el.style.cssText = "position: fixed; left: 120px; top: 40px; width: 240px";
  await el.updateComplete;
  const { trigger, popup } = fieldParts(el);
  trigger.focus();
  await userEvent.keyboard("{ArrowDown}");
  await new Promise(requestAnimationFrame);
  const box = popup.getBoundingClientRect();
  expect(box.width).toBeCloseTo(240, 0);
  expect(box.top).toBeCloseTo(trigger.getBoundingClientRect().bottom, 0);
});

test("a printable key on a closed searchable trigger opens the list with that character searched for", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  const { trigger, popup } = fieldParts(el);
  trigger.focus();
  await userEvent.keyboard("v");
  await afterRelease();
  expect(popup.matches(":popover-open")).toBe(true);
  expect(searchBox(el).value).toBe("v");
  expect(el.shadowRoot!.activeElement).toBe(searchBox(el));
  expect(optionRows(el).map((row) => row.textContent!.trim())).toEqual(["Vegan", "Vegetarian"]);
  expect(activeRowText(el, searchBox(el))).toBe("Vegan");
});

/** Dispatched in one turn, so the keys always fall inside type-ahead's 500 ms however slow the
 * runner; reports, per key, whether the component cancelled it. */
function pressKeys(target: HTMLElement, ...keys: string[]): boolean[] {
  return keys.map(
    (key) =>
      !target.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, composed: true, cancelable: true }),
      ),
  );
}

const PANTRY: ComboboxOption[] = [
  { value: "new", label: "Pack a new one…", action: true },
  { value: "olive", label: "Olive" },
  { value: "pepper", label: "Pepper" },
  { value: "paper", label: "Paper" },
  { value: "pasta", label: "Pasta" },
];

test("typing on a closed list without a search box chooses the first option starting with the typed text, without opening", async () => {
  const el = await mountWith('<wt-combobox label="Pantry" search="never"></wt-combobox>', PANTRY);
  const changes: string[] = [];
  el.addEventListener("wt-change", (event) =>
    changes.push((event as CustomEvent<{ value: string }>).detail.value),
  );
  const { trigger, popup, value } = fieldParts(el);
  trigger.focus();
  pressKeys(trigger, "p", "a");
  await el.updateComplete;
  expect(el.value).toBe("paper");
  expect(changes).toEqual(["pepper", "paper"]);
  expect(popup.matches(":popover-open")).toBe(false);
  expect(value.textContent!.trim()).toBe("Paper");
  expect(el.shadowRoot!.activeElement).toBe(trigger);
});

test("type-ahead that matches the option already chosen sends no change", async () => {
  const el = await mountWith(
    '<wt-combobox label="Pantry" search="never" value="olive"></wt-combobox>',
    PANTRY,
  );
  const changed = vi.fn();
  el.addEventListener("wt-change", changed);
  fieldParts(el).trigger.focus();
  pressKeys(fieldParts(el).trigger, "o", "l");
  expect(el.value).toBe("olive");
  expect(changed).not.toHaveBeenCalled();
});

test("type-ahead that matches nothing leaves the value alone", async () => {
  const el = await mountWith(
    '<wt-combobox label="Pantry" search="never" value="olive"></wt-combobox>',
    PANTRY,
  );
  fieldParts(el).trigger.focus();
  await userEvent.keyboard("z");
  expect(el.value).toBe("olive");
});

test("the typed text starts again 500 ms after the last key", async () => {
  const el = await mountWith('<wt-combobox label="Pantry" search="never"></wt-combobox>', PANTRY);
  const { trigger } = fieldParts(el);
  // Dispatched rather than typed: the page's timers are faked here, and a real keystroke travels
  // through the test runner, which needs them.
  const press = (key: string) =>
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    press("p");
    press("a");
    expect(el.value).toBe("paper");
    vi.advanceTimersByTime(499);
    press("s");
    expect(el.value).toBe("pasta");
    vi.advanceTimersByTime(500);
    press("o");
    expect(el.value).toBe("olive");
  } finally {
    vi.useRealTimers();
  }
});

test("a repeated first letter steps through the options starting with it", async () => {
  const el = await mountWith('<wt-combobox label="Pantry" search="never"></wt-combobox>', PANTRY);
  const { trigger } = fieldParts(el);
  const press = (key: string) =>
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      press("p");
      seen.push(el.value);
      vi.advanceTimersByTime(500);
    }
    expect(seen).toEqual(["pepper", "paper", "pasta", "pepper"]);
  } finally {
    vi.useRealTimers();
  }
});

test("the same letter pressed again inside 500 ms steps on to the next option starting with it, on a closed trigger", async () => {
  const el = await mountWith('<wt-combobox label="Pantry" search="never"></wt-combobox>', PANTRY);
  const { trigger } = fieldParts(el);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      pressKeys(trigger, "p");
      seen.push(el.value);
      vi.advanceTimersByTime(100);
    }
    expect(seen).toEqual(["pepper", "paper", "pasta", "pepper"]);
  } finally {
    vi.useRealTimers();
  }
});

test("the same letter pressed again inside 500 ms steps on to the next row starting with it, in an open list", async () => {
  const el = await mountWith('<wt-combobox label="Pantry" search="never"></wt-combobox>', PANTRY);
  fieldParts(el).trigger.focus();
  await userEvent.keyboard("{ArrowDown}");
  const list = listbox(el);
  expect(activeRowText(el, list)).toBe("Pack a new one…");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const seen: (string | undefined)[] = [];
    for (let i = 0; i < 4; i += 1) {
      pressKeys(list, "p");
      await el.updateComplete;
      seen.push(activeRowText(el, list));
      vi.advanceTimersByTime(100);
    }
    expect(seen).toEqual(["Pepper", "Paper", "Pasta", "Pepper"]);
    expect(el.value).toBe("");
  } finally {
    vi.useRealTimers();
  }
});

test("keys with a modifier, and type-ahead on a closed multiple choice, change nothing", async () => {
  const el = await mountWith('<wt-combobox label="Pantry" search="never"></wt-combobox>', PANTRY);
  const { trigger, popup } = fieldParts(el);
  const press = (init: KeyboardEventInit) =>
    !trigger.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  expect(press({ key: "p", ctrlKey: true })).toBe(false);
  expect(press({ key: "p", metaKey: true })).toBe(false);
  expect(press({ key: "Tab" })).toBe(false);
  expect(el.value).toBe("");
  expect(popup.matches(":popover-open")).toBe(false);

  const multi = await mountWith(
    '<wt-combobox label="Pantry" search="never" multiple></wt-combobox>',
    PANTRY,
  );
  fieldParts(multi).trigger.dispatchEvent(
    new KeyboardEvent("keydown", { key: "p", bubbles: true, cancelable: true }),
  );
  expect(multi.values).toEqual([]);
  expect(fieldParts(multi).popup.matches(":popover-open")).toBe(false);
});

test("a disabled trigger ignores the keys that open the list", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags" disabled></wt-combobox>');
  const { trigger, popup } = fieldParts(el);
  trigger.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
  );
  await el.updateComplete;
  expect(popup.matches(":popover-open")).toBe(false);
});

test("in an open list, ArrowDown on the last row wraps to the first and ArrowUp on the first wraps to the last", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags" value="vegetarian"></wt-combobox>');
  fieldParts(el).trigger.focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(activeRowText(el, searchBox(el))).toBe("Vegetarian");
  await userEvent.keyboard("{ArrowDown}");
  expect(activeRowText(el, searchBox(el))).toBe("Gluten-free");
  await userEvent.keyboard("{ArrowUp}");
  expect(activeRowText(el, searchBox(el))).toBe("Vegetarian");
});

test("without a search box the list itself takes focus and names the active row", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags" search="never"></wt-combobox>');
  const { trigger } = fieldParts(el);
  const list = listbox(el);
  trigger.focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(list.tagName).toBe("UL");
  expect(list.getAttribute("tabindex")).toBe("-1");
  expect(el.shadowRoot!.activeElement).toBe(list);
  expect(activeRowText(el, list)).toBe("Gluten-free");
  await userEvent.keyboard("{ArrowUp}");
  expect(activeRowText(el, list)).toBe("Vegetarian");
  await userEvent.keyboard("{ArrowDown}");
  expect(activeRowText(el, list)).toBe("Gluten-free");
  await userEvent.keyboard("{End}");
  expect(activeRowText(el, list)).toBe("Vegetarian");
  await userEvent.keyboard("{Home}");
  expect(activeRowText(el, list)).toBe("Gluten-free");
});

test("a list with a search box leaves focus and the active row to the search box", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  fieldParts(el).trigger.focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(listbox(el).hasAttribute("tabindex")).toBe(false);
  expect(listbox(el).hasAttribute("aria-activedescendant")).toBe(false);
});

test("a click opens a list without a search box with focus on the list", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags" search="never"></wt-combobox>');
  await userEvent.click(fieldParts(el).trigger);
  expect(el.shadowRoot!.activeElement).toBe(listbox(el));
  expect(listbox(el).hasAttribute("aria-activedescendant")).toBe(false);
});

test("Enter on the active row of a list without a search box picks it and closes the list", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags" search="never"></wt-combobox>');
  const { trigger, popup } = fieldParts(el);
  trigger.focus();
  await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
  expect(el.value).toBe("vegan");
  expect(popup.matches(":popover-open")).toBe(false);
  expect(el.shadowRoot!.activeElement).toBe(trigger);
});

test("Space on the active row of a multiple list without a search box toggles it and keeps the list open", async () => {
  const el = await mountWith(
    '<wt-combobox label="Dietary tags" search="never" multiple></wt-combobox>',
  );
  const { trigger, popup } = fieldParts(el);
  expect(el.shadowRoot!.querySelector(".search")).toBeNull();
  trigger.focus();
  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  await userEvent.keyboard(" ");
  expect(el.values).toEqual(["vegan"]);
  await userEvent.keyboard(" ");
  expect(el.values).toEqual([]);
  await afterRelease();
  expect(popup.matches(":popover-open")).toBe(true);
});

test("Enter with no active row in a list without a search box picks nothing", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags" search="never"></wt-combobox>');
  const changed = vi.fn();
  el.addEventListener("wt-change", changed);
  await userEvent.click(fieldParts(el).trigger);
  await userEvent.keyboard("{Enter}");
  expect(changed).not.toHaveBeenCalled();
  expect(fieldParts(el).popup.matches(":popover-open")).toBe(true);
});

test("a printable key in an open list without a search box moves to the next row starting with it", async () => {
  const el = await mountWith('<wt-combobox label="Pantry" search="never"></wt-combobox>', PANTRY);
  fieldParts(el).trigger.focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(activeRowText(el, listbox(el))).toBe("Pack a new one…");
  expect(pressKeys(listbox(el), "p", "a")).toEqual([true, true]);
  await el.updateComplete;
  expect(activeRowText(el, listbox(el))).toBe("Paper");
  expect(el.value).toBe("");
});

test("other keys in a list without a search box are left alone", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags" search="never"></wt-combobox>');
  await userEvent.click(fieldParts(el).trigger);
  const cancelled = !listbox(el).dispatchEvent(
    new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }),
  );
  expect(cancelled).toBe(false);
});

async function mountBetween(combobox: string, options: ComboboxOption[] = TAGS) {
  const wrapper = await mount(
    `<div><button data-before>Before</button>${combobox}<button data-after>After</button></div>`,
  );
  const el = wrapper.querySelector("wt-combobox") as WtCombobox;
  el.options = options;
  await el.updateComplete;
  return {
    el,
    before: wrapper.querySelector("[data-before]")!,
    after: wrapper.querySelector("[data-after]")!,
  };
}

for (const search of ["always", "never"] as const) {
  test(`Tab in an open list (search="${search}") picks nothing, closes, and moves focus on`, async () => {
    const { el, after } = await mountBetween(
      `<wt-combobox label="Dietary tags" value="vegan" search="${search}"></wt-combobox>`,
    );
    const changed = vi.fn();
    el.addEventListener("wt-change", changed);
    fieldParts(el).trigger.focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    await userEvent.keyboard("{Tab}");
    expect(fieldParts(el).popup.matches(":popover-open")).toBe(false);
    expect(document.activeElement).toBe(after);
    expect(el.value).toBe("vegan");
    expect(changed).not.toHaveBeenCalled();
  });

  test(`Shift+Tab in an open list (search="${search}") closes it and moves focus back`, async () => {
    const { el, before } = await mountBetween(
      `<wt-combobox label="Dietary tags" value="vegan" search="${search}"></wt-combobox>`,
    );
    fieldParts(el).trigger.focus();
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(fieldParts(el).popup.matches(":popover-open")).toBe(false);
    expect(document.activeElement).toBe(before);
    expect(el.value).toBe("vegan");
  });
}

test("focus moving out of both the list and the trigger closes the list", async () => {
  const { el, after } = await mountBetween('<wt-combobox label="Dietary tags"></wt-combobox>');
  await userEvent.click(fieldParts(el).trigger);
  (after as HTMLElement).focus();
  expect(fieldParts(el).popup.matches(":popover-open")).toBe(false);
  expect(el.value).toBe("");
});

test("arrows step over group headings", async () => {
  const el = await mountWith('<wt-combobox label="Members" search="never"></wt-combobox>', GROUPED);
  fieldParts(el).trigger.focus();
  await userEvent.keyboard("{ArrowDown}");
  const seen = [activeRowText(el, listbox(el))];
  for (let i = 0; i < 3; i += 1) {
    await userEvent.keyboard("{ArrowDown}");
    seen.push(activeRowText(el, listbox(el)));
  }
  expect(seen).toEqual(["Ana", "Luis", "Bar", "Grill"]);
});

for (const search of ["always", "never"] as const) {
  test(`Enter on an action row (search="${search}") sends wt-combobox-action and keeps the value`, async () => {
    const el = await mountWith(
      `<wt-combobox label="Unit" value="kg" search="${search}"></wt-combobox>`,
      WITH_ACTION,
    );
    const actions: string[] = [];
    const changed = vi.fn();
    el.addEventListener("wt-combobox-action", (event) =>
      actions.push((event as CustomEvent<{ value: string }>).detail.value),
    );
    el.addEventListener("wt-change", changed);
    fieldParts(el).trigger.focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(actions).toEqual(["add-unit"]);
    expect(el.value).toBe("kg");
    expect(changed).not.toHaveBeenCalled();
  });
}

test("inside an open wt-dialog, Escape closes the list and not the dialog; a second Escape closes the dialog", async () => {
  const dialog = (await mount(`<wt-dialog heading="Edit product">
      <wt-combobox label="Dietary tags"></wt-combobox>
    </wt-dialog>`)) as WtDialog;
  dialog.open = true;
  await dialog.updateComplete;
  const el = dialog.querySelector("wt-combobox") as WtCombobox;
  el.options = TAGS;
  await el.updateComplete;
  const closes = vi.fn();
  dialog.addEventListener("wt-close", closes);
  const { trigger, popup } = fieldParts(el);
  await userEvent.click(trigger);
  await new Promise(requestAnimationFrame);
  expect(popup.matches(":popover-open")).toBe(true);
  const box = popup.getBoundingClientRect();
  expect(box.height).toBeGreaterThan(0);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(innerHeight);
  expect(box.right).toBeLessThanOrEqual(innerWidth);
  const onTop = el.shadowRoot!.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
  expect(popup.contains(onTop)).toBe(true);

  await userEvent.keyboard("{Escape}");
  await afterRelease();
  expect(popup.matches(":popover-open")).toBe(false);
  expect(dialog.open).toBe(true);
  expect(closes).not.toHaveBeenCalled();
  expect(el.shadowRoot!.activeElement).toBe(trigger);

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(dialog.open).toBe(false));
  expect(closes).toHaveBeenCalledTimes(1);
});

async function mountInSubmitForm(combobox: string) {
  const form = (await mount(`<form>
      ${combobox}
      <button type="button" data-submit>Save</button>
    </form>`)) as HTMLFormElement;
  const button = form.querySelector<HTMLButtonElement>("[data-submit]")!;
  const submitted = vi.fn();
  button.addEventListener("click", submitted);
  form.addEventListener("keydown", (event) => submitOnEnter(event, button));
  const el = form.querySelector("wt-combobox") as WtCombobox;
  el.options = TAGS;
  await el.updateComplete;
  return { el, submitted };
}

test("Enter on a closed trigger in a form wired with submitOnEnter opens the list and submits nothing", async () => {
  const { el, submitted } = await mountInSubmitForm(
    '<wt-combobox label="Dietary tags"></wt-combobox>',
  );
  fieldParts(el).trigger.focus();
  await userEvent.keyboard("{Enter}");
  await afterRelease();
  expect(fieldParts(el).popup.matches(":popover-open")).toBe(true);
  expect(submitted).not.toHaveBeenCalled();
});

test("Enter in the search box with no row active, in a form wired with submitOnEnter, submits nothing", async () => {
  const { el, submitted } = await mountInSubmitForm(
    '<wt-combobox label="Dietary tags"></wt-combobox>',
  );
  await userEvent.click(fieldParts(el).trigger);
  await userEvent.type(searchBox(el), "zzz");
  expect(searchBox(el).hasAttribute("aria-activedescendant")).toBe(false);
  await userEvent.keyboard("{Enter}");
  await afterRelease();
  expect(submitted).not.toHaveBeenCalled();
  expect(el.value).toBe("");
});

test("Enter on a row in the search box, in a form wired with submitOnEnter, picks it and submits nothing", async () => {
  const { el, submitted } = await mountInSubmitForm(
    '<wt-combobox label="Dietary tags"></wt-combobox>',
  );
  fieldParts(el).trigger.focus();
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await afterRelease();
  expect(el.value).toBe("gluten-free");
  expect(submitted).not.toHaveBeenCalled();
});

test("a failed submission's focusFirstInvalid focuses an invalid combobox's trigger", async () => {
  await mount(`<form>
      <wt-input label="Name" name="name" value="Ana"></wt-input>
      <wt-combobox label="Unit" name="unit" error="Choose a unit"></wt-combobox>
    </form>`);
  const form = host.querySelector("form")!;
  const el = host.querySelector("wt-combobox") as WtCombobox;
  const focused = await focusFirstInvalid(form);
  expect(focused).toBe(fieldParts(el).trigger);
  expect(el.shadowRoot!.activeElement).toBe(fieldParts(el).trigger);
});

test("ArrowDown in an empty list leaves no row active, and reaches the first row once options arrive", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>', []);
  await userEvent.click(fieldParts(el).trigger);
  await userEvent.keyboard("{ArrowDown}");
  expect(searchBox(el).hasAttribute("aria-activedescendant")).toBe(false);
  el.options = TAGS;
  await el.updateComplete;
  await userEvent.keyboard("{ArrowDown}");
  expect(activeRowText(el, searchBox(el))).toBe("Gluten-free");
});

test("a printable key that matches nothing opens the list with no row active", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  fieldParts(el).trigger.focus();
  await userEvent.keyboard("z");
  expect(fieldParts(el).popup.matches(":popover-open")).toBe(true);
  expect(searchBox(el).value).toBe("z");
  expect(searchBox(el).hasAttribute("aria-activedescendant")).toBe(false);
});

test("a printable key matching no row in an open list without a search box keeps the active row", async () => {
  const el = await mountWith('<wt-combobox label="Pantry" search="never"></wt-combobox>', PANTRY);
  fieldParts(el).trigger.focus();
  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  expect(activeRowText(el, listbox(el))).toBe("Olive");
  await userEvent.keyboard("z");
  expect(activeRowText(el, listbox(el))).toBe("Olive");
});

test("pressing the label while the list is open closes it, and does not open it again", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  const { trigger, label, popup } = fieldParts(el);
  await userEvent.click(trigger);
  await userEvent.type(searchBox(el), "veg");
  const toggles: string[] = [];
  popup.addEventListener("toggle", (event) => toggles.push((event as ToggleEvent).newState));
  await userEvent.click(label!);
  await new Promise(requestAnimationFrame);
  expect(toggles).toEqual(["closed"]);
  expect(popup.matches(":popover-open")).toBe(false);
  // A later press on the closed field's label still opens it.
  await userEvent.click(label!);
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
});

test("a value that names an action row shows nothing chosen", async () => {
  const el = await mountWith(
    '<wt-combobox label="Unit" value="add-unit" placeholder="Choose a unit"></wt-combobox>',
    WITH_ACTION,
  );
  const { value } = fieldParts(el);
  expect(value.textContent!.trim()).toBe("Choose a unit");
  expect(value.classList.contains("placeholder")).toBe(true);

  const multi = await mountWith(
    '<wt-combobox label="Unit" multiple placeholder="Choose units"></wt-combobox>',
    WITH_ACTION,
  );
  multi.values = ["add-unit"];
  await multi.updateComplete;
  expect(fieldParts(multi).value.textContent!.trim()).toBe("Choose units");
});

test("type-ahead on a closed list ignores the search text left from an earlier opening", async () => {
  const eight = manyOptions(8).map((option, index) => ({
    ...option,
    label: ["Olive", "Pepper", "Paper", "Pasta", "Rice", "Salt", "Sugar", "Tea"][index]!,
  }));
  const el = await mountWith('<wt-combobox label="Pantry" search="auto"></wt-combobox>', eight);
  const { trigger, popup } = fieldParts(el);
  await userEvent.click(trigger);
  await userEvent.type(searchBox(el), "sa");
  await userEvent.keyboard("{Escape}");
  expect(popup.matches(":popover-open")).toBe(false);
  el.options = eight.slice(0, 7);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".search")).toBeNull();
  pressKeys(trigger, "r");
  expect(el.value).toBe("4");
});

test("Space, Enter and printable keys in a list without a search box are consumed", async () => {
  const el = await mountWith(
    '<wt-combobox label="Pantry" search="never" multiple></wt-combobox>',
    PANTRY,
  );
  await userEvent.click(fieldParts(el).trigger);
  expect(pressKeys(listbox(el), "o", " ", "Enter")).toEqual([true, true, true]);
});

test("type-ahead in a long list without a search box scrolls the row it reaches into view", async () => {
  const options = [
    ...Array.from({ length: 19 }, (_, index) => ({
      value: String(index),
      label: `Apple ${index}`,
    })),
    { value: "zest", label: "Zest" },
  ];
  const el = await mountWith('<wt-combobox label="Pantry" search="never"></wt-combobox>', options);
  await userEvent.click(fieldParts(el).trigger);
  const list = listbox(el);
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  pressKeys(list, "z");
  await vi.waitFor(() => {
    const row = el.shadowRoot!.querySelector(".option.active")!.getBoundingClientRect();
    expect(row.bottom).toBeLessThanOrEqual(list.getBoundingClientRect().bottom);
  });
  expect(activeRowText(el, list)).toBe("Zest");
});

test("pressing the label while the list is open leaves focus on the trigger", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  const { trigger, label, popup } = fieldParts(el);
  await userEvent.click(trigger);
  expect(el.shadowRoot!.activeElement).toBe(searchBox(el));
  await userEvent.click(label!);
  await new Promise(requestAnimationFrame);
  expect(popup.matches(":popover-open")).toBe(false);
  expect(document.activeElement).toBe(el);
  expect(el.shadowRoot!.activeElement).toBe(trigger);
});

test("a label press that ends without a click on the label does not swallow a later scripted click", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  const { trigger, label, popup } = fieldParts(el);
  await userEvent.click(trigger);
  // Pressed on the label and released elsewhere, as a drag off it would: no click on the label.
  label!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
  document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await userEvent.keyboard("{Escape}");
  expect(popup.matches(":popover-open")).toBe(false);
  label!.click();
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
});

test("a label press cancelled by the browser does not swallow a later scripted click", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  const { trigger, label, popup } = fieldParts(el);
  await userEvent.click(trigger);
  label!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
  label!.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, composed: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await userEvent.keyboard("{Escape}");
  label!.click();
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
});

test("a touch tap on the label whose click arrives a task after the release still closes an open list", async () => {
  const el = await mountWith('<wt-combobox label="Dietary tags"></wt-combobox>');
  const { trigger, label, popup } = fieldParts(el);
  await userEvent.click(trigger);
  const toggles: string[] = [];
  popup.addEventListener("toggle", (event) => toggles.push((event as ToggleEvent).newState));
  const touch = { bubbles: true, composed: true, cancelable: true, pointerId: 7 };
  label!.dispatchEvent(new PointerEvent("pointerdown", { ...touch, pointerType: "touch" }));
  label!.dispatchEvent(new PointerEvent("pointerup", { ...touch, pointerType: "touch" }));
  // A dispatched release does not light-dismiss the popover, so this stands in for that.
  popup.hidePopover();
  // On touch, Chromium can deliver the tap's click a task after the release.
  await new Promise((resolve) => setTimeout(resolve, 0));
  label!.dispatchEvent(new PointerEvent("click", { ...touch, pointerType: "touch" }));
  await new Promise(requestAnimationFrame);
  expect(toggles).toEqual(["closed"]);
  expect(popup.matches(":popover-open")).toBe(false);
  expect(el.shadowRoot!.activeElement).toBe(trigger);
});

test('search="auto" dropping to the threshold while the list is open keeps it open, with the list taking the keys', async () => {
  const el = await mountWith(
    '<wt-combobox label="Paper" search="auto"></wt-combobox>',
    manyOptions(SEARCH_THRESHOLD + 1),
  );
  const { trigger, popup } = fieldParts(el);
  trigger.focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(el.shadowRoot!.activeElement).toBe(searchBox(el));
  el.options = manyOptions(SEARCH_THRESHOLD);
  await el.updateComplete;
  await settle();
  expect(el.shadowRoot!.querySelector(".search")).toBeNull();
  expect(popup.matches(":popover-open")).toBe(true);
  expect(el.shadowRoot!.activeElement).toBe(listbox(el));
  expect(activeRowText(el, listbox(el))).toBe("Option 0");
  await userEvent.keyboard("{ArrowDown}");
  expect(activeRowText(el, listbox(el))).toBe("Option 1");
});

test('search="auto" rising past the threshold while the list is open moves the keys to the new search box', async () => {
  const el = await mountWith(
    '<wt-combobox label="Paper" search="auto"></wt-combobox>',
    manyOptions(SEARCH_THRESHOLD),
  );
  const { trigger, popup } = fieldParts(el);
  trigger.focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(el.shadowRoot!.activeElement).toBe(listbox(el));
  el.options = manyOptions(SEARCH_THRESHOLD + 1);
  await el.updateComplete;
  await settle();
  expect(popup.matches(":popover-open")).toBe(true);
  expect(el.shadowRoot!.activeElement).toBe(searchBox(el));
  expect(activeRowText(el, searchBox(el))).toBe("Option 0");
  await userEvent.keyboard("{ArrowDown}");
  expect(activeRowText(el, searchBox(el))).toBe("Option 1");
});

test("an option change while the list is open leaves focus on the trigger when it was there", async () => {
  const el = await mountWith(
    '<wt-combobox label="Paper" search="auto"></wt-combobox>',
    manyOptions(SEARCH_THRESHOLD + 1),
  );
  const { trigger, popup } = fieldParts(el);
  await userEvent.click(trigger);
  trigger.focus();
  el.options = manyOptions(SEARCH_THRESHOLD);
  await el.updateComplete;
  await settle();
  expect(popup.matches(":popover-open")).toBe(true);
  expect(el.shadowRoot!.activeElement).toBe(trigger);
});

/** Opens a list without a search box from the keyboard and moves to its last row. */
async function openOnLastRow(html: string, count = 5): Promise<WtCombobox> {
  const el = await mountWith(html, manyOptions(count));
  fieldParts(el).trigger.focus();
  await userEvent.keyboard("{ArrowDown}{End}");
  expect(activeRowText(el, listbox(el))).toBe(`Option ${count - 1}`);
  return el;
}

test("a shortened option list moves the active row to the first row when the active option is gone", async () => {
  const el = await openOnLastRow('<wt-combobox label="Paper" search="never"></wt-combobox>');
  el.options = manyOptions(1);
  await el.updateComplete;
  expect(activeRowText(el, listbox(el))).toBe("Option 0");
  await userEvent.keyboard("{Enter}");
  expect(el.value).toBe("0");
});

test("a changed option list keeps the same option active when it is still there", async () => {
  const el = await openOnLastRow('<wt-combobox label="Paper" search="never"></wt-combobox>');
  el.options = manyOptions(5).slice(2);
  await el.updateComplete;
  expect(activeRowText(el, listbox(el))).toBe("Option 4");
  await userEvent.keyboard("{ArrowUp}");
  expect(activeRowText(el, listbox(el))).toBe("Option 3");
});

test("a changed option list that drops the active option moves to the chosen row", async () => {
  const el = await openOnLastRow(
    '<wt-combobox label="Paper" search="never" value="1"></wt-combobox>',
  );
  el.options = manyOptions(3);
  await el.updateComplete;
  expect(activeRowText(el, listbox(el))).toBe("Option 1");
});

test("an emptied option list leaves no row active", async () => {
  const el = await openOnLastRow('<wt-combobox label="Paper" search="never"></wt-combobox>');
  el.options = [];
  await el.updateComplete;
  expect(listbox(el).hasAttribute("aria-activedescendant")).toBe(false);
});

test("a changed option list leaves a list opened by a click with no row active", async () => {
  const el = await mountWith(
    '<wt-combobox label="Paper" search="never"></wt-combobox>',
    manyOptions(5),
  );
  await userEvent.click(fieldParts(el).trigger);
  el.options = manyOptions(3);
  await el.updateComplete;
  expect(listbox(el).hasAttribute("aria-activedescendant")).toBe(false);
});

test("a changed option list keeps the add row active while it is still offered", async () => {
  const el = await mountWith('<wt-combobox label="Paper" allow-add></wt-combobox>', manyOptions(5));
  const added = vi.fn();
  el.addEventListener("wt-combobox-add", added);
  fieldParts(el).trigger.focus();
  await userEvent.keyboard("Zed");
  expect(activeRowText(el, searchBox(el))).toBe("Add 'Zed'");
  el.options = [...manyOptions(3), { value: "zed-one", label: "Zed one" }];
  await el.updateComplete;
  expect(activeRowText(el, searchBox(el))).toBe("Add 'Zed'");
  await userEvent.keyboard("{Enter}");
  expect(added).toHaveBeenCalledOnce();
  expect(el.value).toBe("");
});

test("a changed option list that stops offering the active add row moves to the first row", async () => {
  const el = await mountWith('<wt-combobox label="Paper" allow-add></wt-combobox>', manyOptions(5));
  fieldParts(el).trigger.focus();
  await userEvent.keyboard("Zed");
  expect(activeRowText(el, searchBox(el))).toBe("Add 'Zed'");
  el.options = [...manyOptions(3), { value: "zed", label: "Zed" }];
  await el.updateComplete;
  expect(activeRowText(el, searchBox(el))).toBe("Zed");
});

for (const search of ["always", "never"] as const) {
  test(`the arrow keys on the trigger of an open list (search="${search}") move the active row and focus back into the list`, async () => {
    const el = await mountWith(
      `<wt-combobox label="Paper" search="${search}"></wt-combobox>`,
      manyOptions(5),
    );
    const { trigger, popup } = fieldParts(el);
    await userEvent.click(trigger);
    trigger.focus();
    const owner = search === "always" ? searchBox(el) : listbox(el);
    await userEvent.keyboard("{ArrowDown}");
    expect(popup.matches(":popover-open")).toBe(true);
    expect(el.shadowRoot!.activeElement).toBe(owner);
    expect(activeRowText(el, owner)).toBe("Option 0");
    for (const [key, row] of [
      ["{ArrowUp}", "Option 4"],
      ["{Home}", "Option 0"],
      ["{End}", "Option 4"],
    ] as const) {
      trigger.focus();
      await userEvent.keyboard(key);
      expect(activeRowText(el, owner), key).toBe(row);
      expect(el.shadowRoot!.activeElement).toBe(owner);
    }
  });
}

test("DROPDOWN_ICONS holds a path that draws for the chevron and for the tick", () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.append(path);
  document.body.append(svg);
  try {
    expect(Object.keys(DROPDOWN_ICONS).sort()).toEqual(["check", "chevron-down"]);
    for (const [name, d] of Object.entries(DROPDOWN_ICONS)) {
      path.setAttribute("d", d);
      expect(path.getTotalLength(), name).toBeGreaterThan(0);
    }
  } finally {
    svg.remove();
  }
});

const TREE: ComboboxOption[] = [
  { value: "", label: "Uncategorised" },
  { value: "drinks", label: "Drinks", valueLabel: "Drinks", depth: 0 },
  {
    value: "alcoholic",
    label: "Alcoholic drinks",
    valueLabel: "Drinks › Alcoholic drinks",
    depth: 1,
  },
  {
    value: "cocktails",
    label: "Cocktails",
    valueLabel: "Drinks › Alcoholic drinks › Cocktails",
    depth: 2,
  },
  { value: "food", label: "Food", valueLabel: "Food", depth: 0 },
];

function rowTexts(el: WtCombobox): string[] {
  return optionRows(el).map((row) => row.textContent!.trim());
}

function startPaddings(el: WtCombobox): string[] {
  return optionRows(el).map((row) => getComputedStyle(row).paddingInlineStart);
}

test("with no search text, a row is indented by its depth times --wt-space-4 beyond its own start padding", async () => {
  const el = await mountWith('<wt-combobox label="Category"></wt-combobox>', TREE);
  host.style.setProperty("--wt-space-3", "10px");
  host.style.setProperty("--wt-space-4", "7px");
  await userEvent.click(fieldParts(el).trigger);
  expect(rowTexts(el)).toEqual([
    "Uncategorised",
    "Drinks",
    "Alcoholic drinks",
    "Cocktails",
    "Food",
  ]);
  expect(startPaddings(el)).toEqual(["10px", "10px", "17px", "24px", "10px"]);
});

test("the closed trigger shows a chosen option's valueLabel, while its row in the list shows its label", async () => {
  const el = await mountWith(
    '<wt-combobox label="Category" value="cocktails"></wt-combobox>',
    TREE,
  );
  expect(fieldParts(el).value.textContent!.trim()).toBe("Drinks › Alcoholic drinks › Cocktails");
  await userEvent.click(fieldParts(el).trigger);
  const chosen = el.shadowRoot!.querySelector('[role="option"][aria-selected="true"]')!;
  expect(chosen.textContent!.trim()).toBe("Cocktails");
});

test("a multiple choice with one option chosen shows that option's valueLabel", async () => {
  const el = await mountWith('<wt-combobox label="Category" multiple></wt-combobox>', TREE);
  el.values = ["alcoholic"];
  await el.updateComplete;
  expect(fieldParts(el).value.textContent!.trim()).toBe("Drinks › Alcoholic drinks");
});

test("while searching, a row matches on its valueLabel and shows it, with no indent; clearing the search restores both", async () => {
  const el = await mountWith('<wt-combobox label="Category"></wt-combobox>', TREE);
  host.style.setProperty("--wt-space-3", "10px");
  host.style.setProperty("--wt-space-4", "7px");
  await userEvent.click(fieldParts(el).trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  await userEvent.type(search, "drinks ›");
  expect(rowTexts(el)).toEqual([
    "Drinks › Alcoholic drinks",
    "Drinks › Alcoholic drinks › Cocktails",
  ]);
  expect(startPaddings(el)).toEqual(["10px", "10px"]);
  await userEvent.clear(search);
  expect(rowTexts(el)).toHaveLength(TREE.length);
  expect(startPaddings(el)).toEqual(["10px", "10px", "17px", "24px", "10px"]);
});

test("at phone width, a panel near the right edge that widens for a search's full paths stays inside the gutter", async () => {
  const [viewportWidth, viewportHeight] = [innerWidth, innerHeight];
  await page.viewport(390, 844);
  try {
    const el = await mountWith('<wt-combobox label="Category" hide-label></wt-combobox>', TREE);
    el.style.cssText = "position: fixed; left: 230px; top: 40px; width: 150px";
    await el.updateComplete;
    const { trigger, popup } = fieldParts(el);
    await userEvent.click(trigger);
    await new Promise(requestAnimationFrame);
    const opened = popup.getBoundingClientRect();
    expect(opened.right).toBeLessThanOrEqual(innerWidth - 8);
    await userEvent.type(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "drinks ›");
    await new Promise(requestAnimationFrame);
    expect(rowTexts(el)).toEqual([
      "Drinks › Alcoholic drinks",
      "Drinks › Alcoholic drinks › Cocktails",
    ]);
    const searched = popup.getBoundingClientRect();
    // Wider than when it opened, or the panel never had to move to stay on screen.
    expect(searched.width).toBeGreaterThan(opened.width);
    expect(searched.left).toBeGreaterThanOrEqual(8);
    expect(searched.right).toBeLessThanOrEqual(innerWidth - 8);
  } finally {
    await page.viewport(viewportWidth, viewportHeight);
  }
});

test("a panel opened near the bottom keeps its search box where it was while a search shrinks the list", async () => {
  const el = await mountWith('<wt-combobox label="Category" hide-label></wt-combobox>', TREE);
  el.style.cssText = `position: fixed; left: 20px; top: ${innerHeight - 60}px; width: 250px`;
  await el.updateComplete;
  const { trigger, popup } = fieldParts(el);
  await userEvent.click(trigger);
  await new Promise(requestAnimationFrame);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  const before = search.getBoundingClientRect().top;
  // Pulled up above the trigger, or a shrinking list could not have moved it down.
  expect(popup.getBoundingClientRect().top).toBeLessThan(trigger.getBoundingClientRect().bottom);
  await userEvent.type(search, "cocktails");
  await new Promise(requestAnimationFrame);
  expect(rowTexts(el)).toEqual(["Drinks › Alcoholic drinks › Cocktails"]);
  expect(search.getBoundingClientRect().top).toBeCloseTo(before, 0);
  const box = popup.getBoundingClientRect();
  expect(box.top).toBeGreaterThanOrEqual(8);
  expect(box.bottom).toBeLessThanOrEqual(innerHeight - 8);
});

test("a search matching an option's label but not its valueLabel does not find it", async () => {
  const el = await mountWith('<wt-combobox label="Category"></wt-combobox>', [
    { value: "a", label: "Leaf", valueLabel: "Branch › Twig" },
    { value: "b", label: "Leafy", depth: 1 },
  ]);
  await userEvent.click(fieldParts(el).trigger);
  await userEvent.type(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "leaf");
  expect(rowTexts(el)).toEqual(["Leafy"]);
});

test("a described row shows its valueLabel while searching", async () => {
  const el = await mountWith('<wt-combobox label="Category"></wt-combobox>', [
    { value: "a", label: "Twig", valueLabel: "Branch › Twig", description: "Small", depth: 1 },
  ]);
  await userEvent.click(fieldParts(el).trigger);
  await userEvent.type(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "twig");
  expect(el.shadowRoot!.querySelector(".option-label")!.textContent!.trim()).toBe("Branch › Twig");
});

test("stable-width reserves the width of each option's closed text, its valueLabel when it has one", async () => {
  const el = await mountWith('<wt-combobox label="Category" stable-width></wt-combobox>', TREE);
  const reserved = [...el.shadowRoot!.querySelectorAll(".width-option")].map((span) =>
    span.textContent!.trim(),
  );
  expect(reserved).toEqual([
    "Uncategorised",
    "Drinks",
    "Drinks › Alcoholic drinks",
    "Drinks › Alcoholic drinks › Cocktails",
    "Food",
  ]);
});

async function mountLink(attrs = 'value="cocktails"', options: ComboboxOption[] = TREE) {
  const el = await mountWith(
    `<wt-combobox label="Category" appearance="link" ${attrs}></wt-combobox>`,
    options,
  );
  el.actionLabel = "Change";
  await el.updateComplete;
  const root = el.shadowRoot!;
  return {
    el,
    trigger: root.querySelector<HTMLButtonElement>(".trigger")!,
    value: root.querySelector<HTMLElement>(".value")!,
    action: root.querySelector<HTMLElement>(".action")!,
    popup: root.querySelector<HTMLElement>("[popover]")!,
  };
}

test('appearance="link" draws the chosen value then the action word, with no field box, drawn label or chevron', async () => {
  const { el, trigger, value, action } = await mountLink();
  const root = el.shadowRoot!;
  expect(root.querySelector(".field")).toBeNull();
  expect(root.querySelector("label")).toBeNull();
  expect(root.querySelector(".chevron")).toBeNull();
  expect(trigger.contains(value)).toBe(true);
  expect(trigger.contains(action)).toBe(true);
  expect(value.textContent!.trim()).toBe("Drinks › Alcoholic drinks › Cocktails");
  expect(action.textContent!.trim()).toBe("Change");
  expect(action.getBoundingClientRect().left).toBeGreaterThanOrEqual(
    value.getBoundingClientRect().right,
  );
  expect(getComputedStyle(trigger).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(getComputedStyle(trigger).boxShadow).toBe("none");
  expect(getComputedStyle(trigger).borderStyle).toBe("none");
});

test("the appearance property is reflected to its attribute, and defaults to the field", async () => {
  const el = await mountWith('<wt-combobox label="Category"></wt-combobox>', TREE);
  expect(el.appearance).toBe("field");
  el.appearance = "link";
  await el.updateComplete;
  expect(el.getAttribute("appearance")).toBe("link");
  expect(el.shadowRoot!.querySelector(".field")).toBeNull();
});

test("a link trigger is named by its label and its visible words, with no aria-label replacing them", async () => {
  const { trigger } = await mountLink();
  expect(trigger.hasAttribute("aria-label")).toBe(false);
  expect(trigger.hasAttribute("aria-labelledby")).toBe(false);
  await expect
    .element(
      page.getByRole("button", { name: "Category: Drinks › Alcoholic drinks › Cocktails Change" }),
    )
    .toBe(trigger);
});

test("a link trigger is at least --wt-tap-min tall", async () => {
  const { trigger } = await mountLink();
  host.style.setProperty("--wt-tap-min", "52px");
  expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
  expect(trigger.getBoundingClientRect().width).toBeGreaterThanOrEqual(52);
});

test("a link trigger with an error shows it under the trigger and marks the trigger invalid", async () => {
  const { el, trigger } = await mountLink('value="cocktails" error="Choose a category"');
  const error = el.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  expect(error.textContent!.trim()).toBe("Choose a category");
  expect(trigger.getAttribute("aria-invalid")).toBe("true");
  expect(trigger.getAttribute("aria-describedby")).toBe(error.id);
  expect(error.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    trigger.getBoundingClientRect().bottom,
  );
});

test("a disabled link trigger is disabled and does not open", async () => {
  const { trigger, popup, action } = await mountLink('value="cocktails" disabled');
  host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  expect(trigger.disabled).toBe(true);
  expect(getComputedStyle(action).color).toBe("rgb(7, 8, 9)");
  await userEvent.click(trigger, { force: true });
  expect(popup.matches(":popover-open")).toBe(false);
});

test("a link trigger opens its list on a click, with the list's left edge at the value's", async () => {
  const { el, trigger, value, popup } = await mountLink();
  el.style.cssText = "position: fixed; left: 120px; top: 40px; width: 600px";
  await el.updateComplete;
  await userEvent.click(trigger);
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
  await new Promise(requestAnimationFrame);
  const box = popup.getBoundingClientRect();
  expect(box.left).toBeCloseTo(trigger.getBoundingClientRect().left, 0);
  expect(box.left).toBeCloseTo(value.getBoundingClientRect().left, 0);
  expect(box.left).toBeCloseTo(120, 0);
  expect(box.top).toBeCloseTo(trigger.getBoundingClientRect().bottom, 0);
});

test("a link trigger opens its list on Enter, with the chosen row active", async () => {
  const { el, trigger, popup } = await mountLink();
  trigger.focus();
  await userEvent.keyboard("{Enter}");
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(true));
  expect(el.shadowRoot!.querySelector(".option.active")!.textContent!.trim()).toBe("Cocktails");
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(popup.matches(":popover-open")).toBe(false));
  expect(el.shadowRoot!.activeElement).toBe(trigger);
});

test("choosing a row from a link trigger shows the new value's valueLabel", async () => {
  const { el, trigger, value } = await mountLink();
  const changes: unknown[] = [];
  el.addEventListener("wt-change", (event) => changes.push((event as CustomEvent).detail));
  await userEvent.click(trigger);
  await userEvent.click(optionRows(el).find((row) => row.textContent!.trim() === "Food")!);
  expect(changes).toEqual([{ value: "food" }]);
  expect(value.textContent!.trim()).toBe("Food");
});

test("a focused link trigger draws the focus ring, having no field line to mark focus with", async () => {
  const { el, trigger } = await mountLink();
  host.style.setProperty("--wt-color-focus", "rgb(1, 2, 3)");
  trigger.focus();
  await userEvent.keyboard("{Shift}");
  expect(el.shadowRoot!.activeElement).toBe(trigger);
  expect(getComputedStyle(trigger).outlineStyle).toBe("solid");
  expect(getComputedStyle(trigger).outlineColor).toBe("rgb(1, 2, 3)");
});

test("a long value on a link trigger wraps at phone width rather than being cut", async () => {
  const long = "Drinks › Alcoholic drinks › Cocktails › Classic cocktails › Stirred › Served short";
  const short = await mountLink('value="food"');
  host.style.width = "390px";
  const { trigger, value, action } = await mountLink('value="long"', [
    { value: "long", label: "Served short", valueLabel: long, depth: 5 },
  ]);
  host.style.width = "390px";
  expect(value.textContent!.trim()).toBe(long);
  expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth);
  expect(value.getBoundingClientRect().height).toBeGreaterThan(
    short.value.getBoundingClientRect().height,
  );
  expect(trigger.getBoundingClientRect().right).toBeLessThanOrEqual(
    host.getBoundingClientRect().right,
  );
  expect(action.getBoundingClientRect().right).toBeLessThanOrEqual(
    host.getBoundingClientRect().right,
  );
});

test("stable-width is ignored by a link trigger", async () => {
  const { el, trigger } = await mountLink('value="food" stable-width');
  expect(el.shadowRoot!.querySelectorAll(".width-option")).toHaveLength(0);
  expect(getComputedStyle(trigger).display).not.toBe("grid");
  expect(trigger.getBoundingClientRect().width).toBeLessThan(el.getBoundingClientRect().width);
});

describe.each(["light", "dark"] as const)("a link trigger's colours (%s theme)", (theme) => {
  function tokenColour(token: string): string {
    const probe = document.createElement("span");
    probe.style.color = `var(${token})`;
    host.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }

  test("the value paints --wt-color-text-muted and the action word --wt-color-primary-text", async () => {
    const { value, action } = await mountLink();
    host.setAttribute("data-theme", theme);
    const muted = tokenColour("--wt-color-text-muted");
    const primary = tokenColour("--wt-color-primary-text");
    expect(muted).not.toBe(primary);
    expect(getComputedStyle(value).color).toBe(muted);
    expect(getComputedStyle(action).color).toBe(primary);
  });
});
