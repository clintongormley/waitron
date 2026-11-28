import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import "../index.js";

afterEach(cleanup);

test("selected pills use the dark fill and keep a native pressed state without a check", async () => {
  const tile = await mount(
    '<wt-choice-tile variant="pill" label="Bill 2" selected></wt-choice-tile>',
  );
  host.style.setProperty("--wt-color-text", "rgb(25, 35, 45)");
  host.style.setProperty("--wt-color-surface", "rgb(245, 244, 243)");
  const button = tile.shadowRoot!.querySelector("button")!;
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(tile.shadowRoot!.querySelector("[part=check]")).toBeNull();
  expect(getComputedStyle(button).backgroundColor).toBe("rgb(25, 35, 45)");
  expect(getComputedStyle(button).color).toBe("rgb(245, 244, 243)");
});

test("reserves the leading check column and paints selection with the shared tokens", async () => {
  const tile = await mount(
    '<wt-choice-tile label="Whole bill" hint="€80.52" check-position="start"></wt-choice-tile>',
  );
  host.style.setProperty("--wt-color-surface-lifted", "rgb(211, 233, 241)");
  host.style.setProperty("--wt-color-primary", "rgb(15, 117, 120)");
  host.style.setProperty("--wt-color-primary-text", "rgb(17, 90, 100)");
  const button = tile.shadowRoot?.querySelector("button");
  expect(button).toBeInstanceOf(HTMLButtonElement);
  const mark = tile.shadowRoot!.querySelector<HTMLElement>("[part=check]")!;
  const label = tile.shadowRoot!.querySelector<HTMLElement>("[part=label]")!;
  expect(button!.getBoundingClientRect().height).toBe(56);
  expect(mark.getBoundingClientRect().width).toBe(22);
  expect(mark.getBoundingClientRect().right).toBeLessThan(label.getBoundingClientRect().left);
  expect(button!.getAttribute("aria-pressed")).toBe("false");
  expect(mark.querySelector("wt-icon")).toBeNull();

  tile.setAttribute("selected", "");
  await (tile as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(button!.getAttribute("aria-pressed")).toBe("true");
  expect(getComputedStyle(button!).backgroundColor).toBe("rgb(211, 233, 241)");
  expect(getComputedStyle(button!).borderInlineStartColor).toBe("rgb(15, 117, 120)");
  expect(getComputedStyle(button!).borderInlineStartWidth).toBe("2px");
  const icon = mark.querySelector("wt-icon")!;
  expect(icon.shadowRoot?.querySelector("path")).toBeInstanceOf(SVGPathElement);
  expect(getComputedStyle(icon).color).toBe("rgb(17, 90, 100)");
});

test("shows the selected mark after the payment hint and omits an empty hint", async () => {
  const tile = await mount(
    '<wt-choice-tile label="Whole bill" hint="€80.52" selected></wt-choice-tile>',
  );
  const hint = tile.shadowRoot!.querySelector("[part=hint]")!;
  const marks = tile.shadowRoot!.querySelectorAll("[part=check]");
  expect(hint?.textContent).toBe("€80.52");
  expect(hint).toBeVisible();
  expect(marks).toHaveLength(1);
  const mark = marks[0]!;
  expect(mark.querySelector("wt-icon")?.shadowRoot?.querySelector("path")).toBeInstanceOf(
    SVGPathElement,
  );
  expect(mark.getBoundingClientRect().left).toBeGreaterThanOrEqual(
    hint.getBoundingClientRect().right,
  );

  tile.setAttribute("hint", "");
  await (tile as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(tile.shadowRoot!.querySelector("[part=hint]")).toBeNull();
});

test("supports native activation and disables it when asked", async () => {
  const tile = await mount('<wt-choice-tile label="Items"></wt-choice-tile>');
  const button = tile.shadowRoot?.querySelector("button");
  expect(button).toBeInstanceOf(HTMLButtonElement);
  const pressed = vi.fn();
  tile.addEventListener("click", pressed);
  tile.focus();
  expect(tile.shadowRoot!.activeElement).toBe(button);
  await userEvent.keyboard("{Enter}");
  expect(pressed).toHaveBeenCalledOnce();
  await userEvent.click(button!);
  expect(pressed).toHaveBeenCalledTimes(2);

  tile.setAttribute("disabled", "");
  await (tile as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(button!.disabled).toBe(true);
  await userEvent.click(tile, { force: true });
  expect(pressed).toHaveBeenCalledTimes(2);
});

test("an immediate choice names the action without announcing a toggle state", async () => {
  const tile = await mount(
    '<wt-choice-tile label="Table 9" hint="Free" check-position="none"></wt-choice-tile>',
  );
  const action = tile.shadowRoot!.querySelector("button")!;
  expect(action.hasAttribute("aria-pressed")).toBe(false);
  const hint = tile.shadowRoot!.querySelector("[part=hint]")!;
  const inset = action.getBoundingClientRect().right - hint.getBoundingClientRect().right;
  expect(inset).toBeLessThanOrEqual(16);
});
