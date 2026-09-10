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
    scanBluetooth: async () => [],
    pairBluetooth: async () => ({ ok: false, error: "no fake" }),
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
    // No Save button — the locked address form is read-only. (The Bluetooth card's Scan button is a
    // separate, always-present action, so the assertion targets the Save action specifically.)
    expect(html).not.toContain(">Save</button>");
  });
});

describe("createSetupApp — Bluetooth pairing", () => {
  it("GET / shows the Bluetooth card with a Scan button", async () => {
    const app = createSetupApp(deps());
    const html = await (await app.request("/")).text();
    expect(html).toContain("Bluetooth printers");
    expect(html).toContain('action="/bluetooth/scan"');
    expect(html).toContain("Scan for printers");
  });

  it("POST /bluetooth/scan lists found devices with a Pair button per device", async () => {
    const scanBluetooth = vi.fn(async () => [
      { transport: "bluetooth" as const, localKey: "AA:BB:CC:DD:EE:FF", name: "Star TSP100" },
    ]);
    const app = createSetupApp(deps({ scanBluetooth }));
    const res = await app.request("/bluetooth/scan", { method: "POST" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(scanBluetooth).toHaveBeenCalledOnce();
    expect(html).toContain("Star TSP100");
    expect(html).toContain("AA:BB:CC:DD:EE:FF");
    expect(html).toContain('action="/bluetooth/pair"');
    expect(html).toContain('value="AA:BB:CC:DD:EE:FF"');
  });

  it("POST /bluetooth/scan with no devices says so", async () => {
    const app = createSetupApp(deps({ scanBluetooth: async () => [] }));
    const html = await (await app.request("/bluetooth/scan", { method: "POST" })).text();
    expect(html).toContain("No Bluetooth printers found");
  });

  it("POST /bluetooth/pair pairs the MAC and shows success", async () => {
    const pairBluetooth = vi.fn(async () => ({ ok: true, localKey: "AA:BB:CC:DD:EE:FF" }));
    const app = createSetupApp(deps({ pairBluetooth }));
    const res = await app.request("/bluetooth/pair", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "mac=AA%3ABB%3ACC%3ADD%3AEE%3AFF",
    });
    expect(res.status).toBe(200);
    expect(pairBluetooth).toHaveBeenCalledWith("AA:BB:CC:DD:EE:FF");
    expect(await res.text()).toContain("Paired AA:BB:CC:DD:EE:FF");
  });

  it("POST /bluetooth/pair shows the failure reason when pairing fails", async () => {
    const app = createSetupApp(
      deps({ pairBluetooth: async () => ({ ok: false, error: "AuthenticationFailed" }) }),
    );
    const res = await app.request("/bluetooth/pair", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "mac=AA%3ABB%3ACC%3ADD%3AEE%3AFF",
    });
    const html = await res.text();
    expect(html).toContain("Could not pair AA:BB:CC:DD:EE:FF");
    expect(html).toContain("AuthenticationFailed");
  });

  it("POST /bluetooth/pair with no MAC returns 400 and pairs nothing", async () => {
    const pairBluetooth = vi.fn(async () => ({ ok: true, localKey: "x" }));
    const app = createSetupApp(deps({ pairBluetooth }));
    const res = await app.request("/bluetooth/pair", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "mac=",
    });
    expect(res.status).toBe(400);
    expect(pairBluetooth).not.toHaveBeenCalled();
  });

  it("escapes a Bluetooth device name so it cannot inject markup", async () => {
    const app = createSetupApp(
      deps({
        scanBluetooth: async () => [
          { transport: "bluetooth", localKey: "AA:BB:CC:DD:EE:FF", name: "<script>x</script>" },
        ],
      }),
    );
    const html = await (await app.request("/bluetooth/scan", { method: "POST" })).text();
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
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
