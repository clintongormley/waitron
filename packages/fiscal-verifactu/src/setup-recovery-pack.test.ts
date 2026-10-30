import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { NOMBRE_RAZON_MAX } from "./venue-fields.js";
import { loadRecoveryFont } from "./recovery-pdf-node.js";
import type { RecoveryDocument } from "./recovery-document.js";
import { renderSetupRecoveryPack } from "./setup-recovery-pack.js";

const document: RecoveryDocument = {
  kind: "waitron-recovery-document",
  version: 1,
  scope: { taxpayerNif: "B12345674", softwareId: "WT", environment: "production" },
  taxpayerName: "Olivo SL",
  venueName: "Olivo Centro",
  createdAt: "2026-10-18T00:10:00.000Z",
  nodeKey: {
    nodeId: "node-1",
    name: "2026-10-17 · ACRY",
    secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
  },
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

it("dates the server key's last change by the key's name, as the dashboard's packs do", async () => {
  const [cover, keyPage] = await pages(
    await renderSetupRecoveryPack(document, "en", "UTC", loadRecoveryFont),
  );
  expect(cover).toContain("Server key 17 Oct 2026 2026-10-17 · ACRY 2");
  expect(keyPage).toContain("Key name 2026-10-17 · ACRY");
});

it.each(["en", "es"] as const)(
  "draws in full a legal name at the tax agency's 120-character cap and a venue name at the recovery document's 256, in the widest letter the pack's font draws, in %s",
  async (locale) => {
    const taxpayerName = "Ԫ".repeat(NOMBRE_RAZON_MAX);
    const venueName = "Ԫ".repeat(256);
    const texts = await pages(
      await renderSetupRecoveryPack(
        { ...document, taxpayerName, venueName },
        locale,
        "Europe/Madrid",
        loadRecoveryFont,
      ),
    );
    expect(texts).toHaveLength(2);
    const squash = (text: string) => text.replace(/\s+/g, "");
    for (const text of texts) {
      expect(squash(text)).toContain(taxpayerName);
      expect(squash(text)).toContain(venueName);
    }
  },
);
