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
    admin: { displayName: "Ada", email: "ada@example.com", pin: "1234", password: "correct horse" },
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
