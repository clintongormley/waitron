import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { page, userEvent } from "vitest/browser";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-modal.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { SectionAddProducts, type AddableProduct } from "./section-add-products.js";

afterEach(cleanupWidgets);

function many(count: number): AddableProduct[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p-${String(index).padStart(3, "0")}`,
    name: `Product ${String(index).padStart(3, "0")}`,
    categoryId: null,
  }));
}

/** The window as the menus screen draws it: a standard modal with a heading, the picker in its
 * body and the host's Cancel in the picker's `cancel` slot. */
async function openWindow(products: AddableProduct[]) {
  const { el: modal } = await mountWidget<HTMLElementTagNameMap["wt-modal"]>("wt-modal", {
    size: "standard",
    heading: "Add products to Drinks",
  });
  const picker = document.createElement("dashboard-section-add-products");
  Object.assign(picker, { products, categories: [], inSection: [], onMenu: null });
  const cancel = document.createElement("wt-button");
  cancel.slot = "cancel";
  cancel.variant = "secondary";
  cancel.textContent = "Cancel";
  picker.append(cancel);
  modal.append(picker);
  modal.open = true;
  await modal.updateComplete;
  await picker.updateComplete;
  const body = modal.shadowRoot!.querySelector<HTMLElement>(".body")!;
  const add = picker.shadowRoot!.querySelector<HTMLElement>('[data-test="add"]')!;
  return { modal, picker, cancel, add, body };
}

async function at(width: number, height: number): Promise<void> {
  const before = [window.innerWidth, window.innerHeight] as const;
  await page.viewport(width, height);
  onTestFinished(() => page.viewport(...before));
}

/** Waits a frame, so a scroll's sticky placement is drawn before anything is measured. */
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function expectInView(target: HTMLElement, body: HTMLElement, label: string): void {
  const box = target.getBoundingClientRect();
  const visible = body.getBoundingClientRect();
  expect(box.top, `${label}: top in the window`).toBeGreaterThanOrEqual(0);
  expect(box.bottom, `${label}: bottom in the window`).toBeLessThanOrEqual(window.innerHeight);
  expect(box.left, `${label}: left in the window`).toBeGreaterThanOrEqual(0);
  expect(box.right, `${label}: right in the window`).toBeLessThanOrEqual(window.innerWidth);
  expect(box.top, `${label}: top in the body`).toBeGreaterThanOrEqual(visible.top);
  expect(box.bottom, `${label}: bottom in the body`).toBeLessThanOrEqual(visible.bottom);
}

/** The top edge of the block holding the messages, the count and the buttons. */
function blockTop(picker: SectionAddProducts): number {
  return picker.shadowRoot!.querySelector<HTMLElement>(".bottom")!.getBoundingClientRect().top;
}

/** Tabs from the first product down the list, and checks after each press that the focused
 * checkbox is what is drawn at its centre, not the block over the list's bottom. */
async function expectTabbedCheckboxesUncovered(picker: SectionAddProducts): Promise<void> {
  const root = picker.shadowRoot!;
  root.querySelector<HTMLInputElement>('li input[type="checkbox"]')!.focus();
  for (let press = 0; press < 40; press++) {
    await userEvent.keyboard("{Tab}");
    await frame();
    const focused = root.activeElement as HTMLElement | null;
    expect(focused?.closest("li"), `press ${press}: focus left the list`).not.toBeNull();
    const box = focused!.getBoundingClientRect();
    const hit = root.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    expect(hit, `press ${press}: ${focused!.getAttribute("value")} is covered`).toBe(focused);
  }
}

/** No list row shows below the buttons, in the strip just above the body's visible bottom. */
function expectNoRowUnderneath(picker: SectionAddProducts, body: HTMLElement, label: string): void {
  const visible = body.getBoundingClientRect();
  const hit = picker.shadowRoot!.elementFromPoint(
    visible.left + visible.width / 2,
    visible.bottom - 4,
  );
  expect(hit?.closest("li") ?? null, `${label}: a list row shows below the buttons`).toBeNull();
}

/** Shows the host's refusal in the `message` slot and the picker's none-chosen message: a product
 * is ticked, then the section takes it, so Add stays pressable with nothing left to add. */
async function withMessages(picker: SectionAddProducts, add: HTMLElement): Promise<void> {
  const message = document.createElement("p");
  message.slot = "message";
  message.setAttribute("role", "alert");
  message.style.margin = "0";
  message.textContent = "Some of these products could not be added. Try again.";
  picker.append(message);
  picker.shadowRoot!.querySelector<HTMLInputElement>('input[value="p-000"]')!.click();
  picker.inSection = ["p-000"];
  await picker.updateComplete;
  add.click();
  await picker.updateComplete;
  expect(picker.shadowRoot!.querySelector('[data-test="error"]')).not.toBeNull();
}

describe.each([
  [390, 700],
  [1280, 844],
] as const)("the Add products window at %i×%i", (width, height) => {
  it("keeps Cancel and Add in view with 200 products, before and after scrolling to the end", async () => {
    await at(width, height);
    const { picker, cancel, add, body } = await openWindow(many(200));
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    expectInView(cancel, body, "Cancel, unscrolled");
    expectInView(add, body, "Add, unscrolled");
    expectNoRowUnderneath(picker, body, "unscrolled");
    body.scrollTop = body.scrollHeight / 2;
    await frame();
    expectNoRowUnderneath(picker, body, "halfway");
    body.scrollTop = body.scrollHeight;
    await frame();
    expectInView(cancel, body, "Cancel, at the end");
    expectInView(add, body, "Add, at the end");
    const last = picker.shadowRoot!.querySelector<HTMLElement>(
      'li:last-child input[type="checkbox"]',
    )!;
    expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(blockTop(picker));
    expect(last.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      body.getBoundingClientRect().top,
    );
  });

  it("keeps Cancel and Add in view with a host message and the none-chosen message showing", async () => {
    await at(width, height);
    const { picker, cancel, add, body } = await openWindow(many(200));
    await withMessages(picker, add);
    body.scrollTop = 0;
    await frame();
    expectInView(cancel, body, "Cancel, unscrolled");
    expectInView(add, body, "Add, unscrolled");
    body.scrollTop = body.scrollHeight;
    await frame();
    expectInView(cancel, body, "Cancel, at the end");
    expectInView(add, body, "Add, at the end");
    const last = picker.shadowRoot!.querySelector<HTMLElement>(
      'li:last-child input[type="checkbox"]',
    )!;
    expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(blockTop(picker));
  });

  it.each(["without", "with"] as const)(
    "keeps each checkbox reached by Tab clear of the buttons, %s the messages showing",
    async (messages) => {
      await at(width, height);
      const { picker, add, body } = await openWindow(many(200));
      if (messages === "with") {
        // The block is measured first without the messages, so the check needs it to grow.
        await frame();
        await frame();
        await withMessages(picker, add);
        body.scrollTop = 0;
        await frame();
      }
      await expectTabbedCheckboxesUncovered(picker);
    },
  );

  // With three products the list ends well above the window's bottom, so the buttons sit right
  // after it; no position is pinned.
  it("keeps Cancel and Add in view with 3 products", async () => {
    await at(width, height);
    const { cancel, add, body } = await openWindow(many(3));
    expectInView(cancel, body, "Cancel");
    expectInView(add, body, "Add");
  });
});
