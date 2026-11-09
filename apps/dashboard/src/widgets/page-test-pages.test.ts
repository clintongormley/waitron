import { afterEach, expect, it, vi } from "vitest";
import { LitElement, html, nothing } from "lit";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";
import type { PagePrinterRow, PageTestPage } from "../api/client.js";
import { PageTestPages, type PageTestPagesApi } from "./page-test-pages.js";

afterEach(cleanupWidgets);

/** The least a screen does with the controller: each row's button and note, and the two messages. */
class TestPagesHost extends LitElement {
  static override styles = [baseStyles];
  api?: PageTestPagesApi;
  rows: PagePrinterRow[] = [];
  testPagePollMs = 2_000;
  readonly pages = new PageTestPages(this, {
    api: () => this.api,
    pollMs: () => this.testPagePollMs,
  });

  override render() {
    const pages = this.pages;
    return html`${this.rows.map(
      (row) =>
        html`<div>
          <span data-test=${`page-printer-name-${row.id}`}>${row.name}</span>${pages.noteFor(row)}
          <wt-button
            data-test=${`print-test-page-${row.id}`}
            ?disabled=${pages.unavailable(row)}
            ?loading=${pages.sending.has(row.id)}
            @click=${() => void pages.print(row)}
            >${t("printers.print_test_page")}</wt-button
          >
        </div>`,
    )}
    ${
      pages.actionError === null
        ? nothing
        : html`<p role="alert" data-test="page-printers-action-error">
            ${codeMessage(pages.actionError)}
          </p>`
    }
    ${
      pages.readError === null
        ? nothing
        : html`<p role="alert" data-test="page-printers-read-error">
            ${t("printers.refresh_failed")} ${codeMessage(pages.readError)}
          </p>`
    }`;
  }
}
customElements.define("page-test-pages-host", TestPagesHost);

const row = (over: Partial<PagePrinterRow> = {}): PagePrinterRow => ({
  id: "pp1",
  name: "Office",
  host: "10.0.0.56",
  port: 631,
  resourcePath: "/ipp/print",
  documentFormat: "application/pdf",
  supportedFormats: ["application/pdf"],
  media: "iso_a4_210x297mm",
  resolutionDpi: 300,
  active: true,
  agentId: "a1",
  agentName: "Kitchen agent",
  ...over,
});
const ROWS = [
  row(),
  row({ id: "pp2", name: "Back office", host: "10.0.0.57" }),
  row({
    id: "pp3",
    name: "Old laser",
    host: "10.0.0.58",
    active: false,
    agentId: null,
    agentName: null,
    media: "na_letter_8.5x11in",
  }),
];

function stubApi() {
  const background = {
    readPagePrinterTestPage: vi.fn<(id: string) => Promise<PageTestPage | null>>(),
  };
  return {
    printPagePrinterTestPage: vi
      .fn<(id: string) => Promise<PageTestPage>>()
      .mockResolvedValue({ id: "tp1", status: "waiting" }),
    readPagePrinterTestPage: vi.fn<(id: string) => Promise<PageTestPage | null>>(),
    background,
  };
}

async function mount(over: Partial<TestPagesHost> = {}) {
  const api = stubApi();
  const { el } = await mountWidget<TestPagesHost>("page-test-pages-host", {
    api,
    rows: ROWS,
    testPagePollMs: 1,
    ...over,
  } as Partial<TestPagesHost>);
  await flush(el);
  return { el, api };
}

async function settleTree(root: ShadowRoot | HTMLElement): Promise<void> {
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if ("updateComplete" in node)
      await (node as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
    if (node.shadowRoot) await settleTree(node.shadowRoot);
  }
}
async function flush(el: TestPagesHost): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  await settleTree(el.shadowRoot!);
  await el.updateComplete;
}
function deepQuery(root: ShadowRoot | HTMLElement, sel: string): HTMLElement | null {
  const found = root.querySelector<HTMLElement>(sel);
  if (found) return found;
  for (const node of root.querySelectorAll<HTMLElement>("*")) {
    if (node.shadowRoot) {
      const nested = deepQuery(node.shadowRoot, sel);
      if (nested) return nested;
    }
  }
  return null;
}
const q = (el: TestPagesHost, sel: string) => deepQuery(el.shadowRoot!, sel);
const text = (el: TestPagesHost, sel: string) =>
  q(el, sel)?.textContent?.replace(/\s+/g, " ").trim();
const button = (el: TestPagesHost, sel: string) =>
  q(el, sel) as unknown as HTMLElementTagNameMap["wt-button"];
async function click(el: TestPagesHost, sel: string) {
  q(el, sel)!.click();
  await flush(el);
}

const testPageNote = (el: TestPagesHost, id = "pp2") =>
  text(el, `[data-test=page-printer-test-page-${id}]`);

it("prints a test page on an active row, then follows its outcome with passive reads until it is printed", async () => {
  const { el, api } = await mount();
  api.background.readPagePrinterTestPage
    .mockResolvedValueOnce({ id: "tp1", status: "printing" })
    .mockResolvedValue({ id: "tp1", status: "sent" });
  expect(button(el, "[data-test=print-test-page-pp2]").textContent?.trim()).toBe(
    t("printers.print_test_page"),
  );

  await click(el, "[data-test=print-test-page-pp2]");

  expect(api.printPagePrinterTestPage).toHaveBeenCalledWith("pp2");
  await vi.waitFor(() => expect(testPageNote(el)).toBe(t("printers.test_page_printed")));
  expect(api.background.readPagePrinterTestPage).toHaveBeenCalledWith("pp2");
  expect(api.readPagePrinterTestPage).not.toHaveBeenCalled();
  const reads = api.background.readPagePrinterTestPage.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(api.background.readPagePrinterTestPage).toHaveBeenCalledTimes(reads);
  expect(q(el, "[data-test=page-printer-test-page-pp1]")).toBeNull();
});

it("shows the waiting and printing states on the row while the page is out", async () => {
  const { el, api } = await mount({ testPagePollMs: 60_000 } as Partial<TestPagesHost>);
  await click(el, "[data-test=print-test-page-pp2]");
  expect(testPageNote(el)).toBe(t("printers.test_page_waiting"));
  expect(q(el, "[data-test=page-printer-test-page-pp2]")!.getAttribute("role")).toBe("status");
  api.printPagePrinterTestPage.mockResolvedValueOnce({ id: "tp2", status: "printing" });
  await click(el, "[data-test=print-test-page-pp1]");
  expect(testPageNote(el, "pp1")).toBe(t("printers.test_page_printing"));
});

it("keeps the button quiet while its request or its page is out, and sends one request", async () => {
  const { el, api } = await mount();
  let answer!: (page: PageTestPage) => void;
  api.printPagePrinterTestPage.mockReturnValueOnce(
    new Promise<PageTestPage>((resolve) => {
      answer = resolve;
    }),
  );
  let printed!: (page: PageTestPage) => void;
  api.background.readPagePrinterTestPage.mockReturnValueOnce(
    new Promise<PageTestPage>((resolve) => {
      printed = resolve;
    }),
  );

  await click(el, "[data-test=print-test-page-pp2]");
  const action = button(el, "[data-test=print-test-page-pp2]");
  expect(action.disabled).toBe(true);
  expect(action.loading).toBe(true);
  await click(el, "[data-test=print-test-page-pp2]");
  answer({ id: "tp1", status: "waiting" });
  await flush(el);
  expect(action.loading).toBe(false);
  expect(action.disabled).toBe(true);
  await click(el, "[data-test=print-test-page-pp2]");
  expect(api.printPagePrinterTestPage).toHaveBeenCalledTimes(1);
  expect(button(el, "[data-test=print-test-page-pp1]").disabled).toBe(false);

  await vi.waitFor(() => expect(api.background.readPagePrinterTestPage).toHaveBeenCalled());
  printed({ id: "tp1", status: "sent" });
  await vi.waitFor(() => expect(action.disabled).toBe(false));
});

it.each([
  ["failed", "printer_refused", "printers.test_page_failed", "printers.test_page_reason_refused"],
  [
    "failed",
    "printer_unreachable",
    "printers.test_page_failed",
    "printers.test_page_reason_unreachable",
  ],
  [
    "failed",
    "document_unavailable",
    "printers.test_page_failed",
    "printers.test_page_reason_document",
  ],
  ["failed", "printer_disabled", "printers.test_page_failed", "printers.test_page_reason_disabled"],
  ["failed", "not_claimed", "printers.test_page_failed", "printers.test_page_reason_not_claimed"],
  ["unknown", "printer_aborted", "printers.test_page_unknown", "printers.test_page_reason_aborted"],
  ["unknown", "timeout", "printers.test_page_unknown", "printers.test_page_reason_timeout"],
] as const)(
  "shows a %s page (%s) on its row with the reason, and offers the button again",
  async (status, failureCode, sentence, reason) => {
    const { el, api } = await mount();
    api.background.readPagePrinterTestPage.mockResolvedValue({ id: "tp1", status, failureCode });
    await click(el, "[data-test=print-test-page-pp2]");
    await vi.waitFor(() => expect(testPageNote(el)).toBe(fill(sentence, { reason: t(reason) })));
    expect(button(el, "[data-test=print-test-page-pp2]").disabled).toBe(false);
  },
);

const HOLDS = [
  ["paper_out", "printers.test_page_hold_paper_out"],
  ["paper_jam", "printers.test_page_hold_paper_jam"],
  ["cover_open", "printers.test_page_hold_cover_open"],
  ["tray_missing", "printers.test_page_hold_tray_missing"],
  ["ink_or_toner_out", "printers.test_page_hold_ink_or_toner_out"],
  ["output_full", "printers.test_page_hold_output_full"],
  ["paused", "printers.test_page_hold_paused"],
  ["stopped", "printers.test_page_hold_stopped"],
] as const;

it.each(HOLDS)(
  "says what the printer is holding a printing page for (%s), keeps the button quiet and keeps reading",
  async (hold, reason) => {
    const { el, api } = await mount();
    api.background.readPagePrinterTestPage.mockResolvedValue({
      id: "tp1",
      status: "printing",
      hold,
    });
    await click(el, "[data-test=print-test-page-pp2]");
    await vi.waitFor(() =>
      expect(testPageNote(el)).toBe(fill("printers.test_page_held", { reason: t(reason) })),
    );
    expect(button(el, "[data-test=print-test-page-pp2]").disabled).toBe(true);
    const reads = api.background.readPagePrinterTestPage.mock.calls.length;
    await vi.waitFor(() =>
      expect(api.background.readPagePrinterTestPage.mock.calls.length).toBeGreaterThan(reads),
    );
  },
);

it.each(["fuser_hot", "toString"])(
  "says the page is waiting at the printer, with no reason, for a hold code it does not know (%s)",
  async (hold) => {
    const { el, api } = await mount();
    api.background.readPagePrinterTestPage.mockResolvedValue({
      id: "tp1",
      status: "printing",
      hold: hold as unknown as PageTestPage["hold"],
    });
    await click(el, "[data-test=print-test-page-pp2]");
    await vi.waitFor(() => expect(testPageNote(el)).toBe(t("printers.test_page_held_no_reason")));
    expect(button(el, "[data-test=print-test-page-pp2]").disabled).toBe(true);
  },
);

it("goes back to printing when the printer lets the page go", async () => {
  const { el, api } = await mount();
  const answers: ((page: PageTestPage) => void)[] = [];
  api.background.readPagePrinterTestPage.mockImplementation(
    () => new Promise<PageTestPage>((resolve) => answers.push(resolve)),
  );
  await click(el, "[data-test=print-test-page-pp2]");
  await vi.waitFor(() => expect(answers).toHaveLength(1));
  answers[0]!({ id: "tp1", status: "printing", hold: "paper_out" });
  await vi.waitFor(() =>
    expect(testPageNote(el)).toBe(
      fill("printers.test_page_held", { reason: t("printers.test_page_hold_paper_out") }),
    ),
  );
  await vi.waitFor(() => expect(answers).toHaveLength(2));
  answers[1]!({ id: "tp1", status: "printing" });
  await vi.waitFor(() => expect(testPageNote(el)).toBe(t("printers.test_page_printing")));
  expect(button(el, "[data-test=print-test-page-pp2]").disabled).toBe(true);
  await vi.waitFor(() => expect(answers).toHaveLength(3));
});

it("offers no test page on a disabled row", async () => {
  const { el, api } = await mount();
  const action = button(el, "[data-test=print-test-page-pp3]");
  expect(action.disabled).toBe(true);
  expect(action.variant).toBe("secondary");
  await click(el, "[data-test=print-test-page-pp3]");
  expect(api.printPagePrinterTestPage).not.toHaveBeenCalled();
});

it("shows a refused test page as the panel's alert and leaves the button usable", async () => {
  const { el, api } = await mount();
  api.printPagePrinterTestPage.mockRejectedValueOnce({ code: "page_printer.not_found" });
  await click(el, "[data-test=print-test-page-pp2]");
  expect(text(el, "[data-test=page-printers-action-error]")).toBe(
    codeMessage("page_printer.not_found"),
  );
  expect(q(el, "[data-test=page-printer-test-page-pp2]")).toBeNull();
  expect(button(el, "[data-test=print-test-page-pp2]").disabled).toBe(false);
  expect(api.background.readPagePrinterTestPage).not.toHaveBeenCalled();
});

it("keeps the page through a failed outcome read, shows it as a load failure, and clears it on the next read", async () => {
  const { el, api } = await mount();
  let answer!: (page: PageTestPage) => void;
  api.background.readPagePrinterTestPage
    .mockRejectedValueOnce({ code: "connection.failed" })
    .mockReturnValueOnce(
      new Promise<PageTestPage>((resolve) => {
        answer = resolve;
      }),
    );
  await click(el, "[data-test=print-test-page-pp2]");
  await vi.waitFor(() =>
    expect(text(el, "[data-test=page-printers-read-error]")).toBe(
      `${t("printers.refresh_failed")} ${codeMessage("connection.failed")}`,
    ),
  );
  expect(q(el, "[data-test=page-printers-action-error]")).toBeNull();
  expect(testPageNote(el)).toBe(t("printers.test_page_waiting"));
  expect(button(el, "[data-test=print-test-page-pp2]").disabled).toBe(true);
  await vi.waitFor(() => expect(api.background.readPagePrinterTestPage).toHaveBeenCalledTimes(2));

  answer({ id: "tp1", status: "sent" });
  await vi.waitFor(() => expect(testPageNote(el)).toBe(t("printers.test_page_printed")));
  expect(q(el, "[data-test=page-printers-read-error]")).toBeNull();
  expect(button(el, "[data-test=print-test-page-pp2]").disabled).toBe(false);
  expect(api.printPagePrinterTestPage).toHaveBeenCalledTimes(1);
});

it("leaves one printer's failed read in place when another printer's read succeeds", async () => {
  const { el, api } = await mount();
  let failed = false;
  let answerOther!: (page: PageTestPage) => void;
  api.background.readPagePrinterTestPage.mockImplementation((id) => {
    if (id === "pp2")
      return new Promise<PageTestPage>((resolve) => {
        answerOther = resolve;
      });
    if (failed) return new Promise<PageTestPage>(() => {});
    failed = true;
    return Promise.reject({ code: "connection.failed" });
  });
  await click(el, "[data-test=print-test-page-pp2]");
  await vi.waitFor(() =>
    expect(api.background.readPagePrinterTestPage).toHaveBeenCalledWith("pp2"),
  );
  await click(el, "[data-test=print-test-page-pp1]");
  await vi.waitFor(() => expect(q(el, "[data-test=page-printers-read-error]")).not.toBeNull());

  answerOther({ id: "tp2", status: "sent" });
  await vi.waitFor(() => expect(testPageNote(el, "pp2")).toBe(t("printers.test_page_printed")));
  expect(text(el, "[data-test=page-printers-read-error]")).toBe(
    `${t("printers.refresh_failed")} ${codeMessage("connection.failed")}`,
  );
});

it("drops the row's note when the server no longer holds the page", async () => {
  const { el, api } = await mount();
  api.background.readPagePrinterTestPage.mockResolvedValue(null);
  await click(el, "[data-test=print-test-page-pp2]");
  await vi.waitFor(() => expect(q(el, "[data-test=page-printer-test-page-pp2]")).toBeNull());
  expect(button(el, "[data-test=print-test-page-pp2]").disabled).toBe(false);
});

it("stops reading while it is out of the page and picks the page up again when put back", async () => {
  const { el, api } = await mount({ testPagePollMs: 30 } as Partial<TestPagesHost>);
  api.background.readPagePrinterTestPage.mockResolvedValue({ id: "tp1", status: "sent" });
  await click(el, "[data-test=print-test-page-pp2]");
  const parent = el.parentElement!;
  el.remove();
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(api.background.readPagePrinterTestPage).not.toHaveBeenCalled();
  parent.append(el);
  await vi.waitFor(() => expect(testPageNote(el)).toBe(t("printers.test_page_printed")));
  expect(api.background.readPagePrinterTestPage).toHaveBeenCalledTimes(1);
});

it("drops a read that was out when it left the page, and reads once more when put back", async () => {
  const { el, api } = await mount();
  let answer!: (page: PageTestPage) => void;
  api.background.readPagePrinterTestPage
    .mockReturnValueOnce(
      new Promise<PageTestPage>((resolve) => {
        answer = resolve;
      }),
    )
    .mockResolvedValue({ id: "tp1", status: "sent" });
  await click(el, "[data-test=print-test-page-pp2]");
  await vi.waitFor(() => expect(api.background.readPagePrinterTestPage).toHaveBeenCalledTimes(1));
  const parent = el.parentElement!;
  el.remove();
  parent.append(el);
  answer({ id: "tp1", status: "printing" });

  await vi.waitFor(() => expect(testPageNote(el)).toBe(t("printers.test_page_printed")));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(api.background.readPagePrinterTestPage).toHaveBeenCalledTimes(2);
  expect(testPageNote(el)).toBe(t("printers.test_page_printed"));
});
