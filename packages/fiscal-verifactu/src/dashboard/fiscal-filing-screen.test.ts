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
import type { FilingCaseView, FilingOverviewAnswer } from "../filing-overview-types.js";

const OURS = "a".repeat(64);
const PREVIOUS = "b".repeat(64);
const THEIRS = "c".repeat(64);

function conflictCase(registroId: string, openedAt: string): FilingCaseView {
  return {
    registroId,
    cause: "fiscal.huella_divergente",
    openedAt,
    evidence: { codigo: 3000, mensaje: "Registro de facturación duplicado.", csv: null },
    record: {
      tipoRegistro: "alta",
      idEmisorFactura: "B12345678",
      numSerieFactura: "T1/41",
      fechaExpedicionFactura: "03-11-2026",
      tipoFactura: "F2",
      importeTotal: "12.10",
      cuotaTotal: "2.10",
      huella: OURS,
      anteriorHuella: PREVIOUS,
      fechaHoraHusoGenRegistro: "2026-11-03T12:00:00+01:00",
      numeroInstalacion: "BOX-01",
    },
    submission: {
      estado: "Incorrecto",
      codigoError: "3000",
      mensajeError: "Registro de facturación duplicado.",
      enviadoEn: "2026-11-03T11:01:00.000Z",
    },
    conflicts: [
      {
        attempt: 1,
        cause: "fiscal.huella_divergente",
        recordedAt: "2026-11-03T11:02:00.000Z",
        line: {
          IDFactura: {
            IDEmisorFactura: "B12345678",
            NumSerieFactura: "T1/41",
            FechaExpedicionFactura: "03-11-2026",
          },
          EstadoRegistro: "Incorrecto",
          CodigoErrorRegistro: 3000,
          DescripcionErrorRegistro: "Registro de facturación duplicado.",
          RegistroDuplicado: null,
        },
        comparison: { kind: "lookup-mismatch", storedFingerprint: THEIRS, storedSystem: null },
      },
    ],
    lookups: [],
    heldBehind: 3,
  };
}

function overview(over: Partial<FilingOverviewAnswer> = {}): FilingOverviewAnswer {
  return {
    readAt: "2026-11-10T09:30:00.000Z",
    progress: {
      counts: {
        pendiente: 4,
        enviando: 1,
        aceptado: 120,
        aceptado_con_errores: 2,
        rechazado: 5,
        detenido: 3,
        retenido: 6,
      },
      oldestWaitingGeneratedAt: "2026-11-10T08:00:00.000Z",
      lastConfirmedAt: "2026-11-10T09:00:00.000Z",
    },
    cases: [conflictCase("rec-1", "2026-11-03T11:02:00.000Z")],
    totalCases: 1,
    heldWithoutCase: 7,
    activeConflicts: [
      {
        invoiceNumber: "T1/41",
        installationName: "BOX-01",
        cause: "fiscal.huella_divergente",
        observedAt: "2026-11-03T11:02:00.000Z",
        evidence: {
          invoice: {
            IDEmisorFactura: "B12345678",
            NumSerieFactura: "T1/41",
            FechaExpedicionFactura: "03-11-2026",
          },
          state: "Correcta",
          fingerprint: THEIRS,
          system: null,
        },
      },
    ],
    filing: true,
    awaitingCertificate: false,
    ...over,
  };
}

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
    expect(line).toContain("Correcta");
    expect(line).toContain(THEIRS);

    const none = await mount(vi.fn(async () => overview({ activeConflicts: [] })));
    expect(none.screen.shadowRoot!.querySelector("[data-test=conflict]")).toBeNull();
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
});
