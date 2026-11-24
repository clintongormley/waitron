import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
import "./servers-screen.js";
import type { ServersScreen } from "./servers-screen.js";
import type { DashboardApi, ServerListing, ServerRow } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { en, es } from "../i18n/strings.js";
import { codeMessage } from "../i18n/codes.js";

const SELF = "11111111-1111-4111-8111-111111111111";
const OLD = "33333333-3333-4333-8333-333333333333";

const row = (overrides: Partial<ServerRow>): ServerRow => ({
  nodeId: OLD,
  contactUrl: "https://old.venue.example",
  standing: "sell-only",
  isSelf: false,
  removable: false,
  canClear: false,
  requiresRetirementConfirmation: false,
  returnOutstanding: false,
  needsResetStatement: false,
  reset: null,
  canReset: false,
  canWipeWithLoss: false,
  returnScenario: null,
  recoveredRecordsBackup: null,
  ...overrides,
});

const listingWith = (old: Partial<ServerRow>): ServerListing => ({
  term: 5,
  nodes: [
    row({
      nodeId: SELF,
      contactUrl: "https://new.venue.example",
      standing: "serving-primary",
      isSelf: true,
    }),
    row(old),
  ],
});

const waiting = listingWith({ returnOutstanding: true });
const unreturned = listingWith({ removable: true, needsResetStatement: true });
const returned = listingWith({ removable: true });

function stubApi(listing: ServerListing, overrides: Record<string, unknown> = {}): DashboardApi {
  return {
    listServers: vi.fn().mockResolvedValue(listing),
    removeServer: vi.fn().mockResolvedValue({ removed: true, term: 6 }),
    abandonServerReturn: vi
      .fn()
      .mockResolvedValue({ operationId: "op", state: "return_abandoned" }),
    orderServerReset: vi.fn().mockResolvedValue({ orderId: "order", acceptLoss: false }),
    ...overrides,
  } as unknown as DashboardApi;
}

async function flush(el: ServersScreen): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await el.shadowRoot!.querySelector("wt-data-table")?.updateComplete;
}

async function mount(api: DashboardApi): Promise<ServersScreen> {
  const { el } = await mountWidget<ServersScreen>("dashboard-servers-screen", { api });
  await flush(el);
  return el;
}

const table = (el: ServersScreen) => el.shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
const menu = (el: ServersScreen) =>
  table(el).querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
    `tr[data-row-key="${OLD}"] wt-row-actions`,
  );
const dialog = (el: ServersScreen, action: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-dialog"]>(
    `wt-dialog[data-test=${action}-dialog]`,
  )!;
const confirmButton = (el: ServersScreen, action: string) =>
  dialog(el, action).querySelector<HTMLElementTagNameMap["wt-button"]>(
    `wt-button[data-test=confirm-${action}]`,
  )!;
const toggle = (el: ServersScreen, action: string, name: string) =>
  dialog(el, action).querySelector<HTMLElementTagNameMap["wt-switch"]>(
    `wt-switch[data-test=${name}]`,
  );

async function openAction(el: ServersScreen, action: string): Promise<void> {
  menu(el)!.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  menu(el)!.querySelector<HTMLElement>(`[data-test="${action}-${OLD}"]`)!.click();
  await flush(el);
  expect(dialog(el, action).open).toBe(true);
}

async function tick(el: ServersScreen, action: string, name: string): Promise<void> {
  toggle(el, action, name)!.shadowRoot!.querySelector("input")!.click();
  await flush(el);
}

async function confirm(el: ServersScreen, action: string): Promise<void> {
  confirmButton(el, action).click();
  await flush(el);
  await flush(el);
}

const messageIn = async (el: ServersScreen, action: string) =>
  (await formMessageOf(dialog(el, action).querySelector("wt-form-actions")!))?.textContent ?? null;

beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

describe("a former main box the last handover waits for", () => {
  it("says on its row that the handover waits for its records, and offers Will not return there only", async () => {
    const el = await mount(stubApi(waiting));
    expect(table(el).querySelector(`[data-test="return-${OLD}"]`)?.textContent?.trim()).toBe(
      en["servers.return_waiting"],
    );
    expect(table(el).querySelector(`[data-test="return-${OLD}"]`)?.textContent?.trim()).toBe(
      "Waiting for the old main box to return its invoice records and working hours",
    );
    expect(menu(el)!.querySelector(`[data-test="abandon-${OLD}"]`)?.textContent?.trim()).toBe(
      "Will not return",
    );
    cleanupWidgets();
    const other = await mount(stubApi(returned));
    expect(table(other).querySelector(`[data-test="return-${OLD}"]`)).toBeNull();
    expect(menu(other)!.querySelector(`[data-test="abandon-${OLD}"]`)).toBeNull();
  });

  it("warns what Will not return loses, and keeps it quiet and disabled until the confirmation is ticked", async () => {
    const api = stubApi(waiting);
    const el = await mount(api);
    await openAction(el, "abandon");
    expect(dialog(el, "abandon").heading).toBe(en["servers.abandon_title"]);
    expect(
      dialog(el, "abandon").querySelector("[data-test=abandon-address]")?.textContent?.trim(),
    ).toBe("https://old.venue.example");
    expect(
      dialog(el, "abandon").querySelector("[data-test=abandon-warning]")?.textContent?.trim(),
    ).toBe(en["servers.abandon_explanation"]);
    expect(toggle(el, "abandon", "abandon-confirm")!.label).toBe(
      `${en["servers.abandon_confirm"]} *`,
    );
    expect(confirmButton(el, "abandon").disabled).toBe(true);
    expect(confirmButton(el, "abandon").variant).toBe("secondary");
    await tick(el, "abandon", "abandon-confirm");
    expect(confirmButton(el, "abandon").disabled).toBe(false);
    expect(confirmButton(el, "abandon").variant).toBe("danger");
    vi.mocked(api.listServers).mockResolvedValue(unreturned);
    await confirm(el, "abandon");
    expect(api.abandonServerReturn).toHaveBeenCalledExactlyOnceWith(OLD);
    expect(dialog(el, "abandon").open).toBe(false);
    expect(table(el).querySelector(`[data-test="return-${OLD}"]`)).toBeNull();
  });

  it("keeps the dialog open with the refusal as its one message", async () => {
    const api = stubApi(waiting, {
      abandonServerReturn: vi
        .fn()
        .mockRejectedValue({ code: "handover.return_not_outstanding", status: 409 }),
    });
    const el = await mount(api);
    await openAction(el, "abandon");
    await tick(el, "abandon", "abandon-confirm");
    await confirm(el, "abandon");
    expect(dialog(el, "abandon").open).toBe(true);
    expect(await messageIn(el, "abandon")).toBe(codeMessage("handover.return_not_outstanding"));
  });

  it("Cancel forgets the tick and sends nothing", async () => {
    const api = stubApi(waiting);
    const el = await mount(api);
    await openAction(el, "abandon");
    await tick(el, "abandon", "abandon-confirm");
    dialog(el, "abandon").querySelector<HTMLElement>("[data-test=cancel-abandon]")!.click();
    await flush(el);
    await openAction(el, "abandon");
    expect(toggle(el, "abandon", "abandon-confirm")!.checked).toBe(false);
    expect(confirmButton(el, "abandon").disabled).toBe(true);
    expect(api.abandonServerReturn).not.toHaveBeenCalled();
  });

  it("names the button as the refusal does, and the refusal says what it does, in both languages", () => {
    expect(en["servers.abandon"]).toBe("Will not return");
    expect(es["servers.abandon"]).not.toBe(en["servers.abandon"]);
    for (const [language, words] of [
      ["en", en],
      ["es", es],
    ] as const) {
      expect(codeMessage("handover.return_outstanding", language)).toContain(
        `${words["servers.abandon"]} ${language === "en" ? "stops the wait" : "deja de esperar"}`,
      );
    }
  });
});

describe("removing a former main box", () => {
  it("asks for the reset statement after a warning, and sends it once ticked", async () => {
    const api = stubApi(unreturned);
    const el = await mount(api);
    await openAction(el, "remove");
    expect(dialog(el, "remove").heading).toBe(en["servers.remove_former_title"]);
    expect(
      dialog(el, "remove").querySelector("[data-test=reset-warning]")?.textContent?.trim(),
    ).toBe(en["servers.reset_warning"]);
    expect(toggle(el, "remove", "reset-statement")!.label).toBe(
      `${en["servers.reset_statement"]} *`,
    );
    expect(toggle(el, "remove", "declare-switched-off")).toBeNull();
    expect(confirmButton(el, "remove").disabled).toBe(true);
    await tick(el, "remove", "reset-statement");
    expect(confirmButton(el, "remove").disabled).toBe(false);
    await confirm(el, "remove");
    expect(api.removeServer).toHaveBeenCalledExactlyOnceWith(OLD, { resetStatement: true });
    expect(dialog(el, "remove").open).toBe(false);
  });

  it("removes one whose records came back with no statement", async () => {
    const api = stubApi(returned);
    const el = await mount(api);
    await openAction(el, "remove");
    expect(dialog(el, "remove").heading).toBe(en["servers.remove_former_title"]);
    expect(toggle(el, "remove", "reset-statement")).toBeNull();
    await confirm(el, "remove");
    expect(api.removeServer).toHaveBeenCalledExactlyOnceWith(OLD);
  });

  it("asks for the statement when the list was read before the server needed it", async () => {
    const api = stubApi(returned, {
      removeServer: vi
        .fn()
        .mockRejectedValueOnce({ code: "membership.reset_statement_required", status: 409 })
        .mockResolvedValueOnce({ removed: true, term: 6 }),
    });
    const el = await mount(api);
    await openAction(el, "remove");
    await confirm(el, "remove");
    expect(await messageIn(el, "remove")).toBe(codeMessage("membership.reset_statement_required"));
    expect(toggle(el, "remove", "reset-statement")!.checked).toBe(false);
    expect(confirmButton(el, "remove").disabled).toBe(true);
    await tick(el, "remove", "reset-statement");
    await confirm(el, "remove");
    expect(vi.mocked(api.removeServer).mock.calls).toEqual([
      [OLD],
      [OLD, { resetStatement: true }],
    ]);
    expect(dialog(el, "remove").open).toBe(false);
  });
});

describe("Wipe and remove", () => {
  const resettable = listingWith({ removable: true, canReset: true, returnScenario: "controlled" });
  const afterEmergency = listingWith({
    removable: true,
    canReset: true,
    returnScenario: "emergency",
  });
  const lineIn = (el: ServersScreen, test: string) =>
    dialog(el, "reset")
      .querySelector(`[data-test=${test}]`)
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ?? null;

  it("is offered in the row menu only when the server says a wipe can be ordered", async () => {
    const el = await mount(stubApi(resettable));
    expect(menu(el)!.querySelector(`[data-test="reset-${OLD}"]`)?.textContent?.trim()).toBe(
      "Wipe and remove",
    );
    expect(menu(el)!.querySelector(`[data-test="remove-${OLD}"]`)?.textContent?.trim()).toBe(
      "Remove from venue",
    );
    cleanupWidgets();
    const other = await mount(stubApi(returned));
    expect(menu(other)!.querySelector(`[data-test="reset-${OLD}"]`)).toBeNull();
  });

  it("is not offered while the return is awaited unless the server says a wipe accepting the loss can be ordered", async () => {
    const el = await mount(stubApi(waiting));
    expect(menu(el)!.querySelector(`[data-test="abandon-${OLD}"]`)).not.toBeNull();
    expect(menu(el)!.querySelector(`[data-test="reset-${OLD}"]`)).toBeNull();
  });

  it("says wiping removes the box and it can come back as a spare, with the download line after a planned handover", async () => {
    const el = await mount(stubApi(resettable));
    await openAction(el, "reset");
    expect(dialog(el, "reset").heading).toBe("Wipe the old main box and remove it?");
    expect(lineIn(el, "reset-address")).toBe("https://old.venue.example");
    expect(lineIn(el, "reset-warning")).toBe(
      "Wiping this box removes it from the venue, after which you can re-add it as a spare.",
    );
    expect(lineIn(el, "reset-download")).toBe(
      "The old main box may hold data that this box does not have. You should download that data from https://old.venue.example before wiping and reusing it.",
    );
    expect(dialog(el, "reset").textContent).not.toMatch(/Machine|will be lost/);
  });

  it("after an emergency switch, says to download the old box's data first, linking to its address in a new tab", async () => {
    const el = await mount(stubApi(afterEmergency));
    await openAction(el, "reset");
    expect(lineIn(el, "reset-download")).toBe(
      "The old main box may hold data that this box does not have. You should download that data from https://old.venue.example before wiping and reusing it.",
    );
    const link = dialog(el, "reset").querySelector<HTMLAnchorElement>(
      "[data-test=reset-download] a",
    )!;
    expect(link.getAttribute("href")).toBe("https://old.venue.example");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
  });

  it("with no address for the old box, sends the person to its own page instead of naming an address", async () => {
    const el = await mount(
      stubApi(
        listingWith({
          removable: true,
          canReset: true,
          returnScenario: "emergency",
          contactUrl: "",
        }),
      ),
    );
    await openAction(el, "reset");
    const line = lineIn(el, "reset-download");
    expect(line).toBe(
      "The old main box may hold data that this box does not have. You should download that data from the old main box's own page before wiping and reusing it.",
    );
    expect(line).not.toContain("No address");
    expect(dialog(el, "reset").querySelector("[data-test=reset-download] a")).toBeNull();
  });

  it("names an address that is not a web address as plain text", async () => {
    const el = await mount(
      stubApi(
        listingWith({
          removable: true,
          canReset: true,
          returnScenario: "emergency",
          contactUrl: "old.venue.example:8443",
        }),
      ),
    );
    await openAction(el, "reset");
    expect(lineIn(el, "reset-download")).toBe(
      "The old main box may hold data that this box does not have. You should download that data from old.venue.example:8443 before wiping and reusing it.",
    );
    expect(dialog(el, "reset").querySelector("[data-test=reset-download] a")).toBeNull();
  });

  it("does not put the download line in the Remove dialog", async () => {
    const el = await mount(stubApi(resettable));
    await openAction(el, "remove");
    expect(dialog(el, "remove").querySelector("[data-test=reset-download]")).toBeNull();
  });

  it.each([
    ["a planned handover", "controlled"],
    ["an emergency switch", "emergency"],
    ["no recorded handover", null],
  ] as const)(
    "after %s, says the old box may hold data and to download it first",
    async (_, returnScenario) => {
      const el = await mount(
        stubApi(listingWith({ removable: true, canReset: true, returnScenario })),
      );
      await openAction(el, "reset");
      expect(lineIn(el, "reset-download")).toBe(
        "The old main box may hold data that this box does not have. You should download that data from https://old.venue.example before wiping and reusing it.",
      );
    },
  );

  it.each([
    [
      "awaiting-backup",
      "CAUTION: The records recovered from the old main box will exist only on the new main box until the next backup is made.",
    ],
    [
      "no-backups",
      "CAUTION: Backups are not set up, so the records recovered from the old main box will exist only on the new main box.",
    ],
    ["backed-up", null],
    [null, null],
  ] as const)("with recovered records %s, the CAUTION line reads %s", async (state, words) => {
    const el = await mount(
      stubApi(
        listingWith({
          removable: true,
          canReset: true,
          returnScenario: "controlled",
          recoveredRecordsBackup: state,
        }),
      ),
    );
    await openAction(el, "reset");
    expect(lineIn(el, "reset-caution")).toBe(words);
    if (words !== null) {
      expect(
        dialog(el, "reset").querySelector("[data-test=reset-caution] strong")?.textContent,
      ).toBe("CAUTION:");
    }
  });

  it("shows every line in Spanish", async () => {
    setLocale("es-ES");
    const el = await mount(
      stubApi(
        listingWith({
          removable: true,
          canReset: true,
          returnScenario: "emergency",
          recoveredRecordsBackup: "no-backups",
        }),
      ),
    );
    await openAction(el, "reset");
    expect(dialog(el, "reset").heading).toBe(es["servers.reset_spare_title"]);
    expect(lineIn(el, "reset-warning")).toBe(es["servers.reset_spare_explanation"]);
    expect(lineIn(el, "reset-download")).toBe(
      es["servers.reset_download"].replace("{address}", "https://old.venue.example"),
    );
    expect(lineIn(el, "reset-caution")).toBe(
      `${es["servers.reset_caution_label"]} ${es["servers.reset_caution_no_backups"]}`,
    );
    expect(confirmButton(el, "reset").textContent?.trim()).toBe("Borrar y retirar");
  });

  it("orders the reset with no tick to give, then closes and reads the list again", async () => {
    const api = stubApi(resettable);
    const el = await mount(api);
    await openAction(el, "reset");
    expect(confirmButton(el, "reset").disabled).toBe(false);
    expect(confirmButton(el, "reset").variant).toBe("danger");
    expect(confirmButton(el, "reset").textContent?.trim()).toBe(en["servers.reset_spare"]);
    const reads = vi.mocked(api.listServers).mock.calls.length;
    await confirm(el, "reset");
    expect(api.orderServerReset).toHaveBeenCalledExactlyOnceWith(OLD);
    expect(dialog(el, "reset").open).toBe(false);
    expect(vi.mocked(api.listServers).mock.calls.length).toBeGreaterThan(reads);
  });

  it("keeps the dialog open with the refusal as its one message", async () => {
    const api = stubApi(resettable, {
      orderServerReset: vi
        .fn()
        .mockRejectedValue({ code: "handover.reset_loss_unaccepted", status: 409 }),
    });
    const el = await mount(api);
    await openAction(el, "reset");
    await confirm(el, "reset");
    expect(dialog(el, "reset").open).toBe(true);
    expect(await messageIn(el, "reset")).toBe(codeMessage("handover.reset_loss_unaccepted"));
  });

  it("words each refusal the press can meet in both languages, naming no one to contact", () => {
    for (const code of ["handover.reset_loss_unaccepted", "membership.node_not_replaced"]) {
      for (const language of ["en", "es"] as const) {
        const words = codeMessage(code, language);
        expect(words).not.toBe(codeMessage("no.such_code", language));
        if (language === "en") expect(words).not.toMatch(/support|contact/i);
      }
    }
  });

  it("says wipe, never reset, in every refusal this flow can show, in both languages", () => {
    for (const code of [
      "handover.reset_loss_unaccepted",
      "handover.reset_not_previous_main",
      "membership.node_not_replaced",
      "membership.reset_statement_required",
    ]) {
      expect(codeMessage(code, "en")).not.toMatch(/reset/i);
      expect(codeMessage(code, "en")).toMatch(/wipe/i);
      expect(codeMessage(code, "es")).not.toMatch(/restablec/i);
      expect(codeMessage(code, "es")).toMatch(/borr/i);
    }
    expect(codeMessage("handover.reset_loss_unaccepted", "en")).toContain(
      "then choose Wipe and remove again.",
    );
  });
});

describe("Download the old main box's data", () => {
  const resettable = listingWith({ removable: true, canReset: true, returnScenario: "emergency" });
  const downloadButton = (el: ServersScreen) =>
    dialog(el, "reset").querySelector<HTMLElementTagNameMap["wt-button"]>(
      "wt-button[data-test=reset-download-button]",
    );
  const cancelButton = (el: ServersScreen) =>
    dialog(el, "reset").querySelector<HTMLElementTagNameMap["wt-button"]>(
      "wt-button[data-test=cancel-reset]",
    )!;
  const file = {
    blob: new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]),
    fileName: "waitron-old-main-box-2026-11-20.xlsx",
  };

  function spyOnSaving() {
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:old-box-data";
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const links: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      links.push(this);
    });
    return { blobs, revoke, links };
  }

  afterEach(() => vi.restoreAllMocks());

  it("sits under the download line, which keeps its words and link", async () => {
    const el = await mount(stubApi(resettable));
    await openAction(el, "reset");
    const line = dialog(el, "reset").querySelector<HTMLElement>("[data-test=reset-download]")!;
    expect(line.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "The old main box may hold data that this box does not have. You should download that data from https://old.venue.example before wiping and reusing it.",
    );
    expect(line.querySelector("a")?.getAttribute("href")).toBe("https://old.venue.example");
    const button = downloadButton(el)!;
    expect(button.textContent?.trim()).toBe("Download the old main box's data");
    expect(button.variant).toBe("secondary");
    expect(line.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.contains(button)).toBe(false);
    expect(menu(el)!.querySelector("[data-test=reset-download-button]")).toBeNull();
  });

  it("says it in Spanish", async () => {
    setLocale("es-ES");
    const el = await mount(stubApi(resettable));
    await openAction(el, "reset");
    expect(downloadButton(el)!.textContent?.trim()).toBe(
      "Descargar los datos del servidor principal anterior",
    );
  });

  it("is not offered with no address for the old box", async () => {
    const el = await mount(
      stubApi(listingWith({ removable: true, canReset: true, contactUrl: "" })),
    );
    await openAction(el, "reset");
    expect(dialog(el, "reset").querySelector("[data-test=reset-download]")).not.toBeNull();
    expect(downloadButton(el)).toBeNull();
  });

  it("is not offered once a wipe is ordered", async () => {
    const el = await mount(
      stubApi(listingWith({ removable: true, canReset: true, reset: "ordered" })),
    );
    await openAction(el, "reset");
    expect(downloadButton(el)).toBeNull();
  });

  it("asks once on a double press, holds the dialog's other buttons while it runs, then saves the file under the server's name", async () => {
    const saving = spyOnSaving();
    let answer!: (value: typeof file) => void;
    const downloadOldBoxData = vi.fn(
      () => new Promise<typeof file>((resolve) => (answer = resolve)),
    );
    const el = await mount(stubApi(resettable, { downloadOldBoxData }));
    await openAction(el, "reset");
    downloadButton(el)!.click();
    downloadButton(el)!.click();
    await flush(el);
    expect(downloadOldBoxData).toHaveBeenCalledExactlyOnceWith(OLD);
    expect(downloadButton(el)!.loading).toBe(true);
    expect(cancelButton(el).disabled).toBe(true);
    expect(confirmButton(el, "reset").disabled).toBe(true);
    expect(confirmButton(el, "reset").variant).toBe("secondary");
    expect(dialog(el, "reset").dismissible).toBe(false);
    answer(file);
    await flush(el);
    await flush(el);
    expect(saving.blobs).toEqual([file.blob]);
    expect(saving.links.map((link) => link.download)).toEqual([file.fileName]);
    expect(saving.revoke).toHaveBeenCalledWith("blob:old-box-data");
    expect(downloadButton(el)!.loading).toBe(false);
    expect(cancelButton(el).disabled).toBe(false);
    expect(confirmButton(el, "reset").disabled).toBe(false);
    expect(confirmButton(el, "reset").variant).toBe("danger");
    expect(dialog(el, "reset").open).toBe(true);
  });

  it("does not order the wipe when Wipe and remove is pressed while the download runs", async () => {
    spyOnSaving();
    let answer!: (value: typeof file) => void;
    const api = stubApi(resettable, {
      downloadOldBoxData: vi.fn(() => new Promise<typeof file>((resolve) => (answer = resolve))),
    });
    const el = await mount(api);
    await openAction(el, "reset");
    downloadButton(el)!.click();
    await flush(el);
    confirmButton(el, "reset").click();
    await flush(el);
    expect(api.orderServerReset).not.toHaveBeenCalled();
    answer(file);
    await flush(el);
  });

  it("shows a refusal as the footer's one message; pressing Wipe and remove clears it", async () => {
    let refuseWipe!: (reason: unknown) => void;
    const api = stubApi(resettable, {
      downloadOldBoxData: vi
        .fn()
        .mockRejectedValue({ code: "handover.old_box_unreachable", status: 502 }),
      orderServerReset: vi.fn(() => new Promise((_, reject) => (refuseWipe = reject))),
    });
    const el = await mount(api);
    await openAction(el, "reset");
    downloadButton(el)!.click();
    await flush(el);
    await flush(el);
    expect(await messageIn(el, "reset")).toBe(codeMessage("handover.old_box_unreachable"));
    expect(dialog(el, "reset").open).toBe(true);
    confirmButton(el, "reset").click();
    await flush(el);
    expect(await messageIn(el, "reset")).toBeNull();
    refuseWipe({ code: "handover.reset_loss_unaccepted", status: 409 });
    await flush(el);
  });

  it("pressing Download clears a Wipe refusal", async () => {
    let answer!: (value: typeof file) => void;
    spyOnSaving();
    const api = stubApi(resettable, {
      downloadOldBoxData: vi.fn(() => new Promise<typeof file>((resolve) => (answer = resolve))),
      orderServerReset: vi
        .fn()
        .mockRejectedValue({ code: "handover.reset_loss_unaccepted", status: 409 }),
    });
    const el = await mount(api);
    await openAction(el, "reset");
    await confirm(el, "reset");
    expect(await messageIn(el, "reset")).toBe(codeMessage("handover.reset_loss_unaccepted"));
    downloadButton(el)!.click();
    await flush(el);
    expect(await messageIn(el, "reset")).toBeNull();
    answer(file);
    await flush(el);
  });
});

describe("Wipe and remove when the return cannot complete", () => {
  const losing = listingWith({
    returnOutstanding: true,
    canWipeWithLoss: true,
    returnScenario: "emergency",
  });
  const lineIn = (el: ServersScreen, test: string) =>
    dialog(el, "reset")
      .querySelector(`[data-test=${test}]`)
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ?? null;

  it("is offered beside Will not return when the server says a wipe accepting the loss can be ordered", async () => {
    const el = await mount(stubApi(losing));
    expect(menu(el)!.querySelector(`[data-test="abandon-${OLD}"]`)).not.toBeNull();
    expect(menu(el)!.querySelector(`[data-test="reset-${OLD}"]`)?.textContent?.trim()).toBe(
      "Wipe and remove",
    );
  });

  it("warns what is set aside, shows the download line, no CAUTION line, and stays quiet and disabled until ticked", async () => {
    const el = await mount(stubApi(losing));
    await openAction(el, "reset");
    expect(lineIn(el, "reset-loss-warning")).toBe(
      "The old main box has not returned all its invoice records and working hours. Before it wipes itself it tries once more to send them; then its databases are set aside on it instead of deleted, and are no longer used.",
    );
    expect(lineIn(el, "reset-download")).toBe(
      "The old main box may hold data that this box does not have. You should download that data from https://old.venue.example before wiping and reusing it.",
    );
    const lines = [...dialog(el, "reset").querySelectorAll("[data-test]")].map((node) =>
      node.getAttribute("data-test"),
    );
    expect(lines.indexOf("reset-warning")).toBeLessThan(lines.indexOf("reset-loss-warning"));
    expect(lines.indexOf("reset-loss-warning")).toBeLessThan(lines.indexOf("reset-download"));
    expect(lines.indexOf("reset-download")).toBeLessThan(lines.indexOf("reset-loss-confirm"));
    expect(lineIn(el, "reset-caution")).toBeNull();
    expect(toggle(el, "reset", "reset-loss-confirm")!.label).toBe(
      "I have downloaded the old main box's data, or I accept that what it has not returned stays set aside on it and is no longer used. *",
    );
    expect(confirmButton(el, "reset").disabled).toBe(true);
    expect(confirmButton(el, "reset").variant).toBe("secondary");
    await tick(el, "reset", "reset-loss-confirm");
    expect(confirmButton(el, "reset").disabled).toBe(false);
    expect(confirmButton(el, "reset").variant).toBe("danger");
  });

  it("sends the loss order once ticked, then closes and reads the list again", async () => {
    const api = stubApi(losing);
    const el = await mount(api);
    await openAction(el, "reset");
    await confirm(el, "reset");
    expect(api.orderServerReset).not.toHaveBeenCalled();
    await tick(el, "reset", "reset-loss-confirm");
    const reads = vi.mocked(api.listServers).mock.calls.length;
    await confirm(el, "reset");
    expect(api.orderServerReset).toHaveBeenCalledExactlyOnceWith(OLD, true);
    expect(dialog(el, "reset").open).toBe(false);
    expect(vi.mocked(api.listServers).mock.calls.length).toBeGreaterThan(reads);
  });

  it("Cancel forgets the tick", async () => {
    const el = await mount(stubApi(losing));
    await openAction(el, "reset");
    await tick(el, "reset", "reset-loss-confirm");
    dialog(el, "reset")
      .querySelector<HTMLElementTagNameMap["wt-button"]>("wt-button[data-test=cancel-reset]")!
      .click();
    await flush(el);
    await openAction(el, "reset");
    expect(toggle(el, "reset", "reset-loss-confirm")!.checked).toBe(false);
    expect(confirmButton(el, "reset").disabled).toBe(true);
  });

  it("shows the loss dialog in Spanish", async () => {
    setLocale("es-ES");
    const el = await mount(stubApi(losing));
    await openAction(el, "reset");
    expect(lineIn(el, "reset-loss-warning")).toBe(es["servers.reset_loss_warning"]);
    expect(lineIn(el, "reset-download")).toBe(
      es["servers.reset_download"].replace("{address}", "https://old.venue.example"),
    );
    expect(toggle(el, "reset", "reset-loss-confirm")!.label).toBe(
      `${es["servers.reset_loss_confirm"]} *`,
    );
  });
});

describe("the row of an old main box after a wipe is asked", () => {
  const ordered = listingWith({
    removable: true,
    canReset: true,
    returnScenario: "controlled",
    reset: "ordered",
  });
  const removedByHand = listingWith({
    standing: "evicted",
    canClear: true,
    reset: "ordered",
    returnScenario: "controlled",
  });
  const askedLine = (el: ServersScreen) =>
    table(el).querySelector(`[data-test="reset-asked-${OLD}"]`)?.textContent?.trim() ?? null;

  it("says the wipe was asked and what happens next, and still offers Remove from venue", async () => {
    const el = await mount(stubApi(ordered));
    expect(askedLine(el)).toBe(
      "Wipe asked. The old main box wipes itself and leaves the venue the next time it is on and can reach this box; you can then re-add it as a spare. If it was already wiped by hand, choose Remove from venue.",
    );
    expect(menu(el)!.querySelector(`[data-test="remove-${OLD}"]`)?.textContent?.trim()).toBe(
      "Remove from venue",
    );
    cleanupWidgets();
    const before = await mount(
      stubApi(listingWith({ removable: true, canReset: true, returnScenario: "controlled" })),
    );
    expect(askedLine(before)).toBeNull();
  });

  it("says it in Spanish", async () => {
    setLocale("es-ES");
    const el = await mount(stubApi(ordered));
    expect(askedLine(el)).toBe(es["servers.reset_asked"]);
    expect(menu(el)!.querySelector(`[data-test="remove-${OLD}"]`)?.textContent?.trim()).toBe(
      "Retirar del local",
    );
  });

  it("drops the wipe-asked line once Remove from venue has removed the box", async () => {
    const el = await mount(stubApi(removedByHand));
    expect(table(el).querySelector(`[data-test="role-${OLD}"]`)?.textContent?.trim()).toBe(
      "Removed",
    );
    expect(askedLine(el)).toBeNull();
  });
});
