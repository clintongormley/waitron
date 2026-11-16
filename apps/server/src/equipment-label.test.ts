import jsQR from "jsqr";
import { expect, it } from "vitest";
import { SETTING_WIDTHS } from "@waitron/printing";
import { formatEquipmentCode } from "@waitron/shared";
import { formatEquipmentLabel } from "./equipment-label.js";
import { printedCommands, opensDrawer, commandNames } from "./testing/decode-ticket.js";
const ID = "0b3f6c1e-2a4d-4e8f-9a1b-7c6d5e4f3a2b";
it.each(SETTING_WIDTHS)("keeps the name and QR readable within $widthDots dots", (printer) => {
  const name = "Café Portable With A Long Name";
  const payload = formatEquipmentLabel(printer, { kind: "printer", id: ID, name });
  const commands = printedCommands(payload);
  const bands = commands.filter((c) => c.name === "GS v 0" && c.heightDots === 56);
  expect(bands.length).toBeGreaterThan(0);
  const decoded = bands
    .map((band) => {
      expect(band.widthDots).toBe(printer.widthDots);
      expect(band.text).toBeDefined();
      return band.text!.trim();
    })
    .join(" ");
  expect(decoded).toBe(name);
  const qr = commands.find((c) => c.name === "GS v 0" && c.heightDots! > 56)!;
  expect(qr.widthDots).toBeLessThanOrEqual(printer.widthDots);
  const rgba = new Uint8ClampedArray(qr.widthDots! * qr.heightDots! * 4).fill(255),
    bits = qr.bytes.subarray(8);
  for (let y = 0; y < qr.heightDots!; y++)
    for (let x = 0; x < qr.widthDots!; x++)
      if (bits[y * Math.ceil(qr.widthDots! / 8) + (x >> 3)]! & (0x80 >> (x & 7)))
        rgba.fill(0, (y * qr.widthDots! + x) * 4, (y * qr.widthDots! + x) * 4 + 3);
  expect(jsQR(rgba, qr.widthDots!, qr.heightDots!)?.data).toBe(formatEquipmentCode("printer", ID));
  expect(opensDrawer(payload)).toBe(false);
  expect(commandNames(payload).slice(-2)).toEqual(["ESC d", "GS V"]);
});
