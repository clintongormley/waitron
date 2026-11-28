import { afterEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import "./wt-combobox.js";
import type { WtCombobox } from "./wt-combobox.js";

afterEach(cleanup);

const READERS = [
  { value: "r2", label: "Reader 2" },
  { value: "r3", label: "Reader 3" },
];

async function boxed(attributes = "") {
  const el = (await mount(
    `<wt-combobox look="boxed" label="Card reader" search="never" ${attributes}></wt-combobox>`,
  )) as WtCombobox;
  el.options = READERS;
  el.value = "r2";
  await el.updateComplete;
  const root = el.shadowRoot!;
  return {
    el,
    field: root.querySelector<HTMLElement>(".field")!,
    trigger: root.querySelector<HTMLButtonElement>(".trigger")!,
    label: root.querySelector<HTMLElement>(".field-label")!,
    value: root.querySelector<HTMLElement>(".value")!,
  };
}

test("the boxed look is a bordered box on the surface, as tall as a field, painted from tokens", async () => {
  const { field, label, value, trigger } = await boxed();
  expect(field.getBoundingClientRect().height).toBe(56);
  expect(label.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    value.getBoundingClientRect().top + 1,
  );
  host.style.setProperty("--wt-field-height", "60px");
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-surface", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  host.style.setProperty("--wt-radius-md", "9px");
  host.style.setProperty("--wt-font-size-sm", "11px");
  host.style.setProperty("--wt-font-size-lg", "19px");
  host.style.setProperty("--wt-font-weight-medium", "500");
  const box = getComputedStyle(field);
  expect(box.borderTopStyle).toBe("solid");
  expect(box.borderTopWidth).toBe("1px");
  expect(box.borderTopColor).toBe("rgb(1, 2, 3)");
  expect(box.borderBottomColor).toBe("rgb(1, 2, 3)");
  expect(box.borderTopLeftRadius).toBe("9px");
  expect(box.borderBottomRightRadius).toBe("9px");
  expect(box.backgroundColor).toBe("rgb(4, 5, 6)");
  expect(box.boxShadow).toBe("none");
  expect(field.getBoundingClientRect().height).toBe(60);
  expect(getComputedStyle(label).fontSize).toBe("11px");
  expect(getComputedStyle(label).color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(value).fontSize).toBe("19px");
  expect(getComputedStyle(value).fontWeight).toBe("500");
  expect(getComputedStyle(value).fontStyle).toBe("normal");
  expect(label.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    value.getBoundingClientRect().top + 1,
  );
  expect(trigger.querySelector('wt-icon.chevron[name="chevron-down"]')).not.toBeNull();
  expect(getComputedStyle(field, "::after").content).toBe("none");
});

test("highlight draws a thicker primary border on the lifted surface without moving the text", async () => {
  const { el, field, label, value } = await boxed();
  host.style.setProperty("--wt-color-primary", "rgb(10, 11, 12)");
  host.style.setProperty("--wt-color-surface-lifted", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-field-line-width-active", "2px");
  const before = { label: label.getBoundingClientRect(), value: value.getBoundingClientRect() };
  const height = field.getBoundingClientRect().height;
  el.highlight = true;
  await el.updateComplete;
  const box = getComputedStyle(field);
  expect(box.borderTopWidth).toBe("2px");
  expect(box.borderTopColor).toBe("rgb(10, 11, 12)");
  expect(box.backgroundColor).toBe("rgb(13, 14, 15)");
  expect(field.getBoundingClientRect().height).toBe(height);
  expect(label.getBoundingClientRect().top).toBe(before.label.top);
  expect(label.getBoundingClientRect().left).toBe(before.label.left);
  expect(value.getBoundingClientRect().top).toBe(before.value.top);
  expect(value.getBoundingClientRect().left).toBe(before.value.left);
});

test("highlight does nothing to the filled look", async () => {
  const el = (await mount(
    '<wt-combobox label="Card reader" highlight></wt-combobox>',
  )) as WtCombobox;
  host.style.setProperty("--wt-color-field-fill", "rgb(1, 2, 3)");
  const field = el.shadowRoot!.querySelector<HTMLElement>(".field")!;
  expect(getComputedStyle(field).backgroundColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(field).borderTopStyle).toBe("none");
});

test("a focused or open boxed field draws its border in the primary colour", async () => {
  const { el, field, trigger } = await boxed();
  host.style.setProperty("--wt-color-primary", "rgb(10, 11, 12)");
  host.style.setProperty("--wt-field-line-width-active", "2px");
  trigger.focus();
  expect(getComputedStyle(field).borderTopColor).toBe("rgb(10, 11, 12)");
  expect(getComputedStyle(field).borderTopWidth).toBe("2px");
  expect(getComputedStyle(field).boxShadow).toBe("none");
  await userEvent.click(trigger);
  await el.updateComplete;
  expect(field.hasAttribute("data-open")).toBe(true);
  expect(trigger.matches(":focus")).toBe(false);
  expect(getComputedStyle(field).borderTopColor).toBe("rgb(10, 11, 12)");
  expect(getComputedStyle(field).boxShadow).toBe("none");
});

test("an invalid boxed field draws its border and label in the danger colour", async () => {
  const { field, label } = await boxed('error="Choose a reader"');
  host.style.setProperty("--wt-color-danger", "rgb(16, 17, 18)");
  host.style.setProperty("--wt-field-line-width-active", "2px");
  expect(getComputedStyle(field).borderTopColor).toBe("rgb(16, 17, 18)");
  expect(getComputedStyle(field).borderTopWidth).toBe("2px");
  expect(getComputedStyle(field).boxShadow).toBe("none");
  expect(getComputedStyle(label).color).toBe("rgb(16, 17, 18)");
});

test("a disabled boxed field draws a dashed border on the disabled fill and does not open", async () => {
  const { el, field, trigger } = await boxed("disabled");
  host.style.setProperty("--wt-color-field-fill-disabled", "rgb(19, 20, 21)");
  host.style.setProperty("--wt-color-text-muted", "rgb(22, 23, 24)");
  expect(getComputedStyle(field).borderTopStyle).toBe("dashed");
  expect(getComputedStyle(field).backgroundColor).toBe("rgb(19, 20, 21)");
  expect(getComputedStyle(field, "::after").content).toBe("none");
  expect(getComputedStyle(trigger).color).toBe("rgb(22, 23, 24)");
  await userEvent.click(trigger, { force: true });
  expect(el.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
});

test("the default look stays the filled one", async () => {
  const el = (await mount('<wt-combobox label="Card reader"></wt-combobox>')) as WtCombobox;
  expect(el.look).toBe("filled");
  expect(el.shadowRoot!.querySelector(".field")!.hasAttribute("data-boxed")).toBe(false);
});
