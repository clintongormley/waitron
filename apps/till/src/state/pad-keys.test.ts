import { describe, expect, test } from "vitest";
import { padInputFor } from "./pad-keys.js";

function keydown(init: KeyboardEventInit, keyCode?: number): KeyboardEvent {
  const event = new KeyboardEvent("keydown", init);
  if (keyCode !== undefined) Object.defineProperty(event, "keyCode", { value: keyCode });
  return event;
}

const digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

describe.each(["decimal", "pin"] as const)("on a %s pad", (mode) => {
  test("each digit types that digit", () => {
    for (const digit of digits)
      expect(padInputFor(keydown({ key: digit }), mode)).toEqual({ kind: "key", key: digit });
  });

  test("a digit typed with Shift, as on a French keyboard, types that digit", () => {
    expect(padInputFor(keydown({ key: "1", code: "Digit1", shiftKey: true }), mode)).toEqual({
      kind: "key",
      key: "1",
    });
  });

  test("a digit on the number block types that digit", () => {
    expect(padInputFor(keydown({ key: "7", code: "Numpad7" }), mode)).toEqual({
      kind: "key",
      key: "7",
    });
  });

  test("Backspace deletes, also while held down", () => {
    expect(padInputFor(keydown({ key: "Backspace" }), mode)).toEqual({
      kind: "key",
      key: "backspace",
    });
    expect(padInputFor(keydown({ key: "Backspace", repeat: true }), mode)).toEqual({
      kind: "key",
      key: "backspace",
    });
  });

  test("a held digit types only once", () => {
    expect(padInputFor(keydown({ key: "5", repeat: true }), mode)).toBeNull();
  });

  test("Enter presses, but not while held down", () => {
    expect(padInputFor(keydown({ key: "Enter" }), mode)).toEqual({ kind: "enter" });
    expect(padInputFor(keydown({ key: "Enter", repeat: true }), mode)).toBeNull();
  });

  test("Escape backs out", () => {
    expect(padInputFor(keydown({ key: "Escape" }), mode)).toEqual({ kind: "escape" });
  });

  test("a key held with Ctrl, Meta or Alt means nothing", () => {
    for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const) {
      expect(padInputFor(keydown({ key: "1", [modifier]: true }), mode)).toBeNull();
      expect(padInputFor(keydown({ key: "Enter", [modifier]: true }), mode)).toBeNull();
    }
  });

  test("a key that belongs to a composition means nothing", () => {
    expect(padInputFor(keydown({ key: "1", isComposing: true }), mode)).toBeNull();
    expect(padInputFor(keydown({ key: "1" }, 229), mode)).toBeNull();
  });

  test("letters, End and Tab mean nothing", () => {
    for (const key of ["a", "End", "Tab"]) expect(padInputFor(keydown({ key }), mode)).toBeNull();
  });
});

test("on a decimal pad both point and comma are the decimal key, and Delete means nothing", () => {
  expect(padInputFor(keydown({ key: "." }), "decimal")).toEqual({ kind: "key", key: "." });
  expect(padInputFor(keydown({ key: "," }), "decimal")).toEqual({ kind: "key", key: "." });
  expect(padInputFor(keydown({ key: "Delete" }), "decimal")).toBeNull();
});

test("on a PIN pad point and comma mean nothing, and Delete clears", () => {
  expect(padInputFor(keydown({ key: "." }), "pin")).toBeNull();
  expect(padInputFor(keydown({ key: "," }), "pin")).toBeNull();
  expect(padInputFor(keydown({ key: "Delete" }), "pin")).toEqual({ kind: "key", key: "clear" });
});
