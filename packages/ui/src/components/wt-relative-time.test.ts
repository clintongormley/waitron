import { afterEach, describe, expect, test, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import type { WtRelativeTime } from "./wt-relative-time.js";
import "./wt-relative-time.js";
import "./wt-dialog.js";
import "./wt-data-table.js";

afterEach(async () => {
  vi.useRealTimers();
  cleanup();
  await commands.parkPointer();
});

const AT = "2026-10-05T11:49:00.000Z";
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `elapsed` is how long after `AT` the clock reads; a negative one puts `AT` in the future. */
async function shown(elapsed: number, attributes = 'locale="en-GB"'): Promise<WtRelativeTime> {
  const el = (await mount(
    `<wt-relative-time datetime="${AT}" time-zone="UTC" ${attributes}></wt-relative-time>`,
  )) as WtRelativeTime;
  el.now = () => new Date(Date.parse(AT) + elapsed);
  await el.updateComplete;
  return el;
}

const parts = (el: WtRelativeTime) => ({
  button: el.shadowRoot!.querySelector("button")!,
  time: el.shadowRoot!.querySelector("time")!,
  tip: el.shadowRoot!.querySelector<HTMLElement>("[popover]")!,
});
const words = (el: WtRelativeTime) => parts(el).time.textContent!.trim();

describe("the relative phrase", () => {
  test.each([
    ["no time at all", 0, "now", "ahora"],
    ["under a minute ago", 30 * SECOND, "30 seconds ago", "hace 30 segundos"],
    ["a second short of a minute ago", MINUTE - SECOND, "59 seconds ago", "hace 59 segundos"],
    ["a minute ago", MINUTE, "1 minute ago", "hace 1 minuto"],
    ["five minutes and a half ago", 5 * MINUTE + 30 * SECOND, "5 minutes ago", "hace 5 minutos"],
    ["a millisecond short of an hour ago", HOUR - 1, "59 minutes ago", "hace 59 minutos"],
    // The step onto exactly an hour is in the clock test below, which reads "1 hour ago".
    ["two hours ago", 2 * HOUR, "2 hours ago", "hace 2 horas"],
    ["a millisecond short of a day ago", DAY - 1, "23 hours ago", "hace 23 horas"],
    ["a day ago", DAY, "1 day ago", "hace 1 día"],
    ["three days ago", 3 * DAY + 5 * HOUR, "3 days ago", "hace 3 días"],
    ["half a minute ahead", -30 * SECOND, "in 30 seconds", "dentro de 30 segundos"],
    [
      "a millisecond short of a minute ahead",
      -(MINUTE - 1),
      "in 59 seconds",
      "dentro de 59 segundos",
    ],
    ["a minute ahead", -MINUTE, "in 1 minute", "dentro de 1 minuto"],
    [
      "four and a half minutes ahead",
      -(4 * MINUTE + 30 * SECOND),
      "in 4 minutes",
      "dentro de 4 minutos",
    ],
    ["two hours ahead", -2 * HOUR, "in 2 hours", "dentro de 2 horas"],
    ["two days ahead", -2 * DAY, "in 2 days", "dentro de 2 días"],
  ])("%s reads in English and Spanish", async (_, elapsed, english, spanish) => {
    expect(words(await shown(elapsed, 'locale="en-GB"'))).toBe(english);
    expect(words(await shown(elapsed, 'locale="es-ES"'))).toBe(spanish);
  });

  test("says a moment already gone is now when it is told only the future counts", async () => {
    expect(words(await shown(5 * MINUTE, 'locale="en-GB" future'))).toBe("now");
    expect(words(await shown(5 * MINUTE, 'locale="es-ES" future'))).toBe("ahora");
    expect(words(await shown(-5 * MINUTE, 'locale="en-GB" future'))).toBe("in 5 minutes");
  });

  test("marks the moment up as a time element carrying the instant it was given", async () => {
    const el = await shown(MINUTE);
    expect(parts(el).time.getAttribute("datetime")).toBe(AT);
  });

  test("speaks the browser's language when it is given none", async () => {
    const el = await shown(MINUTE, "");
    expect(words(el)).toBe(new Intl.RelativeTimeFormat().format(-1, "minute"));
    expect(parts(el).tip.textContent!.trim()).toBe(
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(Date.parse(AT)),
    );
  });

  test("follows a change of language", async () => {
    const el = await shown(MINUTE);
    el.locale = "es-ES";
    await el.updateComplete;
    expect(words(el)).toBe("hace 1 minuto");
  });

  test("draws nothing for a moment it cannot read", async () => {
    const el = (await mount(
      '<wt-relative-time datetime="not a time" locale="en-GB"></wt-relative-time>',
    )) as WtRelativeTime;
    expect(el.shadowRoot!.querySelector("button")).toBeNull();
    el.datetime = "";
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("button")).toBeNull();
    // A mouse passing over nothing drawn shows nothing and breaks nothing.
    el.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "mouse" }));
    el.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    expect(el.shadowRoot!.querySelector("[popover]")).toBeNull();
  });
});

describe("the exact time", () => {
  test("is the date and time in the language and zone it is given", async () => {
    expect(parts(await shown(MINUTE, 'locale="en-GB"')).tip.textContent!.trim()).toBe(
      "5 October 2026 at 11:49",
    );
    expect(parts(await shown(MINUTE, 'locale="es-ES"')).tip.textContent!.trim()).toBe(
      "5 de octubre de 2026 a las 11:49",
    );
    const madrid = (await mount(
      `<wt-relative-time datetime="${AT}" locale="es-ES" time-zone="Europe/Madrid"></wt-relative-time>`,
    )) as WtRelativeTime;
    expect(parts(madrid).tip.textContent!.trim()).toBe("5 de octubre de 2026 a las 13:49");
  });

  test("describes the button to a screen reader while it is hidden", async () => {
    const el = await shown(MINUTE);
    const { button, tip } = parts(el);
    expect(tip.matches(":popover-open")).toBe(false);
    expect(tip.id).toMatch(/^wt-relative-time-\d+$/);
    expect(button.getAttribute("aria-describedby")).toBe(tip.id);
    expect(tip.getAttribute("role")).toBe("tooltip");
    // The phrase is the button's name; the exact time is only its description.
    expect(button.textContent!.trim()).toBe("1 minute ago");
    expect(button.getAttribute("aria-label")).toBeNull();
  });

  test("shows while the mouse is over the phrase and hides when it leaves", async () => {
    const el = await shown(MINUTE);
    const { button, tip } = parts(el);
    await userEvent.hover(button);
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));
    expect(button.getAttribute("aria-expanded")).toBe("true");
    await commands.parkPointer();
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(false));
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  test("stays while the mouse moves from the phrase onto the exact time", async () => {
    const el = await shown(MINUTE);
    const { button, tip } = parts(el);
    await userEvent.hover(button);
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));
    await userEvent.hover(tip);
    expect(tip.matches(":popover-open")).toBe(true);
  });

  test("a tap shows it, it stays when the pointer goes, and a second tap hides it", async () => {
    const el = await shown(MINUTE);
    const { button, tip } = parts(el);
    await userEvent.click(button);
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));
    await commands.parkPointer();
    expect(tip.matches(":popover-open")).toBe(true);
    await userEvent.click(button);
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(false));
  });

  test("a touch shows it on the tap alone", async () => {
    const el = await shown(MINUTE);
    const { button, tip } = parts(el);
    el.dispatchEvent(new PointerEvent("pointerenter", { pointerType: "touch" }));
    await el.updateComplete;
    expect(tip.matches(":popover-open")).toBe(false);
    button.click();
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));
    el.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "touch" }));
    expect(tip.matches(":popover-open")).toBe(true);
  });

  test("closes on a click anywhere else", async () => {
    const el = await shown(MINUTE);
    const { button, tip } = parts(el);
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    host.append(outside);
    await userEvent.click(button);
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));
    await userEvent.click(outside);
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(false));
  });

  test("Escape closes it, returns focus to the phrase and leaves an enclosing dialog open", async () => {
    const dialogHost = await mount(
      `<wt-dialog open heading="Devices"><wt-relative-time datetime="${AT}" locale="en-GB"></wt-relative-time></wt-dialog>`,
    );
    await (dialogHost as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    const dialog = dialogHost.shadowRoot!.querySelector("dialog")!;
    const el = dialogHost.querySelector("wt-relative-time") as WtRelativeTime;
    await el.updateComplete;
    const { button, tip } = parts(el);
    await userEvent.click(button);
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(false));
    expect(dialog.matches(":modal")).toBe(true);
    expect(el.shadowRoot!.activeElement).toBe(button);
  });

  test("stays open, and lets the key through, when a key other than Escape is pressed", async () => {
    const el = await shown(MINUTE);
    const { button, tip } = parts(el);
    await userEvent.click(button);
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));
    const seen: boolean[] = [];
    const record = (event: KeyboardEvent) => seen.push(event.defaultPrevented);
    document.addEventListener("keydown", record);
    try {
      await userEvent.keyboard("a");
    } finally {
      document.removeEventListener("keydown", record);
    }
    expect(seen).toEqual([false]);
    expect(tip.matches(":popover-open")).toBe(true);
  });

  test("closes when focus moves to the next control", async () => {
    const el = await shown(MINUTE);
    const { button, tip } = parts(el);
    const next = document.createElement("button");
    next.textContent = "Next";
    host.append(next);
    await userEvent.click(button);
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(next);
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(false));
  });

  test("lets an Escape through once it is closed", async () => {
    const el = await shown(MINUTE);
    const { button, tip } = parts(el);
    await userEvent.click(button);
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));
    await userEvent.click(button);
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(false));
    const seen: boolean[] = [];
    const record = (event: KeyboardEvent) => seen.push(event.defaultPrevented);
    document.addEventListener("keydown", record);
    try {
      await userEvent.keyboard("{Escape}");
    } finally {
      document.removeEventListener("keydown", record);
    }
    expect(seen).toEqual([false]);
  });

  test("is placed below the phrase, centred on it, before it is first painted", async () => {
    const el = await shown(MINUTE);
    el.style.position = "fixed";
    el.style.insetInlineStart = "50%";
    el.style.insetBlockStart = "40%";
    const { button, tip } = parts(el);
    button.click();
    // Measured in the same task as the click, before any frame could paint it elsewhere.
    const anchor = button.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    expect(box.left + box.width / 2).toBeCloseTo(anchor.left + anchor.width / 2, 0);
    expect(box.top).toBeCloseTo(anchor.bottom, 0);
  });

  test("goes above the phrase where the window has no room below, and stays 8px inside it", async () => {
    const el = await shown(MINUTE);
    el.style.position = "fixed";
    el.style.insetInlineEnd = "0";
    el.style.insetBlockEnd = "0";
    const { button, tip } = parts(el);
    button.click();
    const box = tip.getBoundingClientRect();
    expect(box.right).toBeCloseTo(innerWidth - 8, 0);
    expect(box.bottom).toBeCloseTo(button.getBoundingClientRect().top, 0);

    el.style.insetInlineEnd = "";
    el.style.insetBlockEnd = "";
    el.style.insetInlineStart = "0";
    el.style.insetBlockStart = "0";
    tip.hidePopover();
    button.click();
    expect(tip.getBoundingClientRect().left).toBeCloseTo(8, 0);
  });

  test("a tap on it in a clickable table row shows the time and does not open the row", async () => {
    const table = (await mount("<wt-data-table></wt-data-table>")) as HTMLElement & {
      rows: unknown[];
      columns: unknown[];
      rowKey: (row: { id: string }) => string;
      rowClick: (row: unknown) => void;
      updateComplete: Promise<unknown>;
    };
    const { html } = await import("lit");
    const opened: unknown[] = [];
    table.rowKey = (row) => row.id;
    table.rowClick = (row) => opened.push(row);
    table.columns = [
      { key: "name", label: "Name", cell: (row: { id: string }) => row.id },
      {
        key: "seen",
        label: "Seen",
        cell: () => html`<wt-relative-time datetime=${AT} locale="en-GB"></wt-relative-time>`,
      },
    ];
    table.rows = [{ id: "d1" }];
    await table.updateComplete;
    const el = table.shadowRoot!.querySelector("wt-relative-time") as WtRelativeTime;
    await el.updateComplete;
    const { button, tip } = parts(el);
    const middle = button.getBoundingClientRect();
    // The row's activator covers the row; the phrase must sit above it to be reached at all.
    expect(
      table.shadowRoot!.elementFromPoint(
        middle.left + middle.width / 2,
        middle.top + middle.height / 2,
      ),
    ).toBe(el);
    await userEvent.click(button);
    await vi.waitFor(() => expect(tip.matches(":popover-open")).toBe(true));
    expect(opened).toEqual([]);
  });
});

describe("as the clock moves on", () => {
  test("re-reads the phrase the moment it changes, and not before", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(Date.parse(AT) + HOUR - 30 * SECOND);
    const el = (await mount(
      `<wt-relative-time datetime="${AT}" locale="en-GB"></wt-relative-time>`,
    )) as WtRelativeTime;
    expect(words(el)).toBe("59 minutes ago");
    await vi.advanceTimersByTimeAsync(30 * SECOND - 1);
    await el.updateComplete;
    expect(words(el)).toBe("59 minutes ago");
    await vi.advanceTimersByTimeAsync(1);
    await el.updateComplete;
    expect(words(el)).toBe("1 hour ago");
    await vi.advanceTimersByTimeAsync(HOUR);
    await el.updateComplete;
    expect(words(el)).toBe("2 hours ago");
  });

  test("counts a closing window down in minutes, then in seconds near its end", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(Date.parse(AT) - (MINUTE + 30 * SECOND));
    const el = (await mount(
      `<wt-relative-time datetime="${AT}" locale="en-GB" future></wt-relative-time>`,
    )) as WtRelativeTime;
    expect(words(el)).toBe("in 1 minute");
    await vi.advanceTimersByTimeAsync(30 * SECOND);
    await el.updateComplete;
    expect(words(el)).toBe("in 1 minute");
    await vi.advanceTimersByTimeAsync(1);
    await el.updateComplete;
    expect(words(el)).toBe("in 59 seconds");
    await vi.advanceTimersByTimeAsync(SECOND);
    await el.updateComplete;
    expect(words(el)).toBe("in 58 seconds");
    await vi.advanceTimersByTimeAsync(MINUTE);
    await el.updateComplete;
    expect(words(el)).toBe("now");
    // Nothing is left to count once the window has gone.
    expect(vi.getTimerCount()).toBe(0);
  });

  test("wakes just after a deadline passes a whole minute, never at once", async () => {
    const wakes = vi.spyOn(globalThis, "setTimeout");
    // Exactly a minute ahead reads "in 1 minute"; it changes the moment less than that is left.
    await shown(-MINUTE);
    expect(wakes).toHaveBeenLastCalledWith(expect.any(Function), 1);
    await shown(-(MINUTE + 20 * SECOND));
    expect(wakes).toHaveBeenLastCalledWith(expect.any(Function), 20 * SECOND);
  });

  test("leaves no timer behind once it is taken off the page, and starts one when put back", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(Date.parse(AT) + MINUTE);
    const el = (await mount(
      `<wt-relative-time datetime="${AT}" locale="en-GB"></wt-relative-time>`,
    )) as WtRelativeTime;
    expect(vi.getTimerCount()).toBe(1);
    el.remove();
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(Date.parse(AT) + 3 * MINUTE);
    host.append(el);
    await el.updateComplete;
    expect(words(el)).toBe("3 minutes ago");
    expect(vi.getTimerCount()).toBe(1);
  });

  test("keeps one timer however often it is drawn", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(Date.parse(AT) + MINUTE);
    const el = (await mount(
      `<wt-relative-time datetime="${AT}" locale="en-GB"></wt-relative-time>`,
    )) as WtRelativeTime;
    el.locale = "es-ES";
    await el.updateComplete;
    el.locale = "en-GB";
    await el.updateComplete;
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe("paints from tokens", () => {
  test("the exact time's box", async () => {
    const el = await shown(MINUTE);
    host.style.setProperty("--wt-color-surface-raised", "rgb(1, 2, 3)");
    host.style.setProperty("--wt-color-border", "rgb(4, 5, 6)");
    host.style.setProperty("--wt-color-text", "rgb(7, 8, 9)");
    const { button, tip } = parts(el);
    button.click();
    const style = getComputedStyle(tip);
    expect(style.backgroundColor).toBe("rgb(1, 2, 3)");
    expect(style.borderTopColor).toBe("rgb(4, 5, 6)");
    expect(style.color).toBe("rgb(7, 8, 9)");
  });

  test("the phrase takes the colour and type of the text around it", async () => {
    const el = await shown(MINUTE);
    host.style.color = "rgb(10, 20, 30)";
    host.style.fontSize = "13px";
    const style = getComputedStyle(parts(el).button);
    expect(style.color).toBe("rgb(10, 20, 30)");
    expect(style.fontSize).toBe("13px");
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(style.textDecorationStyle).toBe("dotted");
  });

  test("the focus ring", async () => {
    const el = await shown(MINUTE);
    host.style.setProperty("--wt-focus-ring", "3px solid rgb(11, 12, 13)");
    const before = document.createElement("input");
    host.prepend(before);
    before.focus();
    await userEvent.keyboard("{Tab}");
    expect(el.shadowRoot!.activeElement).toBe(parts(el).button);
    const style = getComputedStyle(parts(el).button);
    expect(style.outlineColor).toBe("rgb(11, 12, 13)");
    expect(style.outlineWidth).toBe("3px");
  });
});
