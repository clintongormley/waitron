import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "./wt-combobox.js";
import type { WtCombobox } from "./wt-combobox.js";

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
  const { trigger } = await mountCombobox();
  host.style.setProperty("--wt-tap-min", "52px");
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(52);
  expect(getComputedStyle(trigger).borderColor).toBe("rgb(1, 2, 3)");
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
  // --wt-color-bg is the light-grey the search box already sits on, visible in both themes;
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

test("ArrowUp at the first row and ArrowDown at the last row do not wrap or go out of range", async () => {
  const { el, trigger } = await mountWithOptions();
  await userEvent.click(trigger);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  search.focus();
  await userEvent.keyboard("{ArrowUp}");
  expect(el.shadowRoot!.querySelectorAll('[role="option"]')[0].classList.contains("active")).toBe(
    true,
  );
  await userEvent.keyboard("{End}");
  const rows = el.shadowRoot!.querySelectorAll('[role="option"]');
  expect(rows[rows.length - 1].classList.contains("active")).toBe(true);
  await userEvent.keyboard("{ArrowDown}");
  expect(el.shadowRoot!.querySelectorAll('[role="option"]')[rows.length - 1].classList).toContain(
    "active",
  );
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
  // Clicked programmatically, as wt-input's and wt-switch's twin tests do: a nested shadow root is
  // outside applyTokens' reach (it adopts the token sheet on the document only), so this combobox
  // has no padding, border or min-height and its trigger's box is empty — a real pointer click
  // has nothing to land on. The dispatch under test does not care how the click arrived.
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

test("invalid state paints the trigger border from the danger token", async () => {
  const el = await mount("<wt-combobox invalid></wt-combobox>");
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  const trigger = el.shadowRoot!.querySelector(".trigger")!;
  expect(getComputedStyle(trigger).borderColor).toBe("rgb(13, 14, 15)");
});

test("disabled trigger dims via the disabled-opacity token", async () => {
  const el = await mount("<wt-combobox disabled></wt-combobox>");
  host.style.setProperty("--wt-opacity-disabled", "0.3");
  expect(getComputedStyle(el.shadowRoot!.querySelector(".trigger")!).opacity).toBe("0.3");
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
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(el.values).toEqual([]);
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
  await userEvent.type(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "kosher");
  el.disabled = true;
  await el.updateComplete;
  expect(popup.matches(":popover-open")).toBe(false);
  await userEvent.keyboard("{End}{Enter}");
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

test("an empty value means nothing selected, even when an option carries an empty value", async () => {
  const { el } = await mountCombobox(
    '<wt-combobox label="Dietary tags" placeholder="Choose a tag"></wt-combobox>',
  );
  el.options = [{ value: "", label: "Unset" }];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".value")!.textContent?.trim()).toBe("Choose a tag");
});

test("the popup stays inside the bottom gutter once its width matches the trigger", async () => {
  const { el, trigger, popup } = await mountCombobox();
  el.options = TAGS.map((tag) => ({
    ...tag,
    label: "A long option label that wraps onto several lines",
  }));
  el.style.cssText = `position: fixed; left: 20px; top: ${innerHeight - 100}px; width: 150px`;
  await el.updateComplete;
  await userEvent.click(trigger);
  await new Promise(requestAnimationFrame);
  expect(popup.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight - 8);
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

test("the open panel is as wide as its trigger and sits under it when there is room", async () => {
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
