import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import type {
  InitialSetupActions,
  InitialSetupNodeKey,
} from "@waitron/module/src/setup-contract.js";
import { FirstSetupSession, FIRST_SETUP_SESSION_KEY } from "../first-setup-session.js";
import { wizardApi, venue, initial } from "../../test/first-setup-browser.js";
import "./initial-setup-screen.js";

const sessions: FirstSetupSession[] = [];
const hosts: HTMLElement[] = [];
afterEach(async () => {
  hosts.splice(0).forEach((host) => host.remove());
  for (const session of sessions.splice(0)) await session.dispose();
  sessionStorage.removeItem(FIRST_SETUP_SESSION_KEY);
});
const key = {
  stage: { stageId: "replacement", nodeId: initial.nodeId, name: "New key" },
  key: { nodeId: initial.nodeId, name: "New key", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
};
const reference = {
  stageId: "old-stage",
  inputDigest: "a".repeat(64),
  bindingDigest: "b".repeat(64),
  documentDigest: "c".repeat(64),
};
async function mount(reply: () => Response | Promise<Response> = () => Response.json(key)) {
  const fixture = wizardApi({
    intercept(path) {
      if (path.endsWith("/node-key-reissue")) return reply();
      if (path.endsWith("/reconfirm")) return Response.json({ reconfirmation: "proof" });
      if (path.endsWith("/recovery-document-kept")) return Response.json({ accepted: true });
    },
  });
  const session = new FirstSetupSession(fixture.api);
  sessions.push(session);
  await session.open();
  await session.claim(venue);
  const host = document.createElement("main");
  hosts.push(host);
  document.body.append(host);
  applyTokens(host);
  const el = document.createElement("setup-initial-setup-screen");
  let actions!: InitialSetupActions & { reissueNodeKey?: () => Promise<InitialSetupNodeKey> };
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
  const password = async (value = venue.admin.password) => {
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=owner-password]"))
      .not.toBeNull();
    const field = el.shadowRoot!.querySelector<HTMLElement>("[data-test=owner-password]")!;
    await userEvent.fill(field.shadowRoot!.querySelector<HTMLInputElement>("input")!, value);
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=reconfirm]")!);
  };
  return { el, session, actions, password, ...fixture };
}
it("requires a fresh original password for replacement and clears the previous Review grant without another hour selection", async () => {
  const { el, actions, requests, password, session } = await mount();
  const kept = actions.confirmRecoveryDocument!(reference);
  await password();
  await kept;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=next]")!.hasAttribute("disabled")).toBe(false);
  expect(actions.reissueNodeKey).toBeTypeOf("function");
  const before = session.state;
  const pending = actions.reissueNodeKey!();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("[data-test=next]")!.hasAttribute("disabled")).toBe(true);
  expect(requests.some((request) => request.path.endsWith("/node-key-reissue"))).toBe(false);
  await password();
  await expect(pending).resolves.toEqual(key);
  expect(session.state).toEqual(before);
  const reissues = requests.filter((request) => request.path.endsWith("/node-key-reissue"));
  expect(reissues).toHaveLength(1);
  expect(reissues[0]!.body).toEqual({ password: venue.admin.password });
  expect(reissues[0]!.headers.get("X-Waitron-Setup-Owner")).toBe("A".repeat(43));
  expect(requests.some((request) => /\/(candidates|input|provision)$/.test(request.path))).toBe(
    false,
  );
  expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).not.toContain(key.key.secret);
  expect(sessionStorage.getItem(FIRST_SETUP_SESSION_KEY)).not.toContain(venue.admin.password);
  expect(el.shadowRoot!.querySelector("[data-test=owner-password]")).toBeNull();
});
it.each([
  { stage: { ...key.stage, nodeId: "wrong-node" } },
  { key: { ...key.key, nodeId: "wrong-node" } },
  { key: { ...key.key, name: "another-name" } },
])("refuses a replacement bound to a different staged node or key: %j", async (change) => {
  const { actions, password } = await mount(() => Response.json({ ...key, ...change }));
  expect(actions.reissueNodeKey).toBeTypeOf("function");
  const pending = actions.reissueNodeKey!();
  const refused = expect(pending).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await password();
  await refused;
});
it("discards a replacement reply after the owner session is disposed", async () => {
  let release!: (response: Response) => void;
  const { actions, password, session, requests } = await mount(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  expect(actions.reissueNodeKey).toBeTypeOf("function");
  const pending = actions.reissueNodeKey!();
  const refused = expect(pending).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await password();
  await expect
    .poll(() => requests.filter((request) => request.path.endsWith("/node-key-reissue")).length)
    .toBe(1);
  await session.dispose();
  release(Response.json(key));
  await refused;
  expect(session.state).toBeUndefined();
});
