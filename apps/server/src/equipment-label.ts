import {
  chooseQrDots,
  dpiValue,
  drawTextBand,
  esc,
  gridForWidth,
  prepareText,
  QR_QUIET_ZONE,
  safeWidthDots,
  TEXT_BAND_HEIGHT,
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
  const headingGrid = gridForWidth(Math.floor(widthDots / 16) * 8);
  const stride = headingGrid.widthDots / 8;
  const inset = (widthDots - headingGrid.widthDots * 2) / 2;
  b.init().printArea(widthDots).align("center");
  for (const line of wrapText(prepareText(label.name), headingGrid.columns)) {
    const band = drawTextBand(line, headingGrid, "center");
    b.raster(widthDots, TEXT_BAND_HEIGHT * 2, (x, y) => {
      const sourceX = Math.floor((x - inset) / 2);
      return (
        sourceX >= 0 &&
        sourceX < headingGrid.widthDots &&
        (band[Math.floor(y / 2) * stride + (sourceX >> 3)]! & (0x80 >> (sourceX & 7))) !== 0
      );
    });
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
