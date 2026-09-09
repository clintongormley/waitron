import type { AgentConfig, AgentStatus } from "@waitron/print-agent";
import { describe, expect, it, vi } from "vitest";
import { createSetupApp, type SetupDeps } from "./setup-page.js";

function deps(overrides: Partial<SetupDeps> = {}): SetupDeps {
  return {
    status: () => ({ phase: "unconfigured", serverUrl: null, current: null }),
    config: async () => null,
    saveConfig: async () => {},
    envLocked: false,
    defaultName: "kitchen-pi",
    ...overrides,
  };
}

describe("createSetupApp — GET /", () => {
  it("unconfigured renders the server-address form with the default name prefilled", async () => {
    const app = createSetupApp(deps());
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('name="serverUrl"');
    expect(html).toContain('name="name"');
    expect(html).toContain('value="kitchen-pi"');
  });

  it("pending shows the verification code when the agent still holds it", async () => {
    const status: AgentStatus = {
      phase: "pending",
      serverUrl: "https://box.test",
      current: "https://box.test",
      verificationCode: "42",
    };
    const app = createSetupApp(deps({ status: () => status }));
    const html = await (await app.request("/")).text();
    expect(html).toContain("Waiting for approval");
    expect(html).toContain("verification code");
    expect(html).toContain("42");
  });

  it("pending with no code (state wiped) waits truthfully, without the false 'restart for a fresh code' claim", async () => {
    const status: AgentStatus = { phase: "pending", serverUrl: "https://box.test", current: null };
    const app = createSetupApp(deps({ status: () => status }));
    const html = await (await app.request("/")).text();
    expect(html).toContain("Waiting for approval");
    expect(html).not.toContain("restart to get a fresh code");
    expect(html).not.toContain("verification code");
  });

  it("pairing_closed asks the manager to switch on pairing mode", async () => {
    const status: AgentStatus = {
      phase: "pairing_closed",
      serverUrl: "https://box.test",
      current: "https://box.test",
    };
    const app = createSetupApp(deps({ status: () => status }));
    const html = await (await app.request("/")).text();
    expect(html).toContain("switch on pairing mode");
    expect(html).toContain("this agent keeps asking");
  });

  it("running shows the followed server, the last job time and the last error", async () => {
    const status: AgentStatus = {
      phase: "running",
      serverUrl: "https://box.test",
      current: "https://box.test",
      lastJobAt: Date.parse("2026-09-09T10:00:00Z"),
      lastError: "network_tcp printer p1 timed out",
    };
    const app = createSetupApp(deps({ status: () => status }));
    const html = await (await app.request("/")).text();
    expect(html).toContain("https://box.test");
    expect(html).toContain("Last job");
    expect(html).toContain("Last error");
    expect(html).toContain("network_tcp printer p1 timed out");
  });

  it("running with no jobs yet does not claim a last job or a last error", async () => {
    const status: AgentStatus = {
      phase: "running",
      serverUrl: "https://box.test",
      current: "https://box.test",
    };
    const app = createSetupApp(deps({ status: () => status }));
    const html = await (await app.request("/")).text();
    expect(html).not.toContain("Last error");
  });

  it("unauthorized says the agent was denied or revoked and must be restarted", async () => {
    const status: AgentStatus = {
      phase: "unauthorized",
      serverUrl: "https://box.test",
      current: "https://box.test",
    };
    const app = createSetupApp(deps({ status: () => status }));
    const html = await (await app.request("/")).text();
    expect(html).toContain("denied or revoked");
    expect(html).toContain("restart it to ask to join again");
  });

  it("unreachable says it cannot reach the server and shows the error", async () => {
    const status: AgentStatus = {
      phase: "unreachable",
      serverUrl: "https://box.test",
      current: "https://box.test",
      lastError: "ECONNREFUSED",
    };
    const app = createSetupApp(deps({ status: () => status }));
    const html = await (await app.request("/")).text();
    expect(html.toLowerCase()).toContain("reach");
    expect(html).toContain("ECONNREFUSED");
  });

  it("unreachable with no error yet still renders, without an error line", async () => {
    const status: AgentStatus = {
      phase: "unreachable",
      serverUrl: "https://box.test",
      current: "https://box.test",
    };
    const app = createSetupApp(deps({ status: () => status }));
    const html = await (await app.request("/")).text();
    expect(html.toLowerCase()).toContain("reach");
    expect(html).not.toContain('class="muted"');
  });

  it("escapes a lastError so a server-sent message cannot inject markup", async () => {
    const status: AgentStatus = {
      phase: "unreachable",
      serverUrl: "https://box.test",
      current: null,
      lastError: "<script>alert(1)</script>",
    };
    const app = createSetupApp(deps({ status: () => status }));
    const html = await (await app.request("/")).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("createSetupApp — POST /setup", () => {
  it("saves { serverUrl, name } origin-normalised and redirects to /", async () => {
    const saveConfig = vi.fn<(c: AgentConfig) => Promise<void>>(async () => {});
    const app = createSetupApp(deps({ saveConfig }));
    const res = await app.request("/setup", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "serverUrl=https%3A%2F%2Fbox.test%2F&name=Barra",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(saveConfig).toHaveBeenCalledWith({ serverUrl: "https://box.test", name: "Barra" });
  });

  it("falls back to the default name when the form leaves it blank", async () => {
    const saveConfig = vi.fn<(c: AgentConfig) => Promise<void>>(async () => {});
    const app = createSetupApp(deps({ saveConfig, defaultName: "kitchen-pi" }));
    await app.request("/setup", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "serverUrl=https%3A%2F%2Fbox.test&name=",
    });
    expect(saveConfig).toHaveBeenCalledWith({ serverUrl: "https://box.test", name: "kitchen-pi" });
  });

  it("re-renders the form with an error and saves nothing on a bad url", async () => {
    const saveConfig = vi.fn<(c: AgentConfig) => Promise<void>>(async () => {});
    const app = createSetupApp(deps({ saveConfig }));
    const res = await app.request("/setup", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "serverUrl=not-a-url&name=Barra",
    });
    expect(res.status).toBe(400);
    expect(saveConfig).not.toHaveBeenCalled();
    expect(await res.text()).toContain('name="serverUrl"');
  });

  it("refuses the save (405) when the address is locked by env", async () => {
    const saveConfig = vi.fn<(c: AgentConfig) => Promise<void>>(async () => {});
    const app = createSetupApp(deps({ saveConfig, envLocked: true }));
    const res = await app.request("/setup", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "serverUrl=https%3A%2F%2Fevil.test&name=x",
    });
    expect(res.status).toBe(405);
    expect(saveConfig).not.toHaveBeenCalled();
  });

  it("shows the configured address read-only, without a save button, when env-locked", async () => {
    const app = createSetupApp(
      deps({ envLocked: true, config: async () => ({ serverUrl: "https://box.test", name: "n" }) }),
    );
    const html = await (await app.request("/")).text();
    expect(html).toContain("https://box.test");
    expect(html).not.toContain('<button type="submit"');
  });
});

describe("createSetupApp — GET /status.json", () => {
  it("returns the status as JSON with no token field", async () => {
    const status: AgentStatus = {
      phase: "running",
      serverUrl: "https://box.test",
      current: "https://box.test",
    };
    const app = createSetupApp(deps({ status: () => status }));
    const res = await app.request("/status.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual(status);
    expect(body).not.toHaveProperty("token");
  });
});
