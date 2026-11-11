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
 * The print area a printout was laid out for, walking command by command so image and `GS ( k`
 * data is stepped over: its width, read from its own `GS W`, and a copy whose every `GS L` centres
 * it on a wider printer. Null for anything `EscBuilder` does not send, a command cut short by the
 * end, or unless every `GS W` names one width.
 */
export function readPrintArea(
  payload: Uint8Array,
): { widthDots: number; centredOn: (printerDots: number) => Uint8Array } | null {
  const margins: number[] = [];
  const widths = new Set<number>();
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
    if (command === GS_W) widths.add(at(offset + 2) | (at(offset + 3) << 8));
    offset += length;
  }
  if (widths.size !== 1) return null;
  const [widthDots] = widths;
  return {
    widthDots,
    centredOn: (printerDots) => {
      if (widthDots > printerDots) {
        throw new RangeError(
          `a printout ${widthDots} dots wide cannot be centred on ${printerDots} dots`,
        );
      }
      const margin = Math.floor((printerDots - widthDots) / 2);
      const centred = payload.slice();
      for (const position of margins) {
        centred[position + 2] = margin & 0xff;
        centred[position + 3] = margin >> 8;
      }
      return centred;
    },
  };
}

/** The print area's width in dots that a printout was laid out for; see {@link readPrintArea}. */
export function jobWidthDots(payload: Uint8Array): number | null {
  return readPrintArea(payload)?.widthDots ?? null;
}
