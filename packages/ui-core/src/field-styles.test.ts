import { expect, test } from "vitest";
import { fieldLabelState, fieldStyles } from "./field-styles.js";

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
  expect(rest?.style.fontSize).toBe("var(--wt-field-label-rest-size)");
});
