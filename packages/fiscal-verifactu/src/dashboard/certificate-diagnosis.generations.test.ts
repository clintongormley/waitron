import { expect, it, vi } from "vitest";
import { DiagnosisState } from "./certificate-diagnosis-state.js";
import { evidence, held, permission, savedCard } from "../../test/diagnosis-browser-fixtures.js";
import type { AeatCertificateClient } from "./client.js";
import type {
  CertificateDiagnosisRequest,
  CertificateDiagnosisResult,
} from "../certificate-diagnosis-contract.js";
function setup() {
  const calls: {
    body: CertificateDiagnosisRequest;
    signal: AbortSignal;
    wait: ReturnType<typeof held<CertificateDiagnosisResult>>;
  }[] = [];
  const auth = permission();
  const changed = vi.fn();
  const client = {
    diagnose(body: CertificateDiagnosisRequest, signal: AbortSignal) {
      const wait = held<CertificateDiagnosisResult>();
      calls.push({ body, signal, wait });
      return wait.promise;
    },
  } as AeatCertificateClient;
  const state = new DiagnosisState({ client, permissionContinuation: auth.hook, changed });
  const open = () => {
    state.open({ source: "installed", savedCard, candidate: null });
    state.confirmSource();
  };
  open();
  return { state, calls, auth, open, changed };
}
it("requires a local preview before network work and prevents duplicate attempts", async () => {
  const { state, calls } = setup();
  const withoutPreview = state.run("check");
  expect(calls).toHaveLength(0);
  await withoutPreview;
  const first = state.run("inspect");
  void state.run("inspect");
  expect(calls).toHaveLength(1);
  calls[0]!.wait.resolve(evidence(calls[0]!.body));
  await first;
  const second = state.run("check");
  expect(calls).toHaveLength(2);
  calls[1]!.wait.resolve(evidence(calls[1]!.body));
  await second;
  expect(state.view.result?.category).toBe("query-completed");
  state.stop();
});
it.each(["reopen", "source", "account"] as const)(
  "ignores old answer and finally after %s while a newer attempt runs",
  async (mode) => {
    const { state, calls, auth, open } = setup();
    const old = state.run("inspect");
    if (mode === "reopen") {
      state.stop();
      open();
    } else if (mode === "source") {
      state.invalidateSource();
      open();
    } else {
      auth.change();
      expect(state.view.needsSourceConfirmation).toBe(true);
      state.confirmSource();
    }
    const newer = state.run("inspect");
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls).toHaveLength(2);
    calls[0]!.wait.resolve(evidence(calls[0]!.body));
    await old;
    expect(state.view.busy).toBe(true);
    expect(state.view.result).toBeNull();
    calls[1]!.wait.resolve(evidence(calls[1]!.body));
    await newer;
    expect(state.view.busy).toBe(false);
    expect(state.view.result).not.toBeNull();
    state.stop();
  },
);
it("drops a delayed candidate read on account change before any POST", async () => {
  const { state, calls, auth } = setup();
  const bytes = held<ArrayBuffer>();
  const file = new File(["a"], "PRIVATE_NAME.p12");
  vi.spyOn(file, "arrayBuffer").mockReturnValue(bytes.promise);
  state.open({
    source: "candidate",
    savedCard,
    candidate: { file, passphrase: "PRIVATE_PASS", certKind: "representante", sourceGeneration: 7 },
  });
  state.confirmSource();
  const run = state.run("inspect");
  auth.change();
  bytes.resolve(new Uint8Array([1]).buffer);
  await run;
  expect(calls).toHaveLength(0);
  expect(state.view.needsSourceConfirmation).toBe(true);
  state.confirmSource();
  const refused = state.run("inspect");
  await bytes.promise;
  expect(calls).toHaveLength(0);
  await refused;
  state.stop();
});
it("rejects mismatched response bindings and reports transport loss without remote evidence", async () => {
  const { state, calls } = setup();
  let run = state.run("inspect");
  calls[0]!.wait.resolve(
    evidence(calls[0]!.body, { binding: { expectedRevision: "different", sourceGeneration: 0 } }),
  );
  await run;
  expect(state.view.result).toBeNull();
  expect(state.view.resultUnavailable).toBe(true);
  run = state.run("inspect");
  calls[1]!.wait.reject(new Error("PRIVATE_ERROR"));
  await run;
  expect(state.view.result).toBeNull();
  expect(state.view.resultUnavailable).toBe(true);
  state.stop();
});
it("does no work without authority, filing eligibility, source or confirmation", async () => {
  const { state, calls, auth } = setup();
  auth.change(["fiscal.view"]);
  state.confirmSource();
  const refused = state.run("inspect");
  expect(calls).toHaveLength(0);
  await refused;
  auth.change();
  state.open({ source: "installed", savedCard: { ...savedCard, filing: false }, candidate: null });
  state.confirmSource();
  await state.run("inspect");
  expect(calls).toHaveLength(0);
  state.stop();
});
it.each([
  "management_session.required",
  "management_session.expired",
  "authorization.not_permitted",
])("%s requires fresh sign-in and cannot reuse a preview", async (code) => {
  const { state, calls, auth } = setup();
  let run = state.run("inspect");
  calls[0]!.wait.resolve(evidence(calls[0]!.body));
  await run;
  run = state.run("check");
  calls[1]!.wait.reject({ code, message: "PRIVATE_AUTH_FAILURE" });
  await run;
  expect(state.authorized).toBe(false);
  expect(state.view.result).toBeNull();
  expect(state.view.needsSourceConfirmation).toBe(true);
  await state.run("inspect");
  expect(calls).toHaveLength(2);
  auth.change();
  expect(state.authorized).toBe(true);
  expect(state.canCheck).toBe(false);
  expect(state.canInspect).toBe(false);
  state.stop();
});
it("a rejected local reread invalidates its earlier network preview", async () => {
  const { state, calls } = setup();
  let run = state.run("inspect");
  calls[0]!.wait.resolve(evidence(calls[0]!.body));
  await run;
  run = state.run("inspect");
  calls[1]!.wait.reject(new Error("PRIVATE_READ_FAILURE"));
  await run;
  expect(state.canCheck).toBe(false);
  expect(state.view.resultUnavailable).toBe(true);
  state.stop();
});
it("zeroes decoded candidate buffers even when reading finishes after Stop", async () => {
  const { state, calls } = setup();
  const wait = held<ArrayBuffer>();
  const file = new File(["x"], "PRIVATE.p12");
  vi.spyOn(file, "arrayBuffer").mockReturnValue(wait.promise);
  state.open({
    source: "candidate",
    savedCard,
    candidate: { file, passphrase: "PRIVATE", certKind: "sello", sourceGeneration: 0 },
  });
  state.confirmSource();
  const run = state.run("inspect");
  state.stop();
  const bytes = new Uint8Array([12, 34]);
  wait.resolve(bytes.buffer);
  await run;
  expect([...bytes]).toEqual([0, 0]);
  expect(calls).toHaveLength(0);
});
it("a late file read cannot borrow a reopened candidate's passphrase or release its busy state", async () => {
  const { state, calls } = setup();
  const wait = held<ArrayBuffer>();
  const old = new File(["old"], "old.p12");
  vi.spyOn(old, "arrayBuffer").mockReturnValue(wait.promise);
  state.open({
    source: "candidate",
    savedCard,
    candidate: { file: old, passphrase: "old-private", certKind: "sello", sourceGeneration: 0 },
  });
  state.confirmSource();
  const previous = state.run("inspect");
  state.stop();
  state.open({
    source: "candidate",
    savedCard,
    candidate: {
      file: new File([new Uint8Array([2])], "new.p12"),
      passphrase: "new-private",
      certKind: "representante",
      sourceGeneration: 1,
    },
  });
  state.confirmSource();
  const current = state.run("inspect");
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  wait.resolve(new Uint8Array([1]).buffer);
  await wait.promise;
  expect(calls).toHaveLength(1);
  await previous;
  expect(state.view.busy).toBe(true);
  expect(calls[0]!.body).toMatchObject({
    pfxBase64: "Ag==",
    passphrase: "new-private",
    certKind: "representante",
  });
  calls[0]!.wait.resolve(evidence(calls[0]!.body));
  await current;
  state.stop();
});
it("an unconfirmed opening never reaches transport", async () => {
  const { state, calls } = setup();
  state.open({ source: "installed", savedCard, candidate: null });
  const run = state.run("inspect");
  expect(calls).toHaveLength(0);
  await run;
  state.stop();
});
it("without a permission hook, the owner must explicitly grant management capability", async () => {
  const diagnose = vi.fn(async (body: CertificateDiagnosisRequest) => evidence(body));
  const state = new DiagnosisState({
    client: { diagnose } as unknown as AeatCertificateClient,
    changed() {},
  });
  state.open({ source: "installed", savedCard, candidate: null });
  state.confirmSource();
  const run = state.run("inspect");
  expect(diagnose).not.toHaveBeenCalled();
  await run;
  state.stop();
});
