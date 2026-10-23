import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { QR_ENDPOINTS } from "@waitron/verifactu";
import forge from "node-forge";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { certificate } from "@waitron/server-kit/certificate.js";
import { AUTHORITY_TIME_DEADLINE_MS, readAuthorityTime } from "./authority-time.js";

const NOW = Date.parse("2026-10-16T11:40:00.000Z");
const DATE = "Fri, 16 Oct 2026 11:40:00 GMT";

function clocks() {
  let wall = NOW - 200;
  let monotonic = 800;
  return { wall: () => (wall += 200), monotonic: () => (monotonic += 200) };
}

const answer =
  (headers: Record<string, string>, status = 200) =>
  async () =>
    new Response(null, { status, headers });

afterEach(() => {
  vi.useRealTimers();
});

describe("reading the tax authority's time from an injected request", () => {
  it("answers the Date header, centred in its second, paired with the round trip's midpoint", async () => {
    expect(
      await readAuthorityTime("production", {
        ...clocks(),
        request: answer({ Date: DATE, "Cache-Control": "no-store" }),
      }),
    ).toEqual({
      authorityMs: NOW + 500,
      uncertaintyMs: 600,
      at: { wallMs: NOW + 100, monoMs: 1100 },
    });
  });

  it("with no URL injected asks the QR validation host of the environment, with a fresh cache-busting value each call", async () => {
    const urls: URL[] = [];
    const request = async (url: URL) => {
      urls.push(url);
      return new Response(null, { headers: { Date: DATE } });
    };
    await readAuthorityTime("preproduction", { ...clocks(), request });
    await readAuthorityTime("preproduction", { ...clocks(), request });
    await readAuthorityTime("production", { ...clocks(), request });
    const bare = urls.map((url) => {
      const copy = new URL(url);
      copy.searchParams.delete("waitron_clock");
      return copy.href;
    });
    expect(bare).toEqual([
      QR_ENDPOINTS.preproduction,
      QR_ENDPOINTS.preproduction,
      QR_ENDPOINTS.production,
    ]);
    const values = urls.map((url) => url.searchParams.get("waitron_clock"));
    expect(values.every((value) => value !== null && value.length > 0)).toBe(true);
    expect(new Set(values).size).toBe(3);
  });

  it("an environment with no configured host answers null without asking anything", async () => {
    let asked = 0;
    expect(
      await readAuthorityTime("https://attacker.invalid" as "production", {
        request: async () => {
          asked++;
          return new Response(null, { headers: { Date: DATE } });
        },
      }),
    ).toBeNull();
    expect(asked).toBe(0);
  });

  it("follows a redirect on the same origin, keeping the cache-busting value, and dates from the start of the first request", async () => {
    const urls: URL[] = [];
    const result = await readAuthorityTime("production", {
      ...clocks(),
      request: async (url) => {
        urls.push(url);
        return urls.length === 1
          ? new Response(null, { status: 302, headers: { Location: "/elsewhere" } })
          : new Response(null, { headers: { Date: DATE } });
      },
    });
    expect(urls).toHaveLength(2);
    expect(urls[1]!.origin).toBe(new URL(QR_ENDPOINTS.production).origin);
    expect(urls[1]!.pathname).toBe("/elsewhere");
    expect(urls[1]!.searchParams.get("waitron_clock")).toBe(
      urls[0]!.searchParams.get("waitron_clock"),
    );
    expect(result).toEqual({
      authorityMs: NOW + 500,
      uncertaintyMs: 600,
      at: { wallMs: NOW + 100, monoMs: 1100 },
    });
  });

  it.each([
    ["another origin", "https://elsewhere.invalid/ValidarQR"],
    ["credentials in the address", "https://user:secret@www2.agenciatributaria.gob.es/"],
  ])("a redirect to %s answers null", async (_label, location) => {
    let asked = 0;
    expect(
      await readAuthorityTime("production", {
        ...clocks(),
        request: async () => {
          asked++;
          return new Response(null, { status: 302, headers: { Location: location, Date: DATE } });
        },
      }),
    ).toBeNull();
    expect(asked).toBe(1);
  });

  it("a redirect with no Location answers null", async () => {
    expect(
      await readAuthorityTime("production", {
        ...clocks(),
        request: answer({ Date: DATE }, 302),
      }),
    ).toBeNull();
  });

  it("stops after two redirects", async () => {
    let asked = 0;
    expect(
      await readAuthorityTime("production", {
        ...clocks(),
        request: async () => {
          asked++;
          return new Response(null, { status: 302, headers: { Location: "/again", Date: DATE } });
        },
      }),
    ).toBeNull();
    expect(asked).toBe(3);
  });

  it.each([
    ["no Date", {}],
    ["an unreadable Date", { Date: "yesterday" }],
    ["a Date not in the standard form", { Date: "2026-10-16T11:40:00Z" }],
    ["a cached copy's Age", { Date: DATE, Age: "3" }],
    ["a cache hit", { Date: DATE, "X-Cache": "Hit from cloudfront" }],
    ["a stale warning", { Date: DATE, Warning: '110 - "Response is Stale"' }],
    ["a cacheable lifetime", { Date: DATE, "Cache-Control": "public, max-age=60" }],
  ])("a response with %s answers null", async (_label, headers) => {
    expect(
      await readAuthorityTime("production", { ...clocks(), request: answer(headers) }),
    ).toBeNull();
  });

  it("a zero Age and a refused (4xx) page still carry the authority's time", async () => {
    expect(
      await readAuthorityTime("production", {
        ...clocks(),
        request: answer({ Date: DATE, Age: "0", "Cache-Control": "max-age=0" }, 405),
      }),
    ).toMatchObject({ authorityMs: NOW + 500 });
  });

  it.each([101, 500, 503])("a response with status %i answers null", async (status) => {
    expect(
      await readAuthorityTime("production", {
        ...clocks(),
        request: async () =>
          status === 101
            ? ({ status, headers: new Headers({ Date: DATE }), body: null } as Response)
            : new Response(null, { status, headers: { Date: DATE } }),
      }),
    ).toBeNull();
  });

  it("a network error answers null rather than throwing", async () => {
    expect(
      await readAuthorityTime("production", {
        ...clocks(),
        request: () => Promise.reject(new Error("offline")),
      }),
    ).toBeNull();
  });

  it.each([
    ["the steady clock ran backwards", { wall: [NOW, NOW], monotonic: [1000, 900] }],
    ["the round trip outlasted the deadline", { wall: [NOW, NOW + 6000], monotonic: [0, 6000] }],
    ["the wall clock jumped", { wall: [NOW, NOW + 3000], monotonic: [1000, 1200] }],
    ["the wall clock is unreadable", { wall: [NaN, NaN], monotonic: [1000, 1200] }],
    ["the steady clock is unreadable", { wall: [NOW, NOW], monotonic: [1000, Infinity] }],
  ])("answers null when %s", async (_label, readings) => {
    const wall = [...readings.wall];
    const monotonic = [...readings.monotonic];
    expect(
      await readAuthorityTime("production", {
        wall: () => wall.shift()!,
        monotonic: () => monotonic.shift()!,
        request: answer({ Date: DATE }),
      }),
    ).toBeNull();
  });

  it("gives up at five seconds, aborting the request, and cancels a body that arrives late even when the cancel is refused", async () => {
    vi.useFakeTimers();
    expect(AUTHORITY_TIME_DEADLINE_MS).toBe(5000);
    let signal: AbortSignal | undefined;
    let deliver!: (response: Response) => void;
    let cancelled = 0;
    let settled = false;
    const pending = readAuthorityTime("production", {
      ...clocks(),
      request: (_url, given) => {
        signal = given;
        return new Promise<Response>((resolve) => {
          deliver = resolve;
        });
      },
    }).then((result) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBe(false);
    expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeNull();
    expect(signal!.aborted).toBe(true);
    deliver(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled++;
            return Promise.reject(new Error("cancel refused"));
          },
        }),
        { headers: { Date: DATE } },
      ),
    );
    await vi.waitFor(() => expect(cancelled).toBe(1));
  });

  it("cancels the body of an answer it reads", async () => {
    let cancelled = 0;
    const result = await readAuthorityTime("production", {
      ...clocks(),
      request: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
            },
          }),
          { headers: { Date: DATE } },
        ),
    });
    expect(result).toMatchObject({ authorityMs: NOW + 500 });
    expect(cancelled).toBe(1);
  });
});

describe("reading the tax authority's time over a verified HTTPS connection", () => {
  const roots = getCACertificates("default");
  let caPem: string;
  let matching: { key: string; cert: string };
  let mismatched: { key: string; cert: string };
  const servers: Server[] = [];

  beforeAll(() => {
    const validity = { notBefore: new Date(2026, 0, 1), notAfter: new Date(2030, 0, 1) };
    const caKeys = forge.pki.rsa.generateKeyPair(2048);
    const issuer = { cn: "authority-time-test-ca", key: caKeys.privateKey };
    const ca = certificate(issuer.cn, caKeys, issuer, "01", validity, [
      { name: "basicConstraints", cA: true },
      { name: "keyUsage", keyCertSign: true, digitalSignature: true },
    ]);
    const serverKeys = forge.pki.rsa.generateKeyPair(2048);
    const leaf = (serial: string, altNames: Array<{ type: number; value?: string; ip?: string }>) =>
      forge.pki.certificateToPem(
        certificate("server", serverKeys, issuer, serial, validity, [
          { name: "basicConstraints", cA: false },
          { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
          { name: "extKeyUsage", serverAuth: true },
          { name: "subjectAltName", altNames },
        ]),
      );
    const key = forge.pki.privateKeyToPem(serverKeys.privateKey);
    caPem = forge.pki.certificateToPem(ca);
    matching = { key, cert: leaf("02", [{ type: 7, ip: "127.0.0.1" }]) };
    mismatched = { key, cert: leaf("03", [{ type: 2, value: "elsewhere.invalid" }]) };
    setDefaultCACertificates([...roots, caPem]);
  }, 60_000);

  afterAll(async () => {
    setDefaultCACertificates(roots);
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
  });

  async function serve(
    tls: { key: string; cert: string },
    handler: Parameters<typeof createServer>[1],
  ): Promise<{ url: string; received: () => number }> {
    let received = 0;
    const server = createServer(tls, (request, response) => {
      received++;
      handler!(request, response);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
      url: `https://127.0.0.1:${(server.address() as AddressInfo).port}/ValidarQR`,
      received: () => received,
    };
  }

  it("answers the server's Date, sent as a HEAD carrying the cache-busting value", async () => {
    const seen: { method?: string; url?: string }[] = [];
    const { url } = await serve(matching, (request, response) => {
      seen.push({ method: request.method, url: request.url });
      response.setHeader("Date", DATE);
      response.end();
    });
    const sample = await readAuthorityTime("production", { url });
    expect(sample).not.toBeNull();
    expect(sample!.authorityMs).toBe(NOW + 500);
    expect(sample!.uncertaintyMs).toBeGreaterThanOrEqual(500);
    expect(sample!.uncertaintyMs).toBeLessThan(5500);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("HEAD");
    expect(new URL(seen[0]!.url!, url).searchParams.get("waitron_clock")).toBeTruthy();
  });

  it("answers null when the server leaves out its Date", async () => {
    const { url, received } = await serve(matching, (_request, response) => {
      response.sendDate = false;
      response.end();
    });
    expect(await readAuthorityTime("production", { url })).toBeNull();
    expect(received()).toBe(1);
  });

  it("answers null on a redirect to another origin, without following it", async () => {
    const other = await serve(matching, (_request, response) => {
      response.setHeader("Date", DATE);
      response.end();
    });
    const { url, received } = await serve(matching, (_request, response) => {
      response.statusCode = 302;
      response.setHeader("Location", other.url);
      response.setHeader("Date", DATE);
      response.end();
    });
    expect(await readAuthorityTime("production", { url })).toBeNull();
    expect(received()).toBe(1);
    expect(other.received()).toBe(0);
  });

  it("answers null on a cached copy's Age", async () => {
    const { url, received } = await serve(matching, (_request, response) => {
      response.setHeader("Date", DATE);
      response.setHeader("Age", "3");
      response.end();
    });
    expect(await readAuthorityTime("production", { url })).toBeNull();
    expect(received()).toBe(1);
  });

  it("answers null when the certificate, from a trusted authority, names another host", async () => {
    const { url, received } = await serve(mismatched, (_request, response) => {
      response.setHeader("Date", DATE);
      response.end();
    });
    expect(await readAuthorityTime("production", { url })).toBeNull();
    expect(received()).toBe(0);
  });

  it("answers null when the server never answers", async () => {
    const { url, received } = await serve(matching, () => {});
    const started = performance.now();
    expect(await readAuthorityTime("production", { url, deadlineMs: 300 })).toBeNull();
    expect(performance.now() - started).toBeLessThan(3000);
    expect(received()).toBe(1);
  });
});
