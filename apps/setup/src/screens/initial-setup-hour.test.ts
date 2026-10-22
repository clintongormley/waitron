import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import type { InitialSetupActions } from "@waitron/module/src/setup-contract.js";
import { FirstSetupSession, FIRST_SETUP_SESSION_KEY } from "../first-setup-session.js";
import { wizardApi, venue, initial } from "../../test/first-setup-browser.js";
import "./initial-setup-screen.js";

const hosts: HTMLElement[] = [];
const sessions: FirstSetupSession[] = [];
afterEach(async () => {
  hosts.splice(0).forEach((host) => host.remove());
  for (const session of sessions.splice(0)) await session.dispose();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
});
async function mount(waiting = false, intercept?: (path: string) => Promise<Response> | undefined) {
  const fixture = wizardApi({
    intercept(path) {
      const extra = intercept?.(path);
      if (extra) return extra;
      if (path.endsWith("/recovery-document") || path.endsWith("/recovery-document-kept"))
        return Response.json({ accepted: true });
      if (path.endsWith("/preparation"))
        return Response.json({ state: initial, preparation: { id: "comparison" } });
      if (path.endsWith("/node-key"))
        return Response.json({
          stage: { stageId: "stage", nodeId: initial.nodeId, name: "key" },
          key: { nodeId: initial.nodeId, name: "key", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
        });
      if (path.endsWith("/reconfirm")) return Response.json({ reconfirmation: "proof" });
      if (path.endsWith("/candidates"))
        return Response.json({
          state: initial,
          ...(waiting
            ? { preparation: { status: "waiting", targetMs: 1792332000000, remainingMs: 120000 } }
            : {}),
        });
      if (path.endsWith("/request"))
        return Response.json({
          attemptId: initial.attemptId,
          modules: [
            { module: "fiscal-verifactu", request: { status: "selected", identity: "0CRHE" } },
          ],
        });
      return undefined;
    },
  });
  const session = new FirstSetupSession(fixture.api);
  sessions.push(session);
  await session.open();
  await session.claim(venue);
  const host = document.createElement("main");
  document.body.append(host);
  hosts.push(host);
  applyTokens(host);
  const el = document.createElement("setup-initial-setup-screen");
  let actions!: InitialSetupActions & { preparation?: (proposal: unknown) => Promise<unknown> };
  el.session = session;
  el.offerings = initial.modules;
  el.contributions = [
    {
      module: "fiscal-verifactu",
      create(context) {
        actions = context.api;
        return document.createElement("div");
      },
    },
  ];
  host.append(el);
  await el.updateComplete;
  return { el, actions, ...fixture };
}
it("projects owned clock preparation without password or activation and removes the offline tool", async () => {
  const { el, actions, requests } = await mount();
  expect(actions.preparation, "clock preparation is projected to the selected module").toBeTypeOf(
    "function",
  );
  expect(await actions.preparation!({ action: "clock-challenge" })).toEqual({ id: "comparison" });
  expect(requests.find((r) => r.path.endsWith("/preparation"))!.body).toEqual({
    module: "fiscal-verifactu",
    proposal: { action: "clock-challenge" },
  });
  expect(
    requests.find((r) => r.path.endsWith("/preparation"))!.headers.get("X-Waitron-Setup-Owner"),
  ).toBe("A".repeat(43));
  expect(
    requests.some((r) => r.path.endsWith("/reconfirm") || r.path.endsWith("/candidates")),
  ).toBe(false);
  expect(el.shadowRoot!.querySelector("[data-test=download-tool]")).toBeNull();
});
it("returns a server wait without fetching an unfrozen request or enabling Review", async () => {
  const { el, actions, requests } = await mount(true);
  const pending = actions.candidates({ comparisonId: "comparison" });
  await el.updateComplete;
  el.shadowRoot!.querySelector("[data-test=owner-password]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: venue.admin.password } }),
  );
  await el.updateComplete;
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=reconfirm]")!);
  expect(await pending).toEqual({
    status: "waiting",
    targetMs: 1792332000000,
    remainingMs: 120000,
  });
  expect(requests.some((r) => r.path.endsWith("/request"))).toBe(false);
  expect(el.shadowRoot!.querySelector("[data-test=next]")!.hasAttribute("disabled")).toBe(true);
});
it("uses separate password proofs for the transient key and kept document and only then enables Review", async () => {
  const { el, actions, requests } = await mount(false);
  const value = actions as InitialSetupActions & {
    stageNodeKey?: () => Promise<unknown>;
    registerRecoveryDocument?: (value: unknown) => Promise<void>;
    confirmRecoveryDocument?: (value: unknown) => Promise<void>;
  };
  expect(value.stageNodeKey).toBeTypeOf("function");
  const proof = async () => {
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=owner-password]"))
      .not.toBeNull();
    el.shadowRoot!.querySelector("[data-test=owner-password]")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: venue.admin.password } }),
    );
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=reconfirm]")!);
  };
  const staging = value.stageNodeKey!();
  await proof();
  await staging;
  const reference = {
    stageId: "stage",
    inputDigest: "a".repeat(64),
    bindingDigest: "b".repeat(64),
    documentDigest: "c".repeat(64),
  };
  await value.registerRecoveryDocument!({ ...reference, statement: { public: "key-label" } });
  expect(el.shadowRoot!.querySelector("[data-test=next]")!.hasAttribute("disabled")).toBe(true);
  const kept = value.confirmRecoveryDocument!(reference);
  await proof();
  await kept;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=next]")!.hasAttribute("disabled")).toBe(false);
  expect(requests.filter((r) => r.path.endsWith("/reconfirm")).map((r) => r.body)).toEqual([
    { password: venue.admin.password, purpose: "block-use" },
    { password: venue.admin.password, purpose: "activation" },
  ]);
  expect(requests.find((r) => r.path.endsWith("/node-key"))!.body).toEqual({
    reconfirmation: "proof",
  });
  expect(requests.find((r) => r.path.endsWith("/recovery-document"))!.body).toEqual({
    ...reference,
    module: "fiscal-verifactu",
    statement: { public: "key-label" },
  });
  expect(requests.find((r) => r.path.endsWith("/recovery-document-kept"))!.body).toEqual({
    ...reference,
    module: "fiscal-verifactu",
    kept: true,
    reconfirmation: "proof",
  });
});
it("does not enable Review for a kept reply after its module draft changed", async () => {
  let release!: (value: Response) => void;
  const { el, actions } = await mount(false, (path) =>
    path.endsWith("/recovery-document-kept")
      ? new Promise((resolve) => {
          release = resolve;
        })
      : undefined,
  );
  const pending = actions.confirmRecoveryDocument!({
    stageId: "stage",
    inputDigest: "a".repeat(64),
    bindingDigest: "b".repeat(64),
    documentDigest: "c".repeat(64),
  });
  await el.updateComplete;
  el.shadowRoot!.querySelector("[data-test=owner-password]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: venue.admin.password } }),
  );
  await el.updateComplete;
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=reconfirm]")!);
  await expect.poll(() => release).toBeTypeOf("function");
  el.shadowRoot!.querySelector("section")!.dispatchEvent(
    new CustomEvent("initial-setup-changed", { bubbles: true, composed: true }),
  );
  release(Response.json({ accepted: true }));
  await pending;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=next]")!.hasAttribute("disabled")).toBe(true);
});
it("asks for the password once across a press, its waits and the name", async () => {
  const answers = [
    { status: "waiting", targetMs: 1792332000000, remainingMs: 84000 },
    { status: "waiting", targetMs: 1792332030000, remainingMs: 30000 },
    { kind: "waitron-hour-setup", status: "selected", identity: "0CRHE" },
  ];
  const { el, actions, requests } = await mount(false, (path) =>
    path.endsWith("/candidates")
      ? Promise.resolve(Response.json({ state: initial, preparation: answers.shift() }))
      : undefined,
  );
  const dialogs = () => el.shadowRoot!.querySelectorAll("[data-test=owner-password]").length;
  const first = actions.candidates({ comparisonId: "comparison-1" });
  await expect.poll(dialogs).toBe(1);
  el.shadowRoot!.querySelector("[data-test=owner-password]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: venue.admin.password } }),
  );
  await el.updateComplete;
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=reconfirm]")!);
  expect(await first).toMatchObject({ status: "waiting", remainingMs: 84000 });
  await expect.poll(dialogs).toBe(0);
  expect(await actions.candidates({ comparisonId: "comparison-2" })).toMatchObject({
    status: "waiting",
    remainingMs: 30000,
  });
  await el.updateComplete;
  expect(dialogs()).toBe(0);
  expect(await actions.candidates({ comparisonId: "comparison-3" })).toMatchObject({
    status: "selected",
  });
  await el.updateComplete;
  expect(dialogs()).toBe(0);
  expect(requests.filter((r) => r.path.endsWith("/reconfirm"))).toHaveLength(1);
  expect(requests.filter((r) => r.path.endsWith("/candidates")).map((r) => r.body)).toEqual(
    ["comparison-1", "comparison-2", "comparison-3"].map((comparisonId) => ({
      module: "fiscal-verifactu",
      proposal: { comparisonId },
      reconfirmation: "proof",
    })),
  );
});
