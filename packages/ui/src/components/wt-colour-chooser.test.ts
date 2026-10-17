import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { fieldLabelState } from "@waitron/ui-core/field-styles";
import { cleanup, host, mount } from "../test-helpers.js";
import { focusFirstInvalid } from "../interactive.js";
import "./wt-colour-chooser.js";
import "./wt-modal.js";
import type { ColourChoice, WtColourChooser } from "./wt-colour-chooser.js";

afterEach(cleanup);

const CHOICES: readonly ColourChoice[] = [
  { value: "red", label: "Red", fill: "var(--wt-color-palette-red)", usedBy: ["Waiter"] },
  { value: "amber", label: "Amber", fill: "var(--wt-color-palette-amber)" },
  { value: "grey", label: "Grey", fill: "var(--wt-color-palette-grey)" },
  {
    value: "blue",
    label: "Blue",
    fill: "var(--wt-color-palette-blue)",
    usedBy: ["Runner", "Cook"],
  },
  { value: "green", label: "Green", fill: "var(--wt-color-palette-green)" },
  { value: "purple", label: "Purple", fill: "var(--wt-color-palette-purple)" },
];

async function mountChooser(attributes = 'name="colour" label="Colour" value="blue"') {
  host?.remove();
  const el = (await mount(
    `<wt-colour-chooser ${attributes}></wt-colour-chooser>`,
  )) as WtColourChooser;
  el.choices = CHOICES;
  await el.updateComplete;
  return { el, ...parts(el) };
}

function parts(el: WtColourChooser) {
  const root = el.shadowRoot!;
  return {
    root,
    field: root.querySelector<HTMLElement>(".field")!,
    label: root.querySelector<HTMLLabelElement>("label.field-label")!,
    trigger: root.querySelector<HTMLButtonElement>("button.trigger")!,
    panel: root.querySelector<HTMLElement>("[popover]")!,
    tiles: () => [...root.querySelectorAll<HTMLButtonElement>('[popover] [role="radio"]')],
    tile: (value: string) =>
      root.querySelector<HTMLButtonElement>(`[popover] [role="radio"][data-value="${value}"]`)!,
  };
}

async function openByClick(el: WtColourChooser) {
  const { trigger, panel } = parts(el);
  await userEvent.click(trigger);
  await vi.waitFor(() => expect(panel.matches(":popover-open")).toBe(true));
}

describe("the field", () => {
  test("shows the label, and a trigger named by the label and then the chosen colour", async () => {
    const { label, trigger } = await mountChooser();
    expect(label.querySelector(".field-label-text")!.textContent).toBe("Colour");
    expect(label.id).not.toBe("");
    expect(trigger.id).not.toBe("");
    expect(trigger.getAttribute("name")).toBe("colour");
    expect(trigger.getAttribute("type")).toBe("button");
    expect(trigger.textContent).toContain("Blue");
    const swatch = trigger.querySelector<HTMLElement>('[part="swatch"]')!;
    expect(swatch).not.toBeNull();
    expect(swatch.style.getPropertyValue("--swatch-fill")).toBe("var(--wt-color-palette-blue)");
    expect(trigger.getAttribute("aria-labelledby")).toBe(`${label.id} ${trigger.id}`);
    expect(trigger.hasAttribute("for")).toBe(false);
    expect(label.hasAttribute("for")).toBe(false);
    const named = page.getByRole("button", { name: "Colour Blue", exact: true });
    await expect.element(named).toBeInTheDocument();
    expect(named.element()).toBe(trigger);
  });

  test("required draws the star; without it there is none", async () => {
    const required = await mountChooser('label="Colour" value="blue" required');
    const star = required.label.querySelector("[data-required]")!;
    expect(star.textContent).toBe("*");
    expect(star.getAttribute("aria-hidden")).toBe("true");
    const plain = await mountChooser('label="Colour" value="blue"');
    expect(plain.label.querySelector("[data-required]")).toBeNull();
  });

  test("the label floats while a choice matches value", async () => {
    const { field } = await mountChooser();
    expect(field.dataset.label).toBe(fieldLabelState({ value: "Blue", hint: "", placeholder: "" }));
    expect(field.dataset.label).toBe("float");
  });
});

describe("a value that is in no choice", () => {
  test("shows no name and no square, rests the label, and the first tile is the tab stop", async () => {
    const { el, field, trigger, tiles } = await mountChooser(
      'name="colour" label="Colour" value="pink"',
    );
    expect(trigger.querySelector('[part="swatch"]')).toBeNull();
    for (const choice of CHOICES) expect(trigger.textContent).not.toContain(choice.label);
    expect(field.dataset.label).toBe(fieldLabelState({ value: "", hint: "", placeholder: "" }));
    expect(field.dataset.label).toBe("rest");
    await openByClick(el);
    const zero = tiles().filter((tile) => tile.getAttribute("tabindex") === "0");
    expect(zero).toEqual([tiles()[0]]);
    expect(tiles().filter((tile) => tile.getAttribute("aria-checked") === "true")).toEqual([]);
  });
});

describe("opening", () => {
  test("a click opens the panel, expands the trigger and focuses the checked tile", async () => {
    const { el, root, trigger, panel, tiles, tile } = await mountChooser();
    expect(panel.matches(":popover-open")).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
    await openByClick(el);
    await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("true"));
    expect(root.activeElement).toBe(tile("blue"));
    expect(tile("blue").getAttribute("aria-checked")).toBe("true");
    expect(tile("blue").getAttribute("tabindex")).toBe("0");
    expect(tiles().filter((t) => t.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(tiles().map((t) => t.dataset.value)).toEqual(CHOICES.map((choice) => choice.value));
    expect(tiles().every((t) => t.getAttribute("type") === "button")).toBe(true);
    await expect
      .element(page.getByRole("radiogroup", { name: "Colour", exact: true }))
      .toBeVisible();
  });

  test("the radio group is required when the field is", async () => {
    const plain = await mountChooser();
    expect(plain.panel.querySelector('[role="radiogroup"]')!.getAttribute("aria-required")).toBe(
      "false",
    );
    const required = await mountChooser('label="Colour" value="blue" required');
    expect(required.panel.querySelector('[role="radiogroup"]')!.getAttribute("aria-required")).toBe(
      "true",
    );
  });

  test("show() opens and hide() closes", async () => {
    const { el, panel } = await mountChooser();
    el.show();
    expect(panel.matches(":popover-open")).toBe(true);
    el.show();
    expect(panel.matches(":popover-open")).toBe(true);
    el.hide();
    expect(panel.matches(":popover-open")).toBe(false);
    el.hide();
    expect(panel.matches(":popover-open")).toBe(false);
  });

  test("a click on the trigger while open closes the panel", async () => {
    const { el, trigger, panel } = await mountChooser();
    await openByClick(el);
    await userEvent.click(trigger);
    await vi.waitFor(() => expect(panel.matches(":popover-open")).toBe(false));
    await vi.waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
  });
});

describe("marks", () => {
  test("a used colour shows its users and is named after them; an unused one is named alone", async () => {
    const { el, tile } = await mountChooser();
    await openByClick(el);
    expect(tile("blue").querySelector(".used-by")!.textContent).toBe("Runner, Cook");
    expect(tile("blue").getAttribute("aria-label")).toBe("Blue, Runner, Cook");
    expect(tile("red").getAttribute("aria-label")).toBe("Red, Waiter");
    expect(tile("grey").querySelector(".used-by")).toBeNull();
    expect(tile("grey").getAttribute("aria-label")).toBe("Grey");
    const visible = tile("blue").querySelector(":scope > [aria-hidden='true']")!;
    expect(visible.textContent).toContain("Blue");
    expect(visible.textContent).toContain("Runner, Cook");
    expect(tile("blue").querySelector('[part="swatch"], .swatch')).not.toBeNull();
    el.usedByLabel = (colour, names) => `${colour}, used by ${names}`;
    await el.updateComplete;
    expect(tile("blue").getAttribute("aria-label")).toBe("Blue, used by Runner, Cook");
    expect(tile("grey").getAttribute("aria-label")).toBe("Grey");
  });

  test("an empty usedBy list is no mark", async () => {
    const { el, tile } = await mountChooser();
    el.choices = [
      { value: "grey", label: "Grey", fill: "var(--wt-color-palette-grey)", usedBy: [] },
    ];
    await el.updateComplete;
    expect(tile("grey").querySelector(".used-by")).toBeNull();
    expect(tile("grey").getAttribute("aria-label")).toBe("Grey");
  });
});

describe("choosing", () => {
  test("a click on another tile sends one wt-change, closes and returns focus", async () => {
    const { el, root, trigger, panel, tile } = await mountChooser();
    const changes: unknown[] = [];
    el.addEventListener("wt-change", (event) => changes.push((event as CustomEvent).detail));
    const parentClicks = vi.fn();
    host.addEventListener("click", parentClicks);
    const documentChanges = vi.fn();
    document.addEventListener("wt-change", documentChanges);
    try {
      await openByClick(el);
      parentClicks.mockClear();
      await userEvent.click(tile("green"));
      expect(changes).toEqual([{ value: "green" }]);
      expect(documentChanges).toHaveBeenCalledTimes(1);
      expect(parentClicks).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(panel.matches(":popover-open")).toBe(false));
      expect(root.activeElement).toBe(trigger);
      expect(el.value).toBe("blue");
    } finally {
      document.removeEventListener("wt-change", documentChanges);
    }
  });

  test("a click on the checked tile sends nothing and closes", async () => {
    const { el, root, trigger, panel, tile } = await mountChooser();
    const changes = vi.fn();
    el.addEventListener("wt-change", changes);
    await openByClick(el);
    await userEvent.click(tile("blue"));
    await vi.waitFor(() => expect(panel.matches(":popover-open")).toBe(false));
    expect(changes).not.toHaveBeenCalled();
    expect(root.activeElement).toBe(trigger);
  });

  for (const key of ["{Enter}", " "]) {
    test(`${key === " " ? "Space" : "Enter"} on a tile does what a click does`, async () => {
      const { el, root, trigger, panel, tile } = await mountChooser();
      const changes: unknown[] = [];
      el.addEventListener("wt-change", (event) => changes.push((event as CustomEvent).detail));
      await openByClick(el);
      tile("purple").focus();
      await userEvent.keyboard(key);
      await vi.waitFor(() => expect(panel.matches(":popover-open")).toBe(false));
      expect(changes).toEqual([{ value: "purple" }]);
      expect(root.activeElement).toBe(trigger);
    });
  }
});

describe("disabled", () => {
  test("the trigger is disabled and a click opens nothing", async () => {
    const { el, trigger, panel, field } = await mountChooser(
      'name="colour" label="Colour" value="blue" disabled',
    );
    expect(trigger.disabled).toBe(true);
    expect(field.hasAttribute("data-disabled")).toBe(true);
    await userEvent.click(trigger, { force: true });
    trigger.click();
    el.show();
    expect(panel.matches(":popover-open")).toBe(false);
  });

  test("disabling an open chooser closes its panel", async () => {
    const { el, panel, field } = await mountChooser();
    expect(field.hasAttribute("data-disabled")).toBe(false);
    await openByClick(el);
    el.disabled = true;
    await el.updateComplete;
    expect(panel.matches(":popover-open")).toBe(false);
  });

  test("show() before the first render and after removal does nothing", async () => {
    const detached = document.createElement("wt-colour-chooser");
    expect(() => detached.show()).not.toThrow();
    const { el, panel } = await mountChooser();
    host.remove();
    el.show();
    expect(panel.matches(":popover-open")).toBe(false);
  });
});

describe("the error", () => {
  test("shows under the box, marks the trigger invalid and is focused by focusFirstInvalid", async () => {
    const { el, root, trigger, field } = await mountChooser(
      'name="colour" label="Colour" value="pink" error="Choose a colour."',
    );
    const error = root.querySelector<HTMLElement>("p.error[data-error]")!;
    expect(error.textContent).toBe("Choose a colour.");
    expect(error.id).not.toBe("");
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(trigger.getAttribute("aria-describedby")).toBe(error.id);
    expect(field.hasAttribute("data-invalid")).toBe(true);
    const focused = await focusFirstInvalid(host);
    expect(focused).toBe(trigger);
    expect(root.activeElement).toBe(trigger);
    expect(el.matches(":focus")).toBe(true);
  });

  test("no error, no invalid mark and no paragraph", async () => {
    const { root, trigger, field } = await mountChooser();
    expect(root.querySelector("p.error")).toBeNull();
    expect(trigger.getAttribute("aria-invalid")).not.toBe("true");
    expect(trigger.hasAttribute("aria-describedby")).toBe(false);
    expect(field.hasAttribute("data-invalid")).toBe(false);
  });
});

describe("changing choices", () => {
  test("re-renders the open panel's tiles, and the checked tile follows value", async () => {
    const { el, tiles, tile } = await mountChooser();
    await openByClick(el);
    el.choices = [CHOICES[5]!, CHOICES[3]!, CHOICES[0]!];
    await el.updateComplete;
    expect(tiles().map((t) => t.dataset.value)).toEqual(["purple", "blue", "red"]);
    expect(tile("blue").getAttribute("aria-checked")).toBe("true");
    expect(tile("blue").getAttribute("tabindex")).toBe("0");
    el.value = "red";
    await el.updateComplete;
    expect(tile("red").getAttribute("aria-checked")).toBe("true");
    expect(tile("blue").getAttribute("aria-checked")).toBe("false");
    expect(tiles().filter((t) => t.getAttribute("tabindex") === "0")).toEqual([tile("red")]);
  });
});

function hostSetsValue(el: WtColourChooser) {
  const events: CustomEvent[] = [];
  el.addEventListener("wt-change", (event) => {
    events.push(event as CustomEvent);
    el.value = (event as CustomEvent<{ value: string }>).detail.value;
  });
  return events;
}

describe("keys in the open panel", () => {
  test("arrows, Home and End choose as they move, wrapping, one event each, and the panel stays open", async () => {
    const { el, root, panel, tile } = await mountChooser();
    const events = hostSetsValue(el);
    await openByClick(el);
    expect(root.activeElement).toBe(tile("blue"));
    const steps: [string, string][] = [
      ["{ArrowRight}", "green"],
      ["{ArrowDown}", "purple"],
      ["{ArrowDown}", "red"],
      ["{ArrowUp}", "purple"],
      ["{ArrowRight}", "red"],
      ["{ArrowLeft}", "purple"],
      ["{ArrowLeft}", "green"],
      ["{Home}", "red"],
      ["{End}", "purple"],
    ];
    for (const [key, value] of steps) {
      events.length = 0;
      await userEvent.keyboard(key);
      expect(events.map((event) => event.detail)).toEqual([{ value }]);
      expect(events[0]!.bubbles).toBe(true);
      expect(events[0]!.composed).toBe(true);
      await vi.waitFor(() => expect(root.activeElement).toBe(tile(value)));
      expect(tile(value).getAttribute("aria-checked")).toBe("true");
      expect(panel.matches(":popover-open")).toBe(true);
    }
  });

  test("Home on the first tile, already chosen, sends nothing and keeps focus there", async () => {
    const { el, root, panel, tile } = await mountChooser(
      'name="colour" label="Colour" value="red"',
    );
    const changes = vi.fn();
    el.addEventListener("wt-change", changes);
    const outside = vi.fn();
    host.addEventListener("keydown", outside);
    await openByClick(el);
    expect(root.activeElement).toBe(tile("red"));
    await userEvent.keyboard("{Home}");
    expect(changes).not.toHaveBeenCalled();
    expect(outside).not.toHaveBeenCalled();
    expect(root.activeElement).toBe(tile("red"));
    expect(panel.matches(":popover-open")).toBe(true);
  });

  test("an arrow press bubbles no keydown above the chooser", async () => {
    const { el } = await mountChooser();
    hostSetsValue(el);
    const outside = vi.fn();
    host.addEventListener("keydown", outside);
    await openByClick(el);
    await userEvent.keyboard("{ArrowRight}");
    expect(outside).not.toHaveBeenCalled();
  });

  test("controlled: when the host does not set value, the field keeps the old colour", async () => {
    const { el, trigger, tile } = await mountChooser();
    const changes: unknown[] = [];
    el.addEventListener("wt-change", (event) => changes.push((event as CustomEvent).detail));
    await openByClick(el);
    await userEvent.keyboard("{ArrowRight}");
    await el.updateComplete;
    expect(changes).toEqual([{ value: "green" }]);
    expect(trigger.textContent).toContain("Blue");
    expect(trigger.textContent).not.toContain("Green");
    expect(tile("blue").getAttribute("aria-checked")).toBe("true");
    expect(tile("green").getAttribute("aria-checked")).toBe("false");
  });

  test("the focused checked tile shows the focus ring after a keyboard move", async () => {
    const { el, root, tile } = await mountChooser();
    hostSetsValue(el);
    await openByClick(el);
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(root.activeElement).toBe(tile("green")));
    expect(tile("green").getAttribute("aria-checked")).toBe("true");
    expect(tile("green").matches(":focus-visible")).toBe(true);
    expect(getComputedStyle(tile("green")).outlineStyle).not.toBe("none");
    // The checked mark itself draws no outline, so the outline above is the focus ring.
    tile("amber").focus();
    expect(tile("green").matches(":focus")).toBe(false);
    expect(getComputedStyle(tile("green")).outlineStyle).toBe("none");
    expect(getComputedStyle(tile("green")).boxShadow).not.toBe("none");
    expect(getComputedStyle(tile("amber")).boxShadow).toBe("none");
  });
});

describe("Escape", () => {
  test("closes the panel, returns focus to the trigger, and goes no further", async () => {
    const { el, root, trigger, panel } = await mountChooser();
    const outside: KeyboardEvent[] = [];
    host.addEventListener("keydown", (event) => outside.push(event));
    let seen: KeyboardEvent | undefined;
    panel.addEventListener("keydown", (event) => (seen = event), { capture: true });
    await openByClick(el);
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(panel.matches(":popover-open")).toBe(false));
    expect(root.activeElement).toBe(trigger);
    expect(outside).toEqual([]);
    expect(seen?.key).toBe("Escape");
    expect(seen?.defaultPrevented).toBe(true);
  });

  test("inside a guarded modal, the first Escape closes only the panel and the second reaches the modal", async () => {
    host?.remove();
    const modal = (await mount(
      `<wt-modal open size="compact"><wt-colour-chooser name="colour" label="Colour" value="blue"></wt-colour-chooser></wt-modal>`,
    )) as HTMLElement & { open: boolean; beforeClose?: () => Promise<boolean> };
    const guard = vi.fn(() => Promise.resolve(true));
    modal.beforeClose = guard;
    const el = modal.querySelector("wt-colour-chooser")!;
    el.choices = CHOICES;
    await el.updateComplete;
    const { root, trigger, panel } = parts(el);
    await openByClick(el);
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(panel.matches(":popover-open")).toBe(false));
    expect(root.activeElement).toBe(trigger);
    expect(guard).not.toHaveBeenCalled();
    expect(modal.open).toBe(true);
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(modal.open).toBe(false));
    expect(guard).toHaveBeenCalledTimes(1);
  });
});

describe("leaving the panel", () => {
  test("a real click outside closes the panel and leaves focus where it was clicked", async () => {
    host?.remove();
    // The input sits above the chooser, where the panel that opens below it cannot cover it.
    await mount(
      `<div><input name="other" /><wt-colour-chooser style="margin-top: 80px" name="colour" label="Colour" value="blue"></wt-colour-chooser></div>`,
    );
    const el = host.querySelector("wt-colour-chooser")!;
    el.choices = CHOICES;
    await el.updateComplete;
    const other = host.querySelector("input")!;
    const { panel } = parts(el);
    await openByClick(el);
    await userEvent.click(other);
    await vi.waitFor(() => expect(panel.matches(":popover-open")).toBe(false));
    expect(document.activeElement).toBe(other);
  });

  test("Tab from the checked tile moves focus out of the chooser and closes the panel", async () => {
    host?.remove();
    const el = (await mount(
      `<wt-colour-chooser name="colour" label="Colour" value="blue"></wt-colour-chooser><input name="other" />`,
    )) as WtColourChooser;
    el.choices = CHOICES;
    await el.updateComplete;
    const other = host.querySelector("input")!;
    const { root, panel, tile } = parts(el);
    await openByClick(el);
    expect(root.activeElement).toBe(tile("blue"));
    await userEvent.keyboard("{Tab}");
    await vi.waitFor(() => expect(panel.matches(":popover-open")).toBe(false));
    expect(document.activeElement).toBe(other);
  });
});

describe("keys on the closed trigger", () => {
  for (const key of ["{ArrowDown}", "{ArrowUp}", "{Enter}", " "]) {
    test(`${key === " " ? "Space" : key} opens the panel on the checked tile`, async () => {
      const { root, trigger, panel, tile } = await mountChooser();
      trigger.focus();
      await userEvent.keyboard(key);
      await vi.waitFor(() => expect(panel.matches(":popover-open")).toBe(true));
      await vi.waitFor(() => expect(root.activeElement).toBe(tile("blue")));
      // The keyup of the key that opened it must not choose and close.
      expect(panel.matches(":popover-open")).toBe(true);
    });
  }
});

describe("position", () => {
  test("before the first painted frame the panel's top is at the trigger's bottom and its left at the trigger's left", async () => {
    const { el, trigger, panel } = await mountChooser();
    el.style.marginTop = "120px";
    el.style.marginLeft = "16px";
    el.style.width = "200px";
    const firstFrame = new Promise<DOMRect>((resolve) => {
      trigger.addEventListener(
        "click",
        () => requestAnimationFrame(() => resolve(panel.getBoundingClientRect())),
        { once: true },
      );
    });
    await userEvent.click(trigger);
    const bounds = await firstFrame;
    const anchor = trigger.getBoundingClientRect();
    // Room on the right, so the left edge is seen aligned rather than pulled in by the gutter.
    expect(anchor.left + bounds.width).toBeLessThanOrEqual(innerWidth - 8);
    expect(bounds.top).toBeCloseTo(anchor.bottom, 0);
    expect(bounds.left).toBeCloseTo(anchor.left, 0);
    expect(bounds.width).toBeGreaterThanOrEqual(anchor.width - 0.5);
  });

  test("near the bottom right of a 390px window the open panel stays inside it with an 8px margin", async () => {
    const [width, height] = [innerWidth, innerHeight];
    await page.viewport(390, 700);
    try {
      expect(window.innerWidth).toBe(390);
      const { el, panel } = await mountChooser();
      el.style.cssText = "position: fixed; right: 8px; bottom: 8px; width: 160px";
      await openByClick(el);
      const box = panel.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(8 - 0.5);
      expect(box.top).toBeGreaterThanOrEqual(8 - 0.5);
      expect(box.right).toBeLessThanOrEqual(innerWidth - 8 + 0.5);
      expect(box.bottom).toBeLessThanOrEqual(innerHeight - 8 + 0.5);
    } finally {
      await page.viewport(width, height);
    }
  });
});
