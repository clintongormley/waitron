import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "lit";
import { currentLocale, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { VERIFACTU_DASHBOARD } from "./index.js";
import type { CertificateCardView } from "./client.js";
import type { AeatCertificateCard } from "./certificate-card.js";

type Installed = NonNullable<CertificateCardView["installed"]>;
type Settle = { resolve(value: CertificateCardView): void; reject(reason: unknown): void };

const healthy: Installed = {
  kind: "representante",
  organisation: "BAR LUCÍA S.L.",
  taxId: "B12345678",
  taxIdMatches: true,
  issuer: "AC Representación (FNMT-RCM)",
  validFrom: "2025-10-03T08:00:00.000Z",
  validUntil: "2027-10-03T08:00:00.000Z",
  daysLeft: 350,
  stage: null,
  installedAt: "2025-11-14T09:12:00.000Z",
  source: "setup",
  installedByName: null,
  lastAcceptedAt: "2026-10-18T11:02:00.000Z",
};

function view(installed: Partial<Installed> | null, over: Partial<CertificateCardView> = {}) {
  return {
    filing: true,
    revision: installed === null ? null : "rev-1",
    timeZone: "Europe/Madrid",
    installed: installed === null ? null : { ...healthy, ...installed },
    ...over,
  } satisfies CertificateCardView;
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
});

async function mount(
  answer: () => Promise<unknown>,
  readOnly = false,
): Promise<{ card: AeatCertificateCard; request: ReturnType<typeof vi.fn> }> {
  const request = vi.fn(answer);
  const handle = VERIFACTU_DASHBOARD.settingsPanels![0]!.create({
    request: request as unknown as DashboardRequest,
  });
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  render(handle.render(readOnly), host);
  const card = host.querySelector("dashboard-aeat-certificate-card") as AeatCertificateCard;
  await vi.waitFor(() =>
    expect(card.shadowRoot?.querySelector("[data-state]:not([data-state=loading])")).not.toBeNull(),
  );
  await card.updateComplete;
  return { card, request };
}

function text(card: AeatCertificateCard, selector: string): string {
  const el = card.shadowRoot!.querySelector(selector);
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function rows(card: AeatCertificateCard): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dd of card.shadowRoot!.querySelectorAll("dd[data-test]")) {
    const label = (dd.previousElementSibling?.textContent ?? "").trim();
    out[label] = (dd.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  return out;
}

function button(card: AeatCertificateCard): HTMLElement | null {
  return card.shadowRoot!.querySelector("wt-button[data-test=certificate-action]");
}

describe("dashboard-aeat-certificate-card", () => {
  it("shows every row for a healthy certificate", async () => {
    const { card, request } = await mount(async () => view({}));

    expect(request).toHaveBeenCalledWith("/management-api/fiscal-certificate", "GET", undefined, {
      passive: true,
    });
    expect(text(card, "h2")).toBe("AEAT certificate");
    expect(rows(card)).toEqual({
      "Issued to": "BAR LUCÍA S.L.",
      "Tax ID": "B12345678 · matches the business",
      Type: "Representative (representante)",
      "Issued by": "AC Representación (FNMT-RCM)",
      "Valid from": "3 Oct 2025",
      "Valid until": "3 Oct 2027 · 350 days left",
      Installed: "14 Nov 2025, 10:12 · during setup",
      "Last accepted filing": "18 Oct 2026, 13:02",
    });
    expect(card.shadowRoot!.querySelector("[data-test=certificate-status]")).toBeNull();
    expect(button(card)?.textContent?.trim()).toBe("Replace certificate");
    expect(button(card)?.getAttribute("variant")).toBe("secondary");
  });

  it("names the installer, says when no filing has been accepted, and flags another tax ID", async () => {
    const { card } = await mount(async () =>
      view({
        kind: "sello",
        taxIdMatches: false,
        source: "dashboard",
        installedByName: "Marta Soler",
        lastAcceptedAt: null,
      }),
    );
    const r = rows(card);
    expect(r.Type).toBe("Company seal (sello)");
    expect(r["Tax ID"]).toBe("B12345678 · does not match the business");
    expect(r.Installed).toBe("14 Nov 2025, 10:12 · Marta Soler");
    expect(r["Last accepted filing"]).toBe("None since it was installed");
  });

  it("says not recorded when the dashboard install's person is gone", async () => {
    const { card } = await mount(async () => view({ source: "dashboard", installedByName: null }));
    expect(rows(card).Installed).toBe("14 Nov 2025, 10:12 · not recorded");
  });

  it("shows the amber line by type", async () => {
    const amber = {
      validUntil: "2026-12-01T08:00:00.000Z",
      daysLeft: 44,
      stage: "warning",
    } as const;
    const representative = await mount(async () => view(amber));
    expect(text(representative.card, "[data-test=certificate-status]")).toBe(
      "This certificate expires on 1 Dec 2026. Get the new one from FNMT before then.",
    );
    expect(
      representative.card
        .shadowRoot!.querySelector("[data-test=certificate-status]")!
        .getAttribute("data-stage"),
    ).toBe("warning");
    expect(rows(representative.card)["Valid until"]).toBe("1 Dec 2026 · 44 days left");

    const seal = await mount(async () => view({ ...amber, kind: "sello" }));
    expect(text(seal.card, "[data-test=certificate-status]")).toBe(
      "This certificate expires on 1 Dec 2026. Ask FNMT for the new one now: a new seal can take weeks.",
    );
  });

  it("shows the red line with the days", async () => {
    const { card } = await mount(async () =>
      view({ validUntil: "2026-10-31T23:59:00.000Z", daysLeft: 14, stage: "urgent" }),
    );
    const status = card.shadowRoot!.querySelector("[data-test=certificate-status]")!;
    expect(status.getAttribute("data-stage")).toBe("urgent");
    expect(text(card, "[data-test=certificate-status]")).toBe(
      "This certificate expires in 14 days. After that, fiscal records wait until a new one is installed. Sales are not affected.",
    );
    expect(button(card)?.getAttribute("variant")).toBe("primary");
  });

  it("shows the expired line", async () => {
    const { card } = await mount(async () =>
      view({ validUntil: "2026-10-24T23:30:00.000Z", daysLeft: -3, stage: "expired" }),
    );
    expect(text(card, "[data-test=certificate-status]")).toBe(
      "This certificate expired on 25 Oct 2026. Sales continue, but fiscal records wait until you install a new one.",
    );
    expect(rows(card)["Valid until"]).toBe("Expired on 25 Oct 2026");
    expect(button(card)?.getAttribute("variant")).toBe("primary");
  });

  it("says Expires tomorrow, 01:30 the day before and Expires today, 01:30 on the day", async () => {
    // E9: 01:30 Madrid on 25 Oct 2026 is 23:30 UTC on the 24th.
    const validUntil = "2026-10-24T23:30:00.000Z";
    const before = await mount(async () => view({ validUntil, daysLeft: 1, stage: "urgent" }));
    expect(rows(before.card)["Valid until"]).toBe("25 Oct 2026 · Expires tomorrow, 01:30");

    const onTheDay = await mount(async () => view({ validUntil, daysLeft: 0, stage: "urgent" }));
    expect(rows(onTheDay.card)["Valid until"]).toBe("25 Oct 2026 · Expires today, 01:30");

    const utc = await mount(async () =>
      view({ validUntil, daysLeft: 0, stage: "urgent" }, { timeZone: "UTC" }),
    );
    expect(rows(utc.card)["Valid until"]).toBe("24 Oct 2026 · Expires today, 23:30");
  });

  it('shows "not shown on the certificate" and "—" when the certificate carries neither', async () => {
    const { card } = await mount(async () =>
      view({ organisation: null, taxId: null, taxIdMatches: null, issuer: null }),
    );
    const r = rows(card);
    expect(r["Issued to"]).toBe("—");
    expect(r["Tax ID"]).toBe("not shown on the certificate");
    expect(r["Issued by"]).toBe("—");
  });

  it("says no certificate is installed and offers Install certificate", async () => {
    const { card } = await mount(async () => view(null));
    expect(text(card, "[data-test=certificate-message]")).toBe(
      "No certificate installed. Fiscal records wait until one is.",
    );
    expect(card.shadowRoot!.querySelector("dl")).toBeNull();
    expect(button(card)?.textContent?.trim()).toBe("Install certificate");
  });

  it("says the box needs none and offers no button when filing is false", async () => {
    const { card } = await mount(async () => view({}, { filing: false }));
    expect(text(card, "[data-test=certificate-message]")).toBe(
      "This box does not send records to AEAT, so it needs no certificate.",
    );
    expect(card.shadowRoot!.querySelector("dl")).toBeNull();
    expect(button(card)).toBeNull();
  });

  it('shows "Installed: not recorded" with Replace certificate when the vault has one but no row', async () => {
    const { card } = await mount(async () => view(null, { revision: "rev-1" }));
    expect(rows(card)).toEqual({ Installed: "not recorded" });
    expect(button(card)?.textContent?.trim()).toBe("Replace certificate");
  });

  it("offers no button when read-only", async () => {
    const healthyCard = await mount(async () => view({}), true);
    expect(rows(healthyCard.card)["Issued to"]).toBe("BAR LUCÍA S.L.");
    expect(button(healthyCard.card)).toBeNull();

    const empty = await mount(async () => view(null), true);
    expect(button(empty.card)).toBeNull();
  });

  it("shows a load failure, not an empty card, when the read fails", async () => {
    const { card } = await mount(async () => {
      throw { code: "server.internal", status: 500 };
    });
    const failure = card.shadowRoot!.querySelector("[data-test=certificate-load-error]");
    expect(failure?.getAttribute("role")).toBe("alert");
    expect(text(card, "[data-test=certificate-load-error]")).toBe(
      "Something went wrong, try again",
    );
    expect(card.shadowRoot!.querySelector("dl")).toBeNull();
    expect(card.shadowRoot!.querySelector("[data-test=certificate-message]")).toBeNull();
    expect(button(card)).toBeNull();
  });

  it.each([
    ["answers", (settle: Settle) => settle.resolve(view({}))],
    ["fails", (settle: Settle) => settle.reject({ code: "server.internal" })],
  ])("ignores a read that %s after the card left the page", async (_, finish) => {
    const settle = {} as Settle;
    const request = vi.fn(
      () =>
        new Promise<CertificateCardView>((resolve, reject) => {
          settle.resolve = resolve;
          settle.reject = reject;
        }),
    );
    const handle = VERIFACTU_DASHBOARD.settingsPanels![0]!.create({
      request: request as unknown as DashboardRequest,
    });
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    render(handle.render(), host);
    const card = host.querySelector("dashboard-aeat-certificate-card") as AeatCertificateCard;
    await card.updateComplete;
    card.remove();
    finish(settle);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await card.updateComplete;
    expect(card.shadowRoot!.querySelector("[data-state]")!.getAttribute("data-state")).toBe(
      "loading",
    );
  });

  it("repaints in the new language when the language changes while it is shown", async () => {
    const { card } = await mount(async () => view({}));
    setLocale("es-ES");
    await card.updateComplete;
    expect(text(card, "h2")).toBe("Certificado de la AEAT");
    expect(rows(card)["Válido hasta"]).toBe("3 oct 2027 · quedan 350 días");
  });

  it("renders in Spanish", async () => {
    setLocale("es-ES");
    const { card } = await mount(async () => view({}));
    expect(text(card, "h2")).toBe("Certificado de la AEAT");
    expect(rows(card)).toEqual({
      "Emitido a": "BAR LUCÍA S.L.",
      NIF: "B12345678 · coincide con el negocio",
      Tipo: "Representante",
      "Emitido por": "AC Representación (FNMT-RCM)",
      "Válido desde": "3 oct 2025",
      "Válido hasta": "3 oct 2027 · quedan 350 días",
      Instalado: "14 nov 2025, 10:12 · durante la configuración",
      "Último envío aceptado": "18 oct 2026, 13:02",
    });
    expect(button(card)?.textContent?.trim()).toBe("Sustituir certificado");
  });
});
