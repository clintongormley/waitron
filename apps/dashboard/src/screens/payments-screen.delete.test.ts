import { html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveData, registerCatalogue } from "@waitron/dashboard-kit";
import type { DeleteImpact } from "@waitron/shared";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type { DashboardApi, ReaderRow } from "../api/client.js";
import { cleanupWidgets, dialogClosed, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale } from "../i18n/t.js";
import type { PaymentsScreen } from "./payments-screen.js";
import "./payments-screen.js";

type Dialog = HTMLElementTagNameMap["wt-delete-dialog"];

const counter: ReaderRow = {
  id: "counter",
  provider: "acme",
  name: "Counter",
  active: true,
  canEnable: true,
  deviceCount: 0,
  deviceNames: [],
};
const terrace: ReaderRow = { ...counter, id: "terrace", name: "Terrace", active: false };
const unpaired: ReaderRow = {
  ...counter,
  id: "loose",
  name: "Loose",
  active: false,
  canEnable: false,
};
const readers = [counter, terrace, unpaired];

const impactOf = (id: string, name: string, extra: Partial<DeleteImpact> = {}): DeleteImpact => ({
  target: { id, name },
  refusals: [],
  ends: [],
  removes: [],
  ...extra,
});
// The shape `cardReaderDeleteRules` (apps/server/src/card-reader-delete.ts) answers for a paired
// reader: its pairing names the provider by id.
const counterImpact = impactOf("counter", "Counter", {
  ends: [{ key: "provider_pairing", count: 1, targets: [{ id: "acme", name: "acme" }] }],
});
const paying = (impact: DeleteImpact): DeleteImpact => ({
  ...impact,
  refusals: [
    {
      code: "reader.payment_in_progress",
      params: { readerId: impact.target.id },
      targets: [{ id: "d2", name: "Caja 2" }],
    },
  ],
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const coded = (code: string) => Object.assign(new Error(code), { code });

registerCatalogue({ en: { "test.acme": "Acme Pay" }, es: { "test.acme": "Acme Pay" } });

function client(overrides: Partial<DashboardApi> = {}) {
  return Object.assign({
    listPaymentProviders: vi
      .fn()
      .mockResolvedValue([{ providerId: "acme", state: "connected", canUnpair: true }]),
    listReaders: vi.fn().mockResolvedValue(readers),
    listReaderHolders: vi.fn().mockResolvedValue([]),
    readerStatus: vi.fn().mockResolvedValue({ online: false }),
    listStuckPayments: vi.fn().mockResolvedValue([]),
    listStuckBillPayments: vi.fn().mockResolvedValue([]),
    listStuckBillRefunds: vi.fn().mockResolvedValue([]),
    enableReader: vi.fn().mockResolvedValue(undefined),
    renameReader: vi.fn().mockResolvedValue(undefined),
    availableReaders: vi.fn().mockResolvedValue([]),
    getReaderDeleteImpact: vi.fn(async (id: string) =>
      id === "counter" ? counterImpact : impactOf(id, readers.find((r) => r.id === id)!.name),
    ),
    deleteReader: vi.fn(async (id: string) => impactOf(id, "")),
    liveData: new LiveData(),
    ...overrides,
  }) as unknown as DashboardApi;
}

const q = (el: PaymentsScreen, selector: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(selector);
const cell = (el: PaymentsScreen, selector: string) =>
  q(el, "wt-data-table")!.shadowRoot!.querySelector<HTMLElement>(selector);
const dialogOf = (el: PaymentsScreen) =>
  el.shadowRoot!.querySelector<Dialog>("wt-delete-dialog[data-test=delete-reader-dialog]");
const confirmOf = (el: PaymentsScreen) =>
  dialogOf(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-confirm]")!;
const linesOf = (el: PaymentsScreen) =>
  [...dialogOf(el)!.shadowRoot!.querySelectorAll("li")].map((li) => li.textContent!.trim());
const alertOf = (el: PaymentsScreen) => q(el, "p.error[role=alert]")?.textContent?.trim();

async function settleTree(root: ShadowRoot | HTMLElement): Promise<void> {
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if ("updateComplete" in node)
      await (node as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    if (node.shadowRoot) await settleTree(node.shadowRoot);
  }
}
async function flush(el: PaymentsScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await settleTree(el.shadowRoot!);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await el.updateComplete;
}

async function mount(api = client()) {
  const { el } = await mountWidget<PaymentsScreen>("dashboard-payments-screen", {
    api,
    panels: [
      {
        providerId: "acme",
        displayNameKey: "test.acme",
        strings: { en: {}, es: {} },
        renderConnectForm: () => html``,
        renderAddReader: () => html``,
      },
    ],
  });
  await vi.waitFor(() => expect(q(el, "wt-combobox[name=reader-status-filter]")).not.toBeNull());
  await chooseOption(q(el, "wt-combobox[name=reader-status-filter]")!, "all");
  await vi.waitFor(() => expect(cell(el, "[data-test=details-counter]")).not.toBeNull());
  return el;
}

async function openDelete(el: PaymentsScreen, id: string): Promise<void> {
  cell(el, `[data-test=delete-${id}]`)!.click();
  await flush(el);
}

async function cancelDelete(el: PaymentsScreen): Promise<void> {
  const closed = dialogClosed(dialogOf(el)!);
  dialogOf(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-cancel]")!.click();
  await closed;
  await flush(el);
}

function focused(): Element | null {
  let at = document.activeElement;
  while (at?.shadowRoot?.activeElement) at = at.shadowRoot.activeElement;
  return at;
}

function statusFilterFocused(el: PaymentsScreen): boolean {
  const filter = q(el, "wt-combobox[name=reader-status-filter]")!;
  return filter.shadowRoot!.contains(focused());
}

beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/manage/payments/view/readers");
});
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});

describe("Deleting a card reader", () => {
  it("offers Delete last in the row menu of an active, a disabled and an unpaired reader", async () => {
    const el = await mount();
    for (const { id, before } of [
      { id: "counter", before: ["disable-counter"] },
      { id: "terrace", before: ["enable-terrace", "unpair-terrace"] },
      { id: "loose", before: [] },
    ]) {
      const del = cell(el, `[data-test=delete-${id}]`);
      expect(del, `Delete missing for ${id}`).not.toBeNull();
      const tests = [...del!.closest("wt-row-actions")!.querySelectorAll("wt-button")].map(
        (button) => button.getAttribute("data-test"),
      );
      expect(tests.at(-1)).toBe(`delete-${id}`);
      for (const action of before) expect(tests).toContain(action);
      expect(del!.getAttribute("variant")).toBe("danger");
      expect(del!.hasAttribute("disabled")).toBe(false);
    }
    expect(dialogOf(el)?.open ?? false).toBe(false);
  });

  it("the row menu's Delete is quiet and unpressable while another reader action is sent", async () => {
    const enabling = deferred<void>();
    const api = client({ enableReader: vi.fn(() => enabling.promise) });
    const el = await mount(api);
    cell(el, "[data-test=enable-terrace]")!.click();
    await flush(el);
    const del = cell(el, "[data-test=delete-counter]")!;
    expect(del.getAttribute("variant")).toBe("secondary");
    expect(del.hasAttribute("disabled")).toBe(true);
    enabling.resolve();
    await flush(el);
    expect(cell(el, "[data-test=delete-counter]")!.getAttribute("variant")).toBe("danger");
  });

  it("opens with one impact read, Delete quiet until it lands, then danger, and one press sends one delete", async () => {
    const read = deferred<DeleteImpact>();
    const sent = deferred<DeleteImpact>();
    const api = client({
      getReaderDeleteImpact: vi.fn(() => read.promise),
      deleteReader: vi.fn(() => sent.promise),
    });
    const el = await mount(api);
    await openDelete(el, "counter");

    expect(api.getReaderDeleteImpact).toHaveBeenCalledExactlyOnceWith("counter");
    expect(dialogOf(el)!.open).toBe(true);
    expect(dialogOf(el)!.loading).toBe(true);
    expect(confirmOf(el).getAttribute("variant")).toBe("secondary");
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);

    read.resolve(counterImpact);
    await flush(el);
    expect(confirmOf(el).getAttribute("variant")).toBe("danger");
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);

    confirmOf(el).click();
    confirmOf(el).click();
    await flush(el);
    confirmOf(el).click();
    expect(api.deleteReader).toHaveBeenCalledExactlyOnceWith("counter");
    expect(api.getReaderDeleteImpact).toHaveBeenCalledTimes(1);
    sent.resolve(counterImpact);
    await flush(el);
  });

  it("names the provider the pairing ends by its display name, not its id", async () => {
    const el = await mount();
    await openDelete(el, "counter");
    expect(linesOf(el)).toEqual(["Unpairs it from Acme Pay"]);
  });

  const keptImpact = impactOf("counter", "Counter", {
    ends: [
      { key: "provider_registration_kept", count: 1, targets: [{ id: "acme", name: "acme" }] },
    ],
  });

  it("says a reader stays registered at an unconnected provider, by its display name, and Delete accepts that", async () => {
    const api = client({ getReaderDeleteImpact: vi.fn().mockResolvedValue(keptImpact) });
    const el = await mount(api);
    await openDelete(el, "counter");
    expect(linesOf(el)).toEqual([
      "Acme Pay isn't connected, so the reader stays registered at Acme Pay. Remove it there too.",
    ]);
    expect(confirmOf(el).getAttribute("variant")).toBe("danger");
    confirmOf(el).click();
    await flush(el);
    expect(api.deleteReader).toHaveBeenCalledExactlyOnceWith("counter", {
      acceptRegistrationKept: true,
    });
  });

  it("says in Spanish that a reader stays registered at an unconnected provider", async () => {
    setLocale("es");
    const el = await mount(
      client({ getReaderDeleteImpact: vi.fn().mockResolvedValue(keptImpact) }),
    );
    await openDelete(el, "counter");
    expect(linesOf(el)).toEqual([
      "Acme Pay no está conectado, así que el lector sigue registrado en Acme Pay. Elimínalo también allí.",
    ]);
  });

  it("a delete refused because the provider was disconnected after the dialog opened reads the impact again, then accepts the notice it shows", async () => {
    const reread = deferred<DeleteImpact>();
    const getReaderDeleteImpact = vi
      .fn()
      .mockResolvedValueOnce(counterImpact)
      .mockReturnValue(reread.promise);
    const deleteReader = vi
      .fn()
      .mockRejectedValueOnce(coded("reader.provider_disconnected"))
      .mockResolvedValue(keptImpact);
    const el = await mount(client({ getReaderDeleteImpact, deleteReader }));
    await openDelete(el, "counter");
    expect(linesOf(el)).toEqual(["Unpairs it from Acme Pay"]);

    confirmOf(el).click();
    await flush(el);

    expect(deleteReader).toHaveBeenNthCalledWith(1, "counter");
    await vi.waitFor(() => expect(getReaderDeleteImpact).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(dialogOf(el)!.open).toBe(true);
    expect(dialogOf(el)!.loading).toBe(true);
    expect(dialogOf(el)!.actionError).toBe("");
    expect(confirmOf(el).getAttribute("variant")).toBe("secondary");
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);

    reread.resolve(keptImpact);
    await flush(el);
    expect(dialogOf(el)!.open).toBe(true);
    expect(dialogOf(el)!.actionError).toBe("");
    expect(linesOf(el)).toEqual([
      "Acme Pay isn't connected, so the reader stays registered at Acme Pay. Remove it there too.",
    ]);
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);

    confirmOf(el).click();
    await flush(el);
    expect(deleteReader).toHaveBeenNthCalledWith(2, "counter", { acceptRegistrationKept: true });
  });

  it.each(["closed", "reopened on another reader"] as const)(
    "a delete refused as disconnected after its dialog was %s reads no impact again",
    async (after) => {
      const sent = deferred<DeleteImpact>();
      const api = client({
        deleteReader: vi
          .fn()
          .mockReturnValueOnce(sent.promise)
          .mockResolvedValue(impactOf("terrace", "Terrace")),
      });
      const el = await mount(api);
      await openDelete(el, "counter");
      confirmOf(el).click();
      await flush(el);
      vi.mocked(api.listReaders).mockResolvedValue([terrace, unpaired]);
      api.liveData!.invalidate([{ type: "card_readers", id: "counter" }]);
      await vi.waitFor(() => expect(dialogOf(el)?.open ?? false).toBe(false));
      await flush(el);
      if (after === "reopened on another reader") await openDelete(el, "terrace");
      const reads = vi.mocked(api.getReaderDeleteImpact).mock.calls.length;

      sent.reject(coded("reader.provider_disconnected"));
      await flush(el);
      await flush(el);

      expect(api.getReaderDeleteImpact).toHaveBeenCalledTimes(reads);
      if (after === "closed") {
        expect(dialogOf(el)?.open ?? false).toBe(false);
        return;
      }
      expect(dialogOf(el)!.open).toBe(true);
      expect(dialogOf(el)!.impact?.target.id).toBe("terrace");
      expect(dialogOf(el)!.loading).toBe(false);
      expect(dialogOf(el)!.submitting).toBe(false);
      expect(dialogOf(el)!.actionError).toBe("");
    },
  );

  it("a payment in progress is shown and keeps Delete disabled", async () => {
    const el = await mount(
      client({ getReaderDeleteImpact: vi.fn().mockResolvedValue(paying(counterImpact)) }),
    );
    await openDelete(el, "counter");
    expect(linesOf(el)).toContain("Payment in progress on Caja 2");
    expect(confirmOf(el).getAttribute("variant")).toBe("secondary");
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);
  });

  it("a read for an earlier reader never lands on the next one's dialog, and Delete sends the next one's id", async () => {
    const reads = new Map<string, Deferred<DeleteImpact>>();
    const api = client({
      getReaderDeleteImpact: vi.fn((id: string) => {
        const read = deferred<DeleteImpact>();
        reads.set(id, read);
        return read.promise;
      }),
    });
    const el = await mount(api);
    await openDelete(el, "counter");
    await cancelDelete(el);
    await openDelete(el, "terrace");

    reads.get("counter")!.resolve(counterImpact);
    await flush(el);
    expect(dialogOf(el)!.impact).toBeNull();
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);

    reads.get("terrace")!.resolve(impactOf("terrace", "Terrace"));
    await flush(el);
    expect(dialogOf(el)!.impact?.target.id).toBe("terrace");
    confirmOf(el).click();
    await flush(el);
    expect(api.deleteReader).toHaveBeenCalledExactlyOnceWith("terrace");
  });

  it.each(["failure", "success"] as const)(
    "a delete still out when its dialog was closed does not touch the next reader's dialog (late %s)",
    async (outcome) => {
      const sent = deferred<DeleteImpact>();
      const api = client({
        deleteReader: vi
          .fn()
          .mockReturnValueOnce(sent.promise)
          .mockResolvedValue(impactOf("terrace", "Terrace")),
      });
      const el = await mount(api);
      await openDelete(el, "counter");
      confirmOf(el).click();
      await flush(el);
      vi.mocked(api.listReaders).mockResolvedValue([terrace, unpaired]);
      api.liveData!.invalidate([{ type: "card_readers", id: "counter" }]);
      await vi.waitFor(() => expect(dialogOf(el)?.open ?? false).toBe(false));
      await flush(el);
      expect(alertOf(el)).toBeUndefined();

      await openDelete(el, "terrace");
      if (outcome === "failure") sent.reject(coded("server.internal"));
      else sent.resolve(counterImpact);
      await flush(el);
      expect(dialogOf(el)!.open).toBe(true);
      expect(dialogOf(el)!.impact?.target.id).toBe("terrace");
      expect(dialogOf(el)!.actionError).toBe("");
      expect(dialogOf(el)!.submitting).toBe(false);
      expect(dialogOf(el)!.opener).toBe(
        cell(el, "[data-test=delete-terrace]")!
          .closest("wt-row-actions")!
          .shadowRoot!.querySelector("button"),
      );
      confirmOf(el).click();
      await flush(el);
      expect(api.deleteReader).toHaveBeenLastCalledWith("terrace");
    },
  );

  it("an impact re-read answered not-found while the delete is out leaves the outcome to the delete", async () => {
    const sent = deferred<DeleteImpact>();
    const getReaderDeleteImpact = vi.fn().mockResolvedValue(counterImpact);
    const api = client({ getReaderDeleteImpact, deleteReader: vi.fn(() => sent.promise) });
    const el = await mount(api);
    await openDelete(el, "counter");
    confirmOf(el).click();
    await flush(el);
    getReaderDeleteImpact.mockRejectedValue(coded("reader.not_found"));
    api.liveData!.invalidate([{ type: "card_reader_holders", id: "h1" }]);
    await vi.waitFor(() => expect(getReaderDeleteImpact).toHaveBeenCalledTimes(2));
    await flush(el);
    expect(dialogOf(el)!.open).toBe(true);
    expect(dialogOf(el)!.submitting).toBe(true);

    vi.mocked(api.listReaders).mockResolvedValue([terrace, unpaired]);
    sent.resolve(counterImpact);
    await expect.poll(() => dialogOf(el)!.open).toBe(false);
    await flush(el);
    expect(cell(el, "[data-test=delete-counter]")).toBeNull();
    expect(alertOf(el)).toBeUndefined();
  });

  it("Retry is ignored while the delete is out", async () => {
    const sent = deferred<DeleteImpact>();
    const getReaderDeleteImpact = vi.fn().mockResolvedValue(counterImpact);
    const api = client({ getReaderDeleteImpact, deleteReader: vi.fn(() => sent.promise) });
    const el = await mount(api);
    await openDelete(el, "counter");
    confirmOf(el).click();
    await flush(el);
    getReaderDeleteImpact.mockRejectedValue(coded("connection.failed"));
    api.liveData!.invalidate([{ type: "card_reader_holders", id: "h1" }]);
    await vi.waitFor(() => expect(dialogOf(el)!.readError).toBe(codeMessage("connection.failed")));
    await flush(el);
    const reads = getReaderDeleteImpact.mock.calls.length;
    dialogOf(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-retry]")!.click();
    await flush(el);
    expect(getReaderDeleteImpact).toHaveBeenCalledTimes(reads);
    expect(dialogOf(el)!.readError).toBe(codeMessage("connection.failed"));
    sent.resolve(counterImpact);
    await flush(el);
  });

  it("a live re-read that now finds a payment in progress disables Delete in the open dialog", async () => {
    const getReaderDeleteImpact = vi.fn().mockResolvedValue(counterImpact);
    const api = client({ getReaderDeleteImpact });
    const el = await mount(api);
    await openDelete(el, "counter");
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);

    getReaderDeleteImpact.mockResolvedValue(paying(counterImpact));
    api.liveData!.invalidate([{ type: "payments", id: "pay-1" }]);
    await vi.waitFor(() => expect(dialogOf(el)!.impact?.refusals).toHaveLength(1));
    await flush(el);
    expect(linesOf(el)).toContain("Payment in progress on Caja 2");
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);
  });

  it("an unpair the provider refused keeps the dialog with its message and Delete usable, and the list shows the reader disabled", async () => {
    const deleteReader = vi.fn().mockRejectedValueOnce(coded("reader.unpair_failed"));
    const api = client({ deleteReader });
    const el = await mount(api);
    await openDelete(el, "counter");
    vi.mocked(api.listReaders).mockResolvedValue([{ ...counter, active: false }, terrace]);
    confirmOf(el).click();
    await flush(el);

    expect(dialogOf(el)!.open).toBe(true);
    expect(dialogOf(el)!.actionError).toBe(
      "The provider did not confirm the unpairing. The reader is disabled; try again.",
    );
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
    // The delete's first transaction switched the reader off before calling the provider
    // (`startCardReaderDelete`, apps/server/src/card-reader-delete.ts); the change feed reports it.
    api.liveData!.invalidate([{ type: "card_readers", id: "counter" }]);
    await vi.waitFor(() =>
      expect(cell(el, "[data-test=reader-status-counter]")?.textContent).toBe("Disabled"),
    );
    await flush(el);
    expect(dialogOf(el)!.open).toBe(true);
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
    confirmOf(el).click();
    await flush(el);
    expect(deleteReader).toHaveBeenCalledTimes(2);
  });

  it("a delete answered not-found closes the dialog, drops the row and says the reader no longer exists", async () => {
    const api = client({ deleteReader: vi.fn().mockRejectedValue(coded("reader.not_found")) });
    const el = await mount(api);
    await openDelete(el, "counter");
    vi.mocked(api.listReaders).mockResolvedValue([terrace, unpaired]);
    confirmOf(el).click();
    await flush(el);
    expect(dialogOf(el)?.open ?? false).toBe(false);
    expect(cell(el, "[data-test=delete-counter]")).toBeNull();
    expect(alertOf(el)).toBe(codeMessage("reader.not_found"));
  });

  it("an impact read answered not-found closes the dialog, drops the row and says so", async () => {
    const api = client({
      getReaderDeleteImpact: vi.fn().mockRejectedValue(coded("reader.not_found")),
    });
    const el = await mount(api);
    await openDelete(el, "counter");
    expect(dialogOf(el)?.open ?? false).toBe(false);
    expect(cell(el, "[data-test=delete-counter]")).toBeNull();
    expect(alertOf(el)).toBe(codeMessage("reader.not_found"));
    expect(api.deleteReader).not.toHaveBeenCalled();
  });

  it("a failed impact read offers Retry, which reads again and clears it", async () => {
    const getReaderDeleteImpact = vi
      .fn()
      .mockRejectedValueOnce(coded("connection.failed"))
      .mockResolvedValueOnce(counterImpact);
    const el = await mount(client({ getReaderDeleteImpact }));
    await openDelete(el, "counter");
    expect(dialogOf(el)!.readError).toBe(codeMessage("connection.failed"));
    expect(confirmOf(el).hasAttribute("disabled")).toBe(true);
    dialogOf(el)!.shadowRoot!.querySelector<HTMLElement>("[data-test=delete-retry]")!.click();
    await flush(el);
    expect(getReaderDeleteImpact).toHaveBeenCalledTimes(2);
    expect(dialogOf(el)!.readError).toBe("");
    expect(confirmOf(el).hasAttribute("disabled")).toBe(false);
  });

  it("a delete that succeeds closes the dialog and the row, and focus lands on the Status filter", async () => {
    const api = client();
    const el = await mount(api);
    const reads = vi.mocked(api.listReaders).mock.calls.length;
    await openDelete(el, "counter");
    vi.mocked(api.listReaders).mockResolvedValue([terrace, unpaired]);
    // A close the screen asks for sends no `wt-close` (`close`, packages/ui/src/components/wt-delete-dialog.ts).
    confirmOf(el).click();
    await expect.poll(() => dialogOf(el)!.open).toBe(false);
    await flush(el);

    expect(cell(el, "[data-test=delete-counter]")).toBeNull();
    expect(api.listReaders).toHaveBeenCalledTimes(reads + 1);
    await expect.poll(() => statusFilterFocused(el)).toBe(true);
  });

  it.each(["the delete", "the impact read"] as const)(
    "when %s answers not-found, the row menu is gone and focus lands on the Status filter",
    async (which) => {
      const read = deferred<DeleteImpact>();
      const api =
        which === "the delete"
          ? client({ deleteReader: vi.fn().mockRejectedValue(coded("reader.not_found")) })
          : client({ getReaderDeleteImpact: vi.fn(() => read.promise) });
      const el = await mount(api);
      vi.mocked(api.listReaders).mockResolvedValue([terrace, unpaired]);
      await openDelete(el, "counter");
      expect(focused()).toBe(
        dialogOf(el)!
          .shadowRoot!.querySelector("[data-test=delete-cancel]")!
          .shadowRoot!.querySelector("button"),
      );
      if (which === "the delete") confirmOf(el).click();
      else read.reject(coded("reader.not_found"));
      await expect.poll(() => dialogOf(el)!.open).toBe(false);
      await flush(el);
      expect(cell(el, "[data-test=delete-counter]")).toBeNull();
      await expect.poll(() => statusFilterFocused(el)).toBe(true);
    },
  );

  it("an active reader dropped by a live re-read while its dialog is open leaves focus on the Status filter", async () => {
    const api = client();
    const el = await mount(api);
    await openDelete(el, "counter");
    vi.mocked(api.listReaders).mockResolvedValue([terrace, unpaired]);
    api.liveData!.invalidate([{ type: "card_readers", id: "counter" }]);
    await expect.poll(() => dialogOf(el)!.open).toBe(false);
    await flush(el);
    await expect.poll(() => statusFilterFocused(el)).toBe(true);
  });

  it("a delete answered not-found while the first status reads are out leaves focus on the Status filter after they answer", async () => {
    const statuses = deferred<{ online: boolean }>();
    const api = client({
      readerStatus: vi.fn(() => statuses.promise),
      deleteReader: vi.fn().mockRejectedValue(coded("reader.not_found")),
    });
    const el = await mount(api);
    vi.mocked(api.listReaders).mockResolvedValue([terrace, unpaired]);
    await openDelete(el, "counter");
    confirmOf(el).click();
    await expect.poll(() => dialogOf(el)!.open).toBe(false);
    await flush(el);
    await expect.poll(() => statusFilterFocused(el)).toBe(true);
    statuses.resolve({ online: true });
    await flush(el);
    expect(statusFilterFocused(el)).toBe(true);
  });

  it("a delete whose list re-read leaves another active reader still being asked leaves focus on the Status filter", async () => {
    const api = client();
    const el = await mount(api);
    const other: ReaderRow = { ...counter, id: "other", name: "Other" };
    const statuses = deferred<{ online: boolean }>();
    vi.mocked(api.readerStatus).mockImplementation(() => statuses.promise);
    vi.mocked(api.listReaders).mockResolvedValue([other, terrace, unpaired]);
    await openDelete(el, "counter");
    confirmOf(el).click();
    await expect.poll(() => dialogOf(el)!.open).toBe(false);
    await flush(el);
    const refresh = q(el, "[data-test=refresh-readers]")!;
    expect(refresh.hasAttribute("disabled")).toBe(true);
    await expect.poll(() => statusFilterFocused(el)).toBe(true);
    statuses.resolve({ online: true });
    await expect.poll(() => refresh.hasAttribute("disabled")).toBe(false);
    expect(statusFilterFocused(el)).toBe(true);
  });

  it("a successful delete whose list re-read answers after the dialog closed leaves focus on the Status filter", async () => {
    const api = client();
    const el = await mount(api);
    const other: ReaderRow = { ...counter, id: "other", name: "Other" };
    const reread = deferred<ReaderRow[]>();
    vi.mocked(api.listReaders).mockReturnValue(reread.promise);
    await openDelete(el, "counter");
    confirmOf(el).click();
    await expect.poll(() => dialogOf(el)!.open).toBe(false);
    await flush(el);
    reread.resolve([other, terrace, unpaired]);
    await vi.waitFor(() => expect(cell(el, "[data-test=details-other]")).not.toBeNull());
    await expect
      .poll(() => q(el, "[data-test=refresh-readers]")!.hasAttribute("disabled"))
      .toBe(false);
    await flush(el);
    expect(statusFilterFocused(el), String(focused()?.outerHTML.slice(0, 60))).toBe(true);
  });

  it("a not-found delete whose list re-read answers after the first status reads leaves focus on the Status filter", async () => {
    const statuses = deferred<{ online: boolean }>();
    const reread = deferred<ReaderRow[]>();
    const other: ReaderRow = { ...counter, id: "other", name: "Other" };
    const api = client({
      readerStatus: vi.fn(() => statuses.promise),
      deleteReader: vi.fn().mockRejectedValue(coded("reader.not_found")),
    });
    const el = await mount(api);
    vi.mocked(api.listReaders).mockReturnValue(reread.promise);
    await openDelete(el, "counter");
    confirmOf(el).click();
    await expect.poll(() => dialogOf(el)!.open).toBe(false);
    await flush(el);
    statuses.resolve({ online: true });
    await flush(el);
    await flush(el);
    vi.mocked(api.readerStatus).mockResolvedValue({ online: true });
    reread.resolve([other, terrace, unpaired]);
    await vi.waitFor(() => expect(cell(el, "[data-test=details-other]")).not.toBeNull());
    await expect
      .poll(() => q(el, "[data-test=refresh-readers]")!.hasAttribute("disabled"))
      .toBe(false);
    await flush(el);
    expect(statusFilterFocused(el), String(focused()?.outerHTML.slice(0, 60))).toBe(true);
  });

  it("a reload that fails after the delete shows the failed read and offers no second Delete", async () => {
    const api = client();
    const el = await mount(api);
    await openDelete(el, "counter");
    vi.mocked(api.listReaders).mockRejectedValue(coded("connection.failed"));
    confirmOf(el).click();
    await flush(el);

    expect(dialogOf(el)?.open ?? false).toBe(false);
    await vi.waitFor(() => expect(alertOf(el)).toBe(codeMessage("connection.failed")));
    expect(cell(el, "[data-test=delete-counter]")).toBeNull();
    expect(api.deleteReader).toHaveBeenCalledTimes(1);
  });

  it("a reader deleted in another tab closes its open editor and label without asking", async () => {
    const api = client();
    const el = await mount(api);
    cell(el, "[data-test=edit-counter]")!.click();
    await flush(el);
    q(el, "[data-test=edit-reader-name]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Garden" } }),
    );
    await flush(el);
    vi.mocked(api.listReaders).mockResolvedValue([terrace, unpaired]);
    api.liveData!.invalidate([{ type: "card_readers", id: "counter" }]);
    await vi.waitFor(() => expect(q(el, "[data-test=reader-editor]")).toBeNull());
    expect(alertOf(el)).toBe(codeMessage("reader.not_found"));
    expect(api.renameReader).not.toHaveBeenCalled();

    vi.mocked(api.listReaders).mockResolvedValue([terrace, unpaired]);
    cell(el, "[data-test=label-terrace]")!.click();
    await flush(el);
    expect(q(el, "dashboard-equipment-label")).not.toBeNull();
    vi.mocked(api.listReaders).mockResolvedValue([unpaired]);
    api.liveData!.invalidate([{ type: "card_readers", id: "terrace" }]);
    await vi.waitFor(() => expect(q(el, "dashboard-equipment-label")).toBeNull());
  });

  it("discovery offers an available reader with Add, not Enable", async () => {
    const api = client({
      availableReaders: vi
        .fn()
        .mockResolvedValue([{ providerRef: "v-1", name: "Counter", status: "available" }]),
    });
    const el = await mount(api);
    const tabs = q(el, "wt-tabs")!;
    tabs.shadowRoot!.querySelector<HTMLElement>("[data-key=providers]")!.click();
    await flush(el);
    q(el, "[data-test=add-reader-acme]")!.click();
    await flush(el);
    expect(q(el, "[data-test=adopt-v-1]")!.textContent!.trim()).toBe("Add");
  });
});
