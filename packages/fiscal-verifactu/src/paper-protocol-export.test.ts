import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("bundles the explicit public protocol entry for browsers without Node or Buffer", async () => {
  const result = await build({
    absWorkingDir: fileURLToPath(new URL("../", import.meta.url)),
    stdin: {
      contents:
        'export { paperBlockBytes, paperConsumptionBytes, parsePaperBlock, parsePaperConsumption } from "@waitron/fiscal-verifactu/paper-protocol";',
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    logLevel: "silent",
  });
  expect(result.outputFiles).toHaveLength(1);
  expect(result.outputFiles[0]!.text).toContain("TextEncoder");
  expect(result.outputFiles[0]!.text).not.toMatch(/\bBuffer\b|node:crypto|node:util/);
});
