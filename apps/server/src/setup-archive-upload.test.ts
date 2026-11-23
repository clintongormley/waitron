import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { receiveSetupArchive } from "./setup-archive-upload.js";
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function root() {
  const dir = await mkdtemp(join(tmpdir(), "setup-upload-"));
  dirs.push(dir);
  return dir;
}
function request(body: BodyInit, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request("http://localhost/upload", {
    method: "POST",
    body,
    headers,
    signal,
    duplex: "half",
  } as RequestInit);
}
it.each([false, true])("writes multipart bytes privately with artifact first=%s", async (first) => {
  const dir = await root();
  const body = new FormData();
  if (first) body.append("artifact", new Blob(["exact bytes"]), "../../outside");
  body.append("request", '{"key":"private"}');
  if (!first) body.append("artifact", new Blob(["exact bytes"]), "../../outside");
  const copy = await receiveSetupArchive(request(body), dir, {
    fields: ["request"],
    exactFields: true,
  });
  expect(await readFile(copy.artifactPath, "utf8")).toBe("exact bytes");
  expect(copy.byteLength).toBe(11);
  expect(copy.fields.get("request")).toBe('{"key":"private"}');
  expect((await stat(copy.artifactPath)).mode & 0o777).toBe(0o600);
  expect((await stat(join(copy.artifactPath, ".."))).mode & 0o777).toBe(0o700);
  await copy.dispose();
  expect(await readdir(dir)).toEqual([]);
});
it("counts raw chunks without a declared length and cancels an oversized body", async () => {
  const dir = await root();
  let cancelled = false;
  const stream = new ReadableStream({
    pull(c) {
      c.enqueue(new Uint8Array(8));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    receiveSetupArchive(request(stream, { "content-type": "application/octet-stream" }), dir, {
      maxBytes: 12,
    }),
  ).rejects.toMatchObject({ code: "restore.archive_resource_limit" });
  expect(cancelled).toBe(true);
  expect(await readdir(dir)).toEqual([]);
});
it.each(["duplicate", "unknown", "truncated", "empty", "field-limit"])(
  "refuses %s multipart and removes input",
  async (kind) => {
    const dir = await root();
    const form = new FormData();
    form.append("request", kind === "field-limit" ? "x".repeat(131073) : "{}");
    form.append("artifact", new Blob([kind === "empty" ? "" : "a"]));
    if (kind === "duplicate") form.append("request", "{}");
    if (kind === "unknown") form.append("other", "x");
    let req = request(form);
    if (kind === "truncated")
      req = request((await req.text()).slice(0, -12), {
        "content-type": req.headers.get("content-type")!,
      });
    await expect(
      receiveSetupArchive(req, dir, { fields: ["request"], exactFields: true }),
    ).rejects.toMatchObject({ code: "setup.request_invalid" });
    expect(await readdir(dir)).toEqual([]);
  },
);
it("aborting a partial upload cancels the reader and removes the private file", async () => {
  const dir = await root();
  const abort = new AbortController();
  let cancelled = false;
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array([1]));
      began();
    },
    cancel() {
      cancelled = true;
    },
  });
  const received = receiveSetupArchive(
    request(body, { "content-type": "application/octet-stream" }, abort.signal),
    dir,
  );
  await started;
  abort.abort();
  await expect(received).rejects.toMatchObject({ name: "AbortError" });
  expect(cancelled).toBe(true);
  expect(await readdir(dir)).toEqual([]);
});
it("removes a partial upload after Node's request timeout closes the connection", async () => {
  const { createServer, request: httpRequest } = await import("node:http");
  const { getRequestListener } = await import("@hono/node-server");
  const { retainHttpListener } = await import("./testing/retained-http-listener.js");
  const dir = await root();
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const http = createServer(
    { requestTimeout: 60, headersTimeout: 60, connectionsCheckingInterval: 10 },
    getRequestListener(async (request) => {
      try {
        await receiveSetupArchive(request, dir);
        return new Response("unexpected success");
      } catch {
        return new Response("interrupted", { status: 400 });
      } finally {
        finish();
      }
    }),
  );
  const listener = await retainHttpListener("127.0.0.1", http);
  let client: ReturnType<typeof httpRequest> | undefined;
  try {
    const status = await new Promise<number>((resolve, reject) => {
      client = httpRequest(
        {
          hostname: listener.host,
          port: listener.port,
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      client.once("error", reject);
      client.write("partial ciphertext");
    });
    expect(status).toBe(408);
    await finished;
    expect(await readdir(dir)).toEqual([]);
  } finally {
    client?.destroy();
    http.closeAllConnections();
    await listener.close();
  }
});
it("bounds multipart overhead independently of a small artifact", async () => {
  const dir = await root();
  const form = new FormData();
  form.set("artifact", new Blob(["a"]));
  form.set("ignored-one", "x".repeat(131072));
  form.set("ignored-two", "x".repeat(131072));
  await expect(receiveSetupArchive(request(form), dir)).rejects.toMatchObject({
    code: "restore.archive_resource_limit",
  });
  expect(await readdir(dir)).toEqual([]);
});
it("keeps restore's ignored file fields while retaining its artifact", async () => {
  const dir = await root();
  const form = new FormData();
  form.set("artifact", new Blob(["selected"]));
  form.set("unused", new Blob(["ignored"]));
  const copy = await receiveSetupArchive(request(form), dir, { fields: ["recoveryKey"] });
  expect(await readFile(copy.artifactPath, "utf8")).toBe("selected");
  await copy.dispose();
});
it.each(["duplicate", "oversized"])(
  "keeps stage's body refusal for a %s request field",
  async (kind) => {
    const dir = await root();
    const form = new FormData();
    form.append("artifact", new Blob(["selected"]));
    form.append("request", kind === "oversized" ? "x".repeat(131073) : "{}");
    if (kind === "duplicate") form.append("request", "{}");
    await expect(
      receiveSetupArchive(request(form), dir, { fields: ["request"], exactFields: true }),
    ).rejects.toMatchObject({ code: "setup.request_invalid", params: { field: "body" } });
  },
);
it("refuses a multipart artifact larger than its file limit", async () => {
  const dir = await root();
  const form = new FormData();
  form.set("artifact", new Blob(["123456789"]));
  await expect(receiveSetupArchive(request(form), dir, { maxBytes: 8 })).rejects.toMatchObject({
    code: "restore.archive_resource_limit",
  });
  expect(await readdir(dir)).toEqual([]);
});

it.each(["declared length", "raw byte count", "multipart artifact count"])(
  "can report an invalid artifact when the %s exceeds the upload limit",
  async (limit) => {
    const form = new FormData();
    form.set("artifact", new Blob(["123456789"]));
    const upload =
      limit === "multipart artifact count"
        ? request(form)
        : request(limit === "declared length" ? "1" : "123456789", {
            "content-type": "application/octet-stream",
            ...(limit === "declared length" ? { "content-length": "9" } : {}),
          });
    await expect(
      receiveSetupArchive(upload, await root(), {
        maxBytes: 8,
        oversizeIsInvalid: true,
      }),
    ).rejects.toMatchObject({ code: "setup.request_invalid", params: { field: "artifact" } });
  },
);
