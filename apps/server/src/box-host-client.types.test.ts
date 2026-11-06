import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  CHANGE_KINDS,
  CHANGE_REFUSALS,
  CHANGE_STATES,
  PARSER_REFUSALS,
  REPLY_REFUSALS,
  SCAN_SECURITY,
  START_SCREENS,
  TAG_OUTCOMES,
} from "../../../scripts/box/host-protocol.mjs";
import { WIFI_COPY_FAILURES, WIFI_COPY_STATES } from "../../../scripts/box/wifi-boot-copy.mjs";
import { WIFI_NO_COPY_REASONS } from "../../../scripts/box/wifi-record.mjs";
import {
  type BoxHostRequests,
  boxHostRequests,
  type ForgetChangeRefusal,
  type JoinChangeRefusal,
  type NetworkChange,
  type NetworkForgetRefusal,
  type NetworkJoinRefusal,
  type NetworkScanRefusal,
  type NetworkSnapshot,
  type ProtocolRefusal,
  type ScannedNetwork,
  type ScanSecurity,
  type StartScreen,
  type TagOutcome,
  type TagWriteRefusal,
  type WifiCopyFailure,
  type WifiCopyState,
  type WifiNoCopyReason,
} from "./box-host-client.js";
import { closeFakeBoxHosts, fakeBoxHost } from "./testing/fake-box-host.js";

afterEach(closeFakeBoxHosts);

const PERSON = { source: "person", person: "0b9c4a1e-6f1d-4c55-9a83-2f7d1e5c0a11" } as const;
const SERVER = { source: "server" } as const;

const START = ["dashboard", "till"] as const satisfies readonly StartScreen[];
const SECURITY = ["wpa-psk", "sae", "other"] as const satisfies readonly ScanSecurity[];
const OUTCOMES = ["written", "removed", "unchanged"] as const satisfies readonly TagOutcome[];
const KINDS = ["join", "forget"] as const satisfies readonly NetworkChange["kind"][];
const STATES = [
  "running",
  "applied",
  "refused",
] as const satisfies readonly NetworkChange["state"][];
const JOIN_CHANGE_REFUSALS = [
  "password-rejected",
  "network-not-found",
  "timed-out",
  "failed",
] as const satisfies readonly JoinChangeRefusal[];
const FORGET_CHANGE_REFUSALS = ["failed"] as const satisfies readonly ForgetChangeRefusal[];
const COPY_STATES = [
  "pending",
  "current",
  "absent",
  "failed",
] as const satisfies readonly WifiCopyState[];
const COPY_FAILURES = [
  "mount-unverified",
  "root-changed",
  "path-unsafe",
  "permissions-unsafe",
  "io-failed",
  "publication-unverified",
] as const satisfies readonly WifiCopyFailure[];
const NO_COPY_REASONS = [
  "cable-only",
  "open",
  "open-or-wep",
  "dynamic-wep",
  "owe",
  "enterprise",
  "unsupported-security",
  "password-unavailable",
  "password-not-printable",
  "password-too-long",
  "password-invalid",
] as const satisfies readonly WifiNoCopyReason[];
const PROTOCOL = [
  "request_invalid",
  "actor_invalid",
  "fields_invalid",
  "host_failed",
] as const satisfies readonly ProtocolRefusal[];
const SCAN_REFUSALS = [
  ...PROTOCOL,
  "busy",
  "no_wifi",
] as const satisfies readonly NetworkScanRefusal[];
const JOIN_REFUSALS = [
  ...PROTOCOL,
  "busy",
  "no_wifi",
] as const satisfies readonly NetworkJoinRefusal[];
const FORGET_REFUSALS = [
  ...PROTOCOL,
  "busy",
  "not_saved",
] as const satisfies readonly NetworkForgetRefusal[];
const TAG_REFUSALS = [
  ...PROTOCOL,
  "busy",
  "no_free_token",
  "header_unreadable",
  "no_space",
] as const satisfies readonly TagWriteRefusal[];

/**
 * The parser's refusals less `unknown_request` (answered as `unsupported`), plus `host_failed`,
 * which no exported list holds.
 */
const moduleProtocol = [
  ...PARSER_REFUSALS.filter((refusal) => refusal !== "unknown_request"),
  "host_failed",
];

describe("the server's types and the protocol's lists", () => {
  it("each union equals the test's literal list, and that list equals the module's", () => {
    expectTypeOf<(typeof START)[number]>().toEqualTypeOf<StartScreen>();
    expect([...START_SCREENS].sort()).toEqual([...START].sort());
    expectTypeOf<(typeof SECURITY)[number]>().toEqualTypeOf<ScanSecurity>();
    expect([...SCAN_SECURITY].sort()).toEqual([...SECURITY].sort());
    expectTypeOf<(typeof OUTCOMES)[number]>().toEqualTypeOf<TagOutcome>();
    expect([...TAG_OUTCOMES].sort()).toEqual([...OUTCOMES].sort());
    expectTypeOf<(typeof KINDS)[number]>().toEqualTypeOf<NetworkChange["kind"]>();
    expect([...CHANGE_KINDS].sort()).toEqual([...KINDS].sort());
    expectTypeOf<(typeof STATES)[number]>().toEqualTypeOf<NetworkChange["state"]>();
    expect([...CHANGE_STATES].sort()).toEqual([...STATES].sort());
    expectTypeOf<(typeof JOIN_CHANGE_REFUSALS)[number]>().toEqualTypeOf<JoinChangeRefusal>();
    expect([...CHANGE_REFUSALS.join].sort()).toEqual([...JOIN_CHANGE_REFUSALS].sort());
    expectTypeOf<(typeof FORGET_CHANGE_REFUSALS)[number]>().toEqualTypeOf<ForgetChangeRefusal>();
    expect([...CHANGE_REFUSALS.forget].sort()).toEqual([...FORGET_CHANGE_REFUSALS].sort());
    expectTypeOf<(typeof COPY_STATES)[number]>().toEqualTypeOf<WifiCopyState>();
    expect([...WIFI_COPY_STATES].sort()).toEqual([...COPY_STATES].sort());
    expectTypeOf<(typeof COPY_FAILURES)[number]>().toEqualTypeOf<WifiCopyFailure>();
    expect([...WIFI_COPY_FAILURES].sort()).toEqual([...COPY_FAILURES].sort());
    expectTypeOf<(typeof NO_COPY_REASONS)[number]>().toEqualTypeOf<WifiNoCopyReason>();
    expect([...WIFI_NO_COPY_REASONS].sort()).toEqual([...NO_COPY_REASONS].sort());
  });

  it("each request's refusals are the protocol's four plus that request's own list", () => {
    expectTypeOf<(typeof PROTOCOL)[number]>().toEqualTypeOf<ProtocolRefusal>();
    expect([...moduleProtocol].sort()).toEqual([...PROTOCOL].sort());
    expectTypeOf<(typeof SCAN_REFUSALS)[number]>().toEqualTypeOf<NetworkScanRefusal>();
    expect([...moduleProtocol, ...REPLY_REFUSALS["network.scan"]].sort()).toEqual(
      [...SCAN_REFUSALS].sort(),
    );
    expectTypeOf<(typeof JOIN_REFUSALS)[number]>().toEqualTypeOf<NetworkJoinRefusal>();
    expect([...moduleProtocol, ...REPLY_REFUSALS["network.join"]].sort()).toEqual(
      [...JOIN_REFUSALS].sort(),
    );
    expectTypeOf<(typeof FORGET_REFUSALS)[number]>().toEqualTypeOf<NetworkForgetRefusal>();
    expect([...moduleProtocol, ...REPLY_REFUSALS["network.forget"]].sort()).toEqual(
      [...FORGET_REFUSALS].sort(),
    );
    expectTypeOf<(typeof TAG_REFUSALS)[number]>().toEqualTypeOf<TagWriteRefusal>();
    expect([...moduleProtocol, ...REPLY_REFUSALS["tag.write"]].sort()).toEqual(
      [...TAG_REFUSALS].sort(),
    );
    expect(REPLY_REFUSALS["network.read"]).toEqual([]);
    expect(REPLY_REFUSALS["screen.read"]).toEqual([]);
    expect(REPLY_REFUSALS["screen.set"]).toEqual([]);
  });
});

describe("the reply values the parser freezes", () => {
  it("type each frozen object's fields readonly; the answer's own fields are a copy", () => {
    const write = (snapshot: NetworkSnapshot, network: ScannedNetwork): void => {
      // @ts-expect-error frozen
      snapshot.wired.connected = true;
      // @ts-expect-error frozen
      snapshot.wifi.savedSsidHex = null;
      // @ts-expect-error frozen
      snapshot.bootCopy.reason = null;
      if (snapshot.change !== null) {
        // @ts-expect-error frozen
        snapshot.change.ssidHex = SSID;
      }
      // @ts-expect-error frozen
      network.signal = 0;
      snapshot.change = null;
    };
    expectTypeOf(write).toBeFunction();
  });
});

interface RoundTrip {
  label: string;
  reply: string;
  call: (client: BoxHostRequests) => Promise<unknown>;
  expected: unknown;
}

const SSID = "4361666550657065";
const WIRED = { connected: true, address: "192.168.1.10" };
const WIFI = { connectedSsidHex: SSID, savedSsidHex: SSID };
const NO_COPY = { state: "current", reason: null, failure: null };

function snapshotTrip(label: string, change: object | null, bootCopy: object): RoundTrip {
  const value = { wired: WIRED, wifi: WIFI, change, bootCopy };
  return {
    label,
    reply: `${JSON.stringify({ ok: true, ...value })}\n`,
    call: (client) => client.networkRead(SERVER),
    expected: { available: true, ...value },
  };
}

function refusalTrips(
  method: string,
  refusals: readonly string[],
  call: RoundTrip["call"],
): RoundTrip[] {
  return refusals.map((refusal) => ({
    label: `${method} refused ${refusal}`,
    reply: `${JSON.stringify({ ok: false, reason: refusal })}\n`,
    call,
    expected: { available: false, reason: "refused", refusal },
  }));
}

const ROUND_TRIPS: RoundTrip[] = [
  ...NO_COPY_REASONS.map((reason) =>
    snapshotTrip(`bootCopy absent ${reason}`, null, { state: "absent", reason, failure: null }),
  ),
  ...COPY_FAILURES.map((failure) =>
    snapshotTrip(`bootCopy failed ${failure}`, null, { state: "failed", reason: null, failure }),
  ),
  ...COPY_STATES.map((state) =>
    snapshotTrip(`bootCopy ${state}`, null, {
      state,
      reason: state === "absent" ? "cable-only" : null,
      failure: state === "failed" ? "io-failed" : null,
    }),
  ),
  ...JOIN_CHANGE_REFUSALS.map((reason) =>
    snapshotTrip(
      `join refused ${reason}`,
      { kind: "join", ssidHex: SSID, state: "refused", reason },
      NO_COPY,
    ),
  ),
  ...FORGET_CHANGE_REFUSALS.map((reason) =>
    snapshotTrip(
      `forget refused ${reason}`,
      { kind: "forget", ssidHex: SSID, state: "refused", reason },
      NO_COPY,
    ),
  ),
  ...STATES.map((state) =>
    snapshotTrip(
      `join ${state}`,
      { kind: "join", ssidHex: SSID, state, reason: state === "refused" ? "failed" : null },
      NO_COPY,
    ),
  ),
  ...KINDS.map((kind) =>
    snapshotTrip(
      `${kind} running`,
      { kind, ssidHex: SSID, state: "running", reason: null },
      NO_COPY,
    ),
  ),
  ...SECURITY.map((security) => {
    const networks = [{ ssidHex: SSID, signal: 50, security }];
    return {
      label: `scan ${security}`,
      reply: `${JSON.stringify({ ok: true, networks })}\n`,
      call: (client: BoxHostRequests) => client.networkScan(PERSON),
      expected: { available: true, networks },
    };
  }),
  ...START.map((start) => ({
    label: `screen ${start}`,
    reply: `${JSON.stringify({ ok: true, start })}\n`,
    call: (client: BoxHostRequests) => client.screenRead(SERVER),
    expected: { available: true, start },
  })),
  ...OUTCOMES.map((tag) => ({
    label: `tag ${tag}`,
    reply: `${JSON.stringify({ ok: true, tag })}\n`,
    call: (client: BoxHostRequests) => client.tagWrite(null),
    expected: { available: true, tag },
  })),
  ...refusalTrips("networkRead", PROTOCOL, (client) => client.networkRead(SERVER)),
  ...refusalTrips("networkScan", SCAN_REFUSALS, (client) => client.networkScan(PERSON)),
  ...refusalTrips("networkJoin", JOIN_REFUSALS, (client) =>
    client.networkJoin(
      { ssidHex: SSID, keyMgmt: "wpa-psk", psk: "abcdefgh", hidden: false },
      PERSON,
    ),
  ),
  ...refusalTrips("networkForget", FORGET_REFUSALS, (client) =>
    client.networkForget({ ssidHex: SSID }, PERSON),
  ),
  ...refusalTrips("screenRead", PROTOCOL, (client) => client.screenRead(SERVER)),
  ...refusalTrips("screenSet", PROTOCOL, (client) => client.screenSet({ start: "till" }, PERSON)),
  ...refusalTrips("tagWrite", TAG_REFUSALS, (client) => client.tagWrite(null)),
];

describe("every listed value passes through the client", () => {
  it("answers each value, or refuses with each word, over one connection each", async () => {
    let reply = "";
    const host = await fakeBoxHost((_line, socket) => socket.end(reply));
    const client = boxHostRequests({ socketPath: host.path });
    let ran = 0;
    for (const trip of ROUND_TRIPS) {
      reply = trip.reply;
      expect(await trip.call(client), trip.label).toEqual(trip.expected);
      ran += 1;
    }
    // 21 boot-copy + 10 change + 3 security + 2 screens + 3 tag outcomes + 38 refusals.
    expect(ran).toBe(77);
    expect(host.connections()).toBe(77);
  });
});
