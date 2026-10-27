import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("retains the PNG encoder output for the exported dataset and preserves other datasets", async () => {
  const generator = resolve("packages/country-es/scripts/gen-demo-media.mjs");
  expect(existsSync(generator), "pack-owned generator exists").toBe(true);
  const root = mkdtempSync(join(tmpdir(), "a972-media-"));
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
    cpSync("packages/country-es/src/demo", join(root, "src/demo"), { recursive: true });
    mkdirSync(join(root, "scripts"));
    cpSync(generator, join(root, "scripts/gen-demo-media.mjs"));
    mkdirSync(join(root, "demo-media/other"), { recursive: true });
    writeFileSync(join(root, "demo-media/other/keep.png"), "other");
    const run = (id) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          createRequire(resolve("apps/server/package.json")).resolve("tsx"),
          join(root, "scripts/gen-demo-media.mjs"),
          ...id,
        ],
        { encoding: "utf8", timeout: 10000 },
      );
    const generated = run(["casa-delgado-es"]);
    expect(generated.status, generated.stderr).toBe(0);
    const sharp = createRequire(resolve("apps/server/package.json"))("sharp");
    const filename = join(root, "demo-media/casa-delgado-es/negroni.png");
    const image = sharp(filename, { failOn: "warning" });
    const metadata = await image.metadata();
    expect({
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      channels: metadata.channels,
      depth: metadata.depth,
    }).toEqual({ format: "png", width: 256, height: 256, channels: 3, depth: "uchar" });
    const pixels = await image.raw().toBuffer();
    expect(createHash("sha256").update(pixels).digest("hex")).toBe(
      "2ab01d91f3fa8b1bda7adef9ead54e2c793d93089282ed5de7147412c62134ae",
    );
    expect(readFileSync(join(root, "demo-media/other/keep.png"), "utf8")).toBe("other");
    for (const id of [[], ["unknown"], ["../other"]]) {
      const refused = run(id);
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toMatch(/dataset/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
