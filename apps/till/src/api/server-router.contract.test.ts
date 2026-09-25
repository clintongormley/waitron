import { describe, expect, it, vi } from "vitest";
import { ServerRouter } from "./server-router.js";
import fixture from "./__fixtures__/node-probe.json";

// The till side of the till-reroute contract: the same three postures the server e2e drives
// (apps/server/src/till-reroute-e2e.test.ts), reading the same `/api/node` bodies from
// `__fixtures__/node-probe.json`, so a wire-shape change on one side fails the other. A is the page
// origin (BOX), B the cloud (CLOUD); the router keys on origin, so the fixture's nodeId values are
// irrelevant here.
const BOX = "https://box.deli.test";
const CLOUD = "https://cloud.deli.test";

type Answer = "down" | typeof fixture.aPrimary;

/** Answers each origin from the CURRENT round's table; "down" rejects like a dead host. */
function probeFetch(round: () => Record<string, Answer>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const answer = round()[url.origin];
    if (answer === undefined || answer === "down") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("ServerRouter — the till side of the two-node reroute contract", () => {
  it("follows the promotion the server e2e drives: stays on A, waits when A goes down, moves to B once B accepts sales", async () => {
    let table: Record<string, Answer> = { [BOX]: fixture.aPrimary, [CLOUD]: fixture.bStandby };
    const r = new ServerRouter({
      origin: BOX,
      fetchImpl: probeFetch(() => table),
      storage: memoryStorage(),
    });
    r.setServers([{ url: BOX }, { url: CLOUD }]);
    const moved = vi.fn();
    r.addEventListener("server-changed", moved);

    // Round 1: A primary, B standby.
    await r.probeNow();
    expect(r.current).toBe(BOX);
    expect(r.waiting).toBe(false);
    expect(moved).not.toHaveBeenCalled();

    // Round 2: A dead, B still standby. No server accepts sales, so the till holds its aim at A.
    table = { [BOX]: "down", [CLOUD]: fixture.bStandby };
    await r.probeNow();
    expect(r.current).toBe(BOX);
    expect(r.waiting).toBe(true);
    expect(moved).not.toHaveBeenCalled();

    // Round 3: A dead, B promoted.
    table = { [BOX]: "down", [CLOUD]: fixture.bPrimary };
    await r.probeNow();
    expect(r.current).toBe(CLOUD);
    expect(r.waiting).toBe(false);
    expect(moved).toHaveBeenCalledTimes(1);
    expect((moved.mock.calls[0]![0] as CustomEvent).detail).toEqual({ from: BOX, to: CLOUD });
  });
});
