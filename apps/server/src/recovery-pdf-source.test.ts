import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const document = {
  kind: "waitron-recovery-document",
  installationCodes: ["06RB"],
  version: 1,
  scope: { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" },
  taxpayerName: "Olivo Restauración SL",
  venueName: "Olivo Centro",
  createdAt: "2026-10-17T12:30:00.000Z",
  nodeKey: { nodeId: "node-1", name: "Caja principal", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
};
const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["en", "es"] as const)(
  "the source command's tsx loader renders the real recovery PDF in %s",
  async (locale) => {
    const root = await mkdtemp(join(tmpdir(), "waitron-recovery-source-"));
    roots.push(root);
    const input = join(root, "input.json");
    await writeFile(input, JSON.stringify(document));
    const run = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("../../packages/fiscal-verifactu/test/recovery-pdf-node-runner.ts"),
        input,
        locale,
        "Europe/Madrid",
      ],
      { encoding: "buffer", timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
    );
    expect(run.status, run.stderr?.toString()).toBe(0);
    const task = getDocument({
      data: new Uint8Array(run.stdout),
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      useWasm: false,
    });
    try {
      const pdf = await task.promise;
      const text = (await (await pdf.getPage(1)).getTextContent()).items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      expect(text).toContain(
        locale === "en" ? "Waitron recovery key" : "Clave de recuperación de Waitron",
      );
      expect(text).toContain("Olivo Restauración SL");
      expect(text).toContain("06R9 T4FH M4H3 599J EEMM 5D5D ABTV 2RSX 6QDQ WE8M C");
      expect(text).not.toContain("TKR0 K07W");
      const bytes = await pdf.getAttachmentContent("waitron-recovery-key-v1.json");
      expect(JSON.parse(new TextDecoder().decode(bytes!))).toEqual(document);
    } finally {
      await task.destroy();
    }
  },
);
