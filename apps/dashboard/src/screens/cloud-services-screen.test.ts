import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { DashboardApi } from "../api/client.js";
import { CloudServicesScreen } from "./cloud-services-screen.js";
afterEach(cleanupWidgets);
const requestId = "11111111-1111-4111-8111-111111111111",
  organisationId = "22222222-2222-4222-8222-222222222222",
  legalBusinessId = "33333333-3333-4333-8333-333333333333";
async function flush(el: CloudServicesScreen) {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
function click(el: CloudServicesScreen, id: string) {
  el.shadowRoot!.querySelector<HTMLElement>(`#${id}`)!.click();
}
it("offers explicit start, check and final confirmation; uses the offered business and separates service configuration", async () => {
  setLocale("en");
  const calls: { url: string; body: unknown }[] = [];
  const state = {
    state: "not_connected",
    configured: true,
    isPrimary: true,
    code: "",
    requestId,
    organisationId,
    legalBusinessId,
    organisationName: "Café Sol",
    legalBusinessName: "Sol SL",
    openCloudUrl: `https://cloud.example/connect#request=${requestId}`,
    expiresAt: "2099-01-01T12:00:00Z",
  };
  const api = new DashboardApi("", async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).endsWith("/start")) {
      state.state = "awaiting_cloud";
      state.code = "12345678";
    }
    if (String(url).endsWith("/check")) state.state = "awaiting_local";
    if (String(url).endsWith("/complete")) state.state = "complete";
    return Response.json({ ...state });
  });
  const { el, host } = await mountWidget<CloudServicesScreen>(
    "dashboard-cloud-services-screen",
    { api },
    "light",
  );
  await flush(el);
  expect(calls.map((c) => c.url)).toEqual(["/management-api/cloud/status"]);
  click(el, "connect");
  await flush(el);
  await expect.poll(() => el.shadowRoot!.textContent).toContain("12345678");
  const link = el.shadowRoot!.querySelector("a")!;
  expect(link.href).toBe(state.openCloudUrl);
  expect(link.rel).toBe("noopener noreferrer");
  expect(link.target).toBe("_blank");
  expect(calls.some((c) => c.url.endsWith("/complete"))).toBe(false);
  click(el, "check");
  await flush(el);
  await expect.poll(() => el.shadowRoot!.textContent).toContain("Sol SL");
  expect(calls.some((c) => c.url.endsWith("/complete"))).toBe(false);
  click(el, "confirm");
  await flush(el);
  await expect.poll(() => el.shadowRoot!.textContent).toContain("Connected");
  expect(calls.at(-1)).toEqual({
    url: "/management-api/cloud/complete",
    body: { requestId, organisationId, legalBusinessId },
  });
  expect(el.shadowRoot!.textContent).toContain("Connected");
  expect(el.shadowRoot!.textContent).toContain("Remote access");
  expect(el.shadowRoot!.textContent).toContain("Not configured");
  await expectNoA11yViolations(host);
});
it("shows Spanish refusal and permits an explicit retry without automatic writes", async () => {
  setLocale("es");
  let failure = true;
  let calls = 0;
  const api = new DashboardApi("", async () => {
    calls++;
    return failure
      ? Response.json({ error: { code: "cloud.unavailable", params: {} } }, { status: 503 })
      : Response.json({ state: "not_connected", configured: true, isPrimary: false, code: "" });
  });
  const { el, host } = await mountWidget<CloudServicesScreen>(
    "dashboard-cloud-services-screen",
    { api },
    "dark",
  );
  await flush(el);
  expect(el.shadowRoot!.textContent).toContain("Cloud");
  expect(calls).toBe(1);
  failure = false;
  click(el, "retry");
  await flush(el);
  expect(calls).toBe(2);
  expect(el.shadowRoot!.querySelector("#connect")).toBeNull();
  await expectNoA11yViolations(host);
});
it("ignores a delayed reply after removal and reloads when the screen is reconnected", async () => {
  setLocale("en");
  let release!: (response: Response) => void;
  let calls = 0;
  const api = new DashboardApi("", async () => {
    calls++;
    if (calls === 1)
      return new Promise<Response>((r) => {
        release = r;
      });
    return Response.json({ state: "not_connected", configured: false, isPrimary: false, code: "" });
  });
  const { el, host } = await mountWidget<CloudServicesScreen>("dashboard-cloud-services-screen", {
    api,
  });
  el.remove();
  host.appendChild(el);
  release(
    Response.json({
      state: "complete",
      configured: true,
      isPrimary: true,
      code: "",
      legalBusinessName: "Old account",
    }),
  );
  await expect.poll(() => el.shadowRoot!.textContent).toContain("Cloud services are not available");
  expect(el.shadowRoot!.textContent).not.toContain("Old account");
  expect(calls).toBe(2);
});
it("keeps Start again available after an unavailable request and a later network failure", async () => {
  setLocale("en");
  let checks = 0;
  const api = new DashboardApi("", async (url) => {
    if (String(url).endsWith("/check"))
      return Response.json(
        {
          error: {
            code: ++checks === 1 ? "cloud.request_unavailable" : "cloud.unavailable",
            params: {},
          },
        },
        { status: 409 },
      );
    return Response.json({
      state: "awaiting_cloud",
      configured: true,
      isPrimary: true,
      requestId,
      code: "12345678",
      expiresAt: "2099-01-01T12:00:00Z",
    });
  });
  const { el } = await mountWidget<CloudServicesScreen>("dashboard-cloud-services-screen", { api });
  await expect.poll(() => el.shadowRoot!.querySelector("#check")).not.toBeNull();
  click(el, "check");
  await expect.poll(() => el.shadowRoot!.querySelector("#restart")).not.toBeNull();
  click(el, "check");
  await expect.poll(() => checks).toBe(2);
  await flush(el);
  expect(el.shadowRoot!.querySelector("#restart")).not.toBeNull();
});

for (const locale of ["en", "es"] as const)
  it(`${locale} shows independent service health and explicitly confirms stopping Cloud access`, async () => {
    setLocale(locale);
    const calls: string[] = [];
    let lost = true;
    const state = {
      state: "complete",
      configured: true,
      isPrimary: true,
      code: "",
      legalBusinessName: "Sol SL",
      installation: {
        state: "active",
        revision: 2,
        lastContactAt: new Date().toISOString(),
        leaseExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        services: [
          {
            service: "remote_access",
            state: "ready",
            health: "healthy",
            failure: null,
            observedAt: new Date().toISOString(),
          },
          {
            service: "continuous_backup",
            state: "unconfigured",
            health: "unknown",
            failure: null,
            observedAt: null,
          },
          {
            service: "retained_snapshots",
            state: "failed",
            health: "failed",
            failure: "storage",
            observedAt: new Date().toISOString(),
          },
        ],
      },
    };
    const api = new DashboardApi("", async (url) => {
      calls.push(String(url));
      if (String(url).endsWith("/revoke")) {
        if (lost) {
          lost = false;
          return Response.json(
            { error: { code: "cloud.unavailable", params: {} } },
            { status: 503 },
          );
        }
        state.installation.state = "revoked";
      }
      return Response.json(state);
    });
    const { el, host } = await mountWidget<CloudServicesScreen>("dashboard-cloud-services-screen", {
      api,
    });
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain(locale === "en" ? "Working" : "Funcionando");
    expect(el.shadowRoot!.textContent).toContain(
      locale === "en" ? "Not configured" : "Sin configurar",
    );
    click(el, "stop-access");
    await flush(el);
    expect(calls.filter((v) => v.endsWith("/revoke"))).toHaveLength(0);
    click(el, "cancel-stop");
    await flush(el);
    expect(el.shadowRoot!.querySelector("#confirm-stop")).toBeNull();
    click(el, "stop-access");
    await flush(el);
    await expectNoA11yViolations(host);
    click(el, "confirm-stop");
    click(el, "confirm-stop");
    await flush(el);
    expect(calls.filter((v) => v.endsWith("/revoke"))).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("#confirm-stop")).not.toBeNull();
    click(el, "confirm-stop");
    await flush(el);
    expect(el.shadowRoot!.textContent).toContain(
      locale === "en" ? "Cloud access stopped" : "Acceso a Cloud detenido",
    );
    expect(el.shadowRoot!.querySelector("#stop-access")).toBeNull();
  });
