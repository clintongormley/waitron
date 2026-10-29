import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAuthority } from "../test/certificate-fixtures.js";
import { startDiagnosticServer } from "../test/certificate-diagnosis-fixtures.js";
import { diagnosticTransport } from "./certificate-diagnosis-transport.js";

const authority = makeAuthority();
const issued = authority.issue({ commonName: "diagnostic selected certificate" });
const material = { pfx: issued.pfx, passphrase: issued.passphrase, certKind: "sello" as const };
const servers: Awaited<ReturnType<typeof startDiagnosticServer>>[] = [];
const transports: ReturnType<typeof diagnosticTransport>[] = [];
afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.destroy()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function serve(answer: Parameters<typeof startDiagnosticServer>[1]) {
  const server = await startDiagnosticServer(authority, answer);
  servers.push(server);
  return server;
}

function transport(endpoint: string, signal = new AbortController().signal) {
  const progress: unknown[] = [];
  const result = diagnosticTransport(material, {
    endpoint,
    signal,
    ca: authority.caPem,
    report: (value) => progress.push(value),
  });
  transports.push(result);
  return { ...result, progress };
}

describe("bounded diagnostic transport", () => {
  it("refuses another local destination before opening its connection", async () => {
    const allowed = await serve((_request, response) => {
      response.end("allowed");
    });
    const other = await serve((_request, response) => {
      response.end("unexpected query");
    });
    await expect(transport(allowed.origin).fetch(other.origin)).rejects.toThrow(
      "Diagnostic destination mismatch",
    );
    expect(allowed.requests()).toBe(0);
    expect(other.requests()).toBe(0);
  });

  it("refuses an excessive declared length before waiting for its held body", async () => {
    const server = await serve((_request, response) => {
      response.writeHead(200, { "content-length": 1048577 });
      response.write("small partial body");
    });
    const controller = new AbortController();
    const real = diagnosticTransport(material, {
      endpoint: server.origin,
      signal: controller.signal,
      ca: authority.caPem,
      report: (value) => {
        if (value.stage === "response") setImmediate(() => controller.abort());
      },
    });
    transports.push(real);
    await expect(real.fetch(server.origin)).rejects.toThrow("Diagnostic reply exceeds limit");
    expect(real.observation()).toEqual({
      stage: "response",
      category: "reply-too-large",
      httpStatus: 200,
    });
  });

  it("preserves a Request's method, headers and body at the fixed destination", async () => {
    const methods: string[] = [];
    const headers: unknown[] = [];
    const server = await serve((request, response) => {
      methods.push(request.method!);
      headers.push(request.headers["x-diagnostic-query"]);
      response.end("accepted");
    });
    const real = transport(server.origin);
    const response = await real.fetch(
      new Request(server.origin, {
        method: "POST",
        headers: { "x-diagnostic-query": "one" },
        body: "request object query",
      }),
    );
    expect(await response.text()).toBe("accepted");
    expect(methods).toEqual(["POST"]);
    expect(headers).toEqual(["one"]);
    expect(server.bodies).toEqual(["request object query"]);
  });

  it("accepts the exact configured URL object", async () => {
    const server = await serve((_request, response) => {
      response.end("accepted");
    });
    expect(await (await transport(server.origin).fetch(new URL(server.origin))).text()).toBe(
      "accepted",
    );
    expect(server.requests()).toBe(1);
  });

  it.each(["init", "request"])(
    "keeps the attempt abort effective beside a caller %s signal",
    async (source) => {
      const server = await serve((_request, response) => {
        response.writeHead(200);
        response.write("partial");
      });
      const attempt = new AbortController();
      const caller = new AbortController();
      const real = transport(server.origin, attempt.signal);
      const pending =
        source === "init"
          ? real.fetch(server.origin, { signal: caller.signal })
          : real.fetch(new Request(server.origin, { signal: caller.signal }));
      const rejected = expect(pending).rejects.toBeDefined();
      await server.requestArrived;
      attempt.abort();
      await rejected;
      await real.destroy();
      await server.connectionClosed;
      expect(server.openConnections()).toBe(0);
    },
  );

  it("does not require an injected root when the selected PFX supplies the trusted chain", async () => {
    const server = await serve((_request, response) => {
      response.end("trusted");
    });
    const real = diagnosticTransport(material, {
      endpoint: server.origin,
      signal: new AbortController().signal,
      report: () => {},
    });
    transports.push(real);
    expect(await (await real.fetch(server.origin)).text()).toBe("trusted");
    expect(server.requests()).toBe(1);
  });

  it("handles an empty HTTP response without creating a body", async () => {
    const server = await serve((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    const real = transport(server.origin);
    const response = await real.fetch(server.origin);
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(await response.text()).toBe("");
    expect(real.observation().httpStatus).toBe(204);
  });

  it("uses the selected certificate and captures HTTP before returning its body", async () => {
    const server = await serve((_request, response) => {
      response.writeHead(403);
      response.end("secret refusal body");
    });
    const real = transport(server.origin);
    const response = await real.fetch(server.origin, { method: "POST", body: "one query" });
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("secret refusal body");
    expect(real.observation()).toEqual({
      stage: "parse",
      category: "http-response",
      httpStatus: 403,
    });
    expect(real.progress).toContainEqual({
      stage: "response",
      category: "http-response",
      httpStatus: 403,
    });
    expect(JSON.stringify(real.progress)).not.toContain("secret refusal");
    expect(server.requests()).toBe(1);
    expect(server.bodies).toEqual(["one query"]);
    expect(server.clientNames).toEqual(["diagnostic selected certificate"]);
    await real.close();
    await server.connectionClosed;
    expect(server.openConnections()).toBe(0);
  });

  it.each([301, 302, 303, 307, 308])(
    "does not follow HTTP %i to another destination",
    async (status) => {
      const alternate = await serve((_request, response) => {
        response.end("wrong target");
      });
      const server = await serve((_request, response) => {
        response.writeHead(status, { location: alternate.origin });
        response.end("redirect");
      });
      const real = transport(server.origin);
      expect((await real.fetch(server.origin, { method: "POST", body: "query" })).status).toBe(
        status,
      );
      expect(server.requests()).toBe(1);
      expect(alternate.requests()).toBe(0);
    },
  );

  it.each([
    "https://caller.example/",
    "http://127.0.0.1/",
    "https://127.0.0.1:1/",
    "https://user:secret@caller.example/",
  ])("refuses caller target %s before sending", async (destination) => {
    const server = await serve((_request, response) => {
      response.end("unused");
    });
    const real = transport(server.origin);
    await expect(real.fetch(destination)).rejects.toThrow("Diagnostic destination mismatch");
    expect(server.requests()).toBe(0);
  });

  it.each([false, true])("accepts exactly 1 MiB with declared length %s", async (declared) => {
    const body = Buffer.alloc(1048576, 32);
    const server = await serve((_request, response) => {
      response.writeHead(200, declared ? { "content-length": body.length } : {});
      response.end(body);
    });
    const real = transport(server.origin);
    const response = await real.fetch(server.origin);
    expect((await response.arrayBuffer()).byteLength).toBe(1048576);
    expect(real.observation()).toEqual({
      stage: "parse",
      category: "http-response",
      httpStatus: 200,
    });
  });

  it.each(["declared", "chunked", "gzip"])(
    "refuses the first excess decoded byte (%s) and closes its socket",
    async (mode) => {
      const body = Buffer.alloc(1048577, 32);
      const server = await serve((_request, response) => {
        response.writeHead(
          200,
          mode === "declared"
            ? { "content-length": body.length }
            : mode === "gzip"
              ? { "content-encoding": "gzip" }
              : {},
        );
        response.end(mode === "gzip" ? gzipSync(body) : body);
      });
      const real = transport(server.origin);
      await expect(real.fetch(server.origin)).rejects.toThrow("Diagnostic reply exceeds limit");
      expect(real.observation()).toEqual({
        stage: "response",
        category: "reply-too-large",
        httpStatus: 200,
      });
      await real.destroy();
      await server.connectionClosed;
      expect(server.openConnections()).toBe(0);
    },
  );

  it("keeps received status while a held body is cancelled", async () => {
    const server = await serve((_request, response) => {
      response.writeHead(403);
      response.write("partial secret");
    });
    const controller = new AbortController();
    const real = transport(server.origin, controller.signal);
    const pending = real.fetch(server.origin);
    const rejected = expect(pending).rejects.toBeDefined();
    await server.requestArrived;
    await vi.waitFor(() => expect(real.observation().httpStatus).toBe(403));
    controller.abort();
    await rejected;
    expect(real.observation().httpStatus).toBe(403);
    await real.destroy();
    await server.connectionClosed;
    expect(server.openConnections()).toBe(0);
  });

  it("cancels held headers without inventing a status", async () => {
    const server = await serve(() => {});
    const controller = new AbortController();
    const real = transport(server.origin, controller.signal);
    const rejected = expect(real.fetch(server.origin)).rejects.toBeDefined();
    await server.requestArrived;
    controller.abort();
    await rejected;
    expect(real.observation().httpStatus).toBeNull();
    await real.destroy();
    await server.connectionClosed;
    expect(server.openConnections()).toBe(0);
  });

  it("sends no request for an already cancelled attempt", async () => {
    const server = await serve((_request, response) => {
      response.end("unused");
    });
    const real = transport(server.origin, AbortSignal.abort());
    await expect(real.fetch(server.origin)).rejects.toBeDefined();
    expect(server.requests()).toBe(0);
  });
});
