import { expect, it } from "vitest";
import { withPrintedParts } from "./printed-set-menu-parts.js";

const menu = { setMenuRole: "set_menu" as const, setMenuPart: -1400 };
const lemonade = { setMenuRole: "dish" as const, setMenuPart: 228 };
const plain = { setMenuRole: null, setMenuPart: null };

it("keeps every part beside a divided set menu's own row", () => {
  expect(withPrintedParts([menu, lemonade, plain])).toEqual([menu, lemonade, plain]);
});

it("drops a dish's part when no divided set menu's row is on the document", () => {
  const goodwill = { setMenuRole: "dish" as const, setMenuPart: -200 };
  expect(withPrintedParts([goodwill, plain])).toEqual([{ ...goodwill, setMenuPart: null }, plain]);
});

it("does not count a set menu filed whole as a divided one", () => {
  const whole = { setMenuRole: "set_menu" as const, setMenuPart: null };
  expect(withPrintedParts([whole, lemonade])).toEqual([whole, { ...lemonade, setMenuPart: null }]);
});
