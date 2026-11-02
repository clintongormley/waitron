/**
 * Mock-ups and screenshots are never committed (owner, 2026-11-02): they live outside the
 * repository with whoever made them. So no raster image is tracked under `docs/`, and nothing is
 * tracked under `docs/backlog/mockups/`.
 *
 * Weaker than its name: it judges tracked file NAMES only. A PDF, SVG or HTML board outside
 * `docs/backlog/mockups/`, an image format the pattern does not name, or an image tracked outside
 * `docs/`, passes.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

const GIT_SPAWN_TIMEOUT_MS = 30_000;

const RASTER_IMAGE = /\.(png|jpe?g|gif|webp|bmp|tiff?|avif|heic|heif)$/i;

function refusedDocsFiles(files: readonly string[]): string[] {
  return files.filter(
    (file) =>
      file.startsWith("docs/backlog/mockups/") ||
      (file.startsWith("docs/") && RASTER_IMAGE.test(file)),
  );
}

// Git exports `GIT_DIR` to every hook, and the pre-push hook runs this suite.
function isolatedGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_NAMESPACE",
  ]) {
    delete env[name];
  }
  return env;
}

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    env: isolatedGitEnv(),
    timeout: GIT_SPAWN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}

describe("refusedDocsFiles", () => {
  it("refuses a raster image anywhere under docs/", () => {
    expect(
      refusedDocsFiles([
        "docs/superpowers/specs/board-1.png",
        "docs/developers/images/before.JPG",
        "docs/backlog/look.webp",
        "docs/backlog/scan.bmp",
        "docs/backlog/anim.gif",
        "docs/backlog/print.tif",
        "docs/backlog/print.tiff",
        "docs/backlog/look.avif",
        "docs/research/photo.heic",
        "docs/research/photo.heif",
        "docs/research/shot.jpeg",
      ]),
    ).toEqual([
      "docs/superpowers/specs/board-1.png",
      "docs/developers/images/before.JPG",
      "docs/backlog/look.webp",
      "docs/backlog/scan.bmp",
      "docs/backlog/anim.gif",
      "docs/backlog/print.tif",
      "docs/backlog/print.tiff",
      "docs/backlog/look.avif",
      "docs/research/photo.heic",
      "docs/research/photo.heif",
      "docs/research/shot.jpeg",
    ]);
  });

  it("refuses every file under docs/backlog/mockups/, not only images", () => {
    expect(
      refusedDocsFiles([
        "docs/backlog/mockups/a1-topic/README.md",
        "docs/backlog/mockups/a1-topic/board.svg",
      ]),
    ).toEqual([
      "docs/backlog/mockups/a1-topic/README.md",
      "docs/backlog/mockups/a1-topic/board.svg",
    ]);
  });

  it("allows documents, a source PDF, a research tool's icon, and images outside docs/", () => {
    expect(
      refusedDocsFiles([
        "docs/backlog.md",
        "docs/backlog/mockups.md",
        "docs/compliance/sources/FAQs-Desarrolladores-v1.3-2025-12-04.pdf",
        "docs/research/2026-10-12-nfc-probe/icon.svg",
        "packages/ui/brand/logo.png",
      ]),
    ).toEqual([]);
  });
});

it(
  "no mock-up or screenshot is tracked under docs/",
  () => {
    expect(refusedDocsFiles(trackedFiles())).toEqual([]);
  },
  GIT_SPAWN_TIMEOUT_MS * 2,
);
