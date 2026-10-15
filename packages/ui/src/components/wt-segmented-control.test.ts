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
