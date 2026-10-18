import { afterEach, describe, expect, it } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { LitElement, css, html } from "lit";
import type { LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import { monthGrid } from "./calendar-grid.js";
import { DayPicker, type DayPickerOptions, type DayRun } from "./day-picking.js";

const DATES = monthGrid("2026-10");

class DayPickingHost extends LitElement {
  static override styles = css`
    table {
      user-select: none;
      border-spacing: 4px;
    }
    button {
      inline-size: 48px;
      block-size: 48px;
      touch-action: manipulation;
      -webkit-touch-callout: none;
    }
  `;
  chosen: LocalDate[] = [];
  opened: [LocalDate, DayRun][] = [];
  ranged: DayRun[] = [];
  onPicked: ((run: DayRun | null) => void) | undefined;
  contextMenus: { prevented: boolean }[] = [];
  allowPicking = true;
  dragOnTouch = false;
  picker!: DayPicker;

  start() {
    const options: DayPickerOptions = {
      button: (date) =>
        this.renderRoot.querySelector<HTMLElement>(`td[data-date="${date}"] > button`),
      canPick: () => this.allowPicking,
      dragOnTouch: this.dragOnTouch,
      holdMs: 300,
      choose: (date) => this.chosen.push(date),
      picked: (run) => {
        this.onPicked?.(run);
        this.requestUpdate();
      },
      open: (date, run) => this.opened.push([date, run]),
      ranged: (run) => this.ranged.push(run),
    };
    this.picker = new DayPicker(this, options);
  }

  override render() {
    const weeks = Array.from({ length: DATES.length / 7 }, (_, week) =>
      DATES.slice(week * 7, week * 7 + 7),
    );
    const handlers = this.picker.handlers;
    return html`<table
      @pointerdown=${handlers.pointerdown}
      @click=${handlers.click}
      @dblclick=${handlers.dblclick}
      @keydown=${handlers.keydown}
      @contextmenu=${(event: Event) => {
        handlers.contextmenu(event as MouseEvent);
        this.contextMenus.push({ prevented: event.defaultPrevented });
      }}
    >
      <caption>
        <button type="button" id="month">October 2026</button>
      </caption>
      <tr>
        ${["M", "T", "W", "T", "F", "S", "S"].map((name) => html`<th>${name}</th>`)}
      </tr>
      ${weeks.map(
        (week) =>
          html`<tr>
            ${week.map(
              (date) =>
                html`<td data-date=${date}>
                  <button
                    type="button"
                    aria-pressed=${this.picker.isPicked(date) ? "true" : "false"}
                    tabindex=${date === (this.picker.focusDate ?? "2026-10-01") ? 0 : -1}
                  >
                    ${Number(date.slice(8))}
                  </button>
                </td>`,
            )}
          </tr>`,
      )}
    </table>`;
  }
}
customElements.define("day-picking-host", DayPickingHost);

let page: HTMLElement | undefined;

/** With `inScrollBox`, the host sits in a scrolling box inside another element's shadow root, as
 * the dashboard's `.main` does, so its scroll events never reach `window`. */
async function mount(
  options: { canPick?: boolean; dragOnTouch?: boolean; inScrollBox?: boolean } = {},
) {
  page = document.createElement("div");
  page.style.blockSize = "4000px";
  page.style.paddingBlockStart = "300px";
  const host = document.createElement("day-picking-host") as DayPickingHost;
  host.allowPicking = options.canPick ?? true;
  host.dragOnTouch = options.dragOnTouch ?? false;
  host.start();
  if (options.inScrollBox) {
    const shell = document.createElement("div");
    const box = document.createElement("div");
    box.id = "scroll-box";
    Object.assign(box.style, { blockSize: "450px", overflowY: "auto" });
    const filler = document.createElement("div");
    filler.style.blockSize = "800px";
    box.append(host, filler);
    shell.attachShadow({ mode: "open" }).append(box);
    page.append(shell);
  } else page.append(host);
  document.body.append(page);
  window.scrollTo(0, 0);
  await host.updateComplete;
  return host;
}

afterEach(async () => {
  await userEvent.keyboard("{/Shift}");
  await commands.parkPointer();
  page?.remove();
  page = undefined;
  await commands.parkTouch();
  window.scrollTo(0, 0);
});

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;
const sel = (n: number) => `day-picking-host td[data-date="${day(n)}"] > button`;
const run = (from: number, to: number): DayRun => ({ from: day(from), to: day(to) });

function button(host: DayPickingHost, n: number): HTMLButtonElement {
  return host.renderRoot.querySelector<HTMLButtonElement>(`td[data-date="${day(n)}"] > button`)!;
}

function days(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) out.push(date);
  return out;
}

/** The run the controller holds, checked against the buttons the host drew pressed. */
async function expectRun(host: DayPickingHost, expected: DayRun | null) {
  await host.updateComplete;
  expect(host.picker.run).toEqual(expected);
  const pressed = [
    ...host.renderRoot.querySelectorAll<HTMLElement>('td > button[aria-pressed="true"]'),
  ].map((b) => b.closest("td")!.dataset.date);
  expect(pressed).toEqual(expected === null ? [] : days(expected.from, expected.to));
}

/** A late scroll lands, and flings on, a few frames after a touch command returns. */
async function settle() {
  const end = performance.now() + 300;
  while (performance.now() < end) await new Promise(requestAnimationFrame);
}

const focusedDate = (host: DayPickingHost) =>
  (host.renderRoot as ShadowRoot).activeElement?.closest("td")?.dataset.date;

describe("DayPicker", () => {
  it("a click picks that one day and chooses it", async () => {
    const host = await mount();
    await userEvent.click(button(host, 20));
    await expectRun(host, run(20, 20));
    expect(host.chosen).toEqual([day(20)]);
    host.picker.clear();
    await expectRun(host, null);
  });

  it("a shift-click extends the run from its first-picked day, either way, without choosing", async () => {
    const host = await mount();
    await userEvent.click(button(host, 20));
    await userEvent.keyboard("{Shift>}");
    await userEvent.click(button(host, 23));
    await expectRun(host, run(20, 23));
    await userEvent.click(button(host, 17));
    await expectRun(host, run(17, 20));
    expect(host.chosen).toEqual([day(20)]);
  });

  it("a mouse drag picks a run, follows the pointer back, and keeps the last day crossed", async () => {
    const host = await mount();
    await commands.mouseDrag([sel(20), sel(21), sel(22), sel(23)]);
    await expectRun(host, run(20, 23));
    expect(host.chosen).toEqual([]);

    await commands.mouseDrag([sel(20), sel(23), sel(21)]);
    await expectRun(host, run(20, 21));
    expect(host.chosen).toEqual([]);

    await commands.mouseDrag(["day-picking-host th:first-child", sel(23)]);
    await expectRun(host, run(20, 21));
    expect(host.chosen).toEqual([]);

    await commands.mouseDrag([sel(20), sel(23), sel(20)]);
    await expectRun(host, run(20, 20));
    expect(host.chosen).toEqual([]);

    // The wheel scrolls the grid two rows up mid-drag; 20 must be found where it now is.
    await commands.mouseDrag([sel(12), sel(13), sel(20)], { wheel: { after: 1, deltaY: 100 } });
    expect(window.scrollY).toBe(100);
    await expectRun(host, run(12, 20));
    window.scrollTo(0, 0);

    const edge = button(host, 25).getBoundingClientRect();
    const outside = document.createElement("div");
    outside.id = "outside";
    Object.assign(outside.style, {
      position: "absolute",
      insetBlockStart: `${edge.top}px`,
      insetInlineStart: `${edge.right + 120}px`,
      inlineSize: "40px",
      blockSize: `${edge.height}px`,
    });
    page!.append(outside);
    await commands.mouseDrag([sel(20), sel(25), "#outside"]);
    await expectRun(host, run(20, 25));
    expect(host.chosen).toEqual([]);
  });

  it("a drag over a day's cell but outside its button keeps the last day crossed", async () => {
    const host = await mount();
    const cell = button(host, 24).closest("td")!;
    cell.style.padding = "16px";
    const box = cell.getBoundingClientRect();
    const marker = document.createElement("div");
    marker.id = "cell-padding";
    Object.assign(marker.style, {
      position: "fixed",
      insetBlockStart: `${box.top + 2}px`,
      insetInlineStart: `${box.left + 2}px`,
      inlineSize: "8px",
      blockSize: "8px",
      pointerEvents: "none",
    });
    page!.append(marker);
    await commands.mouseDrag([sel(20), sel(23), "#cell-padding"]);
    await expectRun(host, run(20, 23));
  });

  it("a finger that moves before the hold scrolls the page and picks nothing", async () => {
    const host = await mount();
    await commands.touchGesture({ at: sel(15), moveBy: { x: 0, y: -200 } });
    // The scroll can still be landing, and flinging on, after the command returns.
    await expect.poll(() => window.scrollY).toBeGreaterThan(0);
    await expectRun(host, null);
    expect(host.chosen).toEqual([]);
    expect(host.opened).toEqual([]);

    await userEvent.click(button(host, 9));
    await expectRun(host, run(9, 9));
    await commands.mouseDrag([sel(9), sel(11)]);
    await expectRun(host, run(9, 11));
  });

  it("a long press with no move opens the pressed day", async () => {
    const host = await mount();
    await commands.touchGesture({ at: sel(15), holdMs: 400 });
    expect(host.opened).toEqual([[day(15), run(15, 15)]]);
    await expectRun(host, run(15, 15));
    expect(host.chosen).toEqual([]);
    // Headless Chromium sent no contextmenu for this DevTools touch, even held 1500 ms; one is
    // dispatched after the real long press to check the handler prevents it if one is sent.
    expect(host.contextMenus).toEqual([]);
    button(host, 15).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, composed: true, cancelable: true }),
    );
    expect(host.contextMenus).toEqual([{ prevented: true }]);
    await userEvent.click(button(host, 15), { button: "right" });
    expect(host.contextMenus).toEqual([{ prevented: true }, { prevented: false }]);

    await commands.touchGesture({ at: sel(16), holdMs: 400, moveBy: { x: 2, y: 0 } });
    expect(host.opened).toEqual([
      [day(15), run(15, 15)],
      [day(16), run(16, 16)],
    ]);
    await expectRun(host, run(16, 16));
  });

  it("a long press then a drag picks a run without scrolling; a long press inside it opens the run", async () => {
    const host = await mount();
    await commands.touchGesture({ at: sel(15), holdMs: 400, moveTo: sel(1) });
    await settle();
    expect(window.scrollY).toBe(0);
    await expectRun(host, run(1, 15));

    await commands.touchGesture({ at: sel(15), holdMs: 400, moveTo: sel(17) });
    await expectRun(host, run(15, 17));
    await settle();
    expect(window.scrollY).toBe(0);
    expect(host.opened).toEqual([]);

    await commands.touchGesture({ at: sel(16), holdMs: 400 });
    expect(host.opened).toEqual([[day(16), run(15, 17)]]);
    await expectRun(host, run(15, 17));
    expect(host.chosen).toEqual([]);
  });

  it("a tap and then a long press on the same day open it once", async () => {
    const host = await mount();
    await commands.touchGesture({ at: sel(15) });
    await commands.touchGesture({ at: sel(15), holdMs: 400 });
    await settle();
    expect(host.opened).toEqual([[day(15), run(15, 15)]]);
    expect(host.chosen).toEqual([day(15)]);
  });

  it("after a drag the browser sends no click for, the next click with no press still chooses", async () => {
    const host = await mount();
    await commands.touchGesture({ at: sel(15), holdMs: 400, moveTo: sel(17) });
    await settle();
    await expectRun(host, run(15, 17));
    button(host, 9).click();
    expect(host.chosen).toEqual([day(9)]);
    await expectRun(host, run(9, 9));

    // A browser whose click is a plain MouseEvent: one a press made (detail 1) is the gesture's.
    const mouseClick = (detail: number) =>
      button(host, 11).dispatchEvent(
        new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, detail }),
      );
    await commands.touchGesture({ at: sel(15), holdMs: 400, moveTo: sel(17) });
    mouseClick(1);
    expect(host.chosen).toEqual([day(9)]);
    await commands.touchGesture({ at: sel(15), holdMs: 400, moveTo: sel(17) });
    mouseClick(0);
    expect(host.chosen).toEqual([day(9), day(11)]);
  });

  it("picking turned off during a press opens nothing and picks no run", async () => {
    const host = await mount();
    const offAtPress = () =>
      document.addEventListener("pointerdown", () => (host.allowPicking = false), { once: true });

    offAtPress();
    await commands.touchGesture({ at: sel(15), holdMs: 400 });
    await settle();
    expect(host.opened).toEqual([]);
    await expectRun(host, run(15, 15));
    expect(host.chosen).toEqual([day(15)]);

    host.allowPicking = true;
    offAtPress();
    await commands.mouseDrag([sel(20), sel(23)]);
    await expectRun(host, run(15, 15));
    expect(host.opened).toEqual([]);
    expect(host.chosen).toEqual([day(15)]);
  });

  it("a drag stays right when a scrolling box inside a shadow root scrolls mid-drag", async () => {
    const host = await mount({ inScrollBox: true });
    const box = host.parentElement!;
    await commands.mouseDrag([sel(12), sel(13), sel(20)], { wheel: { after: 1, deltaY: 100 } });
    expect(box.scrollTop).toBe(100);
    expect(window.scrollY).toBe(0);
    await expectRun(host, run(12, 20));
  });

  it("a double-click opens the picked run when inside it, else that one day", async () => {
    const host = await mount();
    await commands.mouseDrag([sel(20), sel(23)]);
    await expectRun(host, run(20, 23));
    await userEvent.dblClick(button(host, 22));
    expect(host.opened).toEqual([[day(22), run(20, 23)]]);
    await expectRun(host, run(20, 23));

    await userEvent.dblClick(button(host, 27));
    expect(host.opened).toEqual([
      [day(22), run(20, 23)],
      [day(27), run(27, 27)],
    ]);
    await expectRun(host, run(27, 27));

    // A shift-double-click opens against the run as it stood before its first click (20–20), which
    // 14 is outside of, so it opens 14 alone.
    await commands.mouseDrag([sel(12), sel(16)]);
    await userEvent.click(button(host, 20));
    await expectRun(host, run(20, 20));
    await userEvent.keyboard("{Shift>}");
    await userEvent.dblClick(button(host, 14));
    expect(host.opened.at(-1)).toEqual([day(14), run(14, 14)]);
    await expectRun(host, run(14, 14));
  });

  it("keys move focus and pick, Shift extends, Enter opens and Space chooses", async () => {
    const host = await mount();
    button(host, 21).focus();
    await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(focusedDate(host)).toBe(day(20));
    await expectRun(host, run(20, 21));

    await userEvent.keyboard("{ArrowRight}");
    expect(focusedDate(host)).toBe(day(21));
    await expectRun(host, run(21, 21));
    expect(button(host, 21).tabIndex).toBe(0);

    await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowRight}{/Shift}");
    expect(focusedDate(host)).toBe(day(23));
    await expectRun(host, run(21, 23));

    await userEvent.keyboard("{Enter}");
    expect(host.opened).toEqual([[day(23), run(21, 23)]]);
    expect(host.chosen).toEqual([]);

    await userEvent.keyboard("{ }");
    expect(host.chosen).toEqual([day(23)]);

    button(host, 31).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(focusedDate(host)).toBe(day(31));
  });

  it("the Tab stop follows focus however it arrives", async () => {
    const host = await mount();
    expect(host.picker.focusDate).toBeNull();
    button(host, 12).focus();
    expect(host.picker.focusDate).toBe(day(12));
    await host.updateComplete;
    expect(button(host, 12).tabIndex).toBe(0);
    expect(button(host, 1).tabIndex).toBe(-1);
    await expectRun(host, null);

    host.renderRoot.querySelector<HTMLButtonElement>("#month")!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(host.picker.focusDate).toBe(day(12));
    await expectRun(host, null);
  });

  it("the Tab stop follows focus a script moves from one day to another", async () => {
    const host = await mount();
    button(host, 12).focus();
    button(host, 14).focus();
    expect(host.picker.focusDate).toBe(day(14));
    await host.updateComplete;
    expect(button(host, 14).tabIndex).toBe(0);
  });

  it("forgetting focus drops the Tab stop and keeps the run", async () => {
    const host = await mount();
    await userEvent.click(button(host, 12));
    expect(host.picker.focusDate).toBe(day(12));
    host.picker.forgetFocus();
    expect(host.picker.focusDate).toBeNull();
    await host.updateComplete;
    expect(button(host, 1).tabIndex).toBe(0);
    await expectRun(host, run(12, 12));
  });

  it("a click no Enter keydown preceded chooses and does not open", async () => {
    const host = await mount();
    button(host, 23).focus();
    button(host, 23).click();
    expect(host.chosen).toEqual([day(23)]);
    expect(host.opened).toEqual([]);
  });

  it("when picking is off, only choose runs", async () => {
    const host = await mount({ canPick: false });
    await userEvent.click(button(host, 20));
    await userEvent.keyboard("{Shift>}");
    await userEvent.click(button(host, 23));
    await userEvent.keyboard("{/Shift}");
    await expectRun(host, run(23, 23));

    await commands.mouseDrag([sel(10), sel(13)]);
    await expectRun(host, run(23, 23));
    window.scrollTo(0, 0);
    await commands.touchGesture({ at: sel(15), holdMs: 400, moveTo: sel(17) });
    await expectRun(host, run(23, 23));

    await userEvent.dblClick(button(host, 22));
    button(host, 22).focus();
    await userEvent.keyboard("{Enter}");
    await commands.touchGesture({ at: sel(15), holdMs: 400 });
    expect(host.opened).toEqual([]);

    expect(host.chosen.slice(0, 2)).toEqual([day(20), day(23)]);
    expect(host.chosen).toContain(day(22));
  });

  it("with dragOnTouch, a touch drag with no hold picks a run and does not scroll", async () => {
    const host = await mount({ dragOnTouch: true });
    await commands.touchGesture({ at: sel(15), moveTo: sel(1) });
    await settle();
    expect(window.scrollY).toBe(0);
    await expectRun(host, run(1, 15));

    await commands.touchGesture({ at: sel(15), moveTo: sel(17) });
    await expectRun(host, run(15, 17));
    await settle();
    expect(window.scrollY).toBe(0);
    expect(host.opened).toEqual([]);
    expect(host.chosen).toEqual([]);
  });

  it("a mouse drag reports its run once, on release", async () => {
    const host = await mount();
    const reportedWhilePicking: number[] = [];
    host.onPicked = () => reportedWhilePicking.push(host.ranged.length);
    await commands.mouseDrag([sel(20), sel(21), sel(22), sel(23)]);
    await expectRun(host, run(20, 23));
    expect(reportedWhilePicking.length).toBeGreaterThan(1);
    expect(reportedWhilePicking.every((count) => count === 0)).toBe(true);
    expect(host.ranged).toEqual([run(20, 23)]);

    await commands.mouseDrag([sel(20), sel(23), sel(18)]);
    expect(host.ranged).toEqual([run(20, 23), run(18, 20)]);
  });

  it("with dragOnTouch, a touch drag reports its run on lift", async () => {
    const host = await mount({ dragOnTouch: true });
    await commands.touchGesture({ at: sel(15), moveTo: sel(17) });
    await expectRun(host, run(15, 17));
    expect(host.ranged).toEqual([run(15, 17)]);
  });

  it("a long press then a drag reports its run on lift", async () => {
    const host = await mount();
    await commands.touchGesture({ at: sel(15), holdMs: 400, moveTo: sel(17) });
    await expectRun(host, run(15, 17));
    expect(host.ranged).toEqual([run(15, 17)]);
  });

  it("a shift-click reports the run from the anchor", async () => {
    const host = await mount();
    await userEvent.click(button(host, 20));
    await userEvent.keyboard("{Shift>}");
    await userEvent.click(button(host, 23));
    expect(host.ranged).toEqual([run(20, 23)]);
    await userEvent.click(button(host, 17));
    expect(host.ranged).toEqual([run(20, 23), run(17, 20)]);
  });

  it("Shift+arrow reports the run so far", async () => {
    const host = await mount();
    button(host, 21).focus();
    await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowRight}{/Shift}");
    expect(host.ranged).toEqual([run(21, 22), run(21, 23)]);
  });

  it("a click, an arrow and a cancelled drag report nothing", async () => {
    const host = await mount();
    await userEvent.click(button(host, 20));
    await expectRun(host, run(20, 20));
    await userEvent.keyboard("{ArrowRight}");
    await expectRun(host, run(21, 21));
    await userEvent.click(button(host, 21));
    await expectRun(host, run(21, 21));

    host.onPicked = (picked) => {
      if (picked?.to === day(13)) host.allowPicking = false;
    };
    await commands.mouseDrag([sel(10), sel(11), sel(12), sel(13), sel(14)]);
    host.onPicked = undefined;
    host.allowPicking = true;
    expect(host.picker.run).toEqual(run(21, 21));

    await commands.touchGesture({ at: sel(15), holdMs: 400 });
    expect(host.opened).toEqual([[day(15), run(15, 15)]]);
    expect(host.ranged).toEqual([]);
  });

  it("says a drag is under way only while one is", async () => {
    const host = await mount();
    const seen: boolean[] = [];
    host.onPicked = () => seen.push(host.picker.dragging);
    await commands.mouseDrag([sel(10), sel(11), sel(12)]);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
    expect(host.picker.dragging).toBe(false);

    seen.length = 0;
    await userEvent.click(button(host, 20));
    await userEvent.dblClick(button(host, 22));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some(Boolean)).toBe(false);
    expect(host.picker.dragging).toBe(false);

    host.onPicked = (picked) => {
      seen.push(host.picker.dragging);
      if (picked?.to === day(13)) host.allowPicking = false;
    };
    seen.length = 0;
    await commands.mouseDrag([sel(10), sel(11), sel(12), sel(13), sel(14)]);
    host.allowPicking = true;
    expect(seen.some(Boolean)).toBe(true);
    expect(host.picker.dragging).toBe(false);

    host.onPicked = () => seen.push(host.picker.dragging);
    seen.length = 0;
    await commands.touchGesture({ at: sel(25), holdMs: 400 });
    expect(seen).toEqual([false]);

    seen.length = 0;
    await commands.touchGesture({ at: sel(15), holdMs: 400, moveTo: sel(17) });
    expect(seen.some(Boolean)).toBe(true);
    expect(host.picker.dragging).toBe(false);
  });
});
