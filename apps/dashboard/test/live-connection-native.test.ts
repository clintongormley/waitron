import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import type { ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { transformWithOxc } from "vite";
import { expect, it } from "vitest";

interface Fixture {
  page: Page;
  reads: number[];
  streams: Set<ServerResponse>;
}

async function withLivePage(check: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "waitron-live-unload-"));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const streams = new Set<ServerResponse>();
  const sockets = new Set<Socket>();
  const reads: number[] = [];
  let documents = 0;
  const server = createServer();
  try {
    const sources = await Promise.all(
      ["live-connection", "live-data"].map(async (name) => {
        const source = readFileSync(
          new URL(`../../../packages/dashboard-kit/src/${name}.ts`, import.meta.url),
          "utf8",
        );
        return (await transformWithOxc(source, `${name}.ts`)).code;
      }),
    );
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(root, "key"),
        "-out",
        join(root, "cert"),
        "-days",
        "1",
        "-subj",
        "/CN=staff.generated.example.test",
      ],
      { stdio: "ignore", timeout: 3000 },
    );
    server.setSecureContext({
      key: readFileSync(join(root, "key")),
      cert: readFileSync(join(root, "cert")),
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.on("request", (request, response) => {
      if (request.url?.startsWith("/management-api/events")) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write(": connected\n\n");
        streams.add(response);
        response.on("close", () => streams.delete(response));
      } else if (request.url === "/management-api/alerts") {
        reads.push(documents);
        response.end("[]");
      } else if (request.url === "/manage/") {
        documents += 1;
        response.setHeader("content-type", "text/html");
        response.end(
          documents === 1
            ? `<button>Stay here</button><script type="module">
${sources.join("\n")}
const data = new LiveData();
globalThis.observed = data.observe({ key: 'alerts', dependencies: [{type: 'alerts'}],
  read: async () => {
    const answer = await fetch('/management-api/alerts').then(r => r.json());
    globalThis.completed = (globalThis.completed ?? 0) + 1;
    return answer;
  }
}, () => {});
globalThis.live = new LiveConnection(data, {open(url) { globalThis.stream = new EventSource(url); return globalThis.stream; }});
addEventListener('pageshow', event => globalThis.restored = event.persisted);
globalThis.live.start();
</script>`
            : "<title>Replacement without script</title>",
        );
      } else response.end("<title>Other document</title>");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No HTTPS port");
    browser = await chromium.launch({
      channel: "chromium",
      ignoreDefaultArgs: ["--disable-back-forward-cache"],
      args: [
        "--host-resolver-rules=MAP staff.generated.example.test 127.0.0.1:" + address.port,
        "--no-proxy-server",
      ],
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.setDefaultTimeout(3000);
    page.setDefaultNavigationTimeout(3000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("https://staff.generated.example.test/manage/");
    await page.waitForFunction("globalThis.completed === 2 && !observed.snapshot.loading");
    expect(reads).toEqual([1, 1]);
    await check({ page, reads, streams });
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
}

it("issues no old-document alerts request during a native Chromium reload", async () => {
  await withLivePage(async ({ page, reads }) => {
    await page.reload();
    expect(await page.title()).toBe("Replacement without script");
    expect(reads).toEqual([1, 1]);
  });
}, 20_000);

it("keeps real stream refreshes after a person cancels the browser's leave prompt", async () => {
  await withLivePage(async ({ page, reads, streams }) => {
    await page.getByRole("button").click();
    await page.evaluate(
      "addEventListener('beforeunload', event => { event.preventDefault(); event.returnValue = ''; })",
    );
    const prompt = page.waitForEvent("dialog");
    await page.evaluate("setTimeout(() => location.reload(), 0)");
    const dialog = await prompt;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
    expect(page.url()).toBe("https://staff.generated.example.test/manage/");
    for (const stream of streams) stream.write("event: reset\ndata: {}\n\n");
    await page.waitForFunction("globalThis.completed === 3 && !observed.snapshot.loading");
    expect(reads).toEqual([1, 1, 1]);
  });
}, 25_000);

it("refreshes after a genuine native stream transport interruption", async () => {
  await withLivePage(async ({ page, reads, streams }) => {
    for (const stream of streams) stream.destroy();
    await page.waitForFunction("globalThis.completed === 3 && !observed.snapshot.loading");
    expect(reads).toEqual([1, 1, 1]);
  });
}, 20_000);

it("restores the same cached document's observers and stream on Back", async () => {
  await withLivePage(async ({ page, reads }) => {
    await page.goto("https://staff.generated.example.test/other");
    expect(reads).toEqual([1, 1]);
    await page.goBack({ waitUntil: "commit" });
    await page.waitForFunction(
      "globalThis.restored === true && stream.readyState === 1 && !observed.snapshot.loading && globalThis.completed >= 3",
    );
    expect(await page.evaluate("observed.snapshot.value")).toEqual([]);
    expect(reads.slice(2)).toEqual([1]);
    expect(reads.every((document) => document === 1)).toBe(true);
    const completed = await page.evaluate<number>("globalThis.completed");
    await page.goForward({ waitUntil: "commit" });
    expect(await page.title()).toBe("Other document");
    await page.goBack({ waitUntil: "commit" });
    await page.waitForFunction(
      `globalThis.completed > ${completed} && stream.readyState === 1 && !observed.snapshot.loading`,
    );
    expect(await page.evaluate("globalThis.restored")).toBe(true);
    expect(reads.every((document) => document === 1)).toBe(true);
  });
}, 25_000);
