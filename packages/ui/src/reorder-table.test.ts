import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { commands } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, mount as mountHtml } from "./test-helpers.js";
import { ReorderController, type ReorderModel } from "./reorder-table.js";
import { reorder } from "./reorder.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateReducedMotion: (reducedMotion: "reduce" | "no-preference" | null) => Promise<void>;
  }
}

afterEach(cleanup);

const announcement = () => "{item} moved to position {index} of {total}";

async function mountWidget<T extends LitElement>(
  tag: string,
  props: Partial<T>,
): Promise<{ el: T; host: HTMLElement }> {
  const host = await mountHtml(`<${tag}></${tag}>`);
  const el = host as T;
  Object.assign(el, props);
  await el.updateComplete;
  return { el, host: host.parentElement! };
}

@customElement("test-reorder-host")
class TestReorderHost extends LitElement {
  static override styles = [ReorderController.styles];
  @property({ attribute: false }) items: { id: string; name: string; height?: number }[] = [];
  @property({ type: Boolean }) busy = false;
  announcementText = "{item} moved to position {index} of {total}";
  readonly #reorder = new ReorderController(
    this,
    {
      order: () => this.items.map((item) => item.id),
      move: (id, to) => {
        const from = this.items.findIndex((item) => item.id === id);
        if (from < 0) return;
        this.items = reorder(this.items, from, to);
      },
      label: (id) => this.items.find((item) => item.id === id)?.name ?? id,
      busy: () => this.busy,
      reorderLabel: "Reorder",
    } satisfies ReorderModel,
    { announce: () => this.announcementText },
  );
  override render() {
    return html`<table>
        <tbody>
          ${repeat(
            this.items,
            (item) => item.id,
            (item) =>
              html`<tr data-choice=${item.id}>
                <td>${this.#reorder.handle(item.id)}</td>
                <td style=${item.height ? `height: ${item.height}px` : nothing}>${item.name}</td>
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
async function mount(items: TestReorderHost["items"] = three(), busy = false) {
  return (await mountWidget<TestReorderHost>("test-reorder-host", { items, busy })).el;
}
function order(el: LitElement) {
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
});

it("uses the injected announcement in the live region", async () => {
  const el = await mount();
  el.announcementText = "Position {index}/{total}: {item}";
  press(el, "a", "ArrowDown");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe("Position 2/3: One");
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

function row(el: LitElement, id: string): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>(`tr[data-choice="${id}"]`)!;
}
function handle(el: LitElement, id: string): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${id}"]`)!;
}

function near(actual: number, expected: number, tolerance = 1): void {
  expect(actual, `expected ${actual} within ${tolerance}px of ${expected}`).toBeGreaterThanOrEqual(
    expected - tolerance,
  );
  expect(actual, `expected ${actual} within ${tolerance}px of ${expected}`).toBeLessThanOrEqual(
    expected + tolerance,
  );
}
function box(el: LitElement, id: string): DOMRect {
  return row(el, id).getBoundingClientRect();
}

it("moves the dragged row by exactly as far as the pointer has moved, part way between two rows", async () => {
  const el = await mount();
  const before = box(el, "a");
  const centre = before.top + before.height / 2;
  pointer(handle(el, "a"), "pointerdown", 1, centre);
  pointer(document, "pointermove", 1, centre + 0.4 * before.height);
  await el.updateComplete;
  expect(order(el)).toEqual(["a", "b", "c"]);
  near(box(el, "a").top - before.top, 0.4 * before.height);
  pointer(document, "pointerup", 1);
});

it("keeps the row under the same point of the pointer after it changes place", async () => {
  const el = await mount();
  const a = box(el, "a");
  const b = box(el, "b");
  pointer(handle(el, "a"), "pointerdown", 1, a.top + a.height / 2);
  pointer(document, "pointermove", 1, b.top + 0.3 * a.height);
  await el.updateComplete;
  expect(order(el)).toEqual(["b", "a", "c"]);
  near(box(el, "a").top, b.top - 0.2 * a.height);
  pointer(document, "pointerup", 1);
});

it("holds the dragged row against the edge of the list when the pointer leaves it", async () => {
  const el = await mount();
  const a = box(el, "a");
  const c = box(el, "c");
  pointer(handle(el, "a"), "pointerdown", 1, a.top + a.height / 2);
  pointer(document, "pointermove", 1, c.bottom + 500);
  await el.updateComplete;
  expect(order(el)).toEqual(["a", "b", "c"]);
  near(box(el, "a").bottom, c.bottom);
  pointer(document, "pointerup", 1);
  await el.updateComplete;
  pointer(handle(el, "c"), "pointerdown", 2, c.top + c.height / 2);
  pointer(document, "pointermove", 2, a.top - 500);
  await el.updateComplete;
  expect(order(el)).toEqual(["a", "b", "c"]);
  near(box(el, "c").top, a.top);
  pointer(document, "pointerup", 2);
});

it("puts the released row back in its slot", async () => {
  const { el, host } = await mountWidget<TestReorderHost>("test-reorder-host", { items: three() });
  host.style.setProperty("--wt-duration-move", "0s");
  const before = box(el, "a");
  const centre = before.top + before.height / 2;
  pointer(handle(el, "a"), "pointerdown", 1, centre);
  pointer(document, "pointermove", 1, centre + 0.4 * before.height);
  pointer(document, "pointerup", 1);
  await el.updateComplete;
  expect(box(el, "a").toJSON()).toEqual(before.toJSON());
});

it("keeps the order still while the pointer moves inside a taller row it has not yet passed", async () => {
  const el = await mount([
    { id: "a", name: "One", height: 50 },
    { id: "b", name: "Two", height: 150 },
    { id: "c", name: "Three", height: 50 },
  ]);
  const a = box(el, "a");
  const b = box(el, "b");
  pointer(handle(el, "a"), "pointerdown", 1, a.top + a.height / 2);
  for (const offset of [5, 6, 7, 8]) {
    pointer(document, "pointermove", 1, b.top + offset);
    await el.updateComplete;
    expect(order(el), `${offset}px into the taller row`).toEqual(["a", "b", "c"]);
  }
  pointer(document, "pointermove", 1, b.bottom - 10);
  await el.updateComplete;
  expect(order(el)).toEqual(["b", "a", "c"]);
  pointer(document, "pointerup", 1);
});

it("leaves the dragged row where it is when another pointer moves", async () => {
  const el = await mount();
  const a = box(el, "a");
  const centre = a.top + a.height / 2;
  pointer(handle(el, "a"), "pointerdown", 1, centre);
  pointer(document, "pointermove", 1, centre + 0.4 * a.height);
  const top = box(el, "a").top;
  pointer(document, "pointermove", 2, centre + 1000);
  await el.updateComplete;
  expect(box(el, "a").top).toBe(top);
  pointer(document, "pointerup", 1);
});

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
/** The test host, with `--wt-duration-move` set to `duration`. */
async function mountTimed(duration: string, items: TestReorderHost["items"] = three()) {
  const { el, host } = await mountWidget<TestReorderHost>("test-reorder-host", { items });
  host.style.setProperty("--wt-duration-move", duration);
  return el;
}
function slides(el: LitElement, id: string): string[] {
  return row(el, id)
    .getAnimations()
    .filter((animation) => animation.playState === "running")
    .map((animation) => (animation as CSSTransition).transitionProperty);
}

it("slides a passed row from its old place to its new one", async () => {
  const el = await mountTimed("7s");
  const a = box(el, "a");
  const b = box(el, "b");
  pointer(handle(el, "a"), "pointerdown", 1, a.top + a.height / 2);
  pointer(document, "pointermove", 1, b.top + b.height / 2);
  await el.updateComplete;
  // Before any frame the row is where it rests: the slide starts in the next frame.
  near(box(el, "b").top, a.top);
  await nextFrame();
  expect(slides(el, "b")).toEqual(["transform"]);
  expect(row(el, "b").getAnimations()[0]).toBeInstanceOf(CSSTransition);
  expect(getComputedStyle(row(el, "b")).transitionDuration).toBe("7s");
  near(box(el, "b").top, b.top);
  pointer(document, "pointerup", 1);
});

it("does not swap back when the pointer sits where a sliding row is still drawn", async () => {
  const el = await mountTimed("7s");
  const a = box(el, "a");
  const b = box(el, "b");
  pointer(handle(el, "a"), "pointerdown", 1, a.top + a.height / 2);
  pointer(document, "pointermove", 1, b.top + b.height / 2);
  await el.updateComplete;
  expect(order(el)).toEqual(["b", "a", "c"]);
  await nextFrame();
  pointer(document, "pointermove", 1, b.top + b.height / 2 + 1);
  await el.updateComplete;
  expect(order(el)).toEqual(["b", "a", "c"]);
  pointer(document, "pointerup", 1);
});

it("carries on from where a sliding row is drawn when the dragged row crosses it again", async () => {
  const el = await mountTimed("7s");
  const a = box(el, "a");
  const b = box(el, "b");
  pointer(handle(el, "a"), "pointerdown", 1, a.top + a.height / 2);
  pointer(document, "pointermove", 1, b.top + b.height / 2);
  await el.updateComplete;
  await nextFrame();
  const drawn = box(el, "b").top;
  pointer(document, "pointermove", 1, a.top + a.height / 2);
  await el.updateComplete;
  expect(order(el)).toEqual(["a", "b", "c"]);
  await nextFrame();
  near(box(el, "b").top, drawn, 2);
  pointer(document, "pointerup", 1);
});

it("carries on from where a sliding row is drawn when it is crossed again without being moved in the page", async () => {
  // Moving a row in the page ends its running slide by itself. Dragged up past b, the list moves b
  // in the page; dragged back down, it moves c, so b's slide is still running when it is crossed.
  const el = await mountTimed("7s");
  const b = box(el, "b");
  const c = box(el, "c");
  pointer(handle(el, "c"), "pointerdown", 1, c.top + c.height / 2);
  pointer(document, "pointermove", 1, b.top + b.height / 2);
  await el.updateComplete;
  expect(order(el)).toEqual(["a", "c", "b"]);
  await nextFrame();
  const drawn = box(el, "b").top;
  pointer(document, "pointermove", 1, c.top + c.height / 2);
  await el.updateComplete;
  expect(order(el)).toEqual(["a", "b", "c"]);
  await nextFrame();
  near(box(el, "b").top, drawn, 2);
  pointer(document, "pointerup", 1);
});

it("follows the pointer at once when a row is grabbed again while it is still sliding home", async () => {
  const el = await mountTimed("7s");
  const a = box(el, "a");
  const centre = a.top + a.height / 2;
  pointer(handle(el, "a"), "pointerdown", 1, centre);
  pointer(document, "pointermove", 1, centre + 0.4 * a.height);
  pointer(document, "pointerup", 1);
  await nextFrame();
  const drawn = box(el, "a").top;
  pointer(handle(el, "a"), "pointerdown", 2, drawn + 25);
  pointer(document, "pointermove", 2, drawn + 35);
  await nextFrame();
  near(box(el, "a").top, drawn + 10);
  pointer(document, "pointerup", 2);
});

it("slides the released row into its slot", async () => {
  const el = await mountTimed("7s");
  const a = box(el, "a");
  const centre = a.top + a.height / 2;
  pointer(handle(el, "a"), "pointerdown", 1, centre);
  pointer(document, "pointermove", 1, centre + 0.4 * a.height);
  pointer(document, "pointerup", 1);
  await nextFrame();
  expect(slides(el, "a")).toEqual(["transform"]);
  near(box(el, "a").top, a.top + 0.4 * a.height);
});

it("slides the released row from where it was drawn when it is released straight after changing place", async () => {
  const el = await mountTimed("7s");
  const a = box(el, "a");
  const b = box(el, "b");
  pointer(handle(el, "a"), "pointerdown", 1, a.top + a.height / 2);
  pointer(document, "pointermove", 1, b.top + 0.3 * a.height);
  await el.updateComplete;
  pointer(document, "pointerup", 1);
  await nextFrame();
  expect(order(el)).toEqual(["b", "a", "c"]);
  near(box(el, "a").top, b.top - 0.2 * a.height);
});

it("slides the released row from where it was drawn at release when the pointer moved on after it changed place", async () => {
  // The render after a crossing schedules a slide for the next frame; the release comes first.
  const el = await mountTimed("7s");
  const a = box(el, "a");
  const b = box(el, "b");
  pointer(handle(el, "a"), "pointerdown", 1, a.top + a.height / 2);
  pointer(document, "pointermove", 1, b.top + 0.3 * a.height);
  await el.updateComplete;
  expect(order(el)).toEqual(["b", "a", "c"]);
  pointer(document, "pointermove", 1, b.top + 0.7 * a.height);
  const drawn = box(el, "a").top;
  near(drawn, b.top + 0.2 * a.height);
  pointer(document, "pointerup", 1);
  await nextFrame();
  expect(slides(el, "a")).toEqual(["transform"]);
  near(box(el, "a").top, drawn);
});

/** The test host, made the scrolling box around the list, with room below the list to scroll. */
async function mountScrolling() {
  const { el, host } = await mountWidget<TestReorderHost>("test-reorder-host", { items: three() });
  host.style.setProperty("--wt-duration-move", "0s");
  host.style.height = "300px";
  host.style.overflowY = "auto";
  const room = document.createElement("div");
  room.style.height = "1000px";
  host.appendChild(room);
  const scroll = async (by: number) => {
    const scrolled = new Promise((resolve) =>
      host.addEventListener("scroll", resolve, { once: true }),
    );
    host.scrollTop += by;
    await scrolled;
    await el.updateComplete;
  };
  return { el, scroll };
}

it("keeps the dragged row under a pointer that stays still while the list scrolls", async () => {
  const { el, scroll } = await mountScrolling();
  const a = box(el, "a");
  pointer(handle(el, "a"), "pointerdown", 1, a.top + a.height / 2);
  await scroll(0.4 * a.height);
  expect(order(el)).toEqual(["a", "b", "c"]);
  near(box(el, "a").top, a.top);
  pointer(document, "pointerup", 1);
});

it("keeps the dragged row under a still pointer while the page scrolls", async () => {
  const { el, host } = await mountWidget<TestReorderHost>("test-reorder-host", { items: three() });
  host.style.setProperty("--wt-duration-move", "0s");
  const room = document.createElement("div");
  room.style.height = `${2 * innerHeight}px`;
  host.appendChild(room);
  try {
    const a = box(el, "a");
    pointer(handle(el, "a"), "pointerdown", 1, a.top + a.height / 2);
    const scrolled = new Promise((resolve) =>
      document.addEventListener("scroll", resolve, { once: true }),
    );
    scrollBy(0, 0.4 * a.height);
    await scrolled;
    await el.updateComplete;
    expect(order(el)).toEqual(["a", "b", "c"]);
    near(box(el, "a").top, a.top);
    pointer(document, "pointerup", 1);
  } finally {
    scrollTo(0, 0);
  }
});

it("keeps the dragged row under a still pointer while a scrolling box inside a shadow root scrolls", async () => {
  // Shaped like wt-modal: the list is slotted into a shadow root whose own box scrolls.
  const { el, host } = await mountWidget<TestReorderHost>("test-reorder-host", { items: three() });
  host.style.setProperty("--wt-duration-move", "0s");
  const frame = document.createElement("div");
  frame.attachShadow({ mode: "open" }).innerHTML =
    `<div style="height: 300px; overflow-y: auto"><slot></slot><div style="height: 1000px"></div></div>`;
  frame.appendChild(el);
  host.appendChild(frame);
  await el.updateComplete;
  const scroller = frame.shadowRoot!.firstElementChild!;
  const a = box(el, "a");
  pointer(handle(el, "a"), "pointerdown", 1, a.top + a.height / 2);
  const scrolled = new Promise((resolve) =>
    scroller.addEventListener("scroll", resolve, { once: true }),
  );
  scroller.scrollTop += 0.4 * a.height;
  await scrolled;
  await el.updateComplete;
  expect(order(el)).toEqual(["a", "b", "c"]);
  near(box(el, "a").top, a.top);
  pointer(document, "pointerup", 1);
});

it("moves the dragged row past a row the scroll carries under a still pointer", async () => {
  const { el, scroll } = await mountScrolling();
  const a = box(el, "a");
  pointer(handle(el, "a"), "pointerdown", 1, a.top + a.height / 2);
  // Measures the rows' bounds before the scroll, so the crossing below shows that bounds taken from
  // the top of the table body stay right after the list scrolls.
  pointer(document, "pointermove", 1, a.top + a.height / 2);
  await scroll(0.8 * a.height);
  expect(order(el)).toEqual(["b", "a", "c"]);
  near(box(el, "a").top, a.top);
  pointer(document, "pointerup", 1);
  await scroll(0.1 * a.height);
  expect(order(el)).toEqual(["b", "a", "c"]);
});

it("lands the released row in its slot when the slide ends", async () => {
  const el = await mountTimed("50ms");
  const a = box(el, "a");
  const centre = a.top + a.height / 2;
  pointer(handle(el, "a"), "pointerdown", 1, centre);
  pointer(document, "pointermove", 1, centre + 0.4 * a.height);
  pointer(document, "pointerup", 1);
  await vi.waitFor(() => {
    expect(row(el, "a").hasAttribute("data-sliding")).toBe(false);
    expect(box(el, "a").toJSON()).toEqual(a.toJSON());
  });
});

it("under reduced motion the passed row lands at once, while the dragged row still follows the pointer", async () => {
  await commands.emulateReducedMotion("reduce");
  try {
    const el = await mountTimed("7s");
    const a = box(el, "a");
    const b = box(el, "b");
    pointer(handle(el, "a"), "pointerdown", 1, a.top + a.height / 2);
    pointer(document, "pointermove", 1, b.top + b.height / 2);
    await el.updateComplete;
    await nextFrame();
    expect(slides(el, "b")).toEqual([]);
    near(box(el, "b").top, a.top);
    pointer(document, "pointermove", 1, b.top + b.height / 2 + 0.4 * a.height);
    near(box(el, "a").top, b.top + 0.4 * a.height);
    pointer(document, "pointerup", 1);
    await nextFrame();
    expect(slides(el, "a")).toEqual([]);
    near(box(el, "a").top, b.top);
  } finally {
    await commands.emulateReducedMotion(null);
  }
});

it("marks the row being dragged, and clears it on release", async () => {
  const el = await mount();
  pointer(handle(el, "a"), "pointerdown", 1);
  await el.updateComplete;
  expect(row(el, "a").hasAttribute("data-dragging")).toBe(true);
  expect(row(el, "b").hasAttribute("data-dragging")).toBe(false);
  pointer(document, "pointerup", 1);
  await el.updateComplete;
  expect(row(el, "a").hasAttribute("data-dragging")).toBe(false);
});

it("clears the mark when the system cancels the pointer", async () => {
  const el = await mount();
  pointer(handle(el, "a"), "pointerdown", 1);
  pointer(document, "pointercancel", 1);
  await el.updateComplete;
  expect(row(el, "a").hasAttribute("data-dragging")).toBe(false);
});

it("keeps the mark on the dragged row after it moves past another", async () => {
  // Passes with no re-marking after a render: the rows are keyed, so the moved <tr> is the same
  // element and keeps its attribute.
  const el = await mount();
  pointer(handle(el, "a"), "pointerdown", 1);
  pointer(document, "pointermove", 1, rowCentre(el, "b"));
  await el.updateComplete;
  expect(order(el)).toEqual(["b", "a", "c"]);
  expect(row(el, "a").hasAttribute("data-dragging")).toBe(true);
  expect(row(el, "b").hasAttribute("data-dragging")).toBe(false);
  pointer(document, "pointerup", 1);
});

it("marks no row for a busy handle or a second pointer", async () => {
  const el = await mount(three(), true);
  pointer(handle(el, "a"), "pointerdown", 1);
  expect(row(el, "a").hasAttribute("data-dragging")).toBe(false);
  el.busy = false;
  await el.updateComplete;
  pointer(handle(el, "b"), "pointerdown", 1);
  pointer(handle(el, "c"), "pointerdown", 2);
  expect(row(el, "c").hasAttribute("data-dragging")).toBe(false);
  pointer(document, "pointerup", 1);
});

it("sets a grabbing cursor on the page body while dragging, and puts the page's back on release", async () => {
  const el = await mount();
  document.body.style.cursor = "help";
  try {
    pointer(handle(el, "a"), "pointerdown", 1);
    expect(document.body.style.cursor).toBe("grabbing");
    pointer(document, "pointerup", 1);
    expect(document.body.style.cursor).toBe("help");
  } finally {
    document.body.style.cursor = "";
  }
});

it("puts the page's cursor back when the system cancels the pointer", async () => {
  const el = await mount();
  pointer(handle(el, "a"), "pointerdown", 1);
  expect(document.body.style.cursor).toBe("grabbing");
  pointer(document, "pointercancel", 1);
  expect(document.body.style.cursor).toBe("");
});

it("puts the page's cursor back when the table is removed mid-drag", async () => {
  const el = await mount();
  pointer(handle(el, "a"), "pointerdown", 1);
  el.remove();
  expect(document.body.style.cursor).toBe("");
});

it("leaves the page's cursor alone when a table that is not dragging is removed", async () => {
  const el = await mount();
  document.body.style.cursor = "help";
  try {
    el.remove();
    expect(document.body.style.cursor).toBe("help");
  } finally {
    document.body.style.cursor = "";
  }
});

it("paints the dragged row lifted, from tokens", async () => {
  const { el, host } = await mountWidget<TestReorderHost>("test-reorder-host", { items: three() });
  host.style.setProperty("--wt-color-surface-lifted", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-shadow-2", "rgb(4, 5, 6) 0px 0px 0px 1px");
  pointer(handle(el, "a"), "pointerdown", 1);
  expect(getComputedStyle(row(el, "a")).backgroundColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(row(el, "a")).boxShadow).toBe("rgb(4, 5, 6) 0px 0px 0px 1px");
  expect(getComputedStyle(handle(el, "a")).cursor).toBe("grabbing");
  expect(getComputedStyle(row(el, "b")).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  pointer(document, "pointerup", 1);
});

it("shows the grabbing hand on every row and handle, in every table, while one row is dragged", async () => {
  const el = await mount();
  const other = await mount();
  expect(getComputedStyle(handle(el, "b")).cursor).toBe("grab");
  pointer(handle(el, "a"), "pointerdown", 1);
  for (const table of [el, other]) {
    for (const id of ["a", "b", "c"]) {
      expect(getComputedStyle(handle(table, id)).cursor).toBe("grabbing");
      expect(getComputedStyle(row(table, id)).cursor).toBe("grabbing");
    }
  }
  pointer(document, "pointerup", 1);
  expect(getComputedStyle(handle(el, "b")).cursor).toBe("grab");
  expect(getComputedStyle(handle(other, "a")).cursor).toBe("grab");
});

for (const [first, second] of [
  [1, 2],
  [2, 1],
] as const) {
  it(`puts the page's cursor back only when the last of two overlapping drags ends (pointer ${first} released first)`, async () => {
    const tables = [await mount(), await mount()];
    document.body.style.cursor = "help";
    try {
      pointer(handle(tables[0]!, "a"), "pointerdown", 1);
      pointer(handle(tables[1]!, "a"), "pointerdown", 2);
      pointer(document, "pointerup", first);
      expect(document.body.style.cursor).toBe("grabbing");
      expect(getComputedStyle(handle(tables[0]!, "b")).cursor).toBe("grabbing");
      pointer(document, "pointerup", second);
      expect(document.body.style.cursor).toBe("help");
      expect(getComputedStyle(handle(tables[0]!, "b")).cursor).toBe("grab");
    } finally {
      document.body.style.cursor = "";
    }
  });
}

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
  readonly #reorder = new ReorderController(
    this,
    {
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
    } satisfies ReorderModel,
    { announce: announcement },
  );
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

it("goes on reporting crossings, for the host to ignore, after the dragged row has left the list", async () => {
  const el = await mountVolatile({ dropOnMove: true });
  pointer(handle(el, "a"), "pointerdown", 1, rowCentre(el, "a"));
  pointer(document, "pointermove", 1, rowCentre(el, "b"));
  await el.updateComplete;
  expect(order(el)).toEqual(["b", "c"]);
  pointer(document, "pointermove", 1, rowCentre(el, "c"));
  expect(el.moves).toEqual([
    ["a", 1],
    ["a", 1],
  ]);
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

it("prevents arrow scrolling when the move is valid or at the boundary", async () => {
  const el = await mount();
  const handle = el.shadowRoot!.querySelector('[data-test="drag-a"]')!;
  const atStart = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true });
  handle.dispatchEvent(atStart);
  expect(atStart.defaultPrevented).toBe(true);
  const down = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
  handle.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  await el.updateComplete;
  expect(order(el)).toEqual(["b", "a", "c"]);
});

it("prevents selection when a pointer starts dragging and ignores other pointers", async () => {
  const el = await mount();
  const handle = el.shadowRoot!.querySelector('[data-test="drag-a"]')!;
  const start = new PointerEvent("pointerdown", { pointerId: 1, bubbles: true, cancelable: true });
  handle.dispatchEvent(start);
  expect(start.defaultPrevented).toBe(true);
  const other = new PointerEvent("pointerdown", { pointerId: 2, bubbles: true, cancelable: true });
  handle.dispatchEvent(other);
  expect(other.defaultPrevented).toBe(false);
  pointer(document, "pointerup", 1);
});

it("ignores a key for a row that is no longer in the model", async () => {
  const el = await mountVolatile();
  el.items = el.items.filter((item) => item.id !== "a");
  press(el, "a", "ArrowDown");
  await el.updateComplete;
  expect(el.moves).toEqual([]);
  expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe("");
});

it("announces a row moved into the first position", async () => {
  const el = await mount();
  press(el, "b", "ArrowUp");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe(
    "Two moved to position 1 of 3",
  );
});

it("locates rows from viewport pointer coordinates when the table is offset down the page", async () => {
  const el = await mount();
  el.style.display = "block";
  el.style.marginTop = "180px";
  const body = el.shadowRoot!.querySelector("tbody")!;
  expect(body.getBoundingClientRect().top).toBeGreaterThan(100);
  pointer(handle(el, "a"), "pointerdown", 1);
  pointer(document, "pointermove", 1, rowCentre(el, "c"));
  await el.updateComplete;
  expect(order(el)).toEqual(["b", "c", "a"]);
  pointer(document, "pointerup", 1);
});
