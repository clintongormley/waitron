const ESC = 0x1b;
const GS = 0x1d;
const GS_L = (GS << 8) | 0x4c;
const GS_W = (GS << 8) | 0x57;

/** The fixed-length commands `EscBuilder` sends, by their first two bytes. */
const FIXED: ReadonlyMap<number, number> = new Map([
  [(ESC << 8) | 0x40, 2],
  [(ESC << 8) | 0x61, 3],
  [(ESC << 8) | 0x64, 3],
  [(ESC << 8) | 0x70, 5],
  [(GS << 8) | 0x56, 3],
  [GS_L, 4],
  [GS_W, 4],
]);

/**
 * The offsets of every `GS L` and the width of every `GS W`, walking command by command so image
 * and `GS ( k` data is stepped over; null for anything `EscBuilder` does not send or a command cut
 * short by the end.
 */
function walk(payload: Uint8Array): { margins: number[]; widths: number[] } | null {
  const margins: number[] = [];
  const widths: number[] = [];
  const at = (i: number): number => payload[i] ?? 0;
  let offset = 0;
  while (offset < payload.length) {
    const command = (payload[offset]! << 8) | at(offset + 1);
    let length = FIXED.get(command);
    if (command === ((GS << 8) | 0x76) && at(offset + 2) === 0x30) {
      length =
        8 + (at(offset + 4) | (at(offset + 5) << 8)) * (at(offset + 6) | (at(offset + 7) << 8));
    } else if (command === ((GS << 8) | 0x28) && at(offset + 2) === 0x6b) {
      length = 5 + (at(offset + 3) | (at(offset + 4) << 8));
    }
    if (length === undefined || offset + length > payload.length) return null;
    if (command === GS_L) margins.push(offset);
    if (command === GS_W) widths.push(at(offset + 2) | (at(offset + 3) << 8));
    offset += length;
  }
  return { margins, widths };
}

/**
 * The print area's width in dots that a printout was laid out for, read from its own `GS W`; null
 * unless every `GS W` names one width. Works on the first ten bytes alone.
 */
export function jobWidthDots(payload: Uint8Array): number | null {
  const found = walk(payload);
  if (found === null || found.widths.length === 0) return null;
  const [width] = found.widths;
  return found.widths.every((each) => each === width) ? width! : null;
}

/** A copy whose every `GS L` centres the printout's width on a printer `printerDots` wide. */
export function centredForPrinter(payload: Uint8Array, printerDots: number): Uint8Array {
  const width = jobWidthDots(payload);
  if (width === null || width > printerDots) {
    throw new RangeError(`a printout ${width} dots wide cannot be centred on ${printerDots} dots`);
  }
  const margin = Math.floor((printerDots - width) / 2);
  const centred = payload.slice();
  for (const offset of walk(payload)!.margins) {
    centred[offset + 2] = margin & 0xff;
    centred[offset + 3] = margin >> 8;
  }
  return centred;
}
