import type {
  DeliveryResult,
  DocumentChoice,
  InvoiceSaveResult,
  OperationIdentity,
  OperationResult,
  RecoveryResolution,
  RoutingOrigin,
} from "@waitron/shared";

export type RecoverySubject = { kind: "sale" | "device"; id: string };
export type RetainedDocumentOperation = {
  kind: "delivery" | "invoice-save";
  operation: OperationIdentity;
  subjectId: string;
  fingerprint: string;
};
export type RecoveryOutcome = OperationResult<DeliveryResult | InvoiceSaveResult>;
export type RecoveryEntry = {
  operation: OperationIdentity;
  subjectId: string;
  fingerprint: string;
  outcome: RecoveryOutcome;
};
export type RecoveredDocumentOperation = RetainedDocumentOperation & { outcome: RecoveryOutcome };
export interface DocumentRecoveryApi {
  inventory(origin: RoutingOrigin, subject: RecoverySubject): Promise<RecoveryEntry[]>;
  recover(
    operation: OperationIdentity,
    subject: RecoverySubject,
    resolution: RecoveryResolution,
  ): Promise<RecoveryOutcome>;
  acknowledge(operation: OperationIdentity, subject: RecoverySubject): Promise<void>;
}
type StoredOperation = RetainedDocumentOperation & { version: 1; outcome?: RecoveryOutcome };
type Preference = { version: 1; printerId: string; origin: RoutingOrigin; acceptanceOrder: string };
const DATABASE = "waitron-document-routing-v1";
const CHANNEL = "waitron-document-routing-v1";
function sameOrigin(a: RoutingOrigin, b: RoutingOrigin): boolean {
  return (
    a.applianceId === b.applianceId && a.nodeId === b.nodeId && a.recoveryEpoch === b.recoveryEpoch
  );
}
function originCopy(value: RoutingOrigin): RoutingOrigin {
  return {
    applianceId: value.applianceId,
    nodeId: value.nodeId,
    recoveryEpoch: value.recoveryEpoch,
  };
}
function operationKey(value: OperationIdentity): string[] {
  return [value.origin.applianceId, value.origin.nodeId, value.origin.recoveryEpoch, value.key];
}
function subjectOf(value: RetainedDocumentOperation): RecoverySubject {
  return { kind: value.kind === "delivery" ? "sale" : "device", id: value.subjectId };
}
function subjectKey(subject: RecoverySubject): string {
  return `${subject.kind}:${subject.id}`;
}
function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}
function transactionDone(tx: IDBTransaction): Promise<void> {
  const result = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("storage transaction aborted"));
  });
  // A request may reject before the transaction abort event. Both failures stay observed.
  void result.catch(() => {});
  return result;
}
function higher(candidate: Preference, saved: Preference | undefined): boolean {
  return (
    !saved ||
    !sameOrigin(candidate.origin, saved.origin) ||
    BigInt(candidate.acceptanceOrder) > BigInt(saved.acceptanceOrder)
  );
}
function retained(value: RetainedDocumentOperation): StoredOperation {
  if (!/^[a-f0-9]{64}$/.test(value.fingerprint)) throw new TypeError("fingerprint");
  return {
    version: 1,
    kind: value.kind,
    operation: { origin: originCopy(value.operation.origin), key: value.operation.key },
    subjectId: value.subjectId,
    fingerprint: value.fingerprint,
  };
}
function sameIdentity(a: RetainedDocumentOperation, b: RetainedDocumentOperation): boolean {
  return (
    a.kind === b.kind &&
    a.subjectId === b.subjectId &&
    a.fingerprint === b.fingerprint &&
    a.operation.key === b.operation.key &&
    sameOrigin(a.operation.origin, b.operation.origin)
  );
}
function checkedOutcome(
  value: RetainedDocumentOperation,
  outcome: RecoveryOutcome,
): RecoveryOutcome {
  if (outcome.state !== "accepted")
    return outcome.state === "prepared"
      ? { state: "prepared" }
      : { state: outcome.state, code: outcome.code };
  const result = outcome.result;
  if (!sameOrigin(value.operation.origin, result.origin)) throw new Error("result identity");
  if (value.kind === "delivery") {
    if (
      !("requestKey" in result) ||
      result.requestKey !== value.operation.key ||
      result.saleId !== value.subjectId ||
      result.applianceId !== value.operation.origin.applianceId
    )
      throw new Error("result identity");
    return {
      state: "accepted",
      result: {
        origin: originCopy(result.origin),
        requestKey: result.requestKey,
        saleId: result.saleId,
        document: result.document,
        designation: result.designation,
        applianceId: result.applianceId,
        acceptanceOrder: result.acceptanceOrder,
        printerId: result.printerId,
        work: { kind: result.work.kind, id: result.work.id },
        auditId: result.auditId,
      },
    };
  }
  if (
    !("saveId" in result) ||
    result.saveId !== value.operation.key ||
    result.deviceId !== value.subjectId
  )
    throw new Error("result identity");
  return {
    state: "accepted",
    result: {
      origin: originCopy(result.origin),
      saveId: result.saveId,
      deviceId: result.deviceId,
      revision: result.revision,
      chosenId: result.chosenId,
      resolvedId: result.resolvedId,
    },
  };
}

export class DocumentDeliveryRecovery extends EventTarget {
  preferenceWarning = false;
  identityWarning = false;
  #db: IDBDatabase | null;
  #channel: BroadcastChannel;
  #applianceId: string;
  #origin: RoutingOrigin | null = null;
  #preferences = new Map<DocumentChoice, Preference>();
  #ready = new Set<string>();
  #pending = new Map<string, Set<string>>();
  #recoveryGeneration = new Map<string, number>();
  #recovering = new Set<string>();

  private constructor(applianceId: string, db: IDBDatabase | null) {
    super();
    this.#applianceId = applianceId;
    this.#db = db;
    this.preferenceWarning = db === null;
    this.identityWarning = db === null;
    this.#channel = new BroadcastChannel(CHANNEL);
    this.#channel.onmessage = (
      event: MessageEvent<{ applianceId: string; subject?: RecoverySubject }>,
    ) => {
      if (event.data.applianceId !== this.#applianceId) return;
      if (event.data.subject) this.#ready.delete(subjectKey(event.data.subject));
      else {
        if (!this.preferenceWarning) this.#preferences.clear();
        this.dispatchEvent(new Event("preference-change"));
      }
    };
  }
  static async open(applianceId: string): Promise<DocumentDeliveryRecovery> {
    let db: IDBDatabase | null = null;
    try {
      db = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open(DATABASE, 1);
        let blocked = false;
        opening.onupgradeneeded = () => {
          opening.result.createObjectStore("preferences");
          opening.result.createObjectStore("operations");
        };
        opening.onsuccess = () => {
          if (blocked) opening.result.close();
          else resolve(opening.result);
        };
        opening.onerror = () => reject(opening.error);
        opening.onblocked = () => {
          blocked = true;
          reject(new Error("routing database blocked"));
        };
      });
    } catch {
      /* Storage denial holds operation creation while allowing a session preference. */
    }
    return new DocumentDeliveryRecovery(applianceId, db);
  }
  #database(): IDBDatabase {
    if (!this.#db) throw new Error("operation identity storage unavailable");
    return this.#db;
  }
  async qualifyOrigin(
    origin: RoutingOrigin,
    options?: { previousOriginResolved: boolean },
  ): Promise<void> {
    if (origin.applianceId !== this.#applianceId) throw new Error("foreign origin");
    this.#ready.clear();
    if (this.#db) {
      const tx = this.#db.transaction("operations", "readwrite");
      const done = transactionDone(tx);
      const store = tx.objectStore("operations");
      const key = [this.#applianceId, "origin"];
      const previous = await request<RoutingOrigin | undefined>(store.get(key));
      if (previous && !sameOrigin(previous, origin) && !options?.previousOriginResolved) {
        await done;
        throw new Error("unresolved origin");
      }
      store.put(originCopy(origin), key);
      await done;
    }
    this.#origin = originCopy(origin);
  }
  #requireOrigin(origin?: RoutingOrigin): RoutingOrigin {
    if (!this.#origin || (origin && !sameOrigin(this.#origin, origin)))
      throw new Error("unqualified origin");
    return this.#origin;
  }
  async rememberAccepted(result: DeliveryResult): Promise<void> {
    const origin = this.#requireOrigin(result.origin);
    if (result.applianceId !== this.#applianceId) throw new Error("foreign origin");
    if (!/^(0|[1-9]\d*)$/.test(result.acceptanceOrder)) throw new TypeError("acceptance order");
    if (result.printerId === null) return;
    const candidate: Preference = {
      version: 1,
      printerId: result.printerId,
      origin: originCopy(origin),
      acceptanceOrder: result.acceptanceOrder,
    };
    try {
      const tx = this.#database().transaction(["preferences", "operations"], "readwrite");
      const done = transactionDone(tx);
      const authority = await request<RoutingOrigin | undefined>(
        tx.objectStore("operations").get([this.#applianceId, "origin"]),
      );
      if (!authority || !sameOrigin(authority, origin)) {
        await done;
        return;
      }
      const store = tx.objectStore("preferences");
      const key = [this.#applianceId, result.document];
      const saved = await request<Preference | undefined>(store.get(key));
      if (higher(candidate, saved)) store.put(candidate, key);
      await done;
      this.#preferences.set(result.document, higher(candidate, saved) ? candidate : saved!);
      this.#channel.postMessage({ applianceId: this.#applianceId });
    } catch {
      this.preferenceWarning = true;
      if (higher(candidate, this.#preferences.get(result.document)))
        this.#preferences.set(result.document, candidate);
    }
  }
  async readPreference(document: DocumentChoice): Promise<string | null> {
    if (!this.preferenceWarning) {
      try {
        const tx = this.#database().transaction("preferences");
        const done = transactionDone(tx);
        const saved = await request<Preference | undefined>(
          tx.objectStore("preferences").get([this.#applianceId, document]),
        );
        await done;
        if (saved) this.#preferences.set(document, saved);
      } catch {
        this.preferenceWarning = true;
      }
    }
    return this.#preferences.get(document)?.printerId ?? null;
  }
  #hold(subject: RecoverySubject) {
    this.#ready.delete(subjectKey(subject));
  }
  async retainOperation(value: RetainedDocumentOperation): Promise<void> {
    const subject = subjectOf(value);
    this.#hold(subject);
    this.#requireOrigin(value.operation.origin);
    try {
      const clean = retained(value);
      const tx = this.#database().transaction("operations", "readwrite");
      const done = transactionDone(tx);
      const store = tx.objectStore("operations");
      const authority = await request<RoutingOrigin | undefined>(
        store.get([this.#applianceId, "origin"]),
      );
      if (!authority || !sameOrigin(authority, value.operation.origin)) {
        await done;
        throw new Error("stale operation origin");
      }
      const saved = await request<StoredOperation | undefined>(
        store.get(operationKey(value.operation)),
      );
      if (saved && !sameIdentity(saved, value)) {
        await done;
        throw new Error("reused operation identity");
      }
      if (!saved) store.put(clean, operationKey(value.operation));
      await done;
      const key = subjectKey(subject);
      const pending = this.#pending.get(key) ?? new Set<string>();
      pending.add(value.operation.key);
      this.#pending.set(key, pending);
      this.#channel.postMessage({ applianceId: this.#applianceId, subject });
    } catch (error) {
      this.identityWarning = true;
      throw error;
    }
  }
  async recordOutcome(
    value: RetainedDocumentOperation,
    outcome: RecoveryOutcome,
  ): Promise<RecoveredDocumentOperation> {
    const clean = retained(value);
    const checked = checkedOutcome(value, outcome);
    try {
      const tx = this.#database().transaction("operations", "readwrite");
      const done = transactionDone(tx);
      const store = tx.objectStore("operations");
      const saved = await request<StoredOperation | undefined>(
        store.get(operationKey(value.operation)),
      );
      if (saved && !sameIdentity(saved, value)) {
        await done;
        throw new Error("reused operation identity");
      }
      if (
        saved?.outcome &&
        saved.outcome.state !== "prepared" &&
        JSON.stringify(saved.outcome) !== JSON.stringify(checked)
      ) {
        await done;
        throw new Error("contradictory operation outcome");
      }
      store.put({ ...clean, outcome: checked }, operationKey(value.operation));
      await done;
    } catch (error) {
      this.identityWarning = true;
      throw error;
    }
    if (checked.state === "accepted" && "requestKey" in checked.result)
      await this.rememberAccepted(checked.result);
    return { ...clean, outcome: checked };
  }
  async recoverOutstanding(
    subject: RecoverySubject,
    api: DocumentRecoveryApi,
  ): Promise<RecoveredDocumentOperation[]> {
    const key = subjectKey(subject);
    this.#hold(subject);
    this.#recovering.add(key);
    const generation = (this.#recoveryGeneration.get(key) ?? 0) + 1;
    this.#recoveryGeneration.set(key, generation);
    const origin = this.#requireOrigin();
    try {
      const tx = this.#database().transaction("operations");
      const done = transactionDone(tx);
      const all = await request<(StoredOperation | RoutingOrigin)[]>(
        tx.objectStore("operations").getAll(),
      );
      await done;
      const local = all.filter(
        (value): value is StoredOperation =>
          "kind" in value &&
          value.operation.origin.applianceId === this.#applianceId &&
          value.subjectId === subject.id &&
          subjectOf(value).kind === subject.kind,
      );
      if (local.some((value) => !sameOrigin(value.operation.origin, origin)))
        throw new Error("unresolved operation origin");
      const inventory = await api.inventory(origin, subject);
      const entries = new Map(local.map((value) => [value.operation.key, value]));
      for (const value of inventory) {
        if (value.subjectId !== subject.id) throw new Error("inventory subject");
        this.#requireOrigin(value.operation.origin);
        const entry = {
          kind: subject.kind === "sale" ? "delivery" : "invoice-save",
          ...value,
        } as StoredOperation;
        const existing = entries.get(value.operation.key);
        if (existing && !sameIdentity(existing, entry)) throw new Error("inventory identity");
        entries.set(value.operation.key, entry);
      }
      const recovered: RecoveredDocumentOperation[] = [];
      for (const value of entries.values()) {
        await this.retainOperation(value);
        const authorized = inventory.find((entry) => entry.operation.key === value.operation.key);
        const outcome =
          authorized && authorized.outcome.state !== "prepared"
            ? authorized.outcome
            : await api.recover(value.operation, subject, "fence");
        const row = await this.recordOutcome(value, outcome);
        recovered.push(row);
        if (row.outcome.state === "fenced" || row.outcome.state === "refused")
          await this.acknowledgeRecovered(row, api);
      }
      if (
        this.#recoveryGeneration.get(key) === generation &&
        sameOrigin(this.#requireOrigin(), origin)
      ) {
        this.identityWarning = false;
        this.#recovering.delete(key);
        this.#ready.add(key);
      }
      return recovered;
    } catch (error) {
      if (this.#recoveryGeneration.get(key) === generation) {
        this.#recovering.delete(key);
        this.#hold(subject);
      }
      throw error;
    }
  }
  async acknowledgeRecovered(
    value: RecoveredDocumentOperation,
    api: DocumentRecoveryApi,
  ): Promise<void> {
    this.#requireOrigin(value.operation.origin);
    if (value.outcome.state === "prepared") throw new Error("operation remains prepared");
    const subject = subjectOf(value);
    const key = subjectKey(subject);
    const generation = this.#recoveryGeneration.get(key);
    this.#hold(subject);
    const checked = await this.recordOutcome(value, value.outcome);
    await api.acknowledge(checked.operation, subject);
    try {
      const tx = this.#database().transaction("operations", "readwrite");
      const done = transactionDone(tx);
      tx.objectStore("operations").delete(operationKey(value.operation));
      await done;
      this.#pending.get(subjectKey(subject))?.delete(value.operation.key);
      if (generation === this.#recoveryGeneration.get(key) && !this.#recovering.has(key))
        this.#ready.add(key);
    } catch (error) {
      this.identityWarning = true;
      throw error;
    }
  }
  canSubmit(subject: RecoverySubject): boolean {
    return (
      this.#origin !== null &&
      !this.identityWarning &&
      this.#ready.has(subjectKey(subject)) &&
      (this.#pending.get(subjectKey(subject))?.size ?? 0) === 0
    );
  }
  close(): void {
    this.#db?.close();
    this.#db = null;
    this.#channel.close();
  }
}
