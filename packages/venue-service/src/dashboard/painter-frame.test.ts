import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host, mount } from "@waitron/ui/src/test-helpers.js";
import type { PainterFrame } from "./painter-frame.js";
import type { PaintGrid } from "./paint-grid.js";
import "./painter-frame.js";
import "./paint-grid.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});

const MARKUP = `<button data-test="opener">Edit</button>
  <painter-frame heading="Winter week">
    <span slot="picker" data-test="picker">Winter · 1 Dec – 28 Feb</span>
    <a slot="link" href="#periods" data-test="link">Periods</a>
    <div slot="row" data-test="row">Paint: Breakfast · Lunch</div>
    <paint-grid data-test="content"></paint-grid>
  </painter-frame>`;

async function open(dirty = false) {
  await mount(MARKUP);
  const root = host;
  const frame = root.querySelector<PainterFrame>("painter-frame")!;
  const grid = root.querySelector<PaintGrid>("paint-grid")!;
  grid.columns = [
    { key: "mon", label: "Monday" },
    { key: "tue", label: "Tuesday" },
  ];
  grid.days = new Map([
    ["mon", []],
    ["tue", []],
  ]);
  grid.periods = [{ id: "lunch", name: "Lunch", colour: "green" }];
  grid.cutover = "06:00";
  grid.closedErases = true;
  frame.scope = { id: {} };
  frame.dirty = dirty;
  const opener = root.querySelector<HTMLButtonElement>("[data-test=opener]")!;
  opener.addEventListener("click", () => (frame.open = true));
  opener.focus();
  opener.click();
  await frame.updateComplete;
  await modal(frame).updateComplete;
  return {
    frame,
    opener,
    setDirty(value: boolean) {
      frame.dirty = value;
      return frame.updateComplete;
    },
  };
}
const modal = (frame: PainterFrame) =>
  frame.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>("wt-modal")!;
const part = <T extends Element = HTMLElement>(frame: PainterFrame, selector: string) =>
  frame.shadowRoot!.querySelector<T>(selector)!;
const save = (frame: PainterFrame) =>
  part<HTMLElementTagNameMap["wt-button"]>(frame, "[data-test=save]");
const cancel = (frame: PainterFrame) =>
  part<HTMLElementTagNameMap["wt-button"]>(frame, "[data-test=cancel]");
const dismiss = (frame: PainterFrame) =>
  part<HTMLElementTagNameMap["wt-button"]>(frame, "[data-test=dismiss]");
function closed(frame: PainterFrame) {
  return new Promise<void>((resolve) =>
    frame.addEventListener("painter-close", () => resolve(), { once: true }),
  );
}

test("opens as a modal dialog covering the page, named by its heading", async () => {
  const { frame } = await open();
  const dialog = modal(frame).shadowRoot!.querySelector("dialog")!;
  expect(dialog.open).toBe(true);
  expect(dialog.matches(":modal")).toBe(true);
  expect(modal(frame).size).toBe("full");
  expect(modal(frame).getAttribute("aria-label")).toBe("Winter week");
  expect(part(frame, "h2").textContent).toBe("Winter week");
});

test("the bar stays in view while the paint grid scrolls, and the grid fills the space under it", async () => {
  const old = [window.innerWidth, window.innerHeight];
  try {
    // Short enough that the day's hours cannot all show at once.
    await page.viewport(1280, 500);
    const { frame } = await open();
    const bar = part(frame, "header");
    const content = frame
      .querySelector<PaintGrid>("paint-grid")!
      .shadowRoot!.querySelector<HTMLElement>(".scroll")!;
    const body = modal(frame).shadowRoot!.querySelector<HTMLElement>(".body")!;
    const before = bar.getBoundingClientRect();
    const box = frame.querySelector("paint-grid")!.getBoundingClientRect();
    const row = frame.querySelector<HTMLElement>("[data-test=row]")!.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(row.bottom - 1);
    expect(row.top).toBeGreaterThanOrEqual(before.bottom - 1);
    expect(box.height).toBeGreaterThan(0);
    expect(box.height, "the content box is bounded, not as tall as what it holds").toBeLessThan(
      window.innerHeight,
    );
    expect(
      Math.abs(box.bottom - part(frame, ".frame").getBoundingClientRect().bottom),
    ).toBeLessThan(1);
    expect(content.getBoundingClientRect().top).toBeGreaterThanOrEqual(box.top - 1);
    expect(Math.abs(content.getBoundingClientRect().bottom - box.bottom)).toBeLessThan(1);
    expect(content.scrollHeight).toBeGreaterThan(content.clientHeight);
    expect(body.scrollHeight, "the dialog body itself has nothing to scroll").toBe(
      body.clientHeight,
    );
    content.scrollTop = 150;
    expect(content.scrollTop).toBe(150);
    const after = bar.getBoundingClientRect();
    expect(after.top).toBe(before.top);
    expect(after.bottom).toBe(before.bottom);
    expect(after.top).toBeGreaterThanOrEqual(0);
  } finally {
    await page.viewport(old[0]!, old[1]!);
  }
});

test("Save is quiet and disabled until the host's draft changed, and fires painter-save only then", async () => {
  const { frame, setDirty } = await open();
  const saves: Event[] = [];
  frame.addEventListener("painter-save", (event) => saves.push(event));
  expect(save(frame).variant).toBe("secondary");
  expect(save(frame).disabled).toBe(true);
  part(frame, "[data-test=save]").click();
  expect(saves).toHaveLength(0);
  await setDirty(true);
  expect(save(frame).variant).toBe("primary");
  expect(save(frame).disabled).toBe(false);
  save(frame).click();
  expect(saves).toHaveLength(1);
  expect(saves[0]!.bubbles && saves[0]!.composed).toBe(true);
});

test("while a save is in flight Save shows it, and nothing closes the frame", async () => {
  const { frame } = await open(true);
  const saves: Event[] = [];
  frame.addEventListener("painter-save", (event) => saves.push(event));
  frame.busy = true;
  await frame.updateComplete;
  expect(save(frame).loading).toBe(true);
  expect(cancel(frame).disabled).toBe(true);
  expect(dismiss(frame).disabled).toBe(true);
  save(frame).click();
  expect(saves).toHaveLength(0);
  expect(await modal(frame).requestClose("escape")).toBe(false);
  expect(frame.open).toBe(true);
});

test("a refusal shows beside Save", async () => {
  const { frame } = await open(true);
  expect(frame.shadowRoot!.querySelector("[data-error]")).toBeNull();
  frame.refusal = "The change could not be saved.";
  await frame.updateComplete;
  const message = part(frame, "[data-error]");
  expect(message.getAttribute("role")).toBe("alert");
  expect(message.textContent?.trim()).toBe("The change could not be saved.");
  const said = message.getBoundingClientRect();
  const button = save(frame).getBoundingClientRect();
  expect(Math.abs(said.right - button.right)).toBeLessThan(1);
  expect(said.top).toBeGreaterThanOrEqual(button.bottom - 1);
});

describe("closing an unchanged frame", () => {
  test.each([
    ["the close button", (frame: PainterFrame) => dismiss(frame).click()],
    ["Cancel", (frame: PainterFrame) => cancel(frame).click()],
    [
      "Escape",
      async (frame: PainterFrame) => {
        cancel(frame).focus();
        await userEvent.keyboard("{Escape}");
      },
    ],
  ])("%s closes at once and hands focus back to the opener", async (_name, act) => {
    const { frame, opener } = await open();
    const close = closed(frame);
    await act(frame);
    await close;
    expect(frame.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});

test("the host closing the frame sends painter-close too", async () => {
  const { frame } = await open();
  const close = closed(frame);
  frame.open = false;
  await close;
  expect(modal(frame).shadowRoot!.querySelector("dialog")!.open).toBe(false);
});

describe.each(["en", "es"] as const)("the bar's width (%s)", (locale) => {
  test.each([390, 1280])("at %i px", async (width) => {
    const old = [window.innerWidth, window.innerHeight];
    try {
      await page.viewport(width, 800);
      setLocale(locale);
      const { frame } = await open();
      const required = [dismiss(frame), part(frame, "h2"), cancel(frame), save(frame)];
      for (const each of required) {
        const box = each.getBoundingClientRect();
        expect(box.width).toBeGreaterThan(0);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width + 1);
        expect(box.top).toBeGreaterThanOrEqual(0);
      }
      const title = part(frame, "h2");
      expect(title.scrollWidth, "the heading is not cut short").toBeLessThanOrEqual(
        title.clientWidth,
      );
      for (const name of ["picker", "link"]) {
        const box = frame.querySelector(`[data-test=${name}]`)!.getBoundingClientRect();
        const room = part(frame, `.${name}`).getBoundingClientRect();
        expect(box.width).toBeGreaterThan(0);
        expect(box.left).toBeGreaterThanOrEqual(room.left - 1);
        expect(box.right, `${name} fits its place in the bar`).toBeLessThanOrEqual(room.right + 1);
        expect(box.right).toBeLessThanOrEqual(width + 1);
      }
      const tops = [
        ...required,
        frame.querySelector("[data-test=picker]")!,
        frame.querySelector("[data-test=link]")!,
      ].map((each) => each.getBoundingClientRect());
      const sameLine = (a: DOMRect, b: DOMRect) => a.top < b.bottom && b.top < a.bottom;
      const first = tops[0]!;
      for (const box of tops.slice(1, 4)) expect(sameLine(first, box)).toBe(true);
      if (width === 1280) for (const box of tops.slice(4)) expect(sameLine(first, box)).toBe(true);
    } finally {
      await page.viewport(old[0]!, old[1]!);
    }
  });
});
