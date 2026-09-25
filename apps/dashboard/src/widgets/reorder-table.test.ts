import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { ReorderController, type ReorderModel } from "./reorder-table.js";
import { reorder } from "./reorder.js";
import { setLocale } from "../i18n/t.js";

afterEach(cleanupWidgets);

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
function press(el: LitElement, id: string, key: string): void {
  el.shadowRoot!.querySelector(`[data-test="drag-${id}"]`)!.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true }),
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
  press(el, "a", "ArrowUp"); // already first
  await el.updateComplete;
  press(el, "a", "ArrowLeft"); // not a move key
  await el.updateComplete;
  expect(order(el)).toEqual(["a", "b", "c"]);
  expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent!.trim()).toBe("");
  el.busy = true;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector<HTMLButtonElement>('[data-test="drag-a"]')!.disabled).toBe(
    true,
  );
  press(el, "a", "ArrowDown");
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

function rowCentre(el: LitElement, id: string): number {
  const box = el
    .shadowRoot!.querySelector<HTMLElement>(`tr[data-choice="${id}"]`)!
    .getBoundingClientRect();
  return box.top + box.height / 2;
}
function pointer(target: EventTarget, type: string, pointerId: number, clientY = 0): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId, clientY }));
}

it("lets only the pointer that started a drag move or end it", async () => {
  const el = await mount();
  const handle = (id: string) =>
    el.shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${id}"]`)!;
  pointer(handle("a"), "pointerdown", 1);
  pointer(handle("c"), "pointerdown", 2);
  pointer(document, "pointermove", 2, rowCentre(el, "b"));
  pointer(document, "pointerup", 2);
  await el.updateComplete;
  expect(order(el)).toEqual(["a", "b", "c"]);
  pointer(document, "pointermove", 1, rowCentre(el, "b"));
  await el.updateComplete;
  expect(order(el)).toEqual(["b", "a", "c"]);
  pointer(document, "pointerup", 1);
});

it("moves nothing while the pointer is over the dragged row itself or outside every row", async () => {
  const el = await mount();
  pointer(el.shadowRoot!.querySelector('[data-test="drag-a"]')!, "pointerdown", 1);
  pointer(document, "pointermove", 1, rowCentre(el, "a"));
  const last = el.shadowRoot!.querySelector('tr[data-choice="c"]')!.getBoundingClientRect();
  pointer(document, "pointermove", 1, last.bottom + 500);
  await el.updateComplete;
  expect(order(el)).toEqual(["a", "b", "c"]);
  // The gesture is still live: crossing a real row moves.
  pointer(document, "pointermove", 1, rowCentre(el, "c"));
  await el.updateComplete;
  expect(order(el)).toEqual(["b", "c", "a"]);
  pointer(document, "pointerup", 1);
});

it("starts no drag from a busy handle", async () => {
  const el = await mount(three(), true);
  pointer(el.shadowRoot!.querySelector('[data-test="drag-a"]')!, "pointerdown", 1);
  pointer(document, "pointermove", 1, rowCentre(el, "c"));
  await el.updateComplete;
  expect(order(el)).toEqual(["a", "b", "c"]);
});

/** A host whose table disappears when it has no rows, and whose `move` can discard the moved row —
 * the two ways a live refresh can pull the ground from under a gesture. */
@customElement("test-reorder-volatile-host")
class VolatileReorderHost extends LitElement {
  @property({ attribute: false }) items: { id: string; name: string }[] = [];
  @property({ type: Boolean }) dropOnMove = false;
  readonly moves: [string, number][] = [];
  readonly vias: ("key" | "pointer")[] = [];
  readonly drops: string[] = [];
  readonly #reorder = new ReorderController(this, {
    order: () => this.items.map((item) => item.id),
    move: (id, to, via) => {
      this.moves.push([id, to]);
      this.vias.push(via);
      this.items = this.dropOnMove
        ? this.items.filter((item) => item.id !== id)
        : reorder(
            this.items,
            this.items.findIndex((item) => item.id === id),
            to,
          );
    },
    drop: (id) => {
      this.drops.push(id);
    },
    label: (id) => this.items.find((item) => item.id === id)?.name ?? id,
    busy: () => false,
    reorderLabel: "Reorder",
  } satisfies ReorderModel);
  override render() {
    return html`${
      this.items.length === 0
        ? html`<p>empty</p>`
        : html`<table>
            <tbody>
              ${repeat(
                this.items,
                (item) => item.id,
                (item) =>
                  html`<tr data-choice=${item.id}>
                    <td>${this.#reorder.handle(item.id)}</td>
                  </tr>`,
              )}
            </tbody>
          </table>`
    }${this.#reorder.liveRegion()}`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "test-reorder-volatile-host": VolatileReorderHost;
  }
}
async function mountVolatile(props: Partial<VolatileReorderHost> = {}) {
  return (
    await mountWidget<VolatileReorderHost>("test-reorder-volatile-host", {
      items: three(),
      ...props,
    })
  ).el;
}

it("announces nothing when the host's move discards the row", async () => {
  const el = await mountVolatile({ dropOnMove: true });
  press(el, "a", "ArrowDown");
  await el.updateComplete;
  expect(el.moves).toEqual([["a", 1]]);
  expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe("");
});

it("moves nothing when the table body vanishes mid-drag", async () => {
  const el = await mountVolatile();
  const y = rowCentre(el, "b");
  pointer(el.shadowRoot!.querySelector('[data-test="drag-a"]')!, "pointerdown", 1);
  el.items = [];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("tbody")).toBeNull();
  pointer(document, "pointermove", 1, y);
  expect(el.moves).toEqual([]);
  pointer(document, "pointerup", 1);
});

it("tells the model a key asked for a key move and the pointer for a drag move", async () => {
  const el = await mountVolatile();
  press(el, "a", "ArrowDown");
  await el.updateComplete;
  expect(el.vias).toEqual(["key"]);
  pointer(el.shadowRoot!.querySelector('[data-test="drag-c"]')!, "pointerdown", 1);
  pointer(document, "pointermove", 1, rowCentre(el, "b"));
  pointer(document, "pointerup", 1);
  await el.updateComplete;
  expect(el.moves).toEqual([
    ["a", 1],
    ["c", 0],
  ]);
  expect(el.vias).toEqual(["key", "pointer"]);
});

it("calls drop once with the dragged row when a drag is released, and again when one is cancelled", async () => {
  const el = await mountVolatile();
  pointer(el.shadowRoot!.querySelector('[data-test="drag-a"]')!, "pointerdown", 1);
  pointer(document, "pointermove", 1, rowCentre(el, "b"));
  pointer(document, "pointerup", 2); // another pointer's release
  expect(el.drops).toEqual([]);
  pointer(document, "pointerup", 1);
  pointer(document, "pointerup", 1); // the gesture has already ended
  expect(el.drops).toEqual(["a"]);
  await el.updateComplete;
  pointer(el.shadowRoot!.querySelector('[data-test="drag-c"]')!, "pointerdown", 3);
  pointer(document, "pointercancel", 3);
  pointer(document, "pointercancel", 3);
  expect(el.drops).toEqual(["a", "c"]);
});

it("does not call drop for a key move", async () => {
  const el = await mountVolatile();
  press(el, "b", "ArrowUp");
  await el.updateComplete;
  expect(el.moves).toEqual([["b", 0]]);
  expect(el.drops).toEqual([]);
});
