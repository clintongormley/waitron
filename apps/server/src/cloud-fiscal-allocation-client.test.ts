import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createCloudFiscalAllocationClient } from "./cloud-fiscal-allocation-client.js";

interface FiscalTransport {
  status(input: unknown): Promise<unknown>;
  report(input: unknown): Promise<unknown>;
}

const statusBody = {
  version: 1,
  venueId: "10000000-0000-4000-8000-000000000002",
  operationId: "10000000-0000-4000-8000-000000000001",
};
const proof = { payload: "signed-machine-body", signature: "machine-signature" };
const account = { cookie: "cloud_session=synthetic-session", csrfToken: "synthetic-csrf" };

async function client(
  origin: string,
  extra: Record<string, unknown> = {},
): Promise<FiscalTransport> {
  return createCloudFiscalAllocationClient({ origin, account, environment: "dev", ...extra });
}

async function withServer<T>(
  handle: (request: IncomingMessage, response: ServerResponse) => void,
  run: (origin: string) => Promise<T>,
): Promise<T> {
  const server = createServer(handle);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

describe("Cloud fiscal status and report over real HTTP", () => {
  it("requires HTTPS outside an explicitly selected development loopback", () => {
    expect(() =>
      createCloudFiscalAllocationClient({ origin: "http://cloud.example", account }),
    ).toThrowError(expect.objectContaining({ code: "cloud.request_invalid" }));
  });

  it("sends passive status with the explicit Cloud session and retains an unknown outcome", async () => {
    let observed: unknown;
    await withServer(
      (request, response) => {
        void body(request).then((input) => {
          observed = {
            path: request.url,
            method: request.method,
            origin: request.headers.origin,
            cookie: request.headers.cookie,
            csrf: request.headers["x-csrf-token"],
            input,
          };
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ version: 1, state: "unknown", receipt: null }));
        });
      },
      async (origin) => {
        const api = await client(origin);
        expect(await api.status(statusBody)).toEqual({
          version: 1,
          state: "unknown",
          receipt: null,
        });
        expect(observed).toEqual({
          path: "/api/account/fiscal-allocations/status",
          method: "POST",
          origin,
          cookie: account.cookie,
          csrf: account.csrfToken,
          input: statusBody,
        });
      },
    );
  });

  it("reports an opaque machine proof without Origin or account credentials", async () => {
    let observed: unknown;
    await withServer(
      (request, response) => {
        void body(request).then((input) => {
          observed = {
            path: request.url,
            origin: request.headers.origin,
            cookie: request.headers.cookie,
            csrf: request.headers["x-csrf-token"],
            input,
          };
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ version: 1, state: "recorded", receiptId: null }));
        });
      },
      async (origin) => {
        const api = await client(origin);
        expect(await api.report(proof)).toEqual({ version: 1, state: "recorded", receiptId: null });
        expect(observed).toEqual({
          path: "/api/installations/fiscal-allocations/report",
          origin: undefined,
          cookie: undefined,
          csrf: undefined,
          input: proof,
        });
      },
    );
  });

  it.each([401, 403, 409, 429, 503])(
    "refuses actual HTTP %s for both operations",
    async (status) => {
      let calls = 0;
      await withServer(
        (request, response) => {
          calls++;
          response.writeHead(status, { "content-type": "application/json" });
          response.end(
            JSON.stringify(
              request.url?.endsWith("/status")
                ? { version: 1, state: "unknown", receipt: null }
                : { version: 1, state: "recorded", receiptId: null },
            ),
          );
        },
        async (origin) => {
          const api = await client(origin);
          await expect(api.status(statusBody)).rejects.toMatchObject({
            code: "cloud.unavailable",
            params: {},
          });
          await expect(api.report(proof)).rejects.toMatchObject({
            code: "cloud.unavailable",
            params: {},
          });
          expect(calls).toBe(2);
        },
      );
    },
  );

  it.each([
    "not json",
    "null",
    "[]",
    JSON.stringify({ version: 2, state: "unknown", receipt: null }),
    JSON.stringify({ version: 1, state: "recorded", receipt: null }),
    JSON.stringify({ version: 1, state: "unknown", receipt: { payload: {} } }),
    JSON.stringify({ version: 1, state: "unknown", receipt: null, extra: "secret" }),
  ])("refuses malformed or contradictory successful status %#", async (result) => {
    await withServer(
      (_request, response) => {
        response.setHeader("content-type", "application/json");
        response.end(result);
      },
      async (origin) => {
        await expect((await client(origin)).status(statusBody)).rejects.toMatchObject({
          code: "cloud.unavailable",
        });
      },
    );
  });

  it("retains a recorded opaque signed receipt for verification by its owning module", async () => {
    const receipt = {
      payload: { opaque: "module-owned" },
      keyId: "public-key",
      signature: "signature",
    };
    await withServer(
      (_request, response) => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ version: 1, state: "recorded", receipt }));
      },
      async (origin) => {
        expect(await (await client(origin)).status(statusBody)).toEqual({
          version: 1,
          state: "recorded",
          receipt,
        });
      },
    );
  });

  it.each([
    { version: 1, state: "unknown", receiptId: null },
    { version: 1, state: "matched", receiptId: 42 },
    { version: 1, state: "conflict", receiptId: null, detail: "extra" },
  ])("refuses malformed successful report %#", async (result) => {
    await withServer(
      (_request, response) => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(result));
      },
      async (origin) => {
        await expect((await client(origin)).report(proof)).rejects.toMatchObject({
          code: "cloud.unavailable",
        });
      },
    );
  });

  it("refuses a successful HTML response", async () => {
    await withServer(
      (_request, response) => {
        response.setHeader("content-type", "text/html");
        response.end(JSON.stringify({ version: 1, state: "unknown", receipt: null }));
      },
      async (origin) => {
        await expect((await client(origin)).status(statusBody)).rejects.toMatchObject({
          code: "cloud.unavailable",
        });
      },
    );
  });

  it("bounds the response body", async () => {
    await withServer(
      (_request, response) => {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            version: 1,
            state: "recorded",
            receipt: { payload: { opaque: "A".repeat(262145) } },
          }),
        );
      },
      async (origin) => {
        await expect((await client(origin)).status(statusBody)).rejects.toMatchObject({
          code: "cloud.unavailable",
        });
      },
    );
  });

  it("does not resend after a dropped report reply", async () => {
    let calls = 0;
    await withServer(
      (request) => {
        calls++;
        request.socket.destroy();
      },
      async (origin) => {
        await expect((await client(origin)).report(proof)).rejects.toMatchObject({
          code: "cloud.unavailable",
        });
        expect(calls).toBe(1);
        expect(proof).toEqual({ payload: "signed-machine-body", signature: "machine-signature" });
      },
    );
  });

  it("bounds a stalled response body after its headers arrive", async () => {
    await withServer(
      (_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.flushHeaders();
      },
      async (origin) => {
        await expect(
          (await client(origin, { timeoutMs: 50 })).status(statusBody),
        ).rejects.toMatchObject({ code: "cloud.unavailable" });
      },
    );
  });

  it("refuses oversized input before sending it", async () => {
    let calls = 0;
    await withServer(
      (_request, response) => {
        calls++;
        response.end("{}");
      },
      async (origin) => {
        await expect(
          (await client(origin)).report({ payload: "A".repeat(16385), signature: "s" }),
        ).rejects.toMatchObject({ code: "cloud.request_invalid" });
        expect(calls).toBe(0);
      },
    );
  });

  it("refuses status without an explicit Cloud session before sending it", async () => {
    let calls = 0;
    await withServer(
      (_request, response) => {
        calls++;
        response.end("{}");
      },
      async (origin) => {
        await expect(
          (await client(origin, { account: undefined })).status(statusBody),
        ).rejects.toMatchObject({ code: "cloud.not_configured" });
        expect(calls).toBe(0);
      },
    );
  });
});

it("refuses a redirect before sending account credentials to another origin", async () => {
  let redirected = 0;
  await withServer(
    (_request, response) => {
      redirected++;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ version: 1, state: "unknown", receipt: null }));
    },
    async (destination) => {
      await withServer(
        (_request, response) => {
          response.writeHead(307, { location: destination + "/forwarded" });
          response.end();
        },
        async (origin) => {
          await expect((await client(origin)).status(statusBody)).rejects.toMatchObject({
            code: "cloud.unavailable",
          });
        },
      );
    },
  );
  expect(redirected).toBe(0);
});
