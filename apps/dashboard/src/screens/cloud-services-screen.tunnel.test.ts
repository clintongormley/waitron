import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { DashboardApi } from "../api/client.js";
import { CloudServicesScreen } from "./cloud-services-screen.js";

afterEach(cleanupWidgets);

for (const [locale, on, off, theme] of [
  [
    "en",
    "On in Settings · connection not checked here",
    "Off in Settings · disconnection not checked here",
    "light",
  ],
  [
    "es",
    "Activado en Ajustes · conexión sin comprobar aquí",
    "Desactivado en Ajustes · desconexión sin comprobar aquí",
    "dark",
  ],
] as const)
  it(`${locale} toggles remote access without stopping Cloud and keeps a refused action retryable`, async () => {
    const previous = currentLocale();
    try {
      setLocale(locale);
      let enabled = true,
        refuse = true;
      let finish!: (response: Response) => void;
      const writes: unknown[] = [];
      const status = () => ({
        state: "complete",
        configured: true,
        isPrimary: true,
        code: "",
        remoteAccessEnabled: enabled,
        installation: { state: "active", revision: 1, services: [] },
      });
      const api = new DashboardApi("", async (url, options) => {
        if (String(url).endsWith("/remote-access")) {
          writes.push(JSON.parse(String(options?.body)));
          if (refuse)
            return Response.json({ error: { code: "cloud.busy", params: {} } }, { status: 409 });
          enabled = !enabled;
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        }
        if (String(url).endsWith("/billing"))
          return Response.json(
            { error: { code: "cloud.unavailable", params: {} } },
            { status: 503 },
          );
        return Response.json(status());
      });
      const { el, host } = await mountWidget<CloudServicesScreen>(
        "dashboard-cloud-services-screen",
        { api },
        theme,
      );
      const button = () =>
        el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>("#remote-access");
      await expect.poll(() => button()).not.toBeNull();
      expect(
        el.shadowRoot!.querySelector("[data-test=remote-access-status]")?.textContent,
      ).toContain(on);
      button()!.click();
      await expect
        .poll(() => el.shadowRoot!.querySelector("[data-test=cloud-error]")?.textContent)
        .toContain(codeMessage("cloud.busy"));
      expect(button()!.disabled).toBe(false);
      refuse = false;
      button()!.click();
      button()!.click();
      await expect.poll(() => writes.length).toBe(2);
      await el.updateComplete;
      expect(button()!.disabled).toBe(true);
      finish(Response.json(status()));
      await expect
        .poll(() => el.shadowRoot!.querySelector("[data-test=remote-access-status]")?.textContent)
        .toContain(off);
      expect(el.shadowRoot!.querySelector("#stop-access")).not.toBeNull();
      button()!.click();
      await expect.poll(() => writes.length).toBe(3);
      finish(Response.json(status()));
      await expect
        .poll(() => el.shadowRoot!.querySelector("[data-test=remote-access-status]")?.textContent)
        .toContain(on);
      expect(writes).toEqual([{ enabled: false }, { enabled: false }, { enabled: true }]);
      await expectNoA11yViolations(host);
    } finally {
      setLocale(previous);
    }
  });

for (const locale of ["en", "es"] as const)
  for (const code of ["cloud.tunnel_unavailable", "cloud.tunnel_conflict"] as const)
    it(`${locale} explains ${code} and keeps the stop confirmation available`, async () => {
      const previous = currentLocale();
      try {
        setLocale(locale);
        const message = codeMessage(code);
        expect(message).not.toContain("cloud.");
        expect(message).not.toBe(
          codeMessage(
            code === "cloud.tunnel_conflict" ? "cloud.tunnel_unavailable" : "cloud.tunnel_conflict",
          ),
        );
        const api = new DashboardApi("", async (url) => {
          if (String(url).endsWith("/refresh"))
            return Response.json({ error: { code, params: {} } }, { status: 503 });
          if (String(url).endsWith("/billing"))
            return Response.json(
              { error: { code: "cloud.unavailable", params: {} } },
              { status: code === "cloud.tunnel_conflict" ? 409 : 422 },
            );
          return Response.json({
            state: "complete",
            configured: true,
            isPrimary: true,
            code: "",
            legalBusinessName: "Test venue",
            installation: { state: "active", revision: 1, services: [] },
          });
        });
        const { el, host } = await mountWidget<CloudServicesScreen>(
          "dashboard-cloud-services-screen",
          { api },
        );
        await expect.poll(() => el.shadowRoot!.querySelector("#refresh")).not.toBeNull();
        el.shadowRoot!.querySelector<HTMLElement>("#refresh")!.click();
        await expect
          .poll(() => el.shadowRoot!.querySelector("[data-test=cloud-error]")?.textContent?.trim())
          .toBe(message);
        expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();
        el.shadowRoot!.querySelector<HTMLElement>("#stop-access")!.click();
        await expect.poll(() => el.shadowRoot!.querySelector("#confirm-stop")).not.toBeNull();
        expect(el.shadowRoot!.querySelector("#cancel-stop")).not.toBeNull();
        await expectNoA11yViolations(host);
      } finally {
        setLocale(previous);
      }
    });

for (const enabled of [false, true])
  it(`reads the saved ${enabled} choice after a failed reply and preserves the refusal`, async () => {
    let saved = !enabled;
    const api = new DashboardApi("", async (url) => {
      if (String(url).endsWith("/remote-access")) {
        saved = enabled;
        if (enabled) throw new TypeError("Lost reply after saving");
        return Response.json(
          { error: { code: "cloud.tunnel_unavailable", params: {} } },
          { status: 422 },
        );
      }
      if (String(url).endsWith("/billing"))
        return Response.json({ error: { code: "cloud.unavailable" } }, { status: 503 });
      return Response.json({
        state: "complete",
        configured: true,
        isPrimary: true,
        code: "",
        remoteAccessEnabled: saved,
        installation: { state: "active", revision: 1, services: [] },
      });
    });
    const { el } = await mountWidget<CloudServicesScreen>("dashboard-cloud-services-screen", {
      api,
    });
    await expect.poll(() => el.shadowRoot!.querySelector("#remote-access")).not.toBeNull();
    el.shadowRoot!.querySelector<HTMLElement>("#remote-access")!.click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=cloud-error]")?.textContent)
      .toContain(codeMessage(enabled ? "connection.failed" : "cloud.tunnel_unavailable"));
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=remote-access-status]")?.textContent)
      .toContain(t(enabled ? "cloud.remote_on" : "cloud.remote_off"));
  });

it("shows remote access off instead of a recent healthy Cloud observation", async () => {
  const api = new DashboardApi("", async () =>
    Response.json({
      state: "complete",
      configured: true,
      isPrimary: true,
      code: "",
      remoteAccessEnabled: false,
      installation: {
        state: "active",
        revision: 1,
        services: [
          {
            service: "remote_access",
            state: "ready",
            health: "healthy",
            failure: null,
            observedAt: new Date().toISOString(),
          },
        ],
      },
    }),
  );
  const { el } = await mountWidget<CloudServicesScreen>("dashboard-cloud-services-screen", { api });
  await expect.poll(() => el.shadowRoot!.querySelector("#remote-access")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("dl")?.textContent).toContain(t("cloud.remote_off"));
  expect(el.shadowRoot!.querySelector("dl")?.textContent).not.toContain(t("cloud.health_healthy"));
});
for (const [isPrimary, state] of [
  [false, "active"],
  [true, "revoked"],
] as const)
  it(`offers no remote access action on ${state} primary=${isPrimary}`, async () => {
    const api = new DashboardApi("", async () =>
      Response.json({
        state: "complete",
        configured: true,
        isPrimary,
        code: "",
        remoteAccessEnabled: true,
        installation: { state, revision: 1, services: [] },
      }),
    );
    const { el } = await mountWidget<CloudServicesScreen>("dashboard-cloud-services-screen", {
      api,
    });
    await expect.poll(() => el.shadowRoot!.querySelector("dl")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#remote-access")).toBeNull();
    expect(el.shadowRoot!.querySelector("#remote-access-heading") === null).toBe(
      state === "revoked",
    );
  });

it("confirms remote off with Stop before disconnecting, while remote on stays direct", async () => {
  let enabled = true;
  const writes: unknown[] = [];
  const status = () => ({
    state: "complete",
    code: "",
    configured: true,
    isPrimary: true,
    isRemote: true,
    remoteAccessEnabled: enabled,
    installation: { state: "active", revision: 1, services: [] },
  });
  const api = new DashboardApi("", async (url, options) => {
    if (String(url).endsWith("/remote-access")) {
      writes.push(JSON.parse(String(options?.body)));
      enabled = !enabled;
    }
    if (String(url).endsWith("/billing"))
      return Response.json({ error: { code: "cloud.unavailable" } }, { status: 503 });
    return Response.json(status());
  });
  const { el, host } = await mountWidget<CloudServicesScreen>("dashboard-cloud-services-screen", {
    api,
  });
  await expect.poll(() => el.shadowRoot!.querySelector("#remote-access")).not.toBeNull();
  const dialog = () =>
    el.shadowRoot!.querySelector<HTMLElement & { open: boolean }>("#remote-off-dialog");
  el.shadowRoot!.querySelector<HTMLElement>("#remote-access")!.click();
  await expect.poll(() => dialog()?.open).toBe(true);
  expect(writes).toEqual([]);
  expect(dialog()!.textContent).toContain(t("cloud.remote_help"));
  await expectNoA11yViolations(host);
  const stopped = new Promise((resolve) =>
    dialog()!.addEventListener("wt-close", resolve, { once: true }),
  );
  el.shadowRoot!.querySelector<HTMLElement>("#remote-off-stop")!.click();
  await stopped;
  expect(writes).toEqual([]);
  el.shadowRoot!.querySelector<HTMLElement>("#remote-access")!.click();
  await expect.poll(() => dialog()?.open).toBe(true);
  const confirmedClose = new Promise((resolve) =>
    dialog()!.addEventListener("wt-close", resolve, { once: true }),
  );
  el.shadowRoot!.querySelector<HTMLElement>("#remote-off-confirm")!.click();
  await confirmedClose;
  await expect.poll(() => writes).toEqual([{ enabled: false }]);
  await expect
    .poll(() => el.shadowRoot!.querySelector("[data-test=remote-access-status]")?.textContent)
    .toContain(t("cloud.remote_off"));
  el.shadowRoot!.querySelector<HTMLElement>("#remote-access")!.click();
  await expect.poll(() => writes).toEqual([{ enabled: false }, { enabled: true }]);
  expect(dialog()!.open).toBe(false);
});
