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
async function open(value: unknown, connected = status, canManageEmergency = false) {
  const api = new DashboardApi("", async (url) => {
    if (String(url).endsWith("/people")) return Response.json([]);
    if (String(url).endsWith("/code"))
      return Response.json({ error: { code: "cloud.unavailable", params: {} } }, { status: 503 });
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

it("fetches a code only on demand, shows its own address/date and clears it on close and leave", async () => {
  let reads = 0;
  const api = new DashboardApi("", async (url, init) => {
    const path = String(url);
    if (path.endsWith("/code")) {
      reads++;
      expect(init!.method).toBe("POST");
      expect(init!.body).toBe("{}");
      return Response.json({
        asOf: "2026-11-10T12:00:00.000Z",
        code: "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ",
        address: "https://current.example.test/",
        codeIssuedAt: "2026-11-05T09:00:00.000Z",
      });
    }
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
  let pendingCode: ReturnType<DashboardApi["revealCloudEmergencyCode"]> | undefined;
  const reveal = api.revealCloudEmergencyCode.bind(api);
  api.revealCloudEmergencyCode = () => (pendingCode = reveal());
  const { el, host } = await mountWidget<CloudServicesScreen>("dashboard-cloud-services-screen", {
    api,
    canManageEmergency: true,
  });
  const button = (id: string) => el.shadowRoot!.querySelector<HTMLElement>(`#${id}`);
  await expect.poll(() => button("show-emergency-code")).toBeInstanceOf(HTMLElement);
  expect(reads).toBe(0);
  await expect.poll(() => section(el)?.textContent).toContain("Alex");
  expect(
    section(el)!.querySelector("[data-test=emergency-needs-authenticator]")!.textContent,
  ).toContain("Beatrice");
  expect(
    getComputedStyle(section(el)!.querySelector("[data-test=emergency-needs-authenticator]")!)
      .color,
  ).toBe(getComputedStyle(section(el)!.querySelector("dt")!).color);
  button("show-emergency-code")!.click();
  await expect.poll(() => button("hide-emergency-code")).toBeInstanceOf(HTMLElement);
  expect(section(el)!.textContent).toContain("ABCD-EFGH-JKLM-NPQR-STUV-WXYZ");
  expect(section(el)!.querySelector("[data-test=emergency-code] a")!.getAttribute("href")).toBe(
    "https://current.example.test/",
  );
  expect(
    section(el)!.querySelector("[data-test=emergency-code] time")!.getAttribute("datetime"),
  ).toBe("2026-11-05T09:00:00.000Z");
  await expectNoA11yViolations(host);
  button("hide-emergency-code")!.click();
  await el.updateComplete;
  expect(section(el)!.textContent).not.toContain("ABCD-EFGH-JKLM-NPQR-STUV-WXYZ");
  button("show-emergency-code")!.click();
  await expect.poll(() => reads).toBe(2);
  host.remove();
  await pendingCode;
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).not.toContain("ABCD-EFGH-JKLM-NPQR-STUV-WXYZ");
});
it("keeps code replies out of a card whose registration changed while the read waited", async () => {
  let replaced = false,
    entered = false,
    release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const api = new DashboardApi("", async (url) => {
    const path = String(url);
    if (path.endsWith("/code")) {
      entered = true;
      await wait;
      return Response.json({
        code: "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ",
        address: "https://old.example.test/",
        asOf: "2026-11-10T12:00:00.000Z",
        codeIssuedAt: "2026-11-01T09:00:00.000Z",
      });
    }
    if (path.endsWith("/people")) return Response.json([]);
    return Response.json(
      path.endsWith("/emergency")
        ? facts()
        : path.endsWith("/billing")
          ? { billing: { status: "unavailable" }, prices: { status: "unavailable" } }
          : { ...status, registration: { installationId: replaced ? "second" : "first" } },
    );
  });
  let pendingCode: ReturnType<DashboardApi["revealCloudEmergencyCode"]> | undefined;
  const reveal = api.revealCloudEmergencyCode.bind(api);
  api.revealCloudEmergencyCode = () => (pendingCode = reveal());
  try {
    const { el } = await mountWidget<CloudServicesScreen>("dashboard-cloud-services-screen", {
      api,
      canManageEmergency: true,
    });
    await expect
      .poll(() => el.shadowRoot!.querySelector("#show-emergency-code"))
      .toBeInstanceOf(HTMLElement);
    el.shadowRoot!.querySelector<HTMLElement>("#show-emergency-code")!.click();
    await expect.poll(() => entered).toBe(true);
    replaced = true;
    el.shadowRoot!.querySelector<HTMLElement>("#refresh")!.click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("#show-emergency-code")?.hasAttribute("disabled"))
      .toBe(false);
    release();
    await pendingCode;
    await el.updateComplete;
    await expect.poll(() => el.shadowRoot!.querySelector("#hide-emergency-code")).toBeNull();
    expect(el.shadowRoot!.textContent).not.toContain("ABCD-EFGH-JKLM-NPQR-STUV-WXYZ");
  } finally {
    release();
  }
});
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

it("explains when Cloud cannot provide the code yet", async () => {
  const { el } = await open(facts(), status, true);
  await expect
    .poll(() => el.shadowRoot!.querySelector("#show-emergency-code"))
    .toBeInstanceOf(HTMLElement);
  el.shadowRoot!.querySelector<HTMLElement>("#show-emergency-code")!.click();
  await expect
    .poll(() => section(el)?.querySelector('[role="alert"]')?.textContent)
    .toContain("The emergency code could not be read.");
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
