import { render } from "lit";
import { afterEach, expect, test } from "vitest";
import { cleanup, mount } from "./test-helpers.js";
import "./components/wt-input.js";
import { fieldLabel, fieldLabelState, fieldStyles } from "./field-styles.js";

test("a label rests only while there is no value, hint or placeholder, and the type is not a date or time", () => {
  const empty = { value: "", hint: "", placeholder: "" };
  expect(fieldLabelState(empty)).toBe("rest");
  expect(fieldLabelState({ ...empty, type: "text" })).toBe("rest");
  expect(fieldLabelState({ ...empty, value: "x" })).toBe("float");
  expect(fieldLabelState({ ...empty, hint: "h" })).toBe("float");
  expect(fieldLabelState({ ...empty, placeholder: "p" })).toBe("float");
  for (const type of ["date", "time", "datetime-local", "month", "week"]) {
    expect(fieldLabelState({ ...empty, type }), type).toBe("float");
  }
});

test("the stylesheet floats a resting label while the browser has autofilled its control (checks the rule is there and parses, not that a browser fills it)", () => {
  expect(fieldStyles.cssText).toContain(":has(:autofill)");
  const rest = [...fieldStyles.styleSheet!.cssRules].find(
    (rule): rule is CSSStyleRule =>
      rule instanceof CSSStyleRule && rule.selectorText.includes('[data-label="rest"]'),
  );
  expect(rest?.selectorText).toContain(":not(:has(:autofill))");
  expect(rest?.style.fontSize).toBe("inherit");
});

test("a date or time type floats the label whatever the case it is written in, as the browser reads it", () => {
  const empty = { value: "", hint: "", placeholder: "" };
  for (const type of ["DATE", "Time", "DateTime-Local", "MONTH", "Week"]) {
    const input = document.createElement("input");
    input.setAttribute("type", type);
    expect(input.type, "the browser's reading").toBe(type.toLowerCase());
    expect(fieldLabelState({ ...empty, type }), type).toBe("float");
  }
});

test("the field label points at its control, holds its text in the part an ellipsis cuts, and stars only a required field", () => {
  const box = document.createElement("div");
  render(fieldLabel("price", "Price", true), box);
  const label = box.querySelector("label.field-label")!;
  expect(label.getAttribute("for")).toBe("price");
  expect(label.querySelector(".field-label-text")?.textContent).toBe("Price");
  const star = label.querySelector(".required[data-required]");
  expect(star?.textContent).toBe("*");
  expect(star?.getAttribute("aria-hidden")).toBe("true");
  expect(label.textContent).toBe("Price*");

  render(fieldLabel("price", "Price", false), box);
  expect(box.querySelector("[data-required]")).toBeNull();
  expect(box.querySelector("label")!.textContent).toBe("Price");
});

afterEach(cleanup);
test("an error wraps within its field without widening its neighbour", async () => {
  const row = await mount(
    '<div style="display:inline-flex"><wt-input label="Code" value="x" style="width:max-content"></wt-input><span>Next</span></div>',
  );
  const field = row.querySelector("wt-input")!;
  await field.updateComplete;
  const neighbour = row.querySelector("span")!;
  const before = {
    width: field.getBoundingClientRect().width,
    left: neighbour.getBoundingClientRect().left,
  };
  field.error = "Choose an available configuration for the counterrevolutionaries.";
  await field.updateComplete;
  expect(field.getBoundingClientRect().width).toBe(before.width);
  expect(neighbour.getBoundingClientRect().left).toBe(before.left);
  field.style.width = "72px";
  const error = field.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
  expect(error.scrollWidth).toBeLessThanOrEqual(error.clientWidth);
  const range = document.createRange();
  range.selectNodeContents(error);
  expect(
    new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
  ).toBeGreaterThan(1);
  expect(range.getBoundingClientRect().height).toBeLessThanOrEqual(
    error.getBoundingClientRect().height,
  );
  expect(
    field.shadowRoot!.querySelector("input")!.getAttribute("aria-describedby")?.split(" "),
  ).toContain(error.id);
});
