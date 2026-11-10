// Reads the Dockerfile, the setup script, the test server and the image-smoke workflow as TEXT, which
// makes it weaker than its name: it proves the copies of the pin agree, not that any of them downloads
// or runs. What runs the binary is the image build's own `versitygw --version` check
// (deploy/Dockerfile, the `versitygw` stage), the image-smoke step that runs it in the shipped image,
// and the setup script's.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VERSITYGW_ASSETS, VERSITYGW_VERSION } from "./setup-s3-test-server.mjs";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const DOCKERFILE = read("deploy/Dockerfile");
const TEST_SERVER = read("apps/server/src/testing/s3-test-server.ts");
const IMAGE_SMOKE = read(".github/workflows/image-smoke.yml");

/** The one capture of the one match of `pattern`; throws on none or several. */
function one(text: string, pattern: RegExp, what: string): string {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`expected one ${what}, found ${matches.length}`);
  return matches[0]![1]!;
}

/** The `versitygw` stage alone, so no other stage's line is read as this pin. */
function versitygwStage(): string {
  const start = DOCKERFILE.indexOf("FROM node:26 AS versitygw");
  if (start < 0) throw new Error("no versitygw stage in deploy/Dockerfile");
  const end = DOCKERFILE.indexOf("\nFROM ", start + 1);
  return DOCKERFILE.slice(start, end < 0 ? undefined : end);
}

describe("the pinned versitygw", () => {
  it("names one version in the setup script, the test server and the box image", () => {
    expect(
      one(TEST_SERVER, /export const VERSITYGW_VERSION = "([0-9.]+)";/g, "test server pin"),
    ).toBe(VERSITYGW_VERSION);
    expect(one(versitygwStage(), /release=([0-9.]+);/g, "Dockerfile pin")).toBe(VERSITYGW_VERSION);
    expect(
      DOCKERFILE.split("\n").filter((line) =>
        line.startsWith("COPY --from=versitygw /usr/local/bin/versitygw /usr/local/bin/versitygw"),
      ),
    ).toHaveLength(1);
  });

  it("checks the same Linux checksums in the box image and the setup script", () => {
    // Docker's TARGETARCH names are not the setup script's keys, so each arm's pairing is pinned too.
    for (const [arch, platform, assetArch] of [
      ["amd64", "linux-x64", "Linux_x86_64"],
      ["arm64", "linux-arm64", "Linux_arm64"],
    ] as const) {
      const inImage = one(
        versitygwStage(),
        new RegExp(
          `${arch}\\) name="versitygw_v\\$\\{release\\}_${assetArch}"; sum="([0-9a-f]{64})"`,
          "g",
        ),
        `${arch} → ${platform} sum in the Dockerfile`,
      );
      expect(inImage).toBe(VERSITYGW_ASSETS[platform].sha256);
      expect(VERSITYGW_ASSETS[platform].name).toBe(`versitygw_v${VERSITYGW_VERSION}_${assetArch}`);
    }
  });

  it("image-smoke runs the binary and compares it with the pin", () => {
    expect(IMAGE_SMOKE).toContain(
      `pinned=$(sed -nE 's/^export const VERSITYGW_VERSION = "([0-9.]+)";$/\\1/p' scripts/setup-s3-test-server.mjs)`,
    );
    expect(IMAGE_SMOKE).toContain('reported=$(docker exec "$app" versitygw --version');
    expect(IMAGE_SMOKE).toContain('[ "$reported" = "$pinned" ]');
  });
});
