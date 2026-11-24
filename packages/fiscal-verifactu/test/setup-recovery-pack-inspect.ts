import { expect } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readRecoveryPackPdf } from "@waitron/recovery-pack";
import type { RecoveryDocument } from "../src/recovery-document.js";

export const setupPackDocument: RecoveryDocument = {
  kind: "waitron-recovery-document",
  version: 1,
  scope: { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" },
  taxpayerName: "Olivo Restauración SL",
  venueName: "Olivo Centro",
  createdAt: "2026-10-17T12:30:00.000Z",
  nodeKey: { nodeId: "node-1", name: "Caja principal", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
};

/** Checks a setup recovery pack drawn for {@link setupPackDocument}. */
export async function inspectSetupRecoveryPack(bytes: Uint8Array, locale: "en" | "es") {
  const embedded = new Set(
    Array.from(
      Buffer.from(bytes)
        .toString("latin1")
        .matchAll(/\/BaseFont\s*\/[A-Z]{6}\+([\w-]+)/g),
      (match) => match[1],
    ),
  );
  expect([...embedded].sort(), "embedded fonts").toEqual([
    "NotoSans-Regular",
    "NotoSansMono-Regular",
  ]);
  const task = getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    useWasm: false,
  });
  try {
    const pdf = await task.promise;
    expect(pdf.numPages).toBe(2);
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++)
      pages.push(
        (await (await pdf.getPage(n)).getTextContent()).items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " "),
      );
    const [keyPage, serverKey] = pages as [string, string];
    expect(keyPage.trim()).toBe(
      locale === "en"
        ? "Waitron recovery pack · Olivo Centro Master key · 2026-11-23 · QZJV 88DP 74BA YPVB RRM5 XFV2 WPQY B5M5 Master key"
        : "Paquete de recuperación de Waitron · Olivo Centro Clave maestra · 2026-11-23 · QZJV 88DP 74BA YPVB RRM5 XFV2 WPQY B5M5 Clave maestra",
    );
    for (const expected of [
      locale === "en" ? "Box key" : "Clave del servidor",
      "Olivo Restauración SL",
      "Olivo Centro",
      "B12345674",
      "06R9 T4FH M4H3 599J EEMM 5D5D ABTV 2RSX 6QDQ WE8M C",
      locale === "en" ? "17 October 2026, 14:30 CEST" : "17 de octubre de 2026, 14:30 CEST",
    ])
      expect(serverKey).toContain(expected);
    expect(pages.join(" ")).not.toContain("TKR0 K07W");
  } finally {
    await task.destroy();
  }
  const file = await readRecoveryPackPdf(bytes);
  expect(file.serverKey).toEqual(setupPackDocument);
  expect(file.serverKeyName).toBe("Caja principal");
  expect([file.masterKey, file.masterKeyName]).toEqual([
    "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5",
    "2026-11-23 · QZJV",
  ]);
}
