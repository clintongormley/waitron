import { describe, expect, it } from "vitest";
import { renderRecoveryPdf } from "./recovery-pdf.js";
import { readRecoveryPdf, openRecoveryPdf } from "./recovery-reader.js";
import { recoveryDocumentBytes, type RecoveryDocument } from "./recovery-document.js";
import { decodeRecoveryKey } from "./recovery-key-code.js";

const document: RecoveryDocument = {
  kind: "waitron-recovery-document",
  installationCodes: ["06RB"],
  version: 1,
  scope: { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" },
  taxpayerName: "Olivo Restauración SL",
  venueName: "Olivo Centro",
  createdAt: "2026-10-17T12:30:00.000Z",
  nodeKey: { nodeId: "node-1", name: "Caja principal", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
};
describe("key-only recovery PDF", () => {
  it.each(["en", "es"] as const)(
    "renders complete A4 identification and recoverable printed values in %s",
    async (locale) => {
      const bytes = await renderRecoveryPdf(document, locale, "Europe/Madrid");
      expect(await readRecoveryPdf(bytes)).toEqual({
        document,
        attachmentBytes: recoveryDocumentBytes(document),
      });
      const task = openRecoveryPdf(bytes);
      try {
        const pdf = await task.promise;
        expect(pdf.numPages).toBe(1);
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        expect(viewport.width).toBeCloseTo(595.28, 1);
        expect(viewport.height).toBeCloseTo(841.89, 1);
        const text = (await page.getTextContent()).items
          .map((i) => ("str" in i ? i.str : ""))
          .join(" ");
        for (const value of [
          document.taxpayerName,
          document.venueName,
          document.scope.taxpayerNif,
          document.scope.softwareId,
          "NODE -1",
          document.nodeKey.name,
          locale === "en" ? "17 October 2026, 14:30" : "17 de octubre de 2026, 14:30",
        ])
          expect(text).toContain(value);
        expect(text).toContain(
          locale === "en" ? "Waitron recovery key" : "Clave de recuperación de Waitron",
        );
        expect(text).not.toMatch(/raw192|47 characters|47 caracteres/);
        for (const instruction of locale === "en"
          ? [
              "Keep this sheet",
              "matching backup",
              "own password",
              "separately from this sheet",
              "older sheets for older backups",
            ]
          : [
              "Guarda esta hoja",
              "copia de seguridad correspondiente",
              "propia contraseña",
              "separados de esta hoja",
              "hojas anteriores para copias anteriores",
            ])
          expect(text).toContain(instruction);
        const value = text.match(/(?:Key|Clave): ([0-9A-Z ]{51})/)![1]!.trim();
        expect(value.replaceAll(" ", "")).toHaveLength(41);
        expect(value.length).toBe(51);
        expect(text).not.toMatch(/(?:Check|Control):/);
        expect(decodeRecoveryKey(value.toLowerCase())).toBe(document.nodeKey.secret);
        expect(text).not.toMatch(/allocation|register|signing|administrator|TLS|S000001|P000001/i);
      } finally {
        await task.destroy();
      }
    },
  );
  it.each(["en", "es"] as const)(
    "keeps the recovery key block together with maximum labels in %s",
    async (locale) => {
      const label = (prefix: string) => prefix + "W".repeat(254) + "Z";
      const input: RecoveryDocument = {
        ...document,
        taxpayerName: label("L"),
        venueName: label("V"),
        nodeKey: { ...document.nodeKey, nodeId: label("N"), name: label("K") },
      };
      const task = openRecoveryPdf(await renderRecoveryPdf(input, locale, "Europe/Madrid"));
      try {
        const pdf = await task.promise;
        const texts: string[] = [];
        for (let n = 1; n <= pdf.numPages; n++)
          texts.push(
            (await (await pdf.getPage(n)).getTextContent()).items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" "),
          );
        for (const value of [input.taxpayerName, input.venueName, "NWWWWWWW", input.nodeKey.name])
          expect(texts.join("").replace(/\s/g, "")).toContain(value);
        const keyPage = texts.find((text) => text.includes(locale === "en" ? "Key:" : "Clave:"));
        expect(keyPage).toContain(locale === "en" ? "Key:" : "Clave:");
        expect(keyPage).not.toContain(locale === "en" ? "Check:" : "Control:");
        expect(keyPage).toContain("06R9 T4FH M4H3 599J EEMM 5D5D ABTV 2RSX 6QDQ WE8M C");
      } finally {
        await task.destroy();
      }
    },
  );
  it("freezes the input before font loading", async () => {
    const d = structuredClone(document);
    const pending = renderRecoveryPdf(d, "en", "Europe/Madrid");
    Object.assign(d.nodeKey, { secret: "z".repeat(32) });
    expect((await readRecoveryPdf(await pending)).document).toEqual(document);
  });
});
