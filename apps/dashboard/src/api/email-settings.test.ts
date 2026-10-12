import { describe, expect, it } from "vitest";
import { DashboardApi } from "./client.js";
import type { FetchLike } from "@waitron/dashboard-kit";

const draft = {
  server: "smtp.example.test",
  port: 465,
  encryption: "tls" as const,
  user: "invoice-user",
  password: "fresh-secret",
  from: "invoices@example.test",
};
const settings = {
  mode: "smtp",
  editable: true,
  settings: {
    server: "smtp.example.test",
    port: 465,
    encryption: "tls",
    from: "invoices@example.test",
    hasAuthentication: true,
  },
};

function client(response: unknown, status = 200) {
  const requests: { path: string; init: RequestInit }[] = [];
  const transport: FetchLike = async (path, init) => {
    requests.push({ path, init });
    return new Response(JSON.stringify(response), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { api: new DashboardApi("/box", transport), requests };
}

describe("dashboard email settings wire contract", () => {
  it("reads redacted settings with cookies without sending proposed credentials", async () => {
    const { api, requests } = client(settings);
    expect(await api.getEmailSettings()).toEqual(settings);
    expect(requests).toEqual([
      {
        path: "/box/management-api/email/settings",
        init: { method: "GET", credentials: "include", signal: expect.any(AbortSignal) },
      },
    ]);
  });
  it("makes automatic settings reads passive", async () => {
    const { api, requests } = client(settings);
    await api.background.getEmailSettings();
    expect(new Headers(requests[0]!.init.headers).get("x-waitron-live")).toBe("1");
  });
  it.each(["saveEmailSettings", "testEmailSettings"] as const)(
    "%s sends the fresh structured draft as active session activity",
    async (method) => {
      const { api, requests } = client(
        method === "saveEmailSettings" ? { saved: true } : { accepted: true },
      );
      await api.background[method](draft);
      const request = requests[0]!;
      expect(request.path).toBe(
        `/box/management-api/email/settings${method === "testEmailSettings" ? "/test" : ""}`,
      );
      expect(request.init.method).toBe(method === "testEmailSettings" ? "POST" : "PUT");
      expect(request.init.credentials).toBe("include");
      expect(JSON.parse(request.init.body as string)).toEqual({
        server: "smtp.example.test",
        port: 465,
        encryption: "tls",
        user: "invoice-user",
        password: "fresh-secret",
        from: "invoices@example.test",
      });
      expect(new Headers(request.init.headers).get("x-waitron-live")).toBeNull();
    },
  );
  it.each(["email.test_refused", "email.test_timeout"])(
    "keeps a %s result distinct from acceptance",
    async (code) => {
      const { api } = client({ accepted: false, code });
      expect(await api.testEmailSettings(draft)).toEqual({ accepted: false, code });
    },
  );
  it("carries a field refusal to the editor", async () => {
    const { api } = client(
      { error: { code: "email.settings_invalid", params: { field: "from" } } },
      400,
    );
    await expect(api.saveEmailSettings(draft)).rejects.toEqual({
      code: "email.settings_invalid",
      params: { field: "from" },
      status: 400,
    });
  });
});
