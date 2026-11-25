import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadRecoveryPackFonts } from "./recovery-pdf-node.js";
import type { RecoveryDocument } from "./recovery-document.js";
import { renderSetupRecoveryPack } from "./setup-recovery-pack.js";
import { readRecoveryPackPdf } from "@waitron/recovery-pack/src/read-pack-pdf.js";

const document: RecoveryDocument = {
  kind: "waitron-recovery-document",
  version: 1,
  scope: { taxpayerNif: "B12345674", softwareId: "WT", environment: "production" },
  taxpayerName: "Olivo SL",
  venueName: "Olivo Centro",
  createdAt: "2026-10-18T00:10:00.000Z",
  nodeKey: { nodeId: "node-1", name: "2026-10-17 · ACRY" },
};

async function pages(bytes: Uint8Array): Promise<string[]> {
  const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
  try {
    const pdf = await loading.promise;
    const texts: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const items = (await (await pdf.getPage(n)).getTextContent()).items;
      texts.push(
        items
          .flatMap((item) => ("str" in item ? [item.str] : []))
          .join(" ")
          .replace(/\s+/g, " "),
      );
    }
    return texts;
  } finally {
    await loading.destroy();
  }
}

const made = {
  masterKey: "88DP 74BA YPVB RRM5 XFV2 WPQY B5M5",
  masterKeyName: "2026-11-23 · QZJV",
};

it.each(["en", "es"] as const)(
  "draws in full a venue name at the recovery document's 256, in the widest letter the pack's font draws, in %s",
  async (locale) => {
    const venueName = "Ԫ".repeat(256);
    const texts = await pages(
      await renderSetupRecoveryPack(
        { ...document, venueName },
        made,
        locale,
        "Europe/Madrid",
        loadRecoveryPackFonts,
      ),
    );
    expect(texts).toHaveLength(1);
    expect(texts[0]!.replace(/\s+/g, "")).toContain(venueName);
  },
);

it.each(["en", "es"] as const)(
  "pack 1 drawn at setup has no box-key page and its file holds no server key, in %s",
  async (locale) => {
    const bytes = await renderSetupRecoveryPack(
      document,
      made,
      locale,
      "Europe/Madrid",
      loadRecoveryPackFonts,
    );
    const texts = await pages(bytes);
    expect(texts).toHaveLength(1);
    expect(texts[0]).not.toContain("ACRY");
    expect(texts[0]).toContain("QZJV");
    expect(await readRecoveryPackPdf(bytes)).toEqual({
      kind: "waitron-recovery-pack",
      version: 2,
      number: 1,
      madeAt: document.createdAt,
      bucketCode: null,
      archiveCode: null,
      backupKey: null,
      masterKey: made.masterKey,
      masterKeyName: made.masterKeyName,
      masterKeyHeldBy: null,
    });
  },
);
