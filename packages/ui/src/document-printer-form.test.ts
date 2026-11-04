import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DeliveryResult,
  DocumentOffers,
  InvoiceSaveResult,
  OperationResult,
  RoutingOrigin,
} from "@waitron/shared";
import { DocumentDeliveryRecovery } from "./document-delivery-recovery.js";
import {
  DocumentPrinterForm,
  type DocumentDeliveryApi,
  type InvoiceChoiceApi,
} from "./document-printer-form.js";
const origin: RoutingOrigin = {
  applianceId: "20000000-0000-4000-8000-000000000001",
  nodeId: "20000000-0000-4000-8000-000000000002",
  recoveryEpoch: "20000000-0000-4000-8000-000000000003",
};
const saleId = "20000000-0000-4000-8000-000000000004";
const a = "20000000-0000-4000-8000-000000000005";
const b = "20000000-0000-4000-8000-000000000006";
const deviceId = "20000000-0000-4000-8000-000000000007";
const profileId = "20000000-0000-4000-8000-000000000008";
function offers(overrides: Partial<DocumentOffers> = {}): DocumentOffers {
  return {
    origin,
    applianceId: origin.applianceId,
    saleId,
    invoiceType: "F1",
    invoiceNumber: "F/1042",
    documents: ["receipt", "invoice"],
    languages: ["es"],
    language: "es",
    context: { surface: "dashboard", deviceId: null, profileId: null },
    designation: "duplicate",
    printers: [
      { id: a, name: "Bar", kind: "receipt" },
      { id: b, name: "Office", kind: "a4" },
    ],
    chosenPrinterId: null,
    defaultPrinterId: null,
    invoiceRevision: null,
    actions: { print: true, email: true, replacesAttemptId: null, retryAttemptId: null },
    ...overrides,
  };
}
function result(key: string, overrides: Partial<DeliveryResult> = {}): DeliveryResult {
  return {
    origin,
    applianceId: origin.applianceId,
    requestKey: key,
    saleId,
    document: "receipt",
    designation: "duplicate",
    acceptanceOrder: "1",
    printerId: a,
    work: { kind: "receipt-job", id: crypto.randomUUID() },
    auditId: null,
    ...overrides,
  };
}
function seat(overrides: Partial<DocumentDeliveryApi> = {}): DocumentDeliveryApi {
  return {
    inventory: async () => [],
    recover: async () => ({ state: "fenced", code: "document_delivery.request_unavailable" }),
    acknowledge: async () => {},
    prepare: async () => ({ state: "prepared" }),
    accept: async (operation) => ({ state: "accepted", result: result(operation.key) }),
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const stores: DocumentDeliveryRecovery[] = [];
async function form(document: "receipt" | "invoice" = "receipt") {
  const recovery = await DocumentDeliveryRecovery.open(origin.applianceId);
  stores.push(recovery);
  await recovery.qualifyOrigin(origin);
  return { recovery, model: new DocumentPrinterForm(recovery, document) };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  await new Promise<void>((resolve, reject) => {
    const q = indexedDB.deleteDatabase("waitron-document-routing-v1");
    q.onsuccess = () => resolve();
    q.onerror = () => reject(q.error);
    q.onblocked = () => reject(new Error("database left open"));
  });
});

describe("document selection", () => {
  it("preselects eligible dashboard memory, else sole offer, else requires a deliberate choice", async () => {
    const { model } = await form();
    model.open(offers(), b);
    expect(model.printerId).toBe(b);
    model.open(offers(), null);
    expect(model.printerId).toBeNull();
    expect(model.canPrint).toBe(false);
    expect(model.unavailablePreference).toBe(false);
    model.open(offers({ printers: [offers().printers[0]!] }), b);
    expect(model.printerId).toBe(a);
    expect(model.unavailablePreference).toBe(true);
  });
  it("device Invoice uses saved choice then profile default, never sole-offer or dashboard memory fallback", async () => {
    const { model } = await form("invoice");
    const context = { surface: "till", deviceId, profileId } as const;
    model.open(offers({ context, chosenPrinterId: a, defaultPrinterId: b }), b);
    expect(model.printerId).toBe(a);
    model.open(offers({ context, chosenPrinterId: crypto.randomUUID(), defaultPrinterId: b }), a);
    expect(model.printerId).toBe(b);
    model.open(offers({ context, printers: [offers().printers[0]!] }), a);
    expect(model.printerId).toBeNull();
  });
  it("device Receipt consumes only effective Equipment choice, including switched-off chosen Receipt", async () => {
    const { model } = await form();
    const context = { surface: "till", deviceId, profileId } as const;
    model.open(offers({ context, chosenPrinterId: a, defaultPrinterId: b }), b);
    expect(model.printerId).toBe(a);
    model.open(
      offers({
        context,
        chosenPrinterId: a,
        defaultPrinterId: null,
        printers: [offers().printers[1]!],
      }),
      b,
    );
    expect(model.printerId).toBeNull();
  });
  it("keeps selection by id on reorder and requires reselection when withdrawn even with one remaining", async () => {
    const { model } = await form();
    model.open(offers(), a);
    model.applyOffers(offers({ printers: [...offers().printers].reverse() }));
    expect(model.printerId).toBe(a);
    model.applyOffers(offers({ printers: [offers().printers[1]!] }));
    expect(model.printerId).toBeNull();
    expect(model.selectionWithdrawn).toBe(true);
    model.selectPrinter(b);
    expect(model.printerId).toBe(b);
  });
  it("distinguishes loading, failed read and empty read; refresh never selects the returned sole printer", async () => {
    const { model } = await form();
    const token = model.beginLoad();
    expect(model.state).toBe("loading");
    model.readFailed(token);
    expect(model.state).toBe("read-failed");
    model.open(offers({ printers: [] }), null);
    expect(model.state).toBe("empty");
    expect(model.canPrint).toBe(false);
    model.applyOffers(offers({ printers: [offers().printers[0]!] }));
    expect(model.state).toBe("ready");
    expect(model.printerId).toBeNull();
  });
  it("selection, refusal, cancellation and empty offers never change accepted browser memory", async () => {
    const { model, recovery } = await form();
    await recovery.rememberAccepted(result(crypto.randomUUID()));
    const token = model.open(offers(), a);
    model.selectPrinter(b);
    await model.applyResult({ state: "refused", code: "printer.unavailable" }, token);
    model.close();
    model.open(offers({ printers: [] }), null);
    expect(await recovery.readPreference("receipt")).toBe(a);
  });
  it("freezes every submitted fact and cannot submit without recovered identity", async () => {
    const { model } = await form();
    const view = offers();
    model.open(view, a);
    expect(() => model.freezeIntent()).toThrow("recovery");
    await model.recover(seat());
    const intent = model.freezeIntent();
    view.printers[0]!.id = b;
    view.context.deviceId = deviceId;
    expect(intent).toEqual({
      medium: "print",
      origin,
      applianceId: origin.applianceId,
      saleId,
      document: "receipt",
      printerId: a,
      language: "es",
      context: { surface: "dashboard", deviceId: null, profileId: null },
      shownDesignation: "duplicate",
      replacesAttemptId: null,
    });
  });
});

describe("explicit document operation", () => {
  it("persists before prepare, sends the same key to accept and remembers acceptance before acknowledgement", async () => {
    const { model, recovery } = await form();
    const calls: unknown[] = [];
    let acceptedKey = "";
    const api = seat({
      prepare: async (operation, intent) => {
        calls.push(["prepare", operation, intent]);
        expect(recovery.canSubmit({ kind: "sale", id: saleId })).toBe(false);
        return { state: "prepared" };
      },
      accept: async (operation) => {
        acceptedKey = operation.key;
        calls.push(["accept", operation]);
        return { state: "accepted", result: result(operation.key) };
      },
      acknowledge: async () => {
        calls.push(["ack", await recovery.readPreference("receipt")]);
      },
    });
    model.open(offers(), a);
    await model.recover(api);
    await model.submit(api);
    expect(model.state).toBe("accepted");
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual(["prepare", { origin, key: acceptedKey }, model.intent]);
    expect(calls[1]).toEqual(["accept", { origin, key: acceptedKey }]);
    expect(calls[2]).toEqual(["ack", a]);
    model.statusUnavailable();
    expect(model.state).toBe("status-unavailable");
    expect(await recovery.readPreference("receipt")).toBe(a);
    expect(() => model.freezeIntent()).toThrow();
  });
  it("holds unknown acceptance until same-key fencing and never blindly accepts during recovery", async () => {
    const { model } = await form();
    let key = "";
    let accepts = 0;
    const resolutions: unknown[] = [];
    const api = seat({
      accept: async (operation) => {
        key = operation.key;
        accepts++;
        throw new Error("lost response");
      },
      recover: async (...args) => {
        resolutions.push(args);
        return { state: "fenced", code: "document_delivery.request_unavailable" };
      },
    });
    model.open(offers(), a);
    await model.recover(api);
    await model.submit(api);
    expect(model.state).toBe("unknown");
    expect(model.canPrint).toBe(false);
    await model.recover(api);
    expect(resolutions).toEqual([[{ origin, key }, { kind: "sale", id: saleId }, "fence"]]);
    expect(accepts).toBe(1);
    expect(model.canPrint).toBe(true);
  });
  it("retains late print acceptance without applying it to a reopened or logged-out form", async () => {
    const { model, recovery } = await form();
    const delayed = deferred<OperationResult<DeliveryResult>>();
    let key = "";
    const api = seat({
      accept: async (operation) => {
        key = operation.key;
        return delayed.promise;
      },
    });
    model.open(offers(), a);
    await model.recover(api);
    const sending = model.submit(api);
    await vi.waitFor(() => expect(key).not.toBe(""));
    model.close();
    model.open(offers({ saleId: b }), null);
    delayed.resolve({ state: "accepted", result: result(key) });
    await sending;
    expect(model.state).toBe("ready");
    expect(model.printerId).toBeNull();
    expect(await recovery.readPreference("receipt")).toBe(a);
  });
  it("old opening read and recovery cannot release the new opening gate", async () => {
    const { model } = await form();
    const inventory = deferred<[]>();
    const api = seat({ inventory: async () => inventory.promise });
    const old = model.open(offers(), a);
    const recovering = model.recover(api);
    model.close();
    model.open(offers({ saleId: b }), null);
    model.readFailed(old);
    model.applyOffers(offers(), old);
    inventory.resolve([]);
    await recovering;
    expect(model.saleId).toBe(b);
    expect(model.state).toBe("ready");
    expect(model.canPrint).toBe(false);
  });
  it("accepted preparation replay never dispatches acceptance a second time", async () => {
    const { model } = await form();
    let accepts = 0;
    const api = seat({
      prepare: async (operation) => ({ state: "accepted", result: result(operation.key) }),
      accept: async () => {
        accepts++;
        throw new Error("duplicate");
      },
    });
    model.open(offers(), a);
    await model.recover(api);
    await model.submit(api);
    expect(model.state).toBe("accepted");
    expect(accepts).toBe(0);
  });
  it("failed operation durability prevents any prepare or acceptance", async () => {
    const { model, recovery } = await form();
    let sends = 0;
    const api = seat({
      prepare: async () => {
        sends++;
        return { state: "prepared" };
      },
    });
    model.open(offers(), a);
    await model.recover(api);
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
      throw new Error("quota");
    });
    await model.submit(api);
    expect(sends).toBe(0);
    expect(recovery.identityWarning).toBe(true);
    expect(model.canPrint).toBe(false);
  });
});

describe("Invoice Equipment save", () => {
  it("holds Print while selection save is unknown and preserves saved choice when refresh fails", async () => {
    const { model } = await form("invoice");
    let saveId = "";
    const api: InvoiceChoiceApi = {
      inventory: async () => [],
      recover: async (operation) => ({
        state: "accepted",
        result: {
          origin,
          saveId: operation.key,
          deviceId,
          revision: 2,
          chosenId: b,
          resolvedId: b,
        },
      }),
      acknowledge: async () => {},
      prepare: async (save) => {
        saveId = save.saveId;
        return { state: "prepared" };
      },
      accept: async () => {
        throw new Error("lost save response");
      },
    };
    model.open(
      offers({
        context: { surface: "till", deviceId, profileId },
        chosenPrinterId: a,
        invoiceRevision: 1,
      }),
      null,
    );
    await model.recover(seat());
    await model.saveInvoice(b, api);
    expect(saveId).not.toBe("");
    expect(model.state).toBe("unknown");
    expect(model.canPrint).toBe(false);
    await model.recoverInvoice(api);
    expect(model.printerId).toBe(b);
    expect(model.canPrint).toBe(true);
    model.readFailed(model.generation);
    expect(model.printerId).toBe(b);
    expect(model.savedRefreshUnavailable).toBe(true);
  });
  it("restores authoritative prior choice after definitive save refusal and allows valid Print", async () => {
    const { model } = await form("invoice");
    const api: InvoiceChoiceApi = {
      inventory: async () => [],
      recover: async () => ({ state: "fenced", code: "device.invoice_save_unavailable" }),
      acknowledge: async () => {},
      prepare: async () => ({ state: "refused", code: "printer.unavailable" }),
      accept: async () => {
        throw new Error("must not accept");
      },
    };
    model.open(
      offers({
        context: { surface: "till", deviceId, profileId },
        chosenPrinterId: a,
        invoiceRevision: 0,
      }),
      null,
    );
    await model.recover(seat());
    await model.saveInvoice(b, api);
    expect(model.printerId).toBe(a);
    expect(model.refusal).toBe("printer.unavailable");
    expect(model.canPrint).toBe(true);
  });
  it("late save after opening another sale is retained without changing its selection or gate", async () => {
    const { model } = await form("invoice");
    const delayed = deferred<OperationResult<InvoiceSaveResult>>();
    let key = "";
    const api: InvoiceChoiceApi = {
      inventory: async () => [],
      recover: async () => ({ state: "fenced", code: "device.invoice_save_unavailable" }),
      acknowledge: async () => {},
      prepare: async (save) => {
        key = save.saveId;
        return { state: "prepared" };
      },
      accept: async () => delayed.promise,
    };
    model.open(
      offers({
        context: { surface: "till", deviceId, profileId },
        chosenPrinterId: a,
        invoiceRevision: 0,
      }),
      null,
    );
    await model.recover(seat());
    const saving = model.saveInvoice(b, api);
    await vi.waitFor(() => expect(key).not.toBe(""));
    model.open(offers({ saleId: b }), a);
    delayed.resolve({
      state: "accepted",
      result: { origin, saveId: key, deviceId, revision: 1, chosenId: b, resolvedId: b },
    });
    await saving;
    expect(model.saleId).toBe(b);
    expect(model.printerId).toBe(a);
    expect(model.canPrint).toBe(false);
  });
});

describe("late protocol boundaries", () => {
  it("closing before preparation returns leaves recovery work but never sends acceptance", async () => {
    const { model, recovery } = await form();
    const prepared = deferred<OperationResult<DeliveryResult>>();
    let prepares = 0;
    let accepts = 0;
    const api = seat({
      prepare: async () => {
        prepares++;
        return prepared.promise;
      },
      accept: async (operation) => {
        accepts++;
        return { state: "accepted", result: result(operation.key) };
      },
    });
    model.open(offers(), a);
    await model.recover(api);
    const sending = model.submit(api);
    await vi.waitFor(() => expect(prepares).toBe(1));
    model.close();
    prepared.resolve({ state: "prepared" });
    await sending;
    expect(accepts).toBe(0);
    expect(await recovery.readPreference("receipt")).toBeNull();
    model.open(offers(), a);
    await model.recover(api);
    expect(model.canPrint).toBe(true);
  });
  it("acknowledgement failure keeps accepted state and a recoverable result", async () => {
    const { model, recovery } = await form();
    const acceptedWork = crypto.randomUUID();
    const api = seat({
      accept: async (operation) => ({
        state: "accepted",
        result: result(operation.key, { work: { kind: "receipt-job", id: acceptedWork } }),
      }),
      acknowledge: async () => {
        throw new Error("offline");
      },
    });
    model.open(offers(), a);
    await model.recover(api);
    await model.submit(api);
    expect(model.state).toBe("accepted");
    expect(model.canPrint).toBe(false);
    expect(await recovery.readPreference("receipt")).toBe(a);
    await model.recover(
      seat({
        recover: async (operation) => ({
          state: "accepted",
          result: result(operation.key, { work: { kind: "receipt-job", id: acceptedWork } }),
        }),
      }),
    );
    expect(model.state).toBe("accepted");
  });
  it("unknown device Invoice save blocks a reopened form before another selection can print", async () => {
    const { model, recovery } = await form("invoice");
    const pending = {
      kind: "invoice-save",
      operation: { origin, key: crypto.randomUUID() },
      subjectId: deviceId,
      fingerprint: "a".repeat(64),
    } as const;
    await recovery.retainOperation(pending);
    model.open(
      offers({
        context: { surface: "till", deviceId, profileId },
        chosenPrinterId: a,
        invoiceRevision: 0,
      }),
      null,
    );
    const api = seat({
      inventory: async (_origin, subject) => {
        if (subject.kind === "device") throw new Error("save history unavailable");
        return [];
      },
    });
    await model.recover(api);
    expect(model.canPrint).toBe(false);
  });
  it("a fenced unknown Invoice save restores the prior choice and permits explicit Print", async () => {
    const { model } = await form("invoice");
    const api: InvoiceChoiceApi = {
      inventory: async () => [],
      recover: async () => ({ state: "fenced", code: "device.invoice_save_unavailable" }),
      acknowledge: async () => {},
      prepare: async () => ({ state: "prepared" }),
      accept: async () => {
        throw new Error("offline");
      },
    };
    model.open(
      offers({
        context: { surface: "till", deviceId, profileId },
        chosenPrinterId: a,
        invoiceRevision: 0,
      }),
      null,
    );
    await model.recover(seat());
    await model.saveInvoice(b, api);
    expect(model.state).toBe("unknown");
    await model.recoverInvoice(api);
    expect(model.printerId).toBe(a);
    expect(model.state).toBe("ready");
    expect(model.canPrint).toBe(true);
  });
  it("device Invoice selection cannot bypass its confirmed Equipment save", async () => {
    const { model } = await form("invoice");
    model.open(
      offers({
        context: { surface: "till", deviceId, profileId },
        chosenPrinterId: a,
        invoiceRevision: 0,
      }),
      null,
    );
    await model.recover(seat());
    model.selectPrinter(b);
    expect(model.canPrint).toBe(false);
  });
  it("a saved Invoice choice does not hide an unknown later save", async () => {
    const { model } = await form("invoice");
    const api: InvoiceChoiceApi = {
      inventory: async () => [],
      recover: async () => ({ state: "fenced", code: "device.invoice_save_unavailable" }),
      acknowledge: async () => {},
      prepare: async () => ({ state: "prepared" }),
      accept: async (operation) => ({
        state: "accepted",
        result: {
          origin,
          saveId: operation.key,
          deviceId,
          revision: 1,
          chosenId: b,
          resolvedId: b,
        },
      }),
    };
    model.open(
      offers({
        context: { surface: "till", deviceId, profileId },
        chosenPrinterId: a,
        invoiceRevision: 0,
      }),
      null,
    );
    await model.recover(seat());
    await model.saveInvoice(b, api);
    expect(model.printerId).toBe(b);
    await model.saveInvoice(a, {
      ...api,
      accept: async () => {
        throw new Error("offline");
      },
    });
    expect(model.state).toBe("unknown");
    expect(model.canPrint).toBe(false);
  });
});

describe("offer refresh and unavailable protocol states", () => {
  it("a new authorized context invalidates the old selection and late acceptance callback", async () => {
    const { model } = await form();
    model.open(offers(), a);
    await model.recover(seat());
    const generation = model.generation;
    model.applyOffers(offers({ saleId: b }));
    await model.applyResult({ state: "accepted", result: result(crypto.randomUUID()) }, generation);
    expect(model.saleId).toBe(b);
    expect(model.printerId).toBeNull();
    expect(model.selectionWithdrawn).toBe(true);
    expect(model.state).toBe("ready");
    expect(model.canPrint).toBe(false);
  });
  it("unknown preparation or still-prepared acceptance remains recoverable without a new confirmation", async () => {
    const { model } = await form();
    model.open(offers(), a);
    await model.recover(seat());
    await model.submit(seat({ accept: async () => ({ state: "prepared" }) }));
    expect(model.state).toBe("unknown");
    expect(model.canPrint).toBe(false);
    model.readFailed(model.generation);
    model.statusUnavailable();
    expect(model.state).toBe("unknown");
    model.applyOffers(offers({ printers: [] }));
    expect(model.state).toBe("unknown");
    await model.recover(seat());
    expect(model.state).toBe("empty");
    expect(model.canPrint).toBe(false);
  });
  it("invalid printer choices and unavailable reads never become executable", async () => {
    const { model } = await form();
    expect(model.saleId).toBeNull();
    await expect(model.recover(seat())).rejects.toThrow("offers");
    model.open(offers(), a);
    await model.recover(seat());
    model.selectPrinter(crypto.randomUUID());
    expect(model.printerId).toBe(a);
    model.readFailed(model.generation);
    model.selectPrinter(b);
    expect(model.printerId).toBe(a);
    expect(model.canPrint).toBe(false);
    model.applyOffers(offers({ printers: [] }));
    expect(model.state).toBe("empty");
    await model.applyResult(
      { state: "fenced", code: "document_delivery.request_unavailable" },
      model.generation,
    );
    expect(model.state).toBe("empty");
  });
  it("failed recovery remains unknown and a stale failed read cannot overwrite a new opening", async () => {
    const { model } = await form();
    model.open(offers(), a);
    await model.recover(
      seat({
        inventory: async () => {
          throw new Error("offline");
        },
      }),
    );
    expect(model.state).toBe("unknown");
    let fail!: (error: Error) => void;
    const old = model.recover(
      seat({
        inventory: async () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      }),
    );
    await vi.waitFor(() => expect(fail).toBeTypeOf("function"));
    model.open(offers({ saleId: b }), a);
    fail(new Error("offline"));
    await old;
    expect(model.state).toBe("ready");
    expect(model.saleId).toBe(b);
  });
  it("cannot start Invoice selection saves without a device, revision and eligible choice", async () => {
    const { model } = await form("invoice");
    const api: InvoiceChoiceApi = {
      ...seat(),
      prepare: async () => ({ state: "prepared" }),
      accept: async () => ({ state: "prepared" }),
    };
    model.open(offers(), a);
    await expect(model.saveInvoice(b, api)).rejects.toThrow("unavailable");
    model.open(offers({ invoiceRevision: 1 }), a);
    await expect(model.saveInvoice(b, api)).rejects.toThrow("device");
    model.open(
      offers({ context: { surface: "till", deviceId, profileId }, invoiceRevision: 1 }),
      null,
    );
    await expect(model.saveInvoice(crypto.randomUUID(), api)).rejects.toThrow("unavailable");
  });
  it("a still-prepared Invoice save holds selection until it can be reconciled", async () => {
    const { model } = await form("invoice");
    const api: InvoiceChoiceApi = {
      ...seat(),
      prepare: async () => ({ state: "prepared" }),
      accept: async () => ({ state: "prepared" }),
    };
    model.open(
      offers({
        context: { surface: "till", deviceId, profileId },
        chosenPrinterId: a,
        invoiceRevision: 0,
      }),
      null,
    );
    await model.recover(seat());
    await model.saveInvoice(b, api);
    expect(model.state).toBe("unknown");
    expect(model.canPrint).toBe(false);
  });
});

it("a reconciliation that is still prepared stays visibly unknown and cannot release Print", async () => {
  const { model } = await form();
  const api = seat({
    accept: async () => ({ state: "prepared" }),
    recover: async () => ({ state: "prepared" }),
  });
  model.open(offers(), a);
  await model.recover(api);
  await model.submit(api);
  expect(model.state).toBe("unknown");
  await model.recover(api);
  expect(model.state).toBe("unknown");
  expect(model.canPrint).toBe(false);
});

it("known acceptance recovered from inventory stays accepted when its acknowledgement is offline", async () => {
  const { model, recovery } = await form();
  const operation = { origin, key: crypto.randomUUID() };
  const accepted = result(operation.key);
  const api = seat({
    inventory: async () => [
      {
        operation,
        subjectId: saleId,
        fingerprint: "a".repeat(64),
        rememberPreference: true,
        outcome: { state: "accepted", result: accepted },
      },
    ],
    acknowledge: async () => {
      throw new Error("offline");
    },
  });
  model.open(offers(), a);
  await model.recover(api);
  expect(model.state).toBe("accepted");
  expect(model.canPrint).toBe(false);
  expect(await recovery.readPreference("receipt")).toBe(a);
});

describe("review: Invoice and stale callback races", () => {
  it("H1: another tab's unanswered device save holds Invoice Print", async () => {
    const { model } = await form("invoice");
    const other = await DocumentDeliveryRecovery.open(origin.applianceId);
    stores.push(other);
    await other.qualifyOrigin(origin);
    model.open(
      offers({
        context: { surface: "till", deviceId, profileId },
        chosenPrinterId: a,
        invoiceRevision: 0,
      }),
      null,
    );
    await model.recover(seat());
    expect(model.canPrint).toBe(true);
    await other.retainOperation({
      kind: "invoice-save",
      operation: { origin, key: crypto.randomUUID() },
      subjectId: deviceId,
      fingerprint: "a".repeat(64),
    });
    await vi.waitFor(() => expect(model.canPrint).toBe(false));
  });
  it("H2: another recovery cannot confirm an Invoice selection that was never saved", async () => {
    const { model } = await form("invoice");
    model.open(
      offers({
        context: { surface: "till", deviceId, profileId },
        chosenPrinterId: a,
        invoiceRevision: 0,
      }),
      null,
    );
    await model.recover(seat());
    model.selectPrinter(b);
    expect(model.canPrint).toBe(false);
    await model.recover(seat());
    expect(model.canPrint).toBe(false);
  });
  it("H3: older accepted Invoice recovery cannot replace newer offered revision", async () => {
    const { model } = await form("invoice");
    const operation = { origin, key: crypto.randomUUID() };
    const api = seat({
      inventory: async (_origin, subject) =>
        subject.kind === "device"
          ? [
              {
                operation,
                subjectId: deviceId,
                fingerprint: "a".repeat(64),
                outcome: {
                  state: "accepted",
                  result: {
                    origin,
                    saveId: operation.key,
                    deviceId,
                    revision: 5,
                    chosenId: a,
                    resolvedId: a,
                  },
                },
              },
            ]
          : [],
    });
    model.open(
      offers({
        context: { surface: "till", deviceId, profileId },
        chosenPrinterId: b,
        invoiceRevision: 7,
      }),
      null,
    );
    await model.recover(api);
    expect(model.printerId).toBe(b);
    expect(model.canPrint).toBe(true);
  });
  it("H4: late print acceptance is retained without acknowledgement after reopening the same sale", async () => {
    const { model, recovery } = await form();
    const delayed = deferred<OperationResult<DeliveryResult>>();
    let key = "";
    let acknowledgements = 0;
    const acceptedWork = crypto.randomUUID();
    const api = seat({
      accept: async (operation) => {
        key = operation.key;
        return delayed.promise;
      },
      recover: async (operation) => ({
        state: "accepted",
        result: result(operation.key, { work: { kind: "receipt-job", id: acceptedWork } }),
      }),
      acknowledge: async () => {
        acknowledgements++;
      },
    });
    model.open(offers(), a);
    await model.recover(api);
    const sending = model.submit(api);
    await vi.waitFor(() => expect(key).not.toBe(""));
    model.open(offers(), a);
    delayed.resolve({
      state: "accepted",
      result: result(key, { work: { kind: "receipt-job", id: acceptedWork } }),
    });
    await sending;
    expect(acknowledgements).toBe(0);
    expect(model.state).toBe("ready");
    expect(model.canPrint).toBe(false);
    const retained = await recovery.recoverOutstanding({ kind: "sale", id: saleId }, api);
    expect(retained.map((entry) => entry.operation.key)).toEqual([key]);
  });
  it("H6: an Invoice preparation that returns after close never sends acceptance", async () => {
    const { model } = await form("invoice");
    const prepared = deferred<OperationResult<InvoiceSaveResult>>();
    let prepares = 0;
    let accepts = 0;
    const api: InvoiceChoiceApi = {
      ...seat(),
      prepare: async () => {
        prepares++;
        return prepared.promise;
      },
      accept: async () => {
        accepts++;
        return { state: "prepared" };
      },
    };
    model.open(
      offers({
        context: { surface: "till", deviceId, profileId },
        chosenPrinterId: a,
        invoiceRevision: 0,
      }),
      null,
    );
    await model.recover(seat());
    const saving = model.saveInvoice(b, api);
    await vi.waitFor(() => expect(prepares).toBe(1));
    model.close();
    prepared.resolve({ state: "prepared" });
    await saving;
    expect(accepts).toBe(0);
  });
  it("M1: refused save cannot restore a printer withdrawn during the save", async () => {
    const { model } = await form("invoice");
    const response = deferred<OperationResult<InvoiceSaveResult>>();
    let sent = false;
    const api: InvoiceChoiceApi = {
      ...seat(),
      prepare: async () => {
        sent = true;
        return response.promise;
      },
      accept: async () => ({ state: "prepared" }),
    };
    model.open(
      offers({
        context: { surface: "till", deviceId, profileId },
        chosenPrinterId: a,
        invoiceRevision: 0,
      }),
      null,
    );
    await model.recover(seat());
    const saving = model.saveInvoice(b, api);
    await vi.waitFor(() => expect(sent).toBe(true));
    model.applyOffers(
      offers({
        context: { surface: "till", deviceId, profileId },
        chosenPrinterId: a,
        invoiceRevision: 0,
        printers: [offers().printers[1]!],
      }),
    );
    response.resolve({ state: "refused", code: "printer.unavailable" });
    await saving;
    expect(model.printerId).toBeNull();
    expect(model.canPrint).toBe(false);
  });
  it("M2: context replacement during prepare clears its old saving state and gate", async () => {
    const { model } = await form();
    const prepared = deferred<OperationResult<DeliveryResult>>();
    let sent = false;
    const api = seat({
      prepare: async () => {
        sent = true;
        return prepared.promise;
      },
    });
    model.open(offers(), a);
    await model.recover(api);
    const sending = model.submit(api);
    await vi.waitFor(() => expect(sent).toBe(true));
    model.applyOffers(offers({ saleId: b }));
    prepared.resolve({ state: "prepared" });
    await sending;
    await model.recover(seat());
    expect(model.state).toBe("ready");
    expect(model.canPrint).toBe(false);
  });
  it("M4: Receipt with no chosen printer consumes the eligible profile default", async () => {
    const { model } = await form();
    model.open(
      offers({
        context: { surface: "till", deviceId, profileId },
        chosenPrinterId: null,
        defaultPrinterId: b,
      }),
      null,
    );
    expect(model.printerId).toBe(b);
  });
  it("L3: accepting a device Receipt changes no dashboard printer memory", async () => {
    const { model, recovery } = await form();
    model.open(
      offers({ context: { surface: "till", deviceId, profileId }, chosenPrinterId: a }),
      null,
    );
    await model.recover(seat());
    await model.submit(seat());
    expect(model.state).toBe("accepted");
    expect(await recovery.readPreference("receipt")).toBeNull();
  });
});

it("review L4: save fingerprints use normalized field order even when origin fields arrive reversed", async () => {
  const { model, recovery } = await form("invoice");
  let saveId = "";
  const reversed = {
    recoveryEpoch: origin.recoveryEpoch,
    nodeId: origin.nodeId,
    applianceId: origin.applianceId,
  };
  const api: InvoiceChoiceApi = {
    ...seat(),
    prepare: async (save) => {
      saveId = save.saveId;
      return { state: "prepared" };
    },
    accept: async () => ({ state: "prepared" }),
    recover: async () => ({ state: "prepared" }),
  };
  model.open(
    offers({
      origin: reversed,
      context: { surface: "till", deviceId, profileId },
      chosenPrinterId: a,
      invoiceRevision: 0,
    }),
    null,
  );
  await model.recover(seat());
  await model.saveInvoice(b, api);
  const canonical = `{"origin":{"applianceId":"${origin.applianceId}","nodeId":"${origin.nodeId}","recoveryEpoch":"${origin.recoveryEpoch}"},"applianceId":"${origin.applianceId}","saveId":"${saveId}","deviceId":"${deviceId}","expectedRevision":0,"selection":{"id":"${b}"}}`;
  const expected = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const retained = await recovery.recoverOutstanding({ kind: "device", id: deviceId }, api);
  expect(retained[0]?.fingerprint).toBe(expected);
});
