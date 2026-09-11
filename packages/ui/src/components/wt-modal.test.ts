import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "@vitest/browser/context";
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

test.each([
  [1280, 900],
  [390, 844],
  [844, 390],
])("fits a %i × %i viewport with clear, equal margins", async (width, height) => {
  await page.viewport(width, height);
  try {
    const modal = await openModal();
    const dialog = modal.shadowRoot!.querySelector("dialog")!;
    const rect = dialog.getBoundingClientRect();
    expect(dialog.matches(":modal")).toBe(true);
    expect(rect.top).toBeGreaterThanOrEqual(16);
    expect(rect.top).toBeLessThanOrEqual(32);
    expect(height - rect.bottom).toBeCloseTo(rect.top, 0);
    expect(width - rect.right).toBeCloseTo(rect.left, 0);
    expect(rect.left).toBeGreaterThanOrEqual(16);
    expect(rect.height).toBeGreaterThan(rect.width);
  } finally {
    await page.viewport(1280, 900);
  }
});

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
