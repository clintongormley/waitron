import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderRecoveryPdf } from "./recovery-pdf-node.js";
import { decodeRecoveryKey } from "./recovery-key-code.js";
import { recoveryDocumentBytes, type RecoveryDocument } from "./recovery-document.js";

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
const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function inspect(bytes: Uint8Array, locale: "en" | "es") {
  const task = getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    useWasm: false,
  });
  try {
    const pdf = await task.promise;
    expect(pdf.numPages).toBe(1);
    const page = await pdf.getPage(1);
    const size = page.getViewport({ scale: 1 });
    expect(size.width).toBeCloseTo(595.28, 1);
    expect(size.height).toBeCloseTo(841.89, 1);
    const text = (await page.getTextContent()).items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ");
    for (const expected of [
      document.taxpayerName,
      document.venueName,
      "B12345674",
      "W1",
      "NODE -1",
      "Caja principal",
      locale === "en" ? "17 October 2026, 14:30" : "17 de octubre de 2026, 14:30",
    ])
      expect(text).toContain(expected);
    expect(text).toContain(
      locale === "en" ? "Waitron recovery key" : "Clave de recuperación de Waitron",
    );
    expect(text).toContain(
      locale === "en"
        ? "older sheets for older backups"
        : "hojas anteriores para copias anteriores",
    );
    expect(text).toContain("06R9 T4FH M4H3 599J EEMM 5D5D ABTV 2RSX 6QDQ WE8M C");
    expect(text).not.toMatch(/(?:Check|Control):/);
    const key = text.match(/(?:Key|Clave): ([0-9A-Z ]{51})/)![1]!.trim();
    expect(decodeRecoveryKey(key)).toBe("AbCdEfGhIjKlMnOpQrStUvWxYz012345");
    expect(text).not.toMatch(/allocation|register|signing|administrator|TLS|S000001|P000001/i);
    const attachments = await pdf.getAttachments();
    expect(attachments).toBeInstanceOf(Map);
    expect([...attachments!.keys()]).toEqual(["waitron-recovery-key-v1.json"]);
    const attached = await pdf.getAttachmentContent("waitron-recovery-key-v1.json");
    expect(Buffer.from(attached!)).toEqual(Buffer.from(recoveryDocumentBytes(document)));
    const metadata = await pdf.getMetadata();
    expect(metadata.info).toMatchObject({
      Custom: new Map([
        [
          "WaitronRecoveryDigest",
          "sha256-v1:" + createHash("sha256").update(attached!).digest("hex"),
        ],
      ]),
    });
  } finally {
    await task.destroy();
  }
}

it.each(["en", "es"] as const)("renders the actual key-only PDF in Node in %s", async (locale) => {
  const rendered = renderRecoveryPdf(document, locale, "Europe/Madrid");
  await expect(rendered).resolves.toBeInstanceOf(Uint8Array);
  await inspect(await rendered, locale);
});

it("rejects an invalid document and locale before delivering bytes", async () => {
  await expect(
    renderRecoveryPdf(
      { ...document, nodeKey: { ...document.nodeKey, secret: "wrong" } },
      "en",
      "Europe/Madrid",
    ),
  ).rejects.toThrow("Recovery PDF refused");
  await expect(renderRecoveryPdf(document, "fr" as "en", "Europe/Madrid")).rejects.toThrow(
    "Recovery PDF refused",
  );
});

it.each(["en", "es"] as const)(
  "reads the actual source font when the asset loader is unavailable in %s",
  async (locale) => {
    vi.doMock("./assets/register-noto-sans.ttf?inline", () => {
      throw new Error("No font asset loader");
    });
    try {
      await inspect(await renderRecoveryPdf(document, locale, "Europe/Madrid"), locale);
    } finally {
      vi.doUnmock("./assets/register-noto-sans.ttf?inline");
    }
  },
);

it("carries its font and attachment in a relocated real Node bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "waitron-recovery-pdf-bundle-"));
  roots.push(root);
  const output = join(root, "recovery.mjs");
  const build = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../../../scripts/bundle-node.mjs", import.meta.url)),
      `test/recovery-pdf-node-runner.ts=${output}`,
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  expect(build.status, build.stderr).toBe(0);
  const input = join(root, "input.json");
  await writeFile(input, JSON.stringify(document));
  for (const locale of ["en", "es"] as const) {
    const run = spawnSync(process.execPath, [output, input, locale, "Europe/Madrid"], {
      cwd: root,
      encoding: "buffer",
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NODE_PATH: "" },
    });
    expect(run.status, run.stderr?.toString()).toBe(0);
    await inspect(new Uint8Array(run.stdout), locale);
  }
});

it.each(["en", "es"] as const)(
  "prints this box's current installation code beside public identity in %s",
  async (locale) => {
    const input = { ...document, installationCodes: ["06RB"] };
    const task = getDocument({
      data: await renderRecoveryPdf(input, locale, "Europe/Madrid"),
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      useWasm: false,
    });
    try {
      const pdf = await task.promise;
      const text = (await (await pdf.getPage(1)).getTextContent()).items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ");
      expect(text).toContain(
        locale === "en" ? "Installation code 06RB" : "Código de instalación 06RB",
      );
      const attached = JSON.parse(
        new TextDecoder().decode((await pdf.getAttachmentContent("waitron-recovery-key-v1.json"))!),
      );
      expect(attached.installationCodes).toEqual(["06RB"]);
    } finally {
      await task.destroy();
    }
  },
);

it("refuses an ambiguous multi-code sheet instead of picking another box's code", async () => {
  await expect(
    renderRecoveryPdf({ ...document, installationCodes: ["06RB", "06RC"] }, "en", "Europe/Madrid"),
  ).rejects.toThrow("Recovery PDF refused");
});
