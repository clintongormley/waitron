import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { type EscSetting } from "@waitron/printing";
import {
  formatCorrectionSlip,
  formatKitchenNoteChangeSlip,
  formatKitchenTicket,
  formatMovedSlip,
  joinKitchenTickets,
  movedPlaceText,
} from "./kitchen-ticket.js";
import { formatOrderNumberSlip } from "./order-number-slip.js";
import { previewPrintJob } from "./print-job-preview.js";
import { printedCommands } from "./testing/decode-ticket.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { ALLERGEN_NAMES } from "./i18n/kitchen-allergy.js";

const layouts = [
  { paperWidth: "58mm", resolution: "180dpi", width: 360 },
  { paperWidth: "58mm", resolution: "203dpi", width: 384 },
  { paperWidth: "80mm", resolution: "180dpi", width: 512 },
  { paperWidth: "80mm", resolution: "203dpi", width: 576 },
] satisfies (EscSetting & { width: number })[];
const at = new Date(2026, 9, 29, 13, 24);

describe("A964 paper layout", () => {
  for (const language of ["en", "es"] as const) {
    it.each(layouts)(
      `${language} renders complete papers at $paperWidth $resolution`,
      async (layout) => {
        const w = kitchenTicketWords(language);
        const allergy = {
          who: "Window guest with a long name",
          allergens: { milk: {} },
          clashes: { milk: {} },
          note: "Separate pan and separate utensils, serve last",
          labels: {
            en: { avoids: [ALLERGEN_NAMES.milk.en], clashes: [ALLERGEN_NAMES.milk.en] },
            es: { avoids: [ALLERGEN_NAMES.milk.es], clashes: [ALLERGEN_NAMES.milk.es] },
          },
        };
        const item = {
          qty: "2.000",
          name: "Pass roast with long kitchen wording",
          modifiers: ["Pass option: long recorded label"],
          crossRefs: [
            w.withRef.replace("{name}", () => "$& chips").replace("{station}", () => "Fryer"),
          ],
          note: "No salt and keep both portions together",
          group: 3,
          allergy,
        };
        const head = {
          locale: language,
          tableLabel: "Window table and garden",
          orderNumber: "281",
          firedAt: at,
          party: { name: "Alex with a long party name", locale: language },
          kitchenNote: { text: "Serve all dishes at the same time", locale: language },
        };
        const ticket = (reprint = false, hold = false) =>
          formatKitchenTicket(
            {
              ...head,
              scope: "station",
              stationName: "Grill",
              items: [item],
              ...(reprint ? { reprintedAt: at } : {}),
              ...(hold ? { mark: "HOLD" as const } : {}),
            },
            layout,
          );
        const fixtures = [
          { name: "regular-allergy", payload: ticket(), contains: ["Grill", "281", "Pass roast"] },
          {
            name: "shared",
            payload: formatKitchenTicket(
              {
                ...head,
                scope: "stations",
                stations: [
                  { stationName: "Grill", items: [item] },
                  { stationName: "Fryer", items: [{ qty: 1, name: "Pass chips", group: 4 }] },
                ],
                alsoOnOrder: {
                  locale: language,
                  items: [{ qty: 1, name: "Water", stationName: "Bar", held: true }],
                },
              },
              layout,
            ),
            contains: ["Grill · Fryer", "Pass chips", w.alsoOnOrder],
          },
          {
            name: "correction",
            payload: formatCorrectionSlip(
              {
                locale: language,
                kind: "HOLD CHANGED",
                direction: "removed",
                stationName: "Grill",
                tableLabel: head.tableLabel,
                orderNumber: head.orderNumber,
                at: at.toISOString(),
                item,
              },
              layout,
            ),
            contains: [w.holdChanged, "-2.000", "Pass roast"],
          },
          {
            name: "note-removed",
            payload: formatKitchenNoteChangeSlip(
              {
                locale: language,
                stations: [{ stationName: "Grill", items: [item] }],
                tableLabel: head.tableLabel,
                orderNumber: head.orderNumber,
                at: at.toISOString(),
                orderNoteChange: { before: "Serve together before the train leaves", after: null },
              },
              layout,
            ),
            contains: [w.noteRemoved, w.noteRemovedBody, "Serve together"],
          },
          {
            name: "moved",
            payload: formatMovedSlip(
              {
                locale: language,
                stationName: "Grill",
                fromNumber: "281",
                toNumber: "282",
                fromText: movedPlaceText({ counter: true, names: [] }, language),
                toText: "Garden table",
                at: at.toISOString(),
                items: [item],
                held: [{ group: 4, items: [{ qty: 1, name: "Pass dessert" }] }],
              },
              layout,
            ),
            contains: [w.moved, w.counter, "Garden table", w.hold, "Pass dessert"],
          },
          {
            name: "joined-reprint",
            payload: joinKitchenTickets(ticket(true), ticket(true, true)),
            contains: [w.reprint.replace("{time}", () => "13:24"), w.hold, "Pass roast"],
          },
          {
            name: "collection",
            payload: formatOrderNumberSlip({ orderNumber: 281, language }, layout),
            contains: [w.collectionOrder, "281"],
          },
        ];
        const pictures: {
          input: Buffer;
          raw: { width: number; height: number; channels: 1 };
          top: number;
          left: number;
        }[] = [];
        const metadata = [];
        let top = 0;
        for (const fixture of fixtures) {
          const preview = previewPrintJob(fixture.payload);
          expect(preview.unsupported, fixture.name).toBe(false);
          expect(preview.truncated, fixture.name).toBe(false);
          expect(preview.widthDots, fixture.name).toBe(layout.width);
          expect(preview.columns).toBe(layout.paperWidth === "58mm" ? 30 : 42);
          for (const line of preview.text.split("\n"))
            expect(line.length, fixture.name + ": " + line).toBeLessThanOrEqual(preview.columns);
          const normalized = preview.text.replace(/\s+/g, " ");
          for (const content of fixture.contains)
            expect(normalized, fixture.name).toContain(content);
          expect(printedCommands(fixture.payload).filter((c) => c.name === "GS V")).toHaveLength(1);
          const images = preview.blocks.filter((b) => b.kind === "image");
          expect(images.length).toBeGreaterThan(1);
          for (const image of images) {
            expect(image.width).toBe(layout.width);
            const dots = Buffer.from(image.data, "base64");
            const pixels = Buffer.alloc(image.width * image.height, 255);
            const stride = Math.ceil(image.width / 8);
            for (let y = 0; y < image.height; y++)
              for (let x = 0; x < image.width; x++)
                if ((dots[y * stride + Math.floor(x / 8)]! & (0x80 >> (x % 8))) !== 0)
                  pixels[y * image.width + x] = 0;
            pictures.push({
              input: pixels,
              raw: { width: image.width, height: image.height, channels: 1 },
              top,
              left: 0,
            });
            top += image.height;
          }
          metadata.push({
            name: fixture.name,
            language,
            layout,
            lines: preview.text.split("\n"),
            bottom: top,
          });
          top += 48;
        }
        if (process.env.A964_LOOK_DIR) {
          const dir = process.env.A964_LOOK_DIR;
          await mkdir(dir, { recursive: true });
          const stem = `${language}-${layout.paperWidth}-${layout.resolution}`;
          await sharp({
            create: { width: layout.width, height: top, channels: 3, background: "white" },
          })
            .composite(pictures)
            .png()
            .toFile(join(dir, `${stem}.png`));
          await writeFile(join(dir, `${stem}.json`), JSON.stringify(metadata, null, 2));
          console.log(join(dir, `${stem}.png`));
        }
      },
    );
  }
});
