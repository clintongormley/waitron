import { isAllocatedSeries } from "../allocation-identity.js";
import {
  parsePaperBlock,
  paperBlockBytes,
  paperConsumptionBytes,
  type PaperConsumption,
  type SignedPaperValue,
  type PaperAllocation,
  type PaperBlock,
} from "../paper-protocol.js";
import {
  checkCustodyChallenge,
  createCustodyCheckVerifier,
  type CustodyCheckReceipt,
} from "./challenge.js";
import {
  createCustodyKey,
  protectCustodyKey,
  openCustodyKey,
  type CustodyKey,
  type CustodyPublic,
} from "./key-codec.js";
import { restoreSecretPaper } from "./paper-codec.js";
import {
  base64,
  bounded,
  digest,
  encoder,
  exact,
  expectedPublic,
  material,
  record,
  refuse,
  scopeOf,
  text,
} from "./internal.js";
import { renderMasterOriginal, renderMasterSnapshot, renderSecretPaper } from "./documents.js";
import type { CustodyLocale } from "./strings.js";

export interface CustodyRequest {
  readonly version: 1;
  readonly kind: "first-fiscal-setup";
  readonly attemptId: string;
  readonly binding: {
    readonly module: "fiscal-verifactu";
    readonly action: "setup";
    readonly eventId: string;
    readonly sourceId: string;
    readonly targetNodeId: string;
  };
  readonly operatorId: string;
  readonly recipientVenueId: string;
  readonly taxpayerNif: string;
  readonly softwareId: string;
  readonly environment: "production" | "preproduction";
  readonly requiredBases: readonly { readonly code: string; readonly purpose: string }[];
  readonly candidates: readonly PaperAllocation[];
  readonly candidateDigest: string;
}
export interface KitCheckRequest {
  readonly version: 1;
  readonly requestId: string;
  readonly public: CustodyPublic;
}
type Mode = "new" | "existing" | "resume" | "recovery";
type State =
  | "new"
  | "file-saved-unchecked"
  | "file-checked"
  | "paper-check-pending"
  | "ready"
  | "handover"
  | "stopped";
type OriginalStatus = "unissued" | "issued-unknown" | "kept";
interface Incident {
  readonly reason: string;
  readonly detail: string;
}
interface PublicInput {
  readonly allocation: PaperAllocation & {
    readonly reservationEvidence: {
      readonly block: SignedPaperValue<PaperBlock>;
      readonly consumption: SignedPaperValue<PaperConsumption>;
    };
  };
  readonly approval: {
    readonly version: 1;
    readonly eventId: string;
    readonly operatorId: string;
    readonly sourceId: string;
    readonly targetNodeId: string;
    readonly oldMachineAbsent: true;
    readonly oldMachineOffline: false;
    readonly noParallelRecovery: true;
    readonly confirmedAt: string;
    readonly incidentEvidence: string;
  };
}

function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
async function parseRequest(value: unknown): Promise<CustodyRequest> {
  bounded(JSON.stringify(value), 65536);
  if (
    !exact(value, [
      "version",
      "kind",
      "attemptId",
      "binding",
      "operatorId",
      "recipientVenueId",
      "taxpayerNif",
      "softwareId",
      "environment",
      "requiredBases",
      "candidates",
      "candidateDigest",
    ]) ||
    value.version !== 1 ||
    value.kind !== "first-fiscal-setup" ||
    !text(value.attemptId) ||
    !text(value.operatorId) ||
    !exact(value.binding, ["module", "action", "eventId", "sourceId", "targetNodeId"]) ||
    value.binding.module !== "fiscal-verifactu" ||
    value.binding.action !== "setup" ||
    !text(value.binding.eventId) ||
    !text(value.binding.targetNodeId) ||
    value.binding.sourceId !== `first-setup:${value.attemptId}` ||
    value.recipientVenueId !== value.binding.sourceId ||
    typeof value.taxpayerNif !== "string" ||
    !/^[A-Z0-9]{9}$/.test(value.taxpayerNif) ||
    value.softwareId !== "W1" ||
    !["production", "preproduction"].includes(value.environment as string) ||
    !Array.isArray(value.requiredBases) ||
    value.requiredBases.length !== 3 ||
    !Array.isArray(value.candidates) ||
    value.candidates.length < 1 ||
    value.candidates.length > 100
  )
    refuse();
  const bases = value.requiredBases as { code: string; purpose: string }[];
  if (
    bases.some((base) => !exact(base, ["code", "purpose"])) ||
    !["standard", "full", "rectificative"].every((purpose) =>
      bases.some((b) => b.purpose === purpose),
    )
  )
    refuse();
  const block = parsePaperBlock({
    version: 1,
    custodianId: "candidate-check",
    generationId: "candidate-check",
    blockId: "candidate-check",
    packVersion: 1,
    recipientVenueId: value.recipientVenueId,
    allocations: value.candidates,
  });
  if (
    block === null ||
    block.allocations.some(
      (a) =>
        a.source !== "initial-paper" ||
        a.taxpayerNif !== value.taxpayerNif ||
        a.softwareId !== value.softwareId ||
        a.environment !== value.environment ||
        !isAllocatedSeries(a.series, a.installationIdentity, bases),
    ) ||
    (await digest(encoder.encode(JSON.stringify(block.allocations)))) !== value.candidateDigest
  )
    refuse();
  return freeze(
    structuredClone({ ...value, candidates: block.allocations }) as unknown as CustodyRequest,
  );
}
async function parseKit(value: unknown): Promise<KitCheckRequest> {
  bounded(JSON.stringify(value));
  if (
    !exact(value, ["version", "requestId", "public"]) ||
    value.version !== 1 ||
    typeof value.requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value.requestId,
    ) ||
    !exact(value.public, ["scope", "publicKey", "fingerprint"])
  )
    refuse();
  const authority = value.public as unknown as CustodyPublic;
  await expectedPublic(authority);
  return freeze({
    version: 1,
    requestId: value.requestId,
    public: {
      scope: scopeOf(authority.scope),
      publicKey: authority.publicKey,
      fingerprint: authority.fingerprint,
    },
  });
}

export class CustodySession {
  #mode: Mode;
  #state: State = "new";
  #original: OriginalStatus = "unissued";
  #request: CustodyRequest | null = null;
  #kit: KitCheckRequest | null = null;
  #key: CustodyKey | null = null;
  #mayCreate = false;
  #fileCheck = false;
  #protectedOutput = false;
  #secretOutput = false;
  #receipts: CustodyCheckReceipt[] = [];
  #incidents: Incident[] = [];
  #generation = 0;
  #busy = false;
  #verifyFile: ((receipt: unknown) => Promise<boolean>) | null = null;
  #verifyPaper: ((receipt: unknown) => Promise<boolean>) | null = null;
  #verified = false;
  #reserved = false;
  #consumed = false;
  #signedBlock: SignedPaperValue<PaperBlock> | null = null;
  #successor: string | null = null;
  constructor(mode: Mode) {
    this.#mode = mode;
  }
  get mode(): Mode {
    return this.#mode;
  }
  get state(): State {
    return this.#state;
  }
  get originalStatus(): OriginalStatus {
    return this.#original;
  }
  get publicKit(): KitCheckRequest | null {
    return this.#kit;
  }
  get request(): CustodyRequest | null {
    return this.#request;
  }
  get checkReceipts(): readonly CustodyCheckReceipt[] {
    return structuredClone(this.#receipts);
  }
  get signedBlock(): SignedPaperValue<PaperBlock> | null {
    return this.#signedBlock;
  }
  #masterContext(locale: CustodyLocale) {
    return {
      attemptId: this.#request!.attemptId,
      requestId: this.#kit!.requestId,
      locale,
      eventId: this.#request!.binding.eventId,
      sourceId: this.#request!.binding.sourceId,
      targetNodeId: this.#request!.binding.targetNodeId,
      operatorId: this.#request!.operatorId,
    };
  }
  #active(): void {
    if (this.#state === "stopped") refuse();
  }
  async #run<T>(body: () => Promise<T>): Promise<T> {
    this.#active();
    if (this.#busy) refuse();
    this.#busy = true;
    try {
      return await body();
    } finally {
      this.#busy = false;
    }
  }
  #acceptKey(key: CustodyKey, generation: number): void {
    if (generation !== this.#generation || this.#state === "stopped") {
      key.dispose();
      refuse();
    }
    this.#key?.dispose();
    this.#key = key;
  }
  #bindKit(kit: KitCheckRequest): void {
    this.#checkScope(this.#request, kit);
    this.#kit = kit;
    this.#verifyFile = createCustodyCheckVerifier(kit.public, {
      requestId: kit.requestId,
      kind: "saved-file",
    });
    this.#verifyPaper = createCustodyCheckVerifier(kit.public, {
      requestId: kit.requestId,
      kind: "secret-paper",
    });
  }
  #checkScope(request: CustodyRequest | null, kit: KitCheckRequest | null): void {
    if (
      request !== null &&
      kit !== null &&
      (kit.public.scope.taxpayerNif !== request.taxpayerNif ||
        kit.public.scope.softwareId !== request.softwareId ||
        kit.public.scope.environment !== request.environment)
    )
      refuse();
  }
  async loadRequest(value: unknown): Promise<void> {
    return this.#run(async () => {
      if (this.#request !== null || this.#mode === "recovery" || this.#key !== null) refuse();
      const generation = this.#generation;
      const request = await parseRequest(value);
      if (generation !== this.#generation) refuse();
      this.#checkScope(request, this.#kit);
      this.#request = request;
    });
  }
  async loadKitRequest(value: unknown): Promise<void> {
    return this.#run(async () => {
      if (this.#kit !== null || this.#mode === "new") refuse();
      const generation = this.#generation;
      const kit = await parseKit(value);
      if (generation !== this.#generation) refuse();
      this.#bindKit(kit);
    });
  }
  answerMaster(exists: boolean): void {
    this.#active();
    if (this.#mode !== "new" || this.#key !== null || this.#mayCreate || this.#request === null)
      refuse();
    if (exists) this.#mode = "existing";
    else this.#mayCreate = true;
  }
  async createKit(custodianId: string): Promise<void> {
    return this.#run(async () => {
      if (!this.#mayCreate || this.#mode !== "new" || this.#kit !== null || this.#request === null)
        refuse();
      const generation = this.#generation;
      const key = await createCustodyKey({
        custodianId,
        taxpayerNif: this.#request.taxpayerNif,
        softwareId: this.#request.softwareId,
        environment: this.#request.environment,
      });
      this.#acceptKey(key, generation);
      this.#bindKit(
        freeze({
          version: 1,
          requestId: crypto.randomUUID(),
          public: { scope: key.scope, publicKey: key.publicKey, fingerprint: key.fingerprint },
        }),
      );
    });
  }
  #block(): PaperBlock {
    if (this.#request === null || this.#kit === null) refuse();
    return {
      version: 1,
      custodianId: this.#kit.public.scope.custodianId,
      generationId: `kit:${this.#kit.requestId}`,
      blockId: `first:${this.#request.attemptId}:${this.#request.candidateDigest}`,
      packVersion: 1,
      recipientVenueId: this.#request.recipientVenueId,
      allocations: this.#request.candidates,
    };
  }
  originalDocument(locale: CustodyLocale): string {
    this.#active();
    if (this.#mode !== "new" || this.#kit === null || this.#original !== "unissued") refuse();
    const block = this.#block();
    this.#original = "issued-unknown";
    this.#incidents.push({ reason: "original-issued-unknown", detail: block.blockId });
    return renderMasterOriginal(this.#masterContext(locale), block, this.#kit.public);
  }
  reconcileOriginal(outcome: "kept" | "spoiled", detail: string): void {
    this.#active();
    if (this.#original !== "issued-unknown" || !text(detail)) refuse();
    if (outcome === "spoiled") this.stop("spoiled-original", detail);
    else {
      this.#original = "kept";
      this.#incidents.push({ reason: "original-kept", detail });
    }
  }
  incidentRecord() {
    return {
      version: 1,
      attemptId: this.#request?.attemptId ?? null,
      request: this.#request,
      publicKit: this.#kit,
      originalStatus: this.#original,
      incidents: structuredClone(this.#incidents),
    };
  }
  stop(reason: string, detail: string): void {
    this.#active();
    if (!text(reason) || !text(detail)) refuse();
    this.#incidents.push({ reason, detail });
    this.close();
  }
  async protectedFile(passphrase: string, confirmation: string): Promise<string> {
    return this.#run(async () => {
      if (this.#key === null || this.#fileCheck || passphrase !== confirmation) refuse();
      const generation = this.#generation;
      const file = await protectCustodyKey(this.#key, passphrase);
      if (generation !== this.#generation) refuse();
      this.#state = "file-saved-unchecked";
      this.#protectedOutput = true;
      return file;
    });
  }
  async secretDocument(locale: CustodyLocale): Promise<string> {
    return this.#run(async () => {
      if (this.#key === null || this.#fileCheck) refuse();
      const generation = this.#generation;
      const document = await renderSecretPaper(this.#key, locale);
      if (generation !== this.#generation) refuse();
      this.#secretOutput = true;
      return document;
    });
  }
  beginFileCheck(): void {
    this.#active();
    if (this.#busy || this.#kit === null || this.#mode === "recovery") refuse();
    if (
      this.#mode === "new" &&
      (!this.#protectedOutput || !this.#secretOutput || this.#original !== "kept")
    )
      refuse();
    this.#key?.dispose();
    this.#key = null;
    this.#fileCheck = true;
    this.#state = "file-saved-unchecked";
  }
  async reopenFile(file: File, passphrase: string): Promise<CustodyCheckReceipt> {
    return this.#run(async () => {
      if (this.#kit === null || this.#mode === "recovery" || !this.#fileCheck) refuse();
      this.#key?.dispose();
      this.#key = null;
      this.#verified = false;
      this.#reserved = false;
      this.#state = this.#successor === null ? "file-saved-unchecked" : "handover";
      if (!(file instanceof File) || file.size > 16384) refuse();
      const generation = this.#generation;
      const key = await openCustodyKey(await file.text(), passphrase, this.#kit.public);
      this.#acceptKey(key, generation);
      const receipt = await checkCustodyChallenge(key, this.#kit.public, {
        requestId: this.#kit.requestId,
        kind: "saved-file",
      });
      if (generation !== this.#generation) refuse();
      this.#receipts.push(receipt);
      this.#state = this.#successor === null ? "paper-check-pending" : "handover";
      return receipt;
    });
  }
  async checkPaper(paper: string, fingerprint: string): Promise<CustodyCheckReceipt> {
    return this.#run(async () => {
      if (
        this.#mode !== "recovery" ||
        this.#kit === null ||
        fingerprint !== this.#kit.public.fingerprint
      )
        refuse();
      const generation = this.#generation;
      const key = await restoreSecretPaper(paper, this.#kit.public);
      try {
        if (generation !== this.#generation) refuse();
        const receipt = await checkCustodyChallenge(key, this.#kit.public, {
          requestId: this.#kit.requestId,
          kind: "secret-paper",
        });
        if (generation !== this.#generation) refuse();
        this.#receipts.push(receipt);
        return receipt;
      } finally {
        key.dispose();
      }
    });
  }
  async verifyChecks(fileReceipt: unknown, paperReceipt: unknown): Promise<void> {
    return this.#run(async () => {
      if (
        (this.#mode !== "resume" && this.#mode !== "existing") ||
        this.#key === null ||
        this.#verifyFile === null ||
        this.#verifyPaper === null
      )
        refuse();
      this.#verified = false;
      this.#reserved = false;
      this.#state = this.#successor === null ? "paper-check-pending" : "handover";
      const generation = this.#generation;
      if (!record(fileReceipt) || !record(paperReceipt) || fileReceipt.nonce === paperReceipt.nonce)
        refuse();
      if (
        !(await this.#verifyFile(fileReceipt)) ||
        !(await this.#verifyPaper(paperReceipt)) ||
        generation !== this.#generation
      )
        refuse();
      this.#verified = true;
      this.#state = this.#successor === null ? "file-checked" : "handover";
    });
  }
  attestCustody(value: unknown, fingerprint: string): void {
    this.#active();
    if (
      !this.#verified ||
      this.#state !== "file-checked" ||
      this.#kit === null ||
      fingerprint !== this.#kit.public.fingerprint ||
      !exact(value, [
        "sameCurrentMaster",
        "actualPaperCleanSession",
        "originalIssueRecorded",
        "custodyAccepted",
      ]) ||
      Object.values(value).some((v) => v !== true)
    )
      refuse();
    this.#original = "kept";
    this.#state = "ready";
    this.#incidents.push({ reason: "custody-attested", detail: this.#kit.requestId });
  }
  reserve(value: unknown): void {
    this.#active();
    if (
      this.#busy ||
      this.#state !== "ready" ||
      !this.#verified ||
      this.#consumed ||
      this.#reserved ||
      this.#request === null ||
      !exact(value, [
        "currentOriginal",
        "otherSystemsChecked",
        "rowsReservedInInk",
        "oldMachineAbsent",
        "noParallelSetup",
        "incidentEvidence",
      ]) ||
      !text(value.incidentEvidence) ||
      [
        value.currentOriginal,
        value.otherSystemsChecked,
        value.rowsReservedInInk,
        value.oldMachineAbsent,
        value.noParallelSetup,
      ].some((v) => v !== true)
    )
      refuse();
    this.#reserved = true;
    this.#incidents.push({ reason: "reserved-in-ink", detail: value.incidentEvidence });
  }
  async consume(allocationId: string, incident: string): Promise<PublicInput> {
    return this.#run(async () => {
      if (
        this.#state !== "ready" ||
        !this.#verified ||
        !this.#reserved ||
        this.#consumed ||
        this.#key === null ||
        this.#request === null ||
        this.#kit === null ||
        !text(incident)
      )
        refuse();
      const candidate = this.#request.candidates.find((a) => a.allocationId === allocationId);
      if (candidate === undefined) refuse();
      const generation = this.#generation;
      const privateKey = material(this.#key).privateKey;
      const sign = async <T>(payload: T, bytes: Uint8Array): Promise<SignedPaperValue<T>> => ({
        payload,
        signature: base64(
          new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, new Uint8Array(bytes))),
        )
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/, ""),
      });
      // Outside consumption precedes signing; failure never makes this entry available again.
      this.#consumed = true;
      this.#incidents.push({ reason: "consumed", detail: `${allocationId}: ${incident}` });
      try {
        const block = this.#block();
        const signedBlock = await sign(block, paperBlockBytes(block));
        const { eventId, sourceId, targetNodeId } = this.#request.binding;
        const consumedAt = new Date().toISOString();
        const consumption: PaperConsumption = {
          version: 1,
          custodianId: block.custodianId,
          blockDigest: await digest(new Uint8Array(paperBlockBytes(block))),
          allocationId,
          eventId,
          operatorId: this.#request.operatorId,
          sourceId,
          targetNodeId,
          incidentEvidence: incident,
          consumedAt,
        };
        const input: PublicInput = {
          allocation: {
            ...candidate,
            reservationEvidence: {
              block: signedBlock,
              consumption: await sign(consumption, paperConsumptionBytes(consumption)),
            },
          },
          approval: {
            version: 1,
            eventId,
            operatorId: this.#request.operatorId,
            sourceId,
            targetNodeId,
            oldMachineAbsent: true,
            oldMachineOffline: false,
            noParallelRecovery: true,
            confirmedAt: consumedAt,
            incidentEvidence: incident,
          },
        };
        bounded(JSON.stringify(input), 65536);
        if (generation !== this.#generation) refuse();
        this.#signedBlock = signedBlock;
        return freeze(input);
      } catch {
        this.close();
        return refuse();
      }
    });
  }
  snapshotDocument(locale: CustodyLocale): string {
    this.#active();
    if (this.#signedBlock === null || this.#request === null || this.#kit === null) refuse();
    return renderMasterSnapshot(this.#masterContext(locale), this.#signedBlock, this.#kit.public);
  }
  beginHandover(successor: string): void {
    this.#active();
    if (this.#busy || this.#kit === null || !text(successor) || this.#successor !== null) refuse();
    this.#key?.dispose();
    this.#key = null;
    this.#generation++;
    this.#successor = successor;
    this.#verified = false;
    this.#reserved = false;
    this.#fileCheck = true;
    this.#state = "handover";
    this.#incidents.push({ reason: "handover-started", detail: successor });
  }
  finishHandover(value: unknown): void {
    this.#active();
    if (
      this.#busy ||
      this.#successor === null ||
      this.#state !== "handover" ||
      !this.#verified ||
      this.#key === null ||
      !exact(value, ["transferred", "currentOriginal", "retainedCopies"]) ||
      value.transferred !== true ||
      value.currentOriginal !== true ||
      !text(value.retainedCopies)
    )
      refuse();
    this.#incidents.push({
      reason: "handover-complete",
      detail: `${this.#successor}: ${value.retainedCopies}`,
    });
    this.#successor = null;
    this.#state = "ready";
    this.#original = "kept";
  }
  close(): void {
    this.#generation++;
    this.#key?.dispose();
    this.#key = null;
    this.#state = "stopped";
  }
}
