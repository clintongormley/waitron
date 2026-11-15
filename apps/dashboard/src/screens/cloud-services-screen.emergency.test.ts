import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { currentLocale, fill, setLocale, t } from "../i18n/t.js";
import { DashboardApi } from "../api/client.js";
import { dashboardQuery } from "../api/live-queries.js";
import { CloudServicesScreen } from "./cloud-services-screen.js";
let locale: string;
beforeEach(() => {
  locale = currentLocale();
  setLocale("en");
});
afterEach(() => {
  setLocale(locale);
  cleanupWidgets();
});
const status = {
  state: "complete",
  configured: true,
  isPrimary: true,
  code: "",
  accountUrl: "https://cloud.test/account",
  registration: { installationId: "first" },
  installation: { state: "active", revision: 1, services: [] },
};
const facts = (monthly = 10005, closedReason: string | null = null, stale = false) => ({
  asOf: "2026-11-10T12:00:00.000Z",
  stale,
  emergency: {
    status: "ready",
    open: closedReason === null,
    closedReason,
    address: "https://emergency.example.test/",
    codeIssuedAt: "2026-11-01T09:00:00.000Z",
  },
  prices: {
    status: "published",
    currency: "EUR",
    taxExclusive: true,
    vatRateBasisPoints: 2100,
    registeredMonthlyCents: 0,
    connectedMonthlyCents: 3000,
    hostedMonthlyCents: monthly,
    hostedDayDivisor: 30,
    revision: 1,
    effectiveFrom: "2026-11-01",
  },
});
async function open(value: unknown, connected = status) {
  const api = new DashboardApi("", async (url) =>
    Response.json(
      String(url).endsWith("/emergency")
        ? value
        : String(url).endsWith("/billing")
          ? { billing: { status: "unavailable" }, prices: { status: "unavailable" } }
          : connected,
    ),
  );
  return mountWidget<CloudServicesScreen>("dashboard-cloud-services-screen", { api });
}
const section = (el: CloudServicesScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cloud-emergency]");
for (const language of ["en", "es"] as const) {
  it(`${language} shows the emergency address, dates and exactly rounded daily price accessibly`, async () => {
    setLocale(language);
    const { el, host } = await open(facts());
    await expect
      .poll(() => section(el)?.querySelector("a")?.getAttribute("href"))
      .toBe("https://emergency.example.test/");
    expect(section(el)!.textContent!.replace(/\s+/g, " ")).toContain(
      fill("cloud.emergency_daily", {
        amount: language === "en" ? "€3.34" : "3,34 €",
        vat: language === "en" ? "21%" : "21 %",
      }),
    );
    expect([...section(el)!.querySelectorAll("time")].map((n) => n.dateTime)).toEqual([
      "2026-11-10T12:00:00.000Z",
      "2026-11-01T09:00:00.000Z",
    ]);
    await expectNoA11yViolations(host);
  });
}
it.each([
  [9000, "€3.00"],
  [10000, "€3.33"],
  [14, "€0.00"],
  [15, "€0.01"],
])("projects monthly %i to daily %s", async (monthly, amount) => {
  const { el } = await open(facts(monthly as number));
  await expect
    .poll(() => section(el)?.textContent)
    .toContain(fill("cloud.emergency_daily", { amount: String(amount), vat: "21%" }));
});
it.each(["setting_off", "level_inactive", "no_payment_method", "not_provisioned"] as const)(
  "explains %s and links to the owner's Cloud account",
  async (reason) => {
    const { el } = await open(facts(9000, reason));
    await expect.poll(() => section(el)?.textContent).toContain(t(`cloud.emergency_${reason}`));
    expect(section(el)!.querySelector('a[href="https://cloud.test/account"]')).not.toBeNull();
  },
);
it("labels old facts as stale and keeps unpublished prices independent of availability", async () => {
  const value = {
    ...facts(9000, null, true),
    prices: { status: "unavailable", reason: "not_published" },
  };
  const { el } = await open(value);
  await expect.poll(() => section(el)?.textContent).toContain(t("cloud.emergency_stale"));
  expect(section(el)!.textContent).toContain(t("cloud.billing_prices_unpublished"));
  expect(section(el)!.textContent).not.toContain("€0.00");
});
it("shows an explicit unavailable message without inventing an emergency link", async () => {
  const { el } = await open({
    asOf: "2026-11-10T12:00:00.000Z",
    stale: false,
    emergency: { status: "unavailable", reason: "state_not_ready" },
    prices: { status: "unavailable", reason: "not_published" },
  });
  await expect.poll(() => section(el)?.textContent).toContain(t("cloud.emergency_unavailable"));
  expect(section(el)!.textContent).toContain(
    "Cloud may not provide emergency hosting for this venue yet.",
  );
  expect(section(el)!.querySelector('a[href="https://emergency.example.test/"]')).toBeNull();
});
it("polls the emergency read passively without database subscriptions", async () => {
  const calls: RequestInit[] = [],
    paths: string[] = [];
  const api = new DashboardApi("", async (url, init) => {
    paths.push(String(url));
    calls.push(init!);
    return Response.json(facts());
  });
  const query = dashboardQuery(api, "getCloudEmergency", []);
  expect(query.dependencies).toEqual([]);
  expect(query.refreshMs).toBe(60000);
  expect(query.quietWhileConnected).toBe(false);
  await query.read();
  await query.read();
  expect(paths).toEqual(["/management-api/cloud/emergency", "/management-api/cloud/emergency"]);
  expect(calls[0]!.method).toBe("GET");
  expect(new Headers(calls[1]!.headers).get("x-waitron-live")).toBe("1");
});

it("clears old registration details while the replacement's read is pending", async () => {
  let replaced = false,
    entered = false,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const api = new DashboardApi("", async (url) => {
    if (String(url).endsWith("/emergency")) {
      if (replaced) {
        entered = true;
        await gate;
      }
      const value = facts();
      if (replaced) value.emergency.address = "https://replacement.example.test/";
      return Response.json(value);
    }
    if (String(url).endsWith("/billing"))
      return Response.json({
        billing: { status: "unavailable" },
        prices: { status: "unavailable" },
      });
    return Response.json({
      ...status,
      registration: { installationId: replaced ? "second" : "first" },
    });
  });
  try {
    const { el } = await mountWidget<CloudServicesScreen>("dashboard-cloud-services-screen", {
      api,
    });
    await expect
      .poll(() => section(el)?.querySelector('a[href="https://emergency.example.test/"]'))
      .toBeInstanceOf(HTMLAnchorElement);
    replaced = true;
    el.shadowRoot!.querySelector<HTMLElement>("#refresh")!.click();
    await expect.poll(() => entered).toBe(true);
    await el.updateComplete;
    expect(section(el)!.querySelector('a[href="https://emergency.example.test/"]')).toBeNull();
    release();
    await expect
      .poll(() => section(el)?.querySelector('a[href="https://replacement.example.test/"]'))
      .toBeInstanceOf(HTMLAnchorElement);
  } finally {
    release();
  }
});
