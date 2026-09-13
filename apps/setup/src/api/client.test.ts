import { describe, expect, it, vi } from "vitest";
import { SetupApi } from "./client.js";
import type { AdoptBody, ProvisionBody } from "./client.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

/**
 * An empty 200 — `text()` → "" — exercising `#request`'s empty-body branch, which resolves
 * `undefined` instead of `JSON.parse`-ing nothing. Neither setup route answers empty today (both send
 * a body), so this stands in for the defensive branch the client shares with till/dashboard.
 */
function emptyResponse(): Response {
  return { ok: true, status: 200, json: async () => undefined, text: async () => "" } as Response;
}

/** A failure with NO body at all — `res.json()` throws on nothing, exactly as it does on text. */
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

/** A non-JSON failure — what a provisioned box really sends for an unmounted setup route. */
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

/** A complete, valid provision body — the shape the wizard assembles and POSTs. */
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

  it("provision POSTs the body as JSON and returns the result", async () => {
    const result = { provisioned: true, tenantId: "t-1", restarting: true };
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

  /**
   * A provisioned box does not mount the setup routes, so `GET /setup-api/status` comes back as
   * Hono's own `404 Not Found` with `content-type: text/plain` — verified against a running dev box
   * on 2026-09-13. Parsing that as JSON throws, and the throw used to escape as if the network had
   * failed, so a server that plainly ANSWERED was reported to the operator as unreachable.
   */
  it("keeps the status when a failed response carries no JSON body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse("404 Not Found", 404));
    const api = new SetupApi("", fetchImpl);
    await expect(api.getStatus()).rejects.toMatchObject({ status: 404, code: "server.internal" });
  });

  /**
   * A failed response's body is whatever the thing that answered chose to send, and only ONE shape
   * of it is our error envelope. These cases are the ones a plain `JSON.parse` survives but a naive
   * `envelope.error?.code` does not: `null` is VALID JSON, so the parse succeeds and reading `.error`
   * off it throws a `TypeError` that escapes the client — losing the HTTP status, which is the one
   * fact the wizard uses to tell an answering box from an unreachable one. An array, a number or a
   * string parse fine and simply have no `error` to read. Each must still reject with the status.
   */
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

  /** A non-string `code` is not a domain error code, and passing it through would let a caller's
   * `code.startsWith(...)` throw on a number. It falls back like a missing code, status intact. */
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

  /** An empty failure body: `res.json()` throws on nothing at all, and the status must survive. */
  it("keeps the status when a failed response has an empty body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyErrorResponse(503));
    const api = new SetupApi("", fetchImpl);
    await expect(api.getStatus()).rejects.toMatchObject({ code: "server.internal", status: 503 });
  });

  /** The control in the other direction: a real envelope still yields its code, params and status. */
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

  // The mirror-side sibling of `provision` (C2b Task 13). The credential is the STRUCTURED OBJECT
  // { personId, password, totp? } — sent DIRECTLY, never JSON-stringified into a string field.
  const adoptBody: AdoptBody = {
    primaryUrl: "https://waitron.local",
    credential: { personId: "op-1", password: "correct horse", totp: "123456" },
  };

  it("adopt POSTs the body (credential as a nested object) as JSON and returns the result", async () => {
    const result = { adopted: true, tenantId: "t-1", restarting: true };
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
