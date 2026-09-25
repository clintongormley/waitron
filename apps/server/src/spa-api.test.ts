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
    writeFileSync(join(root, "data.unknownext"), "blob");
  });

  afterAll(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  });

  const mount = (basePath: string) => {
    const app = new Hono();
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

  // index.html bypasses `safeResolve`, so only an asset shows a root that was not normalised.
  it("serves an asset when root is a RELATIVE path (resolve differs from the raw string)", async () => {
    const relRoot = relative(process.cwd(), root!);
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

  it("treats a navigation path as a page only for a request that accepts HTML", async () => {
    const app = new Hono();
    mountSpa(app, { root: root!, basePath: "", navigationPath: "/tabs" }, noopLog);
    const page = await app.request("/tabs/42", { headers: { Accept: "text/html" } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("id=app");
    const noAccept = await app.request("/tabs/42");
    expect(noAccept.status).toBe(404);
  });

  it("answers 404 and logs when a read fails for a reason other than ENOENT", async () => {
    // `assets` is a directory, so `readFile` throws EISDIR.
    const { log, lines } = capturingLog();
    const app = new Hono();
    mountSpa(app, { root: root!, basePath: "" }, log);
    const res = await app.request("/assets");
    expect(res.status).toBe(404);
    expect(lines.some((l) => l.event === "spa.read_failed")).toBe(true);
  });

  describe("assertBuiltApp", () => {
    it("returns without throwing when the dir holds index.html", () => {
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
        // The variable's name and a reason code, never the path.
        expect(isAppError(caught) && caught.params).toEqual({
          variable: "WAITRON_DASHBOARD_APP_DIR",
          reason: "missing_index_html",
        });
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    });
  });

  // The route-level traversal test above may be normalised before the handler sees it, so the
  // guard is pinned directly here.
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
 * Pins what `@hono/node-server` hands `mountSpa` for a raw request line, which the traversal guard
 * leans on. A real socket, because `app.request()` builds the URL itself.
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
    // A beforeAll that threw part-way leaves one or both unset.
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
   * The path is taken by INDEX, not from the tail of `seen`: the adapter answers some request lines
   * itself without calling the handler, and the tail would then be the previous case's path.
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
    // Resolved inside the SPA root, where no such file exists.
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

  // `//` resolves to the root directory itself, which `safeResolve` refuses. The 404 alone does
  // not pin the guard — a failed read also answers 404 — so the log is what separates them.
  it("refuses a path that resolves to the SPA root itself, without reading anything", async () => {
    expect(await rawGet("//")).toEqual({ path: "//", status: "HTTP/1.1 404 Not Found" });
    expect(lines.filter((line) => line.event === "spa.read_failed")).toEqual([]);
  });
});
