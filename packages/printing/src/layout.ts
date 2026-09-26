/**
 * Text passed to the wrapping helpers must already be prepared for the printer's character set
 * (`prepareText`), so one character is one printed column.
 */
export type PaperWidth = "58mm" | "80mm";
export type Resolution = "180dpi" | "203dpi";

const COLUMNS: Readonly<Record<PaperWidth, number>> = { "58mm": 30, "80mm": 42 };

/** A 12-dot character: 42 × 12 = 504 fits the TM-T88III's 512-dot line; 30 × 12 = 360 its 58 mm line. */
export const DOTS_PER_COLUMN = 12;

export function columnsFor(width: PaperWidth): number {
  return COLUMNS[width];
}

/** The printable width images must stay within: 360 dots on 58mm, 504 on 80mm. */
export function safeWidthDots(width: PaperWidth): number {
  return COLUMNS[width] * DOTS_PER_COLUMN;
}

export function dpiValue(resolution: Resolution): 180 | 203 {
  return resolution === "203dpi" ? 203 : 180;
}

/**
 * Break `text` into lines of at most `columns` characters. Spaces at the start of `text` are kept as
 * the first line's indent; every later line starts with `indent` spaces. Lines break at spaces, runs
 * of spaces inside a line are kept, spaces at a break are dropped, and a word longer than the room
 * left on a line is split. Both indents are capped at `columns - 1` so a line always has room.
 */
export function wrapText(text: string, columns: number, indent = 0): string[] {
  const lead = /^ */.exec(text)![0].length;
  const firstPrefix = " ".repeat(Math.min(lead, columns - 1));
  const nextPrefix = " ".repeat(Math.min(indent, columns - 1));
  const lines: string[] = [];
  let prefix = firstPrefix;
  let line = "";
  const room = (): number => columns - prefix.length;
  const flush = (): void => {
    lines.push(prefix + line.replace(/ +$/, ""));
    prefix = nextPrefix;
    line = "";
  };
  for (let word of text.slice(lead).split(" ")) {
    if (line !== "") {
      if (line.length + 1 + word.length <= room()) {
        line += " " + word;
        continue;
      }
      flush();
    }
    if (word === "") continue;
    while (word.length > room()) {
      const take = room();
      line = word.slice(0, take);
      word = word.slice(take);
      flush();
    }
    line = word;
  }
  if (line !== "" || lines.length === 0) flush();
  return lines;
}

/**
 * A label with an amount at the right-hand edge. The label wraps as {@link wrapText} does, with
 * continuation lines indented by `indent`. The amount goes at the end of the label's last line when at
 * least one space is left between them; otherwise it takes lines of its own, right-aligned, wrapped
 * like any other text when it is wider than the paper. No line is longer than `columns`.
 */
export function labelAmountLines(
  label: string,
  amount: string,
  columns: number,
  indent = 0,
): string[] {
  const lines = wrapText(label, columns, indent);
  const last = lines[lines.length - 1]!;
  if (last.length + 1 + amount.length <= columns) {
    lines[lines.length - 1] = last + " ".repeat(columns - last.length - amount.length) + amount;
    return lines;
  }
  for (const part of wrapText(amount, columns)) lines.push(part.padStart(columns));
  return lines;
}

const QR_MAX_MM = 40;
/** The QR standard's blank border, in squares per side, counted when fitting the paper. */
export const QR_QUIET_ZONE = 4;

/**
 * Dots per QR square for a code `squares` wide (without its border) on a `dpi` printer whose images
 * must fit `safeWidthDots`. Uses the largest whole-dot scale up to 40 mm, including the blank border
 * when checking the paper width. Falls back to 1 when nothing fits rather than blocking a sale.
 */
export function chooseQrDots(squares: number, dpi: number, safeWidthDots: number): number {
  let best = 1;
  for (let dots = 1; (squares + 2 * QR_QUIET_ZONE) * dots <= safeWidthDots; dots++) {
    const mm = (squares * dots * 25.4) / dpi;
    if (mm > QR_MAX_MM) break;
    best = dots;
  }
  return best;
}

/** A new square matrix with `quiet` light modules added on every side. */
export function withQuietZone(
  modules: readonly (readonly boolean[])[],
  quiet: number,
): boolean[][] {
  const side = modules.length + 2 * quiet;
  const blank = (): boolean[] => new Array<boolean>(side).fill(false);
  const margin = new Array<boolean>(quiet).fill(false);
  return [
    ...Array.from({ length: quiet }, blank),
    ...modules.map((row) => [...margin, ...row, ...margin]),
    ...Array.from({ length: quiet }, blank),
  ];
}
