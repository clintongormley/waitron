import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { execFile, ChildProcess } from "node:child_process";
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});
import { build, createServer } from "vite";
import { setupAssets } from "./setup-assets.js";
it("delivers the same immutable public offline tool in the build and development server as a download", async () => {
  const root = await mkdtemp(join(tmpdir(), "setup-assets-"));
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await writeFile(join(root, "index.html"), "<html><body>test setup</body></html>");
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [setupAssets()],
      build: { outDir: join(root, "dist") },
    });
    const packaged = await readFile(join(root, "dist/setup-assets/custodian-tool.html"));
    expect(packaged.toString()).toContain("custody-notices");
    expect(packaged.toString()).toContain("connect-src 'none'");
    expect(packaged.toString()).not.toMatch(
      /<script[^>]+src=|<link[^>]+href=|node:crypto|SETUP-CREDENTIAL-SENTINEL/,
    );
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [setupAssets()],
      server: { port: 0, host: "127.0.0.1" },
    });
    await server.listen();
    const address = server.httpServer!.address();
    if (typeof address !== "object" || address === null) throw new Error("server address");
    const url = `http://127.0.0.1:${address.port}/setup-assets/custodian-tool.html`;
    const response = await fetch(url, {
      headers: { "X-Waitron-Setup-Owner": "SETUP-CREDENTIAL-SENTINEL" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="waitron-custodian-tool.html"',
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(packaged);
    const post = await fetch(url, { method: "POST" });
    expect(post.status).toBe(404);
    expect(post.headers.get("content-disposition")).toBeNull();
    await post.arrayBuffer();
    const head = await fetch(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(await (await fetch(`http://127.0.0.1:${address.port}/`)).text()).toContain("test setup");
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

it("fails a tool build rather than serving a wizard page or leaking child-process diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "setup-asset-failure-"));
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  const refuse = () =>
    vi.mocked(execFile).mockImplementationOnce((...args) => {
      (args.at(-1) as (error: Error) => void)(new Error("BUILD-DETAIL-SENTINEL"));
      return new ChildProcess();
    });
  try {
    await writeFile(join(root, "index.html"), "WIZARD-IS-NOT-A-TOOL");
    refuse();
    await expect(
      build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [setupAssets()],
        build: { outDir: join(root, "dist") },
      }),
    ).rejects.toThrow("BUILD-DETAIL-SENTINEL");
    refuse();
    server = await createServer({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [setupAssets()],
      server: { port: 0, host: "127.0.0.1" },
    });
    await server.listen();
    const address = server.httpServer!.address();
    if (typeof address !== "object" || address === null) throw new Error("address");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/setup-assets/custodian-tool.html`,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  } finally {
    await server?.close();
    await rm(root, { recursive: true, force: true });
    vi.mocked(execFile).mockClear();
  }
}, 60_000);
