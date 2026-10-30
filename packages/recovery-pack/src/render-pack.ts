import PDFDocument from "pdfkit";
import { create, type Font } from "fontkit";
import { PACK_WORDS, type PackLocale } from "./i18n/pack-words.js";
import {
  buildRecoveryPackFile,
  PACK_ATTACHMENT,
  RecoveryPackFileError,
  type RecoveryPackFile,
} from "./pack-file.js";
import type { PackPart, RecoveryPackPage, ServerKeyLocation } from "./page.js";
import { qrModules } from "./qr.js";
import { MAX_PACK_PDF } from "./read-pack-pdf.js";

export type { PackPart, RecoveryPackPage, ServerKeyLocation } from "./page.js";

export type RenderPackInput = {
  locale: PackLocale;
  timeZone: string;
  loadFont: () => Promise<Uint8Array>;
  cover: {
    legalName: string;
    taxId: string;
    venueName: string;
    madeAt: string;
    /** `null` for the pack setup makes. */
    madeBy: string | null;
    number: number;
  };
  /** In the order their pages are printed. */
  parts: PackPart[];
  file: RecoveryPackFile;
  /** Defaults to {@link MAX_PACK_PDF}. */
  maxBytes?: number;
};

function refuse(what: string): never {
  throw new Error(`Recovery pack refused: ${what}`);
}

const LEFT = 48;
const TOP = 80;
const BOTTOM = 72;
const QR_SIZE = 160;
const GREY = "#555555";
const LINE = "#bbbbbb";
const FILL = "#eeeeee";
/** The text sizes a page is tried at, largest first; a part's secret is always drawn full size. */
const SCALES = [1, 0.9, 0.8, 0.7];
/** The tallest a name or table cell is drawn; past it, the text is cut and marked. */
const TALLEST_CELL = 96;
const ELLIPSIS = "\u2026";

/** The page each printed part is on: the cover is page 1, then one page per included or failed part. */
export function packPageNumbers(parts: readonly PackPart[]): Map<PackPart, number> {
  const pageOf = new Map<PackPart, number>();
  for (const part of parts)
    if (part.state === "included" || part.state === "failed") pageOf.set(part, pageOf.size + 2);
  return pageOf;
}

/** How the pack prints instants (in `timeZone`) and `YYYY-MM-DD` days. */
export function packDates(locale: PackLocale, timeZone: string) {
  const language = locale === "en" ? "en-GB" : "es-ES";
  let long: Intl.DateTimeFormat;
  let short: Intl.DateTimeFormat;
  let time: Intl.DateTimeFormat;
  try {
    long = new Intl.DateTimeFormat(language, { timeZone, dateStyle: "long" });
    short = new Intl.DateTimeFormat(language, {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    time = new Intl.DateTimeFormat(language, { timeZone, timeStyle: "short", hourCycle: "h23" });
  } catch {
    refuse("timeZone");
  }
  const longDay = new Intl.DateTimeFormat(language, { timeZone: "UTC", dateStyle: "long" });
  const shortDay = new Intl.DateTimeFormat(language, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return {
    longAt: (instant: string) => long.format(new Date(instant)),
    shortAt: (instant: string) => short.format(new Date(instant)),
    timeAt: (instant: string) => time.format(new Date(instant)),
    /** A `YYYY-MM-DD` day, which names no time zone. */
    longDay: (day: string) => longDay.format(new Date(`${day}T00:00:00.000Z`)),
    shortDay: (day: string) => shortDay.format(new Date(`${day}T00:00:00.000Z`)),
  };
}

const SPACE_MARK = "\u02fd";

function codePoint(c: string): string {
  return `[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`;
}

async function digestOf(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return "sha256-v1:" + Array.from(hash, (n) => n.toString(16).padStart(2, "0")).join("");
}

/**
 * Draws the pack: a cover, then one A4 page for each part that is included or failed. The attached
 * file is the only embedded file, and the Info key `WaitronRecoveryDigest` is its SHA-256.
 */
export async function renderRecoveryPack(input: RenderPackInput): Promise<Uint8Array<ArrayBuffer>> {
  const { locale, cover, parts } = input;
  if (locale !== "en" && locale !== "es") refuse("locale");
  const words = PACK_WORDS[locale];
  const when = packDates(locale, input.timeZone);
  for (const part of parts) {
    if (part.state === "included" && !part.page) refuse("parts");
    if (part.state === "failed" && !part.failure) refuse("parts");
  }
  const fileBytes = buildRecoveryPackFile(input.file);
  const fontBytes = await input.loadFont();
  const font = create(fontBytes as never) as Font;
  const safe = (text: string) =>
    Array.from(text, (c) => (font.hasGlyphForCodePoint(c.codePointAt(0)!) ? c : codePoint(c))).join(
      "",
    );

  const pageOf = packPageNumbers(parts);
  const pageCount = pageOf.size + 1;
  const serverKeyPage = [...pageOf].find(([part]) => part.kind === "server-key")?.[1];

  const layout = {
    size: "A4",
    autoFirstPage: false,
    margins: { top: TOP, bottom: BOTTOM, left: LEFT, right: LEFT },
    font: fontBytes as unknown as string,
  };
  const real = new PDFDocument({
    ...layout,
    info: { Title: words.title, WaitronRecoveryDigest: await digestOf(fileBytes) } as never,
  });
  // Each page is drawn here first, to find the largest text size at which it fits on one sheet.
  const scratch = new PDFDocument(layout);
  let scratchPages = 0;
  scratch.on("pageAdded", () => scratchPages++);
  let realPages = 0;
  real.on("pageAdded", () => realPages++);
  let pdf = real;
  const limit = input.maxBytes ?? MAX_PACK_PDF;
  const chunks: Uint8Array[] = [];
  let length = 0;
  const result = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    real.on("data", (data: Uint8Array) => {
      length += data.length;
      if (length > limit) reject(new RecoveryPackFileError("size"));
      else chunks.push(data);
    });
    real.on("end", () => {
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(bytes);
    });
  });
  // Drawing below can refuse before `result` is returned; a size refusal from output already
  // written must not then go unobserved.
  result.catch(() => undefined);

  const width = () => pdf.page.width - 2 * LEFT;
  let inset = 0;
  let scale = 1;
  let cut = false;
  /** `text` as drawn, or the most of it that `fits`, ended with a mark. */
  const cutToFit = (text: string, fits: (drawn: string) => boolean) => {
    const whole = safe(text);
    if (fits(whole)) return whole;
    const chars = Array.from(text);
    const cutAt = (n: number) => safe(chars.slice(0, n).join("")) + ELLIPSIS;
    let low = 0;
    let high = 1;
    while (high < chars.length && fits(cutAt(high))) {
      low = high;
      high *= 2;
    }
    high = Math.min(high, chars.length) - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(cutAt(middle))) low = middle;
      else high = middle - 1;
    }
    return cutAt(low);
  };
  /** At the current font size; cutting marks the page to be tried again smaller. */
  const tallest = (text: string, width: number) => {
    // Wrapping only adds lines, so text wider than this many full lines cannot fit; ruling it out
    // by width first keeps the slow wrapped measure to short text.
    const widest = width * (TALLEST_CELL / pdf.currentLineHeight(true) + 1);
    const shown = cutToFit(
      text,
      (t) => pdf.widthOfString(t) <= widest && pdf.heightOfString(t, { width }) <= TALLEST_CELL,
    );
    if (shown !== safe(text)) cut = true;
    return shown;
  };
  const write = (text: string, size = 10, colour = "black", gap = 6) => {
    pdf
      .fillColor(colour)
      .fontSize(size * scale)
      .text(safe(text), LEFT + inset, pdf.y, { width: width() - 2 * inset });
    pdf.y += gap * scale;
  };
  let header: string | undefined;
  const chrome = (n: number) => {
    const bottom = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0;
    const right = { width: width(), align: "right" as const, lineBreak: false };
    const footerY = pdf.page.height - 44;
    pdf.fillColor("black").fontSize(9);
    const room = width() - pdf.widthOfString(safe(words.page(pageCount, pageCount))) - 12;
    const day = when.shortAt(cover.madeAt);
    header ??= cutToFit(
      cover.venueName,
      (venue) => pdf.widthOfString(safe(words.header(venue, cover.number, day))) <= room,
    );
    const line = safe(words.header(header, cover.number, day));
    pdf.text(line, LEFT, 40, { lineBreak: false });
    pdf.text(safe(words.page(n, pageCount)), LEFT, 40, right);
    pdf
      .moveTo(LEFT, 56)
      .lineTo(pdf.page.width - LEFT, 56)
      .lineWidth(1)
      .stroke("black");
    pdf.fillColor(GREY).fontSize(8);
    pdf.text(line, LEFT, footerY, { lineBreak: false });
    pdf.text(safe(words.page(n, pageCount)), LEFT, footerY, right);
    pdf
      .moveTo(LEFT, footerY - 8)
      .lineTo(pdf.page.width - LEFT, footerY - 8)
      .lineWidth(0.5)
      .stroke(LINE);
    pdf.page.margins.bottom = bottom;
    pdf.x = LEFT;
    pdf.y = TOP;
  };
  let drawn = 0;
  /** Draws a page at the largest size at which it fits one sheet with nothing cut; else smallest. */
  const drawPage = (draw: () => void) => {
    const fitting = SCALES.find((size, index) => {
      pdf = scratch;
      scale = size;
      cut = false;
      const before = scratchPages;
      scratch.addPage();
      chrome(drawn + 1);
      draw();
      pdf = real;
      return scratchPages === before + 1 && (!cut || index === SCALES.length - 1);
    });
    if (fitting === undefined) refuse("overflow");
    scale = fitting;
    pdf.addPage();
    chrome(++drawn);
    draw();
  };
  const table = (columns: number[], rows: string[][], options: { head?: boolean } = {}) => {
    pdf.fontSize(9.5 * scale);
    const total = width();
    rows.forEach((cells, index) => {
      const head = options.head === true && index === 0;
      const widths = cells.map((_, i) =>
        i === cells.length - 1
          ? total - columns.slice(0, i).reduce((a, b) => a + b, 0) - 16 * i
          : columns[i]!,
      );
      const shown = cells.map((cell, i) => tallest(cell, widths[i]! - 12));
      const height =
        Math.max(...shown.map((cell, i) => pdf.heightOfString(cell, { width: widths[i]! - 12 }))) +
        14 * scale;
      const y = pdf.y;
      if (head) pdf.rect(LEFT, y, total, height).fill(FILL);
      let x = LEFT;
      shown.forEach((cell, i) => {
        pdf.fillColor(head ? "black" : i === 0 ? GREY : "black");
        pdf.text(cell, x + 6, y + 7 * scale, { width: widths[i]! - 12 });
        x += widths[i]! + 16;
      });
      pdf
        .moveTo(LEFT, y + height)
        .lineTo(LEFT + total, y + height)
        .lineWidth(0.5)
        .stroke(LINE);
      pdf.y = y + height;
    });
    pdf.y += 12 * scale;
  };
  const boxed = (draw: () => void, padding = 12) => {
    const top = pdf.y;
    pdf.y += padding;
    inset = padding;
    draw();
    inset = 0;
    const bottom = pdf.y + padding - 6;
    pdf
      .rect(LEFT, top, width(), bottom - top)
      .lineWidth(1.2)
      .stroke("black");
    pdf.y = bottom + 12;
  };
  const qr = (text: string, x: number, y: number) => {
    const modules = qrModules(text);
    const cell = QR_SIZE / (modules.length + 8);
    pdf.save();
    modules.forEach((row, r) =>
      row.forEach((dark, c) => {
        if (dark) pdf.rect(x + (c + 4) * cell, y + (r + 4) * cell, cell, cell);
      }),
    );
    pdf.fill("black");
    pdf.restore();
    pdf.rect(x, y, QR_SIZE, QR_SIZE).lineWidth(0.5).stroke(LINE);
  };
  const secret = (value: NonNullable<RecoveryPackPage["secret"]>) => {
    // A drawn space cannot be counted, and one at either end cannot be seen; a passphrase may
    // hold either. The QR code still carries the text itself.
    const spaced = value.exactSpaces === true && value.text.includes(" ");
    const shown = value.exactSpaces
      ? Array.from(value.text, (c) =>
          c === " " ? SPACE_MARK : c === SPACE_MARK || /\s/.test(c) ? codePoint(c) : c,
        ).join("")
      : value.text;
    const top = pdf.y;
    const textWidth = width() - 24 - QR_SIZE - 16;
    pdf
      .fillColor(GREY)
      .fontSize(8)
      .text(safe(value.label), LEFT + 12, top + 12, { width: textWidth });
    pdf.y += 4;
    pdf
      .fillColor("black")
      .fontSize(10)
      .text(safe(shown), LEFT + 12, pdf.y, {
        width: textWidth,
        lineGap: 3,
      });
    if (spaced) {
      pdf.y += 4;
      pdf
        .fillColor(GREY)
        .fontSize(8)
        .text(safe(words.spaceMark), LEFT + 12, pdf.y, { width: textWidth });
    }
    qr(value.text, LEFT + width() - 12 - QR_SIZE, top + 12);
    const bottom = Math.max(pdf.y, top + 12 + QR_SIZE) + 12;
    pdf
      .rect(LEFT, top, width(), bottom - top)
      .lineWidth(1.2)
      .stroke("black");
    pdf.y = bottom + 16;
  };
  const location = (where: ServerKeyLocation) => {
    let text: string = words.thisPackHoldsKey;
    if (where.kind === "pack")
      text = `${words.noNewKey} ${(where.received ? words.keyOnPack : words.keyOnUnreceivedPack)(
        where.number,
        when.longDay(where.madeOn),
      )}`;
    if (where.kind === "sheet")
      text = `${words.noNewKey} ${words.keyOnSheet(where.keyName, when.longDay(where.madeOn))}`;
    boxed(() => write(text, 12, "black", 0));
  };

  drawPage(() => {
    write(words.title, 24, "black", 4);
    pdf.fontSize(10 * scale);
    write(
      cover.madeBy === null
        ? words.madeDuringSetup(when.longAt(cover.madeAt), when.timeAt(cover.madeAt))
        : words.madeBy(
            when.longAt(cover.madeAt),
            when.timeAt(cover.madeAt),
            tallest(cover.madeBy, width()),
          ),
      10,
      GREY,
      0,
    );
    write(
      `${tallest(cover.legalName, width())} · NIF ${cover.taxId} · ${tallest(cover.venueName, width())}`,
      10,
      GREY,
      18,
    );
    write(words.whichPage, 12, "black", 4);
    table(
      [width() - 80],
      [
        [words.whatHappened, words.pageColumn],
        ...[...pageOf].map(([part, page]) => [words.situation[part.kind], String(page)]),
      ],
      { head: true },
    );
    write(words.whatIsIn, 12, "black", 4);
    table(
      [150, 110, width() - 150 - 110 - 80 - 48],
      [
        [words.partColumn, words.lastChangedColumn, words.checkColumn, words.pageColumn],
        ...parts.map((part) => {
          const page = pageOf.get(part);
          if (part.state === "included")
            return [
              words.part[part.kind],
              part.lastChanged ? when.shortDay(part.lastChanged) : "",
              part.check ?? "",
              String(page),
            ];
          if (part.state === "failed")
            return [words.part[part.kind], words.couldNotBeDrawn, "", String(page)];
          const reason =
            part.absentReason ??
            (part.state === "absent" ? words.absent : words.notSetUp)[part.kind];
          return [words.part[part.kind], reason];
        }),
      ],
      { head: true },
    );
    write(words.sameChecks, 9, GREY, 14);
    boxed(() => {
      write(words.lockedAway, 12, "black", 2);
      const { bucketCode, archiveCode, backupKey, serverKey } = input.file;
      const backups = bucketCode !== null || archiveCode !== null || backupKey !== null;
      const opens = backups
        ? serverKey !== null
          ? words.anyoneHoldingBackupsAndServerKey
          : words.anyoneHoldingBackups
        : serverKey !== null
          ? words.anyoneHoldingServerKey
          : undefined;
      write(
        [
          opens,
          words.whichToKeep,
          serverKeyPage === undefined ? undefined : words.serverKeyPage(serverKeyPage),
        ]
          .filter((sentence) => sentence !== undefined)
          .join(" "),
        11,
        "black",
        0,
      );
    });
  });

  for (const [part] of pageOf)
    drawPage(() => {
      if (part.state === "failed") {
        write(words.failedTitle(words.part[part.kind]), 18, "black", 10);
        write(part.failure!.what, 11);
        write(part.failure!.todo, 11, "black", 12);
        if (part.serverKeyLocation) location(part.serverKeyLocation);
        return;
      }
      const page = part.page!;
      write(page.title, 18, "black", 8);
      if (page.intro) write(page.intro, 10, "black", 12);
      if (page.secret) secret(page.secret);
      if (page.rows.length > 0)
        table(
          [180],
          page.rows.map((row) => [row.label, row.value]),
        );
      if (part.serverKeyLocation) location(part.serverKeyLocation);
      for (const note of page.notes) write(note, 10, "black", 3);
    });
  if (realPages !== pageCount) refuse("overflow");
  pdf.file(fileBytes.buffer, { name: PACK_ATTACHMENT, type: "application/json" });
  pdf.end();
  return result;
}
