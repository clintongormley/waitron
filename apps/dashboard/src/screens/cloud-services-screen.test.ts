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
