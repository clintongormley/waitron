import { describe, expect, it, vi } from "vitest";
import type { SignedMembershipDocument } from "@waitron/membership";
import { createOriginAllowlist } from "./allowed-origins.js";

function doc(urls: string[]): SignedMembershipDocument {
  return {
    body: {
      term: 1,
      nodes: urls.map((u, i) => ({
        nodeId: `n${i}`,
        contactUrl: u,
        standing: "serving-secondary",
      })),
    },
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
    const allow = createOriginAllowlist({
      advertisedOrigin: "https://box.deli.test",
      readMembership: read,
      devMode: false,
      now: () => t,
      ttlMs: 30_000,
    });
    await allow("https://cloud.deli.test");
    await allow("https://cloud.deli.test");
    expect(read).toHaveBeenCalledTimes(1);
    t = 30_001;
    await allow("https://cloud.deli.test");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent cold-cache reads into a single membership read", async () => {
    let resolve!: (d: SignedMembershipDocument) => void;
    const read = vi.fn(() => new Promise<SignedMembershipDocument>((r) => (resolve = r)));
    const allow = createOriginAllowlist({
      advertisedOrigin: "https://box.deli.test",
      readMembership: read,
      devMode: false,
      now: () => 0,
    });
    const calls = Array.from({ length: 10 }, () => allow("https://cloud.deli.test"));
    resolve(doc(["https://cloud.deli.test"]));
    const results = await Promise.all(calls);
    // Single-flight: ten concurrent cold-cache callers share ONE in-flight read (§3.4 "at most once
    // per TTL"), not ten.
    expect(read).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r === true)).toBe(true);
  });

  it("does not let a slower older read clobber a newer cache entry", async () => {
    let t = 0;
    const deferred: ((d: SignedMembershipDocument) => void)[] = [];
    const withCloud = doc(["https://cloud.deli.test"]);
    const read = vi.fn(() => {
      // The first two reads are controlled deferreds, resolved out of order below; any later read
      // returns the current membership so a re-read cannot hang the test.
      if (deferred.length < 2) {
        return new Promise<SignedMembershipDocument>((r) => deferred.push(r));
      }
      return Promise.resolve(withCloud);
    });
    const allow = createOriginAllowlist({
      advertisedOrigin: "https://box.deli.test",
      readMembership: read,
      devMode: false,
      now: () => t,
      ttlMs: 10,
    });
    const first = allow("https://cloud.deli.test"); // cold read #1 (t=0): OLD membership, no cloud
    t = 100;
    const second = allow("https://cloud.deli.test"); // TTL elapsed → read #2 (t=100): NEW membership
    expect(read).toHaveBeenCalledTimes(2);
    deferred[1]!(withCloud); // the newer read resolves FIRST
    deferred[0]!(doc([])); // the older straggler resolves LAST
    await Promise.all([first, second]);
    t = 105; // still within read #2's TTL window (105 - 100 < 10)
    expect(await allow("https://cloud.deli.test")).toBe(true);
    // The straggler must not have reset the cache to its stale entry, which would force a re-read.
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("excludes an evicted node's origin but allows a serving secondary", async () => {
    const held: SignedMembershipDocument = {
      body: {
        term: 1,
        nodes: [
          { nodeId: "gone", contactUrl: "https://gone.deli.test", standing: "evicted" },
          { nodeId: "live", contactUrl: "https://cloud.deli.test", standing: "serving-secondary" },
        ],
      },
      signerNodeId: "n0",
      signature: "s",
      endorsements: [],
    };
    const allow = createOriginAllowlist({
      advertisedOrigin: "https://box.deli.test",
      readMembership: () => Promise.resolve(held),
      devMode: false,
      now: () => 0,
    });
    expect(await allow("https://cloud.deli.test")).toBe(true);
    expect(await allow("https://gone.deli.test")).toBe(false);
  });

  it("allows the three Vite dev origins only in devMode", async () => {
    const base = {
      advertisedOrigin: "http://localhost:8080",
      readMembership: () => Promise.resolve(null),
      now: () => 0,
    };
    expect(await createOriginAllowlist({ ...base, devMode: true })("http://localhost:5190")).toBe(
      true,
    );
    expect(await createOriginAllowlist({ ...base, devMode: false })("http://localhost:5190")).toBe(
      false,
    );
  });
});
