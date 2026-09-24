import { describe, expect, it, vi } from "vitest";
import { SetupApi } from "./client.js";
import type { AdoptBody, ProvisionBody } from "./client.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function emptyResponse(): Response {
  return { ok: true, status: 200, json: async () => undefined, text: async () => "" } as Response;
}

function emptyErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async (): Promise<unknown> => {
      throw new SyntaxError("Unexpected end of JSON input");
    },
    text: async () => "",
  } as Response;
}

function textResponse(body: string, status: number): Response {
  return {
    ok: false,
    status,
    json: async (): Promise<unknown> => {
      throw new SyntaxError("Unexpected token '4', \"404 Not Found\" is not valid JSON");
    },
    text: async () => body,
  } as Response;
}

const provisionBody: ProvisionBody = {
  mode: "live",
  venue: {
    country: "ES",
    taxId: "B12345678",
    legalName: "Deli SL",
    location: {
      name: "Deli",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurante",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28001",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
    },
    tillName: "Barra",
    seriesCode: "A",
    rectificativeSeriesCode: "RA",
    admin: {
      firstNames: "Ada",
      lastNames: "Lovelace",
      displayName: "Ada",
      email: "ada@example.com",
      pin: "1234",
      password: "correct horse",
    },
  },
  aeatCert: { pfxBase64: "AAAA", passphrase: "pw", certKind: "sello" },
};

describe("SetupApi", () => {
  it("runs the explicit fiscal readiness test with the intended live body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted", testedAt: "2026-09-09T00:00:00Z" }), {
        status: 200,
      }),
    );
    const api = new SetupApi("", fetchImpl);
    const body = provisionBody;
    await expect(api.runFiscalTest(body)).resolves.toMatchObject({ status: "accepted" });
    expect(fetchImpl).toHaveBeenCalledWith("/setup-api/fiscal-test", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  });

  it("getStatus GETs /setup-api/status with credentials and returns the parsed status", async () => {
    const status = { provisioned: false, environment: "preproduction", needs: ["venue"] };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status));
    const api = new SetupApi("", fetchImpl);
    expect(await api.getStatus()).toEqual(status);
    expect(fetchImpl).toHaveBeenCalledWith("/setup-api/status", {
      method: "GET",
      credentials: "include",
    });
  });

  it("getVenueDefaults GETs /setup-api/venue-defaults and returns the parsed defaults", async () => {
    const defaults = { verifactu: { operationDescription: "Venta en establecimiento" } };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(defaults));
    const api = new SetupApi("", fetchImpl);
    expect(await api.getVenueDefaults()).toEqual(defaults);
    expect(fetchImpl).toHaveBeenCalledWith("/setup-api/venue-defaults", {
      method: "GET",
      credentials: "include",
    });
  });

  it("provision POSTs the body as JSON and returns the result", async () => {
    const result = { provisioned: true, restarting: true };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(result));
    const api = new SetupApi("", fetchImpl);
    expect(await api.provision(provisionBody)).toEqual(result);
    expect(fetchImpl).toHaveBeenCalledWith("/setup-api/provision", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(provisionBody),
    });
  });

  it("surfaces BOTH the code and params.field on a 400 setup.request_invalid", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "setup.request_invalid", params: { field: "taxId" } } },
          false,
          400,
        ),
      );
    const api = new SetupApi("", fetchImpl);
    await expect(api.provision(provisionBody)).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "taxId" },
    });
  });

  it("falls back to server.internal when the error envelope names no code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));
    const api = new SetupApi("", fetchImpl);
    await expect(api.provision(provisionBody)).rejects.toMatchObject({ code: "server.internal" });
  });

  it("keeps the status when a failed response carries no JSON body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse("404 Not Found", 404));
    const api = new SetupApi("", fetchImpl);
    await expect(api.getStatus()).rejects.toMatchObject({ status: 404, code: "server.internal" });
  });

  it.each([
    ["a literal null body", null],
    ["an array body", []],
    ["a number body", 42],
    ["a string body", "nope"],
    ["an envelope whose error is not an object", { error: "boom" }],
  ])("keeps the status and falls back to server.internal for %s", async (_label, body) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body, false, 404));
    const api = new SetupApi("", fetchImpl);
    await expect(api.getStatus()).rejects.toMatchObject({ code: "server.internal", status: 404 });
  });

  it("ignores a non-string code in the envelope", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { code: 42, params: { field: "taxId" } } }, false, 400),
      );
    const api = new SetupApi("", fetchImpl);
    const rejection = await api.getStatus().catch((error: unknown) => error);
    expect(rejection).toMatchObject({ code: "server.internal", status: 400 });
  });

  it("keeps the status when a failed response has an empty body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyErrorResponse(503));
    const api = new SetupApi("", fetchImpl);
    await expect(api.getStatus()).rejects.toMatchObject({ code: "server.internal", status: 503 });
  });

  it("reads code, params and status from a valid error envelope", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "setup.request_invalid", params: { field: "taxId" } } },
          false,
          400,
        ),
      );
    const api = new SetupApi("", fetchImpl);
    await expect(api.getStatus()).rejects.toEqual({
      code: "setup.request_invalid",
      params: { field: "taxId" },
      status: 400,
    });
  });

  it("carries the status alongside the code when the envelope is JSON", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: "setup.not_ready" } }, false, 409));
    const api = new SetupApi("", fetchImpl);
    await expect(api.provision(provisionBody)).rejects.toMatchObject({
      code: "setup.not_ready",
      status: 409,
    });
  });

  it("resolves undefined on an empty 2xx body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse());
    const api = new SetupApi("", fetchImpl);
    // provision's declared return is ProvisionResult; the empty-body branch resolves undefined at
    // runtime regardless of T — the shared `#request` behaviour this asserts.
    await expect(api.provision(provisionBody)).resolves.toBeUndefined();
  });

  const adoptBody: AdoptBody = {
    primaryUrl: "https://waitron.local",
    credential: { personId: "op-1", password: "correct horse", totp: "123456" },
  };

  it("adopt POSTs the body (credential as a nested object) as JSON and returns the result", async () => {
    const result = { adopted: true, restarting: true };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(result));
    const api = new SetupApi("", fetchImpl);
    expect(await api.adopt(adoptBody)).toEqual(result);
    expect(fetchImpl).toHaveBeenCalledWith("/setup-api/adopt", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(adoptBody),
    });
  });

  it("surfaces the mirror.bundle_fetch_failed code on a 502 (couldn't reach/auth the primary)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { code: "mirror.bundle_fetch_failed" } }, false, 502),
      );
    const api = new SetupApi("", fetchImpl);
    await expect(api.adopt(adoptBody)).rejects.toMatchObject({
      code: "mirror.bundle_fetch_failed",
    });
  });

  it("restore POSTs the encrypted artifact as binary with recovery metadata", async () => {
    const result = { restoreStaged: true, restarting: true };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(result, true, 202));
    const api = new SetupApi("", fetchImpl);
    const artifact = new Blob([Uint8Array.from([1, 2, 3])]);
    expect(await api.restore(artifact, "recovery-key", "production")).toEqual(result);
    expect(fetchImpl).toHaveBeenCalledWith("/setup-api/restore", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/octet-stream",
        "x-waitron-recovery-key": "recovery-key",
        "x-waitron-restore-environment": "production",
      },
      body: artifact,
    });
  });

  it("uses the local setup API for each Cloud recovery action and sends only the selected point for restore", async () => {
    const view = {
      requestId: "be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
      code: "12345678",
      openCloudUrl:
        "https://cloud.example.test/recover#request=be9c200d-d6ae-4dad-8895-e5eb50fa8ea3",
      expiresAt: "2026-09-24T12:00:00.000Z",
      state: "awaiting_owner",
    };
    const staged = { restoreStaged: true, restarting: true };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(view))
      .mockResolvedValueOnce(jsonResponse(view))
      .mockResolvedValueOnce(jsonResponse(view))
      .mockResolvedValueOnce(jsonResponse(staged, true, 202));
    const api = new SetupApi("", fetchImpl);
    expect(await api.startCloudRecovery()).toEqual(view);
    expect(await api.cloudRecoveryStatus()).toEqual(view);
    expect(await api.startCloudRecoveryAgain()).toEqual(view);
    expect(await api.restoreFromCloud("e8722eb0-3f02-4f35-920b-9b5f6bfb05e8")).toEqual(staged);
    expect(fetchImpl.mock.calls).toEqual([
      [
        "/setup-api/cloud-recovery/start",
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      ],
      ["/setup-api/cloud-recovery/status", { method: "GET", credentials: "include" }],
      [
        "/setup-api/cloud-recovery/start-again",
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      ],
      [
        "/setup-api/cloud-recovery/restore",
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pointId: "e8722eb0-3f02-4f35-920b-9b5f6bfb05e8" }),
        },
      ],
    ]);
  });

  it("rejects a refused restore with the envelope's code and the HTTP status", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { code: "restore.environment_mismatch" } }, false, 400),
      );
    const api = new SetupApi("", fetchImpl);
    await expect(
      api.restore(new Blob([Uint8Array.from([1])]), "recovery-key", "production"),
    ).rejects.toEqual({ code: "restore.environment_mismatch", params: undefined, status: 400 });
  });

  it("rejects a refused configuration export with the envelope's code and the HTTP status", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ error: { code: "setup.configuration_import_failed" } }, false, 422),
      );
    const api = new SetupApi("", fetchImpl);
    await expect(
      api.stageConfiguration(new Blob([Uint8Array.from([4])]), "a strong passphrase"),
    ).rejects.toEqual({
      code: "setup.configuration_import_failed",
      params: undefined,
      status: 422,
    });
  });

  it("stages a preparation export as binary with its passphrase", async () => {
    const preview = { venue: {}, counts: { products: 2 }, reconnect: ["printers"] };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(preview));
    const api = new SetupApi("", fetchImpl);
    const artifact = new Blob([Uint8Array.from([4, 5])]);
    expect(await api.stageConfiguration(artifact, "a strong passphrase")).toEqual(preview);
    expect(fetchImpl).toHaveBeenCalledWith("/setup-api/configuration", {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/octet-stream",
        "x-waitron-export-passphrase": "a strong passphrase",
      },
      body: artifact,
    });
  });
});

it("reads certificate availability from the real discovery path", async () => {
  const paths: string[] = [];
  const api = new SetupApi("", async (input) => {
    paths.push(String(input));
    return new Response(JSON.stringify({ caDownloadAvailable: true }));
  });
  expect(await api.getDiscovery()).toEqual({ caDownloadAvailable: true });
  expect(paths).toEqual(["/setup-api/discovery"]);
});

describe("SetupApi calls the fetch it was given as a free function", () => {
  // The browser's own fetch throws "Illegal invocation" when called as a method of another object;
  // this stub refuses the same way, where a vi.fn accepts any receiver.
  function receiverStrictFetch(this: unknown): Promise<Response> {
    if (this !== undefined && this !== globalThis) {
      return Promise.reject(new TypeError("Illegal invocation"));
    }
    return Promise.resolve(new Response(JSON.stringify({ ok: true })));
  }

  const artifact = (): Blob => new Blob([Uint8Array.from([1])]);
  const calls: [string, (api: SetupApi) => Promise<unknown>][] = [
    ["getStatus", (api) => api.getStatus()],
    ["restore", (api) => api.restore(artifact(), "recovery-key", "production")],
    ["stageConfiguration", (api) => api.stageConfiguration(artifact(), "a strong passphrase")],
  ];

  it.each(calls)("%s calls it as a plain function", async (_name, call) => {
    await expect(call(new SetupApi("", receiverStrictFetch))).resolves.toEqual({ ok: true });
  });

  it.each(calls)("%s reads a response through the browser's real fetch", async (_name, call) => {
    // SetupApi reads a body only from the Response fetch returned, so a read means the server
    // answered.
    const readers = [vi.spyOn(Response.prototype, "text"), vi.spyOn(Response.prototype, "json")];
    try {
      await call(new SetupApi("", fetch)).catch(() => undefined);
      expect(readers.flatMap((reader) => reader.mock.calls)).not.toHaveLength(0);
    } finally {
      for (const reader of readers) reader.mockRestore();
    }
  });
});
