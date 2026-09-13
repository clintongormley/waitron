import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "@vitest/browser/context";
import { cleanup, host, mount } from "../test-helpers.js";
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

test("multi-select renders a checkbox per option reflecting its selected state", async () => {
  const { el, trigger } = await mountCombobox(
    '<wt-combobox label="Dietary tags" multiple></wt-combobox>',
  );
  el.options = TAGS;
  el.values = ["vegan"];
  await el.updateComplete;
  await userEvent.click(trigger);
  const boxes = el.shadowRoot!.querySelectorAll<HTMLInputElement>('.option input[type="checkbox"]');
  expect([...boxes].map((box) => box.checked)).toEqual([false, true, false]);
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
  const { mountInShadowRoot } = await import("../test-helpers.js");
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
