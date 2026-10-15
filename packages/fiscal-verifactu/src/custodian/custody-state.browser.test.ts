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
