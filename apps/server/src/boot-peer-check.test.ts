import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createTcpServer, type AddressInfo, type Socket } from "node:net";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signEnvelope, type HandoverState } from "@waitron/handover";
import { AppError } from "@waitron/shared";
import {
  acceptMembershipDocument,
  generateNodeKeyPair,
  signDocumentBody,
  type AcceptResult,
  type NodeStanding,
  type RoutableServer,
  type SignedMembershipDocument,
  type TrustSet,
} from "@waitron/membership";
import {
  boxRefusal,
  askPeerStatus,
  postToBox,
  checkPeersAtStart,
  persistingAccept,
  type CheckPeersDeps,
} from "./boot-peer-check.js";
import * as boxTransport from "./mirror-bundle-fetch.js";
import type { PeerOperationStatus, PeerStatusBody } from "./peer-status-api.js";
import { freePorts } from "./testing/free-ports.js";
import {
  mintBoxAuthority,
  startBoxServer,
  type BoxAuthority,
  type BoxServer,
} from "./testing/box-authority.js";

const SELF = "m1";
const SPARE = "m2";
const OLD = "m0";
const OWN_ORIGIN = "https://box.local:8443";
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function chart(
  term: number,
  nodes: readonly [string, NodeStanding, string?][],
  revoked?: string[],
): SignedMembershipDocument {
  return {
    body: {
      term,
      nodes: nodes.map(([nodeId, standing, url]) => ({
        nodeId,
        standing,
        contactUrl: url ?? `https://${nodeId}.local`,
      })),
      ...(revoked === undefined ? {} : { revoked }),
    },
    signerNodeId: SELF,
    signature: "stand-in",
    endorsements: [],
  };
}

const HELD = chart(3, [
  [SELF, "serving-primary", OWN_ORIGIN],
  [SPARE, "serving-secondary"],
]);

function status(
  heldMembership: SignedMembershipDocument | null,
  openOperation: PeerOperationStatus | null = null,
): PeerStatusBody {
  return { heldMembership, restriction: null, openOperation, requestedOperation: null, nonce: "x" };
}

function operation(
  scenario: "controlled" | "emergency",
  state: HandoverState,
  sourceNodeId = SELF,
): PeerOperationStatus {
  return {
    operationId: OP,
    role: "destination",
    scenario,
    state,
    sourceNodeId,
    destinationNodeId: SPARE,
  };
}

/**
 * A stand-in for the real verify-and-persist: the term decides against the chart held before the
 * check, and an accepted chart is held when it is newer than the one held at that moment.
 */
function heldStore(initial: SignedMembershipDocument | null, untrusted = new Set<number>()) {
  let current = initial;
  const accept = vi.fn(async (doc: SignedMembershipDocument): Promise<AcceptResult> => {
    if (untrusted.has(doc.body.term))
      return { accepted: false, reason: "invalid", failure: "untrusted_signer" };
    if (initial !== null && doc.body.term <= initial.body.term)
      return { accepted: false, reason: "not_newer" };
    if (current === null || doc.body.term > current.body.term) current = doc;
    return { accepted: true, document: doc };
  });
  return { accept, held: () => current };
}

type Answers = Record<string, PeerStatusBody | null | "hang" | "throw">;

function deps(
  over: Partial<CheckPeersDeps> & { answers?: Answers; joinedIds?: string[] } = {},
): CheckPeersDeps & { asked: string[] } {
  const asked: string[] = [];
  const answers = over.answers ?? {};
  const joinedIds = new Set(over.joinedIds ?? [SPARE]);
  const store = heldStore(over.held ?? HELD);
  return {
    held: HELD,
    nodeId: SELF,
    ownOrigin: OWN_ORIGIN,
    joined: async (id) => joinedIds.has(id),
    activatedFrom: new Set(),
    ask: async (peer: RoutableServer) => {
      asked.push(peer.nodeId);
      const answer = answers[peer.nodeId] ?? null;
      if (answer === "hang") return new Promise<never>(() => {});
      if (answer === "throw") throw new Error("connection refused");
      return answer;
    },
    accept: store.accept,
    openOperation: false,
    timeoutMs: 50,
    ...over,
    asked,
  };
}

const NEWER_SERVING = chart(4, [
  [SELF, "serving-primary", OWN_ORIGIN],
  [SPARE, "serving-secondary"],
]);
const NEWER_FENCING = chart(4, [
  [SELF, "sell-only", OWN_ORIGIN],
  [SPARE, "serving-primary"],
]);
const SAME = HELD;

// M2's held chart after it activated: M1 (the source) is sell-only, still routable. Signed by
// another box, so only `activatedFrom` (not this box's own promotion chart) leaves M1 uncounted.
const M2_HELD = {
  ...chart(5, [
    [OLD, "sell-only"],
    [SELF, "serving-primary", OWN_ORIGIN],
  ]),
  signerNodeId: OLD,
};

describe("checkPeersAtStart — one case per cell of the decision table", () => {
  it("counted F → superseded", async () => {
    const d = deps({ answers: { [SPARE]: status(NEWER_FENCING) } });
    expect(await checkPeersAtStart(d)).toBe("superseded");
  });

  it("counted N → proceed, and the newer chart is held", async () => {
    const store = heldStore(HELD);
    const d = deps({ answers: { [SPARE]: status(NEWER_SERVING) }, accept: store.accept });
    expect(await checkPeersAtStart(d)).toBe("proceed");
    expect(store.held()).toBe(NEWER_SERVING);
  });

  it("counted = → proceed", async () => {
    const d = deps({ answers: { [SPARE]: status(SAME) } });
    expect(await checkPeersAtStart(d)).toBe("proceed");
  });

  it("counted S → wait", async () => {
    const d = deps({ answers: { [SPARE]: null } });
    expect(await checkPeersAtStart(d)).toBe("wait");
    expect(d.asked).toEqual([SPARE]);
  });

  const m2 = (answer: PeerStatusBody | null) =>
    deps({
      held: M2_HELD,
      activatedFrom: new Set([OLD]),
      joinedIds: [OLD],
      answers: { [OLD]: answer },
    });

  it("asked-only F → superseded", async () => {
    const fencing = chart(6, [
      [OLD, "serving-primary"],
      [SELF, "sell-only", OWN_ORIGIN],
    ]);
    expect(await checkPeersAtStart(m2(status(fencing)))).toBe("superseded");
  });

  it("asked-only N → proceed, and the newer chart is held", async () => {
    const newer = chart(6, [
      [OLD, "sell-only"],
      [SELF, "serving-primary", OWN_ORIGIN],
    ]);
    const store = heldStore(M2_HELD);
    const d = { ...m2(status(newer)), accept: store.accept };
    expect(await checkPeersAtStart(d)).toBe("proceed");
    expect(store.held()).toBe(newer);
  });

  it("asked-only = → proceed", async () => {
    expect(await checkPeersAtStart(m2(status(chart(2, [[OLD, "serving-primary"]]))))).toBe(
      "proceed",
    );
  });

  it("asked-only S → proceed (rule 3: no counted peer)", async () => {
    const d = m2(null);
    expect(await checkPeersAtStart(d)).toBe("proceed");
    expect(d.asked).toEqual([OLD]);
  });
});

describe("checkPeersAtStart — how the contributions combine", () => {
  const both = chart(5, [
    [OLD, "sell-only"],
    [SELF, "serving-primary", OWN_ORIGIN],
    [SPARE, "serving-secondary"],
  ]);

  it("counted S with asked-only = waits (rule 5)", async () => {
    const d = deps({
      held: both,
      activatedFrom: new Set([OLD]),
      joinedIds: [OLD, SPARE],
      answers: { [OLD]: status(both), [SPARE]: null },
    });
    expect(await checkPeersAtStart(d)).toBe("wait");
  });

  it("counted S with asked-only N waits, and the newer chart is held", async () => {
    const newer = chart(6, [
      [OLD, "sell-only"],
      [SELF, "serving-primary", OWN_ORIGIN],
      [SPARE, "serving-secondary"],
    ]);
    const store = heldStore(both);
    const d = deps({
      held: both,
      activatedFrom: new Set([OLD]),
      joinedIds: [OLD, SPARE],
      accept: store.accept,
      answers: { [OLD]: status(newer), [SPARE]: null },
    });
    expect(await checkPeersAtStart(d)).toBe("wait");
    expect(store.held()).toBe(newer);
  });

  it("counted = with asked-only F is superseded (rule 1)", async () => {
    const fencing = chart(6, [
      [OLD, "serving-primary"],
      [SELF, "evicted", OWN_ORIGIN],
      [SPARE, "serving-secondary"],
    ]);
    const d = deps({
      held: both,
      activatedFrom: new Set([OLD]),
      joinedIds: [OLD, SPARE],
      answers: { [OLD]: status(fencing), [SPARE]: status(both) },
    });
    expect(await checkPeersAtStart(d)).toBe("superseded");
  });

  it("an open operation with this box as source never proceeds (rule 2), even with = from the peer", async () => {
    const d = deps({ openOperation: true, answers: { [SPARE]: status(SAME) } });
    expect(await checkPeersAtStart(d)).toBe("wait");
  });

  it("an open source operation still yields to an F answer (rule 1 before rule 2)", async () => {
    const d = deps({ openOperation: true, answers: { [SPARE]: status(NEWER_FENCING) } });
    expect(await checkPeersAtStart(d)).toBe("superseded");
  });

  it("an open source operation with no chart at all waits (rule 2 before rule 3)", async () => {
    const d = deps({ held: null, openOperation: true });
    expect(await checkPeersAtStart(d)).toBe("wait");
  });

  it("a box with no chart and no open operation proceeds and asks nobody (rule 3)", async () => {
    const d = deps({ held: null });
    expect(await checkPeersAtStart(d)).toBe("proceed");
    expect(d.asked).toEqual([]);
  });

  it("one counted peer answering = is enough when another is silent (rule 4)", async () => {
    const three = chart(3, [
      [SELF, "serving-primary", OWN_ORIGIN],
      [SPARE, "serving-secondary"],
      ["m3", "serving-secondary"],
    ]);
    const d = deps({
      held: three,
      joinedIds: [SPARE, "m3"],
      answers: { [SPARE]: null, m3: status(three) },
    });
    expect(await checkPeersAtStart(d)).toBe("proceed");
  });
});

describe("checkPeersAtStart — what counts as silent", () => {
  it("a peer that never answers within the time limit is S", async () => {
    const d = deps({ answers: { [SPARE]: "hang" }, timeoutMs: 20 });
    expect(await checkPeersAtStart(d)).toBe("wait");
  });

  it("a peer whose ask throws (a refusal or a transport error) is S", async () => {
    const d = deps({ answers: { [SPARE]: "throw" } });
    expect(await checkPeersAtStart(d)).toBe("wait");
  });

  it("a peer at this box's own address is S without asking", async () => {
    const held = chart(3, [
      [SELF, "serving-primary", OWN_ORIGIN],
      [SPARE, "serving-secondary", `${OWN_ORIGIN}/`],
    ]);
    const d = deps({ held, answers: { [SPARE]: status(held) } });
    expect(await checkPeersAtStart(d)).toBe("wait");
    expect(d.asked).toEqual([]);
  });

  it("a peer whose address is not a URL is still asked, and its answer counts", async () => {
    const held = chart(3, [
      [SELF, "serving-primary", OWN_ORIGIN],
      [SPARE, "serving-secondary", "box two"],
    ]);
    const d = deps({ held, answers: { [SPARE]: status(held) } });
    expect(await checkPeersAtStart(d)).toBe("proceed");
    expect(d.asked).toEqual([SPARE]);
  });

  it("with no time limit given, an answer that comes promptly still counts", async () => {
    const d = deps({ answers: { [SPARE]: status(SAME) } });
    delete d.timeoutMs;
    expect(await checkPeersAtStart(d)).toBe("proceed");
  });

  it("a counted peer with an empty address is S without asking", async () => {
    const held = chart(3, [
      [SELF, "serving-primary", OWN_ORIGIN],
      [SPARE, "serving-secondary", ""],
    ]);
    const d = deps({ held, answers: { [SPARE]: status(held) } });
    expect(await checkPeersAtStart(d)).toBe("wait");
    expect(d.asked).toEqual([]);
  });

  it("a counted peer whose verified status holds no chart is S: the box waits", async () => {
    const d = deps({ answers: { [SPARE]: status(null) } });
    expect(await checkPeersAtStart(d)).toBe("wait");
  });

  it("an asked-only peer whose verified status holds no chart contributes nothing", async () => {
    const both = chart(5, [
      [OLD, "sell-only"],
      [SELF, "serving-primary", OWN_ORIGIN],
      [SPARE, "serving-secondary"],
    ]);
    const alone = deps({
      held: M2_HELD,
      joinedIds: [OLD],
      activatedFrom: new Set([OLD]),
      answers: { [OLD]: status(null) },
    });
    expect(await checkPeersAtStart(alone)).toBe("proceed");
    const withCounted = deps({
      held: both,
      joinedIds: [OLD, SPARE],
      activatedFrom: new Set([OLD]),
      answers: { [OLD]: status(null), [SPARE]: null },
    });
    expect(await checkPeersAtStart(withCounted)).toBe("wait");
  });

  it("a verified status with an untrusted chart but an operation naming this box at copy_accepted is F", async () => {
    const store = heldStore(HELD, new Set([4]));
    const d = deps({
      accept: store.accept,
      answers: { [SPARE]: status(NEWER_SERVING, operation("controlled", "copy_accepted")) },
    });
    expect(await checkPeersAtStart(d)).toBe("superseded");
    expect(store.held()).toBe(HELD);
  });

  it("control: the same untrusted chart with the operation at prepared counts as S", async () => {
    const store = heldStore(HELD, new Set([4]));
    const d = deps({
      accept: store.accept,
      answers: { [SPARE]: status(NEWER_SERVING, operation("controlled", "prepared")) },
    });
    expect(await checkPeersAtStart(d)).toBe("wait");
  });

  it("a peer that answers with a chart signed by an unknown key counts as no answer", async () => {
    const store = heldStore(HELD, new Set([4]));
    const d = deps({ answers: { [SPARE]: status(NEWER_SERVING) }, accept: store.accept });
    expect(await checkPeersAtStart(d)).toBe("wait");
    expect(store.held()).toBe(HELD);
  });

  it("a peer whose standing is evicted, or whose id is revoked, is not asked", async () => {
    const held = chart(
      3,
      [
        [SELF, "serving-primary", OWN_ORIGIN],
        [SPARE, "evicted"],
        ["m3", "serving-secondary"],
      ],
      ["m3"],
    );
    const d = deps({ held, joinedIds: [SPARE, "m3"] });
    expect(await checkPeersAtStart(d)).toBe("proceed");
    expect(d.asked).toEqual([]);
  });
});

describe("checkPeersAtStart — the review's cases", () => {
  it("a main box whose chart lists a pending spare at the same address, with no nodes row for it, proceeds and asks nobody", async () => {
    const held = chart(3, [
      [SELF, "serving-primary", OWN_ORIGIN],
      [SPARE, "serving-secondary", OWN_ORIGIN],
    ]);
    const d = deps({ held, joinedIds: [] });
    expect(await checkPeersAtStart(d)).toBe("proceed");
    expect(d.asked).toEqual([]);
  });

  it("control: the same chart with a nodes row for the spare and no answer waits", async () => {
    const held = chart(3, [
      [SELF, "serving-primary", OWN_ORIGIN],
      [SPARE, "serving-secondary", OWN_ORIGIN],
    ]);
    const d = deps({ held, joinedIds: [SPARE] });
    expect(await checkPeersAtStart(d)).toBe("wait");
  });

  it("a box with no node.db row but a chart that lists a joined spare waits (A1274)", async () => {
    // No node.db row: no open operation and nothing activated, so only the chart and venue.db speak.
    const d = deps({ openOperation: false, activatedFrom: new Set(), joinedIds: [SPARE] });
    expect(await checkPeersAtStart(d)).toBe("wait");
  });

  it("only the chart's own boxes are asked, and with the counted one silent no chart is offered for acceptance", async () => {
    const store = heldStore(HELD);
    const d = deps({ answers: { [SPARE]: null }, accept: store.accept });
    expect(await checkPeersAtStart(d)).toBe("wait");
    expect(d.asked).toEqual([SPARE]);
    expect(store.accept).not.toHaveBeenCalled();
  });

  it("a box that activated as destination does not count the operation's source, and proceeds with that source switched off", async () => {
    const d = deps({
      held: M2_HELD,
      joinedIds: [OLD],
      activatedFrom: new Set([OLD]),
      answers: { [OLD]: null },
    });
    expect(await checkPeersAtStart(d)).toBe("proceed");
    expect(d.asked).toEqual([OLD]);
  });

  it("control: the same chart and rows without the activated operation waits", async () => {
    const d = deps({ held: M2_HELD, joinedIds: [OLD], answers: { [OLD]: null } });
    expect(await checkPeersAtStart(d)).toBe("wait");
  });

  // This box's own promotion chart: it signed it, it is primary, the box it demoted is sell-only.
  const PROMOTED = chart(5, [
    [OLD, "sell-only"],
    [SELF, "serving-primary", OWN_ORIGIN],
  ]);

  it("a box restarted after its own promotion does not count the box it demoted, and proceeds with it switched off", async () => {
    const onAnswers = vi.fn();
    const d = deps({ held: PROMOTED, joinedIds: [OLD], answers: { [OLD]: null }, onAnswers });
    expect(await checkPeersAtStart(d)).toBe("proceed");
    expect(d.asked).toEqual([OLD]);
    expect(onAnswers.mock.calls[0]![0]).toEqual([
      { nodeId: OLD, answer: "S", counted: false, byOperation: false, why: "no_answer" },
    ]);
  });

  it("control: the same chart signed by another box counts the sell-only peer and waits", async () => {
    const d = deps({
      held: { ...PROMOTED, signerNodeId: SPARE },
      joinedIds: [OLD],
      answers: { [OLD]: null },
    });
    expect(await checkPeersAtStart(d)).toBe("wait");
  });

  it("control: a sell-only peer in a chart this box signed that names another box primary is counted", async () => {
    const d = deps({
      held: chart(5, [
        [OLD, "sell-only"],
        [SELF, "serving-secondary", OWN_ORIGIN],
        [SPARE, "serving-primary"],
      ]),
      joinedIds: [OLD],
      answers: { [OLD]: null },
    });
    expect(await checkPeersAtStart(d)).toBe("wait");
  });

  it("the demoted box is still asked: a newer chart from it that fences this box gives superseded", async () => {
    const fencing = chart(6, [
      [OLD, "serving-primary"],
      [SELF, "sell-only", OWN_ORIGIN],
    ]);
    const d = deps({ held: PROMOTED, joinedIds: [OLD], answers: { [OLD]: status(fencing) } });
    expect(await checkPeersAtStart(d)).toBe("superseded");
    expect(d.asked).toEqual([OLD]);
  });

  it("a destination whose operation is activated and still return_pending proceeds", async () => {
    // A destination's own operation is not `openOperation` (that names a source operation).
    const d = deps({
      held: M2_HELD,
      joinedIds: [OLD],
      activatedFrom: new Set([OLD]),
      openOperation: false,
      answers: { [OLD]: null },
    });
    expect(await checkPeersAtStart(d)).toBe("proceed");
  });

  it("after the prepared repair, the box proceeds once its counted peer answers = (rule 4)", async () => {
    const d = deps({ openOperation: false, answers: { [SPARE]: status(SAME) } });
    expect(await checkPeersAtStart(d)).toBe("proceed");
  });

  it("after the prepared repair, with that peer silent, the box waits (rule 5)", async () => {
    const d = deps({ openOperation: false, answers: { [SPARE]: null } });
    expect(await checkPeersAtStart(d)).toBe("wait");
  });

  it("a peer whose controlled operation naming this box as source is still at prepared is not F: the box proceeds", async () => {
    const d = deps({ answers: { [SPARE]: status(SAME, operation("controlled", "prepared")) } });
    expect(await checkPeersAtStart(d)).toBe("proceed");
  });

  it("control: the same peer at copy_accepted gives superseded", async () => {
    const d = deps({
      answers: { [SPARE]: status(SAME, operation("controlled", "copy_accepted")) },
    });
    expect(await checkPeersAtStart(d)).toBe("superseded");
  });

  it("a controlled operation past copy_accepted (filing_assumed) naming this box is F", async () => {
    const d = deps({
      answers: { [SPARE]: status(SAME, operation("controlled", "filing_assumed")) },
    });
    expect(await checkPeersAtStart(d)).toBe("superseded");
  });

  it("a peer at emergency_declared naming this box as source is F", async () => {
    const d = deps({
      answers: { [SPARE]: status(SAME, operation("emergency", "emergency_declared")) },
    });
    expect(await checkPeersAtStart(d)).toBe("superseded");
  });

  it.each<["controlled" | "emergency", HandoverState]>([
    ["controlled", "activated"],
    ["controlled", "return_pending"],
    ["emergency", "activated"],
    ["emergency", "return_pending"],
  ])(
    "a %s operation at %s naming this box as source is F, with the peer's chart unchanged",
    async (scenario, state) => {
      const d = deps({ answers: { [SPARE]: status(SAME, operation(scenario, state)) } });
      expect(await checkPeersAtStart(d)).toBe("superseded");
    },
  );

  it("a peer's own source operation naming this box as source is not F", async () => {
    const d = deps({
      answers: {
        [SPARE]: status(SAME, { ...operation("controlled", "return_pending"), role: "source" }),
      },
    });
    expect(await checkPeersAtStart(d)).toBe("proceed");
  });

  it("two peers with charts in a shape this box does not read count as S, and the check does not throw", async () => {
    const three = chart(3, [
      [SELF, "serving-primary", OWN_ORIGIN],
      [SPARE, "serving-secondary"],
      ["m3", "serving-secondary"],
    ]);
    const malformed = { body: {} } as unknown as SignedMembershipDocument;
    const d = deps({
      held: three,
      joinedIds: [SPARE, "m3"],
      answers: { [SPARE]: status({} as SignedMembershipDocument), m3: status(malformed) },
    });
    expect(await checkPeersAtStart(d)).toBe("wait");
  });

  it("a malformed chart with an operation naming this box at copy_accepted is F", async () => {
    const d = deps({
      answers: {
        [SPARE]: status({} as SignedMembershipDocument, operation("controlled", "copy_accepted")),
      },
    });
    expect(await checkPeersAtStart(d)).toBe("superseded");
  });

  const good = operation("controlled", "copy_accepted");
  const unreadable: [string, Partial<Record<keyof PeerStatusBody, unknown>>][] = [
    ["an open operation that is a string", { openOperation: "x" }],
    ["an open operation that is a list", { openOperation: [] }],
    ["an open operation with no source", { openOperation: { ...good, sourceNodeId: 1 } }],
    ["an open operation with an unknown scenario", { openOperation: { ...good, scenario: "x" } }],
    ["an open operation with an unknown state", { openOperation: { ...good, state: "x" } }],
    ["a missing open operation", { openOperation: undefined }],
    ["a requested operation that is a string", { requestedOperation: "x" }],
    ["a restriction that is a list", { restriction: [] }],
    [
      "a restriction of an unknown kind",
      { restriction: { kind: "x", successorNodeId: SPARE, operationId: null } },
    ],
    ["a restriction with no successor", { restriction: { kind: "superseded", operationId: null } }],
    [
      "a restriction with a numeric operation",
      { restriction: { kind: "superseded", successorNodeId: SPARE, operationId: 1 } },
    ],
  ];

  it.each(unreadable)(
    "a counted peer with a good chart at the same term and %s counts as S: the box waits",
    async (_label, part) => {
      const d = deps({ answers: { [SPARE]: { ...status(SAME), ...part } as PeerStatusBody } });
      expect(await checkPeersAtStart(d)).toBe("wait");
    },
  );

  it("control: the same chart with no open operation, and a well-formed restriction, proceeds", async () => {
    const restriction = { kind: "handed-over" as const, successorNodeId: SPARE, operationId: OP };
    const d = deps({ answers: { [SPARE]: { ...status(SAME), restriction } } });
    expect(await checkPeersAtStart(d)).toBe("proceed");
  });

  it("an unreadable part does not hide an F from the same answer's newer fencing chart", async () => {
    const d = deps({
      answers: { [SPARE]: { ...status(NEWER_FENCING), requestedOperation: "x" } as never },
    });
    expect(await checkPeersAtStart(d)).toBe("superseded");
  });

  it("an unreadable part does not hide an F from the same answer's open operation", async () => {
    const d = deps({
      answers: { [SPARE]: { ...status(SAME, good), restriction: [] } as never },
    });
    expect(await checkPeersAtStart(d)).toBe("superseded");
  });

  it("an unreadable part keeps the newer chart it came with held, though it does not count", async () => {
    const store = heldStore(HELD);
    const d = deps({
      accept: store.accept,
      answers: { [SPARE]: { ...status(NEWER_SERVING), openOperation: "x" } as never },
    });
    expect(await checkPeersAtStart(d)).toBe("wait");
    expect(store.held()).toBe(NEWER_SERVING);
  });

  it("an emergency operation still at prepared naming this box is not F", async () => {
    const d = deps({ answers: { [SPARE]: status(SAME, operation("emergency", "prepared")) } });
    expect(await checkPeersAtStart(d)).toBe("proceed");
  });

  it("an operation naming another box as source is not F", async () => {
    const d = deps({
      answers: { [SPARE]: status(SAME, operation("emergency", "activated", "someone-else")) },
    });
    expect(await checkPeersAtStart(d)).toBe("proceed");
  });

  it("a box in activatedFrom that answers with a newer chart fencing this box gives superseded", async () => {
    const fencing = chart(6, [
      [OLD, "serving-primary"],
      [SELF, "sell-only", OWN_ORIGIN],
    ]);
    const d = deps({
      held: M2_HELD,
      joinedIds: [OLD],
      activatedFrom: new Set([OLD]),
      answers: { [OLD]: status(fencing) },
    });
    expect(await checkPeersAtStart(d)).toBe("superseded");
  });

  it("a box in activatedFrom that does not answer, with no counted peer, leaves the result proceed", async () => {
    const d = deps({ held: M2_HELD, activatedFrom: new Set([OLD]), joinedIds: [] });
    expect(await checkPeersAtStart(d)).toBe("proceed");
    expect(d.asked).toEqual([OLD]);
  });

  it("two newer charts: the newest is held and decides, so an older fencing one is not F", async () => {
    const three = chart(3, [
      [SELF, "serving-primary", OWN_ORIGIN],
      [SPARE, "serving-secondary"],
      ["m3", "serving-secondary"],
    ]);
    const olderFencing = chart(4, [
      [SELF, "sell-only", OWN_ORIGIN],
      [SPARE, "serving-primary"],
    ]);
    const newestServing = chart(5, [
      [SELF, "serving-primary", OWN_ORIGIN],
      [SPARE, "serving-secondary"],
    ]);
    const store = heldStore(three);
    const d = deps({
      held: three,
      joinedIds: [SPARE, "m3"],
      accept: store.accept,
      answers: { [SPARE]: status(olderFencing), m3: status(newestServing) },
    });
    expect(await checkPeersAtStart(d)).toBe("proceed");
    expect(store.held()).toBe(newestServing);
  });
});

describe("checkPeersAtStart — an operation whose scenario, role and state do not fit", () => {
  it.each<["controlled" | "emergency", "source" | "destination", HandoverState]>([
    ["controlled", "destination", "emergency_declared"],
    ["emergency", "destination", "copy_accepted"],
    ["emergency", "destination", "filing_assumed"],
    ["controlled", "destination", "source_stepped_down"],
    ["controlled", "source", "copy_accepted"],
  ])("a %s %s operation at %s counts as S: the box waits", async (scenario, role, state) => {
    const d = deps({
      answers: { [SPARE]: status(SAME, { ...operation(scenario, state), role }) },
    });
    expect(await checkPeersAtStart(d)).toBe("wait");
  });

  it("control: a controlled destination operation at prepared fits, and the box proceeds", async () => {
    const d = deps({ answers: { [SPARE]: status(SAME, operation("controlled", "prepared")) } });
    expect(await checkPeersAtStart(d)).toBe("proceed");
  });

  it("control: a requested operation that does not fit also counts as S", async () => {
    const d = deps({
      answers: {
        [SPARE]: {
          ...status(SAME),
          requestedOperation: operation("controlled", "emergency_declared"),
        },
      },
    });
    expect(await checkPeersAtStart(d)).toBe("wait");
  });
});

describe("checkPeersAtStart — what each peer answered", () => {
  it("reports each asked peer's answer kind, whether it is counted and whether its operation stopped this box", async () => {
    const onAnswers = vi.fn();
    const d = deps({
      held: chart(3, [
        [SELF, "serving-primary", OWN_ORIGIN],
        [SPARE, "serving-secondary"],
        [OLD, "sell-only"],
        ["m3", "serving-secondary"],
      ]),
      joinedIds: [SPARE, "m3"],
      activatedFrom: new Set([OLD]),
      answers: {
        [SPARE]: status(SAME, operation("controlled", "copy_accepted")),
        [OLD]: status(SAME),
      },
      onAnswers,
    });
    expect(await checkPeersAtStart(d)).toBe("superseded");
    expect(onAnswers).toHaveBeenCalledTimes(1);
    expect(onAnswers.mock.calls[0]![0]).toEqual([
      { nodeId: SPARE, answer: "F", counted: true, byOperation: true },
      { nodeId: OLD, answer: "=", counted: false, byOperation: false },
      { nodeId: "m3", answer: "S", counted: true, byOperation: false, why: "no_answer" },
    ]);
  });

  it.each<[string, Answers, string | undefined, string]>([
    ["no address", {}, "", "no_address"],
    ["this box's own address", {}, OWN_ORIGIN, "own_address"],
    ["no answer in time", { [SPARE]: "hang" }, undefined, "timed_out"],
    ["a failed ask", { [SPARE]: "throw" }, undefined, "no_answer"],
    ["no answer", { [SPARE]: null }, undefined, "no_answer"],
    ["no chart", { [SPARE]: status(null) }, undefined, "no_chart"],
    [
      "an unreadable part",
      { [SPARE]: { ...status(SAME), restriction: "x" as never } },
      undefined,
      "unreadable_part",
    ],
  ])("says why an S is silent: %s", async (_label, answers, url, reason) => {
    const onAnswers = vi.fn();
    const held = chart(3, [
      [SELF, "serving-primary", OWN_ORIGIN],
      [SPARE, "serving-secondary", url],
    ]);
    await checkPeersAtStart(deps({ held, answers, onAnswers }));
    expect(onAnswers.mock.calls[0]![0]).toEqual([
      { nodeId: SPARE, answer: "S", counted: true, byOperation: false, why: reason },
    ]);
  });

  it("says an untrusted chart is why an S is silent", async () => {
    const onAnswers = vi.fn();
    const store = heldStore(HELD, new Set([4]));
    await checkPeersAtStart(
      deps({ accept: store.accept, answers: { [SPARE]: status(NEWER_SERVING) }, onAnswers }),
    );
    expect(onAnswers.mock.calls[0]![0][0]).toMatchObject({ answer: "S", why: "untrusted_chart" });
  });

  it("a newer chart that fences this box is F, not by operation", async () => {
    const onAnswers = vi.fn();
    const d = deps({ answers: { [SPARE]: status(NEWER_FENCING) }, onAnswers });
    expect(await checkPeersAtStart(d)).toBe("superseded");
    expect(onAnswers.mock.calls[0]![0]).toEqual([
      { nodeId: SPARE, answer: "F", counted: true, byOperation: false },
    ]);
  });
});

describe("boxRefusal", () => {
  it("reads the code and params of a box's refusal", () => {
    expect(
      boxRefusal(JSON.stringify({ error: { code: "handover.modules_differ", params: { a: 1 } } })),
    ).toEqual({ code: "handover.modules_differ", params: { a: 1 } });
  });

  it("leaves params undefined when the refusal has none", () => {
    expect(boxRefusal(JSON.stringify({ error: { code: "handover.modules_differ" } }))).toEqual({
      code: "handover.modules_differ",
      params: undefined,
    });
  });

  it.each([
    ["text that is not JSON", "<html>"],
    ["no characters", ""],
    ["a JSON null", "null"],
    ["a JSON list", "[]"],
    ["an answer with no error", "{}"],
    ["an error that is not an object", JSON.stringify({ error: "handover.modules_differ" })],
    ["an error that is a list", JSON.stringify({ error: [] })],
    ["an error with no code", JSON.stringify({ error: {} })],
    ["a code that is not text", JSON.stringify({ error: { code: 1 } })],
  ])("answers null for %s", (_name, text) => {
    expect(boxRefusal(text)).toBeNull();
  });
});

describe("persistingAccept", () => {
  const pair = generateNodeKeyPair();
  const trust: TrustSet = { [SELF]: pair.publicKey };
  function signed(term: number): SignedMembershipDocument {
    const body = {
      term,
      nodes: [{ nodeId: SELF, contactUrl: OWN_ORIGIN, standing: "serving-primary" as const }],
    };
    return {
      body,
      signerNodeId: SELF,
      signature: signDocumentBody(body, pair.privateKey),
      endorsements: [],
    };
  }

  it("persists a verified, newer chart and reports it accepted", async () => {
    const persist = vi.fn(async () => true);
    const accept = persistingAccept({ held: signed(3), trustSet: trust, persist });
    const doc = signed(4);
    expect(await accept(doc)).toEqual({ accepted: true, document: doc });
    expect(persist).toHaveBeenCalledWith(doc);
  });

  it("a box holding no chart yet accepts and persists a verified one", async () => {
    const persist = vi.fn(async () => true);
    const accept = persistingAccept({ held: null, trustSet: trust, persist });
    expect(await accept(signed(1))).toMatchObject({ accepted: true });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("reports a chart newer than the one held before the check accepted, though the store did not save it", async () => {
    const persist = vi.fn(async () => false);
    const accept = persistingAccept({ held: signed(3), trustSet: trust, persist });
    const doc = signed(4);
    expect(await accept(doc)).toEqual({ accepted: true, document: doc });
    expect(persist).toHaveBeenCalledWith(doc);
  });

  it("refuses a chart signed by a key it does not trust, persisting nothing", async () => {
    const stranger = generateNodeKeyPair();
    const body = signed(4).body;
    const forged = {
      body,
      signerNodeId: SELF,
      signature: signDocumentBody(body, stranger.privateKey),
      endorsements: [],
    };
    const persist = vi.fn(async () => true);
    const accept = persistingAccept({ held: signed(3), trustSet: trust, persist });
    expect(await accept(forged)).toMatchObject({ accepted: false, reason: "invalid" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("does not persist a chart that is not newer than the one held", async () => {
    const persist = vi.fn(async () => true);
    const accept = persistingAccept({ held: signed(3), trustSet: trust, persist });
    expect(await accept(signed(3))).toEqual({ accepted: false, reason: "not_newer" });
    expect(persist).not.toHaveBeenCalled();
  });
});

describe("checkPeersAtStart with real signatures — charts that disagree at one term", () => {
  const selfPair = generateNodeKeyPair();
  const sparePair = generateNodeKeyPair();
  const trustSet: TrustSet = { [SELF]: selfPair.publicKey, [SPARE]: sparePair.publicKey };
  const signedBy = (
    signer: string,
    privateKey: string,
    doc: SignedMembershipDocument,
  ): SignedMembershipDocument => ({
    ...doc,
    signerNodeId: signer,
    signature: signDocumentBody(doc.body, privateKey),
  });
  const bySelf = (doc: SignedMembershipDocument) => signedBy(SELF, selfPair.privateKey, doc);
  const bySpare = (doc: SignedMembershipDocument) => signedBy(SPARE, sparePair.privateKey, doc);
  const serving = (term: number) =>
    chart(term, [
      [SELF, "serving-primary", OWN_ORIGIN],
      [SPARE, "serving-secondary"],
      [OLD, "serving-secondary"],
    ]);
  const fencing = (term: number) =>
    chart(term, [
      [SELF, "sell-only", OWN_ORIGIN],
      [SPARE, "serving-primary"],
      [OLD, "serving-secondary"],
    ]);

  async function run(
    held: SignedMembershipDocument,
    spareChart: SignedMembershipDocument,
    oldChart: SignedMembershipDocument,
  ) {
    let saved = held;
    const onAnswers = vi.fn();
    const accept = persistingAccept({
      held,
      trustSet,
      persist: async (doc) => {
        if (doc.body.term <= saved.body.term) return false;
        saved = doc;
        return true;
      },
    });
    const result = await checkPeersAtStart(
      deps({
        held,
        joinedIds: [SPARE, OLD],
        accept,
        answers: { [SPARE]: status(spareChart), [OLD]: status(oldChart) },
        onAnswers,
      }),
    );
    const answers = (onAnswers.mock.calls[0]![0] as { nodeId: string; answer: string }[]).map(
      (a) => `${a.nodeId}:${a.answer}`,
    );
    return { result, answers, saved };
  }

  it("two verified charts at the same newer term: the one fencing this box is F and is the one saved, whichever peer holds it", async () => {
    const held = bySelf(serving(3));
    const servingNewer = bySelf(serving(4));
    const fencingNewer = bySpare(fencing(4));
    const forward = await run(held, servingNewer, fencingNewer);
    const reverse = await run(held, fencingNewer, servingNewer);
    expect(forward).toEqual({
      result: "superseded",
      answers: [`${SPARE}:N`, `${OLD}:F`],
      saved: fencingNewer,
    });
    expect(reverse).toEqual({
      result: "superseded",
      answers: [`${SPARE}:F`, `${OLD}:N`],
      saved: fencingNewer,
    });
  });

  it("a verified chart at the held term with another body that fences this box and names another serving primary is F", async () => {
    // This box minted term 4 while cut off; the spare minted its own term 4 promoting itself.
    const held = bySelf(serving(4));
    const fork = bySpare(fencing(4));
    expect(acceptMembershipDocument(fork, 4, trustSet, held)).toEqual({
      accepted: false,
      reason: "not_newer",
    });
    expect(await run(held, fork, held)).toMatchObject({
      result: "superseded",
      answers: [`${SPARE}:F`, `${OLD}:=`],
      saved: held,
    });
  });

  it("a verified chart at the held term that fences this box but names no serving primary is =", async () => {
    const held = bySelf(serving(4));
    const fork = bySpare(
      chart(4, [
        [SELF, "sell-only", OWN_ORIGIN],
        [SPARE, "serving-secondary"],
        [OLD, "serving-secondary"],
      ]),
    );
    expect(acceptMembershipDocument(fork, 4, trustSet, held)).toEqual({
      accepted: false,
      reason: "not_newer",
    });
    expect(await run(held, fork, held)).toEqual({
      result: "proceed",
      answers: [`${SPARE}:=`, `${OLD}:=`],
      saved: held,
    });
  });

  it("control: the held chart itself, which fences this box, stays =", async () => {
    const held = bySpare(fencing(4));
    expect(await run(held, held, held)).toMatchObject({
      result: "proceed",
      answers: [`${SPARE}:=`, `${OLD}:=`],
    });
  });

  it("control: a fencing chart at the held term signed by a key this box does not trust is S", async () => {
    const held = bySelf(serving(4));
    const forged = signedBy(SPARE, generateNodeKeyPair().privateKey, fencing(4));
    expect(await run(held, forged, held)).toMatchObject({
      result: "proceed",
      answers: [`${SPARE}:S`, `${OLD}:=`],
    });
  });

  it("a fencing chart older than the newest verified chart is still not F", async () => {
    const held = bySelf(serving(3));
    expect(await run(held, bySpare(fencing(4)), bySelf(serving(5)))).toMatchObject({
      result: "proceed",
      answers: [`${SPARE}:=`, `${OLD}:N`],
    });
  });
});

describe("askPeerStatus", () => {
  const selfKeys = generateNodeKeyPair();
  const peerKeys = generateNodeKeyPair();
  const strangerKeys = generateNodeKeyPair();
  const PEER: RoutableServer = {
    nodeId: SPARE,
    url: "https://m2.local/",
    standing: "serving-secondary",
  };
  const NONCE = "q".repeat(32);
  const keys: Record<string, string> = { [SELF]: selfKeys.publicKey, [SPARE]: peerKeys.publicKey };

  function answerWith(make: (query: { nonce: string }) => unknown, statusCode = 200) {
    const calls: { url: string; body: unknown }[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { body: { nonce: string } };
      calls.push({ url: String(url), body });
      return new Response(JSON.stringify(make(body.body)), { status: statusCode });
    });
    return { calls, fetchFn };
  }

  function ask(fetchFn: typeof fetch, timeoutMs = 1000) {
    return askPeerStatus({
      sign: async (body) =>
        signEnvelope("query", body, { nodeId: SELF, privateKey: selfKeys.privateKey }),
      publicKeyOf: (id) => keys[id],
      fetch: fetchFn,
      nonce: () => NONCE,
      now: () => 1_000,
      timeoutMs,
    });
  }

  const body = (nonce: string): PeerStatusBody => ({
    heldMembership: HELD,
    restriction: null,
    openOperation: null,
    requestedOperation: null,
    nonce,
  });
  const sign = (b: PeerStatusBody, nodeId = SPARE, privateKey = peerKeys.privateKey) =>
    signEnvelope("status", b as never, { nodeId, privateKey });

  let authorityX: BoxAuthority;
  let authorityY: BoxAuthority;
  const servers: BoxServer[] = [];
  beforeAll(async () => {
    [authorityX, authorityY] = await Promise.all([mintBoxAuthority(), mintBoxAuthority()]);
  });
  afterEach(async () => {
    while (servers.length > 0) await servers.pop()!.close();
  });

  /** A box at `localhost` serving `authority`'s leaf, answering each query with `make`. */
  async function statusServer(
    authority: BoxAuthority,
    make: (query: { nonce: string; atMs: number }) => unknown,
  ) {
    let last = "";
    const server = await startBoxServer(authority, (req) => {
      const query = (JSON.parse(req.body) as { body: { nonce: string; atMs: number } }).body;
      last = query.nonce;
      return { status: 200, body: JSON.stringify(make(query)) };
    });
    servers.push(server);
    return { ...server, lastNonce: () => last };
  }

  function realAsk(over: Partial<Parameters<typeof askPeerStatus>[0]>) {
    return askPeerStatus({
      sign: async (b) =>
        signEnvelope("query", b, { nodeId: SELF, privateKey: selfKeys.privateKey }),
      publicKeyOf: (id) => keys[id],
      timeoutMs: 5000,
      ...over,
    });
  }

  it("posts a signed query to the peer's status route and returns the verified answer", async () => {
    const { calls, fetchFn } = answerWith((q) => sign(body(q.nonce)));
    expect(await ask(fetchFn)(PEER)).toEqual(body(NONCE));
    expect(calls[0]!.url).toBe("https://m2.local/api/node/peer-status");
    expect(calls[0]!.body).toMatchObject({
      purpose: "waitron.handover.query.v1",
      signerNodeId: SELF,
      body: { nonce: NONCE, atMs: 1_000 },
    });
  });

  it("a query option goes into the signed body, naming the operation and its purpose", async () => {
    const { calls, fetchFn } = answerWith((q) => sign(body(q.nonce)));
    const asked = await realAsk({
      fetch: fetchFn,
      nonce: () => NONCE,
      now: () => 1_000,
      query: { operationId: "op-1", purpose: "status" },
    })(PEER);
    expect(asked).toEqual(body(NONCE));
    expect(calls[0]!.url).toBe("https://m2.local/api/node/peer-status");
    expect(calls[0]!.body).toMatchObject({
      body: { nonce: NONCE, atMs: 1_000, operationId: "op-1", purpose: "status" },
    });
  });

  it("an unsigned answer is null", async () => {
    const { fetchFn } = answerWith((q) => body(q.nonce));
    expect(await ask(fetchFn)(PEER)).toBeNull();
  });

  it("an answer signed by a key nobody vouches for is null", async () => {
    const { fetchFn } = answerWith((q) => sign(body(q.nonce), SPARE, strangerKeys.privateKey));
    expect(await ask(fetchFn)(PEER)).toBeNull();
  });

  it("an answer signed by a different trusted box than the one asked is null", async () => {
    const { fetchFn } = answerWith((q) => sign(body(q.nonce), SELF, selfKeys.privateKey));
    expect(await ask(fetchFn)(PEER)).toBeNull();
  });

  it("an answer echoing a different nonce is null", async () => {
    const { fetchFn } = answerWith(() => sign(body("z".repeat(32))));
    expect(await ask(fetchFn)(PEER)).toBeNull();
  });

  it("a signed answer with a malformed chart is passed on whole, for the check to judge", async () => {
    const op = operation("controlled", "copy_accepted");
    for (const malformed of [{}, { body: {} }, { ...HELD, body: { term: "4", nodes: [] } }]) {
      const answer = { ...body(NONCE), heldMembership: malformed, openOperation: op };
      const { fetchFn } = answerWith(() =>
        signEnvelope("status", answer as never, { nodeId: SPARE, privateKey: peerKeys.privateKey }),
      );
      expect(await ask(fetchFn)(PEER)).toEqual(answer);
    }
  });

  const op = operation("controlled", "copy_accepted");
  it.each<[string, (nonce: string) => unknown]>([
    ["a body that is a string", () => "status"],
    ["a body that is a list", () => []],
  ])("a signed answer carrying %s is null", async (_label, make) => {
    const { fetchFn } = answerWith((q) =>
      signEnvelope("status", make(q.nonce) as never, {
        nodeId: SPARE,
        privateKey: peerKeys.privateKey,
      }),
    );
    expect(await ask(fetchFn)(PEER)).toBeNull();
  });

  it.each<[string, (nonce: string) => unknown, keyof PeerStatusBody]>([
    ["a chart that is a string", (n) => ({ nonce: n, heldMembership: "nope" }), "heldMembership"],
    ["a restriction that is a list", (n) => ({ ...body(n), restriction: [] }), "restriction"],
    [
      "an open operation that is a string",
      (n) => ({ ...body(n), openOperation: "x" }),
      "openOperation",
    ],
    [
      "an open operation that is a list",
      (n) => ({ ...body(n), openOperation: [] }),
      "openOperation",
    ],
    [
      "an open operation with no source",
      (n) => ({ ...body(n), openOperation: { ...op, sourceNodeId: 1 } }),
      "openOperation",
    ],
    [
      "an open operation with an unknown scenario",
      (n) => ({ ...body(n), openOperation: { ...op, scenario: "x" } }),
      "openOperation",
    ],
    [
      "an open operation with an unknown state",
      (n) => ({ ...body(n), openOperation: { ...op, state: "x" } }),
      "openOperation",
    ],
    [
      "a requested operation that is a string",
      (n) => ({ ...body(n), requestedOperation: "x" }),
      "requestedOperation",
    ],
  ])(
    "a signed answer carrying %s is passed on whole, for the check to judge",
    async (_label, make, part) => {
      const { fetchFn } = answerWith((q) =>
        signEnvelope("status", make(q.nonce) as never, {
          nodeId: SPARE,
          privateKey: peerKeys.privateKey,
        }),
      );
      const answer = await ask(fetchFn)(PEER);
      expect(answer).toEqual(make(NONCE));
      expect(answer?.[part]).toEqual((make(NONCE) as PeerStatusBody)[part]);
    },
  );

  it("a signed answer carrying an operation in either scenario is kept", async () => {
    for (const scenario of ["controlled", "emergency"] as const) {
      const answer = {
        ...body(NONCE),
        openOperation: { ...op, scenario },
        requestedOperation: { ...op, scenario },
      };
      const { fetchFn } = answerWith(() => sign(answer));
      expect(await ask(fetchFn)(PEER)).toEqual(answer);
    }
  });

  it("with no stand-ins it asks over the box transport, with a fresh 32-character nonce and the clock", async () => {
    const seen: { nonce: string; atMs: number }[] = [];
    const server = await statusServer(authorityX, (q) => {
      seen.push(q);
      return sign(body(q.nonce));
    });
    const real = askPeerStatus({
      sign: async (b) =>
        signEnvelope("query", b, { nodeId: SELF, privateKey: selfKeys.privateKey }),
      publicKeyOf: (id) => keys[id],
      authorityOf: () => authorityX.caPem,
    });
    const before = Date.now();
    const peer = { ...PEER, url: server.url };
    expect(await real(peer)).not.toBeNull();
    await real(peer);
    expect(seen[0]!.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(seen[1]!.nonce).not.toBe(seen[0]!.nonce);
    expect(seen[0]!.atMs).toBeGreaterThanOrEqual(before);
  });

  it("a refusal (503 handover.stepping_down) is null", async () => {
    const { fetchFn } = answerWith(() => ({ error: { code: "handover.stepping_down" } }), 503);
    expect(await ask(fetchFn)(PEER)).toBeNull();
  });

  it("a transport error is null", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await ask(fetchFn)(PEER)).toBeNull();
  });

  it.each<[string, Error, "unreachable" | "not_established"]>([
    ["a refused connection", Object.assign(new Error(), { code: "ECONNREFUSED" }), "unreachable"],
    ["no network route", Object.assign(new Error(), { code: "ENETUNREACH" }), "unreachable"],
    ["no host route", Object.assign(new Error(), { code: "EHOSTUNREACH" }), "unreachable"],
    [
      "an opaque transport timeout",
      Object.assign(new Error(), { code: "ETIMEDOUT" }),
      "not_established",
    ],
    [
      "a refused connection wrapped by fetch",
      new TypeError("fetch failed", {
        cause: Object.assign(new Error(), { code: "ECONNREFUSED" }),
      }),
      "unreachable",
    ],
    ["an unexplained transport failure", new TypeError("fetch failed"), "not_established"],
  ])("distinguishes %s from a verified answer", async (_label, error, reason) => {
    const onSilent = vi.fn();
    const fetchFn = vi.fn(async () => {
      throw error;
    });
    expect(await realAsk({ fetch: fetchFn, onSilent })(PEER)).toBeNull();
    expect(onSilent).toHaveBeenCalledWith(SPARE, reason);
  });

  it("a signing fault cannot establish that the peer is silent, even with a connection error code", async () => {
    const onSilent = vi.fn();
    const fetchFn = vi.fn();
    const real = realAsk({
      sign: async () => {
        throw Object.assign(new Error("signing failed"), { code: "ECONNREFUSED" });
      },
      fetch: fetchFn,
      onSilent,
    });
    expect(await real(PEER)).toBeNull();
    expect(onSilent).toHaveBeenCalledWith(SPARE, "not_established");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    [false, "not_established"],
    [true, "not_established"],
  ] as const)(
    "a native timeout (connected: %s) keeps its diagnostic and is %s",
    async (connected, reason) => {
      const exchange = vi
        .spyOn(boxTransport, "boxExchange")
        .mockImplementation(async (_url, options) => {
          if (connected) options.onConnected?.();
          throw Object.assign(new Error("synthetic exchange timeout"), { code: "ETIMEDOUT" });
        });
      try {
        const authorityOf = () => authorityX.caPem;
        await expect(
          postToBox({ timeoutMs: 100, authorityOf }, SPARE, PEER.url, "{}"),
        ).rejects.toThrow("synthetic exchange timeout");
        const onSilent = vi.fn();
        expect(await realAsk({ authorityOf, onSilent })(PEER)).toBeNull();
        expect(onSilent).toHaveBeenCalledWith(SPARE, reason);
      } finally {
        exchange.mockRestore();
      }
    },
  );

  it.each(["", "https://this-box.local/"])(
    "an empty or own address %j cannot establish that the peer is silent",
    async (url) => {
      const onSilent = vi.fn();
      const { fetchFn } = answerWith((q) => sign(body(q.nonce)));
      const signer = vi.fn<Parameters<typeof askPeerStatus>[0]["sign"]>(async (b) =>
        signEnvelope("query", b, { nodeId: SELF, privateKey: selfKeys.privateKey }),
      );
      const real = realAsk({
        ownOrigin: "https://this-box.local",
        sign: signer,
        fetch: fetchFn,
        onSilent,
      });
      expect(await real({ ...PEER, url })).toBeNull();
      expect(onSilent).toHaveBeenCalledWith(SPARE, "not_established");
      expect(signer).not.toHaveBeenCalled();
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it("a body that is not JSON is null", async () => {
    const fetchFn = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(await ask(fetchFn)(PEER)).toBeNull();
  });

  it("a timed-out fetch replacement cannot establish connection silence", async () => {
    const onSilent = vi.fn();
    const fetchFn = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    expect(await realAsk({ fetch: fetchFn, timeoutMs: 20, onSilent })(PEER)).toBeNull();
    expect(onSilent).toHaveBeenCalledWith(SPARE, "not_established");
  });

  it("a refused real TCP connection still counts as silence", async () => {
    // Silence counts only at an address this box reached under the pinned authority before.
    const checked = new boxTransport.CheckedAddresses();
    const real = boxTransport.boxExchange;
    const exchange = vi
      .spyOn(boxTransport, "boxExchange")
      .mockImplementation((url, options, maxBytes) => real(url, { ...options, checked }, maxBytes));
    try {
      const server = await statusServer(authorityX, (q) => sign(body(q.nonce)));
      servers.splice(servers.indexOf(server), 1);
      const url = `https://127.0.0.1:${new URL(server.url).port}`;
      const reach = realAsk({ authorityOf: () => authorityX.caPem });
      expect(await reach({ ...PEER, url })).not.toBeNull();
      await server.close();
      const onSilent = vi.fn();
      expect(
        await realAsk({ authorityOf: () => authorityX.caPem, onSilent })({ ...PEER, url }),
      ).toBeNull();
      expect(onSilent).toHaveBeenCalledWith(SPARE, "unreachable");
    } finally {
      exchange.mockRestore();
    }
  });

  it.each([false, true])(
    "a connected %s-TLS peer that withholds its answer is not established",
    async (secure) => {
      let received = 0;
      const receive: import("node:http").RequestListener = (req) => {
        received += 1;
        req.resume();
      };
      const server = secure
        ? createHttpsServer({ key: authorityX.keyPem, cert: authorityX.certPem }, receive)
        : createHttpServer(receive);
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      try {
        const { port } = server.address() as AddressInfo;
        const onSilent = vi.fn();
        expect(
          await realAsk({ timeoutMs: 1000, authorityOf: () => authorityX.caPem, onSilent })({
            ...PEER,
            url: `${secure ? "https" : "http"}://localhost:${port}`,
          }),
        ).toBeNull();
        expect(received).toBe(1);
        expect(onSilent).toHaveBeenCalledWith(SPARE, "not_established");
      } finally {
        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
      }
    },
  );

  it("a peer whose first address refuses and whose second accepts TCP but never answers is not established", async () => {
    const held = new Set<Socket>();
    // Accepts the TCP connection on 127.0.0.1 alone and never starts TLS; nothing listens on the
    // IPv6 loopback at this port, so that address refuses the connection.
    const server = createTcpServer((socket) => {
      held.add(socket);
      socket.on("error", () => {});
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const real = boxTransport.boxExchange;
    const addresses = vi.fn(() =>
      Promise.resolve({ addresses: ["::1", "127.0.0.1"], remembered: false }),
    );
    const exchange = vi
      .spyOn(boxTransport, "boxExchange")
      .mockImplementation((url, options, maxBytes) =>
        real(url, { ...options, lookup: addresses }, maxBytes),
      );
    try {
      const { port } = server.address() as AddressInfo;
      const onSilent = vi.fn();
      expect(
        await realAsk({ timeoutMs: 1000, authorityOf: () => authorityX.caPem, onSilent })({
          ...PEER,
          url: `https://box-7f3a.waitron.local:${port}`,
        }),
      ).toBeNull();
      expect(addresses).toHaveBeenCalled();
      expect(held.size).toBe(1);
      expect(onSilent).toHaveBeenCalledWith(SPARE, "not_established");
    } finally {
      exchange.mockRestore();
      for (const socket of held) socket.destroy();
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  describe("over HTTPS to a box serving a leaf from its own authority", () => {
    it("with the peer's authority pinned, the signed answer verifies", async () => {
      const server = await statusServer(authorityX, (q) => sign(body(q.nonce)));
      const real = realAsk({ authorityOf: (id) => (id === SPARE ? authorityX.caPem : undefined) });
      expect(await real({ ...PEER, url: server.url })).toEqual(body(server.lastNonce()));
      expect(server.requests).toHaveLength(1);
    });

    it("with no authority known, the box is silent with the reason certificate and is sent nothing", async () => {
      const server = await statusServer(authorityX, (q) => sign(body(q.nonce)));
      const onSilent = vi.fn();
      const real = realAsk({ onSilent });
      expect(await real({ ...PEER, url: server.url })).toBeNull();
      expect(server.requests).toHaveLength(0);
      expect(onSilent).toHaveBeenCalledWith(SPARE, "certificate");
    });

    it("with the authority pinned, a box presenting another authority's leaf is refused before the query is sent", async () => {
      const server = await statusServer(authorityY, (q) => sign(body(q.nonce)));
      const onSilent = vi.fn();
      const real = realAsk({ authorityOf: () => authorityX.caPem, onSilent });
      expect(await real({ ...PEER, url: server.url })).toBeNull();
      expect(server.requests).toHaveLength(0);
      expect(onSilent).toHaveBeenCalledWith(SPARE, "certificate");
    });

    it("with the authority pinned, an unsigned answer is still null", async () => {
      const server = await statusServer(authorityX, (q) => body(q.nonce));
      expect(
        await realAsk({ authorityOf: () => authorityX.caPem })({ ...PEER, url: server.url }),
      ).toBeNull();
    });

    it("an answer larger than the limit is null", async () => {
      const server = await statusServer(authorityX, (q) => ({
        ...sign(body(q.nonce)),
        padding: "x".repeat(2 * 1024 * 1024),
      }));
      expect(
        await realAsk({ authorityOf: () => authorityX.caPem })({ ...PEER, url: server.url }),
      ).toBeNull();
    });

    it("control: the global fetch gets no answer from the same box", async () => {
      const server = await statusServer(authorityX, (q) => sign(body(q.nonce)));
      expect(await realAsk({ fetch: globalThis.fetch })({ ...PEER, url: server.url })).toBeNull();
      expect(server.requests).toHaveLength(0);
    });
  });

  describe("a .local box's address heard from the venue's network (the second read's five cases)", () => {
    const NAME = "box-7f3a.waitron.local";
    let named: BoxAuthority;
    let checked: boxTransport.CheckedAddresses;
    let heard: boxTransport.BoxLookup;
    let exchange: { mockRestore: () => void };
    const nobody = () => Promise.reject(new AppError("mirror.peer_unresolved", {}));
    const fresh =
      (...addresses: string[]) =>
      () =>
        Promise.resolve({ addresses, remembered: false });
    beforeAll(async () => {
      named = await mintBoxAuthority([NAME]);
    });
    beforeEach(() => {
      checked = new boxTransport.CheckedAddresses();
      heard = nobody;
      const real = boxTransport.boxExchange;
      exchange = vi
        .spyOn(boxTransport, "boxExchange")
        .mockImplementation((url, options, maxBytes) =>
          real(url, { ...options, lookup: (h, a) => heard(h, a), checked }, maxBytes),
        );
    });
    afterEach(() => {
      exchange.mockRestore();
    });

    async function mainBox() {
      const server = await statusServer(named, (q) => sign(body(q.nonce)));
      const port = new URL(server.url).port;
      const switchOff = async () => {
        servers.splice(servers.indexOf(server), 1);
        await server.close();
      };
      return { server, port, switchOff };
    }
    async function askAt(port: string, timeoutMs = 5000) {
      const onSilent = vi.fn();
      const answer = await realAsk({ timeoutMs, authorityOf: () => named.caPem, onSilent })({
        ...PEER,
        url: `https://${NAME}:${port}`,
      });
      return { answer, reasons: onSilent.mock.calls.map(([, why]) => why as string) };
    }
    /** Asks once while only the live box answers, so this box has reached it under its authority. */
    async function reachedOnce(box: { port: string }) {
      heard = fresh("127.0.0.1");
      expect((await askAt(box.port)).answer).not.toBeNull();
    }

    it("row 1: the main box switched off and nobody answering for its name is unreachable", async () => {
      const box = await mainBox();
      await reachedOnce(box);
      await box.switchOff();
      heard = nobody;

      expect(await askAt(box.port)).toEqual({ answer: null, reasons: ["unreachable"] });
    });

    it("row 2: only the live box answering is an answer", async () => {
      const box = await mainBox();
      heard = fresh("127.0.0.1");

      expect((await askAt(box.port)).answer).toEqual(body(box.server.lastNonce()));
    });

    it("row 3: a dead claimed address ahead of the live box still reaches the live box", async () => {
      const box = await mainBox();
      heard = fresh("::1", "127.0.0.1");

      expect((await askAt(box.port)).answer).toEqual(body(box.server.lastNonce()));
      expect(box.server.requests).toHaveLength(1);
    });

    it("row 4: the ask's limit ending before any connection, while claimed addresses stand in the way, is not established", async () => {
      const box = await mainBox();
      heard = () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ addresses: ["::1", "127.0.0.1"], remembered: false }), 300),
        );

      expect(await askAt(box.port, 50)).toEqual({ answer: null, reasons: ["not_established"] });
      expect(box.server.requests).toHaveLength(0);
    });

    it("row 5: an only answer with nothing listening is not established when nothing was reached before", async () => {
      const box = await mainBox();
      heard = fresh("::1");

      expect(await askAt(box.port)).toEqual({ answer: null, reasons: ["not_established"] });
      expect(box.server.requests).toHaveLength(0);
    });

    it("row 5: an only answer with nothing listening does not hide the live box at the address reached before", async () => {
      const box = await mainBox();
      await reachedOnce(box);
      heard = fresh("::1");

      expect((await askAt(box.port)).answer).toEqual(body(box.server.lastNonce()));
    });

    it("an address reached before that refuses, while a claimed address accepts the connection, is not established", async () => {
      const box = await mainBox();
      await reachedOnce(box);
      await box.switchOff();
      const held = new Set<Socket>();
      const claimant = createTcpServer((socket) => {
        held.add(socket);
        socket.on("error", () => {});
      });
      await new Promise<void>((done) => claimant.listen(Number(box.port), "::1", done));
      heard = fresh("::1");
      try {
        expect(await askAt(box.port, 1000)).toEqual({
          answer: null,
          reasons: ["not_established"],
        });
        expect(held.size).toBe(1);
      } finally {
        for (const socket of held) socket.destroy();
        await new Promise<void>((done) => claimant.close(() => done()));
      }
    });

    it("an address reached before that refuses, with the network still asked when the limit ends, is unreachable", async () => {
      const box = await mainBox();
      await reachedOnce(box);
      await box.switchOff();
      heard = () => new Promise(() => {});

      expect(await askAt(box.port, 300)).toEqual({ answer: null, reasons: ["unreachable"] });
    });
  });

  it("a refused connection at an address the chart writes out is not established when this box never reached it", async () => {
    const [port] = await freePorts(1);
    const onSilent = vi.fn();
    expect(
      await realAsk({ authorityOf: () => authorityX.caPem, onSilent })({
        ...PEER,
        url: `https://127.0.0.1:${port}`,
      }),
    ).toBeNull();
    expect(onSilent).toHaveBeenCalledWith(SPARE, "not_established");
  });

  it("a plain-http peer is asked over plain http", async () => {
    let nonce = "";
    const server = createHttpServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        nonce = (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { body: { nonce: string } })
          .body.nonce;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(sign(body(nonce))));
      });
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    try {
      const { port } = server.address() as AddressInfo;
      const answer = await realAsk({})({ ...PEER, url: `http://127.0.0.1:${port}` });
      expect(answer).toEqual(body(nonce));
    } finally {
      await new Promise((done) => server.close(done));
    }
  });

  it("reports why an ask got no answer", async () => {
    const onSilent = vi.fn();
    const { fetchFn } = answerWith((q) => body(q.nonce));
    const real = askPeerStatus({
      sign: async (b) =>
        signEnvelope("query", b, { nodeId: SELF, privateKey: selfKeys.privateKey }),
      publicKeyOf: (id) => keys[id],
      fetch: fetchFn,
      onSilent,
    });
    expect(await real(PEER)).toBeNull();
    expect(onSilent).toHaveBeenCalledWith(SPARE, "not_verified");
  });

  it("reports a box no other box answers for apart from one it could not reach", async () => {
    const onSilent = vi.fn();
    const real = askPeerStatus({
      sign: async (b) =>
        signEnvelope("query", b, { nodeId: SELF, privateKey: selfKeys.privateKey }),
      publicKeyOf: (id) => keys[id],
      fetch: () => Promise.reject(new AppError("mirror.peer_unresolved", {})),
      onSilent,
    });
    expect(await real(PEER)).toBeNull();
    expect(onSilent).toHaveBeenCalledWith(SPARE, "unresolved");
  });
});
