/// <reference types="@vitest/browser-playwright" />
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import type { WtDialog } from "./wt-dialog.js";
import "./wt-dialog.js";
import "./wt-modal.js";

afterEach(cleanup);

const WINDOWS = [
  ["a plain wt-dialog", "wt-dialog", ""],
  ["a default-size wt-modal", "wt-modal", ""],
  ["a compact wt-modal", "wt-modal", 'size="compact"'],
  ["a full-size wt-modal", "wt-modal", 'size="full"'],
] as const;

/** Opens a window with a body far taller than the page and a footer button. The mount helper's
 * host is a theme root, which declares the variables' 0px defaults, so they are set there, as the
 * till sets them on its own theme root. */
async function openTall(
  tag: string,
  attributes: string,
  keyboard: { inset?: string; top?: string },
): Promise<{ dialog: HTMLDialogElement; button: HTMLButtonElement }> {
  const el = (await mount(`<${tag} heading="Bill name" ${attributes}>
    <div style="height: 3000px">Long body</div>
    <button slot="footer">Save</button>
  </${tag}>`)) as WtDialog;
  if (keyboard.inset) host.style.setProperty("--wt-keyboard-inset", keyboard.inset);
  if (keyboard.top) host.style.setProperty("--wt-keyboard-top", keyboard.top);
  el.open = true;
  await el.updateComplete;
  return {
    dialog: el.shadowRoot!.querySelector("dialog")!,
    button: el.querySelector("button")!,
  };
}

test.each(WINDOWS)(
  "%s fits above a keyboard covering the bottom of the page, footer in view",
  async (_, tag, attributes) => {
    await page.viewport(1280, 640);
    const { dialog, button } = await openTall(tag, attributes, { inset: "384px" });
    const rect = dialog.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.bottom).toBeLessThanOrEqual(256);
    expect(button.getBoundingClientRect().bottom).toBeLessThanOrEqual(256);
    // The margin shrinks from 24px to 8px so the little room left goes to the window.
    expect(rect.top).toBeCloseTo(8, 0);
    expect(rect.bottom).toBeCloseTo(248, 0);
  },
);

test.each(WINDOWS)(
  "%s fits the visible area while it is panned down, footer in view",
  async (_, tag, attributes) => {
    await page.viewport(1280, 640);
    const { dialog, button } = await openTall(tag, attributes, { inset: "361px", top: "87px" });
    const rect = dialog.getBoundingClientRect();
    expect(rect.top).toBeGreaterThanOrEqual(87);
    expect(rect.bottom).toBeLessThanOrEqual(279);
    const footer = button.getBoundingClientRect();
    expect(footer.top).toBeGreaterThanOrEqual(87);
    expect(footer.bottom).toBeLessThanOrEqual(279);
  },
);

test("with no keyboard, a default-size wt-modal keeps its 24px margins", async () => {
  await page.viewport(1280, 640);
  const { dialog } = await openTall("wt-modal", "", {});
  const rect = dialog.getBoundingClientRect();
  expect(rect.height).toBeCloseTo(640 - 48, 0);
  expect(rect.top).toBeCloseTo(24, 0);
});

test("with no keyboard, a plain wt-dialog's height is the page less 24px margins", async () => {
  await page.viewport(1280, 640);
  const { dialog } = await openTall("wt-dialog", "", {});
  const rect = dialog.getBoundingClientRect();
  expect(rect.height).toBeCloseTo(640 - 48, 0);
  expect(rect.top).toBeCloseTo(24, 0);
});
