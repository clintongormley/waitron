import { afterEach, expect, it } from "vitest";
import { html, LitElement } from "lit";
import { userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { SetupApi, type ProvisionBody } from "../api/client.js";
import { FirstSetupSession, FIRST_SETUP_SESSION_KEY } from "../first-setup-session.js";
import "./initial-setup-screen.js";

const venue = {
  country: "ES",
  taxId: "B12345674",
  legalName: "Olivo",
  taxpayerDomicile: "Madrid",
  location: { fiscalTerritory: "ES-common" },
  admin: {
    displayName: "Elena",
    email: "elena@example.test",
    password: "admin password",
    pin: "1357",
  },
} as ProvisionBody["venue"];
const state = {
  attemptId: "bd185bdc-b7dd-4abb-991a-a9c3d613d38e",
  nodeId: "75544019-26d4-4448-91b0-e803a12f7610",
  administratorId: "c67ebebf-632b-4481-9b83-f78cb7ece82f",
  revision: 1,
  ownerGeneration: 1,
  status: "claimed",
  consumptionIntent: false,
  environment: "production",
  venue: { ...venue, admin: { displayName: "Elena", email: "elena@example.test" } },
  modules: [{ module: "example-module", version: "1" }],
};
const hosts: HTMLElement[] = [];
const sessions: FirstSetupSession[] = [];
afterEach(async () => {
  hosts.splice(0).forEach((host) => host.remove());
  for (const session of sessions.splice(0)) await session.dispose();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
});
async function mount(handler?: (path: string, body: unknown) => Response | Promise<Response>) {
  const requests: { path: string; body: unknown }[] = [];
  const api = new SetupApi("", async (url, init) => {
    const path = String(url),
      body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    requests.push({ path, body });
    if (path.endsWith("/claim"))
      return Response.json({ state, capability: "A".repeat(43), ownerGeneration: 1 });
    return handler?.(path, body) ?? Response.json({ state });
  });
  const session = new FirstSetupSession(api);
  sessions.push(session);
  await session.open();
  await session.claim(venue);
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  applyTokens(host);
  const el = document.createElement("setup-initial-setup-screen");
  el.session = session;
  host.append(el);
  await el.updateComplete;
  return { el, session, requests, host };
}
class ExampleScreen extends LitElement {
  override render() {
    return html`<p>Example setup</p>`;
  }
}
customElements.define("test-example-initial-setup", ExampleScreen);

it("mounts only a server-selected module and refuses to continue without its confirmation", async () => {
  const { el } = await mount();
  el.offerings = [{ module: "example-module", version: "1" }];
  el.contributions = [
    {
      module: "example-module",
      create() {
        return document.createElement("test-example-initial-setup");
      },
    },
  ];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("test-example-initial-setup")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=next]")?.hasAttribute("disabled")).toBe(true);
  el.offerings = [{ module: "not-installed", version: "1" }];
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("test-example-initial-setup")).toBeNull();
  expect(el.shadowRoot!.textContent).toContain("unavailable");
});
it("collects administrator proof separately for candidates and activation and projects only public module actions", async () => {
  let actions: import("@waitron/module/src/setup-contract.js").InitialSetupActions | undefined;
  const { el, requests } = await mount((path) => {
    if (path.endsWith("reconfirm")) return Response.json({ reconfirmation: "proof" });
    if (path.endsWith("request"))
      return Response.json({
        attemptId: state.attemptId,
        modules: [{ module: "example-module", request: { public: "request" } }],
      });
    return Response.json({
      state: { ...state, revision: 2, status: "consumption-intent", consumptionIntent: true },
    });
  });
  el.offerings = [{ module: "example-module", version: "1" }];
  el.contributions = [
    {
      module: "example-module",
      create(context) {
        actions = context.api;
        return document.createElement("test-example-initial-setup");
      },
    },
  ];
  await el.updateComplete;
  const candidates = actions!.candidates({ serials: [1, 2] });
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=owner-password]")).not.toBeNull();
  const field = el.shadowRoot!.querySelector("[data-test=owner-password]")!;
  field.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "admin password" } }));
  await el.updateComplete;
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=reconfirm]")!);
  expect(await candidates).toEqual({ public: "request" });
  expect(requests.filter((r) => r.path.endsWith("reconfirm")).map((r) => r.body)).toEqual([
    { password: "admin password", purpose: "block-use" },
  ]);
  const confirm = actions!.confirm({ current: "statement" });
  await el.updateComplete;
  expect(
    el.shadowRoot!.querySelector("[data-test=owner-password]")!.getAttribute("value"),
  ).not.toBe("admin password");
  el.shadowRoot!.querySelector("[data-test=owner-password]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "new proof" } }),
  );
  await el.updateComplete;
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=reconfirm]")!);
  await confirm;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=next]")?.hasAttribute("disabled")).toBe(false);
  expect(requests.filter((r) => r.path.endsWith("reconfirm")).map((r) => r.body)).toEqual([
    { password: "admin password", purpose: "block-use" },
    { password: "new proof", purpose: "activation" },
  ]);
  expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).not.toContain("admin password");
});
it("drops a pending proof when its screen is disconnected", async () => {
  let actions: import("@waitron/module/src/setup-contract.js").InitialSetupActions | undefined;
  const { el, requests } = await mount();
  el.offerings = [{ module: "example-module", version: "1" }];
  el.contributions = [
    {
      module: "example-module",
      create(context) {
        actions = context.api;
        return document.createElement("test-example-initial-setup");
      },
    },
  ];
  await el.updateComplete;
  const result = actions!.candidates({ serials: [1] });
  const rejected = expect(result).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  el.remove();
  await rejected;
  expect(requests).toHaveLength(1);
});

it("retires the review action when a confirmed module draft changes", async () => {
  let actions: import("@waitron/module/src/setup-contract.js").InitialSetupActions | undefined;
  const { el } = await mount((path) =>
    path.endsWith("reconfirm")
      ? Response.json({ reconfirmation: "proof" })
      : Response.json({ state }),
  );
  el.offerings = [{ module: "example-module", version: "1" }];
  el.contributions = [
    {
      module: "example-module",
      create(context) {
        actions = context.api;
        return document.createElement("test-example-initial-setup");
      },
    },
  ];
  await el.updateComplete;
  const confirmed = actions!.confirm({ current: "statement" });
  await el.updateComplete;
  el.shadowRoot!.querySelector("[data-test=owner-password]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "proof" } }),
  );
  await el.updateComplete;
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=reconfirm]")!);
  await confirmed;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=next]")!.hasAttribute("disabled")).toBe(false);
  el.shadowRoot!.querySelector("test-example-initial-setup")!.dispatchEvent(
    new CustomEvent("initial-setup-changed", { bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=next]")!.hasAttribute("disabled")).toBe(true);
});

it("keeps an empty proof local, marks its field and lets cancellation retire the pending action", async () => {
  let actions: import("@waitron/module/src/setup-contract.js").InitialSetupActions | undefined;
  const { el, requests } = await mount();
  el.offerings = [{ module: "example-module", version: "1" }];
  el.contributions = [
    {
      module: "example-module",
      create(context) {
        actions = context.api;
        return document.createElement("test-example-initial-setup");
      },
    },
  ];
  await el.updateComplete;
  const pending = actions!.confirm({ current: "statement" });
  const rejected = expect(pending).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await el.updateComplete;
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=reconfirm]")!);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=owner-password]")!.hasAttribute("invalid")).toBe(
    true,
  );
  expect(requests).toHaveLength(1);
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>('wt-button[slot="cancel"]')!);
  await rejected;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=owner-password]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=next]")!.hasAttribute("disabled")).toBe(true);
});
it("shows reconnect after a refused public write and never marks the module ready", async () => {
  let actions: import("@waitron/module/src/setup-contract.js").InitialSetupActions | undefined;
  const { el } = await mount(() =>
    Response.json({ error: { code: "setup.attempt_conflict", params: {} } }, { status: 409 }),
  );
  el.offerings = [{ module: "example-module", version: "1" }];
  el.contributions = [
    {
      module: "example-module",
      create(context) {
        actions = context.api;
        return document.createElement("test-example-initial-setup");
      },
    },
  ];
  await el.updateComplete;
  await expect(actions!.importInput({ public: "input" })).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  await el.updateComplete;
  expect(el.shadowRoot!.textContent).toContain("Reconnect to check");
  expect(el.shadowRoot!.querySelector("[data-test=next]")!.hasAttribute("disabled")).toBe(true);
  const reconnected = new Promise<void>((resolve) =>
    el.addEventListener("initial-reconnect", () => resolve(), { once: true }),
  );
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=reconnect]")!);
  await reconnected;
});
it("refuses a public request that omits the selected module", async () => {
  let actions: import("@waitron/module/src/setup-contract.js").InitialSetupActions | undefined;
  const { el } = await mount(() => Response.json({ attemptId: state.attemptId, modules: [] }));
  el.offerings = [{ module: "example-module", version: "1" }];
  el.contributions = [
    {
      module: "example-module",
      create(context) {
        actions = context.api;
        return document.createElement("test-example-initial-setup");
      },
    },
  ];
  await el.updateComplete;
  await expect(actions!.request()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(el.shadowRoot!.querySelector("[data-test=next]")!.hasAttribute("disabled")).toBe(true);
});
