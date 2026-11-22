import { describe, expect, test, vi } from "vitest";
import { padInputFor, registerPad, type PadKeyTarget } from "./pad-keys.js";

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

  test("Backspace deletes", () => {
    expect(padInputFor(keydown({ key: "Backspace" }), mode)).toEqual({
      kind: "key",
      key: "backspace",
    });
  });

  test("a held key means what its first press means", () => {
    expect(padInputFor(keydown({ key: "5", repeat: true }), mode)).toEqual({
      kind: "key",
      key: "5",
    });
    expect(padInputFor(keydown({ key: "Enter", repeat: true }), mode)).toEqual({ kind: "enter" });
  });

  test("Enter presses", () => {
    expect(padInputFor(keydown({ key: "Enter" }), mode)).toEqual({ kind: "enter" });
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

test("a key another listener already handled does not reach the pad", () => {
  const pad = Object.assign(document.createElement("div"), {
    mode: "decimal" as const,
    receiveKey: vi.fn(),
  }) as PadKeyTarget & { receiveKey: ReturnType<typeof vi.fn> };
  document.body.append(pad);
  const unregister = registerPad(pad);
  const handled = (event: Event) => event.preventDefault();
  try {
    const press = () =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "1", bubbles: true, cancelable: true }),
      );
    press();
    expect(pad.receiveKey).toHaveBeenCalledOnce();
    document.body.addEventListener("keydown", handled);
    press();
    expect(pad.receiveKey).toHaveBeenCalledOnce();
  } finally {
    document.body.removeEventListener("keydown", handled);
    unregister();
    pad.remove();
  }
});
