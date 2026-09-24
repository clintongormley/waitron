// Reads TEXT from three files, which makes it weaker than its name: it proves the three copies of
// the pin agree, not that any of them downloads or runs. What runs the binary is the image build's
// own `litestream version` check (deploy/Dockerfile, the `litestream` stage) and the setup script's.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const DOCKERFILE = read("deploy/Dockerfile");
const SETUP = read("scripts/setup-litestream.ts");
const PACKAGE = read("packages/stream/src/litestream.ts");

/** The one capture of the one match of `pattern`; throws on none or several. */
function one(text: string, pattern: RegExp, what: string): string {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`expected one ${what}, found ${matches.length}`);
  return matches[0]![1]!;
}

describe("the pinned Litestream", () => {
  const version = one(PACKAGE, /export const LITESTREAM_VERSION = "([0-9.]+)";/g, "package pin");

  it("names one version in the package, the setup script and the box image", () => {
    expect(one(SETUP, /const VERSION = "([0-9.]+)";/g, "setup-script pin")).toBe(version);
    expect(one(DOCKERFILE, /version=([0-9.]+);/g, "Dockerfile pin")).toBe(version);
  });

  it("checks the same Linux checksums in the box image and the setup script", () => {
    // Docker's TARGETARCH names are not the release's asset names, so each arm's pairing is pinned too.
    for (const [arch, platform] of [
      ["amd64", "linux-x86_64"],
      ["arm64", "linux-arm64"],
    ] as const) {
      const inImage = one(
        DOCKERFILE,
        new RegExp(
          `${arch}\\) asset="litestream-\\$\\{version\\}-${platform}\\.tar\\.gz"; sum="([0-9a-f]{64})"`,
          "g",
        ),
        `${arch} → ${platform} sum in the Dockerfile`,
      );
      const inScript = one(
        SETUP,
        new RegExp(`"${platform}": "([0-9a-f]{64})"`, "g"),
        `${platform} sum in the setup script`,
      );
      expect(inImage).toBe(inScript);
    }
  });
});
