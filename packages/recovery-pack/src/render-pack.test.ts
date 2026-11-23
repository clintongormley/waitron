import { readFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import jsQR from "jsqr";
import { create, type Font } from "fontkit";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import type { RecoveryPackFile } from "./pack-file.js";
import { MAX_PACK_PDF, readRecoveryPackPdf } from "./read-pack-pdf.js";
import { PACK_WORDS } from "./i18n/pack-words.js";
import { renderRecoveryPack, type PackPart, type RenderPackInput } from "./render-pack.js";

const fontBytes = new Uint8Array(
  readFileSync(new URL("../../../apps/server/src/assets/invoice-noto-sans.ttf", import.meta.url)),
);
const monoBytes = new Uint8Array(
  readFileSync(
    new URL("../../../apps/server/src/assets/invoice-noto-sans-mono.ttf", import.meta.url),
  ),
);
const loadFonts = async () => ({ regular: fontBytes, mono: monoBytes });

const bucketCode = "WAITRON-RECOVERY-KIT-2:" + "Ab9_-".repeat(124);
const archiveCode = "WAITRON-ARCHIVE-PACK-1:" + "Zx7-_".repeat(80);

const file: RecoveryPackFile = {
  kind: "waitron-recovery-pack",
  version: 1,
  number: 3,
  madeAt: "2026-10-12T16:40:00.000Z",
  bucketCode,
  archiveCode,
  backupKey: null,
  serverKey: null,
  serverKeyName: "2026-09-02 · K7QF",
  serverKeyHeldBy: { number: 1, madeOn: "2026-09-02", received: true },
};

const bucket: PackPart = {
  kind: "bucket",
  state: "included",
  lastChanged: "2026-09-20",
  check: "key of 20 Sep 2026 · rev 4",
  page: {
    title: "Bucket copy",
    intro: "The box sends a continuous copy of the venue to your bucket.",
    rows: [{ label: "Bucket", value: "s3.eu-west-3.amazonaws.com · bar-nora-backups" }],
    secret: { label: "Restore code for the bucket copy", text: bucketCode, qr: true },
    notes: ["1. Install Waitron on the new box and open its setup page."],
  },
};
const archives: PackPart = {
  kind: "archives",
  state: "included",
  lastChanged: "2026-09-20",
  check: "key of 20 Sep 2026 · rev 4",
  page: {
    title: "Archives",
    rows: [],
    secret: { label: "Restore code for the archives", text: archiveCode, qr: true },
    notes: ["Run restore --from-archive with this PDF."],
  },
};
const serverKey: PackPart = {
  kind: "server-key",
  state: "included",
  lastChanged: "2026-09-02",
  check: "2026-09-02 · K7QF",
  page: {
    title: "Server key",
    rows: [
      { label: "Legal name", value: "Bar Nora S.L." },
      { label: "Key name", value: "2026-09-02 · K7QF" },
    ],
    notes: ["Keep older packs for older backups."],
  },
  serverKeyLocation: { kind: "pack", number: 1, madeOn: "2026-09-02", received: true },
};

function input(overrides: Partial<RenderPackInput> = {}): RenderPackInput {
  return {
    locale: "en",
    timeZone: "Europe/Madrid",
    loadFonts,
    cover: {
      legalName: "Bar Nora S.L.",
      taxId: "B12345678",
      venueName: "Bar Nora",
      madeAt: file.madeAt,
      madeBy: "Marta Puig",
      number: 3,
    },
    parts: [bucket, archives, serverKey],
    file,
    ...overrides,
  };
}

/** Each page's text; with a `scale`, the QR code of each page in `scanned` (0-based), or of all. */
async function rendered(bytes: Uint8Array, scale = 0, scanned?: readonly number[]) {
  const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    const pages: { text: string; qr: string | null }[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => ("str" in item ? [item.str] : []))
        .join(" ")
        .replace(/\s+/g, " ");
      let qr: string | null = null;
      if (scale > 0 && (scanned?.includes(n - 1) ?? true)) {
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext("2d");
        await page.render({ canvas: canvas as never, canvasContext: context as never, viewport })
          .promise;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        qr = jsQR(pixels.data, canvas.width, canvas.height)?.data ?? null;
      }
      pages.push({ text, qr });
    }
    return pages;
  } finally {
    await loading.destroy();
  }
}

const squash = (text: string) => text.replace(/\s+/g, "");

it("starts %PDF- and ends %%EOF, the two marks the dashboard's makeRecoveryPack checks", async () => {
  const bytes = await renderRecoveryPack(input());
  const text = (from: number, to?: number) =>
    new TextDecoder("latin1").decode(bytes.subarray(from, to));
  expect(text(0, 5)).toBe("%PDF-");
  expect(text(bytes.length - 16)).toMatch(/%%EOF\s*$/);
});

describe("the recovery pack's cover", () => {
  it("names the venue, who made it and when, its number, and what each page is for", async () => {
    const [cover] = await rendered(await renderRecoveryPack(input()));
    const text = cover!.text;
    expect(text).toContain("Waitron recovery pack");
    expect(text).toContain("Bar Nora S.L.");
    expect(text).toContain("NIF B12345678");
    expect(text).toContain("Made on 12 October 2026 at 18:40 by Marta Puig");
    expect(text).toContain("Recovery pack 3 · 12 Oct 2026");
    expect(text).toContain("Which page do I need?");
    expect(text).toContain(
      "You are setting up a new box and want the venue back from your bucket copy.",
    );
    expect(text).toContain("You need one old archive back (for example a month-end copy).");
    expect(text).toContain("You are recovering the box's own key with a backup.");
    expect(text).toContain("What is in this pack");
    expect(text).toContain("Bucket copy 20 Sept 2026 key of 20 Sep 2026 · rev 4 2");
    expect(text).toContain("Box key 2 Sept 2026 2026-09-02 · K7QF 4");
    expect(text).toContain("Page 1 of 4");
  });

  it("warns to keep it locked away, and says the Backups screen names the packs to keep", async () => {
    const [cover] = await rendered(await renderRecoveryPack(input()));
    expect(cover!.text).toContain("Keep this pack locked away, and off the box.");
    expect(cover!.text).toContain(
      "When you make a new pack, the dashboard's Backups screen says which older packs to keep and until when. Always keep the pack that holds the box key (page 4 says which).",
    );
  });

  it("keeps the text inside its boxes clear of the box's edge", async () => {
    const bytes = await renderRecoveryPack(input());
    const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
    try {
      const pdf = await loading.promise;
      for (const [page, start] of [
        [1, "Keep this pack locked away"],
        [4, "This pack did not make"],
      ] as const) {
        const items = (await (await pdf.getPage(page)).getTextContent()).items;
        const item = items.find((i) => "str" in i && i.str.startsWith(start));
        expect((item as { transform: number[] }).transform[4]).toBeGreaterThanOrEqual(48 + 10);
      }
    } finally {
      await loading.destroy();
    }
  });

  it("says a pack made during setup was made during setup", async () => {
    const [cover] = await rendered(
      await renderRecoveryPack(input({ cover: { ...input().cover, madeBy: null } })),
    );
    expect(cover!.text).toContain("Made during setup on 12 October 2026 at 18:40");
  });

  it("is in Spanish for a Spanish speaker", async () => {
    const pages = await rendered(await renderRecoveryPack(input({ locale: "es" })));
    expect(pages[0]!.text).toContain("Paquete de recuperación de Waitron");
    expect(pages[0]!.text).toContain("Hecho el 12 de octubre de 2026 a las 18:40 por Marta Puig");
    expect(pages[0]!.text).toContain("¿Qué página necesito?");
    expect(pages[0]!.text).toContain(PACK_WORDS.es.lockedAway);
    expect(pages[0]!.text).toContain("Página 1 de 4");
    expect(pages[3]!.text).toContain(
      "La clave está en el paquete de recuperación 1, hecho el 2 de septiembre de 2026. Guarda ese paquete.",
    );
  });
});

describe("what the cover says holding the pack opens", () => {
  const keyOnly = (locale: "en" | "es") =>
    input({
      locale,
      parts: [
        { kind: "bucket", state: "not-set-up" },
        { kind: "archives", state: "not-set-up" },
        { ...serverKey, serverKeyLocation: { kind: "this-pack" } },
      ],
      file: {
        ...file,
        bucketCode: null,
        archiveCode: null,
        backupKey: null,
        serverKey: { kind: "a-key-file" },
        serverKeyHeldBy: null,
      },
    });

  const others = (words: (typeof PACK_WORDS)["en"], said: keyof typeof PACK_WORDS.en) =>
    (
      [
        "anyoneHoldingServerKey",
        "anyoneHoldingBackups",
        "anyoneHoldingBackupsAndServerKey",
      ] as const
    )
      .filter((key) => key !== said)
      .map((key) => words[key]);

  it.each(["en", "es"] as const)(
    "a pack holding the server key and no backup key says it recovers the server with its matching backup, in %s",
    async (locale) => {
      const [cover] = await rendered(await renderRecoveryPack(keyOnly(locale)));
      const words = PACK_WORDS[locale];
      expect(cover!.text).toContain(`${words.anyoneHoldingServerKey} ${words.whichToKeep}`);
      for (const other of others(words, "anyoneHoldingServerKey"))
        expect(cover!.text).not.toContain(other);
    },
  );

  const held = [
    ["the bucket code", { bucketCode }],
    ["the archive code", { archiveCode }],
    ["the backup key", { backupKey: "a backup passphrase" }],
  ] as const;

  it.each(
    held.flatMap(([what, secrets]) =>
      (["en", "es"] as const).map((locale) => [what, locale, secrets] as const),
    ),
  )(
    "a pack holding %s and the server key says it opens the backups those unlock and, with a matching backup, recovers the server, in %s",
    async (_, locale, secrets) => {
      const pack = keyOnly(locale);
      const [cover] = await rendered(
        await renderRecoveryPack({ ...pack, file: { ...pack.file, ...secrets } }),
      );
      const words = PACK_WORDS[locale];
      expect(cover!.text).toContain(
        `${words.anyoneHoldingBackupsAndServerKey} ${words.whichToKeep}`,
      );
      for (const other of others(words, "anyoneHoldingBackupsAndServerKey"))
        expect(cover!.text).not.toContain(other);
    },
  );

  it.each(
    held.flatMap(([what, secrets]) =>
      (["en", "es"] as const).map((locale) => [what, locale, secrets] as const),
    ),
  )(
    "a pack holding %s but not the server key says only that it opens the backups those unlock, in %s",
    async (_, locale, secrets) => {
      const [cover] = await rendered(
        await renderRecoveryPack(
          input({
            locale,
            file: { ...file, bucketCode: null, archiveCode: null, ...secrets },
          }),
        ),
      );
      const words = PACK_WORDS[locale];
      expect(cover!.text).toContain(
        `${words.anyoneHoldingBackups} ${words.whichToKeep} ${words.serverKeyPage(4)}`,
      );
      for (const other of others(words, "anyoneHoldingBackups"))
        expect(cover!.text).not.toContain(other);
    },
  );

  it("a pack holding no secret claims nothing about what it opens", async () => {
    const [cover] = await rendered(
      await renderRecoveryPack(
        input({
          parts: [
            { kind: "bucket", state: "absent" },
            { kind: "archives", state: "absent" },
            { kind: "server-key", state: "absent" },
          ],
          file: {
            ...file,
            bucketCode: null,
            archiveCode: null,
            serverKeyName: null,
            serverKeyHeldBy: null,
          },
        }),
      ),
    );
    expect(cover!.text).toContain(PACK_WORDS.en.whichToKeep);
    for (const other of others(PACK_WORDS.en, "lockedAway"))
      expect(cover!.text).not.toContain(other);
  });
});

describe("long names", () => {
  const wide = (length: number) => "Ԫ".repeat(length);
  const keyText = "0123 4567 89AB CDEF GHJK MNPQ RSTV WXYZ 0123 4567 8";
  const serverKeyPage = (legalName: string, venueName: string): PackPart["page"] => ({
    title: "Server key",
    intro:
      "With this key and its matching backup, the venue's server can be recovered with its own identity.",
    rows: [
      { label: "Legal name", value: legalName },
      { label: "NIF", value: "B12345674" },
      { label: "Venue", value: venueName },
      { label: "Environment", value: "Preproduction" },
      { label: "Software ID", value: "WT" },
      { label: "Server ID", value: "4f9c2a1b" },
      { label: "Key name", value: "2026-10-17 · ACRY" },
      { label: "Created", value: "18 October 2026, 01:30 CEST" },
    ],
    secret: { label: "Key", text: keyText, qr: true },
    notes: [
      "Keep this pack in a safe place. Anyone with this key and its matching backup can recover the server.",
      "A backup in Waitron Cloud needs your Cloud login. This pack is not a backup of your sales.",
      "Keep older packs for older backups. A new key does not unlock backups made with an older key.",
    ],
  });
  const setupPack = (locale: "en" | "es", legalName: string, venueName: string) =>
    input({
      locale,
      cover: { ...input().cover, legalName, venueName, madeBy: null, number: 1 },
      parts: [
        { kind: "bucket", state: "not-set-up" },
        { kind: "archives", state: "not-set-up" },
        {
          kind: "server-key",
          state: "included",
          lastChanged: "2026-10-17",
          check: "2026-10-17 · ACRY",
          page: serverKeyPage(legalName, venueName),
          serverKeyLocation: { kind: "this-pack" },
        },
      ],
      file: {
        ...file,
        number: 1,
        bucketCode: null,
        archiveCode: null,
        serverKey: { kind: "a-key-file" },
        serverKeyHeldBy: null,
      },
    });
  const dashboardPack = (locale: "en" | "es", legalName: string, venueName: string) =>
    input({
      locale,
      cover: { ...input().cover, legalName, venueName },
      parts: [
        bucket,
        archives,
        {
          ...serverKey,
          page: { ...serverKeyPage(legalName, venueName)!, secret: undefined },
          serverKeyLocation: { kind: "pack", number: 1, madeOn: "2026-09-02", received: false },
        },
      ],
    });
  const fontSizeOf = async (bytes: Uint8Array, page: number, text: string) => {
    const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
    try {
      const items = (await (await (await loading.promise).getPage(page)).getTextContent()).items;
      const item = items.find((i) => "str" in i && i.str.startsWith(text.split(" ")[0]!));
      return (item as { transform: number[] }).transform[3];
    } finally {
      await loading.destroy();
    }
  };

  it.each([
    ["setup", "en", setupPack],
    ["setup", "es", setupPack],
    ["the dashboard", "en", dashboardPack],
    ["the dashboard", "es", dashboardPack],
  ] as const)(
    "draws in full a legal name of 120 and a venue name of 256 of the widest letter, in %s's pack in %s",
    async (_, locale, pack) => {
      const legalName = wide(120);
      const venueName = wide(256);
      const bytes = await renderRecoveryPack(pack(locale, legalName, venueName));
      const pages = await rendered(bytes);
      const keyPage = pages.at(-1)!.text;
      expect(squash(keyPage)).toContain(squash(legalName));
      expect(squash(keyPage)).toContain(squash(venueName));
      expect(squash(pages[0]!.text)).toContain(
        squash(`${legalName} · NIF B12345678 · ${venueName}`),
      );
      if (pack === setupPack) expect(await fontSizeOf(bytes, 2, keyText)).toBeCloseTo(10);
    },
  );

  it("cuts a name no page can hold with a mark, instead of refusing the pack", async () => {
    const legalName = "⸻".repeat(256);
    const venueName = "一".repeat(256);
    const bytes = await renderRecoveryPack(setupPack("es", legalName, venueName));
    const pages = await rendered(bytes);
    expect(pages).toHaveLength(2);
    expect(squash(pages[1]!.text)).toMatch(/Legalname⸻+…NIFB12345674Venue/);
    expect(squash(pages[1]!.text)).toMatch(/Venue(\[U\+4E00\])+…Environment/);
    expect(squash(pages[1]!.text)).toContain(squash(keyText));
    expect(await fontSizeOf(bytes, 2, keyText)).toBeCloseTo(10);
  });

  it("cuts a cover name longer than the cover can hold with a mark", async () => {
    const pages = await rendered(
      await renderRecoveryPack(
        input({
          cover: {
            ...input().cover,
            legalName: "W".repeat(1000),
            venueName: "W".repeat(1000),
            madeBy: "M".repeat(1000),
          },
          parts: [
            { kind: "bucket", state: "absent" },
            { kind: "archives", state: "absent" },
            { kind: "server-key", state: "absent" },
          ],
          file: { ...file, archiveCode: null, serverKeyName: null, serverKeyHeldBy: null },
        }),
      ),
    );
    expect(pages).toHaveLength(1);
    expect(squash(pages[0]!.text)).toMatch(/W+…·NIFB12345678·W+…Which/);
    expect(squash(pages[0]!.text)).toMatch(/byM+…\./);
  });

  it("keeps the running header's venue name clear of the page number", async () => {
    const bytes = await renderRecoveryPack(
      input({ cover: { ...input().cover, venueName: wide(256) } }),
    );
    const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
    try {
      const items = (await (await (await loading.promise).getPage(2)).getTextContent()).items as {
        str: string;
        transform: number[];
        width: number;
      }[];
      const header = items.find((i) => i.str.includes("Recovery pack 3"))!;
      const number = items.find(
        (i) => i.str === "Page 2 of 4" && i.transform[5] === header.transform[5],
      )!;
      expect(header.str).toMatch(/^Ԫ+… · Recovery pack 3 · 12 Oct 2026$/);
      expect(header.transform[4] + header.width).toBeLessThan(number.transform[4]);
    } finally {
      await loading.destroy();
    }
  });
});

describe("the Spanish pack's other wording", () => {
  it("covers setup, a failed page and each place the key can be", async () => {
    const es = (parts: PackPart[], madeBy: string | null = "Marta Puig") =>
      renderRecoveryPack(input({ locale: "es", parts, cover: { ...input().cover, madeBy } }));
    const failed = await rendered(
      await es(
        [{ kind: "server-key", state: "failed", failure: { what: "Falló.", todo: "Reintenta." } }],
        null,
      ),
    );
    expect(failed[0]!.text).toContain(
      PACK_WORDS.es.madeDuringSetup("12 de octubre de 2026", "18:40"),
    );
    expect(failed[1]!.text).toContain("Clave del servidor: no se pudo generar");
    const at = async (serverKeyLocation: PackPart["serverKeyLocation"]) =>
      (await rendered(await es([{ ...serverKey, serverKeyLocation }])))[1]!.text;
    expect(await at({ kind: "this-pack" })).toContain("Este paquete tiene la clave del servidor.");
    expect(await at({ kind: "pack", number: 1, madeOn: "2026-09-02", received: false })).toContain(
      `${PACK_WORDS.es.noNewKey} ${PACK_WORDS.es.keyOnUnreceivedPack(1, "2 de septiembre de 2026")}`,
    );
    expect(
      await at({ kind: "sheet", keyName: "2026-09-02 · K7QF", madeOn: "2026-09-02" }),
    ).toContain(PACK_WORDS.es.keyOnSheet("2026-09-02 · K7QF", "2 de septiembre de 2026"));
  });
});

describe("parts the renderer refuses", () => {
  it("refuses an included part with no page, or a failed part with no failure", async () => {
    await expect(
      renderRecoveryPack(input({ parts: [{ kind: "bucket", state: "included" }] })),
    ).rejects.toThrow("Recovery pack refused: parts");
    await expect(
      renderRecoveryPack(input({ parts: [{ kind: "bucket", state: "failed" }] })),
    ).rejects.toThrow("Recovery pack refused: parts");
  });

  it("refuses a part whose page runs onto a second sheet", async () => {
    const notes = Array.from({ length: 120 }, (_, i) => `Step ${i + 1}.`);
    await expect(
      renderRecoveryPack(input({ parts: [{ ...bucket, page: { ...bucket.page!, notes } }] })),
    ).rejects.toThrow("Recovery pack refused: overflow");
  });

  it("refuses a pack whose final document has more pages than it planned", async () => {
    vi.resetModules();
    vi.doMock("pdfkit", async (load) => {
      const { default: Real } = await load<{ default: new (options: object) => object }>();
      class Doubling extends Real {
        constructor(options: { info?: object }) {
          super(options);
          if (!options.info) return;
          const addPage = (this as unknown as { addPage: () => unknown }).addPage.bind(this);
          (this as unknown as { addPage: () => unknown }).addPage = () => (addPage(), addPage());
        }
      }
      return { default: Doubling };
    });
    try {
      const { renderRecoveryPack: render } = await import("./render-pack.js");
      await expect(render(input())).rejects.toThrow("Recovery pack refused: overflow");
    } finally {
      vi.doUnmock("pdfkit");
      vi.resetModules();
    }
  });

  it("leaves no output-size refusal unhandled after a drawing refusal", async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", record);
    try {
      const notes = Array.from({ length: 120 }, (_, i) => `Step ${i + 1}.`);
      await expect(
        renderRecoveryPack({
          ...input({ parts: [{ ...bucket, page: { ...bucket.page!, notes } }] }),
          maxBytes: 1,
        }),
      ).rejects.toThrow("Recovery pack refused: overflow");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });

  it("leaves blank a last-changed day and check the part does not give", async () => {
    const pages = await rendered(
      await renderRecoveryPack(
        input({ parts: [{ kind: "bucket", state: "included", page: bucket.page! }] }),
      ),
    );
    expect(pages[0]!.text).toContain("Page Bucket copy 2");
  });
});

describe("a part the pack does not hold", () => {
  it("keeps its cover line with the reason, and has no page", async () => {
    const pages = await rendered(
      await renderRecoveryPack(
        input({
          parts: [
            { kind: "bucket", state: "not-set-up" },
            archives,
            { kind: "server-key", state: "absent" },
          ],
        }),
      ),
    );
    expect(pages).toHaveLength(2);
    expect(pages[0]!.text).toContain("Bucket copy This box has no bucket copy.");
    expect(pages[0]!.text).toContain("Box key This venue files no invoices with the tax agency.");
    expect(pages[0]!.text).not.toContain("page 4 says which");
    expect(pages[0]!.text).not.toContain("from your bucket copy");
  });

  it("uses the reason the caller gives, when it gives one", async () => {
    const pages = await rendered(
      await renderRecoveryPack(
        input({
          parts: [
            { kind: "bucket", state: "absent", absentReason: "Reason from the box." },
            archives,
          ],
        }),
      ),
    );
    expect(pages[0]!.text).toContain("Bucket copy Reason from the box.");
  });

  it("says a failed part failed, on the cover and on its own page", async () => {
    const pages = await rendered(
      await renderRecoveryPack(
        input({
          parts: [
            bucket,
            {
              kind: "archives",
              state: "failed",
              failure: {
                what: "The archive settings could not be read.",
                todo: "Make a new pack.",
              },
            },
            serverKey,
          ],
        }),
      ),
    );
    expect(pages).toHaveLength(4);
    expect(pages[0]!.text).toContain("Archives Could not be drawn 3");
    expect(pages[2]!.text).toContain("Archives");
    expect(pages[2]!.text).toContain("The archive settings could not be read.");
    expect(pages[2]!.text).toContain("Make a new pack.");
    expect(squash(pages[2]!.text)).not.toContain(squash(archiveCode).slice(0, 40));
  });
});

describe("the server-key page says where the key is", () => {
  const withLocation = (location: PackPart["serverKeyLocation"]) =>
    input({ parts: [bucket, archives, { ...serverKey, serverKeyLocation: location }] });

  it("on this pack", async () => {
    const pages = await rendered(await renderRecoveryPack(withLocation({ kind: "this-pack" })));
    expect(pages[3]!.text).toContain("This pack holds the box key.");
  });

  it("on an earlier pack a browser confirmed receiving: keep that pack", async () => {
    const pages = await rendered(await renderRecoveryPack(input()));
    expect(pages[3]!.text).toContain(
      "This pack did not make a new box key. The key itself is on recovery pack 1, made on 2 September 2026. Keep that pack.",
    );
  });

  it("on an earlier pack no browser confirmed receiving: never 'keep that pack'", async () => {
    const pages = await rendered(
      await renderRecoveryPack(
        withLocation({ kind: "pack", number: 1, madeOn: "2026-09-02", received: false }),
      ),
    );
    expect(pages[3]!.text).toContain(
      "The key itself is on recovery pack 1, made on 2 September 2026, but when this pack was made the box had not been told that pack 1 arrived. If you do not have pack 1, make a new pack with Also make a new box key ticked.",
    );
    expect(pages[3]!.text).not.toContain("Keep that pack");
  });

  it("on a recovery sheet from before the pack", async () => {
    const pages = await rendered(
      await renderRecoveryPack(
        withLocation({ kind: "sheet", keyName: "2026-09-02 · K7QF", madeOn: "2026-09-02" }),
      ),
    );
    expect(pages[3]!.text).toContain(
      "The key itself is on the recovery sheet whose key name is 2026-09-02 · K7QF, made on 2 September 2026. Keep that sheet.",
    );
  });

  it("also on a server-key page that failed", async () => {
    const pages = await rendered(
      await renderRecoveryPack(
        input({
          parts: [
            bucket,
            archives,
            {
              kind: "server-key",
              state: "failed",
              failure: { what: "The server key page could not be drawn.", todo: "Try again." },
              serverKeyLocation: { kind: "pack", number: 1, madeOn: "2026-09-02", received: true },
            },
          ],
        }),
      ),
    );
    expect(pages[3]!.text).toContain("The server key page could not be drawn.");
    expect(pages[3]!.text).toContain(
      "The key itself is on recovery pack 1, made on 2 September 2026.",
    );
  });

  it("prints every pack number with its date", async () => {
    const pages = await rendered(await renderRecoveryPack(input()));
    for (const { text } of pages) {
      for (const match of text.matchAll(/(?<!have )[Pp]ack (\d+)(.{0,16})/g)) {
        expect(match[2], text).toMatch(/^( · \d| made on \d|, made on \d)/);
      }
    }
  });
});

describe("the secrets on the pages", () => {
  it("draws each code as text and as a QR code that reads back as the same text", async () => {
    const pages = await rendered(await renderRecoveryPack(input()), 3, [0, 1, 2]);
    expect(squash(pages[1]!.text)).toContain(bucketCode);
    expect(pages[1]!.qr).toBe(bucketCode);
    expect(squash(pages[2]!.text)).toContain(archiveCode);
    expect(pages[2]!.qr).toBe(archiveCode);
    expect(pages[0]!.qr).toBeNull();
  });

  it.each([
    ["spaces between words", "correct horse battery staple"],
    ["a space at each end and two in a row", " correct  horse battery staple "],
  ])("draws a passphrase with %s so that every space shows", async (_name, backupKey) => {
    const page: PackPart = {
      kind: "archives",
      state: "included",
      page: {
        title: "Archives",
        rows: [],
        secret: { label: "Backup key", text: backupKey, qr: true, exactSpaces: true },
        notes: [],
      },
    };
    const bytes = await renderRecoveryPack(input({ parts: [page], file: { ...file, backupKey } }));
    expect((await readRecoveryPackPdf(bytes)).backupKey).toBe(backupKey);
    const pages = await rendered(bytes, 3, [1]);
    expect(pages[1]!.qr).toBe(backupKey);
    expect(pages[1]!.text).toContain(backupKey.replaceAll(" ", "\u02fd"));
    expect(pages[1]!.text).toContain(PACK_WORDS.en.spaceMark);
  });

  it("draws other blank characters, and the mark itself, as their code points", async () => {
    const backupKey = "no\u00a0break\u02fdmark tab\there";
    const page: PackPart = {
      kind: "archives",
      state: "included",
      page: {
        title: "Archives",
        rows: [],
        secret: { label: "Key", text: backupKey, qr: true, exactSpaces: true },
        notes: [],
      },
    };
    const bytes = await renderRecoveryPack(input({ parts: [page], file: { ...file, backupKey } }));
    expect((await readRecoveryPackPdf(bytes)).backupKey).toBe(backupKey);
    expect((await rendered(bytes))[1]!.text).toContain(
      "no[U+A0]break[U+2FD]mark\u02fdtab[U+9]here",
    );
  });

  it("draws a code with no space without the space mark or its note", async () => {
    const pages = await rendered(await renderRecoveryPack(input()));
    expect(pages[1]!.text).not.toContain("\u02fd");
    expect(pages[1]!.text).not.toContain(PACK_WORDS.en.spaceMark);
  });

  it("draws a grouped key's spaces as plain spaces when its spaces carry no meaning", async () => {
    const grouped = "ABCD EFGH IJKL";
    const page: PackPart = {
      kind: "server-key",
      state: "included",
      page: {
        title: "Server key",
        rows: [],
        secret: { label: "Server key", text: grouped, qr: true },
        notes: [],
      },
    };
    const pages = await rendered(await renderRecoveryPack(input({ parts: [page] })), 3, [1]);
    expect(pages[1]!.qr).toBe(grouped);
    expect(pages[1]!.text).toContain(grouped);
    expect(pages[1]!.text).not.toContain("\u02fd");
    expect(pages[1]!.text).not.toContain(PACK_WORDS.en.spaceMark);
  });

  it("draws a page's rows and notes", async () => {
    const pages = await rendered(await renderRecoveryPack(input()));
    expect(pages[1]!.text).toContain("Bucket copy");
    expect(pages[1]!.text).toContain("Bucket s3.eu-west-3.amazonaws.com · bar-nora-backups");
    expect(pages[1]!.text).toContain("1. Install Waitron on the new box and open its setup page.");
    expect(pages[1]!.text).toContain("Page 2 of 4");
  });

  it("draws a character the font lacks as its code point", async () => {
    const pages = await rendered(
      await renderRecoveryPack(
        input({
          cover: { ...input().cover, venueName: "Bar 🍷" },
          parts: [
            {
              ...bucket,
              page: { ...bucket.page!, secret: { label: "Code", text: "→🍷", qr: true } },
            },
          ],
        }),
      ),
    );
    expect(pages[0]!.text).toContain("Bar [U+1F377]");
    expect(pages[1]!.text).toContain("→[U+1F377]");
  });
});

describe("the attached file", () => {
  it("is the one embedded file, and reads back equal", async () => {
    const bytes = await renderRecoveryPack(input());
    expect(await readRecoveryPackPdf(bytes)).toEqual(file);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(4);
    const [width, height] = [pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()];
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
  });

  it("refuses a file the format refuses, and a page set too big for the limit", async () => {
    await expect(renderRecoveryPack(input({ file: { ...file, number: 0 } }))).rejects.toThrow(
      "Recovery pack file refused: shape",
    );
    await expect(renderRecoveryPack({ ...input(), maxBytes: 2000 })).rejects.toThrow(
      "Recovery pack file refused: size",
    );
    expect(MAX_PACK_PDF).toBe(8 * 1024 * 1024);
  });

  it("refuses an unknown language or time zone", async () => {
    await expect(renderRecoveryPack(input({ locale: "fr" as "en" }))).rejects.toThrow(
      "Recovery pack refused: locale",
    );
    await expect(renderRecoveryPack(input({ timeZone: "Mars/Olympus" }))).rejects.toThrow(
      "Recovery pack refused: timeZone",
    );
  });
});

it.each(["en", "es"] as const)(
  "prints two distinct emergency QR codes and keeps attachment v1 (%s)",
  async (locale) => {
    const emergency: PackPart = {
      kind: "emergency",
      state: "included",
      lastChanged: "2026-10-12",
      page: {
        title: "Emergency start",
        intro: "Starts a locked copy; sign in with your password.",
        address: { label: "Emergency address", text: "https://rescue.venue.example/", qr: true },
        secret: { label: "Emergency code", text: "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ", qr: true },
        rows: [{ label: "People", value: "Alex Smith" }],
        notes: ["Unplug the old box first."],
      },
    };
    const bytes = await renderRecoveryPack(
      input({ locale, parts: [emergency, bucket, archives, serverKey] }),
    );
    const pages = await rendered(bytes);
    expect(pages).toHaveLength(5);
    expect(pages[0]!.text).toContain(PACK_WORDS[locale].emergencyWarning);
    if (locale === "en")
      expect(pages[0]!.text).toContain(
        "You also need your password and your authenticator or a recovery code.",
      );
    expect(pages[1]!.text).toContain("https://rescue.venue.example/");
    expect(squash(pages[1]!.text)).toContain("ABCD-EFGH-JKLM-NPQR-STUV-WXYZ");
    expect(await readRecoveryPackPdf(bytes)).toEqual(file);
    const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
    try {
      const pdf = await loading.promise;
      const page = await pdf.getPage(2);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({ canvas: canvas as never, canvasContext: context as never, viewport })
        .promise;
      const codes: string[] = [];
      for (const [top, height] of [
        [0, 550],
        [550, canvas.height - 550],
      ]) {
        const pixels = context.getImageData(0, top!, canvas.width, height!);
        codes.push(jsQR(pixels.data, canvas.width, height!)?.data ?? "");
      }
      expect(codes).toEqual(["https://rescue.venue.example/", "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ"]);
    } finally {
      await loading.destroy();
    }
  },
);

describe("pack typography", () => {
  it("uses equal-width glyphs for Latin codes and visible spaces", () => {
    const mono = create(monoBytes as never) as Font;
    const characters =
      Array.from({ length: 224 }, (_, i) => String.fromCodePoint(i + 32))
        .filter((c) => !/[\u007f-\u009f]/u.test(c))
        .join("") + "\u02fd";
    for (const character of characters) {
      expect(mono.hasGlyphForCodePoint(character.codePointAt(0)!), character).toBe(true);
      expect(mono.glyphForCodePoint(character.codePointAt(0)!).advanceWidth, character).toBe(600);
    }
  });

  it.each(["en", "es"] as const)(
    "embeds mono for codes, addresses, Check and marked rows, with stroked headings (%s)",
    async (locale) => {
      const code = "Il10O-aB2";
      const address = "https://rescue.venue.example/";
      const name = "2026-11-16-Il10O";
      const part: PackPart = {
        ...bucket,
        check: name,
        page: {
          title: "Recovery page",
          address: { label: "Address", text: address, qr: true },
          secret: { label: "Code", text: code, qr: true },
          rows: [{ label: "Key name", value: name, mono: true }],
          notes: ["Keep this pack."],
        },
      };
      const bytes = await renderRecoveryPack(input({ locale, parts: [part] }));
      const task = getDocument({
        data: bytes.slice(),
        useSystemFonts: false,
        fontExtraProperties: true,
      });
      try {
        const pdf = await task.promise;
        expect(pdf.numPages).toBe(2);
        for (const [pageNumber, values] of [
          [1, [name]],
          [2, [address, code, name]],
        ] as const) {
          const page = await pdf.getPage(pageNumber);
          const ops = await page.getOperatorList();
          const content = await page.getTextContent();
          for (const value of values) {
            const item = content.items.find((item) => "str" in item && item.str === value);
            expect(item, value).toBeDefined();
            if (item && "fontName" in item)
              expect(page.commonObjs.get(item.fontName).name).toContain("NotoSansMono");
          }
          const modes = ops.fnArray.flatMap((op, i) =>
            op === OPS.setTextRenderingMode ? [ops.argsArray[i]![0]] : [],
          );
          expect(modes).toContain(2);
          const ink = { bold: [] as string[], plain: [] as string[] };
          let mode = 0;
          const saved: number[] = [];
          ops.fnArray.forEach((op, i) => {
            if (op === OPS.save) saved.push(mode);
            if (op === OPS.restore) mode = saved.pop()!;
            if (op === OPS.setTextRenderingMode) mode = ops.argsArray[i]![0];
            if (op === OPS.showText) {
              const glyphs = ops.argsArray[i]![0] as ({ unicode: string } | number)[];
              ink[mode === 2 ? "bold" : "plain"].push(
                glyphs.map((glyph) => (typeof glyph === "number" ? "" : glyph.unicode)).join(""),
              );
            }
          });
          const words = PACK_WORDS[locale];
          const headings =
            pageNumber === 1
              ? [
                  words.title,
                  words.whichPage,
                  words.whatIsIn,
                  words.whatHappened,
                  words.partColumn,
                  words.lastChangedColumn,
                  words.checkColumn,
                  words.lockedAway,
                ]
              : [part.page!.title];
          for (const text of headings) expect(squash(ink.bold.join(" "))).toContain(squash(text));
          const plain = pageNumber === 1 ? [name] : [address, code, name, "Keep this pack."];
          for (const text of plain) expect(squash(ink.plain.join(" "))).toContain(squash(text));
        }
        const pages = await rendered(bytes);
        expect(pages[0]!.text).not.toContain(
          locale === "en" ? "shows the same checks" : "muestra las mismas comprobaciones",
        );
        expect(await readRecoveryPackPdf(bytes)).toEqual(file);
      } finally {
        await task.destroy();
      }
    },
  );
});

it.each(["en", "es"] as const)(
  "keeps long mono locations whole on one page per part (%s)",
  async (locale) => {
    const endpoint = `https://${"location-".repeat(10)}example.net:9000`;
    const bucketName = "venue-" + "b".repeat(57);
    const prefix = "year/" + "folder-".repeat(24);
    const values = [`${endpoint} · ${bucketName}`, `${bucketName} / ${prefix}`];
    const parts: PackPart[] = values.map((value) => ({
      ...bucket,
      page: { ...bucket.page!, rows: [{ label: "Location", value, mono: true }] },
    }));
    const pages = await rendered(await renderRecoveryPack(input({ locale, parts })));
    expect(pages).toHaveLength(3);
    for (const [i, value] of values.entries()) {
      expect(squash(pages[i + 1]!.text)).toContain(squash(value));
      expect(pages[i + 1]!.text).not.toContain("…");
      expect(squash(pages[i + 1]!.text)).toContain(bucketCode);
    }
  },
);
