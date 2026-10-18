import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import {
  makeAuthority,
  SIN_DATOS_BODY,
  SOAP_FAULT_BODY,
  startAnsweringServer,
  type AnsweringServer,
  type Candidate,
} from "../test/certificate-fixtures.js";
import { mtlsFetch, type CertMaterial, type TenantTransport } from "./aeat-transport.js";
import { checkWithAuthority, type CheckTransport } from "./certificate-check.js";

const authority = makeAuthority();
const candidate = authority.issue();
const stranger = authority.issue({ signedBy: "stranger" });
const taxpayer = { legalName: "WAITRON SL", taxId: "89890001K" };
const NOW = new Date("2026-10-18T10:00:00Z");

function materialOf(issued: Candidate): CertMaterial {
  return { pfx: issued.pfx, passphrase: issued.passphrase, certKind: "sello" };
}

const servers: AnsweringServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s?.close()));
});

async function serve(answer: Parameters<typeof startAnsweringServer>[1]): Promise<AnsweringServer> {
  const server = await startAnsweringServer(authority, answer);
  servers.push(server);
  return server;
}

function transportTo(origin: string, sentBodies: string[] = []): CheckTransport {
  return {
    endpointFor: () => origin,
    fetchFor: (material) => {
      const real = mtlsFetch(material, authority.caPem);
      return {
        fetch: ((input, init) => {
          if (typeof init?.body === "string") sentBodies.push(init.body);
          return real.fetch(input, init);
        }) as typeof globalThis.fetch,
        close: real.close,
      };
    },
  };
}

function check(transport: CheckTransport, extra: { now?: Date; timeoutMs?: number } = {}) {
  return checkWithAuthority({
    material: materialOf(candidate),
    taxpayer,
    timeZone: "Europe/Madrid",
    now: extra.now ?? NOW,
    transport,
    ...(extra.timeoutMs === undefined ? {} : { timeoutMs: extra.timeoutMs }),
  });
}

describe("checkWithAuthority", () => {
  it("passes on a SinDatos answer and names the endpoint it asked", async () => {
    const server = await serve({ status: 200, body: SIN_DATOS_BODY });
    await expect(check(transportTo(server.origin))).resolves.toEqual({
      ok: true,
      endpoint: server.origin,
    });
    expect(server.requests()).toBe(1);
  });

  it("asks for the taxpayer and the current month in the venue's zone", async () => {
    const server = await serve({ status: 200, body: SIN_DATOS_BODY });
    const bodies: string[] = [];
    await check(transportTo(server.origin, bodies), { now: new Date("2026-10-31T23:30:00Z") });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatch(/Ejercicio>2026</);
    expect(bodies[0]).toMatch(/Periodo>11</);
    expect(bodies[0]).toMatch(/NIF>89890001K</);
  });

  it("pads a month below ten", async () => {
    const server = await serve({ status: 200, body: SIN_DATOS_BODY });
    const bodies: string[] = [];
    await check(transportTo(server.origin, bodies), { now: new Date("2026-03-10T10:00:00Z") });
    expect(bodies[0]).toMatch(/Periodo>03</);
  });

  it("reports closed when the server refuses the certificate over TLS 1.3", async () => {
    const server = await serve({ status: 200, body: SIN_DATOS_BODY, maxVersion: "TLSv1.3" });
    const result = await checkWithAuthority({
      material: materialOf(stranger),
      taxpayer,
      timeZone: "Europe/Madrid",
      now: NOW,
      transport: transportTo(server.origin),
    });
    expect(result).toEqual({ ok: false, reason: "closed" });
    expect(server.requests()).toBe(0);
  });

  it("reports closed when the server refuses the certificate over TLS 1.2", async () => {
    const server = await serve({ status: 200, body: SIN_DATOS_BODY, maxVersion: "TLSv1.2" });
    const result = await checkWithAuthority({
      material: materialOf(stranger),
      taxpayer,
      timeZone: "Europe/Madrid",
      now: NOW,
      transport: transportTo(server.origin),
    });
    expect(result).toEqual({ ok: false, reason: "closed" });
    expect(server.requests()).toBe(0);
  });

  it("reports unreachable for a refused connection", async () => {
    const listener = createServer();
    await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const { port } = listener.address() as AddressInfo;
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    await expect(check(transportTo(`https://127.0.0.1:${port}`))).resolves.toEqual({
      ok: false,
      reason: "unreachable",
    });
  });

  it("reports unreachable for a name that does not resolve", async () => {
    const transport: CheckTransport = {
      endpointFor: () => "https://nowhere.invalid",
      fetchFor: () => ({
        fetch: (() =>
          Promise.reject(
            new TypeError("fetch failed", {
              cause: Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }),
            }),
          )) as typeof globalThis.fetch,
        close: () => Promise.resolve(),
      }),
    };
    await expect(check(transport)).resolves.toEqual({ ok: false, reason: "unreachable" });
  });

  it("reports unreachable when AEAT does not answer within the timer", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = await serve({ status: 200, body: SIN_DATOS_BODY, hold });
    try {
      await expect(check(transportTo(server.origin), { timeoutMs: 200 })).resolves.toEqual({
        ok: false,
        reason: "unreachable",
      });
    } finally {
      release();
    }
  });

  it("reports aeat_fault with the fault code and reason", async () => {
    const server = await serve({ status: 500, body: SOAP_FAULT_BODY });
    await expect(check(transportTo(server.origin))).resolves.toEqual({
      ok: false,
      reason: "aeat_fault",
      details: { faultCode: "env:Client", faultReason: "Test fault" },
    });
  });

  it("reports aeat_fault with empty details for a fault that names neither", async () => {
    const emptyFault =
      '<?xml version="1.0"?><env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Body><env:Fault></env:Fault></env:Body></env:Envelope>';
    const server = await serve({ status: 500, body: emptyFault });
    await expect(check(transportTo(server.origin))).resolves.toEqual({
      ok: false,
      reason: "aeat_fault",
      details: { faultCode: "", faultReason: "" },
    });
  });

  it("reports check_failed for a network failure it does not recognise", async () => {
    const transport: CheckTransport = {
      endpointFor: () => "https://127.0.0.1:1",
      fetchFor: () => ({
        fetch: (() =>
          Promise.reject(
            new TypeError("fetch failed", {
              cause: Object.assign(new Error("odd"), { code: "EPROTO" }),
            }),
          )) as typeof globalThis.fetch,
        close: () => Promise.resolve(),
      }),
    };
    await expect(check(transport)).resolves.toEqual({ ok: false, reason: "check_failed" });
  });

  it("reports aeat_http with the status", async () => {
    const server = await serve({ status: 403, body: "<html>forbidden</html>" });
    await expect(check(transportTo(server.origin))).resolves.toEqual({
      ok: false,
      reason: "aeat_http",
      details: { status: 403 },
    });
  });

  it("reports check_failed for an answer it cannot parse", async () => {
    const server = await serve({ status: 200, body: "<not-soap/>" });
    await expect(check(transportTo(server.origin))).resolves.toEqual({
      ok: false,
      reason: "check_failed",
    });
  });

  it("closes the transport it opened, whatever the outcome", async () => {
    const pass = await serve({ status: 200, body: SIN_DATOS_BODY });
    const fail = await serve({ status: 403, body: "<html>forbidden</html>" });
    for (const origin of [pass.origin, fail.origin]) {
      const opened: TenantTransport[] = [];
      const inner = transportTo(origin);
      const transport: CheckTransport = {
        endpointFor: inner.endpointFor,
        fetchFor: (material) => {
          const made = inner.fetchFor(material);
          const spied = { fetch: made.fetch, close: vi.fn(made.close) };
          opened.push(spied);
          return spied;
        },
      };
      await check(transport);
      expect(opened).toHaveLength(1);
      expect(opened[0]!.close).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps its answer when closing the transport fails", async () => {
    const server = await serve({ status: 200, body: SIN_DATOS_BODY });
    const inner = transportTo(server.origin);
    const transport: CheckTransport = {
      endpointFor: inner.endpointFor,
      fetchFor: (material) => {
        const made = inner.fetchFor(material);
        return {
          fetch: made.fetch,
          close: async () => {
            await made.close();
            throw new Error("close failed");
          },
        };
      },
    };
    await expect(check(transport)).resolves.toEqual({ ok: true, endpoint: server.origin });
  });
});
