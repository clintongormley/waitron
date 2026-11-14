import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import {
  codeMessage,
  currentLocale,
  formatIsoMinute,
  setLocale,
  type DashboardPermissionContinuation,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
import { VERIFACTU_DASHBOARD } from "./index.js";
import type { FiscalFilingScreen } from "./fiscal-filing-screen.js";
import type { FilingCaseView, FilingOverviewAnswer } from "../filing-overview-types.js";
import { REMEDY_REFUSALS, type RemedyRefusal } from "../remedy-refusals.js";
import { REFUSAL_WORDS } from "./put-right-words.js";
import { t } from "./strings.js";
import {
  FLAGGED_WARNING,
  IDENTITY_CHANGE,
  NOT_ISSUED_HERE,
  OURS,
  PREVIOUS,
  REPLY_MISMATCH,
  THEIRS,
  TOTALS_WARNING,
  conflictCase,
  overview,
} from "../../test/fiscal-filing-browser-fixture.js";

const hosts: HTMLElement[] = [];
let locale = "";

beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
  setLocale(locale);
  vi.restoreAllMocks();
});

async function mount(
  request: ReturnType<typeof vi.fn>,
  permissionContinuation?: DashboardPermissionContinuation,
): Promise<{ screen: FiscalFilingScreen; request: ReturnType<typeof vi.fn> }> {
  const entry = VERIFACTU_DASHBOARD.moreScreens!.find((s) => s.screen.id === "fiscal-filing")!;
  const handle = entry.create({
    request: request as unknown as DashboardRequest,
    permissionContinuation,
  });
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  render(handle.render(), host);
  const screen = host.querySelector("vf-fiscal-filing-screen") as FiscalFilingScreen;
  await vi.waitFor(() =>
    expect(
      screen.shadowRoot?.querySelector("[data-state]:not([data-state=loading])"),
    ).not.toBeNull(),
  );
  await screen.updateComplete;
  return { screen, request };
}

function text(screen: FiscalFilingScreen, selector: string): string {
  const el = screen.shadowRoot!.querySelector(selector);
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function counts(screen: FiscalFilingScreen): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dd of screen.shadowRoot!.querySelectorAll("[data-test=progress] dd[data-count]")) {
    out[dd.getAttribute("data-count")!] = (dd.textContent ?? "").trim();
  }
  return out;
}

function flat(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The element's text with its Technical details fold taken out. */
function unfolded(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelector("wt-disclosure[data-test=technical]")!.remove();
  return flat(copy);
}

async function openDetails(screen: FiscalFilingScreen): Promise<HTMLElement> {
  const table = screen.shadowRoot!.querySelector("wt-data-table[data-test=case-table]")!;
  await vi.waitFor(() => expect(table.shadowRoot?.querySelector("tbody tr")).not.toBeNull());
  const view = table.shadowRoot!.querySelector("[data-test=view-rec-1]") as HTMLElement | null;
  (view ?? (table.querySelector("[data-test=view-rec-1]") as HTMLElement)).click();
  const details = screen.shadowRoot!.querySelector("wt-modal[data-test=case-details]")!;
  await vi.waitFor(() => expect(details).toHaveProperty("open", true));
  return details as HTMLElement;
}

function button(screen: FiscalFilingScreen, name: string): HTMLElement {
  return screen.shadowRoot!.querySelector(`wt-button[data-test=${name}]`) as HTMLElement;
}

describe("vf-fiscal-filing-screen", () => {
  it("shows every part's figures and when it was read, and the first read is passive", async () => {
    const answer = overview();
    const { screen, request } = await mount(vi.fn(async () => answer));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/management-api/fiscal-filing", "GET", undefined, {
      passive: true,
    });
    expect(text(screen, "[data-test=read-at]")).toBe(`Read at ${formatIsoMinute(answer.readAt)}`);
    expect(counts(screen)).toEqual({
      pendiente: "4",
      enviando: "1",
      aceptado: "120",
      aceptado_con_errores: "2",
      rechazado: "5",
      detenido: "3",
      retenido: "6",
    });
    const progress = text(screen, "[data-test=progress]");
    for (const label of [
      "Waiting",
      "Sending",
      "Accepted",
      "Accepted with errors",
      "Refused",
      "Held",
      "Set aside",
    ])
      expect(progress).toContain(label);
    expect(text(screen, "[data-test=oldest-waiting]")).toContain(
      formatIsoMinute("2026-11-10T08:00:00.000Z"),
    );
    expect(text(screen, "[data-test=last-accepted]")).toContain(
      formatIsoMinute("2026-11-10T09:00:00.000Z"),
    );
    expect(text(screen, "[data-test=held-without-case]")).toContain("7");
    expect(screen.shadowRoot!.querySelector("[data-test=filing-off]")).toBeNull();
  });

  it("leaves out the held-with-no-case line at 0, and says when nothing is sent", async () => {
    const { screen } = await mount(
      vi.fn(async () =>
        overview({
          heldWithoutCase: 0,
          progress: {
            ...overview().progress,
            oldestWaitingGeneratedAt: null,
            lastConfirmedAt: null,
          },
          awaitingCertificate: true,
        }),
      ),
    );
    expect(screen.shadowRoot!.querySelector("[data-test=held-without-case]")).toBeNull();
    expect(text(screen, "[data-test=oldest-waiting]")).toContain("None");
    expect(text(screen, "[data-test=last-accepted]")).toContain("None");
    expect(text(screen, "[data-test=filing-off]")).toBe(
      "Nothing can be sent until the tax agency's certificate is installed.",
    );
  });

  it("says when this box does not send records at all", async () => {
    const { screen } = await mount(vi.fn(async () => overview({ filing: false })));
    expect(text(screen, "[data-test=filing-off]")).toBe(
      "This box does not send invoice records to AEAT.",
    );
  });

  it("puts the identity conflict first with the recovery link, and draws none without one", async () => {
    const { screen } = await mount(vi.fn(async () => overview()));
    const notice = screen.shadowRoot!.querySelector("[data-test=conflict]")!;
    expect(notice).not.toBeNull();
    const parts = [...screen.shadowRoot!.querySelectorAll("[data-test]")].map((el) =>
      el.getAttribute("data-test"),
    );
    expect(parts.indexOf("conflict")).toBeLessThan(parts.indexOf("progress"));
    const link = notice.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/manage/recovery/fiscal-conflict");
    expect(text(screen, "[data-test=conflict]")).toContain("server key");
    const line = text(screen, "[data-test=conflict] li");
    expect(line).toContain("T1/41");
    expect(line).toContain("Correcto");
    expect(line).toContain(THEIRS);

    const none = await mount(vi.fn(async () => overview({ activeConflicts: [] })));
    expect(none.screen.shadowRoot!.querySelector("[data-test=conflict]")).toBeNull();
  });

  it("says in plain words what AEAT holds for a conflict, with its evidence folded away", async () => {
    const [lookup] = overview().activeConflicts;
    const conflictCaseView = conflictCase("rec-1", "2026-11-03T11:02:00.000Z");
    const answer = (): Promise<FilingOverviewAnswer> =>
      Promise.resolve(
        overview({
          activeConflicts: [
            {
              ...lookup!,
              evidence: { ...lookup!.evidence!, state: "Correcto" } as typeof lookup.evidence,
            },
            { ...lookup!, invoiceNumber: "T1/42", evidence: conflictCaseView.conflicts[0]! },
          ],
        }),
      );
    const { screen } = await mount(vi.fn(answer));
    const items = [...screen.shadowRoot!.querySelectorAll("[data-test=conflict] li")];
    const said = items.map((item) => flat(item.querySelector("[data-test=said]")));
    expect(said).toEqual([
      "AEAT holds invoice T1/41 as accepted, and its details do not match this box's record.",
      "AEAT already holds a different record for invoice T1/42, so it refused this box's record.",
    ]);
    expect(flat(items[0]!.querySelector("[data-test=seen]"))).toBe(
      `Found ${formatIsoMinute(lookup!.observedAt)}`,
    );
    const fold = items[0]!.querySelector("wt-disclosure[data-test=technical]") as HTMLElement & {
      open: boolean;
    };
    expect(fold.open).toBe(false);
    expect(fold.getAttribute("heading")).toBe("Technical details");
    expect(flat(fold.querySelector("q[lang=es]"))).toBe("Correcto");
    for (const raw of [THEIRS, "BOX-01", "Correcto"]) {
      expect(unfolded(items[0]!)).not.toContain(raw);
      expect(flat(fold)).toContain(raw);
    }
    expect(flat(items[1]!.querySelector("wt-disclosure q[lang=es]"))).toBe(
      "Incorrecto 3000 Registro de facturación duplicado.",
    );

    setLocale("es");
    const spanish = await mount(vi.fn(answer));
    expect(
      flat(spanish.screen.shadowRoot!.querySelector("[data-test=conflict] [data-test=said]")),
    ).toBe(
      "La AEAT tiene la factura T1/41 como aceptada, y sus datos no coinciden con el registro de este servidor.",
    );
    expect(
      flat(spanish.screen.shadowRoot!.querySelector("[data-test=conflict] [data-test=seen]")),
    ).toBe(`Detectado: ${formatIsoMinute(lookup!.observedAt)}`);
  });

  it("says when AEAT holds an invoice under this box's series that this box did not issue", async () => {
    const [record] = overview().activeConflicts;
    const answer = (): Promise<FilingOverviewAnswer> =>
      Promise.resolve(
        overview({ activeConflicts: [{ ...record!, source: "series", invoiceNumber: "T1/99" }] }),
      );
    const { screen } = await mount(vi.fn(answer));
    const line = text(screen, "[data-test=conflict] li");
    expect(line).toContain("AEAT holds invoice T1/99; this box did not issue it.");
    expect(line).not.toContain("Correcto");

    setLocale("es");
    const spanish = await mount(vi.fn(answer));
    expect(text(spanish.screen, "[data-test=conflict] li")).toContain(
      "La AEAT tiene la factura T1/99; este servidor no la emitió.",
    );
  });

  it("lists invoices AEAT holds that this box did not issue, and identity changes without a handover", async () => {
    const answer = (): Promise<FilingOverviewAnswer> =>
      Promise.resolve(
        overview({
          missingHistory: {
            notIssuedHere: [
              NOT_ISSUED_HERE,
              {
                ...NOT_ISSUED_HERE,
                seriesCode: "T9",
                fingerprint: null,
                system: null,
                invoice: { ...NOT_ISSUED_HERE.invoice, NumSerieFactura: "T9/3" },
              },
            ],
            identityChanges: [IDENTITY_CHANGE],
          },
        }),
      );
    const { screen } = await mount(vi.fn(answer));
    const notIssued = [...screen.shadowRoot!.querySelectorAll("[data-test=not-issued-here] li")];
    expect(notIssued).toHaveLength(2);
    expect(unfolded(notIssued[0]!)).toBe(
      `AEAT holds invoice T0/12 (2026-10-28); this box did not issue it. Series T0 · Found ${formatIsoMinute("2026-11-04T10:15:00.000Z")}`,
    );
    const evidence = flat(notIssued[0]!.querySelector("wt-disclosure[data-test=technical]"));
    for (const shown of ["Correcto", THEIRS, "B87654321", "XX", "ELSEWHERE-7"])
      expect(evidence).toContain(shown);
    expect(unfolded(notIssued[1]!)).toContain("AEAT holds invoice T9/3 (2026-10-28)");
    const change = text(screen, "[data-test=identity-changes] li");
    expect(change).toBe(
      "The fiscal identity changed from BOX-01 to BOX-02 without a handover. The last invoice this box holds under BOX-01 is T1/40 (2026-11-02). Invoices under BOX-01 that this box does not hold may exist. " +
        `Changed ${formatIsoMinute("2026-11-03T08:00:00.000Z")}`,
    );
    expect(
      screen.shadowRoot!.querySelector("[data-test=missing-history] [data-test=empty]"),
    ).toBeNull();

    setLocale("es");
    const spanish = await mount(vi.fn(answer));
    expect(
      unfolded(spanish.screen.shadowRoot!.querySelector("[data-test=not-issued-here] li")!),
    ).toContain("La AEAT tiene la factura T0/12 (2026-10-28); este servidor no la emitió.");
    expect(text(spanish.screen, "[data-test=identity-changes] li")).toContain(
      "La identidad fiscal cambió de BOX-01 a BOX-02 sin un traspaso. La última factura que este servidor tiene bajo BOX-01 es la T1/40 (2026-11-02). Puede haber facturas bajo BOX-01 que este servidor no tiene.",
    );
  });

  it("says the box holds no invoice under the earlier identity when it holds none", async () => {
    const answer = (): Promise<FilingOverviewAnswer> =>
      Promise.resolve(
        overview({
          missingHistory: {
            notIssuedHere: [],
            identityChanges: [{ ...IDENTITY_CHANGE, lastHeldInvoice: null }],
          },
        }),
      );
    const { screen } = await mount(vi.fn(answer));
    expect(text(screen, "[data-test=identity-changes] li")).toBe(
      "The fiscal identity changed from BOX-01 to BOX-02 without a handover. This box holds no invoice under BOX-01. Invoices under BOX-01 that this box does not hold may exist. " +
        `Changed ${formatIsoMinute("2026-11-03T08:00:00.000Z")}`,
    );

    setLocale("es");
    const spanish = await mount(vi.fn(answer));
    expect(text(spanish.screen, "[data-test=identity-changes] li")).toContain(
      "La identidad fiscal cambió de BOX-01 a BOX-02 sin un traspaso. Este servidor no tiene ninguna factura bajo BOX-01. Puede haber facturas bajo BOX-01 que este servidor no tiene.",
    );
  });

  it("says so when neither possibly-missing-history list has anything", async () => {
    const answer = (): Promise<FilingOverviewAnswer> =>
      Promise.resolve(overview({ missingHistory: { notIssuedHere: [], identityChanges: [] } }));
    const { screen } = await mount(vi.fn(answer));
    expect(screen.shadowRoot!.querySelectorAll("[data-test=missing-history] li")).toHaveLength(0);
    expect(
      screen.shadowRoot!.querySelectorAll("[data-test=missing-history] [data-test=empty]"),
    ).toHaveLength(2);
    expect(text(screen, "[data-test=not-issued-here]")).toBe(
      "Invoices AEAT holds that this box did not issue None found.",
    );
    expect(text(screen, "[data-test=identity-changes]")).toBe(
      "Identity changes without a handover The fiscal identity has not changed without a handover.",
    );

    setLocale("es");
    const spanish = await mount(vi.fn(answer));
    expect(text(spanish.screen, "[data-test=identity-changes]")).toBe(
      "Cambios de identidad sin traspaso La identidad fiscal no ha cambiado sin un traspaso.",
    );
  });

  it("lists a reply that did not match what was sent, with what happens now and AEAT's lines folded away", async () => {
    const { screen } = await mount(vi.fn(async () => overview()));
    const section = screen.shadowRoot!.querySelector("section[data-test=warnings]")!;
    const heading = section.querySelector("h2")!;
    expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(flat(heading)).toBe("Warnings");
    const item = section.querySelector("[data-test=reply-mismatches] > ul > li")!;
    expect(flat(section.querySelector("[data-test=reply-mismatches] h3"))).toBe(
      "AEAT answers that did not match what was sent",
    );
    expect(unfolded(item)).toBe(
      "AEAT's answer to 2 records sent together had a different number of lines (1), so Waitron applied none of them. " +
        `Seen ${formatIsoMinute(REPLY_MISMATCH.detectedAt)} ` +
        "What happens now When this answer arrived, Waitron put each record back to be sent again, except any already on hold, which stayed on hold. Each record's state now is under Technical details.",
    );
    const fold = item.querySelector("wt-disclosure[data-test=technical]")!;
    expect(fold.getAttribute("heading")).toBe("Technical details");
    const evidence = flat(fold);
    for (const shown of [
      "A-YZ3K7QW2",
      "T1/50 · 2026-11-09 · Waiting to be sent to AEAT.",
      "T1/51 · 2026-11-09 · Held back: not sent for now.",
      "T1/50 · 2026-11-09 · Alta Incorrecto 1100",
      "These are the lines AEAT gave the first time while this warning is open; a later answer may differ.",
    ])
      expect(evidence).toContain(shown);
    expect([...fold.querySelectorAll("q[lang=es]")].map(flat)).toEqual([
      "Alta Incorrecto 1100",
      "Valor o tipo incorrecto del campo.",
    ]);

    setLocale("es");
    const spanish = await mount(vi.fn(async () => overview()));
    expect(flat(spanish.screen.shadowRoot!.querySelector("[data-test=warnings] h2"))).toBe(
      "Advertencias",
    );
    expect(text(spanish.screen, "[data-test=reply-mismatches] h3")).toBe(
      "Respuestas de la AEAT que no cuadran con lo enviado",
    );
    expect(
      unfolded(spanish.screen.shadowRoot!.querySelector("[data-test=reply-mismatches] > ul > li")!),
    ).toContain(
      "La respuesta de la AEAT a 2 registros enviados juntos tenía otro número de líneas (1), así que Waitron no aplicó ninguna.",
    );
  });

  it("says what Waitron did when it saw a mismatched reply, not that it will send the records again", async () => {
    const settled = () =>
      Promise.resolve(
        overview({
          warnings: {
            replyMismatches: [
              {
                ...REPLY_MISMATCH,
                sent: [
                  { ...REPLY_MISMATCH.sent[0]!, estado: "aceptado" },
                  { ...REPLY_MISMATCH.sent[1]!, estado: "rechazado" },
                ],
              },
            ],
            recordWarnings: [],
            total: 1,
          },
        }),
      );
    const now = (screen: FiscalFilingScreen) =>
      flat(screen.shadowRoot!.querySelector("[data-test=reply-mismatches] > ul > li > dl"));
    const { screen } = await mount(vi.fn(settled));
    expect(now(screen)).not.toMatch(/\bsends\b|\bis tried\b|\bwill\b/);
    expect(now(screen)).toContain("put each record back to be sent again");

    setLocale("es");
    const spanish = await mount(vi.fn(settled));
    expect(now(spanish.screen)).not.toMatch(/vuelve a enviar|se vuelve a intentar/);
    expect(now(spanish.screen)).toContain("volvió a dejar cada registro pendiente de enviar");
  });

  it("says which record sent issues an invoice and which cancels one, when both share a number, date and state", async () => {
    const { screen } = await mount(
      vi.fn(async () =>
        overview({
          warnings: {
            replyMismatches: [
              {
                ...REPLY_MISMATCH,
                sent: [
                  { ...REPLY_MISMATCH.sent[0]!, tipoRegistro: "alta" },
                  { ...REPLY_MISMATCH.sent[0]!, tipoRegistro: "anulacion" },
                ],
              },
            ],
            recordWarnings: [],
            total: 1,
          },
        }),
      ),
    );
    const fold = screen.shadowRoot!.querySelector(
      "[data-test=reply-mismatches] wt-disclosure[data-test=technical]",
    )!;
    const sent = [...fold.querySelectorAll("dl > div:nth-of-type(2) li")].map(flat);
    expect(sent).toHaveLength(2);
    expect(sent[0]).not.toBe(sent[1]);
    expect(sent[1]).toContain("A cancellation of an earlier invoice.");
  });

  it("draws a warning whose stored details came back empty", async () => {
    const { screen } = await mount(
      vi.fn(async () =>
        overview({
          warnings: {
            replyMismatches: [{ ...REPLY_MISMATCH, csv: null, sent: [], lines: [] }],
            recordWarnings: [{ ...FLAGGED_WARNING, fields: [], codes: [], record: null }],
            total: 2,
          },
        }),
      ),
    );
    expect(
      screen.shadowRoot!.querySelectorAll(
        "[data-test=reply-mismatches] > ul > li, [data-test=record-warnings] > ul > li",
      ),
    ).toHaveLength(2);
    expect(text(screen, "[data-test=reply-mismatches] > ul > li > span")).toBe(
      "AEAT's answer to 0 records sent together had a different number of lines (0), so Waitron applied none of them.",
    );
  });

  it("names each invoice with a warning from Waitron's own check, with its fields and codes folded away", async () => {
    const { screen } = await mount(vi.fn(async () => overview()));
    expect(text(screen, "[data-test=record-warnings] h3")).toBe(
      "Invoices with a warning from Waitron's own check",
    );
    const items = [...screen.shadowRoot!.querySelectorAll("[data-test=record-warnings] > ul > li")];
    expect(items.map(unfolded)).toEqual([
      "The totals of invoice T1/47 (2026-11-08) do not match its tax lines. AEAT accepts it; check that sale's prices. AEAT accepted it.",
      "Invoice T1/44 (2026-11-07) has something AEAT accepts but may point out. AEAT accepted it.",
    ]);
    const totals = flat(items[0]!.querySelector("wt-disclosure[data-test=technical]"));
    expect(totals).toContain("CuotaTotal · CUOTA_TOTAL_MISMATCH");
    expect(totals).toContain("ImporteTotal · IMPORTE_TOTAL_MISMATCH");
    expect(flat(items[1]!.querySelector("wt-disclosure[data-test=technical]"))).toContain(
      "Desglose[0].ClaveRegimen · CLAVE_REGIMEN_REQUIRED",
    );

    setLocale("es");
    const spanish = await mount(vi.fn(async () => overview()));
    const spanishItems = [
      ...spanish.screen.shadowRoot!.querySelectorAll("[data-test=record-warnings] > ul > li"),
    ];
    expect(text(spanish.screen, "[data-test=record-warnings] h3")).toBe(
      "Facturas con una advertencia de la comprobación de Waitron",
    );
    expect(unfolded(spanishItems[0]!)).toContain(
      "Los totales de la factura T1/47 (2026-11-08) no cuadran con sus líneas de impuestos.",
    );
    expect(unfolded(spanishItems[1]!)).toContain(
      "La factura T1/44 (2026-11-07) tiene algo que la AEAT acepta pero puede señalar.",
    );
  });

  it("says when an invoice was recorded when the warning names no record", async () => {
    const answer = () =>
      Promise.resolve(
        overview({
          warnings: {
            replyMismatches: [],
            recordWarnings: [
              { ...TOTALS_WARNING, record: null },
              { ...FLAGGED_WARNING, record: null },
            ],
            total: 2,
          },
        }),
      );
    const { screen } = await mount(vi.fn(answer));
    expect(screen.shadowRoot!.querySelector("[data-test=reply-mismatches]")).toBeNull();
    const items = [...screen.shadowRoot!.querySelectorAll("[data-test=record-warnings] > ul > li")];
    expect(items.map(unfolded)).toEqual([
      `An invoice recorded at ${formatIsoMinute(TOTALS_WARNING.detectedAt)} has totals that do not match its tax lines. AEAT accepts it; check that sale's prices.`,
      `An invoice recorded at ${formatIsoMinute(FLAGGED_WARNING.detectedAt)} has something AEAT accepts but may point out.`,
    ]);

    setLocale("es");
    const spanish = await mount(vi.fn(answer));
    expect(text(spanish.screen, "[data-test=record-warnings] li")).toContain(
      `Una factura registrada el ${formatIsoMinute(TOTALS_WARNING.detectedAt)}`,
    );
  });

  it("says there are no open warnings, and draws no list, when there are none", async () => {
    const answer = () =>
      Promise.resolve(
        overview({ warnings: { replyMismatches: [], recordWarnings: [], total: 0 } }),
      );
    const { screen } = await mount(vi.fn(answer));
    expect(text(screen, "[data-test=warnings]")).toBe("Warnings No open warnings.");
    expect(screen.shadowRoot!.querySelectorAll("[data-test=warnings] li")).toHaveLength(0);
    expect(screen.shadowRoot!.querySelector("[data-test=warnings] [data-test=bounded]")).toBeNull();

    setLocale("es");
    const spanish = await mount(vi.fn(answer));
    expect(text(spanish.screen, "[data-test=warnings]")).toBe(
      "Advertencias No hay advertencias abiertas.",
    );
  });

  it("says the warnings shown are the newest few when there are more", async () => {
    const answer = () =>
      Promise.resolve(
        overview({
          warnings: { replyMismatches: [REPLY_MISMATCH], recordWarnings: [], total: 201 },
        }),
      );
    const { screen } = await mount(vi.fn(answer));
    expect(text(screen, "[data-test=warnings] [data-test=bounded]")).toBe(
      "Showing the newest 1 of 201. Export them to see every one.",
    );
    const all = await mount(vi.fn(async () => overview()));
    expect(
      all.screen.shadowRoot!.querySelector("[data-test=warnings] [data-test=bounded]"),
    ).toBeNull();

    setLocale("es");
    const spanish = await mount(vi.fn(answer));
    expect(text(spanish.screen, "[data-test=warnings] [data-test=bounded]")).toBe(
      "Se muestran las 1 más recientes de 201. Expórtalas para verlas todas.",
    );
  });

  it("puts the warnings between the filing cases and the possibly missing history", async () => {
    const { screen } = await mount(vi.fn(async () => overview()));
    const order = [...screen.shadowRoot!.querySelectorAll("section[data-test]")].map((section) =>
      section.getAttribute("data-test"),
    );
    expect(order).toEqual(["progress", "cases", "warnings", "missing-history"]);
  });

  it("shows a refused read's message under the actions until a later read succeeds", async () => {
    let refuse = true;
    const request = vi.fn(async () => {
      if (refuse) throw { code: "connection.failed" };
      return overview();
    });
    const { screen } = await mount(request);
    expect(text(screen, "[data-test=read-error]")).toBe(codeMessage("connection.failed"));
    refuse = false;
    button(screen, "refresh").click();
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector("[data-test=read-error]")).toBeNull(),
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith("/management-api/fiscal-filing", "GET", undefined, {
      passive: true,
    });
    expect(text(screen, "[data-test=read-at]")).toContain("Read at");
  });

  it("lists each case, and View on a conflict case shows both fingerprints", async () => {
    const { screen } = await mount(vi.fn(async () => overview()));
    const table = screen.shadowRoot!.querySelector("wt-data-table[data-test=case-table]")!;
    await vi.waitFor(() => expect(table.shadowRoot?.querySelector("tbody tr")).not.toBeNull());
    const row = (table.shadowRoot!.querySelector("tbody tr")!.textContent ?? "").replace(
      /\s+/g,
      " ",
    );
    expect(row).toContain("T1/41");
    expect(row).toContain("AEAT holds a different record");
    expect(row).toContain("3000");
    expect(screen.shadowRoot!.querySelector("[data-test=bounded]")).toBeNull();
    const view = table.shadowRoot!.querySelector("[data-test=view-rec-1]") as HTMLElement | null;
    (view ?? (table.querySelector("[data-test=view-rec-1]") as HTMLElement)).click();
    await vi.waitFor(() =>
      expect(screen.shadowRoot!.querySelector("wt-modal[data-test=case-details]")).toHaveProperty(
        "open",
        true,
      ),
    );
    const details = text(screen, "wt-modal[data-test=case-details]");
    expect(details).toContain(OURS);
    expect(details).toContain(PREVIOUS);
    expect(details).toContain(THEIRS);
    expect(details).toContain("Registro de facturación duplicado.");
  });

  it("explains a case in plain words and folds the raw evidence under Technical details", async () => {
    const { screen } = await mount(vi.fn(async () => overview()));
    const details = await openDetails(screen);
    const fold = details.querySelector("wt-disclosure[data-test=technical]") as HTMLElement & {
      open: boolean;
    };
    expect(fold.getAttribute("heading")).toBe("Technical details");
    expect(fold.open).toBe(false);
    const plain = (selector: string) => flat(details.querySelector(selector));
    expect(plain("[data-test=invoice] dd")).toBe("T1/41 · 2026-11-03");
    expect(plain("[data-test=kind] dd")).toBe(
      "A simplified invoice: a till receipt that names no customer.",
    );
    expect(plain("[data-test=state] dd")).toBe("AEAT refused it.");
    expect(plain("[data-test=total] dd")).toBe("€12.10, including €2.10 VAT");
    expect(plain("[data-test=now] dd")).toBe(
      "This record is refused and is not sent again. While the conflict is active, this box issues no invoices.",
    );
    const reply = details.querySelector("[data-test=reply-then] q")!;
    expect(reply.getAttribute("lang")).toBe("es");
    expect(flat(reply)).toBe("Registro de facturación duplicado.");

    const outside = unfolded(details);
    const inside = flat(fold);
    expect(outside).not.toContain("Issued by");
    for (const raw of [OURS, PREVIOUS, THEIRS, "BOX-01", "B12345678", "alta", "F2", "3000"]) {
      expect(outside).not.toContain(raw);
      expect(inside).toContain(raw);
    }

    setLocale("es");
    const spanish = await openDetails((await mount(vi.fn(async () => overview()))).screen);
    expect(spanish.querySelector("wt-disclosure")!.getAttribute("heading")).toBe(
      "Detalles técnicos",
    );
    expect(flat(spanish.querySelector("[data-test=kind] dd"))).toBe(
      "Una factura simplificada: un tique que no identifica al cliente.",
    );
    expect(flat(spanish.querySelector("[data-test=total] dd"))).toBe(
      "12,10 €, IVA de 2,10 € incluido",
    );
  });

  it.each([
    ["pendiente", "Waiting to be sent to AEAT."],
    ["enviando", "Being sent to AEAT now."],
    ["aceptado", "AEAT accepted it."],
    ["aceptado_con_errores", "AEAT accepted it and pointed out an error."],
    ["rechazado", "AEAT refused it."],
    ["detenido", "Held back: not sent for now."],
    ["retenido", "Set aside: not sent."],
  ] as const)("says where a %s record stands", async (estado, line) => {
    const base = conflictCase("rec-1", "2026-11-03T11:02:00.000Z");
    const found = { ...base, submission: { ...base.submission!, estado } };
    const details = await openDetails(
      (await mount(vi.fn(async () => overview({ cases: [found] })))).screen,
    );
    expect(flat(details.querySelector("[data-test=state] dd"))).toBe(line);
  });

  it("does not call a record refused when only the check against AEAT found its conflict", async () => {
    const base = conflictCase("rec-1", "2026-11-03T11:02:00.000Z");
    const found = {
      ...base,
      evidence: { codigo: null, mensaje: null, csv: null },
      submission: { estado: "pendiente", codigoError: null, mensajeError: null, enviadoEn: null },
      conflicts: [],
      lookups: [
        {
          recordedAt: "2026-11-04T03:00:00.000Z",
          invoice: {
            IDEmisorFactura: "B12345678",
            NumSerieFactura: "T1/41",
            FechaExpedicionFactura: "03-11-2026",
          },
          state: "Correcto",
          fingerprint: THEIRS,
          system: null,
        },
      ],
    };
    const stopped = await openDetails(
      (await mount(vi.fn(async () => overview({ cases: [found] })))).screen,
    );
    expect(flat(stopped.querySelector("[data-test=state] dd"))).toBe("Waiting to be sent to AEAT.");
    expect(flat(stopped.querySelector("[data-test=now] dd"))).toBe(
      "Found by looking the invoice up at AEAT. Looking it up does not change how this record is sent. While the conflict is active, this box issues no invoices.",
    );
    expect(unfolded(stopped)).not.toContain("refused");

    const refused = { ...found, cause: "fiscal.registro_rechazado" as const };
    const later = await openDetails(
      (await mount(vi.fn(async () => overview({ cases: [refused] })))).screen,
    );
    expect(flat(later.querySelector("[data-test=now] dd"))).toMatch(
      /^Later records are still sent\./,
    );

    setLocale("es");
    const spanish = await openDetails(
      (await mount(vi.fn(async () => overview({ cases: [found] })))).screen,
    );
    expect(flat(spanish.querySelector("[data-test=now] dd"))).toBe(
      "Se detectó al consultar la factura en la AEAT. La consulta no cambia cómo se envía este registro. Mientras el conflicto siga activo, este servidor no emite facturas.",
    );
  });

  it("says this box issues no invoices only when the case's conflict is one that stops it", async () => {
    const found = conflictCase("rec-1", "2026-11-03T11:02:00.000Z");
    const [active] = overview().activeConflicts;
    for (const others of [
      [],
      [{ ...active!, installationName: "BOX-00" }],
      [{ ...active!, invoiceNumber: "T1/40" }],
      [{ ...active!, source: "series" as const }],
    ]) {
      const details = await openDetails(
        (await mount(vi.fn(async () => overview({ cases: [found], activeConflicts: others }))))
          .screen,
      );
      expect(flat(details.querySelector("[data-test=now] dd"))).toBe(
        "This record is refused and is not sent again.",
      );
    }
  });

  it.each([
    ["alta", "F1", "A full invoice that names the customer."],
    ["alta", "F3", "A full invoice that replaces earlier simplified invoices."],
    ["alta", "R5", "An invoice that corrects an earlier one."],
    ["anulacion", null, "A cancellation of an earlier invoice."],
    ["alta", "X9", "An invoice record."],
  ] as const)("names the record %s %s in plain words", async (tipoRegistro, tipoFactura, line) => {
    const base = conflictCase("rec-1", "2026-11-03T11:02:00.000Z");
    const amounts =
      tipoRegistro === "anulacion"
        ? { importeTotal: null, cuotaTotal: null, descripcionOperacion: null }
        : {};
    const found = { ...base, record: { ...base.record, tipoRegistro, tipoFactura, ...amounts } };
    const { screen } = await mount(vi.fn(async () => overview({ cases: [found] })));
    const details = await openDetails(screen);
    expect(flat(details.querySelector("[data-test=kind] dd"))).toBe(line);
    expect(details.querySelector("[data-test=total]") === null).toBe(tipoRegistro === "anulacion");
  });

  it("says once, while there are cases, to open one to see whether it can be put right", async () => {
    const { screen } = await mount(vi.fn(async () => overview()));
    expect(screen.shadowRoot!.querySelectorAll("[data-test=open-to-put-right]")).toHaveLength(1);
    expect(text(screen, "[data-test=cases] [data-test=open-to-put-right]")).toBe(
      "Open a case to see whether Waitron can put it right.",
    );

    const { screen: empty } = await mount(
      vi.fn(async () => overview({ cases: [], totalCases: 0 })),
    );
    expect(empty.shadowRoot!.querySelector("[data-test=open-to-put-right]")).toBeNull();
  });

  it("says the list is the newest 200 when there are more", async () => {
    const cases = Array.from({ length: 200 }, (_, i) =>
      conflictCase(`rec-${i}`, "2026-11-03T11:02:00.000Z"),
    );
    const { screen } = await mount(vi.fn(async () => overview({ cases, totalCases: 201 })));
    expect(text(screen, "[data-test=bounded]")).toBe("The newest 200 of 201");
  });

  it("exports every open case, read again, as one file of that answer", async () => {
    const all = overview({ readAt: "2026-11-10T10:15:00.000Z", totalCases: 1 });
    const request = vi.fn(async (path: string) => (path.endsWith("?cases=all") ? all : overview()));
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return "blob:fiscal-filing";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    const { screen } = await mount(request);
    button(screen, "export").click();
    await vi.waitFor(() => expect(names).toHaveLength(1));
    expect(request).toHaveBeenLastCalledWith("/management-api/fiscal-filing?cases=all", "GET");
    const day = formatIsoMinute(all.readAt).slice(0, 10);
    expect(names).toEqual([`fiscal-filing-${day}.json`]);
    expect(blobs).toHaveLength(1);
    expect(JSON.parse(await blobs[0]!.text())).toEqual(all);
  });
});

const REMEDY = "/management-api/fiscal-records/remedy";
const NAMES_DESCRIPTION = "Valor o tipo incorrecto del campo: DescripcionOperacion";

function refusedCase(code: number, message: string, tipoFactura = "F2"): FilingCaseView {
  const base = conflictCase("rec-1", "2026-11-03T11:02:00.000Z");
  return {
    ...base,
    cause: "fiscal.registro_rechazado",
    evidence: { codigo: code, mensaje: message, csv: null },
    record: { ...base.record, tipoFactura },
    submission: { ...base.submission!, codigoError: String(code), mensajeError: message },
    conflicts: [],
  };
}

function continuation(permissions: string[]) {
  const signIn = vi.fn(async () => "signed-in" as const);
  const value: DashboardPermissionContinuation = {
    snapshot: () => ({ accountGeneration: 1, authenticated: true, permissions }),
    subscribe: () => () => {},
    signIn,
  };
  return { value, signIn };
}

const refusal = (code: string) => Object.assign(new Error(code), { code });

/** Answers the page's reads with `found`, and the remedy with `remedy`. */
function server(found: FilingCaseView, remedy: () => Promise<unknown> = async () => ({})) {
  return vi.fn(async (path: string) =>
    path === REMEDY ? remedy() : overview({ cases: [found], totalCases: 1 }),
  );
}

function field(details: HTMLElement) {
  return details.querySelector("wt-textarea[name=operationDescription]") as HTMLElement & {
    value: string;
    updateComplete: Promise<unknown>;
  };
}

async function type(screen: FiscalFilingScreen, details: HTMLElement, value: string) {
  const area = field(details).shadowRoot!.querySelector("textarea")!;
  area.value = value;
  area.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await screen.updateComplete;
}

function action(details: HTMLElement): HTMLElement & { disabled: boolean } {
  return details.querySelector("[data-test=put-right]") as HTMLElement & { disabled: boolean };
}

const remedyCalls = (request: ReturnType<typeof vi.fn>) =>
  request.mock.calls.filter(([path]) => path === REMEDY);

describe("putting a case right", () => {
  it("corrects the description beside AEAT's message, and sends it once it changed", async () => {
    const request = server(refusedCase(1100, NAMES_DESCRIPTION));
    const { screen } = await mount(request, continuation(["fiscal.remedy"]).value);
    const details = await openDetails(screen);
    expect(flat(details.querySelector("[data-test=put-right-heading]"))).toBe(
      "Correct the description",
    );
    expect(field(details).value).toBe("Venta en establecimiento");
    expect(flat(details.querySelector("[data-test=aeat-message]"))).toContain(NAMES_DESCRIPTION);
    expect(action(details).disabled).toBe(true);
    expect(flat(action(details))).toBe("Send the correction");

    await type(screen, details, "Servicio de restauración");
    expect(action(details).disabled).toBe(false);
    action(details).click();
    await vi.waitFor(() => expect(remedyCalls(request)).toHaveLength(1));
    const [, method, body] = remedyCalls(request)[0]!;
    expect(method).toBe("POST");
    expect(body).toEqual({
      kind: "record-correction",
      registroId: "rec-1",
      actionKey: expect.stringMatching(/.+/),
      reason: expect.stringContaining("1100"),
      facts: { description: "Servicio de restauración" },
    });
    expect(body).not.toHaveProperty("caseId");
    await vi.waitFor(() => expect(details).toHaveProperty("open", false));
    await vi.waitFor(() => expect(request.mock.calls.length).toBe(3));
  });

  it("asks for a description, and Stop sends nothing", async () => {
    const request = server(refusedCase(1100, NAMES_DESCRIPTION));
    const { screen } = await mount(request, continuation(["fiscal.remedy"]).value);
    const details = await openDetails(screen);
    await type(screen, details, "");
    action(details).click();
    await screen.updateComplete;
    expect((field(details) as unknown as { error: string }).error).toBe(
      "Write the operation description.",
    );
    expect(
      (details.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
    ).toBe("Correct the field marked above.");
    (details.querySelector("[data-test=stop]") as HTMLElement).click();
    await vi.waitFor(() => expect(details).toHaveProperty("open", false));
    expect(remedyCalls(request)).toHaveLength(0);
  });

  it("marks a description holding a character AEAT refuses, and sends nothing", async () => {
    const request = server(refusedCase(1100, NAMES_DESCRIPTION));
    const { screen } = await mount(request, continuation(["fiscal.remedy"]).value);
    const details = await openDetails(screen);
    await type(screen, details, "Servicio\u000Bde restauración");
    action(details).click();
    await screen.updateComplete;
    expect((field(details) as unknown as { error: string }).error).toBe(
      "Remove the invisible character AEAT does not accept; it may have come with pasted text.",
    );
    expect(
      (details.querySelector("wt-form-actions") as HTMLElement & { error: string }).error,
    ).toBe("Correct the field marked above.");
    expect(remedyCalls(request)).toHaveLength(0);
  });

  it.each([
    ["another field", 1100, "Valor o tipo incorrecto del campo: NumSerieFactura", "F2"],
    ["a future date on a simplified invoice", 1112, "Fecha superior a la actual", "F2"],
  ])("cannot put right a refusal for %s", async (_name, code, message, tipoFactura) => {
    const { screen } = await mount(
      server(refusedCase(code, message, tipoFactura)),
      continuation(["fiscal.remedy"]).value,
    );
    const details = await openDetails(screen);
    expect(flat(details.querySelector("[data-test=put-right-none]"))).toBe(
      "Waitron cannot put this one right yet. The case stays open.",
    );
    expect(details.querySelector("wt-textarea")).toBeNull();
    expect(action(details)).toBeNull();
  });

  it("says a full invoice needs a corrective Waitron cannot issue yet", async () => {
    const { screen } = await mount(server(refusedCase(1112, "Fecha superior a la actual", "F1")));
    const details = await openDetails(screen);
    expect(flat(details.querySelector("[data-test=put-right-none]"))).toBe(
      "Waitron cannot put this one right yet: a full invoice needs a corrective invoice Waitron cannot issue yet.",
    );
  });

  it("offers an administrator's sign-in to someone without the permission", async () => {
    const { value, signIn } = continuation(["report.export"]);
    const request = server(refusedCase(1100, NAMES_DESCRIPTION));
    const { screen } = await mount(request, value);
    const details = await openDetails(screen);
    expect(flat(action(details))).toBe("Sign in as an administrator to put this right");
    expect(action(details).disabled).toBe(false);
    action(details).click();
    await vi.waitFor(() => expect(signIn).toHaveBeenCalledOnce());
    expect(signIn).toHaveBeenCalledWith({
      permission: "fiscal.remedy",
      signal: expect.any(AbortSignal),
    });
    expect(remedyCalls(request)).toHaveLength(0);
  });

  it("keeps what was typed when an administrator signs in here, and sends it", async () => {
    let permissions = ["report.export"];
    let generation = 1;
    type Snapshot = ReturnType<DashboardPermissionContinuation["snapshot"]>;
    const listeners = new Set<(snapshot: Snapshot) => void>();
    const auth: DashboardPermissionContinuation = {
      snapshot: () => ({ accountGeneration: generation, authenticated: true, permissions }),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      signIn: async () => {
        permissions = ["report.export", "fiscal.remedy"];
        generation += 1;
        for (const listener of listeners) listener(auth.snapshot());
        return "signed-in";
      },
    };
    const request = server(refusedCase(1100, NAMES_DESCRIPTION));
    const { screen } = await mount(request, auth);
    const details = await openDetails(screen);
    await type(screen, details, "Servicio de restauración");
    action(details).click();
    await vi.waitFor(() => expect(flat(action(details))).toBe("Send the correction"));
    expect(field(details).value).toBe("Servicio de restauración");
    action(details).click();
    await vi.waitFor(() => expect(remedyCalls(request)).toHaveLength(1));
    expect(remedyCalls(request)[0]![2]).toMatchObject({
      facts: { description: "Servicio de restauración" },
    });
  });

  it("shows a refusal under the actions, keeps Send, and sends the same request again", async () => {
    const remedy = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(refusal("clock.unconfirmed"))
      .mockResolvedValueOnce({});
    const request = server(refusedCase(1100, NAMES_DESCRIPTION), remedy);
    const { screen } = await mount(request, continuation(["fiscal.remedy"]).value);
    const details = await openDetails(screen);
    await type(screen, details, "Servicio de restauración");
    action(details).click();
    const actions = details.querySelector("wt-form-actions") as HTMLElement & { error: string };
    await vi.waitFor(() =>
      expect(actions.error).toBe(
        "The server is waiting for its time to be confirmed. Confirm it on a till or on the Box status page, then send again.",
      ),
    );
    expect(action(details).disabled).toBe(false);
    action(details).click();
    await vi.waitFor(() => expect(remedyCalls(request)).toHaveLength(2));
    expect(remedyCalls(request)[1]![2]).toEqual(remedyCalls(request)[0]![2]);
  });

  it.each([
    "filing_case.already_resolved",
    "fiscal.record_already_corrected",
    "filing_case.action_mismatch",
    "fiscal.remedy_invalid",
    "filing_case.not_found",
  ])(
    "reads the page again and closes the case when the case changed meanwhile: %s",
    async (code) => {
      const request = server(refusedCase(1100, NAMES_DESCRIPTION), async () => {
        throw refusal(code);
      });
      const { screen } = await mount(request, continuation(["fiscal.remedy"]).value);
      const details = await openDetails(screen);
      await type(screen, details, "Servicio de restauración");
      action(details).click();
      await vi.waitFor(() => expect(request.mock.calls.length).toBe(3));
      expect(request.mock.calls[2]![0]).toBe("/management-api/fiscal-filing");
      await vi.waitFor(() => expect(details).toHaveProperty("open", false));
      await screen.updateComplete;
      expect(text(screen, "[data-test=case-changed]")).toBe(
        "This case was already put right, or it changed; nothing more was sent.",
      );
    },
  );

  it("reads the page again when a send succeeds after its case was closed", async () => {
    let answer!: (value: unknown) => void;
    const request = server(
      refusedCase(1100, NAMES_DESCRIPTION),
      () => new Promise((resolve) => (answer = resolve)),
    );
    const { screen } = await mount(request, continuation(["fiscal.remedy"]).value);
    const details = await openDetails(screen);
    await type(screen, details, "Servicio de restauración");
    action(details).click();
    await vi.waitFor(() => expect(remedyCalls(request)).toHaveLength(1));
    const closed = new Promise((resolve) =>
      details.addEventListener("wt-close", resolve, { once: true }),
    );
    await (
      details as HTMLElement & { requestClose(reason: string): Promise<boolean> }
    ).requestClose("cancel");
    await closed;
    await screen.updateComplete;
    expect(request.mock.calls.length).toBe(2);
    answer({});
    await vi.waitFor(() => expect(request.mock.calls.length).toBe(3));
    expect(request.mock.calls[2]![0]).toBe("/management-api/fiscal-filing");
  });

  /** Closes the case dialog with the dialog's own cancel, and waits until it has closed. */
  async function closeDialog(screen: FiscalFilingScreen, details: HTMLElement) {
    const closed = new Promise((resolve) =>
      details.addEventListener("wt-close", resolve, { once: true }),
    );
    await (
      details as HTMLElement & { requestClose(reason: string): Promise<boolean> }
    ).requestClose("cancel");
    await closed;
    await screen.updateComplete;
  }

  it("keeps a reopened case's unsent description when an earlier opening's send succeeds", async () => {
    let finish!: (value: unknown) => void;
    const request = server(
      refusedCase(1100, NAMES_DESCRIPTION),
      () => new Promise((resolve) => (finish = resolve)),
    );
    const { screen } = await mount(request, continuation(["fiscal.remedy"]).value);
    const details = await openDetails(screen);
    await type(screen, details, "First description");
    action(details).click();
    await vi.waitFor(() => expect(remedyCalls(request)).toHaveLength(1));
    await closeDialog(screen, details);
    const reopened = await openDetails(screen);
    await type(screen, reopened, "Second unsent description");
    finish({});
    await vi.waitFor(() => expect(request.mock.calls.length).toBe(3));
    await screen.updateComplete;
    expect(reopened).toHaveProperty("open", true);
    expect(field(reopened).value).toBe("Second unsent description");
  });

  it("keeps a reopened case's own send pending when an earlier opening's send is refused", async () => {
    let refuseFirst!: (error: Error) => void;
    let finishSecond!: (value: unknown) => void;
    let sends = 0;
    const request = server(refusedCase(1100, NAMES_DESCRIPTION), () =>
      ++sends === 1
        ? new Promise((_resolve, reject) => (refuseFirst = reject))
        : new Promise((resolve) => (finishSecond = resolve)),
    );
    const { screen } = await mount(request, continuation(["fiscal.remedy"]).value);
    const details = await openDetails(screen);
    await type(screen, details, "First description");
    action(details).click();
    await vi.waitFor(() => expect(remedyCalls(request)).toHaveLength(1));
    await closeDialog(screen, details);
    const reopened = await openDetails(screen);
    await type(screen, reopened, "Second description");
    action(reopened).click();
    await vi.waitFor(() => expect(remedyCalls(request)).toHaveLength(2));
    expect(action(reopened).disabled).toBe(true);
    refuseFirst(refusal("clock.unconfirmed"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await screen.updateComplete;
    expect(action(reopened).disabled).toBe(true);
    const actions = reopened.querySelector("wt-form-actions") as HTMLElement & { error: string };
    expect(actions.error).toBe("");
    finishSecond({});
    await vi.waitFor(() => expect(reopened).toHaveProperty("open", false));
  });

  it("keeps a reopened case open when an earlier opening's send finds the case changed", async () => {
    let refuseFirst!: (error: Error) => void;
    let finishSecond!: (value: unknown) => void;
    let sends = 0;
    const request = server(refusedCase(1100, NAMES_DESCRIPTION), () =>
      ++sends === 1
        ? new Promise((_resolve, reject) => (refuseFirst = reject))
        : new Promise((resolve) => (finishSecond = resolve)),
    );
    const { screen } = await mount(request, continuation(["fiscal.remedy"]).value);
    const details = await openDetails(screen);
    await type(screen, details, "First description");
    action(details).click();
    await vi.waitFor(() => expect(remedyCalls(request)).toHaveLength(1));
    await closeDialog(screen, details);
    const reopened = await openDetails(screen);
    await type(screen, reopened, "Second description");
    action(reopened).click();
    await vi.waitFor(() => expect(remedyCalls(request)).toHaveLength(2));
    expect(request.mock.calls.length).toBe(3);
    refuseFirst(refusal("filing_case.action_mismatch"));
    await vi.waitFor(() => expect(request.mock.calls.length).toBe(4));
    expect(request.mock.calls[3]![0]).toBe("/management-api/fiscal-filing");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await screen.updateComplete;
    expect(reopened).toHaveProperty("open", true);
    expect(field(reopened).value).toBe("Second description");
    expect(action(reopened).disabled).toBe(true);
    expect(screen.shadowRoot!.querySelector("[data-test=case-changed]")).toBeNull();
    finishSecond({});
    await vi.waitFor(() => expect(reopened).toHaveProperty("open", false));
    expect(screen.shadowRoot!.querySelector("[data-test=case-changed]")).toBeNull();
  });

  it("keeps the administrator sign-in available after the sign-in throws", async () => {
    const auth = continuation(["report.export"]);
    auth.signIn.mockImplementation(() => {
      throw new Error("offline");
    });
    const { screen } = await mount(server(refusedCase(1100, NAMES_DESCRIPTION)), auth.value);
    const details = await openDetails(screen);
    action(details).click();
    await screen.updateComplete;
    expect(auth.signIn).toHaveBeenCalledOnce();
    expect(action(details).disabled).toBe(false);
    expect(action(details)).toHaveProperty("loading", false);
  });

  it("counts the description in characters, as the library does, not in UTF-16 units", async () => {
    const request = server(refusedCase(1100, NAMES_DESCRIPTION));
    const { screen } = await mount(request, continuation(["fiscal.remedy"]).value);
    const details = await openDetails(screen);
    const area = field(details).shadowRoot!.querySelector("textarea")!;
    expect(area.hasAttribute("maxlength")).toBe(false);
    await type(screen, details, "🍷".repeat(501));
    action(details).click();
    await screen.updateComplete;
    expect((field(details) as unknown as { error: string }).error).toBe(
      "Keep the description to 500 characters.",
    );
    expect(remedyCalls(request)).toHaveLength(0);

    const exactly = "🍷".repeat(500);
    expect(exactly.length).toBe(1000);
    await type(screen, details, exactly);
    expect((field(details) as unknown as { error: string }).error).toBe("");
    action(details).click();
    await vi.waitFor(() => expect(remedyCalls(request)).toHaveLength(1));
    expect(remedyCalls(request)[0]![2]).toMatchObject({ facts: { description: exactly } });
  });

  it("words every refusal the remedy route can give, in English and in Spanish", () => {
    for (const code of Object.keys(REMEDY_REFUSALS) as RemedyRefusal[]) {
      expect(REFUSAL_WORDS[code], code).toBeDefined();
      setLocale("en");
      const english = t(REFUSAL_WORDS[code]);
      setLocale("es");
      const spanish = t(REFUSAL_WORDS[code]);
      expect(english, code).toMatch(/\.$/);
      expect(spanish, code).toMatch(/\.$/);
      expect(spanish, code).not.toBe(english);
    }
  });
});
