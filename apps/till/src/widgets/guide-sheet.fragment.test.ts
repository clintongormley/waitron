import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { WtModal } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import "./guide-sheet.js";
import type { TillGuideSheet } from "./guide-sheet.js";

const originalLocale = currentLocale();
const urls: string[] = [];
let viewport = { width: 0, height: 0 };

beforeEach(() => {
  viewport = { width: window.innerWidth, height: window.innerHeight };
});

afterEach(async () => {
  cleanupWidgets();
  setLocale(originalLocale);
  for (const url of urls.splice(0)) URL.revokeObjectURL(url);
  await page.viewport(viewport.width, viewport.height);
});

/** A same-origin page whose `#far` section starts well below the first screen, as a guide's
 * section does. */
function guidePage(): string {
  const html = `<!doctype html><body style="margin:0">
    <p style="height:3000px">Top of the guide</p>
    <h2 id="far">A section far down</h2>
    <p style="height:3000px">More</p>
  </body>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  urls.push(url);
  return url;
}

async function openAt(href: string): Promise<{ sheet: TillGuideSheet; frame: HTMLIFrameElement }> {
  setLocale("en");
  const { el: sheet } = await mountWidget<TillGuideSheet>("till-guide-sheet", { href: "" });
  const modal = sheet.shadowRoot!.querySelector<WtModal>("wt-modal")!;
  sheet.href = href;
  await sheet.updateComplete;
  await modal.updateComplete;
  const frame = sheet.shadowRoot!.querySelector("iframe")!;
  await new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
  // The jump to a fragment, and any scrolling it asks of the page around the frame, land within a
  // few frames of the load.
  for (let i = 0; i < 5; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
  return { sheet, frame };
}

const partsOf = (sheet: TillGuideSheet) => {
  const root = sheet.shadowRoot!.querySelector<WtModal>("wt-modal")!.shadowRoot!;
  return {
    body: root.querySelector<HTMLElement>(".body")!,
    // The sheet's heading, wherever the sheet draws it: its own, or the modal's.
    heading: (sheet.shadowRoot!.querySelector<HTMLElement>("h2") ??
      root.querySelector<HTMLElement>("h2"))!,
  };
};

function expectHeadingWhole(sheet: TillGuideSheet): void {
  const { body, heading } = partsOf(sheet);
  expect(heading.textContent).toBe("Guide");
  expect(body.scrollTop).toBe(0);
  expect(heading.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    body.getBoundingClientRect().top,
  );
}

describe("the guide sheet opened at a section", () => {
  for (const [width, height] of [
    [1280, 900],
    [390, 844],
  ] as const) {
    it(`keeps its own heading in view at ${width} px while the page jumps to the section`, async () => {
      await page.viewport(width, height);
      const { sheet, frame } = await openAt(`${guidePage()}#far`);
      // The section was reached, so the page inside the frame did jump.
      expect(frame.contentWindow!.scrollY).toBeGreaterThan(2000);
      expectHeadingWhole(sheet);
    });
  }

  it("keeps its heading in view opened at the page's top, too", async () => {
    const { sheet, frame } = await openAt(guidePage());
    expect(frame.contentWindow!.scrollY).toBe(0);
    expectHeadingWhole(sheet);
  });

  it("gives the frame the rest of the sheet's body, with nothing left to scroll", async () => {
    const { sheet, frame } = await openAt(guidePage());
    const { body, heading } = partsOf(sheet);
    expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight);
    const room = body.getBoundingClientRect();
    const framed = frame.getBoundingClientRect();
    expect(framed.top).toBeGreaterThan(heading.getBoundingClientRect().bottom);
    expect(framed.bottom).toBeLessThanOrEqual(room.bottom);
    expect(framed.height).toBeGreaterThan(room.height / 2);
  });
});
