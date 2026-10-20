import { afterEach, expect, it, vi } from "vitest";
import { CustodySession } from "./custody-state.js";
import { custodyPassphrase, custodyRequest } from "../testing/custodian-fixture.js";
import { createCustodyKey, protectCustodyKey } from "./key-codec.js";
import { encodeSecretPaper } from "./paper-codec.js";
import { paperBlockBytes, paperConsumptionBytes } from "../paper-protocol.js";

const refused = { message: "Custody material refused" };
afterEach(() => vi.restoreAllMocks());

async function kit() {
  const session = new CustodySession("new");
  const request = await custodyRequest();
  await session.loadRequest(request);
  session.answerMaster(false);
  await session.createKit("Elena");
  const file = await session.protectedFile(custodyPassphrase, custodyPassphrase);
  const paper = await session.secretDocument("en");
  session.originalDocument("en");
  session.reconcileOriginal("kept", "original held by Elena");
  return { session, request, file, paper, publicKit: session.publicKit! };
}

it("a download/Blob is unchecked; file mode disposes the generated key and only reopening selected bytes produces a receipt", async () => {
  const { session, file, publicKit } = await kit();
  expect(session.state).toBe("file-saved-unchecked");
  expect(new Blob([file]).size).toBeGreaterThan(0);
  await expect(session.consume("allocation-1", "master line 1")).rejects.toMatchObject(refused);
  session.beginFileCheck();
  await expect(session.secretDocument("en")).rejects.toMatchObject(refused);
  await expect(
    session.reopenFile(new File([file], "key.json"), "wrong-passphrase"),
  ).rejects.toMatchObject(refused);
  expect(session.state).toBe("file-saved-unchecked");
  const receipt = await session.reopenFile(new File([file], "key.json"), custodyPassphrase);
  expect(receipt).toMatchObject({
    requestId: publicKit.requestId,
    kind: "saved-file",
    fingerprint: publicKit.public.fingerprint,
  });
  expect(session.state).toBe("paper-check-pending");
});

it("synthetic paper control in a separate recovery-only session matches the full fingerprint before challenge", async () => {
  const { session, paper, publicKit } = await kit();
  session.close();
  const recovery = new CustodySession("recovery");
  await recovery.loadKitRequest(publicKit);
  await expect(recovery.createKit("Elena")).rejects.toMatchObject(refused);
  await expect(
    recovery.reopenFile(new File(["{}"], "key.json"), custodyPassphrase),
  ).rejects.toMatchObject(refused);
  const text = new DOMParser()
    .parseFromString(paper, "text/html")
    .querySelector("pre")!.textContent!;
  await expect(recovery.checkPaper(text, "0".repeat(64))).rejects.toMatchObject(refused);
  const receipt = await recovery.checkPaper(text, publicKit.public.fingerprint);
  expect(receipt).toMatchObject({
    kind: "secret-paper",
    fingerprint: publicKit.public.fingerprint,
    requestId: publicKit.requestId,
  });
  await expect(recovery.consume("allocation-1", "master line 1")).rejects.toMatchObject(refused);
});

it("a different valid file or paper never succeeds or falls back to the original key", async () => {
  const { session, publicKit } = await kit();
  const other = await createCustodyKey(publicKit.public.scope);
  const file = await protectCustodyKey(other, custodyPassphrase);
  const paper = await encodeSecretPaper(other);
  other.dispose();
  session.beginFileCheck();
  await expect(
    session.reopenFile(new File([file], "key.json"), custodyPassphrase),
  ).rejects.toMatchObject(refused);
  const recovery = new CustodySession("recovery");
  await recovery.loadKitRequest(publicKit);
  await expect(recovery.checkPaper(paper, publicKit.public.fingerprint)).rejects.toMatchObject(
    refused,
  );
  expect(recovery.checkReceipts).toEqual([]);
  expect(session.checkReceipts).toEqual([]);
});

const attestation = {
  sameCurrentMaster: true,
  actualPaperCleanSession: true,
  originalIssueRecorded: true,
  custodyAccepted: true,
};
const reservation = {
  currentOriginal: true,
  otherSystemsChecked: true,
  rowsReservedInInk: true,
  oldMachineAbsent: true,
  noParallelSetup: true,
  incidentEvidence: "original page 1, rows 1–2",
};

async function reopened() {
  const source = await kit();
  const paperText = new DOMParser()
    .parseFromString(source.paper, "text/html")
    .querySelector("pre")!.textContent!;
  source.session.close();
  const recovery = new CustodySession("recovery");
  await recovery.loadKitRequest(source.publicKit);
  const paperReceipt = await recovery.checkPaper(paperText, source.publicKit.public.fingerprint);
  recovery.close();
  const resume = new CustodySession("resume");
  await resume.loadRequest(source.request);
  await resume.loadKitRequest(source.publicKit);
  resume.beginFileCheck();
  const fileReceipt = await resume.reopenFile(
    new File([source.file], "selected-saved-key.json"),
    custodyPassphrase,
  );
  return { ...source, resume, fileReceipt, paperReceipt, paperText };
}

it("a resumed signer requires both genuine distinct receipts plus explicit actual-paper/original custody before reservation", async () => {
  const { resume, fileReceipt, paperReceipt, publicKit } = await reopened();
  expect(() => resume.attestCustody(attestation, publicKit.public.fingerprint)).toThrow(
    "Custody material refused",
  );
  await expect(
    resume.verifyChecks(fileReceipt, { ...paperReceipt, kind: "saved-file" }),
  ).rejects.toMatchObject(refused);
  expect(() => resume.reserve(reservation)).toThrow("Custody material refused");
  // A failed import claims its file nonce; produce a genuinely fresh file check.
  const replacement = await reopened();
  await replacement.resume.verifyChecks(replacement.fileReceipt, replacement.paperReceipt);
  expect(replacement.resume.state).toBe("file-checked");
  expect(() =>
    replacement.resume.attestCustody(
      { ...attestation, actualPaperCleanSession: false },
      replacement.publicKit.public.fingerprint,
    ),
  ).toThrow("Custody material refused");
  replacement.resume.attestCustody(attestation, replacement.publicKit.public.fingerprint);
  expect(replacement.resume.state).toBe("ready");
  expect(() => replacement.resume.reserve({ ...reservation, otherSystemsChecked: false })).toThrow(
    "Custody material refused",
  );
  await expect(replacement.resume.consume("allocation-1", "row 1")).rejects.toMatchObject(refused);
  replacement.resume.reserve(reservation);
  expect(replacement.resume.incidentRecord().incidents).toContainEqual({
    reason: "reserved-in-ink",
    detail: reservation.incidentEvidence,
  });
  resume.close();
  replacement.resume.close();
});

it("exports only the frozen public block/allocation and consumption/approval with Node-compatible bytes; repeats stay consumed", async () => {
  const { resume, fileReceipt, paperReceipt, publicKit, request } = await reopened();
  await resume.verifyChecks(fileReceipt, paperReceipt);
  resume.attestCustody(attestation, publicKit.public.fingerprint);
  resume.reserve(reservation);
  await expect(resume.consume("not-in-request", "row 1")).rejects.toMatchObject(refused);
  const input = await resume.consume("allocation-1", "master page 1 row 1");
  expect(Object.keys(input)).toEqual(["allocation", "approval"]);
  expect(input.allocation).toMatchObject(request.candidates[0]!);
  expect(input.approval).toMatchObject({
    version: 1,
    eventId: "event-1",
    operatorId: "administrator-1",
    sourceId: "first-setup:attempt-1",
    targetNodeId: "node-1",
    oldMachineAbsent: true,
    oldMachineOffline: false,
    noParallelRecovery: true,
    incidentEvidence: "master page 1 row 1",
  });
  const { block, consumption } = input.allocation.reservationEvidence;
  expect(resume.signedBlock).toEqual(block);
  expect(block.payload.allocations).toEqual(request.candidates);
  const pem = publicKit.public.publicKey.replace(/-----[^-]+-----|\s/g, "");
  const key = await crypto.subtle.importKey(
    "spki",
    Uint8Array.from(atob(pem), (x) => x.charCodeAt(0)),
    "Ed25519",
    false,
    ["verify"],
  );
  for (const [bytes, signed] of [
    [paperBlockBytes(block.payload), block],
    [paperConsumptionBytes(consumption.payload), consumption],
  ] as const) {
    const signature = Uint8Array.from(
      atob(signed.signature.replaceAll("-", "+").replaceAll("_", "/") + "=="),
      (x) => x.charCodeAt(0),
    );
    expect(await crypto.subtle.verify("Ed25519", key, signature, new Uint8Array(bytes))).toBe(true);
  }
  const snapshot = resume.snapshotDocument("es");
  expect(snapshot).toContain("A-S000001 / Ordinarias");
  expect(snapshot).toContain("FF-S000001 / Completas");
  expect(snapshot).toContain("R-S000001 / Rectificativas");
  expect(snapshot).toContain("W1 / Producción");
  expect(snapshot).toContain("COPIA PÚBLICA");
  expect(snapshot).toContain("No sustituye al original");
  expect(snapshot).not.toContain("ORIGINAL PÚBLICO</h1>");
  expect(() => resume.originalDocument("en")).toThrow("Custody material refused");
  await expect(resume.consume("allocation-1", "retry")).rejects.toMatchObject(refused);
  await expect(resume.verifyChecks(fileReceipt, paperReceipt)).rejects.toMatchObject(refused);
  expect(JSON.stringify(input)).not.toMatch(/pkcs8|ciphertext|passphrase|secret-paper/);
  expect(resume.incidentRecord().incidents).toContainEqual({
    reason: "consumed",
    detail: "allocation-1: master page 1 row 1",
  });
  resume.close();
});

it("handover disposes the old signer, stops assignments and requires successor checks and retained-copy accounting", async () => {
  const { resume, fileReceipt, paperReceipt, publicKit, file, paperText } = await reopened();
  await resume.verifyChecks(fileReceipt, paperReceipt);
  resume.attestCustody(attestation, publicKit.public.fingerprint);
  resume.beginHandover("María");
  expect(resume.state).toBe("handover");
  expect(() => resume.reserve(reservation)).toThrow("Custody material refused");
  expect(() =>
    resume.finishHandover({ transferred: true, currentOriginal: true, retainedCopies: "none" }),
  ).toThrow("Custody material refused");
  await expect(resume.verifyChecks(fileReceipt, paperReceipt)).rejects.toMatchObject(refused);
  const fileCheck = await resume.reopenFile(
    new File([file], "successor-selected.json"),
    custodyPassphrase,
  );
  const recovery = new CustodySession("recovery");
  await recovery.loadKitRequest(publicKit);
  const paperCheck = await recovery.checkPaper(paperText, publicKit.public.fingerprint);
  recovery.close();
  await resume.verifyChecks(fileCheck, paperCheck);
  resume.finishHandover({
    transferred: true,
    currentOriginal: true,
    retainedCopies: "Elena retains one sealed copy, recorded on original",
  });
  expect(resume.state).toBe("ready");
  expect(resume.incidentRecord().incidents).toContainEqual({
    reason: "handover-complete",
    detail: "María: Elena retains one sealed copy, recorded on original",
  });
  expect(() => resume.originalDocument("en")).toThrow("Custody material refused");
  resume.close();
});

it("refuses two otherwise valid distinct-kind receipts sharing a nonce", async () => {
  const source = await kit();
  const paperText = new DOMParser()
    .parseFromString(source.paper, "text/html")
    .querySelector("pre")!.textContent!;
  source.session.close();
  const resume = new CustodySession("resume");
  await resume.loadRequest(source.request);
  await resume.loadKitRequest(source.publicKit);
  resume.beginFileCheck();
  const recovery = new CustodySession("recovery");
  await recovery.loadKitRequest(source.publicKit);
  vi.spyOn(crypto, "getRandomValues").mockImplementation((target) => {
    if (target) new Uint8Array(target.buffer, target.byteOffset, target.byteLength).fill(7);
    return target;
  });
  const fileReceipt = await resume.reopenFile(
    new File([source.file], "saved.json"),
    custodyPassphrase,
  );
  const paperReceipt = await recovery.checkPaper(paperText, source.publicKit.public.fingerprint);
  expect(fileReceipt.nonce).toBe(paperReceipt.nonce);
  await expect(resume.verifyChecks(fileReceipt, paperReceipt)).rejects.toMatchObject(refused);
  expect(() => resume.attestCustody(attestation, source.publicKit.public.fingerprint)).toThrow(
    "Custody material refused",
  );
  resume.close();
  recovery.close();
});

it("a close while reopening prevents late key acceptance and leaves no recoverable signer", async () => {
  const { session, file } = await kit();
  session.beginFileCheck();
  const pending = session.reopenFile(new File([file], "saved.json"), custodyPassphrase);
  session.close();
  await expect(pending).rejects.toMatchObject(refused);
  expect(session.state).toBe("stopped");
  expect(session.checkReceipts).toEqual([]);
  await expect(session.secretDocument("en")).rejects.toMatchObject(refused);
});

it("a failed later reopen drops the previously checked signer and reservation grant instead of falling back", async () => {
  const { resume, fileReceipt, paperReceipt, publicKit, file } = await reopened();
  await resume.verifyChecks(fileReceipt, paperReceipt);
  resume.attestCustody(attestation, publicKit.public.fingerprint);
  resume.reserve(reservation);
  await expect(
    resume.reopenFile(new File([file], "selected-again.json"), "wrong passphrase"),
  ).rejects.toMatchObject(refused);
  await expect(resume.consume("allocation-1", "master row 1")).rejects.toMatchObject(refused);
  expect(resume.state).toBe("file-saved-unchecked");
  expect(resume.incidentRecord().incidents).toContainEqual({
    reason: "reserved-in-ink",
    detail: reservation.incidentEvidence,
  });
  resume.close();
});

it("a kit check request cannot carry success flags, secret fields, a replacement request id or another scope", async () => {
  const source = await kit();
  source.session.close();
  for (const value of [
    { ...source.publicKit, complete: true },
    { ...source.publicKit, privateKey: "PRIVATE-SENTINEL" },
    { ...source.publicKit, version: 2 },
    { ...source.publicKit, requestId: "" },
    {
      ...source.publicKit,
      public: {
        ...source.publicKit.public,
        scope: { ...source.publicKit.public.scope, taxpayerNif: "89890001K" },
      },
    },
  ]) {
    const resume = new CustodySession("resume");
    await resume.loadRequest(source.request);
    await expect(resume.loadKitRequest(value)).rejects.toMatchObject(refused);
    expect(resume.publicKit).toBeNull();
    resume.close();
  }
  const resume = new CustodySession("resume");
  await resume.loadKitRequest(source.publicKit);
  await expect(resume.loadKitRequest(source.publicKit)).rejects.toMatchObject(refused);
  await expect(
    resume.loadRequest({ ...source.request, environment: "preproduction" }),
  ).rejects.toMatchObject(refused);
  resume.close();
});

it("refuses a forged saved-file receipt even when the paper receipt is genuine", async () => {
  const { resume, fileReceipt, paperReceipt, publicKit } = await reopened();
  try {
    const signature =
      (fileReceipt.signature.startsWith("A") ? "B" : "A") + fileReceipt.signature.slice(1);
    await expect(
      resume.verifyChecks({ ...fileReceipt, signature }, paperReceipt),
    ).rejects.toMatchObject(refused);
    expect(resume.state).toBe("paper-check-pending");
    expect(() => resume.attestCustody(attestation, publicKit.public.fingerprint)).toThrow(
      "Custody material refused",
    );
    expect(() => resume.reserve(reservation)).toThrow("Custody material refused");
  } finally {
    resume.close();
  }
});

it.each(["not a file", "oversized file"])(
  "refuses %s after dropping the checked signer",
  async (kind) => {
    const { resume, fileReceipt, paperReceipt, publicKit } = await reopened();
    try {
      await resume.verifyChecks(fileReceipt, paperReceipt);
      resume.attestCustody(attestation, publicKit.public.fingerprint);
      resume.reserve(reservation);
      const file =
        kind === "not a file"
          ? (new Blob(["{}"]) as File)
          : new File([new Uint8Array(16385)], "too-large.json");
      await expect(resume.reopenFile(file, custodyPassphrase)).rejects.toMatchObject(refused);
      expect(resume.state).toBe("file-saved-unchecked");
      await expect(resume.consume("allocation-1", "row 1")).rejects.toMatchObject(refused);
      expect(resume.signedBlock).toBeNull();
    } finally {
      resume.close();
    }
  },
);

it("a failed signature leaves consumption recorded and the signer stopped", async () => {
  const { resume, fileReceipt, paperReceipt, publicKit } = await reopened();
  try {
    await resume.verifyChecks(fileReceipt, paperReceipt);
    resume.attestCustody(attestation, publicKit.public.fingerprint);
    resume.reserve(reservation);
    vi.spyOn(crypto.subtle, "sign").mockRejectedValue(new Error("synthetic signer failure"));
    await expect(resume.consume("allocation-1", "original row 1")).rejects.toMatchObject(refused);
    expect(resume.state).toBe("stopped");
    expect(resume.signedBlock).toBeNull();
    expect(resume.incidentRecord().incidents).toContainEqual({
      reason: "consumed",
      detail: "allocation-1: original row 1",
    });
    await expect(resume.consume("allocation-1", "retry row 1")).rejects.toMatchObject(refused);
  } finally {
    resume.close();
  }
});

it("a blank stop reason or account of the incident does not discard the current kit", async () => {
  const { session, publicKit } = await kit();
  try {
    for (const [reason, detail] of [
      ["", "incident"],
      ["keys-lost", " "],
    ])
      expect(() => session.stop(reason!, detail!)).toThrow("Custody material refused");
    expect(session.publicKit).toEqual(publicKit);
    expect(session.state).toBe("file-saved-unchecked");
    expect(session.incidentRecord().incidents.map((i) => i.reason)).toEqual([
      "original-issued-unknown",
      "original-kept",
    ]);
  } finally {
    session.close();
  }
});
