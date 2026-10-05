import { expect, test, afterEach } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "./wt-switch.js";

afterEach(cleanup);

test("forwards a semantic name and keeps unnamed switches unnamed", async () => {
  const el = await mount('<wt-switch name="printer-active"></wt-switch>');
  const input = el.shadowRoot!.querySelector("input")!;
  expect(input.name).toBe("printer-active");
  el.setAttribute("name", "ticketScope");
  await (el as import("./wt-switch.js").WtSwitch).updateComplete;
  expect(input.name).toBe("ticketScope");
  el.removeAttribute("name");
  await (el as import("./wt-switch.js").WtSwitch).updateComplete;
  expect(input.hasAttribute("name")).toBe(false);
});

test("renders its label", async () => {
  const el = await mount('<wt-switch label="Modo formación"></wt-switch>');
  expect(el.shadowRoot!.querySelector("label")?.textContent?.trim()).toBe("Modo formación");
});

test("gives each instance a unique id so labels never collide", async () => {
  const a = await mount('<wt-switch label="Modo formación"></wt-switch>');
  const b = await mount('<wt-switch label="Modo entrenamiento"></wt-switch>');
  const inputA = a.shadowRoot!.querySelector("input")!;
  const inputB = b.shadowRoot!.querySelector("input")!;
  const label = a.shadowRoot!.querySelector("label")!;
  expect(inputA.id).not.toBe(inputB.id);
  expect(inputA.id).toMatch(/^wt-switch-\d+$/);
  expect(inputB.id).toMatch(/^wt-switch-\d+$/);
  expect(label.htmlFor).toBe(inputA.id);
});

test("exposes checked state to assistive technology", async () => {
  const el = await mount("<wt-switch checked></wt-switch>");
  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  expect(input.getAttribute("role")).toBe("switch");
  expect(input.checked).toBe(true);
});

test("emits wt-change with the new checked state", async () => {
  const el = await mount("<wt-switch></wt-switch>");
  let received: boolean | undefined;
  el.addEventListener("wt-change", (e) => {
    received = (e as CustomEvent<{ checked: boolean }>).detail.checked;
  });

  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  input.click();

  expect(received).toBe(true);
});

test("wt-change bubbles and crosses shadow boundaries, so an ancestor outside a wrapping shadow root receives it", async () => {
  const el = await mountInShadowRoot("<wt-switch></wt-switch>");
  let received: CustomEvent<{ checked: boolean }> | undefined;
  document.addEventListener(
    "wt-change",
    (e) => {
      received = e as CustomEvent<{ checked: boolean }>;
    },
    { once: true },
  );

  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  input.click();

  expect(received?.detail.checked).toBe(true);
});

test("does not leak the native change event outside the component", async () => {
  const el = await mount("<wt-switch></wt-switch>");
  let native = 0;
  host.addEventListener("change", () => native++);

  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  // Composed on purpose: a real click's native `change` is not composed, so it could never leak and
  // the assertion would pass whatever the component does.
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

  expect(native).toBe(0);
});

test("clicking the visible label toggles the switch", async () => {
  const el = (await mount('<wt-switch label="Modo formación"></wt-switch>')) as HTMLElement & {
    checked: boolean;
  };
  const label = el.shadowRoot!.querySelector("label")!;
  label.click();
  expect(el.checked).toBe(true);
});

test("checked track paints from the primary token", async () => {
  const el = await mount("<wt-switch checked></wt-switch>");
  host.style.setProperty("--wt-color-primary", "rgb(16, 17, 18)");
  const track = el.shadowRoot!.querySelector(".track")!;
  expect(getComputedStyle(track).backgroundColor).toBe("rgb(16, 17, 18)");
});

test("disabled switch dims via the disabled-opacity token", async () => {
  // wt-switch dims the host itself, not an inner element.
  const el = await mount("<wt-switch disabled></wt-switch>");
  host.style.setProperty("--wt-opacity-disabled", "0.3");
  expect(getComputedStyle(el).opacity).toBe("0.3");
});

test("meets the minimum tap target on both axes", async () => {
  const el = await mount("<wt-switch></wt-switch>");
  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  const rect = input.getBoundingClientRect();
  expect(rect.height).toBeGreaterThanOrEqual(44);
  expect(rect.width).toBeGreaterThanOrEqual(44);
});

test("focusing the host delegates focus to the inner input", async () => {
  const el = await mount("<wt-switch></wt-switch>");
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector("input"));
});

test("the input's hit target does not extend beyond the host's bounds", async () => {
  // An input overflowing its host steals clicks from whatever sits below the switch.
  const el = await mount("<wt-switch></wt-switch>");
  const input = el.shadowRoot!.querySelector("input") as HTMLInputElement;
  const hostRect = el.getBoundingClientRect();
  const inputRect = input.getBoundingClientRect();
  expect(inputRect.top).toBeGreaterThanOrEqual(hostRect.top);
  expect(inputRect.bottom).toBeLessThanOrEqual(hostRect.bottom);
  expect(inputRect.left).toBeGreaterThanOrEqual(hostRect.left);
  expect(inputRect.right).toBeLessThanOrEqual(hostRect.right);
});

test("a switch with no label renders no label text and no aria-label attribute", async () => {
  const el = await mount("<wt-switch></wt-switch>");
  const input = el.shadowRoot!.querySelector("input")!;
  expect(el.shadowRoot!.querySelector("label")).toBeNull();
  expect(input.hasAttribute("aria-label")).toBe(false);
});

test("names the switch for assistive technology with its own label text", async () => {
  const el = await mount('<wt-switch label="Modo formación"></wt-switch>');
  const input = el.shadowRoot!.querySelector("input")!;
  expect(input.getAttribute("aria-label")).toBe("Modo formación");
});

test("can name its control for one row while keeping the shared column label", async () => {
  const el = await mount(
    '<wt-switch label="Disponible" accessible-name="Media" hide-label></wt-switch>',
  );
  const input = el.shadowRoot!.querySelector("input")!;
  expect(el.getAttribute("label")).toBe("Disponible");
  expect(input.getAttribute("aria-label")).toBe("Media");
  expect(el.shadowRoot!.querySelector("label")).toBeNull();
});

test("a switch given no name leaves its native input unnamed", async () => {
  const el = await mount("<wt-switch></wt-switch>");
  expect(el.shadowRoot!.querySelector("input")!.hasAttribute("name")).toBe(false);
});

test("a hidden label still names the switch but draws no text beside it", async () => {
  const el = await mount('<wt-switch label="Disponible" hide-label></wt-switch>');
  const input = el.shadowRoot!.querySelector("input")!;
  expect(input.getAttribute("aria-label")).toBe("Disponible");
  expect(el.shadowRoot!.querySelector("label")).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain("Disponible");
  // Only the control is left, so the switch takes no more room than its own tap target.
  const tap = parseFloat(getComputedStyle(el).minWidth);
  expect(el.getBoundingClientRect().width).toBeLessThanOrEqual(tap);
});

function baselineOf(parent: Element): number {
  const mark = document.createElement("span");
  mark.style.cssText = "display: inline-block; width: 0; height: 0";
  parent.append(mark);
  const top = mark.getBoundingClientRect().top;
  mark.remove();
  return top;
}

test("its baseline is its label's text, so a row aligned by baseline lines the label up", async () => {
  await mount(
    '<div style="display: flex; align-items: baseline"><span>Bacon</span><wt-switch label="Preselected"></wt-switch></div>',
  );
  const row = host.firstElementChild!;
  const label = row.querySelector("wt-switch")!.shadowRoot!.querySelector("label")!;
  expect(baselineOf(label)).toBe(baselineOf(row.querySelector("span")!));
});

test("exposes its drawn label as the label part, so a host can hide the text and keep the name", async () => {
  const outer = document.createElement("div");
  document.body.append(outer);
  try {
    const shadow = outer.attachShadow({ mode: "open" });
    shadow.innerHTML =
      '<style>wt-switch::part(label) { display: none; }</style><wt-switch label="Preselected"></wt-switch>';
    const el = shadow.querySelector("wt-switch")! as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("label")!.getClientRects()).toHaveLength(0);
    expect(el.shadowRoot!.querySelector("input")!.getAttribute("aria-label")).toBe("Preselected");
  } finally {
    outer.remove();
  }
});

type Switch = HTMLElement & { checked: boolean; updateComplete: Promise<unknown> };

function countChanges(el: Element): { count: number } {
  const seen = { count: 0 };
  el.addEventListener("wt-change", () => seen.count++);
  return seen;
}

/** A point inside the switch, given relative to the host's top-left corner, as a real pointer
 * click takes it. */
function inside(el: Element, part: Element, where: (box: DOMRect) => { x: number; y: number }) {
  const hostBox = el.getBoundingClientRect();
  const point = where(part.getBoundingClientRect());
  return { x: point.x - hostBox.left, y: point.y - hostBox.top };
}

const partOf = (el: Element, selector: string) => el.shadowRoot!.querySelector(selector)!;

test.each([
  [
    "the thumb",
    ".thumb",
    (box: DOMRect) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 }),
  ],
  [
    "the uncovered track",
    ".track",
    (box: DOMRect) => ({ x: box.right - 2, y: box.top + box.height / 2 }),
  ],
  [
    "the gap before the label",
    "label",
    (box: DOMRect) => ({ x: box.left - 2, y: box.top + box.height / 2 }),
  ],
  [
    "the label's text",
    "label",
    (box: DOMRect) => ({ x: box.left + 4, y: box.top + box.height / 2 }),
  ],
  ["the space above the label", "label", (box: DOMRect) => ({ x: box.left + 4, y: box.top - 2 })],
])("a real click on %s flips the switch exactly once", async (_name, selector, where) => {
  const el = (await mount('<wt-switch label="Preselected"></wt-switch>')) as Switch;
  const changes = countChanges(el);

  await userEvent.click(el, { position: inside(el, partOf(el, selector), where) });
  await el.updateComplete;

  expect(el.checked).toBe(true);
  expect(changes.count).toBe(1);
});

test("a real click on the thumb of a switch with a hidden label flips it exactly once", async () => {
  const el = (await mount('<wt-switch label="Active" hide-label></wt-switch>')) as Switch;
  const changes = countChanges(el);

  await userEvent.click(el, {
    position: inside(el, partOf(el, ".thumb"), (box) => ({
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    })),
  });
  await el.updateComplete;

  expect(el.checked).toBe(true);
  expect(changes.count).toBe(1);
});

test("a click in the gap reaches a bubbling listener above the switch as one click, not two", async () => {
  const el = (await mount('<wt-switch label="Preselected"></wt-switch>')) as Switch;
  let clicks = 0;
  host.addEventListener("click", () => clicks++);

  await userEvent.click(el, {
    position: inside(el, partOf(el, "label"), (box) => ({
      x: box.left - 2,
      y: box.top + box.height / 2,
    })),
  });

  expect(clicks).toBe(1);
});

test("a disabled switch does not flip from a click in its gap or on its thumb", async () => {
  const el = (await mount('<wt-switch label="Preselected" disabled></wt-switch>')) as Switch;
  const changes = countChanges(el);

  for (const [selector, where] of [
    ["label", (box: DOMRect) => ({ x: box.left - 2, y: box.top + box.height / 2 })],
    [".thumb", (box: DOMRect) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 })],
  ] as const) {
    await userEvent.click(el, { position: inside(el, partOf(el, selector), where), force: true });
  }
  await el.updateComplete;

  expect(el.checked).toBe(false);
  expect(changes.count).toBe(0);
});

test("a click in a disabled switch's gap or on its thumb still reaches the page, once per click", async () => {
  const el = (await mount('<wt-switch label="Preselected" disabled></wt-switch>')) as Switch;
  let clicks = 0;
  host.addEventListener("click", () => clicks++);

  for (const [i, [selector, where]] of (
    [
      ["label", (box: DOMRect) => ({ x: box.left - 2, y: box.top + box.height / 2 })],
      [".thumb", (box: DOMRect) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 })],
    ] as const
  ).entries()) {
    await userEvent.click(el, { position: inside(el, partOf(el, selector), where), force: true });
    expect(clicks).toBe(i + 1);
  }
  await el.updateComplete;

  expect(clicks).toBe(2);
  expect(el.checked).toBe(false);
});

test("the label shows a pointer on an enabled switch and the not-allowed cursor on a disabled one", async () => {
  const enabled = await mount('<wt-switch label="Active"></wt-switch>');
  const disabled = await mount('<wt-switch label="Preselected" disabled></wt-switch>');

  expect(getComputedStyle(partOf(enabled, "label")).cursor).toBe("pointer");
  expect(getComputedStyle(partOf(disabled, "label")).cursor).toBe("not-allowed");
});

test("a click in one switch's gap leaves the switch beside it alone, and a click between them flips neither", async () => {
  await mount(
    '<div style="display: flex; gap: 24px"><wt-switch label="Active"></wt-switch><wt-switch label="Preselected"></wt-switch></div>',
  );
  const [first, second] = [...host.querySelectorAll("wt-switch")] as Switch[];
  const changes = [countChanges(first), countChanges(second)];

  await userEvent.click(first, {
    position: inside(first, partOf(first, "label"), (box) => ({
      x: box.left - 2,
      y: box.top + box.height / 2,
    })),
  });
  await userEvent.click(host.firstElementChild!, {
    position: {
      x:
        (first.getBoundingClientRect().right + second.getBoundingClientRect().left) / 2 -
        host.getBoundingClientRect().left,
      y: first.getBoundingClientRect().height / 2,
    },
  });
  await first.updateComplete;

  expect([first.checked, second.checked]).toEqual([true, false]);
  expect(changes.map((c) => c.count)).toEqual([1, 0]);
});

test("Space on the focused switch flips it exactly once", async () => {
  const el = (await mount('<wt-switch label="Preselected"></wt-switch>')) as Switch;
  const changes = countChanges(el);

  el.focus();
  await userEvent.keyboard(" ");
  await el.updateComplete;

  expect(el.checked).toBe(true);
  expect(changes.count).toBe(1);
});

test("a switch stretched wider than its label does not flip from a click in the empty space past the label", async () => {
  await mount(
    '<div style="display: flex; flex-direction: column; width: 400px"><wt-switch label="Active"></wt-switch></div>',
  );
  const el = host.querySelector("wt-switch") as Switch;
  const changes = countChanges(el);
  const labelRight = partOf(el, "label").getBoundingClientRect().right;
  const hostBox = el.getBoundingClientRect();
  // The column stretches the switch across the whole width, past its drawn label.
  expect(hostBox.right - labelRight).toBeGreaterThan(100);

  await userEvent.click(el, { position: { x: hostBox.width - 20, y: hostBox.height / 2 } });
  await el.updateComplete;

  expect(el.checked).toBe(false);
  expect(changes.count).toBe(0);
});

test("a real click on the thumb of a switch that is on turns it off exactly once", async () => {
  const el = (await mount('<wt-switch label="Active" checked></wt-switch>')) as Switch;
  const changes = countChanges(el);

  await userEvent.click(el, {
    position: inside(el, partOf(el, ".thumb"), (box) => ({
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    })),
  });
  await el.updateComplete;

  expect(el.checked).toBe(false);
  expect(changes.count).toBe(1);
});
