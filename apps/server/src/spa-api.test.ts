import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { isAppError } from "@waitron/shared";
import type { Logger } from "./logger.js";
import { assertBuiltApp, mountSpa, safeResolve } from "./spa-api.js";

const noopLog: Logger = () => {};

/** Records every line so the non-ENOENT read-failure branch can be asserted, mirroring
 * the logger shape used by route tests. */
const capturingLog = () => {
  const lines: { level: string; event: string; fields?: Record<string, unknown> }[] = [];
  const log: Logger = (level, event, fields) => {
    lines.push({ level, event, fields });
  };
  return { log, lines };
};

describe("mountSpa", () => {
  let root: string | undefined;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "waitron-spa-"));
    writeFileSync(join(root, "index.html"), "<!doctype html><div id=app></div>");
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "app-abc123.js"), "console.log(1)");
    writeFileSync(join(root, "favicon.svg"), "<svg/>");
    // An unknown extension exercises the `application/octet-stream` content-type fallback.
    writeFileSync(join(root, "data.unknownext"), "blob");
  });

  afterAll(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true }); // guarded teardown (CLAUDE.md §4)
  });

  const mount = (basePath: string) => {
    const app = new Hono();
    // a terminal API route registered BEFORE the SPA, to prove the catch-all does not shadow it
    app.get("/api/ping", (c) => c.json({ ok: true }));
    mountSpa(app, { root: root!, basePath }, noopLog);
    return app;
  };

  it("serves index.html at the root of the base path with no-cache", async () => {
    const res = await mount("").request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain("id=app");
  });

  it("serves a hashed asset with an immutable cache and correct content-type", async () => {
    const res = await mount("").request("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await res.text()).toBe("console.log(1)");
  });

  // Regression (finish-review Important): `safeResolve` compared the always-absolute resolved path
  // against the UNRESOLVED `root` string, so a RELATIVE or trailing-slash `root` 404'd every asset
  // while index.html (which bypasses safeResolve) still served. The plan's own smoke uses the
  // relative `apps/till/dist`, so this is a realistic trigger the absolute-path fixtures all miss.
  it("serves an asset when root is a RELATIVE path (resolve differs from the raw string)", async () => {
    const relRoot = relative(process.cwd(), root!);
    // Guard the premise: a genuinely relative root whose `resolve` differs from the raw string.
    expect(isAbsolute(relRoot)).toBe(false);
    const app = new Hono();
    mountSpa(app, { root: relRoot, basePath: "" }, noopLog);
    const indexRes = await app.request("/");
    expect(indexRes.status).toBe(200);
    expect(await indexRes.text()).toContain("id=app");
    const assetRes = await app.request("/assets/app-abc123.js");
    expect(assetRes.status).toBe(200);
    expect(await assetRes.text()).toBe("console.log(1)");
  });

  it("serves an asset when root has a TRAILING SLASH", async () => {
    const app = new Hono();
    mountSpa(app, { root: root! + sep, basePath: "" }, noopLog);
    const indexRes = await app.request("/");
    expect(indexRes.status).toBe(200);
    const assetRes = await app.request("/assets/app-abc123.js");
    expect(assetRes.status).toBe(200);
    expect(await assetRes.text()).toBe("console.log(1)");
  });

  it("serves a non-hashed root file (favicon) without the immutable cache", async () => {
    const res = await mount("").request("/favicon.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("serves an unknown extension under the application/octet-stream fallback", async () => {
    const res = await mount("").request("/data.unknownext");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toBe("blob");
  });

  it("404s an unknown path when navigation is not configured", async () => {
    const res = await mount("").request("/does/not/exist");
    expect(res.status).toBe(404);
  });

  it("does not shadow an API route mounted before it", async () => {
    const res = await mount("").request("/api/ping");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("404s a stray unmatched /api path (no file, so no HTML)", async () => {
    const res = await mount("").request("/api/typo");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
  });

  it("rejects a path-traversal attempt with 404, never escaping root", async () => {
    const res = await mount("").request("/assets/..%2f..%2f..%2fetc%2fpasswd");
    expect(res.status).toBe(404);
  });

  it("serves index.html at the base-path root and assets under it when basePath is set", async () => {
    const app = mount("/manage");
    const rootRes = await app.request("/manage/");
    expect(rootRes.status).toBe(200);
    expect(await rootRes.text()).toContain("id=app");
    const bareRes = await app.request("/manage");
    expect(bareRes.status).toBe(200);
    const assetRes = await app.request("/manage/assets/app-abc123.js");
    expect(assetRes.status).toBe(200);
    expect(await assetRes.text()).toBe("console.log(1)");
    expect(assetRes.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it('treats a basePath of "/" as the origin root', async () => {
    const res = await mount("/").request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("id=app");
  });

  it("does not claim paths outside its base path", async () => {
    const res = await mount("/manage").request("/somewhere-else");
    expect(res.status).toBe(404);
  });

  it("answers 404 and logs when a read fails for a reason other than ENOENT", async () => {
    // `assets` is a directory, so `readFile` throws EISDIR — the misconfiguration branch. It is still a
    // bare 404 to the caller (this route never 500s or leaks fs detail), but it logs, unlike the
    // ordinary missing-file ENOENT.
    const { log, lines } = capturingLog();
    const app = new Hono();
    mountSpa(app, { root: root!, basePath: "" }, log);
    const res = await app.request("/assets");
    expect(res.status).toBe(404);
    expect(lines.some((l) => l.event === "spa.read_failed")).toBe(true);
  });

  // The boot-time precondition, unit-tested here because reaching a throw inside the un-unit-testable
  // full-boot path is otherwise hard (CLAUDE.md §4 / the task brief's Step 7). `boot.ts` calls this
  // for each configured SPA dir BEFORE `mountSpa`, so a dir that was configured but never built (no
  // index.html) fails the boot LOUDLY with the existing `server.config_invalid` code — naming the
  // offending env var — rather than serving 404s for every page load.
  describe("assertBuiltApp", () => {
    it("returns without throwing when the dir holds index.html", () => {
      // `root` (the suite fixture) has index.html — the success branch.
      expect(() => assertBuiltApp(root!, "WAITRON_TILL_APP_DIR")).not.toThrow();
    });

    it("throws server.config_invalid naming the variable when index.html is absent", () => {
      const empty = mkdtempSync(join(tmpdir(), "waitron-noindex-"));
      try {
        let caught: unknown;
        try {
          assertBuiltApp(empty, "WAITRON_DASHBOARD_APP_DIR");
        } catch (error) {
          caught = error;
        }
        expect(isAppError(caught)).toBe(true);
        expect(isAppError(caught) && caught.code).toBe("server.config_invalid");
        // Names the env var the operator must fix and a reason CODE, never the path itself — the
        // no-leak, name-the-variable discipline every other `server.config_invalid` follows.
        expect(isAppError(caught) && caught.params).toEqual({
          variable: "WAITRON_DASHBOARD_APP_DIR",
          reason: "missing_index_html",
        });
      } finally {
        rmSync(empty, { recursive: true, force: true }); // guarded teardown (CLAUDE.md §4)
      }
    });
  });

  // Direct unit test of the traversal guard — the route-level `..%2f…` test above may be normalised by
  // Hono before the handler sees it, so this is what makes "prove the guard by deletion" (CLAUDE.md §4)
  // actually bite. Drop the containment check in `safeResolve` and this case flips to a non-null path.
  describe("safeResolve", () => {
    it("returns null for a relative path that escapes root", () => {
      expect(safeResolve(root!, "/assets/../../../etc/passwd")).toBeNull();
    });

    it("resolves a normal path inside root (leading slash)", () => {
      expect(safeResolve(root!, "/assets/app-abc123.js")).toBe(
        join(root!, "assets", "app-abc123.js"),
      );
    });

    it("resolves a normal path inside root (no leading slash)", () => {
      expect(safeResolve(root!, "favicon.svg")).toBe(join(root!, "favicon.svg"));
    });

    // Self-contained normalisation: any caller may hand a relative or trailing-slash root, and the
    // containment check must compare against the RESOLVED base, not the raw string (finish-review
    // Important). Both must resolve to the same file the absolute root does.
    it("normalises a relative root before the containment check", () => {
      const relRoot = relative(process.cwd(), root!);
      expect(isAbsolute(relRoot)).toBe(false);
      expect(safeResolve(relRoot, "/assets/app-abc123.js")).toBe(
        join(root!, "assets", "app-abc123.js"),
      );
    });

    it("normalises a trailing-slash root before the containment check", () => {
      expect(safeResolve(root! + sep, "/assets/app-abc123.js")).toBe(
        join(root!, "assets", "app-abc123.js"),
      );
    });
  });
});

/**
 * What `mountSpa` sees is not the raw bytes of the request line: `@hono/node-server` builds the
 * `Request` first, and for some paths it runs them through WHATWG `new URL(...)` on the way. The
 * traversal guard in `spa-api.ts` leans on that, so this suite pins it against the real adapter
 * rather than leaving it to a comment — the adapter is a dependency we upgrade, and version 2
 * rewrote exactly that code path.
 *
 * A real socket and the real `mountSpa`, not `app.request()`: `app.request()` builds the URL itself
 * and so cannot show what the adapter does with Node's raw `req.url`. Each case asserts both the
 * path the handler was given and the status the client got back, and the cases point in opposite
 * directions — a dot segment is collapsed, a percent-encoded slash is not — which is what lets the
 * suite tell the two answers apart.
 */
describe("what mountSpa is handed when a request arrives through the Node adapter", () => {
  const seen: string[] = [];
  // Capturing, not `noopLog`: `sendFile` swallows a read failure and answers the same bare 404 the
  // traversal guard does, so without reading the log a case cannot tell the two apart.
  const { log, lines } = capturingLog();
  let root: string | undefined;
  let server: ServerType | undefined;
  let port: number;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "waitron-spa-socket-"));
    writeFileSync(join(root, "index.html"), "<!doctype html><div id=app></div>");
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "app-abc123.js"), "console.log(1)");
    const app = new Hono();
    // Records the path the adapter produced and then lets the real SPA handler run on it.
    app.use("*", async (c, next) => {
      seen.push(c.req.path);
      await next();
    });
    mountSpa(app, { root, basePath: "" }, log);
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => {
        port = info.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    // Guarded (CLAUDE.md §4): a beforeAll that threw part-way leaves one or both of these unset,
    // and the directory goes even when closing the server reports an error.
    try {
      if (server !== undefined) {
        await new Promise<void>((resolve, reject) => {
          server!.close((error) => (error ? reject(error) : resolve()));
        });
      }
    } finally {
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }
  });

  /**
   * Writes one raw request line to the socket and returns the path the handler was given together
   * with the response's status line. The recorded path is taken by INDEX, not from the tail of
   * `seen`: the adapter answers some request lines itself — a Host header it rejects, and `GET *`,
   * both measured — without ever calling the handler, and reading the tail would then silently hand
   * back the previous case's path.
   */
  const rawGet = async (
    requestTarget: string,
  ): Promise<{ path: string | undefined; status: string }> => {
    const before = seen.length;
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.write(
          `GET ${requestTarget} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`,
        );
      });
      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      socket.on("close", () => resolve());
      socket.on("error", reject);
    });
    return {
      path: seen.length === before + 1 ? seen[before] : undefined,
      status: Buffer.concat(chunks).toString("utf8").split("\r\n")[0] ?? "",
    };
  };

  it("collapses an escaping dot segment before the handler sees it", async () => {
    // `/etc/passwd`, not `/assets/../../etc/passwd`: resolved inside the SPA root, where no such
    // file exists, so the request is refused with a 404 rather than reaching outside it.
    expect(await rawGet("/assets/../../etc/passwd")).toEqual({
      path: "/etc/passwd",
      status: "HTTP/1.1 404 Not Found",
    });
  });

  it("leaves a percent-encoded slash as a single encoded segment", async () => {
    expect(await rawGet("/a%2f..%2f..%2fetc/passwd")).toEqual({
      path: "/a%2f..%2f..%2fetc/passwd",
      status: "HTTP/1.1 404 Not Found",
    });
  });

  it("passes an ordinary asset path through unchanged", async () => {
    expect(await rawGet("/assets/app-abc123.js")).toEqual({
      path: "/assets/app-abc123.js",
      status: "HTTP/1.1 200 OK",
    });
  });

  // The path that reaches `safeResolve`'s null branch: `//` is not the root path, so it is not
  // served `index.html`, and it resolves to the root directory ITSELF, which the containment check
  // rejects (`base.startsWith(base + sep)` is false). Found by a reviewer running the adapter
  // against the branch, while the comment beside that branch still said nothing reached it.
  //
  // The 404 alone does not pin the guard — delete it and `sendFile` is handed `null`, `readFile`
  // throws, the catch swallows it and the client still gets 404. What separates the two is the log:
  // the guard refuses silently, the crash records `spa.read_failed`.
  it("refuses a path that resolves to the SPA root itself, without reading anything", async () => {
    expect(await rawGet("//")).toEqual({ path: "//", status: "HTTP/1.1 404 Not Found" });
    expect(lines.filter((line) => line.event === "spa.read_failed")).toEqual([]);
  });
});
