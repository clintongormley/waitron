import { describe, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import { fakeClient, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { readAuthorityTime } from "./authority-time.js";
import { VerifactuBackend } from "./backend.js";

vi.mock("./authority-time.js", () => ({ readAuthorityTime: vi.fn() }));

describe("the Veri*Factu backend's reading of the authority's time", () => {
  it("asks for the time of the deployment it records for", async () => {
    const sample = { authorityMs: 1, uncertaintyMs: 2, at: { wallMs: 3, monoMs: 4 } };
    vi.mocked(readAuthorityTime).mockResolvedValueOnce(sample);
    const backend = new VerifactuBackend({
      deploymentEnvironment: "preproduction",
      environment: "production",
      clock: steadyClock,
      db: {} as Database,
      resolveClient: staticResolver(fakeClient),
    });
    expect(await backend.readAuthorityTime()).toBe(sample);
    expect(readAuthorityTime).toHaveBeenCalledWith("preproduction");
  });
});
