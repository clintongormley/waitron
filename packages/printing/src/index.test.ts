import { describe, expect, it } from "vitest";
import {
  chooseQrDots,
  columnsFor,
  decodeBytes,
  dpiValue,
  encodeText,
  esc,
  labelAmountLines,
  prepareText,
  QR_QUIET_ZONE,
  safeWidthDots,
  withQuietZone,
  wrapText,
} from "./index.js";

describe("package barrel", () => {
  it("re-exports the layout and character-set helpers", () => {
    expect(columnsFor("80mm")).toBe(42);
    expect(safeWidthDots("58mm")).toBe(360);
    expect(dpiValue("203dpi")).toBe(203);
    expect(QR_QUIET_ZONE).toBe(4);
    expect(chooseQrDots(45, 180, 504)).toBe(6);
    expect(encodeText("€", "pc858")).toEqual([0xd5]);
    expect(decodeBytes([0xd5], "pc858")).toBe("€");
    expect(prepareText("€", "plain")).toBe("EUR");
    expect(labelAmountLines("A", "B", 10)).toEqual(["A        B"]);
    expect(wrapText("a b", 1)).toEqual(["a", "b"]);
    expect(withQuietZone([[true]], 1)[1]).toEqual([false, true, false]);
    expect([...esc("pc858").init().bytes()]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19, 0x1c, 0x2e]);
  });
});
