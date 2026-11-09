import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount, mountInShadowRoot } from "../test-helpers.js";
import "../index.js";

afterEach(cleanup);
const options = [
  { value: "public", label: "Anyone" },
  { value: "staff_only", label: "Staff only" },
  { value: "not_sold_separately", label: "Nobody" },
];
async function setup(shadow = false) {
  const el = (await (shadow ? mountInShadowRoot : mount)(
    '<wt-segmented-control name="ordering" label="Ordered on its own by"></wt-segmented-control>',
  )) as HTMLElementTagNameMap["wt-segmented-control"];
  el.options = options;
  el.value = "public";
  await el.updateComplete;
  return el;
}
function buttons(el: HTMLElement) {
  return [...(el.shadowRoot?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])];
}

test("presents one selected option and a single Tab stop in a named radio group", async () => {
  const el = await setup();
  expect(buttons(el).map((button) => button.textContent!.trim())).toEqual([
    "Anyone",
    "Staff only",
    "Nobody",
  ]);
  expect(buttons(el).map((button) => button.getAttribute("aria-checked"))).toEqual([
    "true",
    "false",
    "false",
  ]);
  expect(buttons(el).map((button) => button.tabIndex)).toEqual([0, -1, -1]);
  const group = el.shadowRoot!.querySelector('[role="radiogroup"]')!;
  expect(group.getAttribute("aria-label")).toBe("Ordered on its own by");
  expect(el.name).toBe("ordering");
});

test("selecting a different option sends exactly one composed change and consumes the click", async () => {
  const el = await setup(true);
  const changes = vi.fn();
  const clicks = vi.fn();
  document.addEventListener("wt-change", changes);
  document.addEventListener("click", clicks);
  try {
    expect(buttons(el)).toHaveLength(3);
    await userEvent.click(buttons(el)[1]!);
    await userEvent.click(buttons(el)[1]!);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(changes.mock.calls[0]![0].detail).toEqual({ value: "staff_only" });
    expect(clicks).not.toHaveBeenCalled();
    expect(el.value).toBe("staff_only");
    expect(buttons(el).map((button) => button.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
  } finally {
    document.removeEventListener("wt-change", changes);
    document.removeEventListener("click", clicks);
  }
});

test.each([
  { key: "ArrowRight", value: "staff_only", index: 1 },
  { key: "ArrowDown", value: "staff_only", index: 1 },
  { key: "ArrowLeft", value: "not_sold_separately", index: 2 },
  { key: "ArrowUp", value: "not_sold_separately", index: 2 },
  { key: "End", value: "not_sold_separately", index: 2 },
  { key: "Home", value: "public", index: 0 },
])("$key selects and focuses $value", async ({ key, value, index }) => {
  const el = await setup();
  expect(buttons(el)).toHaveLength(3);
  if (key === "Home") el.value = "not_sold_separately";
  await el.updateComplete;
  const selected = buttons(el).find((button) => button.tabIndex === 0)!;
  selected.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, composed: true }));
  await el.updateComplete;
  expect(el.value).toBe(value);
  expect(el.shadowRoot!.activeElement).toBe(buttons(el)[index]);
  expect(buttons(el).filter((button) => button.tabIndex === 0)).toHaveLength(1);
});

test("disabled choices cannot change by click or keyboard", async () => {
  const el = await setup();
  el.disabled = true;
  await el.updateComplete;
  expect(buttons(el)).toHaveLength(3);
  expect(buttons(el).every((button) => button.disabled)).toBe(true);
  const changes = vi.fn();
  el.addEventListener("wt-change", changes);
  buttons(el)[1]!.click();
  buttons(el)[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
  expect(el.value).toBe("public");
  expect(changes).not.toHaveBeenCalled();
});

test("native Enter and Space choose a button without reaching a form's submit key handler", async () => {
  const el = await setup();
  const keys = vi.fn();
  el.addEventListener("keydown", keys);
  buttons(el)[1]!.focus();
  await userEvent.keyboard("{Enter}");
  await el.updateComplete;
  expect(el.value).toBe("staff_only");
  buttons(el)[2]!.focus();
  await userEvent.keyboard(" ");
  await el.updateComplete;
  expect(el.value).toBe("not_sold_separately");
  expect(keys).not.toHaveBeenCalled();
});

test("an unselected group offers its first choice to Tab and ignores unrelated keys", async () => {
  const el = await setup();
  el.value = "";
  await el.updateComplete;
  expect(buttons(el).map((button) => button.tabIndex)).toEqual([0, -1, -1]);
  buttons(el)[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(el.value).toBe("");
  el.value = "not_sold_separately";
  await el.updateComplete;
  buttons(el)[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  await el.updateComplete;
  expect(el.value).toBe("public");
});

test("shows the current hint and describes an invalid group with its error", async () => {
  const el = await setup();
  el.hint = "Only staff can order it on its own.";
  el.error = "Choose who can order this dish.";
  await el.updateComplete;
  expect(buttons(el)).toHaveLength(3);
  const group = el.shadowRoot!.querySelector('[role="radiogroup"]')!;
  expect(group.getAttribute("aria-invalid")).toBe("true");
  expect(
    group
      .getAttribute("aria-describedby")!
      .split(" ")
      .map((id) => el.shadowRoot!.getElementById(id)!.textContent!.trim()),
  ).toEqual(["Only staff can order it on its own.", "Choose who can order this dish."]);
  el.error = "";
  await el.updateComplete;
  expect(group.getAttribute("aria-invalid")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-error]")).toBeNull();
});

test("the selection, neutral options, border and hint paint from tokens", async () => {
  const el = await setup();
  expect(buttons(el)).toHaveLength(3);
  host.style.setProperty("--wt-color-primary", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-on-primary", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-surface", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-color-text", "rgb(10, 11, 12)");
  host.style.setProperty("--wt-color-border", "rgb(13, 14, 15)");
  const [selected, neutral] = buttons(el).map((button) => getComputedStyle(button));
  expect([selected!.backgroundColor, selected!.color]).toEqual(["rgb(1, 2, 3)", "rgb(4, 5, 6)"]);
  expect([neutral!.backgroundColor, neutral!.color, neutral!.borderTopColor]).toEqual([
    "rgb(7, 8, 9)",
    "rgb(10, 11, 12)",
    "rgb(13, 14, 15)",
  ]);
});

test.each(["public", "staff_only", "not_sold_separately", ""])(
  "programmatic focus reaches the selected %s choice or first fallback",
  async (value) => {
    const el = await setup();
    el.value = value;
    await el.updateComplete;
    el.focus({ preventScroll: true });
    const selected = buttons(el).find((button) => button.tabIndex === 0)!;
    expect(el.shadowRoot!.activeElement).toBe(selected);
  },
);

/** How many line boxes each word of `button`'s label is drawn across: 1 for a whole word. */
function wordLines(button: HTMLButtonElement): Record<string, number> {
  const lines: Record<string, number> = {};
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const word of node.textContent!.matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(node, word.index);
      range.setEnd(node, word.index + word[0].length);
      lines[word[0]] = range.getClientRects().length;
    }
  }
  return lines;
}
async function setupNarrow(width: number, labels: string[]) {
  const el = await setup();
  host.style.width = `${width}px`;
  el.options = labels.map((label, index) => ({ value: String(index), label }));
  el.value = "0";
  await el.updateComplete;
  return el;
}
const PASS_ES = ["Usar la configuración del perfil", "Mostrar", "Ocultar"];
const group = (el: HTMLElement) =>
  el.shadowRoot!.querySelector<HTMLElement>('[role="radiogroup"]')!;
/** Whether the choices have given up whole words to fit their space. */
const givenWay = (el: HTMLElement) => group(el).hasAttribute("data-squeezed");
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
/** The given-way state after each of several animation frames: one value means it has settled. */
async function statesOverFrames(el: HTMLElement): Promise<boolean[]> {
  const states: boolean[] = [];
  for (let i = 0; i < 5; i++) {
    await frame();
    states.push(givenWay(el));
  }
  return states;
}
function expectInsideControl(el: HTMLElement): void {
  expect(group(el).scrollWidth, "the row runs past the control").toBeLessThanOrEqual(
    group(el).clientWidth,
  );
  const right = el.getBoundingClientRect().right;
  for (const button of buttons(el)) {
    expect(button.getBoundingClientRect().right, button.textContent!.trim()).toBeLessThanOrEqual(
      right + 0.5,
    );
  }
}
function lineCount(button: HTMLButtonElement): number {
  const range = document.createRange();
  range.selectNodeContents(button);
  return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
}

test("a control too narrow for its labels on one line wraps them between words, never inside one", async () => {
  const el = await setupNarrow(300, ["Usar la configuración del perfil", "Mostrar", "Ocultar"]);
  const [profile, show, hide] = buttons(el);
  expect(lineCount(profile!), "the long label had to wrap").toBeGreaterThan(1);
  expect(wordLines(profile!)).toEqual({ Usar: 1, la: 1, configuración: 1, del: 1, perfil: 1 });
  expect(wordLines(show!)).toEqual({ Mostrar: 1 });
  expect(wordLines(hide!)).toEqual({ Ocultar: 1 });
  expect(group(el).scrollWidth).toBeLessThanOrEqual(group(el).clientWidth);
  expect(group(el).getBoundingClientRect().width, "the row fills the control").toBe(300);
  expect(givenWay(el), "whole words fit, so the choices have not given way").toBe(false);
});

test("a word wider than the whole control breaks inside itself rather than widen the control", async () => {
  const word = "Supercalifragilisticexpialidocious";
  const el = await setupNarrow(150, [word]);
  const [only] = buttons(el);
  expect(wordLines(only!)[word]).toBeGreaterThan(1);
  const box = el.getBoundingClientRect();
  expect(only!.getBoundingClientRect().right).toBeLessThanOrEqual(box.right);
  expect(only!.scrollWidth).toBeLessThanOrEqual(only!.clientWidth);
});

test("a one-letter choice in a host narrower than the tap target stays tap-target wide", async () => {
  const el = await setupNarrow(20, ["A", "B"]);
  expect(buttons(el)).toHaveLength(2);
  for (const button of buttons(el)) {
    expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
  }
});

test("when whole words cannot fit side by side, the choices break inside words rather than run past the control", async () => {
  const el = await setupNarrow(200, PASS_ES);
  expect(givenWay(el)).toBe(true);
  expectInsideControl(el);
  expect(group(el).getBoundingClientRect().width, "the row fills the control").toBe(200);
  for (const button of buttons(el)) {
    expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
  }
});

test("widening the space back brings whole words back, and each state then holds", async () => {
  const el = await setupNarrow(200, PASS_ES);
  expect(givenWay(el)).toBe(true);
  host.style.width = "300px";
  await expect.poll(() => givenWay(el)).toBe(false);
  expect(await statesOverFrames(el)).toEqual([false, false, false, false, false]);
  for (const button of buttons(el)) {
    expect(
      Object.values(wordLines(button)).every((lines) => lines === 1),
      button.textContent!,
    ).toBe(true);
  }
  expectInsideControl(el);

  host.style.width = "200px";
  await expect.poll(() => givenWay(el)).toBe(true);
  expect(await statesOverFrames(el)).toEqual([true, true, true, true, true]);
  expectInsideControl(el);
});

test("new labels are measured again", async () => {
  const el = await setupNarrow(220, ["Sí", "No", "Quizá"]);
  expect(givenWay(el)).toBe(false);
  el.options = PASS_ES.map((label, index) => ({ value: String(index), label }));
  await el.updateComplete;
  expect(givenWay(el)).toBe(true);
  expectInsideControl(el);
  el.options = ["Sí", "No", "Quizá"].map((label, index) => ({ value: String(index), label }));
  await el.updateComplete;
  expect(givenWay(el)).toBe(false);
});

test("a larger text size is measured again", async () => {
  const el = await setupNarrow(300, PASS_ES);
  expect(givenWay(el)).toBe(false);
  host.style.setProperty("--wt-font-size-sm", "24px");
  await expect.poll(() => givenWay(el)).toBe(true);
  expectInsideControl(el);
  host.style.removeProperty("--wt-font-size-sm");
  await expect.poll(() => givenWay(el)).toBe(false);
});

test("a larger text size that leaves the control's height alone is measured again", async () => {
  const el = await setupNarrow(400, ["Rectas", "Estándar", "Redondeadas"]);
  el.label = "";
  await el.updateComplete;
  host.style.width = `${Math.ceil(group(el).getBoundingClientRect().width) + 2}px`;
  expect(await statesOverFrames(el), "whole words fit").toEqual([
    false,
    false,
    false,
    false,
    false,
  ]);
  const height = el.getBoundingClientRect().height;
  host.style.setProperty("--wt-font-size-sm", "14px");
  expect(el.getBoundingClientRect().height, "only the choices could report the change").toBe(
    height,
  );
  await expect.poll(() => givenWay(el)).toBe(true);
  expectInsideControl(el);
});

test("whole words do not widen a parent that sizes its column to its content", async () => {
  const el = await setup();
  host.style.display = "grid";
  host.style.width = "200px";
  el.options = PASS_ES.map((label, index) => ({ value: String(index), label }));
  await el.updateComplete;
  expect(givenWay(el)).toBe(true);
  expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(host.getBoundingClientRect().right);
  expectInsideControl(el);
  expect(await statesOverFrames(el)).toEqual([true, true, true, true, true]);
});

test("whole words give way when a parent that sizes its column to its content narrows", async () => {
  const el = await setup();
  host.style.display = "grid";
  host.style.width = "400px";
  el.options = ["Rectas", "Estándar", "Redondeadas"].map((label, index) => ({
    value: String(index),
    label,
  }));
  await el.updateComplete;
  expect(await statesOverFrames(el), "whole words fit").toEqual([
    false,
    false,
    false,
    false,
    false,
  ]);
  host.style.width = "150px";
  await expect.poll(() => givenWay(el)).toBe(true);
  expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(host.getBoundingClientRect().right);
  expectInsideControl(el);
});

test("whole words that exactly fill the space stay whole, and one pixel less gives way", async () => {
  const el = await setupNarrow(400, ["Rectas", "Estándar", "Redondeadas"]);
  const exact = group(el).getBoundingClientRect().width;
  host.style.width = `${exact}px`;
  expect(await statesOverFrames(el)).toEqual([false, false, false, false, false]);
  expectInsideControl(el);
  host.style.width = `${exact - 1}px`;
  await expect.poll(() => givenWay(el)).toBe(true);
  expectInsideControl(el);
});

test("a control out of the page is left alone, and measured again when it comes back", async () => {
  const el = await setupNarrow(200, PASS_ES);
  expect(givenWay(el)).toBe(true);
  el.remove();
  expect(await statesOverFrames(el), "nothing is measured out of the page").toEqual([
    true,
    true,
    true,
    true,
    true,
  ]);
  host.style.width = "400px";
  host.append(el);
  await expect.poll(() => givenWay(el)).toBe(false);
  expectInsideControl(el);
});

test("choosing does not measure the row again", async () => {
  const el = await setupNarrow(300, PASS_ES);
  await statesOverFrames(el);
  const measured = vi.spyOn(group(el), "getBoundingClientRect");
  await userEvent.click(buttons(el)[2]!);
  el.disabled = true;
  await el.updateComplete;
  await statesOverFrames(el);
  expect(el.value).toBe("2");
  expect(measured).not.toHaveBeenCalled();
});

test("hides a repeated visible label while keeping the group named and keyboard-operable", async () => {
  const el = await setup();
  el.setAttribute("hide-label", "");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector(".label")).toBeNull();
  expect(el.shadowRoot!.querySelector('[role="radiogroup"]')!.getAttribute("aria-label")).toBe(
    "Ordered on its own by",
  );
  buttons(el)[0]!.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(el.value).toBe("staff_only");
  expect(el.shadowRoot!.activeElement).toBe(buttons(el)[1]);
});
