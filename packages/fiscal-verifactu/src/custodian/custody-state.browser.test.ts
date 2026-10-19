import { afterEach, expect, it, vi } from "vitest";
afterEach(() => vi.restoreAllMocks());
import { CustodySession } from "./custody-state.js";
import { custodyPassphrase, custodyRequest } from "../testing/custodian-fixture.js";

const refused = { message: "Custody material refused" };

it("never creates a replacement when the current-master answer is yes", async () => {
  const session = new CustodySession("new");
  await session.loadRequest(await custodyRequest());
  session.answerMaster(true);
  await expect(session.createKit("Elena")).rejects.toMatchObject(refused);
  expect(session.mode).toBe("existing");
  expect(session.publicKit).toBeNull();
});

it("refuses changed candidate rows, incomplete purposes and unknown/secret request fields before any document", async () => {
  const request = await custodyRequest();
  for (const invalid of [
    { ...request, candidateDigest: "0".repeat(64) },
    { ...request, privateKey: "PRIVATE-SENTINEL" },
    { ...request, binding: { ...request.binding, sourceId: "other" } },
    {
      ...request,
      candidates: [{ ...request.candidates[0], series: request.candidates[0]!.series.slice(1) }],
    },
  ]) {
    const session = new CustodySession("new");
    await expect(session.loadRequest(invalid)).rejects.toMatchObject(refused);
    expect(() => session.originalDocument("en")).toThrow("Custody material refused");
  }
});

it("locks original issue before print outcome and never treats afterprint/cancellation as success", async () => {
  const session = new CustodySession("new");
  const request = await custodyRequest();
  await session.loadRequest(request);
  session.answerMaster(false);
  await session.createKit("Elena");
  const original = session.originalDocument("en");
  expect(original).toContain("PUBLIC ORIGINAL");
  expect(original).toContain("A-S000001");
  expect(original).toContain("UNASSIGNED");
  expect(original).toContain("event-1");
  expect(original).toContain("node-1");
  expect(original).toContain("administrator-1");
  expect(original).toContain("<th>Result</th>");
  expect(session.originalStatus).toBe("issued-unknown");
  expect(() => session.originalDocument("en")).toThrow("Custody material refused");
  window.dispatchEvent(new Event("afterprint"));
  expect(session.originalStatus).toBe("issued-unknown");
  session.reconcileOriginal("spoiled", "print cancelled; destroyed sheet");
  expect(session.state).toBe("stopped");
  expect(session.incidentRecord()).toMatchObject({
    incidents: [
      { reason: "original-issued-unknown" },
      { reason: "spoiled-original", detail: "print cancelled; destroyed sheet" },
    ],
  });
  await expect(session.loadRequest(request)).rejects.toMatchObject(refused);
  await expect(session.createKit("Elena")).rejects.toMatchObject(refused);
});

it.each(["master-lost", "keys-lost", "uncertain", "disputed"] as const)(
  "retains public attempt evidence and stops for %s without a reset",
  async (reason) => {
    const session = new CustodySession("new");
    await session.loadRequest(await custodyRequest());
    session.answerMaster(false);
    await session.createKit("Elena");
    session.stop(reason, "incident 12");
    expect(session.state).toBe("stopped");
    expect(session.incidentRecord()).toMatchObject({
      attemptId: "attempt-1",
      incidents: [{ reason, detail: "incident 12" }],
    });
    await expect(session.protectedFile(custodyPassphrase, custodyPassphrase)).rejects.toMatchObject(
      refused,
    );
    await expect(session.consume("allocation-1", "master line 1")).rejects.toMatchObject(refused);
  },
);

it("does not discard a new kit's sole in-memory key before both explicit key outputs and original reconciliation", async () => {
  const session = new CustodySession("new");
  await session.loadRequest(await custodyRequest());
  session.answerMaster(false);
  await session.createKit("Elena");
  expect(() => session.beginFileCheck()).toThrow("Custody material refused");
  session.originalDocument("en");
  session.reconcileOriginal("kept", "original checked");
  expect(() => session.beginFileCheck()).toThrow("Custody material refused");
  const file = await session.protectedFile(custodyPassphrase, custodyPassphrase);
  expect(() => session.beginFileCheck()).toThrow("Custody material refused");
  await session.secretDocument("en");
  session.beginFileCheck();
  const receipt = await session.reopenFile(new File([file], "saved.json"), custodyPassphrase);
  expect(receipt.kind).toBe("saved-file");
  expect(session.state).toBe("paper-check-pending");
  session.close();
});

it("does not repopulate a closed custody session from a late public request parse", async () => {
  const request = await custodyRequest();
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
    entered();
    await gate;
    return digest(...args);
  });
  const session = new CustodySession("new");
  const pending = session.loadRequest(request);
  const refusedResult = expect(pending).rejects.toMatchObject(refused);
  await started;
  session.close();
  release();
  await refusedResult;
  expect(session.request).toBeNull();
  expect(session.publicKit).toBeNull();
  expect(() => session.answerMaster(false)).toThrow("Custody material refused");
});

it.each([
  "load-request-twice",
  "answer-before-request",
  "answer-twice",
  "kit-before-answer",
  "print-before-kit",
  "reconcile-before-print",
  "protect-before-key",
  "paper-before-key",
  "file-check-before-kit",
  "reopen-before-check",
  "paper-check-outside-recovery",
  "verify-before-key",
  "attest-before-verification",
  "reserve-before-verification",
  "consume-before-verification",
  "snapshot-before-consumption",
  "handover-before-kit",
  "finish-before-handover",
])("refuses %s without fabricating custody evidence", async (operation) => {
  const session = new CustodySession("new");
  const request = await custodyRequest();
  const actions: Record<string, () => unknown> = {
    "load-request-twice": async () => {
      await session.loadRequest(request);
      await session.loadRequest(request);
    },
    "answer-before-request": () => session.answerMaster(false),
    "answer-twice": async () => {
      await session.loadRequest(request);
      session.answerMaster(false);
      session.answerMaster(false);
    },
    "kit-before-answer": () => session.createKit("Elena"),
    "print-before-kit": () => session.originalDocument("en"),
    "reconcile-before-print": () => session.reconcileOriginal("kept", "not printed"),
    "protect-before-key": () => session.protectedFile(custodyPassphrase, custodyPassphrase),
    "paper-before-key": () => session.secretDocument("en"),
    "file-check-before-kit": () => session.beginFileCheck(),
    "reopen-before-check": () =>
      session.reopenFile(new File(["{}"], "key.json"), custodyPassphrase),
    "paper-check-outside-recovery": () => session.checkPaper("untrusted", "0".repeat(64)),
    "verify-before-key": () => session.verifyChecks({}, {}),
    "attest-before-verification": () => session.attestCustody({}, "0".repeat(64)),
    "reserve-before-verification": () => session.reserve({}),
    "consume-before-verification": () => session.consume("allocation-1", "row 1"),
    "snapshot-before-consumption": () => session.snapshotDocument("en"),
    "handover-before-kit": () => session.beginHandover("María"),
    "finish-before-handover": () => session.finishHandover({ transferred: true }),
  };
  try {
    await expect(Promise.resolve().then(actions[operation]!)).rejects.toMatchObject(refused);
    expect(session.publicKit).toBeNull();
    expect(session.checkReceipts).toEqual([]);
    expect(session.signedBlock).toBeNull();
    expect(session.originalStatus).toBe("unissued");
  } finally {
    session.close();
  }
});

it.each(["missing purpose", "extra base field", "wrong candidate scope"])(
  "refuses %s even when the submitted candidate digest matches",
  async (kind) => {
    const request = await custodyRequest();
    request.requiredBases = request.requiredBases.map((base) => ({ ...base }));
    if (kind === "missing purpose") request.requiredBases[1] = { code: "B", purpose: "standard" };
    if (kind === "extra base field") Object.assign(request.requiredBases[0]!, { approved: true });
    if (kind === "wrong candidate scope") {
      request.candidates[0] = { ...request.candidates[0]!, taxpayerNif: "B87654321" };
      const hash = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify(request.candidates)),
        ),
      );
      request.candidateDigest = Array.from(hash, (x) => x.toString(16).padStart(2, "0")).join("");
    }
    const session = new CustodySession("new");
    try {
      await expect(session.loadRequest(request)).rejects.toMatchObject(refused);
      expect(session.request).toBeNull();
      expect(session.publicKit).toBeNull();
    } finally {
      session.close();
    }
  },
);

it("does not install a kit whose public-key inspection completes after close", async () => {
  const source = new CustodySession("new");
  await source.loadRequest(await custodyRequest());
  source.answerMaster(false);
  await source.createKit("Elena");
  const publicKit = source.publicKit!;
  source.close();
  const realDigest = crypto.subtle.digest.bind(crypto.subtle);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
    entered();
    await gate;
    return realDigest(...args);
  });
  const session = new CustodySession("resume");
  const pending = session.loadKitRequest(publicKit);
  const result = expect(pending).rejects.toMatchObject(refused);
  await started;
  session.close();
  release();
  await result;
  expect(session.state).toBe("stopped");
  expect(session.publicKit).toBeNull();
  expect(session.checkReceipts).toEqual([]);
});

it("refuses a concurrent public request import while the first request is being checked", async () => {
  const request = await custodyRequest();
  const other = {
    ...request,
    attemptId: "other-attempt",
    recipientVenueId: "first-setup:other-attempt",
    binding: { ...request.binding, sourceId: "first-setup:other-attempt" },
  };
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
    entered();
    await gate;
    return digest(...args);
  });
  const session = new CustodySession("new");
  try {
    const first = session.loadRequest(request);
    await started;
    const second = expect(session.loadRequest(other)).rejects.toMatchObject(refused);
    release();
    await first;
    await second;
    expect(session.request).toEqual(request);
    expect(session.publicKit).toBeNull();
  } finally {
    release();
    session.close();
  }
});
