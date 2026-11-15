import { afterEach, expect, test, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { cleanup, mount } from "../test-helpers.js";
// For its `parkPointer` command type only.
import type {} from "../a11y-helpers.js";
import type { WtModal } from "./wt-modal.js";
import type { WtToast } from "./wt-toast.js";
import { registerIcons } from "./wt-icon.js";
import "./wt-modal.js";
import "./wt-toast.js";

registerIcons({ close: "M2 2L14 14M14 2L2 14" });

afterEach(async () => {
  vi.useRealTimers();
  cleanup();
  // A pointer left resting where a later toast appears would pause that toast's countdown.
  await commands.parkPointer();
});

const shown = (toast: WtToast): boolean => toast.shadowRoot!.querySelector(".toast") !== null;

async function setOpen(modal: WtModal, open: boolean): Promise<void> {
  modal.open = open;
  await modal.updateComplete;
}

async function page(): Promise<{ modal: WtModal; toast: WtToast }> {
  const root = await mount(`<div>
    <button>Edit</button>
    <wt-modal heading="Edit product">Form</wt-modal>
    <wt-toast message="Card reader is offline" close-label="Close"></wt-toast>
  </div>`);
  const modal = root.querySelector<WtModal>("wt-modal")!;
  const toast = root.querySelector<WtToast>("wt-toast")!;
  await modal.updateComplete;
  return { modal, toast };
}

test("a toast that opens while a window is open waits, then shows and closes on a real click", async () => {
  const { modal, toast } = await page();
  await setOpen(modal, true);
  toast.show();
  await toast.updateComplete;
  expect(toast.open).toBe(true);
  expect(shown(toast)).toBe(false);

  await setOpen(modal, false);
  await toast.updateComplete;
  expect(shown(toast)).toBe(true);
  let closes = 0;
  toast.addEventListener("wt-close", () => closes++);
  await userEvent.click(toast.shadowRoot!.querySelector<HTMLElement>("button.close")!);
  expect(closes).toBe(1);
  expect(toast.open).toBe(false);
});

test("a showing toast steps aside while a window opened over it is open", async () => {
  const { modal, toast } = await page();
  toast.show();
  await toast.updateComplete;
  expect(shown(toast)).toBe(true);
  await setOpen(modal, true);
  await toast.updateComplete;
  expect(shown(toast)).toBe(false);
  modal.remove();
  await toast.updateComplete;
  expect(shown(toast)).toBe(true);
});

test("a held toast's countdown starts only once the window closes", async () => {
  const { modal, toast } = await page();
  toast.duration = 150;
  // Opened from a button, as a person opens one, so closing hands focus back there.
  modal.parentElement!.querySelector("button")!.focus();
  await setOpen(modal, true);
  vi.useFakeTimers();
  toast.show();
  await toast.updateComplete;
  vi.advanceTimersByTime(5_000);
  expect(toast.open).toBe(true);
  await setOpen(modal, false);
  await toast.updateComplete;
  expect(shown(toast)).toBe(true);
  vi.advanceTimersByTime(149);
  expect(toast.open).toBe(true);
  vi.advanceTimersByTime(1);
  expect(toast.open).toBe(false);
});

test("a toast the pointer was on when a window opened counts down once the window closes", async () => {
  // The window takes the toast off the screen from under the pointer, so no mouseleave arrives.
  const { modal, toast } = await page();
  toast.show();
  await toast.updateComplete;
  await userEvent.hover(toast.shadowRoot!.querySelector<HTMLElement>(".toast")!);
  await setOpen(modal, true);
  toast.duration = 150;
  await toast.updateComplete;
  await commands.parkPointer();
  vi.useFakeTimers();
  await setOpen(modal, false);
  await toast.updateComplete;
  expect(shown(toast)).toBe(true);
  vi.advanceTimersByTime(150);
  expect(toast.open).toBe(false);
});

test("a toast keyboard focus was in when a window opened counts down once the window closes", async () => {
  const { modal, toast } = await page();
  toast.duration = 150;
  toast.show();
  await toast.updateComplete;
  toast.shadowRoot!.querySelector<HTMLElement>("button.close")!.focus();
  expect(toast.matches(":focus-within")).toBe(true);
  await setOpen(modal, true);
  await toast.updateComplete;
  vi.useFakeTimers();
  await setOpen(modal, false);
  await toast.updateComplete;
  expect(shown(toast)).toBe(true);
  vi.advanceTimersByTime(150);
  expect(toast.open).toBe(false);
});

test("a toast inside the open window shows at once", async () => {
  const modal = (await mount(`<wt-modal heading="Edit product">
    <wt-toast message="Saved" close-label="Close"></wt-toast>
  </wt-modal>`)) as WtModal;
  const toast = modal.querySelector<WtToast>("wt-toast")!;
  await setOpen(modal, true);
  toast.show();
  await toast.updateComplete;
  expect(shown(toast)).toBe(true);
});

test("a toast slotted through another component into the open window shows at once", async () => {
  class SlotsIntoModal extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" }).innerHTML =
        `<wt-modal heading="Floor plan"><slot name="notices"></slot></wt-modal>`;
    }
  }
  customElements.define("test-slots-into-modal", SlotsIntoModal);
  const editor = await mount(`<test-slots-into-modal>
    <wt-toast slot="notices" message="New alert" close-label="Close"></wt-toast>
  </test-slots-into-modal>`);
  const modal = editor.shadowRoot!.querySelector<WtModal>("wt-modal")!;
  const toast = editor.querySelector<WtToast>("wt-toast")!;
  await setOpen(modal, true);
  toast.show();
  await toast.updateComplete;
  expect(shown(toast)).toBe(true);
});

test("a toast inside a window waits while a later window outside it is open", async () => {
  const root = await mount(`<div>
    <wt-modal data-test="first" heading="Edit product">
      <wt-toast message="Saved" close-label="Close"></wt-toast>
    </wt-modal>
    <wt-modal data-test="second" heading="Delete product?">Sure?</wt-modal>
  </div>`);
  const first = root.querySelector<WtModal>("[data-test=first]")!;
  const second = root.querySelector<WtModal>("[data-test=second]")!;
  const toast = root.querySelector<WtToast>("wt-toast")!;
  await setOpen(first, true);
  await setOpen(second, true);
  toast.show();
  await toast.updateComplete;
  expect(shown(toast)).toBe(false);
  await setOpen(second, false);
  await toast.updateComplete;
  expect(shown(toast)).toBe(true);
});

test("a toast put on the page while a window is open waits for it to close", async () => {
  const { modal, toast } = await page();
  await setOpen(modal, true);
  const late = document.createElement("wt-toast") as WtToast;
  late.message = "Printer is offline";
  late.closeLabel = "Close";
  toast.after(late);
  late.show();
  await late.updateComplete;
  expect(shown(late)).toBe(false);
  await setOpen(modal, false);
  await late.updateComplete;
  expect(shown(late)).toBe(true);
});

test("a toast inside the latest window shows though an earlier window is open", async () => {
  const root = await mount(`<div>
    <wt-modal data-test="first" heading="Edit product">Form</wt-modal>
    <wt-modal data-test="second" heading="Choose a photo">
      <wt-toast message="Uploaded" close-label="Close"></wt-toast>
    </wt-modal>
  </div>`);
  await setOpen(root.querySelector<WtModal>("[data-test=first]")!, true);
  await setOpen(root.querySelector<WtModal>("[data-test=second]")!, true);
  const toast = root.querySelector<WtToast>("wt-toast")!;
  toast.show();
  await toast.updateComplete;
  expect(shown(toast)).toBe(true);
});
