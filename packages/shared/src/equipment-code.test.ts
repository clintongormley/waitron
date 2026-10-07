import { describe, expect, it } from "vitest";
import { formatEquipmentCode, parseEquipmentCode } from "./equipment-code.js";

const ID = "0b3f6c1e-2a4d-4e8f-9a1b-7c6d5e4f3a2b";

describe("equipment code", () => {
  it.each(["printer", "reader"] as const)("formats a %s label as prefix, kind and id", (kind) => {
    expect(formatEquipmentCode(kind, ID)).toBe(`waitron-equipment:${kind}:${ID}`);
  });

  it.each(["printer", "reader"] as const)("reads back the %s label it formats", (kind) => {
    expect(parseEquipmentCode(formatEquipmentCode(kind, ID))).toEqual({ kind, id: ID });
  });

  it("reads an id written in upper case as the lower-case id the database stores", () => {
    expect(parseEquipmentCode(`waitron-equipment:reader:${ID.toUpperCase()}`)).toEqual({
      kind: "reader",
      id: ID,
    });
  });

  it.each([
    ["empty text", ""],
    ["a web address", "https://example.com"],
    ["another prefix", `other-equipment:printer:${ID}`],
    ["the prefix alone", "waitron-equipment:"],
    ["an unknown kind", `waitron-equipment:drawer:${ID}`],
    ["no kind", `waitron-equipment::${ID}`],
    ["a kind but no id", "waitron-equipment:printer:"],
    ["an id that is not a UUID", "waitron-equipment:printer:not-a-uuid"],
    ["an id one character short", `waitron-equipment:printer:${ID.slice(1)}`],
    ["an upper-case prefix", `WAITRON-EQUIPMENT:printer:${ID}`],
    ["an upper-case kind", `waitron-equipment:Printer:${ID}`],
    ["an extra segment", `waitron-equipment:printer:${ID}:extra`],
    ["trailing text", `waitron-equipment:printer:${ID} `],
    ["leading text", ` waitron-equipment:printer:${ID}`],
    ["text before the prefix", `xwaitron-equipment:printer:${ID}`],
  ])("refuses %s", (_label, text) => {
    expect(parseEquipmentCode(text)).toBeNull();
  });
});
