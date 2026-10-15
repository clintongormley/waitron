import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LitElement, html } from "lit";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, mount } from "@waitron/ui/src/test-helpers.js";
import {
  ColumnStroke,
  CopyChooser,
  columnMenu,
  hourMarks,
  isDeleteKey,
  type Stretch,
} from "./paint-grid-parts.js";

beforeEach(() => setLocale("en"));
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

const columns = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
];

class PartsHost extends LitElement {
  copied: { from: string; to: string[] }[] = [];
  readonly follow = vi.fn<(key: string) => void>();
  readonly clear = vi.fn<(key: string) => void>();
  redraws = 0;
  readonly chooser = new CopyChooser(this, {
    columns: () => columns,
    trigger: (key) =>
      this.renderRoot.querySelector<HTMLElement>(`[data-column="${key}"] wt-row-actions`),
    copy: (from, to) => this.copied.push({ from, to }),
  });

  override render() {
    return html`${columns.map(
      ({ key, label }) =>
        html`<div data-column=${key}>
          ${columnMenu(
            label,
            { copy: () => void this.chooser.open(key), clear: () => this.clear(key) },
            [{ label: "Follow the season", select: () => this.follow(key) }],
          )}
        </div>`,
    )}${this.chooser.render()}`;
  }
  protected override updated(): void {
    this.redraws += 1;
  }
}
customElements.define("paint-grid-parts-host", PartsHost);

function menu(el: PartsHost, key: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
    `[data-column="${key}"] wt-row-actions`,
  )!;
}
function action(el: PartsHost, key: string, label: string) {
  return [...menu(el, key).querySelectorAll<HTMLElement>("wt-button")].find(
    (button) => button.textContent!.trim() === label,
  )!;
}

test("a column menu offers Copy to…, Clear and then the host's own items, each calling back", async () => {
  const el = (await mount("<paint-grid-parts-host></paint-grid-parts-host>")) as PartsHost;
  expect(menu(el, "tue").label).toBe("Tuesday options");
  expect(
    [...menu(el, "tue").querySelectorAll("wt-button")].map((b) => b.textContent!.trim()),
  ).toEqual(["Copy to…", "Clear", "Follow the season"]);

  await userEvent.click(menu(el, "tue"));
  await userEvent.click(action(el, "tue", "Follow the season"));
  expect(el.follow).toHaveBeenCalledExactlyOnceWith("tue");
  await userEvent.click(menu(el, "wed"));
  await userEvent.click(action(el, "wed", "Clear"));
  expect(el.clear).toHaveBeenCalledExactlyOnceWith("wed");
  expect(el.follow).toHaveBeenCalledTimes(1);
});

test("the copy chooser reports where it copies from and the ticked columns in column order, and leaves the copying to its host", async () => {
  const el = (await mount("<paint-grid-parts-host></paint-grid-parts-host>")) as PartsHost;
  await userEvent.click(menu(el, "tue"));
  await userEvent.click(action(el, "tue", "Copy to…"));
  await el.updateComplete;
  const chooser = el.shadowRoot!.querySelector<HTMLElement>(".chooser")!;
  expect(chooser.matches(":popover-open")).toBe(true);
  expect(el.chooser.from).toBe("tue");
  const rows = [...chooser.querySelectorAll("label")];
  expect(rows.map((row) => row.textContent!.trim())).toEqual(["Monday", "Wednesday"]);

  await userEvent.click(rows[1]!);
  await userEvent.click(rows[0]!);
  await el.updateComplete;
  const copy = [...chooser.querySelectorAll<HTMLElement>("wt-button")].find(
    (button) => button.textContent!.trim() === "Copy",
  )!;
  await userEvent.click(copy);

  expect(el.copied).toEqual([{ from: "tue", to: ["mon", "wed"] }]);
  expect(chooser.matches(":popover-open")).toBe(false);
  expect(el.chooser.from).toBeUndefined();
});

test("hour marks fall on each clock hour after a changeover that is not on the hour", () => {
  const marks = hourMarks("06:30");
  expect(marks.slice(0, 3)).toEqual([30, 90, 150]);
  expect(marks).toHaveLength(24);
  expect(hourMarks("06:00")[0]).toBe(0);
});

test("Cancel closes the copy chooser with one redraw", async () => {
  const el = (await mount("<paint-grid-parts-host></paint-grid-parts-host>")) as PartsHost;
  await userEvent.click(menu(el, "tue"));
  await userEvent.click(action(el, "tue", "Copy to…"));
  await el.updateComplete;
  const chooser = el.shadowRoot!.querySelector<HTMLElement>(".chooser")!;
  const cancel = [...chooser.querySelectorAll<HTMLElement>("wt-button")].find(
    (button) => button.textContent!.trim() === "Cancel",
  )!;
  el.redraws = 0;
  await userEvent.click(cancel);
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve));
  await el.updateComplete;
  expect(chooser.matches(":popover-open")).toBe(false);
  expect(el.redraws).toBe(1);
});

test("a delete key is Delete or Backspace with no Cmd, Ctrl or Alt held", () => {
  const key = (init: KeyboardEventInit) => isDeleteKey(new KeyboardEvent("keydown", init));
  expect(key({ key: "Delete" })).toBe(true);
  expect(key({ key: "Backspace", shiftKey: true })).toBe(true);
  expect(key({ key: "Delete", metaKey: true })).toBe(false);
  expect(key({ key: "Backspace", ctrlKey: true })).toBe(false);
  expect(key({ key: "Delete", altKey: true })).toBe(false);
  expect(key({ key: "Enter" })).toBe(false);
});

class StrokeHost extends LitElement {
  released: Stretch[] = [];
  /** Minutes from the changeover a press starts from; the pointer's own minute when unset. */
  anchor: number | undefined = undefined;
  readonly stroke = new ColumnStroke(this, {
    cutover: () => "06:00",
    canStart: () => true,
    canRelease: () => true,
    released: (stretch) => this.released.push(stretch),
  });

  override render() {
    return html`<div class="scroll">
      <div
        class="day"
        data-column="mon"
        style="position: relative; height: 480px"
        @pointerdown=${(event: PointerEvent) => this.stroke.start(event, "mon", this.anchor)}
        @keydown=${() => this.stroke.forgetDrag()}
      ></div>
    </div>`;
  }
}
customElements.define("paint-grid-parts-stroke-host", StrokeHost);

function point(el: StrokeHost, minute: number, type: string) {
  const day = el.shadowRoot!.querySelector<HTMLElement>(".day")!;
  const box = day.getBoundingClientRect();
  (type === "pointerdown" ? day : window).dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      pointerId: 7,
      button: 0,
      clientX: box.left + box.width / 2,
      clientY: box.top + (minute / 1440) * box.height,
    }),
  );
}

test("a stroke started from an anchor previews and releases the stretch from that anchor to the pointer", async () => {
  const el = (await mount(
    "<paint-grid-parts-stroke-host></paint-grid-parts-stroke-host>",
  )) as StrokeHost;
  el.anchor = 600;
  point(el, 840, "pointerdown");
  expect(el.stroke.preview).toBeNull();
  point(el, 1050, "pointermove");
  expect(el.stroke.preview).toEqual({ key: "mon", start: 600, end: 1050 });
  point(el, 300, "pointermove");
  expect(el.stroke.preview).toEqual({ key: "mon", start: 300, end: 600 });
  point(el, 960, "pointermove");
  point(el, 960, "pointerup");
  expect(el.released).toEqual([{ key: "mon", start: 600, end: 960 }]);
  expect(el.stroke.preview).toBeNull();
});

test("an anchored press released where it started keeps nothing and leaves its click alone", async () => {
  const el = (await mount(
    "<paint-grid-parts-stroke-host></paint-grid-parts-stroke-host>",
  )) as StrokeHost;
  el.anchor = 600;
  point(el, 840, "pointerdown");
  point(el, 840, "pointerup");
  expect(el.released).toEqual([]);
  expect(el.stroke.takeDraggedClick()).toBe(false);

  point(el, 840, "pointerdown");
  point(el, 960, "pointermove");
  point(el, 840, "pointermove");
  expect(el.stroke.preview).toBeNull();
  point(el, 840, "pointerup");
  expect(el.released).toEqual([]);
});

test("a key press on the column right after a stroke lets the next click through", async () => {
  const el = (await mount(
    "<paint-grid-parts-stroke-host></paint-grid-parts-stroke-host>",
  )) as StrokeHost;
  const day = el.shadowRoot!.querySelector<HTMLElement>(".day")!;
  point(el, 840, "pointerdown");
  point(el, 960, "pointerup");
  expect(el.released).toEqual([{ key: "mon", start: 840, end: 960 }]);
  day.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(el.stroke.takeDraggedClick()).toBe(false);

  point(el, 840, "pointerdown");
  point(el, 960, "pointerup");
  expect(el.stroke.takeDraggedClick()).toBe(true);
});
