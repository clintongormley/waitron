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

function dates(locale: PackLocale, timeZone: string) {
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
  const when = dates(locale, input.timeZone);
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

  const pageOf = new Map<PackPart, number>();
  for (const part of parts)
    if (part.state === "included" || part.state === "failed") pageOf.set(part, pageOf.size + 2);
  const pageCount = pageOf.size + 1;
  const serverKeyPage = [...pageOf].find(([part]) => part.kind === "server-key")?.[1];

  const pdf = new PDFDocument({
    size: "A4",
    autoFirstPage: false,
    margins: { top: TOP, bottom: BOTTOM, left: LEFT, right: LEFT },
    font: fontBytes as unknown as string,
    info: { Title: words.title, WaitronRecoveryDigest: await digestOf(fileBytes) } as never,
  });
  const limit = input.maxBytes ?? MAX_PACK_PDF;
  const chunks: Uint8Array[] = [];
  let length = 0;
  const result = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    pdf.on("data", (data: Uint8Array) => {
      length += data.length;
      if (length > limit) reject(new RecoveryPackFileError("size"));
      else chunks.push(data);
    });
    pdf.on("end", () => {
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
  const write = (text: string, size = 10, colour = "black", gap = 6) => {
    pdf
      .fillColor(colour)
      .fontSize(size)
      .text(safe(text), LEFT + inset, pdf.y, { width: width() - 2 * inset });
    pdf.y += gap;
  };
  const header = safe(words.header(cover.venueName, cover.number, when.shortAt(cover.madeAt)));
  const chrome = (n: number) => {
    const bottom = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0;
    const right = { width: width(), align: "right" as const, lineBreak: false };
    const footerY = pdf.page.height - 44;
    pdf.fillColor("black").fontSize(9);
    pdf.text(header, LEFT, 40, { lineBreak: false });
    pdf.text(safe(words.page(n, pageCount)), LEFT, 40, right);
    pdf
      .moveTo(LEFT, 56)
      .lineTo(pdf.page.width - LEFT, 56)
      .lineWidth(1)
      .stroke("black");
    pdf.fillColor(GREY).fontSize(8);
    pdf.text(header, LEFT, footerY, { lineBreak: false });
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
  let added = 0;
  pdf.on("pageAdded", () => added++);
  const newPage = () => {
    pdf.addPage();
    chrome(++drawn);
  };
  const table = (columns: number[], rows: string[][], options: { head?: boolean } = {}) => {
    pdf.fontSize(9.5);
    const total = width();
    rows.forEach((cells, index) => {
      const head = options.head === true && index === 0;
      const widths = cells.map((_, i) =>
        i === cells.length - 1
          ? total - columns.slice(0, i).reduce((a, b) => a + b, 0) - 16 * i
          : columns[i]!,
      );
      const height =
        Math.max(
          ...cells.map((cell, i) => pdf.heightOfString(safe(cell), { width: widths[i]! - 12 })),
        ) + 14;
      const y = pdf.y;
      if (head) pdf.rect(LEFT, y, total, height).fill(FILL);
      let x = LEFT;
      cells.forEach((cell, i) => {
        pdf.fillColor(head ? "black" : i === 0 ? GREY : "black");
        pdf.text(safe(cell), x + 6, y + 7, { width: widths[i]! - 12 });
        x += widths[i]! + 16;
      });
      pdf
        .moveTo(LEFT, y + height)
        .lineTo(LEFT + total, y + height)
        .lineWidth(0.5)
        .stroke(LINE);
      pdf.y = y + height;
    });
    pdf.y += 12;
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
    const spaced = value.text.includes(" ");
    const shown = Array.from(value.text, (c) =>
      c === " " ? SPACE_MARK : c === SPACE_MARK || /\s/.test(c) ? codePoint(c) : c,
    ).join("");
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

  newPage();
  write(words.title, 24, "black", 4);
  write(
    cover.madeBy === null
      ? words.madeDuringSetup(when.longAt(cover.madeAt), when.timeAt(cover.madeAt))
      : words.madeBy(when.longAt(cover.madeAt), when.timeAt(cover.madeAt), cover.madeBy),
    10,
    GREY,
    0,
  );
  write(`${cover.legalName} · NIF ${cover.taxId} · ${cover.venueName}`, 10, GREY, 18);
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
          part.absentReason ?? (part.state === "absent" ? words.absent : words.notSetUp)[part.kind];
        return [words.part[part.kind], reason];
      }),
    ],
    { head: true },
  );
  write(words.sameChecks, 9, GREY, 14);
  boxed(() => {
    write(words.lockedAway, 12, "black", 2);
    write(
      serverKeyPage === undefined
        ? words.anyoneHolding
        : `${words.anyoneHolding} ${words.serverKeyPage(serverKeyPage)}`,
      11,
      "black",
      0,
    );
  });

  for (const [part] of pageOf) {
    newPage();
    if (part.state === "failed") {
      write(words.failedTitle(words.part[part.kind]), 18, "black", 10);
      write(part.failure!.what, 11);
      write(part.failure!.todo, 11, "black", 12);
      if (part.serverKeyLocation) location(part.serverKeyLocation);
      continue;
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
  }
  if (added !== pageCount) refuse("overflow");
  pdf.file(fileBytes.buffer, { name: PACK_ATTACHMENT, type: "application/json" });
  pdf.end();
  return result;
}
