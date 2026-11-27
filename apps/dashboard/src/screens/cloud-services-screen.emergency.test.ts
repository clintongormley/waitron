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
async function open(value: unknown, connected = status, canManageEmergency = false) {
  const api = new DashboardApi("", async (url) => {
    if (String(url).endsWith("/people")) return Response.json([]);
    return Response.json(
      String(url).endsWith("/emergency")
        ? value
        : String(url).endsWith("/billing")
          ? { billing: { status: "unavailable" }, prices: { status: "unavailable" } }
          : connected,
    );
  });
  return mountWidget<CloudServicesScreen>("dashboard-cloud-services-screen", {
    api,
    canManageEmergency,
  });
}
const section = (el: CloudServicesScreen) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-test=cloud-emergency]");

it.each([403, 503])(
  "keeps Cloud facts visible when the separate people read fails with %i",
  async (statusCode) => {
    let displayReads = 0;
    let release!: () => void;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const api = new DashboardApi("", async (url) => {
      const path = String(url);
      if (path.endsWith("/emergency")) {
        displayReads++;
        if (displayReads > 1)
          return Response.json(
            { error: { code: "cloud.unavailable", params: {} } },
            { status: 503 },
          );
      }
      if (path.endsWith("/people")) {
        await wait;
        return Response.json(
          {
            error: {
              code: statusCode === 403 ? "authorization.not_permitted" : "cloud.unavailable",
              params: {},
            },
          },
          { status: statusCode },
        );
      }
      return Response.json(
        path.endsWith("/emergency")
          ? facts()
          : path.endsWith("/billing")
            ? { billing: { status: "unavailable" }, prices: { status: "unavailable" } }
            : status,
      );
    });
    try {
      const { el } = await mountWidget<CloudServicesScreen>("dashboard-cloud-services-screen", {
        api,
        canManageEmergency: true,
      });
      await expect
        .poll(() => section(el)?.querySelector('a[href="https://emergency.example.test/"]'))
        .toBeInstanceOf(HTMLAnchorElement);
      release();
      await expect
        .poll(() => section(el)?.textContent)
        .toContain(
          t(
            statusCode === 403
              ? "cloud.emergency_permission"
              : "cloud.emergency_people_unavailable",
          ),
        );
      expect(
        section(el)!.querySelector('a[href="https://emergency.example.test/"]'),
      ).not.toBeNull();
      expect(displayReads).toBe(1);
    } finally {
      release();
    }
  },
);

it("the card has no Show code and its rows are Cloud address, Authorised users and the two-factor list", async () => {
  const paths: string[] = [];
  const api = new DashboardApi("", async (url) => {
    const path = String(url);
    paths.push(path);
    if (path.endsWith("/people"))
      return Response.json([
        { personId: "a", displayName: "Alex", hasAuthenticator: true },
        { personId: "b", displayName: "Beatrice", hasAuthenticator: false },
      ]);
    return Response.json(
      path.endsWith("/emergency")
        ? facts()
        : path.endsWith("/billing")
          ? { billing: { status: "unavailable" }, prices: { status: "unavailable" } }
          : status,
    );
  });
  const { el, host } = await mountWidget<CloudServicesScreen>("dashboard-cloud-services-screen", {
    api,
    canManageEmergency: true,
  });
  await expect.poll(() => section(el)?.textContent).toContain("Beatrice");
  const card = section(el)!;
  expect(card.querySelector("#show-emergency-code")).toBeNull();
  expect(card.querySelector("#hide-emergency-code")).toBeNull();
  expect(card.textContent).not.toContain("Show code");
  expect(card.textContent).toContain(t("cloud.emergency_first_step"));
  expect([...card.querySelectorAll("dt")].map((n) => n.textContent!.trim())).toEqual([
    t("cloud.emergency_address"),
    t("cloud.emergency_people"),
    t("cloud.emergency_needs_authenticator"),
  ]);
  expect([...card.querySelectorAll("dd")].map((n) => n.textContent!.trim())).toEqual([
    "emergency.example.test",
    "Alex",
    "Beatrice",
  ]);
  expect(card.querySelector("dd a")!.getAttribute("href")).toBe("https://emergency.example.test/");
  expect(paths.some((path) => path.endsWith("/code"))).toBe(false);
  await expectNoA11yViolations(host);
});
for (const language of ["en", "es"] as const) {
  it(`${language} shows the emergency address, check time and exactly rounded daily price accessibly`, async () => {
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
    ]);
    expect([...section(el)!.querySelectorAll("dt")].map((n) => n.textContent)).toEqual([
      t("cloud.emergency_address"),
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
it("a closed card with an address shows the closure and the address row, but no first step", async () => {
  const { el } = await open(facts(9000, "setting_off"));
  await expect.poll(() => section(el)?.textContent).toContain(t("cloud.emergency_setting_off"));
  expect([...section(el)!.querySelectorAll("dt")].map((n) => n.textContent)).toEqual([
    t("cloud.emergency_address"),
  ]);
  expect(section(el)!.querySelector('dd a[href="https://emergency.example.test/"]')).not.toBeNull();
  expect(section(el)!.textContent).not.toContain(t("cloud.emergency_first_step"));
});
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

it("links to the existing recovery-pack dialog on Backups", async () => {
  const { el } = await open(facts(), status, true);
  await expect.poll(() => section(el)).not.toBeNull();
  const link = section(el)!.querySelector<HTMLAnchorElement>(
    'a[href="/backup?recovery-pack=make"]',
  );
  expect(link).not.toBeNull();
  expect(link!.textContent).toContain(t("cloud.emergency_print_pack"));
});

it("spaces Print the recovery pack and Open Cloud account apart as an action row", async () => {
  const { el } = await open(facts(), status, true);
  await expect
    .poll(() => section(el)?.querySelector(`a[href="${status.accountUrl}"]`))
    .toBeTruthy();
  const pack = section(el)!.querySelector<HTMLAnchorElement>(
    'a[href="/backup?recovery-pack=make"]',
  )!;
  const account = section(el)!.querySelector<HTMLAnchorElement>(`a[href="${status.accountUrl}"]`)!;
  const probe = document.createElement("div");
  probe.style.width = "var(--wt-space-3)";
  section(el)!.append(probe);
  const space = probe.getBoundingClientRect().width;
  probe.remove();
  expect(space).toBeGreaterThan(0);
  const first = pack.getBoundingClientRect();
  const second = account.getBoundingClientRect();
  const sameLine = Math.abs(first.top - second.top) < 1;
  const apart = sameLine ? second.left - first.right : second.top - first.bottom;
  expect(apart).toBeGreaterThanOrEqual(space - 0.5);
});
