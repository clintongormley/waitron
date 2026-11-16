import {
  chooseQrDots,
  dpiValue,
  esc,
  prepareText,
  QR_QUIET_ZONE,
  safeWidthDots,
  withQuietZone,
  wrapText,
  type EscSetting,
} from "@waitron/printing";
import { formatEquipmentCode, type EquipmentKind } from "@waitron/shared";
import { qrModules } from "./qr-matrix.js";

export function formatEquipmentLabel(
  printer: EscSetting,
  label: { kind: EquipmentKind; id: string; name: string },
): Uint8Array {
  const b = esc(printer);
  const { columns, widthDots } = b.grid;
  b.init().printArea(widthDots).align("center");
  for (const line of wrapText(prepareText(label.name), Math.floor(columns / 2))) {
    b.line(line, { double: true });
  }
  const code = formatEquipmentCode(label.kind, label.id);
  const matrix = qrModules(code);
  b.qrRaster(withQuietZone(matrix, QR_QUIET_ZONE), {
    moduleSize: chooseQrDots(
      matrix.length,
      dpiValue(printer.resolution),
      safeWidthDots(printer.paperWidth),
    ),
  });
  for (const line of wrapText(code, columns)) b.line(line);
  return b.feedAndCut().bytes();
}
