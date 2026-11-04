import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeliveryResult, RoutingOrigin } from "@waitron/shared";
import {
  DocumentDeliveryRecovery,
  type DocumentRecoveryApi,
  type RetainedDocumentOperation,
} from "./document-delivery-recovery.js";

const origin: RoutingOrigin = {
  applianceId: "10000000-0000-4000-8000-000000000001",
  nodeId: "10000000-0000-4000-8000-000000000002",
  recoveryEpoch: "10000000-0000-4000-8000-000000000003",
};
const subject = { kind: "sale", id: "10000000-0000-4000-8000-000000000004" } as const;
const printer = "10000000-0000-4000-8000-000000000005";
const second = "10000000-0000-4000-8000-000000000006";
function result(overrides: Partial<DeliveryResult> = {}): DeliveryResult {
  return {
    origin,
    applianceId: origin.applianceId,
    requestKey: crypto.randomUUID(),
    saleId: subject.id,
    document: "receipt",
    designation: "duplicate",
    acceptanceOrder: "1",
    printerId: printer,
    work: { kind: "receipt-job", id: crypto.randomUUID() },
    auditId: null,
    ...overrides,
  };
}
function operation(): RetainedDocumentOperation {
  return {
    kind: "delivery",
    rememberPreference: true,
    operation: { origin, key: crypto.randomUUID() },
    subjectId: subject.id,
    fingerprint: "a".repeat(64),
  };
}
const instances: DocumentDeliveryRecovery[] = [];
async function open(applianceId = origin.applianceId) {
  const value = await DocumentDeliveryRecovery.open(applianceId);
  instances.push(value);
  return value;
}
async function qualified() {
  const value = await open();
  await value.qualifyOrigin(origin);
  return value;
}
function api(overrides: Partial<DocumentRecoveryApi> = {}): DocumentRecoveryApi {
  return {
    inventory: async () => [],
    recover: async () => ({ state: "fenced", code: "document_delivery.request_unavailable" }),
    acknowledge: async () => {},
    ...overrides,
  };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const instance of instances.splice(0)) instance?.close();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("waitron-document-routing-v1");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("routing database left open"));
  });
});

describe("document printer memory", () => {
  it("retains the highest server order across independent tabs and logins, documents and appliances", async () => {
    const a = await qualified();
    const b = await qualified();
    await Promise.all([
      a.rememberAccepted(result({ printerId: second, acceptanceOrder: "9007199254740993" })),
      b.rememberAccepted(result({ acceptanceOrder: "9007199254740992" })),
    ]);
    expect(await b.readPreference("receipt")).toBe(second);
    await b.rememberAccepted(result({ document: "invoice", printerId: printer }));
    expect(await a.readPreference("invoice")).toBe(printer);
    expect(await a.readPreference("receipt")).toBe(second);
    const otherOrigin = {
      ...origin,
      applianceId: "10000000-0000-4000-8000-000000000007",
      nodeId: "10000000-0000-4000-8000-000000000007",
    };
    const other = await open(otherOrigin.applianceId);
    await other.qualifyOrigin(otherOrigin);
    expect(await other.readPreference("receipt")).toBeNull();
    a.close();
    const reopened = await qualified();
    expect(await reopened.readPreference("receipt")).toBe(second);
  });
  it("does not let a delayed old epoch overwrite qualified current-origin memory", async () => {
    const old = await qualified();
    await old.rememberAccepted(result({ acceptanceOrder: "999" }));
    const current = await open();
    const changed = { ...origin, recoveryEpoch: crypto.randomUUID() };
    await expect(current.qualifyOrigin(changed)).rejects.toThrow("origin");
    expect(await current.readPreference("receipt")).toBe(printer);
    await current.qualifyOrigin(changed, { previousOriginResolved: true });
    await current.rememberAccepted(result({ origin: changed, printerId: second }));
    await old.rememberAccepted(result({ acceptanceOrder: "1000" }));
    expect(await current.readPreference("receipt")).toBe(second);
  });
  it("ignores email results and refuses unqualified, foreign and malformed acceptance provenance", async () => {
    const store = await open();
    await expect(store.rememberAccepted(result())).rejects.toThrow("origin");
    await store.qualifyOrigin(origin);
    await store.rememberAccepted(result({ printerId: null }));
    expect(await store.readPreference("receipt")).toBeNull();
    await expect(store.rememberAccepted(result({ applianceId: second }))).rejects.toThrow("origin");
    for (const acceptanceOrder of ["-1", "1.5", "01", "garbage"])
      await expect(store.rememberAccepted(result({ acceptanceOrder }))).rejects.toThrow("order");
  });
  it("publishes committed preference changes to another tab", async () => {
    const a = await qualified();
    const b = await qualified();
    const published = new Promise<void>((resolve) =>
      b.addEventListener("preference-change", () => resolve(), { once: true }),
    );
    await a.rememberAccepted(result());
    await published;
    expect(await b.readPreference("receipt")).toBe(printer);
  });
  it("warns and keeps session preference when preference writes fail", async () => {
    const store = await qualified();
    const native = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
      this: IDBDatabase,
      names,
      ...args
    ) {
      if (
        (names === "preferences" || (Array.isArray(names) && names.includes("preferences"))) &&
        args[0] === "readwrite"
      )
        throw new DOMException("blocked", "QuotaExceededError");
      return native.call(this, names, ...args);
    });
    await store.rememberAccepted(result());
    expect(store.preferenceWarning).toBe(true);
    expect(await store.readPreference("receipt")).toBe(printer);
  });
});

describe("unanswered document operations", () => {
  it("requires recovery before fresh work and retains exact identity across reopening", async () => {
    const store = await qualified();
    expect(store.canSubmit(subject)).toBe(false);
    await store.recoverOutstanding(subject, api());
    expect(store.canSubmit(subject)).toBe(true);
    const pending = operation();
    await store.retainOperation(pending);
    expect(store.canSubmit(subject)).toBe(false);
    store.close();
    const reopened = await qualified();
    const calls: unknown[] = [];
    await reopened.recoverOutstanding(
      subject,
      api({
        recover: async (...args) => {
          calls.push(args);
          return { state: "fenced", code: "document_delivery.request_unavailable" };
        },
      }),
    );
    expect(calls).toEqual([[pending.operation, subject, "fence"]]);
    expect(reopened.canSubmit(subject)).toBe(true);
  });
  it("recovers server inventory after browser identity loss without accepting prepared work", async () => {
    const store = await qualified();
    const pending = operation();
    const resolutions: unknown[] = [];
    const recovered = await store.recoverOutstanding(
      subject,
      api({
        inventory: async () => [
          {
            operation: pending.operation,
            subjectId: subject.id,
            fingerprint: pending.fingerprint,
            outcome: { state: "prepared" },
          },
        ],
        recover: async (...args) => {
          resolutions.push(args);
          return { state: "fenced", code: "document_delivery.request_unavailable" };
        },
      }),
    );
    expect(resolutions).toEqual([[pending.operation, subject, "fence"]]);
    expect(recovered[0]?.outcome.state).toBe("fenced");
    expect(store.canSubmit(subject)).toBe(true);
  });
  it("persists accepted memory before acknowledgement and replays after acknowledgement failure", async () => {
    const store = await qualified();
    const pending = operation();
    const accepted = result({ requestKey: pending.operation.key });
    const seat = api({
      inventory: async () => [
        {
          operation: pending.operation,
          subjectId: subject.id,
          fingerprint: pending.fingerprint,
          rememberPreference: true,
          outcome: { state: "accepted", result: accepted },
        },
      ],
      acknowledge: async () => {
        throw new Error("offline");
      },
    });
    const recovered = await store.recoverOutstanding(subject, seat);
    expect(await store.readPreference("receipt")).toBe(printer);
    await expect(store.acknowledgeRecovered(recovered[0]!, seat)).rejects.toThrow("offline");
    expect(store.canSubmit(subject)).toBe(false);
    store.close();
    const reopened = await qualified();
    const again = await reopened.recoverOutstanding(subject, seat);
    expect(again[0]?.outcome).toEqual({ state: "accepted", result: accepted });
    await reopened.acknowledgeRecovered(again[0]!, api());
    expect(reopened.canSubmit(subject)).toBe(true);
  });
  it("holds fresh commands when identity storage or inventory fails", async () => {
    const store = await qualified();
    await store.recoverOutstanding(subject, api());
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    await expect(store.retainOperation(operation())).rejects.toThrow("storage blocked");
    expect(store.identityWarning).toBe(true);
    expect(store.canSubmit(subject)).toBe(false);
    vi.restoreAllMocks();
    await expect(
      store.recoverOutstanding(
        subject,
        api({
          inventory: async () => {
            throw new Error("offline");
          },
        }),
      ),
    ).rejects.toThrow("offline");
    expect(store.canSubmit(subject)).toBe(false);
  });
  it("holds uncertain old-origin operations even after a new origin was qualified", async () => {
    const store = await qualified();
    await store.retainOperation(operation());
    await store.qualifyOrigin(
      { ...origin, recoveryEpoch: crypto.randomUUID() },
      { previousOriginResolved: true },
    );
    await expect(store.recoverOutstanding(subject, api())).rejects.toThrow("origin");
    expect(store.canSubmit(subject)).toBe(false);
  });
  it("refuses mismatched inventory, result linkage and reused canonical fingerprints", async () => {
    const store = await qualified();
    const pending = operation();
    await store.retainOperation(pending);
    await expect(
      store.retainOperation({ ...pending, fingerprint: "b".repeat(64) }),
    ).rejects.toThrow("identity");
    await expect(
      store.recoverOutstanding(
        subject,
        api({
          inventory: async () => [
            {
              operation: pending.operation,
              subjectId: second,
              fingerprint: pending.fingerprint,
              outcome: { state: "prepared" },
            },
          ],
        }),
      ),
    ).rejects.toThrow("subject");
    await expect(
      store.recoverOutstanding(
        subject,
        api({ recover: async () => ({ state: "accepted", result: result() }) }),
      ),
    ).rejects.toThrow("identity");
    expect(store.canSubmit(subject)).toBe(false);
  });
  it("stores only operation identity and fingerprint, excluding caller secrets and customer data", async () => {
    const store = await qualified();
    const pending = {
      ...operation(),
      recipient: "guest@example.com",
      token: "secret",
      intent: { guestName: "Guest" },
    };
    await store.retainOperation(pending);
    store.close();
    const reopened = await qualified();
    const recovered = await reopened.recoverOutstanding(subject, api());
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.operation).toEqual(pending.operation);
    expect(JSON.stringify(recovered)).not.toMatch(/guest|secret|recipient|token|intent/);
  });
});

describe("identity fencing boundaries", () => {
  it("a stale tab cannot retain new operations after another tab qualifies a new epoch", async () => {
    const old = await qualified();
    const current = await open();
    await current.qualifyOrigin(
      { ...origin, recoveryEpoch: crypto.randomUUID() },
      { previousOriginResolved: true },
    );
    await expect(old.retainOperation(operation())).rejects.toThrow("origin");
  });
  it("a late recovery cannot release a newer outstanding inventory read", async () => {
    const store = await qualified();
    let resolveOld!: (value: []) => void;
    let resolveNew!: (value: []) => void;
    const old = store.recoverOutstanding(
      subject,
      api({
        inventory: async () =>
          new Promise<[]>((resolve) => {
            resolveOld = resolve;
          }),
      }),
    );
    await vi.waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    const current = store.recoverOutstanding(
      subject,
      api({
        inventory: async () =>
          new Promise<[]>((resolve) => {
            resolveNew = resolve;
          }),
      }),
    );
    await vi.waitFor(() => expect(resolveNew).toBeTypeOf("function"));
    resolveOld([]);
    await old;
    expect(store.canSubmit(subject)).toBe(false);
    resolveNew([]);
    await current;
    expect(store.canSubmit(subject)).toBe(true);
  });
  it("an older acknowledgement cannot release a newer recovery read", async () => {
    const store = await qualified();
    const pending = operation();
    await store.retainOperation(pending);
    const recovered = await store.recordOutcome(pending, {
      state: "accepted",
      result: result({ requestKey: pending.operation.key }),
    });
    let ackStarted = false;
    let releaseAck!: () => void;
    const ack = store.acknowledgeRecovered(
      recovered,
      api({
        acknowledge: async () => {
          ackStarted = true;
          await new Promise<void>((resolve) => {
            releaseAck = resolve;
          });
        },
      }),
    );
    await vi.waitFor(() => expect(ackStarted).toBe(true));
    let releaseInventory!: (value: []) => void;
    const reading = store.recoverOutstanding(
      subject,
      api({
        inventory: async () =>
          new Promise<[]>((resolve) => {
            releaseInventory = resolve;
          }),
        recover: async () => recovered.outcome,
      }),
    );
    await vi.waitFor(() => expect(releaseInventory).toBeTypeOf("function"));
    releaseAck();
    await ack;
    expect(store.canSubmit(subject)).toBe(false);
    releaseInventory([]);
    await reading;
  });
});

describe("durability and replay authority", () => {
  it("rechecks the server before replaying an accepted result retained only in this browser", async () => {
    const store = await qualified();
    const pending = operation();
    await store.retainOperation(pending);
    await store.recordOutcome(pending, {
      state: "accepted",
      result: result({ requestKey: pending.operation.key }),
    });
    await expect(
      store.recoverOutstanding(
        subject,
        api({
          recover: async () => {
            throw new Error("permission revoked");
          },
        }),
      ),
    ).rejects.toThrow("permission revoked");
    expect(store.canSubmit(subject)).toBe(false);
  });
  it("does not lose fallback session preference when another tab publishes an older acceptance", async () => {
    const store = await qualified();
    const other = await qualified();
    const native = IDBDatabase.prototype.transaction;
    const spy = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
      this: IDBDatabase,
      names,
      ...args
    ) {
      if (Array.isArray(names) && names.includes("preferences")) throw new Error("quota");
      return native.call(this, names, ...args);
    });
    await store.rememberAccepted(result({ printerId: second, acceptanceOrder: "2" }));
    spy.mockRestore();
    const published = new Promise<void>((resolve) =>
      store.addEventListener("preference-change", () => resolve(), { once: true }),
    );
    await other.rememberAccepted(result());
    await published;
    expect(await store.readPreference("receipt")).toBe(second);
  });
  it("keeps accepted result linkage immutable if a later callback reports a contradictory terminal result", async () => {
    const store = await qualified();
    const pending = operation();
    await store.retainOperation(pending);
    await store.recordOutcome(pending, {
      state: "accepted",
      result: result({ requestKey: pending.operation.key }),
    });
    await expect(store.recordOutcome(pending, { state: "fenced", code: "no" })).rejects.toThrow(
      "outcome",
    );
    await expect(
      store.recordOutcome(pending, {
        state: "accepted",
        result: result({ requestKey: pending.operation.key, printerId: second }),
      }),
    ).rejects.toThrow("outcome");
  });
  it("storage denial permits warned session memory but no new operation identity", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const store = await open();
    await store.qualifyOrigin(origin);
    await store.rememberAccepted(result());
    expect(store.preferenceWarning).toBe(true);
    expect(await store.readPreference("receipt")).toBe(printer);
    expect(store.canSubmit(subject)).toBe(false);
    await expect(store.retainOperation(operation())).rejects.toThrow("storage unavailable");
  });
  it("refuses acknowledgement while prepared and invalid result keys before any acknowledgement", async () => {
    const store = await qualified();
    const pending = operation();
    await store.retainOperation(pending);
    await expect(
      store.acknowledgeRecovered({ ...pending, outcome: { state: "prepared" } }, api()),
    ).rejects.toThrow("prepared");
    await expect(
      store.recordOutcome(pending, {
        state: "accepted",
        result: result({
          origin: { ...origin, nodeId: second },
          requestKey: pending.operation.key,
        }),
      }),
    ).rejects.toThrow("identity");
    await expect(
      store.recordOutcome(pending, {
        state: "accepted",
        result: {
          origin,
          saveId: pending.operation.key,
          deviceId: subject.id,
          revision: 1,
          chosenId: printer,
          resolvedId: printer,
        },
      }),
    ).rejects.toThrow("identity");
    const save = { ...pending, kind: "invoice-save" as const };
    await expect(
      store.recordOutcome(save, {
        state: "accepted",
        result: result({ requestKey: pending.operation.key }),
      }),
    ).rejects.toThrow("identity");
    await expect(
      store.recordOutcome(save, {
        state: "accepted",
        result: {
          origin,
          saveId: second,
          deviceId: subject.id,
          revision: 1,
          chosenId: printer,
          resolvedId: printer,
        },
      }),
    ).rejects.toThrow("identity");
  });
  it("does not acknowledge when persisting a known result fails", async () => {
    const store = await qualified();
    const pending = operation();
    await store.retainOperation(pending);
    let acknowledgements = 0;
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
      throw new Error("quota");
    });
    await expect(
      store.acknowledgeRecovered(
        {
          ...pending,
          outcome: { state: "accepted", result: result({ requestKey: pending.operation.key }) },
        },
        api({
          acknowledge: async () => {
            acknowledgements++;
          },
        }),
      ),
    ).rejects.toThrow("quota");
    expect(acknowledgements).toBe(0);
    expect(store.identityWarning).toBe(true);
  });
});

describe("browser storage boundaries", () => {
  it("an aborted durability transaction holds new work and reports identity failure", async () => {
    const store = await qualified();
    const native = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
      this: IDBDatabase,
      ...args
    ) {
      const tx = native.apply(this, args);
      queueMicrotask(() => tx.abort());
      return tx;
    });
    await expect(store.retainOperation(operation())).rejects.toThrow();
    expect(store.identityWarning).toBe(true);
    expect(store.canSubmit(subject)).toBe(false);
  });
  it("warns on a failed preference read while retaining the last session value", async () => {
    const store = await qualified();
    await store.rememberAccepted(result());
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
      throw new Error("read denied");
    });
    expect(await store.readPreference("receipt")).toBe(printer);
    expect(store.preferenceWarning).toBe(true);
    await store.rememberAccepted(result({ printerId: second, acceptanceOrder: "0" }));
    expect(await store.readPreference("receipt")).toBe(printer);
  });
  it("requires explicit provenance and a fingerprint without customer payload", async () => {
    const store = await qualified();
    await expect(store.qualifyOrigin({ ...origin, applianceId: second })).rejects.toThrow("origin");
    await expect(
      store.retainOperation({ ...operation(), fingerprint: "guest@example.com" }),
    ).rejects.toThrow("fingerprint");
  });
  it("can reopen with warned memory when the browser refuses an obsolete database version", async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const q = indexedDB.open("waitron-document-routing-v1", 2);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    db.close();
    const store = await open();
    expect(store.identityWarning).toBe(true);
    expect(store.preferenceWarning).toBe(true);
  });
  it("another tab retaining an operation invalidates readiness without exposing it to another appliance", async () => {
    const a = await qualified();
    const b = await qualified();
    await b.recoverOutstanding(subject, api());
    expect(b.canSubmit(subject)).toBe(true);
    await a.retainOperation(operation());
    await vi.waitFor(() => expect(b.canSubmit(subject)).toBe(false));
    const otherOrigin = { ...origin, applianceId: second };
    const other = await open(second);
    await other.qualifyOrigin(otherOrigin);
    await other.recoverOutstanding(subject, api());
    await a.rememberAccepted(result());
    await new Promise<void>((resolve) =>
      b.addEventListener("preference-change", () => resolve(), { once: true }),
    );
    expect(other.canSubmit(subject)).toBe(true);
    expect(await other.readPreference("receipt")).toBeNull();
  });
  it("inventory cannot rewrite a retained fingerprint and results cannot reuse its operation kind", async () => {
    const store = await qualified();
    const pending = operation();
    await store.retainOperation(pending);
    await expect(
      store.recoverOutstanding(
        subject,
        api({
          inventory: async () => [
            {
              operation: pending.operation,
              subjectId: subject.id,
              fingerprint: "b".repeat(64),
              outcome: { state: "prepared" },
            },
          ],
        }),
      ),
    ).rejects.toThrow("identity");
    await expect(
      store.recordOutcome({ ...pending, fingerprint: "b".repeat(64) }, { state: "prepared" }),
    ).rejects.toThrow("identity");
  });
  it("recovers device-save inventory and retains its exact confirmed revision", async () => {
    const store = await qualified();
    const pending = operation();
    const device = { kind: "device", id: subject.id } as const;
    const accepted = {
      origin,
      saveId: pending.operation.key,
      deviceId: subject.id,
      revision: 7,
      chosenId: second,
      resolvedId: second,
    };
    const rows = await store.recoverOutstanding(
      device,
      api({
        inventory: async () => [
          {
            operation: pending.operation,
            subjectId: subject.id,
            fingerprint: pending.fingerprint,
            outcome: { state: "accepted", result: accepted },
          },
        ],
      }),
    );
    expect(rows[0]?.outcome).toEqual({ state: "accepted", result: accepted });
    expect(store.canSubmit(device)).toBe(false);
    await store.acknowledgeRecovered(rows[0]!, api());
    expect(store.canSubmit(device)).toBe(true);
    expect(await store.readPreference("invoice")).toBeNull();
  });
  it("a late failed recovery cannot remove a newer successful recovery gate", async () => {
    const store = await qualified();
    let rejectOld!: (error: Error) => void;
    const old = store.recoverOutstanding(
      subject,
      api({
        inventory: async () =>
          new Promise<[]>((_resolve, reject) => {
            rejectOld = reject;
          }),
      }),
    );
    const rejected = expect(old).rejects.toThrow("offline");
    await vi.waitFor(() => expect(rejectOld).toBeTypeOf("function"));
    await store.recoverOutstanding(subject, api());
    rejectOld(new Error("offline"));
    await rejected;
    expect(store.canSubmit(subject)).toBe(true);
  });
  it("acknowledged server work remains locally held when deleting its recovery identity fails", async () => {
    const store = await qualified();
    const pending = operation();
    await store.retainOperation(pending);
    const accepted = {
      ...pending,
      outcome: { state: "accepted", result: result({ requestKey: pending.operation.key }) },
    } as const;
    await expect(
      store.acknowledgeRecovered(
        accepted,
        api({
          acknowledge: async () => {
            vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
              throw new Error("delete failed");
            });
          },
        }),
      ),
    ).rejects.toThrow("delete failed");
    expect(store.identityWarning).toBe(true);
    expect(store.canSubmit(subject)).toBe(false);
  });
});

it("a blocked opening reports identity loss and closes a handle that arrives afterwards", async () => {
  const native = indexedDB.open.bind(indexedDB);
  vi.spyOn(indexedDB, "open").mockImplementation((name, version) => {
    const opening = native(name, version);
    queueMicrotask(() => opening.dispatchEvent(new Event("blocked")));
    return opening;
  });
  const store = await open();
  expect(store.identityWarning).toBe(true);
  expect(store.preferenceWarning).toBe(true);
});

describe("review: cross-tab holds during waits", () => {
  it("H5: a hold broadcast during inventory cannot be released by that older inventory", async () => {
    const a = await qualified();
    const b = await qualified();
    let release!: (value: []) => void;
    const reading = b.recoverOutstanding(
      subject,
      api({
        inventory: async () =>
          new Promise<[]>((resolve) => {
            release = resolve;
          }),
      }),
    );
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await a.retainOperation(operation());
    const published = new Promise<void>((resolve) =>
      b.addEventListener("preference-change", () => resolve(), { once: true }),
    );
    await a.rememberAccepted(result());
    await published;
    release([]);
    await reading;
    expect(b.canSubmit(subject)).toBe(false);
  });
  it("H5: a hold broadcast during acknowledgement cannot be released by that older acknowledgement", async () => {
    const a = await qualified();
    const b = await qualified();
    const pending = operation();
    await b.retainOperation(pending);
    const recovered = await b.recordOutcome(pending, {
      state: "accepted",
      result: result({ requestKey: pending.operation.key }),
    });
    let release!: () => void;
    const ack = b.acknowledgeRecovered(
      recovered,
      api({
        acknowledge: async () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      }),
    );
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await a.retainOperation(operation());
    const published = new Promise<void>((resolve) =>
      b.addEventListener("preference-change", () => resolve(), { once: true }),
    );
    await a.rememberAccepted(result({ acceptanceOrder: "2" }));
    await published;
    release();
    await ack;
    expect(b.canSubmit(subject)).toBe(false);
  });
  it("L5: an origin qualification cannot leave a readiness gate from the prior origin", async () => {
    const store = await qualified();
    let release!: (value: []) => void;
    const reading = store.recoverOutstanding(
      subject,
      api({
        inventory: async () =>
          new Promise<[]>((resolve) => {
            release = resolve;
          }),
      }),
    );
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const moving = store.qualifyOrigin(
      { ...origin, recoveryEpoch: second },
      { previousOriginResolved: true },
    );
    release([]);
    await Promise.allSettled([moving, reading]);
    expect(store.canSubmit(subject)).toBe(false);
  });
});
