import { expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderRecoveryPdf } from "./recovery-pdf-node.js";
import { recoveryDocumentBytes, type RecoveryDocument } from "./recovery-document.js";

const document: RecoveryDocument = {
  kind: "waitron-recovery-document",
  version: 1,
  scope: { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" },
  taxpayerName: "Olivo Restauración SL",
  venueName: "Olivo Centro",
  createdAt: "2026-10-18T17:29:32.728Z",
  installationCodes: ["06RB"],
  nodeKey: {
    nodeId: "3262bf78-1d78-4b10-bae6-61fda564d5e8",
    name: "2026-10-18 · K7QF",
    secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
  },
};

it.each([
  ["en", "Europe/Madrid", "2026-10-18T17:29:32.728Z", "18 October 2026, 19:29", "CEST"],
  ["en", "Atlantic/Canary", "2026-10-18T17:29:32.728Z", "18 October 2026, 18:29", "WEST"],
  ["es", "Europe/Madrid", "2026-10-18T17:29:32.728Z", "18 de octubre de 2026, 19:29", "CEST"],
  ["es", "Atlantic/Canary", "2026-10-18T17:29:32.728Z", "18 de octubre de 2026, 18:29", "WEST"],
  ["en", "Europe/Madrid", "2026-01-18T17:29:32.728Z", "18 January 2026, 18:29", "CET"],
  ["en", "Atlantic/Canary", "2026-01-18T17:29:32.728Z", "18 January 2026, 17:29", "WET"],
  ["es", "Europe/Madrid", "2026-01-18T17:29:32.728Z", "18 de enero de 2026, 18:29", "CET"],
  ["es", "Atlantic/Canary", "2026-01-18T17:29:32.728Z", "18 de enero de 2026, 17:29", "WET"],
] as const)("prints readable %s dates in %s at %s", async (locale, zone, createdAt, date, name) => {
  const input = { ...document, createdAt };
  const bytes = await renderRecoveryPdf(input, locale, zone);
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false, useWasm: false });
  try {
    const pdf = await task.promise;
    expect(pdf.numPages).toBe(1);
    const items = (await (await pdf.getPage(1)).getTextContent()).items.filter(
      (item) => "str" in item && item.str.trim() !== "",
    );
    const text = items.map((item) => ("str" in item ? item.str : "")).join(" ");
    expect(text).toContain(date);
    expect(text).toContain(name);
    expect(text).toContain(`${date} ${name}`);
    expect(text).not.toContain(input.createdAt);
    expect(text).toContain("3262 BF78");
    expect(text).not.toContain(document.nodeKey.nodeId);
    const label = items.find(
      (item) => "str" in item && item.str === (locale === "en" ? "Legal name" : "Razón social"),
    );
    const value = items.find((item) => "str" in item && item.str === document.taxpayerName);
    expect(label).toBeDefined();
    expect(value).toBeDefined();
    if (!label || !value || !("transform" in label) || !("transform" in value))
      throw new Error("Missing text coordinates");
    expect(value.transform[4] - label.transform[4]).toBeGreaterThan(130);
    expect(value.transform[5]).toBeCloseTo(label.transform[5], 1);
    expect(text).not.toMatch(/raw192|47 characters|47 caracteres/);
    for (const instruction of locale === "en"
      ? [
          "Waitron Cloud",
          "Cloud login",
          "backup file",
          "own password",
          "separately from this sheet",
        ]
      : [
          "Waitron Cloud",
          "acceso a Cloud",
          "archivo de copia",
          "propia contraseña",
          "separados de esta hoja",
        ])
      expect(text).toContain(instruction);
    expect(await pdf.getAttachmentContent("waitron-recovery-key-v1.json")).toEqual(
      recoveryDocumentBytes(input),
    );
  } finally {
    await task.destroy();
  }
});

it.each(["", "Not/AZone", undefined])(
  "refuses a missing or invalid venue time zone: %s",
  async (zone) => {
    await expect(renderRecoveryPdf(document, "en", zone as string)).rejects.toThrow(
      "Recovery PDF refused",
    );
  },
);
