import { afterEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import "../index.js";

afterEach(cleanup);

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

test("supports native activation and disables it when asked", async () => {
  const tile = await mount('<wt-choice-tile label="Items"></wt-choice-tile>');
  const button = tile.shadowRoot?.querySelector("button");
  expect(button).toBeInstanceOf(HTMLButtonElement);
  const pressed = vi.fn();
  tile.addEventListener("click", pressed);
  await userEvent.click(button!);
  expect(pressed).toHaveBeenCalledOnce();
  await userEvent.keyboard("{Enter}");
  expect(pressed).toHaveBeenCalledTimes(2);

  tile.setAttribute("disabled", "");
  await (tile as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(button!.disabled).toBe(true);
  button!.click();
  expect(pressed).toHaveBeenCalledTimes(2);
});
