import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import {
  codeMessage,
  currentLocale,
  formatIsoMinute,
  setLocale,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
import { VERIFACTU_DASHBOARD } from "./index.js";
import type { FiscalFilingScreen } from "./fiscal-filing-screen.js";
import type { FilingOverviewAnswer } from "../filing-overview-types.js";
import {
  OURS,
  PREVIOUS,
  THEIRS,
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
): Promise<{ screen: FiscalFilingScreen; request: ReturnType<typeof vi.fn> }> {
  const entry = VERIFACTU_DASHBOARD.moreScreens!.find((s) => s.screen.id === "fiscal-filing")!;
  const handle = entry.create({ request: request as unknown as DashboardRequest });
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
    expect(text(screen, "[data-test=conflict]")).toContain("recovery key");
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
      "La AEAT tiene la factura T1/41 como aceptada, y sus datos no coinciden con el registro de este equipo.",
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
      "La AEAT tiene la factura T1/99; este equipo no la emitió.",
    );
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
      "Se detectó al consultar la factura en la AEAT. La consulta no cambia cómo se envía este registro. Mientras el conflicto siga activo, este equipo no emite facturas.",
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
    const amounts = tipoRegistro === "anulacion" ? { importeTotal: null, cuotaTotal: null } : {};
    const found = { ...base, record: { ...base.record, tipoRegistro, tipoFactura, ...amounts } };
    const { screen } = await mount(vi.fn(async () => overview({ cases: [found] })));
    const details = await openDetails(screen);
    expect(flat(details.querySelector("[data-test=kind] dd"))).toBe(line);
    expect(details.querySelector("[data-test=total]") === null).toBe(tipoRegistro === "anulacion");
  });

  it("says once that Waitron cannot correct the records while there are cases, and not without", async () => {
    const { screen } = await mount(vi.fn(async () => overview()));
    expect(screen.shadowRoot!.querySelectorAll("[data-test=no-correction]")).toHaveLength(1);
    expect(text(screen, "[data-test=cases] [data-test=no-correction]")).toBe(
      "Waitron cannot correct these records yet.",
    );

    const { screen: empty } = await mount(
      vi.fn(async () => overview({ cases: [], totalCases: 0 })),
    );
    expect(empty.shadowRoot!.querySelector("[data-test=no-correction]")).toBeNull();
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
