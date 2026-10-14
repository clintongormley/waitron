import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { devCustodianPlugin, devCustodianProvision } from "./setup-proxy.js";

interface Recorded {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage["headers"];
  body: string;
}

const servers: Server[] = [];
let stateDir: string;

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "waitron-setup-proxy-"));
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((done) => server.close(() => done(undefined)))),
  );
  await rm(stateDir, { recursive: true, force: true });
});

async function readBody(req: IncomingMessage): Promise<string> {
  let text = "";
  for await (const chunk of req) text += (chunk as Buffer).toString();
  return text;
}

async function listen(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function upstream(status: number, answer: unknown) {
  const received: Recorded[] = [];
  const target = await listen((req, res) => {
    void readBody(req).then((body) => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(answer));
    });
  });
  return { target, received };
}

function fakeSigner() {
  const inputs: string[] = [];
  const sign = async (body: string) => {
    inputs.push(body);
    return JSON.stringify({ ...JSON.parse(body), initialOperations: { signed: true } });
  };
  return { inputs, sign };
}

async function devServer(
  middleware: ReturnType<typeof devCustodianProvision>,
  options: { mount?: string } = {},
) {
  const fallthrough: { body: string; url: string | undefined }[] = [];
  const base = await listen((req, res) => {
    if (options.mount !== undefined) {
      const shaped = req as IncomingMessage & { originalUrl?: string };
      shaped.originalUrl = req.url;
      req.url = req.url!.slice(options.mount.length) || "/";
    }
    middleware(req, res, () => {
      void readBody(req).then((body) => {
        fallthrough.push({ body, url: req.url });
        res.writeHead(299);
        res.end("next");
      });
    });
  });
  return { base, fallthrough };
}

const plainBody = { venue: { name: "Bar Pepe" }, locale: "es" };

async function withCustodian() {
  await mkdir(join(stateDir, "dev-custodian"));
}

describe("devCustodianProvision", () => {
  for (const status of [200, 400]) {
    it(`adds the allocation and returns upstream's ${status} answer unchanged`, async () => {
      await withCustodian();
      const { target, received } = await upstream(status, { answer: status });
      const { inputs, sign } = fakeSigner();
      const { base, fallthrough } = await devServer(
        devCustodianProvision({ target, stateDir, sign }),
      );
      const text = JSON.stringify(plainBody);

      const response = await fetch(`${base}/setup-api/provision`, {
        method: "POST",
        headers: { "content-type": "application/json", "accept-language": "es-ES" },
        body: text,
      });

      expect(inputs).toEqual([text]);
      expect(received).toHaveLength(1);
      const signed = JSON.stringify({ ...plainBody, initialOperations: { signed: true } });
      expect(received[0]!.method).toBe("POST");
      expect(received[0]!.url).toBe("/setup-api/provision");
      expect(received[0]!.body).toBe(signed);
      expect(received[0]!.headers["content-length"]).toBe(String(Buffer.byteLength(signed)));
      expect(received[0]!.headers["content-type"]).toBe("application/json");
      expect(received[0]!.headers["accept-language"]).toBe("es-ES");
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ answer: status });
      expect(fallthrough).toEqual([]);
    });
  }

  it("leaves a body that already carries initialOperations", async () => {
    await withCustodian();
    const { target, received } = await upstream(200, { ok: true });
    const { inputs, sign } = fakeSigner();
    const { base } = await devServer(devCustodianProvision({ target, stateDir, sign }));
    const text = JSON.stringify({ ...plainBody, initialOperations: { mine: 1 } });

    const response = await fetch(`${base}/setup-api/provision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
    });

    expect(response.status).toBe(200);
    expect(inputs).toEqual([]);
    expect(received.map((r) => r.body)).toEqual([text]);
  });

  it("stands aside without reading the body when there is no custodian", async () => {
    const { target, received } = await upstream(200, { ok: true });
    const { inputs, sign } = fakeSigner();
    const { base, fallthrough } = await devServer(
      devCustodianProvision({ target, stateDir, sign }),
    );
    const text = JSON.stringify(plainBody);

    const response = await fetch(`${base}/setup-api/provision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
    });

    expect(response.status).toBe(299);
    expect(fallthrough).toEqual([{ body: text, url: "/setup-api/provision" }]);
    expect(inputs).toEqual([]);
    expect(received).toEqual([]);
  });

  it("forwards the original path and query when mounted under a prefix", async () => {
    await withCustodian();
    const { target, received } = await upstream(200, { ok: true });
    const { sign } = fakeSigner();
    const { base } = await devServer(devCustodianProvision({ target, stateDir, sign }), {
      mount: "/setup-api",
    });

    const response = await fetch(`${base}/setup-api/provision?trace=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(plainBody),
    });

    expect(response.status).toBe(200);
    expect(received.map((r) => r.url)).toEqual(["/setup-api/provision?trace=1"]);
  });

  it.each([
    ["GET", "/setup-api/status"],
    ["POST", "/setup-api/fiscal-test"],
    ["GET", "/setup-api/provision"],
  ])("hands %s %s to the next handler", async (method, path) => {
    await withCustodian();
    const { target, received } = await upstream(200, { ok: true });
    const { inputs, sign } = fakeSigner();
    const { base, fallthrough } = await devServer(
      devCustodianProvision({ target, stateDir, sign }),
    );
    const body = method === "POST" ? JSON.stringify(plainBody) : undefined;

    const response = await fetch(`${base}${path}`, { method, body });

    expect(response.status).toBe(299);
    expect(fallthrough).toEqual([{ body: body ?? "", url: path }]);
    expect(inputs).toEqual([]);
    expect(received).toEqual([]);
  });

  it("answers 500 and logs the signer's message when signing is refused", async () => {
    await withCustodian();
    const { target, received } = await upstream(200, { ok: true });
    const logged: string[] = [];
    const { base } = await devServer(
      devCustodianProvision({
        target,
        stateDir,
        sign: () => Promise.reject(new Error("dev:custodian: the series code is missing")),
        log: (message) => logged.push(message),
      }),
    );

    const response = await fetch(`${base}/setup-api/provision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(plainBody),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "dev_custodian.sign_failed", params: {} },
    });
    expect(logged.join("\n")).toContain("dev:custodian: the series code is missing");
    expect(received).toEqual([]);
  });
});

describe("devCustodianPlugin", () => {
  it("applies only to the dev server", () => {
    const plugin = devCustodianPlugin({ target: "http://127.0.0.1:1", stateDir });
    expect(plugin.apply).toBe("serve");
  });
});
