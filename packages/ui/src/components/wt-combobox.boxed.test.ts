import { afterEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-combobox.js";
import type { WtCombobox } from "./wt-combobox.js";

afterEach(cleanup);

const TOKENS = {
  "--wt-field-height": "60px",
  "--wt-color-border": "rgb(1, 2, 3)",
  "--wt-color-surface": "rgb(4, 5, 6)",
  "--wt-color-text-muted": "rgb(7, 8, 9)",
  "--wt-radius-md": "9px",
  "--wt-font-size-sm": "11px",
  "--wt-font-size-lg": "19px",
  "--wt-font-weight-medium": "500",
  "--wt-color-primary": "rgb(10, 11, 12)",
  "--wt-color-surface-lifted": "rgb(13, 14, 15)",
  "--wt-field-line-width-active": "2px",
  "--wt-color-danger": "rgb(16, 17, 18)",
  "--wt-color-field-fill-disabled": "rgb(19, 20, 21)",
};

async function boxed(attributes = "") {
  const el = (await mount(
    `<wt-combobox variant="boxed" label="Card reader" ${attributes} search="never"></wt-combobox>`,
  )) as WtCombobox;
  for (const [name, setting] of Object.entries(TOKENS)) host.style.setProperty(name, setting);
  el.options = [{ value: "r2", label: "Reader 2" }];
  el.value = "r2";
  await el.updateComplete;
  const part = (name: string) => el.shadowRoot!.querySelector<HTMLElement>(name)!;
  const [field, label, value] = [part(".field"), part(".field-label"), part(".value")];
  const border = () => {
    const box = getComputedStyle(field);
    return [box.borderTopStyle, box.borderTopWidth, box.borderTopColor, box.backgroundColor];
  };
  const text = () => [label, value].map((line) => line.getBoundingClientRect().toJSON());
  return { el, field, label, value, border, text, trigger: part(".trigger") };
}

test("boxed and highlighted looks paint from tokens without moving the text; filled ignores highlight", async () => {
  const { el, field, border, label, value, text } = await boxed();
  expect(border()).toEqual(["solid", "1px", "rgb(1, 2, 3)", "rgb(4, 5, 6)"]);
  expect(getComputedStyle(field).borderBottomRightRadius).toBe("9px");
  expect(getComputedStyle(field, "::after").content).toBe("none");
  expect(field.getBoundingClientRect().height).toBe(60);
  const [labelStyle, valueStyle] = [getComputedStyle(label), getComputedStyle(value)];
  expect([
    labelStyle.fontSize,
    labelStyle.color,
    valueStyle.fontSize,
    valueStyle.fontWeight,
  ]).toEqual(["11px", "rgb(7, 8, 9)", "19px", "500"]);
  expect(text()[0]!.bottom).toBeLessThanOrEqual(text()[1]!.top + 1);
  const before = text();

  el.highlight = true;
  await el.updateComplete;
  expect(border()).toEqual(["solid", "2px", "rgb(10, 11, 12)", "rgb(13, 14, 15)"]);
  expect(text()).toEqual(before);

  el.variant = "filled";
  await el.updateComplete;
  expect(border()[0]).toBe("none");
});

test("a boxed field's focused, open, invalid and disabled borders, and no filled line open with a search box", async () => {
  const open = await boxed();
  open.trigger.focus();
  expect(open.border().slice(1, 3)).toEqual(["2px", "rgb(10, 11, 12)"]);
  await userEvent.click(open.trigger);
  open.trigger.blur();
  expect(open.border().slice(1, 3)).toEqual(["2px", "rgb(10, 11, 12)"]);
  expect(getComputedStyle(open.field).boxShadow).toBe("none");

  cleanup();
  const searching = await boxed('search="always"');
  await userEvent.click(searching.trigger);
  expect(searching.field.hasAttribute("data-search")).toBe(true);
  expect(searching.border().slice(1, 3)).toEqual(["1px", "rgb(1, 2, 3)"]);
  expect(getComputedStyle(searching.field).boxShadow).toBe("none");

  const invalid = await boxed('error="Choose a reader"');
  expect(invalid.border().slice(1, 3)).toEqual(["2px", "rgb(16, 17, 18)"]);
  expect(getComputedStyle(invalid.label).color).toBe("rgb(16, 17, 18)");

  const disabled = await boxed("disabled");
  expect([disabled.border()[0], disabled.border()[3]]).toEqual(["dashed", "rgb(19, 20, 21)"]);
});
