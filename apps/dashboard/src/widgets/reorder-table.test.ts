import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { ReorderController, type ReorderModel } from "./reorder-table.js";
import { reorder } from "./reorder.js";
import { setLocale } from "../i18n/t.js";

afterEach(cleanupWidgets);

/** A minimal host exercising the controller over a plain id/label list — the reusable contract, free
 * of the modifier form's own concerns. */
@customElement("test-reorder-host")
class TestReorderHost extends LitElement {
  static override styles = [ReorderController.styles];
  @property({ attribute: false }) items: { id: string; name: string }[] = [];
  @property({ type: Boolean }) busy = false;
  readonly #reorder = new ReorderController(this, {
    order: () => this.items.map((item) => item.id),
    move: (id, to) => {
      const from = this.items.findIndex((item) => item.id === id);
      if (from < 0) return;
      this.items = reorder(this.items, from, to);
    },
    label: (id) => this.items.find((item) => item.id === id)?.name ?? id,
    busy: () => this.busy,
    reorderLabel: "Reorder",
  } satisfies ReorderModel);
  override render() {
    return html`<table>
        <tbody>
          ${repeat(
            this.items,
            (item) => item.id,
            (item) =>
              html`<tr data-choice=${item.id}>
                <td>${this.#reorder.handle(item.id)}</td>
                <td>${item.name}</td>
              </tr>`,
          )}
        </tbody>
      </table>
      ${this.#reorder.liveRegion()}`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "test-reorder-host": TestReorderHost;
  }
}

const three = () => [
  { id: "a", name: "One" },
  { id: "b", name: "Two" },
  { id: "c", name: "Three" },
];
async function mount(items = three(), busy = false) {
  return (await mountWidget<TestReorderHost>("test-reorder-host", { items, busy })).el;
}
function order(el: TestReorderHost) {
  return [...el.shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
    row.getAttribute("data-choice"),
  );
}

it("labels each handle and marks it for the reorder test hook", async () => {
  const el = await mount();
  const handle = el.shadowRoot!.querySelector<HTMLElement>('[data-test="drag-b"]')!;
  expect(handle.getAttribute("aria-label")).toBe("Reorder: Two");
});

it("moves a row down with the keyboard and announces its new position politely", async () => {
  const el = await mount();
  setLocale("en");
  try {
    const handle = el.shadowRoot!.querySelector<HTMLElement>('[data-test="drag-a"]')!;
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await el.updateComplete;
    expect(order(el)).toEqual(["b", "a", "c"]);
    const status = el.shadowRoot!.querySelector('[role="status"]')!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("One moved to position 2 of 3");
    // The moved handle keeps focus so repeated presses continue the move.
    expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector('[data-test="drag-a"]'));
  } finally {
    setLocale("es-ES");
  }
});

it("leaves the order and the live region untouched at an end, on another key, and while busy", async () => {
  const el = await mount();
  const press = (id: string, key: string) =>
    el
      .shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${id}"]`)!
      .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  press("a", "ArrowUp"); // already first
  await el.updateComplete;
  press("a", "ArrowLeft"); // not a move key
  await el.updateComplete;
  expect(order(el)).toEqual(["a", "b", "c"]);
  expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent!.trim()).toBe("");
  el.busy = true;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector<HTMLButtonElement>('[data-test="drag-a"]')!.disabled).toBe(
    true,
  );
  press("a", "ArrowDown");
  await el.updateComplete;
  expect(order(el)).toEqual(["a", "b", "c"]);
});

it("reorders by pointer drag and ends the gesture on pointerup", async () => {
  const el = await mount();
  const handle = el.shadowRoot!.querySelector<HTMLElement>('[data-test="drag-a"]')!;
  const rowB = el.shadowRoot!.querySelector<HTMLElement>('tr[data-choice="b"]')!;
  handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
  const box = rowB.getBoundingClientRect();
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 1,
      clientY: box.top + box.height / 2,
    }),
  );
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  await el.updateComplete;
  expect(order(el)).toEqual(["b", "a", "c"]);
  // pointerup ended the gesture: a later move reorders nothing.
  document.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientY: box.top }),
  );
  await el.updateComplete;
  expect(order(el)).toEqual(["b", "a", "c"]);
});
