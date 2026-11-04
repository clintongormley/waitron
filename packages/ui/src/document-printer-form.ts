import {
  canonicalDeliveryIntent,
  parseInvoiceSave,
  type DeliveryIntent,
  type DeliveryResult,
  type DocumentChoice,
  type DocumentOffers,
  type InvoiceSave,
  type InvoiceSaveResult,
  type OperationIdentity,
  type OperationResult,
} from "@waitron/shared";
import {
  type DocumentDeliveryRecovery,
  type DocumentRecoveryApi,
  type RecoverySubject,
  type RetainedDocumentOperation,
} from "./document-delivery-recovery.js";

export interface DocumentDeliveryApi extends DocumentRecoveryApi {
  prepare(
    operation: OperationIdentity,
    intent: DeliveryIntent,
  ): Promise<OperationResult<DeliveryResult>>;
  accept(operation: OperationIdentity): Promise<OperationResult<DeliveryResult>>;
}
export interface InvoiceChoiceApi extends DocumentRecoveryApi {
  prepare(save: InvoiceSave): Promise<OperationResult<InvoiceSaveResult>>;
  accept(operation: OperationIdentity): Promise<OperationResult<InvoiceSaveResult>>;
}
export type DocumentPrinterState =
  | "loading"
  | "read-failed"
  | "empty"
  | "ready"
  | "saving"
  | "unknown"
  | "accepted"
  | "status-unavailable";
async function fingerprint(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function sameContext(a: DocumentOffers, b: DocumentOffers): boolean {
  return (
    a.saleId === b.saleId &&
    a.applianceId === b.applianceId &&
    a.origin.nodeId === b.origin.nodeId &&
    a.origin.recoveryEpoch === b.origin.recoveryEpoch &&
    a.context.surface === b.context.surface &&
    a.context.deviceId === b.context.deviceId &&
    a.context.profileId === b.context.profileId
  );
}

export class DocumentPrinterForm {
  printerId: string | null = null;
  state: DocumentPrinterState = "loading";
  unavailablePreference = false;
  selectionWithdrawn = false;
  refusal: string | null = null;
  savedRefreshUnavailable = false;
  #generation = 0;
  #offers: DocumentOffers | null = null;
  #intent: DeliveryIntent | null = null;
  #recovery: DocumentDeliveryRecovery;
  #document: DocumentChoice;
  #recoveredGeneration = -1;
  #saved = false;
  #saveUncertain = false;
  #priorPrinter: string | null = null;

  constructor(recovery: DocumentDeliveryRecovery, document: DocumentChoice) {
    this.#recovery = recovery;
    this.#document = document;
  }
  get generation(): number {
    return this.#generation;
  }
  get saleId(): string | null {
    return this.#offers?.saleId ?? null;
  }
  get intent(): DeliveryIntent | null {
    return this.#intent && structuredClone(this.#intent);
  }
  #subject(): RecoverySubject {
    if (!this.#offers) throw new Error("offers unavailable");
    return { kind: "sale", id: this.#offers.saleId };
  }
  #device(): RecoverySubject {
    const id = this.#offers?.context.deviceId;
    if (!id) throw new Error("device unavailable");
    return { kind: "device", id };
  }
  get canPrint(): boolean {
    return (
      this.state === "ready" &&
      this.#eligible(this.printerId) &&
      this.#offers?.actions.print === true &&
      this.#offers.documents.includes(this.#document) &&
      this.#recoveredGeneration === this.#generation &&
      !this.#saveUncertain &&
      (this.#document !== "invoice" ||
        this.#offers.context.deviceId === null ||
        this.#recovery.canSubmit(this.#device())) &&
      this.#recovery.canSubmit(this.#subject())
    );
  }
  beginLoad(): number {
    this.close();
    return this.#generation;
  }
  open(offers: DocumentOffers, preference: string | null): number {
    this.close();
    this.#offers = structuredClone(offers);
    const eligible = (id: string | null) =>
      id !== null && offers.printers.some((printer) => printer.id === id);
    const device = offers.context.deviceId !== null;
    if (!device) {
      this.unavailablePreference = preference !== null && !eligible(preference);
      this.printerId = eligible(preference)
        ? preference
        : offers.printers.length === 1
          ? offers.printers[0]!.id
          : null;
    } else if (this.#document === "invoice") {
      this.printerId = eligible(offers.chosenPrinterId)
        ? offers.chosenPrinterId
        : eligible(offers.defaultPrinterId)
          ? offers.defaultPrinterId
          : null;
    } else
      this.printerId =
        offers.chosenPrinterId === null
          ? eligible(offers.defaultPrinterId)
            ? offers.defaultPrinterId
            : null
          : eligible(offers.chosenPrinterId)
            ? offers.chosenPrinterId
            : null;
    this.state = offers.printers.length === 0 ? "empty" : "ready";
    this.#saveUncertain = device && this.#document === "invoice";
    this.#priorPrinter = this.printerId;
    return this.#generation;
  }
  applyOffers(offers: DocumentOffers, generation = this.#generation): void {
    if (generation !== this.#generation) return;
    if (this.#offers && !sameContext(this.#offers, offers)) {
      this.#generation++;
      this.#recoveredGeneration = -1;
      this.printerId = null;
      this.selectionWithdrawn = true;
      this.state = offers.printers.length === 0 ? "empty" : "ready";
      this.#intent = null;
      this.#saved = false;
      this.#saveUncertain = this.#document === "invoice" && offers.context.deviceId !== null;
      this.#priorPrinter = null;
    }
    this.#offers = structuredClone(offers);
    if (
      this.printerId !== null &&
      !offers.printers.some((printer) => printer.id === this.printerId)
    ) {
      this.printerId = null;
      this.selectionWithdrawn = true;
    }
    if (
      this.state !== "saving" &&
      this.state !== "unknown" &&
      this.state !== "accepted" &&
      this.state !== "status-unavailable"
    )
      this.state = offers.printers.length === 0 ? "empty" : "ready";
  }
  readFailed(generation: number): void {
    if (generation !== this.#generation) return;
    if (this.#saved) this.savedRefreshUnavailable = true;
    else if (
      this.state !== "saving" &&
      this.state !== "unknown" &&
      this.state !== "accepted" &&
      this.state !== "status-unavailable"
    )
      this.state = "read-failed";
  }
  selectPrinter(id: string): void {
    if (this.state !== "ready" || !this.#offers?.printers.some((printer) => printer.id === id))
      return;
    if (
      this.#document === "invoice" &&
      this.#offers.context.deviceId !== null &&
      id !== this.printerId
    )
      this.#saveUncertain = true;
    this.printerId = id;
    this.selectionWithdrawn = false;
    this.refusal = null;
  }
  freezeIntent(): DeliveryIntent {
    if (
      this.#recoveredGeneration !== this.#generation ||
      !this.#recovery.canSubmit(this.#subject())
    )
      throw new Error("operation recovery required");
    if (!this.canPrint || !this.#offers || !this.printerId) throw new Error("print unavailable");
    return structuredClone({
      medium: "print",
      origin: this.#offers.origin,
      applianceId: this.#offers.applianceId,
      saleId: this.#offers.saleId,
      document: this.#document,
      printerId: this.printerId,
      language: this.#offers.language,
      context: this.#offers.context,
      shownDesignation: this.#offers.designation,
      replacesAttemptId: this.#offers.actions.replacesAttemptId,
    });
  }
  async recover(api: DocumentDeliveryApi): Promise<void> {
    const generation = this.#generation;
    const subject = this.#subject();
    try {
      if (this.#document === "invoice" && this.#offers?.context.deviceId !== null)
        await this.recoverInvoice(api);
      const recovered = await this.#recovery.recoverOutstanding(subject, api);
      for (const entry of recovered) {
        if (entry.outcome.state === "accepted") {
          await this.applyResult(
            { state: "accepted", result: entry.outcome.result as DeliveryResult },
            generation,
          );
          if (generation === this.#generation)
            await this.#recovery.acknowledgeRecovered(entry, api);
        }
      }
      if (generation !== this.#generation) return;
      const resolved = this.#recovery.canSubmit(subject) && !this.#saveUncertain;
      this.#recoveredGeneration = resolved ? generation : -1;
      if (!resolved && !this.#isAccepted()) this.state = "unknown";
      else if (resolved && this.state === "unknown")
        this.state = this.#offers!.printers.length === 0 ? "empty" : "ready";
    } catch {
      if (generation === this.#generation && !this.#isAccepted()) this.state = "unknown";
    }
  }
  async submit(api: DocumentDeliveryApi): Promise<void> {
    const intent = this.freezeIntent();
    const generation = this.#generation;
    const printerKind = this.#offers!.printers.find(
      (printer) => printer.id === this.printerId,
    )!.kind;
    const operation = { origin: intent.origin, key: crypto.randomUUID() };
    this.#intent = structuredClone(intent);
    this.state = "saving";
    this.refusal = null;
    try {
      const pending: RetainedDocumentOperation = {
        kind: "delivery",
        operation,
        subjectId: intent.saleId,
        fingerprint: await fingerprint(canonicalDeliveryIntent(intent, { printerKind })),
        rememberPreference:
          intent.context.surface === "dashboard" && intent.context.deviceId === null,
      };
      await this.#recovery.retainOperation(pending);
      let outcome = await api.prepare(operation, intent);
      if (outcome.state === "prepared" && generation !== this.#generation) return;
      if (outcome.state === "prepared") outcome = await api.accept(operation);
      const recovered = await this.#recovery.recordOutcome(pending, outcome);
      await this.applyResult(outcome, generation);
      if (generation === this.#generation && outcome.state !== "prepared")
        await this.#recovery.acknowledgeRecovered(recovered, api);
    } catch {
      if (generation === this.#generation && !this.#isAccepted()) this.state = "unknown";
    }
  }
  async applyResult(outcome: OperationResult<DeliveryResult>, generation: number): Promise<void> {
    if (generation !== this.#generation) return;
    if (outcome.state === "accepted") this.state = "accepted";
    else if (outcome.state === "prepared") this.state = "unknown";
    else {
      this.state = this.#offers!.printers.length === 0 ? "empty" : "ready";
      this.refusal = outcome.code;
    }
  }
  #isAccepted(): boolean {
    return this.state === "accepted";
  }
  statusUnavailable(): void {
    if (this.state === "accepted") this.state = "status-unavailable";
  }
  #eligible(id: string | null): boolean {
    return id !== null && this.#offers?.printers.some((printer) => printer.id === id) === true;
  }
  #applySave(result: InvoiceSaveResult): void {
    if (!this.#offers || result.deviceId !== this.#offers.context.deviceId)
      throw new Error("save device changed");
    if (result.revision < (this.#offers.invoiceRevision ?? 0)) {
      this.#saveUncertain = false;
      this.state = this.#offers.printers.length === 0 ? "empty" : "ready";
      return;
    }
    this.#offers.invoiceRevision = result.revision;
    this.#offers.chosenPrinterId = result.chosenId;
    this.printerId = this.#offers.printers.some((printer) => printer.id === result.resolvedId)
      ? result.resolvedId
      : null;
    this.#saveUncertain = false;
    this.#saved = true;
    this.#priorPrinter = this.printerId;
    this.state = this.#offers.printers.length === 0 ? "empty" : "ready";
  }
  async saveInvoice(id: string, api: InvoiceChoiceApi): Promise<void> {
    if (
      this.#document !== "invoice" ||
      !this.#offers ||
      this.#offers.invoiceRevision === null ||
      this.state !== "ready" ||
      !this.#offers.printers.some((printer) => printer.id === id)
    )
      throw new Error("Invoice save unavailable");
    const generation = this.#generation;
    const subject = this.#device();
    const previous = this.#priorPrinter;
    const save: InvoiceSave = {
      origin: structuredClone(this.#offers.origin),
      applianceId: this.#offers.applianceId,
      saveId: crypto.randomUUID(),
      deviceId: subject.id,
      expectedRevision: this.#offers.invoiceRevision,
      selection: { id },
    };
    this.printerId = id;
    this.state = "saving";
    this.#saveUncertain = true;
    this.#saved = false;
    try {
      const outstanding = await this.#recovery.recoverOutstanding(subject, api);
      if (
        outstanding.some((entry) => entry.outcome.state === "accepted") ||
        !this.#recovery.canSubmit(subject)
      )
        throw new Error("Invoice recovery required");
      const pending: RetainedDocumentOperation = {
        kind: "invoice-save",
        operation: { origin: save.origin, key: save.saveId },
        subjectId: subject.id,
        fingerprint: await fingerprint(JSON.stringify(parseInvoiceSave(save))),
      };
      await this.#recovery.retainOperation(pending);
      let outcome = await api.prepare(save);
      if (outcome.state === "prepared" && generation !== this.#generation) return;
      if (outcome.state === "prepared") outcome = await api.accept(pending.operation);
      const recovered = await this.#recovery.recordOutcome(pending, outcome);
      if (generation === this.#generation) {
        if (outcome.state === "accepted") this.#applySave(outcome.result);
        else if (outcome.state !== "prepared") {
          this.printerId = this.#eligible(previous) ? previous : null;
          this.refusal = outcome.code;
          this.state = "ready";
          this.#saveUncertain = false;
        } else this.state = "unknown";
      }
      if (generation === this.#generation && outcome.state !== "prepared")
        await this.#recovery.acknowledgeRecovered(recovered, api);
    } catch {
      if (generation === this.#generation && !this.#saved) this.state = "unknown";
    }
  }
  async recoverInvoice(api: DocumentRecoveryApi): Promise<void> {
    const generation = this.#generation;
    try {
      const recovered = await this.#recovery.recoverOutstanding(this.#device(), api);
      for (const entry of recovered) {
        if (entry.outcome.state === "accepted") {
          if (generation === this.#generation)
            this.#applySave(entry.outcome.result as InvoiceSaveResult);
          if (generation === this.#generation)
            await this.#recovery.acknowledgeRecovered(entry, api);
        }
      }
      if (generation === this.#generation && this.#recovery.canSubmit(this.#device())) {
        this.#saveUncertain = this.printerId !== this.#priorPrinter;
        if (this.state === "unknown") {
          this.printerId = this.#eligible(this.#priorPrinter) ? this.#priorPrinter : null;
          this.#saveUncertain = false;
          this.state = this.#offers!.printers.length === 0 ? "empty" : "ready";
        }
      }
    } catch {
      if (generation === this.#generation && !this.#saved) this.state = "unknown";
    }
  }
  close(): void {
    this.#generation++;
    this.#recoveredGeneration = -1;
    this.#offers = null;
    this.printerId = null;
    this.state = "loading";
    this.#intent = null;
    this.refusal = null;
    this.unavailablePreference = false;
    this.selectionWithdrawn = false;
    this.savedRefreshUnavailable = false;
    this.#saved = false;
    this.#saveUncertain = false;
  }
}
