// Reads the Dockerfile, the package's pin and the bench's as TEXT, which makes it weaker than its
// name: it proves the copies of the pin agree, not that any of them downloads or runs. What runs the binary is
// the image build's own `litestream version` check (deploy/Dockerfile, the `litestream` stage), the
// image-smoke step that runs it in the shipped image, and the setup script's.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHA256, VERSION } from "./setup-litestream.mjs";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const DOCKERFILE = read("deploy/Dockerfile");
const PACKAGE = read("packages/stream/src/litestream.ts");
const BENCH = read("bench/sqlite-failover/src/litestream.ts");

/** The one capture of the one match of `pattern`; throws on none or several. */
function one(text: string, pattern: RegExp, what: string): string {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`expected one ${what}, found ${matches.length}`);
  return matches[0]![1]!;
}

describe("the pinned Litestream", () => {
  const version = one(PACKAGE, /export const LITESTREAM_VERSION = "([0-9.]+)";/g, "package pin");

  it("names one version in the package, the setup script, the box image and the bench", () => {
    expect(VERSION).toBe(version);
    expect(one(BENCH, /export const LITESTREAM_VERSION = "([0-9.]+)";/g, "bench pin")).toBe(
      version,
    );
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
      expect(inImage).toBe(SHA256[platform]);
    }
  });
});
