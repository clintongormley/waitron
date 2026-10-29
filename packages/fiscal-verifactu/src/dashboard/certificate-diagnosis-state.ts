import { codeOf, type DashboardPermissionContinuation } from "@waitron/dashboard-kit";
import { CERTIFICATE_MAX_BYTES } from "../certificate-limits.js";
import {
  parseCertificateDiagnosisResult,
  type CertificateDiagnosisRequest,
  type CertificateDiagnosisResult,
} from "../certificate-diagnosis-contract.js";
import type { AeatCertificateClient, CertificateCardView, CertificateKind } from "./client.js";

export type DiagnosisCandidate = {
  file: File;
  passphrase: string;
  certKind: CertificateKind;
  sourceGeneration: number;
};
type Source = "installed" | "candidate";
const returns = new WeakMap<DashboardPermissionContinuation, Source>();
export function rememberDiagnosisReturn(
  hook: DashboardPermissionContinuation,
  source: Source,
): void {
  returns.set(hook, source);
}
export function consumeDiagnosisReturn(hook: DashboardPermissionContinuation): Source | undefined {
  const source = returns.get(hook);
  returns.delete(hook);
  return source;
}
export function clearDiagnosisReturn(hook: DashboardPermissionContinuation): void {
  returns.delete(hook);
}

export class DiagnosisState {
  view: {
    source: Source;
    busy: boolean;
    result: CertificateDiagnosisResult | null;
    needsSourceConfirmation: boolean;
    resultUnavailable: boolean;
  } = {
    source: "installed",
    busy: false,
    result: null,
    needsSourceConfirmation: true,
    resultUnavailable: false,
  };
  #card?: CertificateCardView;
  #candidate: DiagnosisCandidate | null = null;
  #opening = 0;
  #source = 0;
  #attempt = 0;
  #account = 0;
  #abort?: AbortController;
  #unsubscribe?: () => void;
  #opened = false;
  #preview = false;
  #denied = false;
  constructor(
    private readonly deps: {
      client: AeatCertificateClient;
      permissionContinuation?: DashboardPermissionContinuation;
      changed(): void;
      canManage?(): boolean;
    },
  ) {}
  get authorized(): boolean {
    const snapshot = this.deps.permissionContinuation?.snapshot();
    if (this.#denied) return false;
    return snapshot
      ? snapshot.authenticated && snapshot.permissions.includes("system.manage")
      : (this.deps.canManage?.() ?? false);
  }
  get canInspect(): boolean {
    return (
      this.#opened &&
      !this.view.busy &&
      this.authorized &&
      this.#card?.filing === true &&
      !this.view.needsSourceConfirmation &&
      (this.view.source === "installed" ||
        (this.#candidate !== null &&
          this.#candidate.passphrase !== "" &&
          this.#candidate.file.size > 0 &&
          this.#candidate.file.size <= CERTIFICATE_MAX_BYTES))
    );
  }
  get canCheck(): boolean {
    return this.canInspect && this.#preview;
  }
  open(input: {
    source: Source;
    savedCard: CertificateCardView;
    candidate: DiagnosisCandidate | null;
  }): void {
    this.stop();
    this.#opened = true;
    this.#opening++;
    this.#card = input.savedCard;
    this.#candidate = input.candidate;
    this.#account = this.deps.permissionContinuation?.snapshot().accountGeneration ?? 0;
    this.view = {
      source: input.source,
      busy: false,
      result: null,
      needsSourceConfirmation: true,
      resultUnavailable: false,
    };
    this.#unsubscribe = this.deps.permissionContinuation?.subscribe((snapshot) => {
      if (snapshot.accountGeneration !== this.#account) {
        this.#account = snapshot.accountGeneration;
        this.invalidateAccount();
      }
    });
    this.deps.changed();
  }
  confirmSource(): void {
    this.view.needsSourceConfirmation = false;
    this.deps.changed();
  }
  invalidateSource(): void {
    this.#source++;
    this.#attempt++;
    this.#abort?.abort();
    this.#abort = undefined;
    this.#candidate = null;
    this.#preview = false;
    this.view = {
      ...this.view,
      busy: false,
      result: null,
      resultUnavailable: false,
      needsSourceConfirmation: true,
    };
    this.deps.changed();
  }
  invalidateAccount(): void {
    this.#denied = false;
    this.invalidateSource();
  }
  stop(): void {
    this.#opening++;
    this.#opened = false;
    this.invalidateSource();
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#card = undefined;
  }
  async run(operation: "inspect" | "check"): Promise<void> {
    if (!this.canInspect || (operation === "check" && !this.canCheck)) return;
    const stamp = {
      account: this.#account,
      opening: this.#opening,
      source: this.#source,
      attempt: ++this.#attempt,
    };
    const abort = new AbortController();
    this.#abort = abort;
    const current = () =>
      this.#opened &&
      !abort.signal.aborted &&
      stamp.account === (this.deps.permissionContinuation?.snapshot().accountGeneration ?? 0) &&
      stamp.opening === this.#opening &&
      stamp.source === this.#source &&
      stamp.attempt === this.#attempt;
    if (operation === "inspect") this.#preview = false;
    this.view = { ...this.view, busy: true, result: null, resultUnavailable: false };
    this.deps.changed();
    let bytes: Uint8Array | undefined;
    try {
      const binding = {
        schemaVersion: 1 as const,
        operation,
        sourceGeneration: this.#source,
        expectedRevision: this.#card!.revision,
      };
      let body: CertificateDiagnosisRequest;
      if (this.view.source === "candidate") {
        bytes = new Uint8Array(await this.#candidate!.file.arrayBuffer());
        if (!current()) return;
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        body = {
          ...binding,
          source: "candidate",
          pfxBase64: btoa(binary),
          passphrase: this.#candidate!.passphrase,
          certKind: this.#candidate!.certKind,
        };
      } else body = { ...binding, source: "installed" };
      bytes?.fill(0);
      bytes = undefined;
      const pending = this.deps.client.diagnose(body, abort.signal);
      const expected = {
        source: body.source,
        operation: body.operation,
        sourceGeneration: body.sourceGeneration,
        expectedRevision: body.expectedRevision,
      };
      body = undefined as never;
      const answer = parseCertificateDiagnosisResult(await pending);
      if (!current()) return;
      if (
        answer.source !== expected.source ||
        answer.operation !== expected.operation ||
        answer.binding.sourceGeneration !== expected.sourceGeneration ||
        answer.binding.expectedRevision !== expected.expectedRevision
      )
        throw new Error("unavailable");
      this.view.result = answer;
      if (operation === "inspect")
        this.#preview =
          answer.category === "local-ready" &&
          answer.kind !== null &&
          answer.endpointLabel !== null;
    } catch (error) {
      if (current()) {
        if (
          [
            "management_session.required",
            "management_session.expired",
            "authorization.not_permitted",
          ].includes(codeOf(error))
        ) {
          this.#denied = true;
          this.invalidateSource();
        }
        this.view.result = null;
        this.view.resultUnavailable = true;
      }
    } finally {
      bytes?.fill(0);
      if (current()) {
        this.view.busy = false;
        this.#abort = undefined;
        this.deps.changed();
      }
    }
  }
}
