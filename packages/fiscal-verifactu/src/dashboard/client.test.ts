import { describe, expect, it, vi } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { AeatCertificateClient, type InstallBody } from "./client.js";

describe("AeatCertificateClient", () => {
  it("read sends a passive GET", async () => {
    const answer = { filing: true, revision: null, timeZone: "Europe/Madrid", installed: null };
    const request = vi.fn<(...args: unknown[]) => Promise<never>>(async () => answer as never);
    const client = new AeatCertificateClient(request as unknown as DashboardRequest);

    await expect(client.read()).resolves.toBe(answer);
    expect(request).toHaveBeenCalledWith("/management-api/fiscal-certificate", "GET", undefined, {
      passive: true,
    });
  });

  it("install POSTs the body unchanged", async () => {
    const answer = { outcome: "installed", reason: "installed" };
    const request = vi.fn<(...args: unknown[]) => Promise<never>>(async () => answer as never);
    const client = new AeatCertificateClient(request as unknown as DashboardRequest);
    const body: InstallBody = {
      pfxBase64: "AAEC",
      passphrase: "secret",
      certKind: "representante",
      expectedRevision: "rev-1",
    };

    await expect(client.install(body)).resolves.toBe(answer);
    expect(request).toHaveBeenCalledWith("/management-api/fiscal-certificate", "POST", body);
    expect(request.mock.calls[0]![2]).toBe(body);
  });
});
