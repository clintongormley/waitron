import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger, LogLevel } from "./logger.js";
import { MEDIA_FILENAME, mountMedia } from "./media-api.js";

// `node:fs/promises` is mocked (the boot.test.ts `vi.mock(..., importOriginal)` idiom) so this suite
// can assert WHETHER the serve handler reached the filesystem for a given name — the load-bearing
// proof that a malformed/traversal name is rejected by the regex guard BEFORE any `readFile`, never
// merely alongside one. `readFile` is wrapped in a `vi.fn` around the REAL implementation, so it
// still reads genuine bytes off the temp dir below (the 200-path tests need that) while recording
// every call; the other exports (`mkdtemp`/`rm`/`writeFile`/`mkdir`) pass straight through so the
// fixtures are real files on disk.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const noopLog: Logger = () => {};

/** A logger that records every line, so the ENOTDIR misconfiguration branch can be asserted. */
function capturingLog(): {
  log: Logger;
  lines: Array<{ level: LogLevel; event: string; fields?: Record<string, unknown> }>;
} {
  const lines: Array<{ level: LogLevel; event: string; fields?: Record<string, unknown> }> = [];
  const log: Logger = (level, event, fields) => {
    lines.push({ level, event, fields });
  };
  return { log, lines };
}

// Fixed content-hash-shaped names, one per accepted extension. 64 lowercase-hex chars is exactly the
// SHA-256 hex the upload route mints; the actual bytes here are arbitrary because the SERVE route
// maps Content-Type off the EXTENSION, never by sniffing the bytes back.
const JPG_NAME = "a".repeat(64) + ".jpg";
const PNG_NAME = "b".repeat(64) + ".png";
const WEBP_NAME = "c".repeat(64) + ".webp";
const MISSING_VALID = "d".repeat(64) + ".webp"; // valid shape, never written to disk

const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04]);
const JPG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("MEDIA_FILENAME regex — the explicit path-traversal guard", () => {
  it("accepts a 64-hex content hash with each of the three accepted extensions", () => {
    expect(MEDIA_FILENAME.test("a".repeat(64) + ".jpg")).toBe(true);
    expect(MEDIA_FILENAME.test("a".repeat(64) + ".png")).toBe(true);
    expect(MEDIA_FILENAME.test("a".repeat(64) + ".webp")).toBe(true);
  });

  it("rejects traversal, malformed and wrong-extension names", () => {
    // Every vector the serve route must 404 on. `..%2f..%2fetc%2fpasswd` decodes (via Hono's param
    // decode) to `../../etc/passwd`; the rest are shape violations the regex refuses outright.
    for (const bad of [
      "../../etc/passwd",
      "..%2f..%2fetc%2fpasswd",
      "x", // too short
      "a".repeat(64) + ".gif", // wrong extension
      "a".repeat(63) + ".png", // one char too short
      "a".repeat(65) + ".png", // one char too long
      "A".repeat(64) + ".png", // uppercase hex — not the lowercase the hash mints
      "a".repeat(64) + ".JPG", // uppercase extension
      "a".repeat(64), // no extension
      "", // empty
      "/" + "a".repeat(64) + ".png", // leading slash
    ]) {
      expect(MEDIA_FILENAME.test(bad)).toBe(false);
    }
  });

  it("carries no `g` flag, so repeated `.test` calls are stateless", () => {
    // A global regex keeps `lastIndex` between calls and would answer differently on alternate calls
    // for the same input — a subtle serve bug. Pin it out.
    const name = "a".repeat(64) + ".png";
    expect(MEDIA_FILENAME.test(name)).toBe(true);
    expect(MEDIA_FILENAME.test(name)).toBe(true);
  });
});

describe("mountMedia — GET /media/:filename (public serve)", () => {
  let mediaDir: string;

  beforeEach(async () => {
    mediaDir = await mkdtemp(join(tmpdir(), "waitron-media-serve-"));
    await writeFile(join(mediaDir, WEBP_NAME), WEBP_BYTES);
    await writeFile(join(mediaDir, JPG_NAME), JPG_BYTES);
    await writeFile(join(mediaDir, PNG_NAME), PNG_BYTES);
    vi.mocked(readFile).mockClear();
  });

  afterEach(async () => {
    await rm(mediaDir, { recursive: true, force: true });
  });

  function mount(dir: string = mediaDir, log: Logger = noopLog): Hono {
    const app = new Hono();
    mountMedia(app, { mediaDir: dir }, log);
    return app;
  }

  it("serves an existing file with 200, its bytes, the extension Content-Type and an immutable Cache-Control", async () => {
    const res = await mount().request("/media/" + WEBP_NAME);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(WEBP_BYTES);
  });

  it("maps each extension to the correct Content-Type (jpg→image/jpeg, png→image/png, webp→image/webp)", async () => {
    const app = mount();
    const jpg = await app.request("/media/" + JPG_NAME);
    expect(jpg.status).toBe(200);
    expect(jpg.headers.get("Content-Type")).toBe("image/jpeg");

    const png = await app.request("/media/" + PNG_NAME);
    expect(png.status).toBe(200);
    expect(png.headers.get("Content-Type")).toBe("image/png");

    const webp = await app.request("/media/" + WEBP_NAME);
    expect(webp.status).toBe(200);
    expect(webp.headers.get("Content-Type")).toBe("image/webp");
  });

  it("answers a bare 404 (no AppError envelope) for a valid-shape name that does not exist, having attempted the read", async () => {
    const res = await mount().request("/media/" + MISSING_VALID);
    expect(res.status).toBe(404);
    // A plain 404: not the `{ error: { code } }` shape `run` produces — this route bypasses it.
    expect(await res.text()).not.toContain("error");
    // The read WAS attempted (ENOENT → 404): this is the contrast that makes "not called" below
    // meaningful — the guard skips fs only for names it rejects, not for every 404.
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a decoded traversal", "..%2f..%2fetc%2fpasswd"],
    ["a too-short name", "x"],
    ["a wrong-extension name", "a".repeat(64) + ".gif"],
  ])("returns 404 for %s WITHOUT touching the filesystem", async (_label, name) => {
    const res = await mount().request("/media/" + name);
    expect(res.status).toBe(404);
    // THE guard proof: a name failing the regex is rejected before any `readFile`. Delete the regex
    // check in media-api.ts and this expectation flips (the read fires), which is the guard-by-
    // deletion receipt.
    expect(readFile).not.toHaveBeenCalled();
  });

  it("cannot escape mediaDir even when the decoded name resolves to a real file above it", async () => {
    // The behavioural half of the guard proof, independent of the spy: put a real, readable file
    // one level ABOVE mediaDir and craft a name that, joined naively, would resolve to it. The guard
    // must 404 rather than serve those bytes — i.e. the traversal cannot leak a file outside the store.
    const root = await mkdtemp(join(tmpdir(), "waitron-media-escape-"));
    try {
      const store = join(root, "store");
      await mkdir(store);
      await writeFile(join(root, "secret.txt"), new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
      const app = new Hono();
      mountMedia(app, { mediaDir: store }, noopLog);
      const res = await app.request("/media/" + encodeURIComponent("../secret.txt"));
      expect(res.status).toBe(404);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("answers 404 and logs when the media read fails for a reason other than ENOENT", async () => {
    // mediaDir pointing at a FILE, not a directory, makes `readFile(join(file, name))` throw ENOTDIR
    // — the misconfiguration branch. It is still a bare 404 to the caller (the route never 500s or
    // leaks fs detail on a public serve), but it logs, unlike the ordinary missing-image ENOENT.
    const root = await mkdtemp(join(tmpdir(), "waitron-media-notdir-"));
    try {
      const asFile = join(root, "not-a-dir");
      await writeFile(asFile, new Uint8Array([0x00]));
      const { log, lines } = capturingLog();
      const app = new Hono();
      mountMedia(app, { mediaDir: asFile }, log);
      const res = await app.request("/media/" + WEBP_NAME);
      expect(res.status).toBe(404);
      expect(lines.some((l) => l.event === "media.read_failed")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
