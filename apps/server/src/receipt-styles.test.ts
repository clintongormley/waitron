import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReceiptElement } from "./receipt-document.js";
import { formatReceipt } from "./receipt-ticket.js";
import { FULL_INVOICE_FIXTURE } from "./testing/full-invoice-fixture.js";
import { printedCommands } from "./testing/decode-ticket.js";

// No document yet asks for every style, so these cases replace the built document's elements.
const injected = vi.hoisted(() => ({ elements: undefined as ReceiptElement[] | undefined }));
vi.mock("./receipt-document.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("./receipt-document.js")>();
  return {
    ...real,
    buildReceiptDocument: (input: Parameters<typeof real.buildReceiptDocument>[0]) => {
      const document = real.buildReceiptDocument(input);
      return injected.elements === undefined
        ? document
        : { ...document, elements: injected.elements };
    },
  };
});

afterEach(() => {
  injected.elements = undefined;
});

const PLAIN: ReceiptElement = { kind: "text", text: "Gracias", indent: 0 };
const BOLD: ReceiptElement = { ...PLAIN, style: { bold: true } };

describe("styled elements on the roll", () => {
  const drawn = (elements: ReceiptElement[]) => {
    injected.elements = elements;
    return printedCommands(
      formatReceipt({
        ...FULL_INVOICE_FIXTURE,
        printer: { paperWidth: "58mm", resolution: "180dpi" },
      }),
    ).filter((command) => command.text !== undefined);
  };

  it("draws bold text, double text and a bold amount with their weight and size", () => {
    const ink = (line: { bytes: Uint8Array }) =>
      line.bytes.subarray(8).reduce((count, byte) => {
        let bits = 0;
        for (let value = byte; value > 0; value >>= 1) bits += value & 1;
        return count + bits;
      }, 0);
    const lines = drawn([
      BOLD,
      { kind: "text", text: "Grande", indent: 0, style: { double: true } },
      { kind: "amount", caption: "Base", amount: "1,00 €", indent: 0, style: { bold: true } },
      { kind: "amount", caption: "Base", amount: "1,00 €", indent: 0 },
      PLAIN,
    ]);
    expect(lines.map((line) => [line.text!.trimEnd(), line.heightDots])).toEqual([
      ["Gracias", 28],
      ["Grande", 56],
      [expect.stringMatching(/^Base +1,00 €$/u), 28],
      [expect.stringMatching(/^Base +1,00 €$/u), 28],
      ["Gracias", 28],
    ]);
    expect(ink(lines[0]!)).toBeGreaterThan(ink(lines[4]!) * 1.1);
    expect(ink(lines[2]!)).toBeGreaterThan(ink(lines[3]!) * 1.1);
  });

  it("wraps a double text line at half of 58 mm's 30 columns, each line 56 dots high", () => {
    const lines = drawn([
      {
        kind: "text",
        text: "Gracias por su visita, hasta pronto",
        indent: 0,
        style: { double: true },
      },
    ]);
    expect(lines.map((line) => line.text!.trimEnd())).toEqual([
      "Gracias por su",
      "visita, hasta",
      "pronto",
    ]);
    expect(lines.map((line) => line.heightDots)).toEqual([56, 56, 56]);
  });

  it("measures a double line's hanging indent against the half width it is drawn in", () => {
    const lines = drawn([
      {
        kind: "text",
        text: "12345678  Croquetas caseras de jamón",
        indent: { after: "12345678  " },
        style: { double: true },
      },
    ]);
    expect(lines.map((line) => line.text!.trimEnd())).toEqual([
      "12345678",
      "  Croquetas",
      "  caseras de",
      "  jamón",
    ]);
  });
});
