import { describe, expect, it } from "vitest";
import {
  NETWORK_TIMINGS_MS,
  createNetworkState,
  networkStatus,
  nextNetworkStep,
} from "./installer-network.mjs";

const VENUE_HEX = "56656e7565";
const OTHER_HEX = "4f74726f";

const link = (atMs, internet) => ({ kind: "link", atMs, internet });
const tick = (atMs) => ({ kind: "tick", atMs });
const joinRequested = (atMs, ssidHex = VENUE_HEX) => ({ kind: "join-requested", atMs, ssidHex });
const joinResult = (atMs, ok) => ({ kind: "join-result", atMs, ok });

/** @param {object[]} events @param {number} [atMs] */
function play(events, atMs = 0) {
  let state = createNetworkState({ atMs });
  return events.map((event) => {
    const decision = nextNetworkStep(state, event);
    state = decision.state;
    return decision;
  });
}
/** @param {any[]} decisions */
const actions = (decisions) => decisions.map((d) => d.action);
/** @param {any[]} decisions */
const final = (decisions) => decisions[decisions.length - 1];
/** @param {() => unknown} run */
function thrown(run) {
  try {
    run();
  } catch (error) {
    return { code: /** @type {any} */ (error).code, reason: /** @type {any} */ (error).reason };
  }
  return null;
}

/** No internet at start, hotspot open at 60000. */
const HOTSPOT_OPEN = [link(0, false), tick(60_000)];

describe("timings", () => {
  it("are the spec's one minute each, frozen", () => {
    expect(NETWORK_TIMINGS_MS).toEqual({
      hotspotAfter: 60_000,
      retryEvery: 60_000,
      joinWithin: 60_000,
    });
    expect(Object.isFrozen(NETWORK_TIMINGS_MS)).toBe(true);
  });
});

describe("creating the state", () => {
  it("starts probing, with the hotspot due one minute later and no failure", () => {
    const state = createNetworkState({ atMs: 5_000 });
    expect(state).toEqual({ phase: "probing", atMs: 5_000, deadlineMs: 65_000, failure: null });
    expect(Object.isFrozen(state)).toBe(true);
    expect(networkStatus(state)).toEqual({ stage: "probing", failure: null });
  });

  for (const [name, options] of /** @type {[string, unknown][]} */ ([
    ["no options", undefined],
    ["null", null],
    ["an array", [0]],
    ["no atMs", {}],
    ["an extra key", { atMs: 0, ssidHex: VENUE_HEX }],
    ["a negative atMs", { atMs: -1 }],
    ["a fractional atMs", { atMs: 1.5 }],
    ["a string atMs", { atMs: "0" }],
  ]))
    it(`refuses ${name} with installer_network.options_invalid`, () => {
      expect(thrown(() => createNetworkState(options))).toEqual({
        code: "installer_network.options_invalid",
        reason: "options-invalid",
      });
    });
});

describe("a cable with internet", () => {
  it("link internet true at 0 → continue; ticks after that → wait, and no open-hotspot in the run", () => {
    const decisions = play([link(0, true), tick(60_000), tick(120_000), tick(600_000)]);
    expect(actions(decisions)).toEqual(["continue", "wait", "wait", "wait"]);
    expect(decisions[0]).toEqual({
      action: "continue",
      ssidHex: null,
      deadlineMs: null,
      state: { phase: "online", atMs: 0, deadlineMs: null, failure: null },
    });
    expect(networkStatus(final(decisions).state)).toEqual({ stage: "online", failure: null });
  });

  it("online answers wait to every event, a join request included", () => {
    const decisions = play([
      link(0, true),
      link(1_000, false),
      joinRequested(2_000),
      joinResult(3_000, false),
      link(4_000, true),
    ]);
    expect(actions(decisions)).toEqual(["continue", "wait", "wait", "wait", "wait"]);
    expect(final(decisions).state.phase).toBe("online");
  });
});

describe("a cable with no internet", () => {
  it("link internet false at 0, ticks to 59999 → wait; tick at 60000 → open-hotspot", () => {
    const decisions = play([link(0, false), tick(30_000), tick(59_999), tick(60_000)]);
    expect(actions(decisions)).toEqual(["wait", "wait", "wait", "open-hotspot"]);
    expect(decisions[2].deadlineMs).toBe(60_000);
    expect(decisions[3]).toEqual({
      action: "open-hotspot",
      ssidHex: null,
      deadlineMs: 120_000,
      state: { phase: "hotspot", atMs: 60_000, deadlineMs: 120_000, failure: null },
    });
  });

  it("ticks at 120000, 180000 → probe each time (retry every minute)", () => {
    const decisions = play([
      ...HOTSPOT_OPEN,
      tick(119_999),
      tick(120_000),
      tick(150_000),
      tick(180_000),
    ]);
    expect(actions(decisions)).toEqual(["wait", "open-hotspot", "wait", "probe", "wait", "probe"]);
    expect(decisions[3].deadlineMs).toBe(180_000);
    expect(decisions[5].deadlineMs).toBe(240_000);
    expect(decisions[5].state.phase).toBe("hotspot");
  });

  it("a probe found late still counts, the next one a minute after the late tick", () => {
    const decisions = play([...HOTSPOT_OPEN, tick(200_000)]);
    expect(final(decisions).action).toBe("probe");
    expect(final(decisions).deadlineMs).toBe(260_000);
  });

  it("link internet false while the hotspot is open → wait", () => {
    const decisions = play([...HOTSPOT_OPEN, link(90_000, false)]);
    expect(final(decisions).action).toBe("wait");
    expect(final(decisions).state.phase).toBe("hotspot");
  });

  it("a cable plugged in at 150000: link internet true → continue", () => {
    const decisions = play([...HOTSPOT_OPEN, tick(120_000), link(150_000, true)]);
    expect(final(decisions).action).toBe("continue");
    expect(final(decisions).state).toEqual({
      phase: "online",
      atMs: 150_000,
      deadlineMs: null,
      failure: null,
    });
  });

  it("a phone's USB tethering reported as link internet true while the hotspot is open → continue", () => {
    const decisions = play([...HOTSPOT_OPEN, link(75_000, true)]);
    expect(final(decisions).action).toBe("continue");
  });
});

describe("joining a Wi-Fi network from the hotspot's page", () => {
  it(`join-requested "${VENUE_HEX}" at 70000 → join with ssidHex "${VENUE_HEX}", deadline 130000`, () => {
    const decisions = play([...HOTSPOT_OPEN, joinRequested(70_000)]);
    expect(final(decisions)).toEqual({
      action: "join",
      ssidHex: VENUE_HEX,
      deadlineMs: 130_000,
      state: { phase: "joining", atMs: 70_000, deadlineMs: 130_000, failure: null },
    });
  });

  it("join-result false → open-hotspot, failure join-failed", () => {
    const decisions = play([...HOTSPOT_OPEN, joinRequested(70_000), joinResult(80_000, false)]);
    expect(final(decisions)).toEqual({
      action: "open-hotspot",
      ssidHex: null,
      deadlineMs: 140_000,
      state: { phase: "hotspot", atMs: 80_000, deadlineMs: 140_000, failure: "join-failed" },
    });
    expect(networkStatus(final(decisions).state)).toEqual({
      stage: "hotspot",
      failure: "join-failed",
    });
  });

  it("then join-requested again, join-result true, link internet true → continue, and networkStatus's failure is null", () => {
    const decisions = play([
      ...HOTSPOT_OPEN,
      joinRequested(70_000),
      joinResult(80_000, false),
      joinRequested(90_000, OTHER_HEX),
      joinResult(95_000, true),
      link(100_000, true),
    ]);
    expect(actions(decisions)).toEqual([
      "wait",
      "open-hotspot",
      "join",
      "open-hotspot",
      "join",
      "probe",
      "continue",
    ]);
    expect(decisions[4].ssidHex).toBe(OTHER_HEX);
    expect(decisions[4].state.failure).toBe("join-failed");
    expect(decisions[5].state).toEqual({
      phase: "joined",
      atMs: 95_000,
      deadlineMs: 150_000,
      failure: "join-failed",
    });
    expect(networkStatus(final(decisions).state)).toEqual({ stage: "online", failure: null });
  });

  it("join-result true, then no internet until 130000 → open-hotspot, failure no-internet", () => {
    const decisions = play([
      ...HOTSPOT_OPEN,
      joinRequested(70_000),
      joinResult(75_000, true),
      link(80_000, false),
      tick(129_999),
      tick(130_000),
    ]);
    expect(actions(decisions)).toEqual([
      "wait",
      "open-hotspot",
      "join",
      "probe",
      "wait",
      "wait",
      "open-hotspot",
    ]);
    expect(final(decisions)).toEqual({
      action: "open-hotspot",
      ssidHex: null,
      deadlineMs: 190_000,
      state: { phase: "hotspot", atMs: 130_000, deadlineMs: 190_000, failure: "no-internet" },
    });
  });

  it("join-result never arrives: tick at 130000 → open-hotspot, failure join-failed", () => {
    const decisions = play([...HOTSPOT_OPEN, joinRequested(70_000), tick(129_999), tick(130_000)]);
    expect(actions(decisions)).toEqual(["wait", "open-hotspot", "join", "wait", "open-hotspot"]);
    expect(final(decisions).state).toEqual({
      phase: "hotspot",
      atMs: 130_000,
      deadlineMs: 190_000,
      failure: "join-failed",
    });
  });

  it("internet reported while joining → continue", () => {
    const decisions = play([...HOTSPOT_OPEN, joinRequested(70_000), link(72_000, true)]);
    expect(final(decisions).action).toBe("continue");
    expect(final(decisions).state.phase).toBe("online");
  });

  it("join-requested while probing → wait (no form is offered before the hotspot opens)", () => {
    const decisions = play([link(0, false), joinRequested(10_000)]);
    expect(actions(decisions)).toEqual(["wait", "wait"]);
    expect(final(decisions).state.phase).toBe("probing");
    expect(final(decisions).ssidHex).toBeNull();
  });

  it("a second join-requested while joining → wait, still joining the first", () => {
    const decisions = play([
      ...HOTSPOT_OPEN,
      joinRequested(70_000),
      joinRequested(71_000, OTHER_HEX),
    ]);
    expect(final(decisions).action).toBe("wait");
    expect(final(decisions).ssidHex).toBeNull();
    expect(final(decisions).state.deadlineMs).toBe(130_000);
  });

  it("join-result outside joining → wait", () => {
    const fromProbing = play([joinResult(1_000, true)]);
    const fromHotspot = play([...HOTSPOT_OPEN, joinResult(70_000, false)]);
    const fromJoined = play([
      ...HOTSPOT_OPEN,
      joinRequested(70_000),
      joinResult(75_000, true),
      joinResult(76_000, false),
    ]);
    expect(final(fromProbing)).toMatchObject({ action: "wait", state: { phase: "probing" } });
    expect(final(fromHotspot)).toMatchObject({
      action: "wait",
      state: { phase: "hotspot", failure: null },
    });
    expect(final(fromJoined)).toMatchObject({ action: "wait", state: { phase: "joined" } });
  });
});

describe("the Wi-Fi password never enters the decisions", () => {
  it("join-requested with a password key → throws installer_network.event_invalid", () => {
    const state = play(HOTSPOT_OPEN)[1].state;
    expect(
      thrown(() => nextNetworkStep(state, { ...joinRequested(70_000), password: "correct horse" })),
    ).toEqual({ code: "installer_network.event_invalid", reason: "event-invalid" });
  });

  for (const [name, ssidHex] of /** @type {[string, unknown][]} */ ([
    ["empty", ""],
    ["not hex", "5G"],
    ["33 bytes", "61".repeat(33)],
    ["upper-case hex", "56656E7565"],
    ["an odd number of digits", "565"],
    ["not a string", 0x56],
  ]))
    it(`ssidHex ${name} → throws installer_network.event_invalid`, () => {
      const state = play(HOTSPOT_OPEN)[1].state;
      expect(thrown(() => nextNetworkStep(state, joinRequested(70_000, ssidHex)))).toEqual({
        code: "installer_network.event_invalid",
        reason: "event-invalid",
      });
    });

  it("ssidHex of 32 bytes is accepted", () => {
    const decisions = play([...HOTSPOT_OPEN, joinRequested(70_000, "61".repeat(32))]);
    expect(final(decisions).ssidHex).toBe("61".repeat(32));
  });

  it("networkStatus has exactly stage and failure, and never holds the ssidHex", () => {
    const decisions = play([...HOTSPOT_OPEN, joinRequested(70_000)]);
    const status = networkStatus(final(decisions).state);
    expect(Object.keys(status).sort()).toEqual(["failure", "stage"]);
    expect(status).toEqual({ stage: "joining", failure: null });
    expect(JSON.stringify(status)).not.toContain(VENUE_HEX);
    expect(Object.isFrozen(status)).toBe(true);
  });

  it("no state keeps the ssidHex", () => {
    const decisions = play([...HOTSPOT_OPEN, joinRequested(70_000), joinResult(75_000, true)]);
    for (const decision of decisions)
      expect(JSON.stringify(decision.state)).not.toContain(VENUE_HEX);
  });
});

describe("refusals for a caller's mistakes", () => {
  const fresh = () => createNetworkState({ atMs: 1_000 });

  for (const [name, event] of /** @type {[string, unknown][]} */ ([
    ["no event", undefined],
    ["null", null],
    ["an unknown kind", { kind: "online", atMs: 1_000 }],
    ["a tick with an extra key", { kind: "tick", atMs: 1_000, internet: true }],
    ["a link without internet", { kind: "link", atMs: 1_000 }],
    ["a link whose internet is not a boolean", link(1_000, "yes")],
    ["a join-result whose ok is not a boolean", joinResult(1_000, 1)],
    ["a join-result with an ssidHex", { ...joinResult(1_000, true), ssidHex: VENUE_HEX }],
    ["a negative atMs", tick(-1)],
    ["a fractional atMs", tick(1_000.5)],
    ["a missing atMs", { kind: "tick" }],
  ]))
    it(`refuses ${name} with installer_network.event_invalid`, () => {
      expect(thrown(() => nextNetworkStep(fresh(), event))).toEqual({
        code: "installer_network.event_invalid",
        reason: "event-invalid",
      });
    });

  it("refuses an event earlier than the state with time-backwards", () => {
    expect(thrown(() => nextNetworkStep(fresh(), tick(999)))).toEqual({
      code: "installer_network.event_invalid",
      reason: "time-backwards",
    });
  });

  it("accepts an event at the state's own time", () => {
    expect(nextNetworkStep(fresh(), tick(1_000)).action).toBe("wait");
  });

  for (const [name, made] of /** @type {[string, () => unknown][]} */ ([
    ["a hand-made copy", () => ({ ...fresh() })],
    ["null", () => null],
    ["a string", () => "probing"],
  ])) {
    it(`nextNetworkStep refuses ${name} as a state with installer_network.state_invalid`, () => {
      expect(thrown(() => nextNetworkStep(made(), tick(2_000)))).toEqual({
        code: "installer_network.state_invalid",
        reason: "state-invalid",
      });
    });
    it(`networkStatus refuses ${name} as a state with installer_network.state_invalid`, () => {
      expect(thrown(() => networkStatus(made()))).toEqual({
        code: "installer_network.state_invalid",
        reason: "state-invalid",
      });
    });
  }

  it("every decision and state is frozen, and each state is accepted back", () => {
    const decisions = play([
      ...HOTSPOT_OPEN,
      joinRequested(70_000),
      joinResult(75_000, true),
      link(80_000, true),
    ]);
    for (const decision of decisions) {
      expect(Object.isFrozen(decision)).toBe(true);
      expect(Object.isFrozen(decision.state)).toBe(true);
      expect(networkStatus(decision.state).stage).toBe(decision.state.phase);
    }
  });
});
