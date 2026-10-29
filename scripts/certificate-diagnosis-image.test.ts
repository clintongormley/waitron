import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(new URL("../apps/server/package.json", import.meta.url), "utf8"),
) as { scripts: { build: string } };
const image = readFileSync(new URL("../deploy/Dockerfile", import.meta.url), "utf8");
function shipped(dockerfile: string, build: string) {
  const copies = dockerfile.match(/^COPY\b(?:[^\n]*\\\n)*[^\n]*/gm) ?? [];
  return {
    build: build.includes(
      "src/fiscal-certificate-diagnosis-entry.ts=dist/fiscal-certificate-diagnosis.js",
    ),
    entry: copies.some(
      (copy) =>
        copy.includes("/src/apps/server/dist/fiscal-certificate-diagnosis.js ") &&
        copy.endsWith("/app/"),
    ),
    notices: copies.some(
      (copy) =>
        copy.includes("/src/apps/server/dist/fiscal-certificate-diagnosis.js.NOTICES.txt ") &&
        copy.endsWith("/app/third-party/npm/server/"),
    ),
  };
}

describe("certificate child image inventory (text only, not an image execution)", () => {
  it("builds and copies the entry and its notices", () => {
    expect(shipped(image, manifest.scripts.build)).toEqual({
      build: true,
      entry: true,
      notices: true,
    });
  });
  it("accepts a minimal valid copy list", () => {
    expect(
      shipped(
        "COPY /src/apps/server/dist/fiscal-certificate-diagnosis.js /app/\nCOPY /src/apps/server/dist/fiscal-certificate-diagnosis.js.NOTICES.txt /app/third-party/npm/server/",
        "node bundle src/fiscal-certificate-diagnosis-entry.ts=dist/fiscal-certificate-diagnosis.js",
      ),
    ).toEqual({ build: true, entry: true, notices: true });
  });
  it.each(["build", "entry", "notices"] as const)("detects deletion of %s", (removed) => {
    const before =
      "node bundle src/fiscal-certificate-diagnosis-entry.ts=dist/fiscal-certificate-diagnosis.js";
    const valid =
      "COPY /src/apps/server/dist/fiscal-certificate-diagnosis.js /app/\nCOPY /src/apps/server/dist/fiscal-certificate-diagnosis.js.NOTICES.txt /app/third-party/npm/server/";
    const changed =
      removed === "entry"
        ? valid.split("\n")[1]!
        : removed === "notices"
          ? valid.split("\n")[0]!
          : valid;
    expect(shipped(changed, removed === "build" ? "node bundle" : before)[removed]).toBe(false);
  });
});
