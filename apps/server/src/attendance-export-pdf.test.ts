import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import {
  attendanceExportFixture,
  longToken,
  seedAttendanceExport,
} from "../test/attendance-export-fixture.js";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "@waitron/workforce";
import { renderAttendancePdf } from "./attendance-export-pdf.js";
import { renderAttendanceCsv } from "./attendance-export-csv.js";

async function rendered(input = attendanceExportFixture()) {
  const bytes = await renderAttendancePdf(input);
  const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      pages.push({
        viewport: page.getViewport({ scale: 1 }),
        content: await page.getTextContent(),
        annotations: await page.getAnnotations(),
      });
    }
    return {
      bytes,
      pages,
      text: pages
        .flatMap((p) => p.content.items.flatMap((v) => ("str" in v ? [v.str] : [])))
        .join(" "),
      metadata: await pdf.getMetadata(),
      attachments: await pdf.getAttachments(),
      scripts: await pdf.getJSActions(),
      action: await pdf.getOpenAction(),
    };
  } finally {
    await loading.destroy();
  }
}

describe("working-time PDF", () => {
  it("renders every section and long text once, wraps unbroken references and stays within A4", async () => {
    const { pages, text } = await rendered();
    expect(pages.length).toBeGreaterThan(2);
    for (const marker of [
      "SESSION-MARKER",
      "AUTHOR-MARKER",
      "NOTE-MARKER",
      "REASON-FINAL-MARKER",
      "TEXT-FINAL",
      ...Array.from({ length: 10 }, (_, i) => `MARKER${i}END`),
    ])
      expect(text.split(marker), marker).toHaveLength(2);
    for (let i = 0; i < 90; i++) expect(text.split(`Paragraph ${i}:`)).toHaveLength(2);
    expect(text.replace(/\s/gu, "").split(longToken)).toHaveLength(2);
    for (const value of [
      "María Muñoz",
      "José",
      "niñez",
      "2020-01-01",
      "2026-02-01",
      "-60",
      "true",
      "null",
      "false",
      "[U+1F600]",
      "no disponibles",
      "<script>alert(1)</script>",
    ])
      expect(text).toContain(value);
    expect(text).not.toContain("\u0000");
    expect(text).not.toContain("\u0001");
    for (const [index, page] of pages.entries()) {
      expect(page.viewport.width).toBeCloseTo(595.28, 2);
      expect(page.viewport.height).toBeCloseTo(841.89, 2);
      const pageText = page.content.items.flatMap((v) => ("str" in v ? [v.str] : [])).join(" ");
      expect(pageText).toContain(`Página ${index + 1} / ${pages.length}`);
      expect(
        page.content.items.some((v) => "str" in v && v.str.includes("Registro de jornada")),
      ).toBe(true);
      expect(
        page.content.items.filter((v) => "str" in v && !v.str.startsWith("Página") && v.str.trim())
          .length,
      ).toBeGreaterThan(2);
      for (const item of page.content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        expect(item.transform[4], item.str).toBeGreaterThanOrEqual(35.9);
        expect(item.transform[4] + item.width, item.str).toBeLessThanOrEqual(559.4);
        expect(item.transform[5], item.str).toBeGreaterThan(25);
        expect(item.transform[5] + item.height, item.str).toBeLessThan(815);
      }
    }
  });

  it("treats hostile text as inert text without links, scripts or attachments", async () => {
    const output = await rendered();
    expect(output.attachments).toBeNull();
    expect(output.scripts).toBeNull();
    expect(output.action).toBeNull();
    for (const page of output.pages) expect(page.annotations).toEqual([]);
    expect(output.text).toContain("https://example.test/");
    expect(JSON.stringify(output.metadata)).not.toContain("REASON-FINAL-MARKER");
  });

  it("keeps every row when a compact table continues across pages", async () => {
    const input = attendanceExportFixture();
    input.sections = [
      {
        key: "sessions",
        title: "COMPLETED-HEADING",
        layout: "table",
        columns: [
          { key: "name", label: "Worker" },
          { key: "minutes", label: "Worked minutes" },
        ],
        rows: Array.from({ length: 85 }, (_, i) => ({
          key: `session-${i}`,
          cells: { name: `ROW${i}END ${i === 40 ? longToken : "María"}`, minutes: i },
        })),
      },
    ];
    const output = await rendered(input);
    expect(output.pages.length).toBeGreaterThan(2);
    for (let i = 0; i < 85; i++) expect(output.text.split(`ROW${i}END`)).toHaveLength(2);
    expect(output.text.replace(/\s/gu, "").split(longToken)).toHaveLength(2);
    for (const page of output.pages) {
      const text = page.content.items.flatMap((v) => ("str" in v ? [v.str] : [])).join(" ");
      expect(text).toContain("COMPLETED-HEADING");
      expect(text).toContain("Worked minutes");
      for (const item of page.content.items)
        if ("str" in item && item.str.trim()) {
          expect(item.transform[4] + item.width, item.str).toBeLessThanOrEqual(559.4);
          expect(item.transform[5], item.str).toBeGreaterThan(25);
        }
    }
  });

  it.each(["en", "es"] as const)(
    "renders empty and open-only records readably in %s",
    async (locale) => {
      const input = attendanceExportFixture();
      input.locale = locale;
      input.sections = [];
      input.notes = [
        locale === "es"
          ? "Sin turnos completados. El inicio permanece en el historial."
          : "No completed shifts. The start remains in history.",
      ];
      const output = await rendered(input);
      expect(output.pages).toHaveLength(1);
      expect(output.text).toContain(input.notes[0]);
      expect(output.text).toContain(locale === "es" ? "Página 1 / 1" : "Page 1 / 1");
      expect(output.text).not.toContain("undefined");
    },
  );
});

describe("real provider document bytes", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  });
  it("keeps names and provenance but omits profile data and representatives live and frozen reasons in both formats", async () => {
    const fixture = await seedAttendanceExport(suite.db);
    const standard = await fixture.document("standard");
    const representatives = await fixture.document("representatives");
    for (const doc of [standard, representatives]) {
      const output = await rendered(doc);
      const csv = new TextDecoder().decode(renderAttendanceCsv(doc));
      const metadata = JSON.stringify(output.metadata);
      for (const forbidden of [
        "CONTACT-CANARY",
        "MANAGER-CONTACT",
        "+34999111222",
        "PROFILE-CANARY",
        "LOGIN-CANARY",
      ]) {
        expect(output.text).not.toContain(forbidden);
        expect(csv).not.toContain(forbidden);
        expect(metadata).not.toContain(forbidden);
      }
      for (const retained of [
        "María Muñoz",
        "José",
        fixture.personId,
        fixture.managerId,
        fixture.nodeId,
        "2026-01-05T18:00:00+01:00",
      ]) {
        expect(output.text).toContain(retained);
        expect(csv).toContain(retained);
      }
      const history = doc.sections.find((s) => s.key === "history")!;
      const frozen = doc.sections.find((s) => s.key === "frozen-history")!;
      expect(history.rows).toHaveLength(4);
      expect(frozen.rows).toHaveLength(4);
      for (const entry of history.rows) {
        expect(output.text).toContain(entry.cells.entryId);
        expect(csv).toContain(entry.cells.entryId);
      }
      expect(output.text.includes("ID-NUMBER-CANARY")).toBe(doc.audience === "standard");
      expect(csv.includes("ID-NUMBER-CANARY")).toBe(doc.audience === "standard");
      expect(metadata).not.toContain("ID-NUMBER-CANARY");
      expect(output.text).toContain("540");
      expect(csv).toContain('"540"');
    }
  });
});
