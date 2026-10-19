import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "lit";
import { currentLocale, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { VERIFACTU_DASHBOARD } from "./index.js";
import type { CertificateCardView } from "./client.js";
import type { AeatCertificateCard } from "./certificate-card.js";

type Installed = NonNullable<CertificateCardView["installed"]>;

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

const states: Array<[string, CertificateCardView, string]> = [
  ["healthy", view({}), "dl"],
  [
    "amber",
    view({ validUntil: "2026-12-01T08:00:00.000Z", daysLeft: 44, stage: "warning" }),
    "[data-test=certificate-status][data-stage=warning]",
  ],
  [
    "red",
    view({ validUntil: "2026-10-31T23:59:00.000Z", daysLeft: 14, stage: "urgent" }),
    "[data-test=certificate-status][data-stage=urgent]",
  ],
  [
    "expired",
    view({ validUntil: "2026-10-24T23:30:00.000Z", daysLeft: -3, stage: "expired" }),
    "[data-test=certificate-status][data-stage=expired]",
  ],
  ["none installed", view(null), "[data-test=certificate-message]"],
  ["not filing", view({}, { filing: false }), "[data-test=certificate-message]"],
];

let locale = "";
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  render(null, host);
  cleanup();
  setLocale(locale);
});

async function card(theme: "light" | "dark", answer: CertificateCardView) {
  await mountThemed("<div></div>", theme);
  const handle = VERIFACTU_DASHBOARD.settingsPanels![0]!.create({
    request: vi.fn(async () => answer) as unknown as DashboardRequest,
  });
  render(handle.render(false), host);
  const el = host.querySelector("dashboard-aeat-certificate-card") as AeatCertificateCard;
  await vi.waitFor(() =>
    expect(el.shadowRoot?.querySelector("[data-state=loaded]")).not.toBeNull(),
  );
  await el.updateComplete;
  return el;
}

describe.each(["light", "dark"] as const)("AEAT certificate card accessibility (%s)", (theme) => {
  test.each(states)("the %s card", async (_name, answer, marker) => {
    const el = await card(theme, answer);
    expect(el.shadowRoot!.querySelector(marker)).not.toBeNull();
    await expectNoA11yViolations(host);
  });
});
