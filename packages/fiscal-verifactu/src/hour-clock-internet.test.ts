import { afterEach, describe, expect, it, vi } from "vitest";
import { SOAP_ENDPOINTS } from "@waitron/verifactu";
import { createServer, request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { mintMtlsMaterial } from "@waitron/server-kit/testing/mtls.js";
import { authenticatedHourHead, observeInternetHourClock } from "./hour-clock-internet.js";

const NOW = Date.parse("2026-10-16T11:40:00.000Z");
const headers = { Date: "Fri, 16 Oct 2026 11:40:00 GMT", "Cache-Control": "no-store" };
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function clocks() {
  let wall = NOW - 200;
  let monotonic = 800;
  return { wall: () => (wall += 200), monotonic: () => (monotonic += 200) };
}

describe("authenticated internet clock observation", () => {
  it("retains the failed request's clock interval without inventing an internet timestamp", async () => {
    expect(
      await observeInternetHourClock("production", {
        ...clocks(),
        request: () => Promise.reject(new Error("offline")),
      }),
    ).toEqual({
      source: "internet",
      result: "unavailable",
      reason: "network",
      wallStartedMs: NOW,
      wallFinishedMs: NOW + 200,
      monotonicStartedMs: 1000,
      monotonicFinishedMs: 1200,
      uncertaintyMs: null,
    });
  });
  it("an invalid configured environment cannot become a time-source URL", async () => {
    expect(
      await observeInternetHourClock("https://attacker.invalid" as "production"),
    ).toMatchObject({ result: "unavailable", reason: "configuration" });
  });
  it("uses the module's configured AEAT origin and records the complete request interval", async () => {
    const urls: string[] = [];
    const result = await observeInternetHourClock("preproduction", {
      ...clocks(),
      request: async (url) => {
        urls.push(url.href);
        return new Response(null, { headers });
      },
    });
    expect(new URL(urls[0]!).origin).toBe(new URL(SOAP_ENDPOINTS.preproduction).origin);
    expect(new URL(urls[0]!).searchParams.get("waitron_clock")).toBeTruthy();
    expect(result).toEqual({
      source: "internet",
      result: "usable",
      instantMs: NOW + 500,
      uncertaintyMs: 600,
      wallStartedMs: NOW,
      wallFinishedMs: NOW + 200,
      monotonicStartedMs: 1000,
      monotonicFinishedMs: 1200,
    });
  });

  it("does not discard a distant authenticated date just because the box clock disagrees", async () => {
    const result = await observeInternetHourClock("production", {
      ...clocks(),
      request: async () =>
        new Response(null, { headers: { ...headers, Date: "Fri, 16 Oct 2026 13:40:00 GMT" } }),
    });
    expect(result).toMatchObject({ result: "usable", instantMs: NOW + 7_200_500 });
  });

  it.each([302, 500])(
    "does not use a failed or incomplete response with status %i",
    async (status) => {
      expect(
        await observeInternetHourClock("production", {
          ...clocks(),
          request: async () => new Response(null, { status, headers }),
        }),
      ).toMatchObject({ result: "unavailable", reason: "response" });
    },
  );

  it("requires an actual Date even when the connection and status succeed", async () => {
    expect(
      await observeInternetHourClock("production", {
        ...clocks(),
        request: async () => new Response(null),
      }),
    ).toMatchObject({ result: "unavailable", reason: "response" });
  });

  it("accepts a fresh noncached same-origin redirect without credentials", async () => {
    let calls = 0;
    expect(
      await observeInternetHourClock("production", {
        ...clocks(),
        request: async () =>
          ++calls === 1
            ? new Response(null, { status: 302, headers: { Location: "/time" } })
            : new Response("bounded", { status: 403, headers: { ...headers, Age: "0" } }),
      }),
    ).toMatchObject({ result: "usable" });
    expect(calls).toBe(2);
  });

  it.each(["user@", "user:secret@"])(
    "does not send a redirected request carrying %s credentials",
    async (credentials) => {
      let calls = 0;
      expect(
        await observeInternetHourClock("production", {
          ...clocks(),
          request: async (url) => {
            calls++;
            return new Response(null, {
              status: 302,
              headers: { Location: `${url.protocol}//${credentials}${url.host}/time` },
            });
          },
        }),
      ).toMatchObject({ result: "unavailable", reason: "response" });
      expect(calls).toBe(1);
    },
  );

  it.each([null, "offline"])("keeps an opaque transport failure %j unavailable", async (error) => {
    expect(
      await observeInternetHourClock("production", {
        ...clocks(),
        request: () => Promise.reject(error),
      }),
    ).toMatchObject({ result: "unavailable", reason: "network" });
  });

  it.each([
    [0, -1, NOW, NOW],
    [0, 5001, NOW, NOW + 5001],
    [0, NaN, NOW, NOW],
    [0, 1, NaN, NOW],
    [0, 1, NOW, NaN],
    [0, 1, NOW, NOW + 2000],
  ])(
    "does not turn corrected or invalid request clocks %j into an internet sample",
    async (start, end, wallStart, wallEnd) => {
      const monotonic = [start, end];
      const wall = [wallStart, wallEnd];
      expect(
        await observeInternetHourClock("production", {
          monotonic: () => monotonic.shift()!,
          wall: () => wall.shift()!,
          request: async () => new Response(null, { headers }),
        }),
      ).toMatchObject({ result: "unavailable", reason: "clock-corrected" });
    },
  );

  it.each([
    { Date: "nonsense" },
    { Date: "Fri, 32 Oct 2026 11:40:00 GMT" },
    { Date: "2026-10-16" },
    { Date: "Thu, 16 Oct 2026 11:40:00 GMT" },
    { Age: "1" },
    { Age: "wrong" },
    { "X-Cache": "HIT from proxy" },
    { Warning: '110 - "stale"' },
    { "Cache-Control": "public, max-age=3600" },
    { "Cache-Control": 'public, s-maxage="0001"' },
  ])("refuses malformed or cached evidence %j", async (extra) => {
    const result = await observeInternetHourClock("production", {
      ...clocks(),
      request: async () => {
        const responseHeaders = new Headers(headers);
        for (const [name, value] of Object.entries(extra)) {
          if (value !== undefined) responseHeaders.set(name, value);
        }
        return new Response(null, { headers: responseHeaders });
      },
    });
    expect(result).toMatchObject({ source: "internet", result: "unavailable", reason: "response" });
  });

  it.each(["ENETUNREACH", "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT"])(
    "reports %s as unavailable with no insecure retry",
    async (code) => {
      let calls = 0;
      const result = await observeInternetHourClock("production", {
        ...clocks(),
        request: () => {
          calls++;
          return Promise.reject(Object.assign(new Error("private diagnostic"), { code }));
        },
      });
      expect(result).toMatchObject({ source: "internet", result: "unavailable" });
      expect(JSON.stringify(result)).not.toContain("private diagnostic");
      expect(calls).toBe(1);
    },
  );

  it("does not follow a redirect to another authenticated origin", async () => {
    let calls = 0;
    const result = await observeInternetHourClock("production", {
      ...clocks(),
      request: async () => {
        calls++;
        return new Response(null, {
          status: 302,
          headers: { Location: "https://attacker.invalid/time" },
        });
      },
    });
    expect(result).toMatchObject({ result: "unavailable", reason: "response" });
    expect(calls).toBe(1);
  });

  it("bounds repeated redirects on the selected origin", async () => {
    let calls = 0;
    const result = await observeInternetHourClock("production", {
      ...clocks(),
      request: async () => {
        calls++;
        return new Response(null, { status: 302, headers: { Location: "/again" } });
      },
    });
    expect(result).toMatchObject({ result: "unavailable", reason: "response" });
    expect(calls).toBe(3);
  });

  it("one five-second deadline covers headers, redirects and an unfinished response body", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let cancelled = false;
    const pending = observeInternetHourClock("preproduction", {
      ...clocks(),
      request: async () => {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        return new Response(
          new ReadableStream({
            cancel: () => {
              cancelled = true;
            },
          }),
          { headers },
        );
      },
    });
    await vi.advanceTimersByTimeAsync(4999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ result: "unavailable", reason: "timeout" });
    expect(cancelled).toBe(true);
  });

  it("bounds response bytes even for an endlessly productive stream", async () => {
    const result = await observeInternetHourClock("production", {
      ...clocks(),
      request: async () =>
        new Response(
          new ReadableStream({ pull: (controller) => controller.enqueue(new Uint8Array(8193)) }),
          { headers },
        ),
    });
    expect(result).toMatchObject({ result: "unavailable", reason: "response" });
  });

  it("a request that never answers is unavailable at five seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let signal: AbortSignal | undefined;
    const pending = observeInternetHourClock("production", {
      ...clocks(),
      request: (_url, received) => {
        signal = received;
        return new Promise(() => {});
      },
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ result: "unavailable", reason: "timeout" });
    expect(signal!.aborted).toBe(true);
  });

  it("discards and cancels a response that arrives after its deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let resolve!: (response: Response) => void;
    let cancelled = false;
    const response = new Promise<Response>((answer) => {
      resolve = answer;
    });
    const pending = observeInternetHourClock("production", {
      ...clocks(),
      request: () => response,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toMatchObject({ result: "unavailable", reason: "timeout" });
    resolve(
      new Response(
        new ReadableStream({
          cancel: () => {
            cancelled = true;
          },
        }),
        { headers },
      ),
    );
    await vi.waitFor(() => expect(cancelled).toBe(true));
  });

  it.each(["timeout", "oversize", "late"])(
    "a rejected %s cancellation cannot replace the unavailable result",
    async (mode) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      let cancellations = 0;
      const response = new Response(
        new ReadableStream({
          ...(mode === "oversize"
            ? {
                pull: (controller: ReadableStreamDefaultController<Uint8Array>) =>
                  controller.enqueue(new Uint8Array(8193)),
              }
            : {}),
          cancel: () => {
            cancellations++;
            return Promise.reject(new Error("cancel refused"));
          },
        }),
        { headers },
      );
      let answer!: (response: Response) => void;
      const late = new Promise<Response>((resolve) => {
        answer = resolve;
      });
      const pending = observeInternetHourClock("production", {
        ...clocks(),
        request: () => (mode === "late" ? late : Promise.resolve(response)),
      });
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pending).toMatchObject({
        result: "unavailable",
        reason: mode === "oversize" ? "response" : "timeout",
      });
      if (mode === "late") answer(response);
      await vi.waitFor(() => expect(cancellations).toBe(1));
    },
  );

  it("the native HTTPS transport refuses an untrusted certificate even under an insecure process default", async () => {
    const material = mintMtlsMaterial();
    let received = 0;
    const server = createServer(
      { key: material.serverKeyPem, cert: material.serverCertPem },
      (_request, response) => {
        received++;
        response.setHeader("X-Clock-Test", "received");
        response.end();
      },
    );
    const roots = getCACertificates("default");
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const url = new URL(`https://127.0.0.1:${(server.address() as AddressInfo).port}/`);
      // Only this test control accepts the fixture issuer; production must still refuse it.
      await new Promise<void>((resolve, reject) => {
        const request = httpsRequest(
          url,
          { rejectUnauthorized: false, agent: false },
          (response) => {
            response.resume();
            response.on("end", resolve);
          },
        );
        request.on("error", reject);
        request.end();
      });
      expect(received).toBe(1);
      setDefaultCACertificates([...roots, material.caPem]);
      const trusted = await authenticatedHourHead(url, AbortSignal.timeout(5000));
      expect(trusted.status).toBe(200);
      expect(trusted.headers.get("x-clock-test")).toBe("received");
      expect(received).toBe(2);
      setDefaultCACertificates(roots);
      vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED", "0");
      await expect(authenticatedHourHead(url, AbortSignal.timeout(5000))).rejects.toMatchObject({
        code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      });
      expect(received).toBe(2);
    } finally {
      setDefaultCACertificates(roots);
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
