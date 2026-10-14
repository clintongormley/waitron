import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintSelfSignedServerCert } from "../../src/self-signed-cert.js";
import { cliSigner, devCustodianPlugin, devCustodianProvision } from "./setup-proxy.js";

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

const UPSTREAM_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-upstream-trace": "trace-17",
};

function recorder(status: number, answer: unknown) {
  const received: Recorded[] = [];
  const handler = (req: IncomingMessage, res: ServerResponse) => {
    void readBody(req).then((body) => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(status, UPSTREAM_HEADERS);
      res.end(JSON.stringify(answer));
    });
  };
  return { received, handler };
}

async function upstream(status: number, answer: unknown) {
  const { received, handler } = recorder(status, answer);
  const target = await listen(handler);
  return { target, received };
}

async function httpsUpstream(status: number, answer: unknown) {
  const { received, handler } = recorder(status, answer);
  const material = mintSelfSignedServerCert({
    hostnames: ["localhost"],
    ipAddresses: ["127.0.0.1"],
    now: new Date(),
  });
  const server = createHttpsServer(
    { cert: material.serverCertPem, key: material.serverKeyPem },
    handler,
  );
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { target: `https://127.0.0.1:${(server.address() as AddressInfo).port}`, received };
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
      expect(response.headers.get("content-type")).toBe(UPSTREAM_HEADERS["content-type"]);
      expect(response.headers.get("x-upstream-trace")).toBe(UPSTREAM_HEADERS["x-upstream-trace"]);
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

  it("forwards to a self-signed https server when secure is false", async () => {
    await withCustodian();
    const { target, received } = await httpsUpstream(200, { ok: true });
    const { sign } = fakeSigner();
    const { base } = await devServer(
      devCustodianProvision({ target, secure: false, stateDir, sign }),
    );

    const response = await fetch(`${base}/setup-api/provision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(plainBody),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(received).toHaveLength(1);
  });

  it("refuses a self-signed https server when secure is not false", async () => {
    await withCustodian();
    const { target, received } = await httpsUpstream(200, { ok: true });
    const { sign } = fakeSigner();
    const logged: string[] = [];
    const { base } = await devServer(
      devCustodianProvision({ target, stateDir, sign, log: (message) => logged.push(message) }),
    );

    const response = await fetch(`${base}/setup-api/provision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(plainBody),
    });

    expect(response.status).toBe(502);
    expect(received).toEqual([]);
    expect(logged.join("\n")).toContain("forwarding failed");
  });

  it.each([
    ["null", "null"],
    ["an array", "[]"],
  ])("forwards a body that is %s unchanged, for the server to refuse", async (_, text) => {
    await withCustodian();
    const { target, received } = await upstream(400, { error: "server's own" });
    const { inputs, sign } = fakeSigner();
    const { base } = await devServer(devCustodianProvision({ target, stateDir, sign }));

    const response = await fetch(`${base}/setup-api/provision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "server's own" });
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

describe("cliSigner", () => {
  it("returns what the command prints for the body on its standard input", async () => {
    const sign = cliSigner(stateDir, {
      command: [process.execPath, "-e", "process.stdin.pipe(process.stdout)"],
    });
    await expect(sign('{"a":1}')).resolves.toBe('{"a":1}');
  });

  it("reports the command's refusal", async () => {
    const sign = cliSigner(stateDir, {
      command: [process.execPath, "-e", "console.error('no venue'); process.exit(3)"],
    });
    await expect(sign("{}")).rejects.toThrow(/exited 3: no venue/);
  });

  it("kills a command that outlasts its time limit", async () => {
    const sign = cliSigner(stateDir, {
      command: [process.execPath, "-e", "setTimeout(() => {}, 60_000)"],
      timeoutMs: 200,
    });
    const started = Date.now();
    await expect(sign("{}")).rejects.toThrow(/timed out after 200 ms/);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("kills what the command started too, as pnpm starts the signer as its own child", async () => {
    const pidFile = join(stateDir, "grandchild.pid");
    const grandchild = `const c = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], { stdio: "ignore" }); require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setTimeout(() => {}, 60_000);`;
    // The time limit fires only once the grandchild exists, however long Node takes to start both.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const sign = cliSigner(stateDir, {
        command: [process.execPath, "-e", grandchild],
        timeoutMs: 500,
      });
      const signed = expect(sign("{}")).rejects.toThrow(/timed out/);
      let written = "";
      const deadline = Date.now() + 30_000;
      while (written === "" && Date.now() < deadline) {
        await sleep(20);
        written = await readFile(pidFile, "utf8").catch(() => "");
      }
      expect(written).not.toBe("");
      vi.advanceTimersByTime(500);
      await signed;
      const pid = Number(written);
      vi.useRealTimers();
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 5_000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("still reports the time limit when the command's group is gone before the kill", async () => {
    const esrch = Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
    const kill = vi.spyOn(process, "kill").mockImplementationOnce(() => {
      throw esrch;
    });
    try {
      const sign = cliSigner(stateDir, {
        command: [process.execPath, "-e", "setTimeout(() => {}, 300)"],
        timeoutMs: 50,
      });
      await expect(sign("{}")).rejects.toThrow(/timed out after 50 ms/);
      expect(kill).toHaveBeenCalled();
    } finally {
      kill.mockRestore();
    }
  });

  it("kills a running command when this process exits, and stops listening once it closes", async () => {
    const before = process.listenerCount("exit");
    const sign = cliSigner(stateDir, {
      command: [process.execPath, "-e", "setTimeout(() => {}, 60_000)"],
    });
    const signed = sign("{}");
    expect(process.listenerCount("exit")).toBe(before + 1);
    const onExit = process.listeners("exit").at(-1)!;
    onExit(0);
    await expect(signed).rejects.toThrow(/exited null/);
    expect(process.listenerCount("exit")).toBe(before);
  });

  it("kills nothing when this process exits before a command that never started reports its error", async () => {
    const kill = vi.spyOn(process, "kill");
    try {
      const sign = cliSigner(stateDir, { command: ["/nonexistent/waitron-dev-signer"] });
      const signed = sign("{}");
      const onExit = process.listeners("exit").at(-1)!;
      expect(() => onExit(0)).not.toThrow();
      await expect(signed).rejects.toThrow(/ENOENT/);
      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
    }
  });

  it("stops listening for this process's exit once a command finishes", async () => {
    const before = process.listenerCount("exit");
    const sign = cliSigner(stateDir, {
      command: [process.execPath, "-e", "process.stdin.pipe(process.stdout)"],
    });
    await expect(sign("{}")).resolves.toBe("{}");
    expect(process.listenerCount("exit")).toBe(before);
  });
});

describe("devCustodianPlugin", () => {
  it("applies only to the dev server", () => {
    const plugin = devCustodianPlugin({ target: "http://127.0.0.1:1", stateDir });
    expect(plugin.apply).toBe("serve");
  });
});
