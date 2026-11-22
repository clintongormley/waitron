import { afterEach, expect, it } from "vitest";
import { currentLocale, setLocale } from "../i18n/t.js";
import { groupName, groupNumberText } from "./group-name.js";

const previous = currentLocale();
afterEach(() => setLocale(previous));

it("gives a group with no number no text and no name", () => {
  expect(groupNumberText({ displayNumber: null })).toBe("");
  expect(groupName({ displayNumber: null })).toBe("");
});

it("numbers a group, with its party's label when it has one", () => {
  setLocale("en-GB");
  expect(groupNumberText({ displayNumber: 3 })).toBe("3");
  expect(groupName({ displayNumber: 3, numberPartyLabel: "Table 4" })).toBe("Group 3 · Table 4");
});
