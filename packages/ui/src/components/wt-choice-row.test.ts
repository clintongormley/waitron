import { afterEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import type { WtChoiceRow } from "./wt-choice-row.js";
import "./wt-choice-row.js";

afterEach(cleanup);

const DEMO =
  '<wt-choice-row heading="Demo">A practice server. Nothing is filed to AEAT.</wt-choice-row>';

const button = (el: WtChoiceRow) => el.shadowRoot!.querySelector("button")!;

test("is one native button holding the heading and the slotted description", async () => {
  const el = (await mount(DEMO)) as WtChoiceRow;
  const inner = button(el);
  expect(inner.querySelector("[part=heading]")!.textContent).toBe("Demo");
  const slot = inner.querySelector("slot")!;
  expect(
    slot
      .assignedNodes()
      .map((n) => n.textContent)
      .join(""),
  ).toBe("A practice server. Nothing is filed to AEAT.");
  expect(el.shadowRoot!.querySelectorAll("button")).toHaveLength(1);
});

test("a click anywhere on the row reaches a listener on the element", async () => {
  const el = (await mount(DEMO)) as WtChoiceRow;
  let clicks = 0;
  el.addEventListener("click", () => clicks++);
  await userEvent.click(el.shadowRoot!.querySelector("[part=heading]")!);
  await userEvent.click(el);
  expect(clicks).toBe(2);
});

test("Enter and Space on the focused row choose it", async () => {
  const el = (await mount(DEMO)) as WtChoiceRow;
  let clicks = 0;
  el.addEventListener("click", () => clicks++);
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(button(el));
  await userEvent.keyboard("{Enter}");
  await userEvent.keyboard(" ");
  expect(clicks).toBe(2);
});

test("is at least the tap-target height", async () => {
  const el = (await mount(DEMO)) as WtChoiceRow;
  el.style.setProperty("--wt-tap-min", "123px");
  expect(button(el).getBoundingClientRect().height).toBeGreaterThanOrEqual(123);
});

test("paints its border, heading and description from tokens", async () => {
  const el = (await mount(DEMO)) as WtChoiceRow;
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-text", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  const inner = button(el);
  expect(getComputedStyle(inner).borderTopColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(inner.querySelector("[part=heading]")!).color).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(inner.querySelector("[part=description]")!).color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(inner.querySelector("[part=arrow]")!).color).toBe("rgb(7, 8, 9)");
});

test("takes the lifted surface while the pointer is over it", async () => {
  const el = (await mount(DEMO)) as WtChoiceRow;
  host.style.setProperty("--wt-color-surface", "rgb(10, 11, 12)");
  host.style.setProperty("--wt-color-surface-lifted", "rgb(13, 14, 15)");
  expect(getComputedStyle(button(el)).backgroundColor).toBe("rgb(10, 11, 12)");
  await userEvent.hover(button(el));
  expect(getComputedStyle(button(el)).backgroundColor).toBe("rgb(13, 14, 15)");
});

const GROUP = `<div>
  <h2>Choose</h2>
  <wt-choice-row heading="Demo">One</wt-choice-row>
  <wt-choice-row heading="Prepare">Two</wt-choice-row>
  <wt-choice-row heading="Live">Three</wt-choice-row>
</div>`;

const corners = (el: WtChoiceRow) => {
  const style = getComputedStyle(button(el));
  return [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ];
};

const borders = (el: WtChoiceRow) => {
  const style = getComputedStyle(button(el));
  return [
    style.borderTopWidth,
    style.borderRightWidth,
    style.borderBottomWidth,
    style.borderLeftWidth,
  ];
};

test("rows that share a parent draw one box, a line between each row and rounded only at its ends", async () => {
  await mount(GROUP);
  host.style.setProperty("--wt-radius-lg", "7px");
  const rows = [...host.querySelectorAll<WtChoiceRow>("wt-choice-row")];
  await Promise.all(rows.map((row) => row.updateComplete));
  expect(rows.map(corners)).toEqual([
    ["7px", "7px", "0px", "0px"],
    ["0px", "0px", "0px", "0px"],
    ["0px", "0px", "7px", "7px"],
  ]);
  expect(rows.map(borders)).toEqual([
    ["1px", "1px", "0px", "1px"],
    ["1px", "1px", "0px", "1px"],
    ["1px", "1px", "1px", "1px"],
  ]);
  for (const [above, below] of [
    [rows[0]!, rows[1]!],
    [rows[1]!, rows[2]!],
  ] as const) {
    expect(button(below).getBoundingClientRect().top).toBe(
      button(above).getBoundingClientRect().bottom,
    );
  }
});

test("a row alone in its parent draws the whole box, rounded at every corner", async () => {
  await mount(
    '<div><h2>Already have one?</h2><wt-choice-row heading="Join">Four</wt-choice-row></div>',
  );
  host.style.setProperty("--wt-radius-lg", "7px");
  const row = host.querySelector<WtChoiceRow>("wt-choice-row")!;
  await row.updateComplete;
  expect(corners(row)).toEqual(["7px", "7px", "7px", "7px"]);
  expect(borders(row)).toEqual(["1px", "1px", "1px", "1px"]);
});

test("takes the whole width it is given", async () => {
  const el = (await mount(DEMO)) as WtChoiceRow;
  host.style.width = "400px";
  expect(button(el).getBoundingClientRect().width).toBe(400);
});

const TILL = '<wt-choice-row heading="Till" href="/till">Sell from this screen.</wt-choice-row>';

const anchor = (el: WtChoiceRow) => el.shadowRoot!.querySelector("a")!;

const control = (el: WtChoiceRow) => el.shadowRoot!.querySelector<HTMLElement>("a, button")!;

test("with an href, is one native link to it holding the heading and description, and no button", async () => {
  const el = (await mount(TILL)) as WtChoiceRow;
  const links = el.shadowRoot!.querySelectorAll("a");
  expect(links).toHaveLength(1);
  expect(links[0]!.getAttribute("href")).toBe("/till");
  expect(el.shadowRoot!.querySelector("button")).toBeNull();
  expect(links[0]!.querySelector("[part=heading]")!.textContent).toBe("Till");
  expect(
    links[0]!
      .querySelector("slot")!
      .assignedNodes()
      .map((n) => n.textContent)
      .join(""),
  ).toBe("Sell from this screen.");
});

test("focus and Tab land on the link", async () => {
  const el = (await mount(TILL)) as WtChoiceRow;
  await userEvent.tab();
  expect(document.activeElement).toBe(el);
  expect(el.shadowRoot!.activeElement).toBe(anchor(el));
  anchor(el).blur();
  expect(el.shadowRoot!.activeElement).toBeNull();
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(anchor(el));
});

test("a link row is drawn exactly as a button row is", async () => {
  await mount(`<div>${DEMO.replace("Demo", "One")}</div>`);
  const asButton = host.querySelector<WtChoiceRow>("wt-choice-row")!;
  const buttonHost = host;
  await mount(`<div>${TILL.replace("Till", "One")}</div>`);
  const asLink = host.querySelector<WtChoiceRow>("wt-choice-row")!;
  for (const h of [buttonHost, host]) h.style.width = "400px";
  await Promise.all([asButton.updateComplete, asLink.updateComplete]);
  expect([control(asLink).localName, control(asButton).localName]).toEqual(["a", "button"]);
  const look = (el: HTMLElement) => {
    const s = getComputedStyle(el);
    return [
      "display",
      "align-items",
      "gap",
      "padding",
      "border",
      "border-radius",
      "background-color",
      "color",
      "font",
      "min-height",
      "cursor",
      "text-align",
    ].map((name) => `${name}: ${s.getPropertyValue(name)}`);
  };
  expect(look(control(asLink))).toEqual(look(control(asButton)));
  for (const part of ["[part=heading]", "[part=description]", "[part=arrow]"]) {
    expect(look(control(asLink).querySelector<HTMLElement>(part)!)).toEqual(
      look(control(asButton).querySelector<HTMLElement>(part)!),
    );
  }
  expect(control(asLink).getBoundingClientRect().height).toBe(
    control(asButton).getBoundingClientRect().height,
  );
  expect(control(asLink).getBoundingClientRect().width).toBe(400);
});

test("a link row paints its border, text, heading, description and arrow from tokens", async () => {
  const el = (await mount(TILL)) as WtChoiceRow;
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-text", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  const inner = anchor(el);
  expect(getComputedStyle(inner).borderTopColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(inner).color).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(inner.querySelector("[part=heading]")!).color).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(inner.querySelector("[part=description]")!).color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(inner.querySelector("[part=arrow]")!).color).toBe("rgb(7, 8, 9)");
});

test("a link row takes the lifted surface while the pointer is over it", async () => {
  const el = (await mount(TILL)) as WtChoiceRow;
  host.style.setProperty("--wt-color-surface", "rgb(10, 11, 12)");
  host.style.setProperty("--wt-color-surface-lifted", "rgb(13, 14, 15)");
  expect(getComputedStyle(anchor(el)).backgroundColor).toBe("rgb(10, 11, 12)");
  await userEvent.hover(anchor(el));
  expect(getComputedStyle(anchor(el)).backgroundColor).toBe("rgb(13, 14, 15)");
});

test("a link row is at least the tap-target height", async () => {
  const el = (await mount(TILL)) as WtChoiceRow;
  el.style.setProperty("--wt-tap-min", "123px");
  expect(anchor(el).getBoundingClientRect().height).toBeGreaterThanOrEqual(123);
});

test("a link row's text is not underlined", async () => {
  const el = (await mount(TILL)) as WtChoiceRow;
  expect(getComputedStyle(anchor(el)).textDecorationLine).toBe("none");
});

test("a row with no description hides the description line, and a row with one shows it", async () => {
  const bare = (await mount(
    '<wt-choice-row heading="Till" href="/"></wt-choice-row>',
  )) as WtChoiceRow;
  expect(getComputedStyle(bare.shadowRoot!.querySelector("[part=description]")!).display).toBe(
    "none",
  );
  const described = (await mount(TILL)) as WtChoiceRow;
  expect(
    getComputedStyle(described.shadowRoot!.querySelector("[part=description]")!).display,
  ).not.toBe("none");
});

test("rows mixing links and buttons in one parent still draw one box", async () => {
  await mount(`<div>
  <wt-choice-row heading="Till" href="/"></wt-choice-row>
  <wt-choice-row heading="Prepare">Two</wt-choice-row>
  <wt-choice-row heading="Email" href="/manage/email"></wt-choice-row>
</div>`);
  host.style.setProperty("--wt-radius-lg", "7px");
  const rows = [...host.querySelectorAll<WtChoiceRow>("wt-choice-row")];
  await Promise.all(rows.map((row) => row.updateComplete));
  expect(rows.map((row) => control(row).localName)).toEqual(["a", "button", "a"]);
  const edges = (el: WtChoiceRow) => {
    const style = getComputedStyle(control(el));
    return [
      style.borderTopLeftRadius,
      style.borderTopRightRadius,
      style.borderBottomRightRadius,
      style.borderBottomLeftRadius,
      style.borderTopWidth,
      style.borderRightWidth,
      style.borderBottomWidth,
      style.borderLeftWidth,
    ];
  };
  expect(rows.map(edges)).toEqual([
    ["7px", "7px", "0px", "0px", "1px", "1px", "0px", "1px"],
    ["0px", "0px", "0px", "0px", "1px", "1px", "0px", "1px"],
    ["0px", "0px", "7px", "7px", "1px", "1px", "1px", "1px"],
  ]);
  for (const [above, below] of [
    [rows[0]!, rows[1]!],
    [rows[1]!, rows[2]!],
  ] as const) {
    expect(control(below).getBoundingClientRect().top).toBe(
      control(above).getBoundingClientRect().bottom,
    );
  }
});

test("a row whose href attribute is removed goes back to being a button", async () => {
  const el = (await mount(TILL)) as WtChoiceRow;
  el.removeAttribute("href");
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("a")).toBeNull();
  expect(el.shadowRoot!.querySelectorAll("button")).toHaveLength(1);
});

test("a row with an empty href is a button", async () => {
  const el = (await mount(
    '<wt-choice-row heading="Till" href="">Sell from this screen.</wt-choice-row>',
  )) as WtChoiceRow;
  expect(el.shadowRoot!.querySelector("a")).toBeNull();
  expect(el.shadowRoot!.querySelectorAll("button")).toHaveLength(1);
});

test("a click on a link row reaches a listener on the element, and Enter on the focused link row clicks it", async () => {
  const el = (await mount(TILL)) as WtChoiceRow;
  // Following the link would take the test page away; this one runs first, whatever the row does.
  const stay = (event: Event) => event.preventDefault();
  window.addEventListener("click", stay, { capture: true });
  try {
    let clicks = 0;
    el.addEventListener("click", () => clicks++);
    await userEvent.click(anchor(el));
    expect(clicks).toBe(1);
    anchor(el).blur();
    el.focus();
    expect(el.shadowRoot!.activeElement).toBe(anchor(el));
    await userEvent.keyboard("{Enter}");
    expect(clicks).toBe(2);
  } finally {
    window.removeEventListener("click", stay, { capture: true });
  }
});
