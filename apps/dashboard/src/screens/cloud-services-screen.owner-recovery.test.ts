import { cloudOwnerRecoveryRequest as request } from "../testing/cloud-owner-recovery-request.js";
import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { DashboardApi } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { CloudServicesScreen } from "./cloud-services-screen.js";
const previousLocale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(previousLocale);
});

async function fixture(locale: "en" | "es" = "en", theme: "light" | "dark" = "light") {
  setLocale(locale);
  const calls: { action: string; method: string | undefined; body: unknown }[] = [];
  const status = {
    state: "complete",
    configured: true,
    isPrimary: true,
    isRemote: false,
    environment: "test",
    code: "",
    requestId: "pairing",
    organisationName: "Sun Group",
    legalBusinessName: "Sun Hospitality",
    registration: {
      organisationId: request.organisationId,
      legalBusinessId: request.legalBusinessId,
      venueId: request.venueId,
      installationId: request.installationId as string,
    },
  };
  let answer = async (action: string) =>
    Response.json(
      action === "read"
        ? { requests: [request] }
        : { requestId: request.requestId, state: action === "approve" ? "approved" : "refused" },
    );
  const api = new DashboardApi("", async (url, init) => {
    if (String(url).includes("/owner-recovery/")) {
      const action = String(url).split("/").at(-1)!;
      calls.push({ action, method: init?.method, body: JSON.parse(String(init?.body)) });
      return answer(action);
    }
    if (String(url).endsWith("/status") || String(url).endsWith("/refresh"))
      return Response.json(status);
    return Response.json({ error: { code: "cloud.unavailable", params: {} } }, { status: 503 });
  });
  const mounted = await mountWidget<CloudServicesScreen>(
    "dashboard-cloud-services-screen",
    {
      api,
    },
    theme,
  );
  const find = (id: string) =>
    mounted.el.shadowRoot!.querySelector<HTMLElement>(`#${id}, [id^="${id}-"]`)!;
  return {
    ...mounted,
    calls,
    status,
    find,
    answer: (next: typeof answer) => {
      answer = next;
    },
  };
}
it.each([
  ["en", "light"],
  ["en", "dark"],
  ["es", "light"],
  ["es", "dark"],
] as const)("loads and cancels with accessible identities in %s/%s", async (locale, theme) => {
  const f = await fixture(locale, theme);
  await expect.poll(() => f.find("recovery-load")).not.toBeNull();
  expect(f.calls).toEqual([]);
  await userEvent.click(f.find("recovery-load"));
  await expect.poll(() => f.find("recovery-approve")).not.toBeNull();
  expect(f.calls).toEqual([{ action: "read", method: "POST", body: {} }]);
  for (const value of [
    request.email,
    request.accountId,
    request.venueId,
    "Sun Group",
    "Sun Hospitality",
  ])
    expect(f.el.shadowRoot!.textContent).toContain(value);
  expect(f.find("recovery-refuse").getBoundingClientRect().top).toBeGreaterThanOrEqual(
    f.el.shadowRoot!.querySelector("time")!.getBoundingClientRect().bottom,
  );
  await expectNoA11yViolations(f.host);
  await userEvent.click(f.find("recovery-approve"));
  const dialog = f.find("recovery-dialog");
  await expect.poll(() => dialog.shadowRoot!.querySelector("dialog")?.open).toBe(true);
  expect(dialog.textContent).toContain(request.email);
  expect(dialog.textContent).toContain(request.venueId);
  await expectNoA11yViolations(f.host);
  const closed = new Promise((resolve) =>
    dialog.addEventListener("wt-close", resolve, { once: true }),
  );
  await userEvent.click(f.find("recovery-cancel"));
  await closed;
  expect(f.calls).toHaveLength(1);
  await expectNoA11yViolations(f.host);
});

it.each(["approve", "refuse"] as const)(
  "reports recorded %s and closes before a failed refresh",
  async (action) => {
    const f = await fixture();
    await expect.poll(() => f.find("recovery-load")).not.toBeNull();
    await userEvent.click(f.find("recovery-load"));
    await expect.poll(() => f.find(`recovery-${action}`)).not.toBeNull();
    f.answer(async (name) =>
      name === "read"
        ? Response.json({ error: { code: "cloud.unavailable", params: {} } }, { status: 503 })
        : Response.json({
            requestId: request.requestId,
            state: action === "approve" ? "approved" : "refused",
          }),
    );
    await userEvent.click(f.find(`recovery-${action}`));
    await expect
      .poll(() => f.find("recovery-dialog").shadowRoot!.querySelector("dialog")?.open)
      .toBe(true);
    await userEvent.click(f.find("recovery-confirm"));
    await expect.poll(() => f.calls.length).toBe(3);
    expect(f.calls).toEqual([
      { action: "read", method: "POST", body: {} },
      { action, method: "POST", body: { request } },
      { action: "read", method: "POST", body: {} },
    ]);
    await expect
      .poll(() => f.find("recovery-dialog").shadowRoot!.querySelector("dialog")?.open)
      .toBe(false);
    expect(f.el.shadowRoot!.textContent).toContain(
      action === "approve" ? "Cloud recorded the approval" : "Cloud recorded the refusal",
    );
    await expect.poll(() => f.el.shadowRoot!.textContent).toContain("Try again");
  },
);

it("offers administrator sign-in and an actionable retry for Cloud not ready yet", async () => {
  const f = await fixture("es");
  f.answer(async () =>
    Response.json(
      { error: { code: "cloud.owner_recovery_admin_required", params: {} } },
      { status: 403 },
    ),
  );
  await expect.poll(() => f.find("recovery-load")).not.toBeNull();
  await userEvent.click(f.find("recovery-load"));
  await expect.poll(() => f.find("recovery-sign-in")).not.toBeNull();
  let signIn = 0;
  f.el.addEventListener("admin-sign-in", () => {
    signIn++;
  });
  await userEvent.click(f.find("recovery-sign-in"));
  expect(signIn).toBe(1);
  expect(f.el.shadowRoot!.textContent).toContain("administrador del equipo");
  f.answer(async () =>
    Response.json(
      { error: { code: "cloud.owner_recovery_not_available", params: {} } },
      { status: 409 },
    ),
  );
  await userEvent.click(f.find("recovery-load"));
  await expect.poll(() => f.el.shadowRoot!.textContent).toContain("aún no está disponible");
  expect((f.find("recovery-load") as unknown as { disabled: boolean }).disabled).toBe(false);
});

it.each(["departure", "connection change"] as const)(
  "clears sensitive replies after %s and permits a new load",
  async (change) => {
    const f = await fixture();
    const reads = vi.spyOn(f.el.api, "readCloudOwnerRecovery");
    let release!: (response: Response) => void;
    f.answer(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    await expect.poll(() => f.find("recovery-load")).not.toBeNull();
    await userEvent.click(f.find("recovery-load"));
    await expect.poll(() => f.calls.length).toBe(1);
    f.answer(async () => Response.json({ requests: [] }));
    if (change === "departure") {
      f.el.remove();
      f.host.append(f.el);
    } else {
      f.status.registration.installationId = "77777777-7777-4777-8777-777777777777";
      await userEvent.click(f.find("refresh"));
    }
    await expect
      .poll(() => (f.find("recovery-load") as unknown as { disabled: boolean }).disabled)
      .toBe(false);
    await userEvent.click(f.find("recovery-load"));
    await expect.poll(() => f.el.shadowRoot!.textContent).toContain("no pending recovery requests");
    release(Response.json({ requests: [request] }));
    await reads.mock.results[0]!.value;
    await f.el.updateComplete;
    await expect.poll(() => f.el.shadowRoot!.textContent).not.toContain(request.email);
    expect(f.calls.map((v) => v.action)).toEqual(["read", "read"]);
  },
);

it("keeps administrator sign-in inside a refused decision's modal", async () => {
  const f = await fixture();
  await expect.poll(() => f.find("recovery-load")).not.toBeNull();
  await userEvent.click(f.find("recovery-load"));
  await expect.poll(() => f.find("recovery-approve")).not.toBeNull();
  await userEvent.click(f.find("recovery-approve"));
  await expect
    .poll(() => f.find("recovery-dialog").shadowRoot!.querySelector("dialog")?.open)
    .toBe(true);
  f.answer(async () =>
    Response.json(
      { error: { code: "cloud.owner_recovery_admin_required", params: {} } },
      { status: 403 },
    ),
  );
  await userEvent.click(f.find("recovery-confirm"));
  const dialog = f.find("recovery-dialog");
  await expect.poll(() => dialog.textContent).toContain("A box administrator must sign in");
  await expect.poll(() => dialog.querySelector("#recovery-sign-in")).not.toBeNull();
  let signIn = 0;
  f.el.addEventListener("admin-sign-in", () => {
    signIn++;
  });
  await userEvent.click(dialog.querySelector<HTMLElement>("#recovery-sign-in")!);
  expect(signIn).toBe(1);
});

it("refuses foreign request details before showing saved organisation labels", async () => {
  const f = await fixture();
  f.answer(async () =>
    Response.json({
      requests: [
        {
          ...request,
          email: "foreign@example.test",
          organisationId: "88888888-8888-4888-8888-888888888888",
        },
      ],
    }),
  );
  await expect.poll(() => f.find("recovery-load")).not.toBeNull();
  await userEvent.click(f.find("recovery-load"));
  await expect.poll(() => f.el.shadowRoot!.textContent).toContain("connection details changed");
  expect(f.el.shadowRoot!.textContent).not.toContain("foreign@example.test");
  expect(f.find("recovery-approve")).toBeNull();
});
