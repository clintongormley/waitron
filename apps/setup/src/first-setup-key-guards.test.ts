import { afterEach, expect, it } from "vitest";
import { SetupApi } from "./api/client.js";
import { FirstSetupSession } from "./first-setup-session.js";
import { initial, venue } from "../test/first-setup-browser.js";

const sessions: FirstSetupSession[] = [];
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose();
});
function fixture(
  reply: (path: string) => Response | Promise<Response>,
  saved: string | null = null,
) {
  const requests: string[] = [];
  let retained = saved;
  const session = new FirstSetupSession(
    new SetupApi("", async (input) => {
      const path = String(input);
      requests.push(path);
      return reply(path);
    }),
    {
      storage: {
        getItem: () => retained,
        setItem: (_key, value) => {
          retained = value;
        },
      },
    },
  );
  sessions.push(session);
  return { session, requests, retained: () => retained };
}
const claimed = () =>
  Response.json({ state: initial, ownerGeneration: 1, capability: "A".repeat(43) });

it.each([
  "{broken-json",
  JSON.stringify({
    version: 1,
    clientClaimNonce: "B".repeat(43),
    claimPending: false,
    owner: { attemptId: initial.attemptId, revision: 1, ownerGeneration: 1, capability: "invalid" },
  }),
])("never recovers a key using damaged saved ownership: %s", async (saved) => {
  const { session, requests, retained } = fixture(claimed, saved);
  await expect(session.open()).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  await expect(
    session.reissueNodeKey("fiscal-verifactu", venue.admin.password),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(requests).toEqual([]);
  expect(retained()).toBe(saved);
});
it.each([
  { capability: "invalid", ownerGeneration: 1 },
  { capability: "A".repeat(43), ownerGeneration: 2 },
])("rejects an unusable claim grant before permitting key replacement: %j", async (grant) => {
  const { session, requests } = fixture(() => Response.json({ state: initial, ...grant }));
  await session.open();
  await expect(session.claim(venue)).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expect(
    session.reissueNodeKey("fiscal-verifactu", venue.admin.password),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(requests).toEqual(["/setup-api/first-setup/claim"]);
  expect(session.state).toBeUndefined();
});
it("rejects a malformed public ownership read without authorizing a key request", async () => {
  const { session, requests } = fixture(() => Response.json({ claimed: "false" }));
  await session.open();
  await expect(session.refresh()).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  await expect(
    session.reissueNodeKey("fiscal-verifactu", venue.admin.password),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(requests).toEqual(["/setup-api/first-setup/status"]);
});
it("refuses staging a key for another node before a PDF can be prepared", async () => {
  const { session, requests } = fixture((path) => {
    if (path.endsWith("/claim")) return claimed();
    if (path.endsWith("/reconfirm")) return Response.json({ reconfirmation: "proof" });
    return Response.json({
      stage: { stageId: "stage", nodeId: "other", name: "Key" },
      key: { nodeId: "other", name: "Key", secret: "never delivered" },
    });
  });
  await session.open();
  await session.claim(venue);
  await expect(
    session.stageNodeKey("fiscal-verifactu", venue.admin.password),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(requests).toEqual([
    "/setup-api/first-setup/claim",
    "/setup-api/first-setup/reconfirm",
    "/setup-api/first-setup/node-key",
  ]);
  expect(session.state?.nodeId).toBe(initial.nodeId);
});
it("requires a fresh ownership read before replacing a key after a lost candidate reply", async () => {
  const { session, requests } = fixture((path) => {
    if (path.endsWith("/claim")) return claimed();
    if (path.endsWith("/reconfirm")) return Response.json({ reconfirmation: "proof" });
    if (path.endsWith("/candidates")) throw new TypeError("lost candidate reply");
    if (path.endsWith("/status")) return Response.json({ claimed: true, state: initial });
    throw new Error("No key call before reconciliation");
  });
  await session.open();
  await session.claim(venue);
  await expect(
    session.candidates("fiscal-verifactu", { answer: "no" }, venue.admin.password),
  ).rejects.toThrow("lost candidate reply");
  expect(session.recoveryRequired).toBe(true);
  await expect(
    session.reissueNodeKey("fiscal-verifactu", venue.admin.password),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(requests.some((path) => path.endsWith("/node-key-reissue"))).toBe(false);
  await session.refresh();
  expect(session.recoveryRequired).toBe(false);
  expect(session.state?.nodeId).toBe(initial.nodeId);
});
