import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hono } from "hono";
import type { Logger } from "./logger.js";

/**
 * Everything the public media-serving route needs: just the absolute directory the upload route
 * writes product images into (`config.mediaDir`, `boot.ts` ensures it exists). No `db`, no session,
 * no tenant — the route is UNAUTHENTICATED (design §5e): menu photos are not secret, both the till
 * and the dashboard fetch them with a plain `<img src>`, and the served filename is a 256-bit content
 * hash rather than an enumerable id.
 */
export interface MediaApiDeps {
  mediaDir: string;
}

/**
 * The ONE shape a served filename may take — a 64-char lowercase-hex SHA-256 content hash plus one
 * of the three accepted extensions, the exact name the upload route mints (`<sha256hex>.<ext>`,
 * design §5b). Anchored `^…$` so nothing else passes: a `/`, a `.`, a `%2f` that decoded to `/`, a
 * wrong/upper-case extension, or an off-length name all fail. This IS the path-traversal guard, made
 * EXPLICIT and unit-testable (`CLAUDE.md` §3: "the defence is explicit, never implicit") rather than
 * trusted to `serve-static` middleware — a crafted `:filename` can therefore never escape `mediaDir`,
 * because it is refused with a bare 404 BEFORE any `readFile`. Proven, not asserted (`CLAUDE.md` §1):
 * `media-api.test.ts` neuters the regex and watches four names flip green→red, and serves a real file
 * planted ABOVE the store through a `../` name and gets a 404 with the `readFile` spy showing no fs
 * touch. No `g` flag: `.exec`/`.test` must stay
 * stateless across calls. The capture group yields the extension, so a matched name needs no second
 * parse to pick its Content-Type. Exported so the guard is testable on its own.
 */
export const MEDIA_FILENAME = /^[0-9a-f]{64}\.(jpg|png|webp)$/;

/** The Content-Type each accepted extension serves under — the extension IS the authority (the bytes
 * were sniffed at upload time), so this is a total map over `MEDIA_FILENAME`'s capture group. */
const CONTENT_TYPE = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;
type Extension = keyof typeof CONTENT_TYPE;

/** A content-addressed name changes only when the bytes change, so its URL is safe to cache forever
 * — the reason the filename is content-addressed at all (design §5b), letting a metered remote till
 * skip re-fetching an unchanged image. */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Mounts the PUBLIC `GET /media/:filename` serve route on an existing Hono app — the read half of the
 * image feature, mounted SEPARATELY from the gated `mountCatalogueApi` write group because it takes
 * no session (design §4, §5e). Deliberately NOT wrapped in the `run` error boundary the other route
 * modules use: every miss here is a PLAIN 404, never an `AppError` envelope (design §4's table row).
 *
 * A custom `fs` handler, not `@hono/node-server/serve-static`: the traversal guard (`MEDIA_FILENAME`
 * above) has to be explicit and unit-testable rather than trusted to middleware (`CLAUDE.md` §3).
 */
export function mountMedia(app: Hono, deps: MediaApiDeps, log: Logger): void {
  app.get("/media/:filename", async (c) => {
    // `c.req.param` returns the URI-DECODED value, so a `..%2f..%2f…` traversal arrives here already
    // decoded to `../../…` and is refused by the anchored regex before the filesystem is touched at
    // all — the guard's whole point. The guard does NOT rest on that decoding claim, though: the
    // anchored regex rejects the `%`-encoded form too (a `%` is not in `[0-9a-f]`), so a change in
    // Hono's decoding behaviour could not open an escape. A non-match is a bare 404, no `readFile`.
    const match = MEDIA_FILENAME.exec(c.req.param("filename"));
    if (match === null) return c.body(null, 404);
    const filename = match[0];
    const extension = match[1] as Extension;

    let bytes: Uint8Array<ArrayBuffer>;
    try {
      // The name is one of a finite set of hash-shaped strings inside `mediaDir` (the regex proved
      // it), so this `join` cannot escape the store. `readFile` returns a `Buffer` typed
      // `Uint8Array<ArrayBufferLike>` (the `ArrayBufferLike` covering a `SharedArrayBuffer` a disk
      // read never actually uses); `c.body`'s parameter is the narrower `Uint8Array<ArrayBuffer>`, so
      // `new Uint8Array(…)` copies the bytes into a plainly-backed array of that exact type. The one
      // copy is immaterial here: a content-addressed URL is served with `immutable` caching, so a
      // client re-fetches an unchanged image approximately never.
      bytes = new Uint8Array(await readFile(join(deps.mediaDir, filename)));
    } catch (error) {
      // ENOENT is the ordinary "no such image" — a bare 404, unlogged, since a missing photo is not a
      // fault. Anything else (a media dir that is not a directory, a permission problem) is a
      // misconfiguration worth one line, but STILL a bare 404 to the public caller: this route never
      // 500s and never leaks filesystem detail on a serve.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        // `code` is optional on `NodeJS.ErrnoException`'s TYPE, but every fs read failure this route
        // can hit (ENOTDIR, EACCES, EISDIR, …) sets it — Node's fs layer always attaches one — so the
        // `?? "unknown"` fallback is type-required but unreachable, the identical shape `boot.ts`'s
        // own `error.code ?? "unknown"` documents and v8-ignores.
        /* v8 ignore next */
        log("error", "media.read_failed", { code: code ?? "unknown", filename });
      }
      return c.body(null, 404);
    }

    return c.body(bytes, 200, {
      "Content-Type": CONTENT_TYPE[extension],
      "Cache-Control": IMMUTABLE_CACHE_CONTROL,
    });
  });
}
