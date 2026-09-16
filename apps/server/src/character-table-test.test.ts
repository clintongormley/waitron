import { describe, expect, it } from "vitest";
import { encodeText } from "@waitron/printing";
import { bytesInclude } from "./testing/decode-ticket.js";
import { formatCharacterTableTest } from "./character-table-test.js";

describe("formatCharacterTableTest", () => {
  it("prints sixteen numbered tables with both supported encodings", () => {
    const bytes = formatCharacterTableTest(6);
    expect(
      bytesInclude(
        bytes,
        Uint8Array.from([0x1b, 0x74, 6, ...encodeText("T006 W: Café", "wpc1252")]),
      ),
    ).toBe(true);
    expect(
      bytesInclude(bytes, Uint8Array.from([0x1b, 0x74, 6, ...encodeText("T006 8: Café", "pc858")])),
    ).toBe(true);
    expect(
      bytesInclude(
        bytes,
        Uint8Array.from([0x1b, 0x74, 21, ...encodeText("T021 8: Café", "pc858")]),
      ),
    ).toBe(true);
  });

  it("rejects a batch that starts outside the byte range", () => {
    expect(() => formatCharacterTableTest(-1)).toThrow(RangeError);
    expect(() => formatCharacterTableTest(256)).toThrow(RangeError);
  });
});
