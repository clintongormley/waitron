import { describe, expect, it, vi } from "vitest";
import type { SignedMembershipDocument } from "@waitron/membership";
import { createOriginAllowlist } from "./allowed-origins.js";

function doc(urls: string[]): SignedMembershipDocument {
  return {
    body: { term: 1, nodes: urls.map((u, i) => ({ nodeId: `n${i}`, contactUrl: u, standing: "serving-secondary" })) },
    signerNodeId: "n0",
    signature: "s",
    endorsements: [],
  };
}

describe("createOriginAllowlist", () => {
  it("allows the advertised origin and every contactUrl origin, and nothing else", async () => {
    const allow = createOriginAllowlist({
      advertisedOrigin: "https://box.deli.test",
      readMembership: () => Promise.resolve(doc(["https://cloud.deli.test/", ""])),
      devMode: false,
      now: () => 0,
    });
    expect(await allow("https://box.deli.test")).toBe(true);
    expect(await allow("https://cloud.deli.test")).toBe(true);
    expect(await allow("https://evil.example")).toBe(false);
    expect(await allow("http://cloud.deli.test")).toBe(false); // scheme is part of an origin
  });

  it("re-reads the document only after the TTL", async () => {
    let t = 0;
    const read = vi.fn().mockResolvedValue(doc(["https://cloud.deli.test"]));
    const allow = createOriginAllowlist({ advertisedOrigin: "https://box.deli.test", readMembership: read, devMode: false, now: () => t, ttlMs: 30_000 });
    await allow("https://cloud.deli.test");
    await allow("https://cloud.deli.test");
    expect(read).toHaveBeenCalledTimes(1);
    t = 30_001;
    await allow("https://cloud.deli.test");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("allows the three Vite dev origins only in devMode", async () => {
    const base = { advertisedOrigin: "http://localhost:8080", readMembership: () => Promise.resolve(null), now: () => 0 };
    expect(await createOriginAllowlist({ ...base, devMode: true })("http://localhost:5190")).toBe(true);
    expect(await createOriginAllowlist({ ...base, devMode: false })("http://localhost:5190")).toBe(false);
  });
});
