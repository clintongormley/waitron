import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import { WtModal } from "./wt-modal.js";
import "./wt-form-actions.js";
import "./wt-button.js";

afterEach(cleanup);

async function openModal(body = "Printer settings") {
  const modal = (await mount(`<wt-modal heading="Add printer">
    ${body}
    <wt-form-actions slot="footer">
      <wt-button slot="cancel" variant="secondary">Cancel</wt-button>
      <wt-button>Save</wt-button>
    </wt-form-actions>
  </wt-modal>`)) as WtModal;
  modal.open = true;
  await modal.updateComplete;
  return modal;
}

/** Resolves a length token (or any CSS length) to pixels at the current viewport. */
function px(length: string): number {
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.width = length;
  host.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

test.each([
  [1280, 900],
  [390, 844],
  [844, 390],
  [360, 740],
  [320, 568],
])("fits a %i × %i viewport with clear, equal margins", async (width, height) => {
  await page.viewport(width, height);
  try {
    expect(window.innerWidth).toBe(width);
    const modal = await openModal();
    const dialog = modal.shadowRoot!.querySelector("dialog")!;
    const rect = dialog.getBoundingClientRect();
    expect(dialog.matches(":modal")).toBe(true);
    expect(rect.top).toBeGreaterThanOrEqual(16);
    expect(rect.top).toBeLessThanOrEqual(32);
    expect(height - rect.bottom).toBeCloseTo(rect.top, 0);
    expect(width - rect.right).toBeCloseTo(rect.left, 0);
    const margin = px("var(--wt-modal-inline-margin)");
    expect(margin).toBeGreaterThanOrEqual(px("var(--wt-space-1)"));
    expect(rect.left).toBeGreaterThanOrEqual(margin - 0.5);
    // No 90vw cap: below the token's width the viewport minus the two side margins is the bound.
    expect(rect.width).toBeCloseTo(
      Math.min(px("var(--wt-modal-max-width)"), width - 2 * margin),
      0,
    );
  } finally {
    await page.viewport(1280, 900);
  }
});

test.each([320, 360, 390])("gives its width to the content on a %ipx-wide phone", async (width) => {
  await page.viewport(width, 800);
  try {
    expect(window.innerWidth).toBe(width);
    const modal = await openModal();
    const dialog = modal.shadowRoot!.querySelector("dialog")!;
    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    const footer = modal.shadowRoot!.querySelector<HTMLElement>(".footer")!;
    expect(dialog.getBoundingClientRect().left).toBeCloseTo(px("var(--wt-space-1)"), 0);
    for (const part of [body, footer]) {
      const style = getComputedStyle(part);
      expect(parseFloat(style.paddingLeft)).toBe(px("var(--wt-space-3)"));
      expect(parseFloat(style.paddingRight)).toBe(px("var(--wt-space-3)"));
    }
  } finally {
    await page.viewport(1280, 900);
  }
});

test.each([800, 1280])("keeps its full margins and padding at %ipx wide", async (width) => {
  await page.viewport(width, 900);
  try {
    expect(window.innerWidth).toBe(width);
    const modal = await openModal();
    const dialog = modal.shadowRoot!.querySelector("dialog")!;
    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    const footer = modal.shadowRoot!.querySelector<HTMLElement>(".footer")!;
    const space5 = px("var(--wt-space-5)");
    expect(width - dialog.getBoundingClientRect().right).toBeGreaterThanOrEqual(space5 - 0.5);
    for (const part of [body, footer]) {
      expect(parseFloat(getComputedStyle(part).paddingLeft)).toBe(space5);
      expect(parseFloat(getComputedStyle(part).paddingRight)).toBe(space5);
    }
  } finally {
    await page.viewport(1280, 900);
  }
});

test.each([
  [1280, 300, 490],
  [360, 280, 40],
])(
  "follows its width, margin and padding tokens at %ipx wide",
  async (width, expectedWidth, expectedLeft) => {
    await page.viewport(width, 900);
    try {
      expect(window.innerWidth).toBe(width);
      const modal = await openModal();
      host.style.setProperty("--wt-modal-max-width", "300px");
      host.style.setProperty("--wt-modal-inline-margin", "40px");
      host.style.setProperty("--wt-modal-inline-padding", "7px");
      const rect = modal.shadowRoot!.querySelector("dialog")!.getBoundingClientRect();
      expect(rect.width).toBeCloseTo(expectedWidth, 0);
      expect(rect.left).toBeCloseTo(expectedLeft, 0);
      for (const selector of [".body", ".footer"]) {
        const style = getComputedStyle(modal.shadowRoot!.querySelector(selector)!);
        expect(parseFloat(style.paddingLeft)).toBe(7);
        expect(parseFloat(style.paddingRight)).toBe(7);
      }
    } finally {
      await page.viewport(1280, 900);
    }
  },
);

test("scrolls long content while both footer actions stay visible and stationary", async () => {
  await page.viewport(390, 600);
  try {
    const modal = await openModal('<div style="height: 1800px">Long form</div>');
    const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
    const dialog = modal.shadowRoot!.querySelector("dialog")!;
    const cancel = modal.querySelector("wt-button")!;
    const save = modal.querySelectorAll("wt-button")[1]!;
    await save.updateComplete;
    const before = save.getBoundingClientRect();
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBeGreaterThan(0);
    expect(save.getBoundingClientRect().top).toBe(before.top);
    expect(before.bottom).toBeLessThan(dialog.getBoundingClientRect().bottom);
    expect(cancel.getBoundingClientRect().top).toBe(before.top);
    expect(cancel.getBoundingClientRect().right).toBeLessThan(before.left);
    expect(dialog.scrollHeight).toBe(dialog.clientHeight);
  } finally {
    await page.viewport(1280, 900);
  }
});

test("uses a white surface and a soft shadow in the light theme", async () => {
  const modal = await openModal();
  host.dataset.theme = "light";
  const style = getComputedStyle(modal.shadowRoot!.querySelector("dialog")!);
  expect(style.backgroundColor).toBe("rgb(255, 255, 255)");
  expect(style.boxShadow).not.toBe("none");
});

test("Escape closes the modal, emits wt-close and returns focus to its trigger", async () => {
  const modal = await openModal();
  const initiallyClosed = new Promise<void>((resolve) =>
    modal.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  modal.open = false;
  await modal.updateComplete;
  await initiallyClosed;
  const trigger = document.createElement("button");
  host.prepend(trigger);
  trigger.focus();
  modal.open = true;
  await modal.updateComplete;
  expect(document.activeElement).not.toBe(trigger);
  const closed = new Promise<void>((resolve) =>
    modal.addEventListener("wt-close", () => resolve(), { once: true }),
  );
  await userEvent.keyboard("{Escape}");
  await closed;
  expect(modal.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

test("keeps the body in the tab order, whether or not there is anything to scroll", async () => {
  // A reader who cannot focus the body cannot scroll it from the keyboard. Chromium makes a scrolling
  // text box focusable by itself, so the short modal is the case that shows the component doing it.
  // `tabIndex` is asserted because `.focus()` and showModal()'s initial focus both work at -1 too.
  const short = await openModal();
  const shortBody = short.shadowRoot!.querySelector<HTMLElement>(".body")!;
  expect(shortBody.tabIndex).toBe(0);
  expect(short.shadowRoot!.activeElement).toBe(shortBody);
  short.open = false;
  await short.updateComplete;

  const long = await openModal('<div style="height: 1800px">Long notice</div>');
  const longBody = long.shadowRoot!.querySelector<HTMLElement>(".body")!;
  expect(longBody.tabIndex).toBe(0);
  expect(long.shadowRoot!.activeElement).toBe(longBody);
  await userEvent.keyboard("{PageDown}");
  // The browser lands the scroll several frames after the key press, not on the next one.
  await vi.waitFor(() => expect(longBody.scrollTop).toBeGreaterThan(0));
});
