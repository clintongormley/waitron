/// <reference types="@vitest/browser-playwright" />
import { afterEach, expect, test, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { cleanup, mount } from "../test-helpers.js";
import type { WtModal } from "./wt-modal.js";
import "./wt-modal.js";

let tall: HTMLElement | undefined;
afterEach(async () => {
  cleanup();
  tall?.remove();
  tall = undefined;
  window.scrollTo(0, 0);
  // Without this pause, later cases passed with the fix removed: a wheel sent soon after the last
  // case's can go where that one went.
  await new Promise((resolve) => setTimeout(resolve, 1000));
});

function makePageTall(): void {
  tall = document.createElement("div");
  tall.style.height = "4000px";
  document.body.appendChild(tall);
  window.scrollTo(0, 0);
}

/** Sends a real mouse wheel at `point`, which is in this test frame's coordinates. */
async function wheelAt(point: { x: number; y: number }): Promise<void> {
  const frame = window.frameElement!.getBoundingClientRect();
  const scale = frame.width / window.innerWidth;
  const x = frame.left + point.x * scale;
  const y = frame.top + point.y * scale;
  const session = cdp();
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x,
    y,
    deltaX: 0,
    deltaY: 400,
  });
}

/** A wheel that did scroll has done so well within this; the probe saw 400px after it. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 400));

async function openModal(body: string): Promise<WtModal> {
  const modal = (await mount(
    `<wt-modal heading="Delete printer?" size="compact" fixed-heading>${body}</wt-modal>`,
  )) as WtModal;
  modal.open = true;
  await modal.updateComplete;
  return modal;
}

function centre(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

test("a wheel scrolls the tall page while no window is open", async () => {
  await page.viewport(390, 844);
  makePageTall();
  await wheelAt({ x: 20, y: 20 });
  await vi.waitFor(() => expect(window.scrollY).toBeGreaterThan(0));
});

test.each([
  ["short", "Short body."],
  ["tall", `<div style="height: 3000px">Long body</div>`],
])("with a %s window open, a wheel over its backdrop leaves the page still", async (_, body) => {
  await page.viewport(390, 844);
  makePageTall();
  await openModal(body);
  await wheelAt({ x: 20, y: 20 });
  await settle();
  expect(window.scrollY).toBe(0);
});

test.each([".header", ".body"])(
  "with a short window open, a wheel over its %s leaves the page still",
  async (part) => {
    await page.viewport(390, 844);
    makePageTall();
    const modal = await openModal("Short body.");
    const target = modal.shadowRoot!.querySelector(part)!;
    await wheelAt(centre(target.getBoundingClientRect()));
    await settle();
    expect(window.scrollY).toBe(0);
  },
);

test("with a tall window open, a wheel over its body scrolls the body and leaves the page still", async () => {
  await page.viewport(390, 844);
  makePageTall();
  const modal = await openModal(`<div style="height: 3000px">Long body</div>`);
  const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
  await wheelAt(centre(body.getBoundingClientRect()));
  await vi.waitFor(() => expect(body.scrollTop).toBeGreaterThan(0));
  await settle();
  expect(window.scrollY).toBe(0);
});
