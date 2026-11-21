import { afterEach, expect, it } from "vitest";
import type { WtAddressLookup } from "@waitron/ui";
import { userEvent } from "vitest/browser";
import { venue, wizardApi } from "../test/first-setup-browser.js";
import { es } from "./i18n/strings.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { dispatchProvisionRequested, dispatchSetupGoto, dispatchSetupPatch } from "./events.js";
import { SetupApp } from "./setup-app.js";

const route = "/setup-api/cloud/sign-in/address-lookup";
const tab = "bd185bdc-b7dd-4abb-991a-a9c3d613d38e";
const suggestion = "Calle Mayor 1, Madrid";
const adminDisplay = {
  firstNames: venue.admin.firstNames,
  lastNames: venue.admin.lastNames,
  displayName: venue.admin.displayName,
  email: venue.admin.email,
};
let app: SetupApp | undefined;
const locale = currentLocale();
afterEach(() => {
  app?.remove();
  for (const key of ["tab", "return", "result", "signed-in"])
    sessionStorage.removeItem("waitron-setup-cloud-" + key);
  setLocale(locale);
});

it.each(["missing", "partial"])(
  "keeps manual text after a %s Cloud address draft and starts a new search",
  async (draft) => {
    sessionStorage.setItem("waitron-setup-cloud-tab", tab);
    sessionStorage.setItem(
      "waitron-setup-cloud-return",
      JSON.stringify({ mode: "prepare", locale: "en", admin: adminDisplay }),
    );
    sessionStorage.setItem("waitron-setup-cloud-result", "signed-in");
    const { api, requests } = wizardApi({
      intercept: (path, body) => {
        if (path === "/setup-api/status")
          return Response.json({
            provisioned: false,
            environment: "preproduction",
            needs: ["venue"],
            cloudSignInAvailable: true,
          });
        if (path !== route) return;
        const { kind } = body as { kind: string };
        if (kind === "available") return Response.json({ available: true });
        if (kind === "suggest") return Response.json({ candidates: [{ text: suggestion }] });
        if (
          requests.filter(
            (r) => r.path === route && (r.body as { kind: string }).kind === "validate",
          ).length === 1
        )
          return Response.json(
            draft === "missing"
              ? {}
              : {
                  fields: {
                    addressLine1: "",
                    addressLine2: null,
                    postalCode: "",
                    city: "Madrid",
                    province: "Madrid",
                    countryCode: "ES",
                  },
                },
          );
        return Response.json({
          fields: {
            addressLine1: "Calle Mayor 1",
            addressLine2: null,
            postalCode: "28013",
            city: "Madrid",
            province: "Madrid",
            countryCode: "ES",
          },
        });
      },
    });
    app = new SetupApp();
    app.api = api;
    document.body.append(app);
    const screen = (name: string) => app!.shadowRoot?.querySelector(`[data-test=screen-${name}]`);
    await expect.poll(() => screen("venue")).not.toBeNull();
    const form = screen("venue")!.shadowRoot!;
    const widget = form.querySelector<WtAddressLookup>("[data-test=address-lookup]")!;
    const street = form.querySelector("[data-test=addressLine1]") as HTMLElement & {
      value: string;
    };
    const postal = form.querySelector("[data-test=postalCode]") as HTMLInputElement;
    await expect.poll(() => widget.hidden).toBe(false);
    for (const [field, value] of [
      [street, "Manual address"],
      [postal, "28001"],
    ] as const)
      field.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value },
          bubbles: true,
          composed: true,
        }),
      );
    widget.delay = 0;
    const input = widget.shadowRoot!.querySelector("input")!;
    const option = () => widget.shadowRoot!.querySelector('[role="option"]');
    const search = async (query: string) => {
      input.value = query;
      input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await expect.poll(() => option()?.textContent).toContain(suggestion);
    };
    await search("Calle");
    expect(option()?.textContent).toContain("Google Maps");
    await search("Calle Mayor");
    await userEvent.click(option()!);
    await expect
      .poll(() => widget.shadowRoot!.querySelector('[role="status"]')?.textContent)
      .toContain("Type the address below");
    expect(street.value).toBe("Manual address");
    expect(postal.value).toBe("28001");

    await search("Calle Mayor 1");
    await userEvent.click(option()!);
    await expect.poll(() => street.value).toBe("Calle Mayor 1");
    expect(postal.value).toBe("28013");
    expect((form.querySelector("[data-test=province]") as HTMLInputElement).value).toBe("28");

    const bodies = requests.filter((r) => r.path === route).map((r) => r.body);
    const first = (bodies[1] as { workflowId: string }).workflowId;
    const second = (bodies[4] as { workflowId: string }).workflowId;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
    expect(bodies).toEqual([
      { tab, kind: "available" },
      { tab, kind: "suggest", workflowId: first, query: "Calle", language: "en" },
      { tab, kind: "suggest", workflowId: first, query: "Calle Mayor", language: "en" },
      { tab, kind: "validate", workflowId: first, selectedText: suggestion },
      { tab, kind: "suggest", workflowId: second, query: "Calle Mayor 1", language: "en" },
      { tab, kind: "validate", workflowId: second, selectedText: suggestion },
    ]);
  },
);

async function openCloudEmailStep() {
  sessionStorage.setItem(
    "waitron-setup-cloud-return",
    JSON.stringify({ mode: "prepare", locale: "en", admin: adminDisplay }),
  );
  sessionStorage.setItem("waitron-setup-cloud-result", "signed-in");
  sessionStorage.setItem("waitron-setup-cloud-tab", tab);
  const { api, requests } = wizardApi({
    intercept: (path) => {
      if (path === "/setup-api/status")
        return Response.json({
          provisioned: false,
          environment: "preproduction",
          needs: ["venue"],
          cloudSignInAvailable: true,
        });
      if (path === route) return Response.json({ available: true });
      if (path === "/setup-api/provision")
        return Response.json({
          provisioned: true,
          restarting: true,
          cloudStaffEmailUnavailable: true,
        });
    },
  });
  app = new SetupApp();
  app.api = api;
  document.body.append(app);
  const screen = (name: string) => app!.shadowRoot?.querySelector(`[data-test=screen-${name}]`);
  await expect.poll(() => screen("venue")).not.toBeNull();
  dispatchSetupGoto(screen("venue")!, "email");
  await expect
    .poll(() => screen("email")?.shadowRoot?.querySelector('input[name="cloud-staff-email"]'))
    .toBeInstanceOf(HTMLInputElement);
  return { screen, requests };
}

it("omits a previously saved mail server from the next Cloud-only Provision request", async () => {
  const { screen, requests } = await openCloudEmailStep();
  dispatchSetupPatch(screen("email")!, {
    email: {
      server: "smtp.example.test",
      from: "venue@example.test",
      port: 587,
      encryption: "starttls",
    },
  });
  dispatchSetupGoto(screen("email")!, "review");
  await expect.poll(() => screen("review")).not.toBeNull();
  dispatchSetupGoto(screen("review")!, "email");
  await expect.poll(() => screen("email")).not.toBeNull();
  dispatchSetupPatch(screen("email")!, { email: undefined, cloudStaffEmail: true });
  dispatchSetupGoto(screen("email")!, "review");
  await expect.poll(() => screen("review")).not.toBeNull();
  dispatchProvisionRequested(screen("review")!);
  const provision = () => requests.find(({ path }) => path === "/setup-api/provision")?.body;
  await expect.poll(provision).toMatchObject({ cloudStaffEmail: true });
  expect(provision()).not.toHaveProperty("email");
});

it("points to System → Email when Cloud staff email could not be confirmed", async () => {
  const { screen, requests } = await openCloudEmailStep();
  dispatchSetupPatch(screen("email")!, { cloudStaffEmail: true });
  dispatchSetupGoto(screen("email")!, "review");
  await expect.poll(() => screen("review")).not.toBeNull();
  dispatchProvisionRequested(screen("review")!);
  const notice = () =>
    screen("done")?.shadowRoot?.querySelector('[data-test="cloud-staff-email-unavailable"]');
  await expect
    .poll(() => notice()?.textContent)
    .toContain("add or check your mail server in System → Email");
  expect(notice()?.textContent).not.toContain("settings were saved");
  expect(notice()?.querySelector("a")?.getAttribute("href")).toBe(
    "/help/en/email#cloud-staff-email",
  );
  expect(requests.find(({ path }) => path === "/setup-api/provision")?.body).toMatchObject({
    cloudStaffEmail: true,
  });
});

it("opens Admin before Cloud sign-in in Prepare and keeps the administrator after a cancelled trip", async () => {
  const { api, requests } = wizardApi({
    intercept: (path) => {
      if (path === "/setup-api/status")
        return Response.json({
          provisioned: false,
          environment: "preproduction",
          needs: ["venue"],
          cloudSignInAvailable: true,
        });
      if (path === "/setup-api/cloud/sign-in/start") return Response.json({});
      if (path === "/setup-api/provision")
        return Response.json(
          { error: { code: "cloud.request_unavailable", params: {} } },
          { status: 409 },
        );
      if (path === route) return Response.json({ available: false });
    },
  });
  const mount = () => {
    app = new SetupApp();
    app.api = api;
    document.body.append(app);
  };
  mount();
  const screen = (name: string) => app!.shadowRoot?.querySelector(`[data-test=screen-${name}]`);
  const click = async (step: string, name: string) => {
    await expect.poll(() => screen(step)).not.toBeNull();
    const control = screen(step)!.shadowRoot!.querySelector(`[data-test=${name}]`)!;
    await userEvent.click(control.shadowRoot!.querySelector("button")!);
  };
  await click("mode", "choose-prepare");
  await expect.poll(() => screen("admin")).not.toBeNull();
  for (const [field, value] of Object.entries(venue.admin)) {
    screen("admin")!
      .shadowRoot!.querySelector(`[data-test=${field}]`)!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );
  }
  await click("admin", "next");
  expect(requests.some(({ path }) => path.endsWith("/sign-in/start"))).toBe(false);
  await click("cloud-sign-in", "sign-in");
  await expect.poll(() => screen("venue")).not.toBeNull();
  const start = requests.find(({ path }) => path.endsWith("/sign-in/start"))?.body;
  expect(start).toMatchObject({ prepare: true, admin: venue.admin });

  sessionStorage.setItem(
    "waitron-setup-cloud-return",
    JSON.stringify({
      mode: "prepare",
      locale: "es-ES",
      admin: adminDisplay,
    }),
  );
  sessionStorage.setItem("waitron-setup-cloud-result", "cancelled");
  app!.remove();
  mount();
  await click("cloud-sign-in", "skip");
  await expect.poll(() => screen("venue")).not.toBeNull();
  expect(currentLocale()).toBe("es-ES");
  await click("venue", "back");
  await expect.poll(() => screen("admin")).not.toBeNull();
  const field = (name: string) =>
    screen("admin")!.shadowRoot!.querySelector(`[data-test=${name}]`) as HTMLElement & {
      value: string;
      required: boolean;
      hint: string;
    };
  expect(field("email").value).toBe(venue.admin.email);
  expect(field("password").value).toBe("");
  expect(field("password").required).toBe(false);
  expect(field("pin").value).toBe("");
  expect(field("pin").required).toBe(false);
  expect(field("password").hint).toBe(es["admin.password.held_hint"]);
  expect(field("pin").hint).toBe(es["admin.pin.held_hint"]);

  await click("admin", "next");
  await expect.poll(() => screen("venue")).not.toBeNull();
  dispatchSetupPatch(screen("venue")!, { venue: { name: "El Olivo" } });
  dispatchSetupGoto(screen("venue")!, "review");
  await expect.poll(() => screen("review")).not.toBeNull();
  dispatchProvisionRequested(screen("review")!);
  await expect.poll(() => screen("admin")).not.toBeNull();
  expect(field("password").required).toBe(true);
  expect(field("pin").required).toBe(true);
  expect(screen("admin")!.shadowRoot!.querySelector("wt-form-actions")?.error).toContain(
    es["admin.cloud_expired"],
  );
  for (const name of ["password", "pin"] as const)
    field(name).dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: venue.admin[name] },
        bubbles: true,
        composed: true,
      }),
    );
  await click("admin", "next");
  await expect.poll(() => screen("venue")).not.toBeNull();
  const venueName = screen("venue")!.shadowRoot!.querySelector("[data-test=name]");
  expect(venueName).toHaveProperty("value", "El Olivo");
});
