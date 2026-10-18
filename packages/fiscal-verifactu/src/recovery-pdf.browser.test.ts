import { describe, expect, it } from "vitest";
import { renderRecoveryPdf } from "./recovery-pdf.js";
import { readRecoveryPdf, openRecoveryPdf } from "./recovery-reader.js";
import { recoveryDocumentBytes, type RecoveryDocument } from "./recovery-document.js";
import { decodeNodeKey } from "./paper-register-compact.js";

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
      const bytes = await renderRecoveryPdf(document, locale);
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
          document.nodeKey.nodeId,
          document.nodeKey.name,
          document.createdAt,
        ])
          expect(text).toContain(value);
        expect(text).toContain(
          locale === "en" ? "Waitron recovery key" : "Clave de recuperación de Waitron",
        );
        expect(text).toContain(
          locale === "en" ? "Standard key (raw192)" : "Clave estándar (raw192)",
        );
        for (const instruction of locale === "en"
          ? [
              "Keep this sheet",
              "matching backup",
              "separate backup password",
              "older sheets for older backups",
            ]
          : [
              "Guarda esta hoja",
              "copia de seguridad correspondiente",
              "contraseña independiente",
              "hojas anteriores para copias anteriores",
            ])
          expect(text).toContain(instruction);
        const value = text.match(/(?:Key|Clave): ([0-9A-Z ]{48})/)![1]!.trim();
        const check = text.match(/(?:Check|Control): ([0-9A-Z]{4} [0-9A-Z]{4})/)![1]!;
        expect(value.replaceAll(" ", "")).toHaveLength(39);
        expect(value.length + check.length).toBe(57);
        expect(
          await decodeNodeKey(
            { encoding: "raw192", value: value.toLowerCase(), check: check.toLowerCase() },
            document.scope,
            document.nodeKey.nodeId,
            document.nodeKey.name,
          ),
        ).toBe(document.nodeKey.secret);
        expect(text).not.toMatch(
          /allocation|register|signing|Cloud|administrator|TLS|S000001|P000001/i,
        );
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
      const task = openRecoveryPdf(await renderRecoveryPdf(input, locale));
      try {
        const pdf = await task.promise;
        const texts: string[] = [];
        for (let n = 1; n <= pdf.numPages; n++)
          texts.push(
            (await (await pdf.getPage(n)).getTextContent()).items
              .map((item) => ("str" in item ? item.str : ""))
              .join(" "),
          );
        for (const value of [
          input.taxpayerName,
          input.venueName,
          input.nodeKey.nodeId,
          input.nodeKey.name,
        ])
          expect(texts.join("").replace(/\s/g, "")).toContain(value);
        const keyPage = texts.find((text) =>
          text.includes(locale === "en" ? "Standard key (raw192)" : "Clave estándar (raw192)"),
        );
        expect(keyPage).toContain(locale === "en" ? "Key:" : "Clave:");
        expect(keyPage).toContain(locale === "en" ? "Check:" : "Control:");
        expect(keyPage).toContain("47");
      } finally {
        await task.destroy();
      }
    },
  );
  it("freezes the input before font loading", async () => {
    const d = structuredClone(document);
    const pending = renderRecoveryPdf(d, "en");
    Object.assign(d.nodeKey, { secret: "z".repeat(32) });
    expect((await readRecoveryPdf(await pending)).document).toEqual(document);
  });
});
