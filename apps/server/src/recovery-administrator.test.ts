import { Hono } from "hono";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { hashPassword } from "@waitron/identity";
import { mountAdministratorChoice } from "./recovery-administrator.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const password = "administrator password";
const hashes = [hashPassword(password)];
async function fixture(stateDir?: string) {
  stateDir ??= await mkdtemp(join(tmpdir(), "recovery-admin-"));
  if (!roots.includes(stateDir)) roots.push(stateDir);
  const app = new Hono();
  let changes = 0;
  mountAdministratorChoice(
    app,
    {
      path: "/choose",
      stateDir,
      throttleId: "b8b5b312-3ab7-40a0-bd98-a918b4c31fe7",
      onFinished: async () => {},
      choose: async (authorize) => {
        await authorize(hashes);
        changes++;
        return "finished";
      },
    },
    async (view) => JSON.stringify(view),
  );
  const post = async (body: string, secure = true, origin = "https://box.test") => {
    const socket = secure ? new TLSSocket(new Socket()) : new Socket();
    try {
      return await app.request(
        "https://box.test/choose",
        {
          method: "POST",
          body,
          headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
        },
        { incoming: { socket } },
      );
    } finally {
      socket.destroy();
    }
  };
  return { stateDir, post, changes: () => changes };
}
it.each([
  ["choice=move&password=anything", false, "https://box.test", 403, "insecure"],
  ["choice=move&password=anything", true, "https://other.test", 403, "otherPage"],
  ["choice=move", true, "https://box.test", 400, "passwordMissing"],
  ["choice=move&password=x&password=y", true, "https://box.test", 400, "choiceMissing"],
  ["choice=other&password=x", true, "https://box.test", 400, "choiceMissing"],
] as const)(
  "refuses before checking a password: %s",
  async (body, secure, origin, status, kind) => {
    const f = await fixture();
    const answer = await f.post(body, secure, origin);
    expect(answer.status).toBe(status);
    expect(await answer.json()).toMatchObject({ message: { kind } });
    expect(f.changes()).toBe(0);
    await expect(
      stat(join(f.stateDir, "first-setup-start-again-guesses.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  },
);
it("Stop leaves the action and password counters untouched", async () => {
  const f = await fixture();
  expect(await (await f.post("choice=keep")).json()).toMatchObject({ stopped: true });
  expect(f.changes()).toBe(0);
  await expect(
    stat(join(f.stateDir, "first-setup-start-again-guesses.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
it("verifies saved hashes and refuses another action after completion", async () => {
  const f = await fixture();
  expect((await f.post("choice=move&password=wrong")).status).toBe(403);
  expect(f.changes()).toBe(0);
  const body = new URLSearchParams({ choice: "move", password }).toString();
  expect((await f.post(body)).status).toBe(200);
  expect(f.changes()).toBe(1);
  expect((await f.post(body)).status).toBe(409);
  expect(f.changes()).toBe(1);
});
it("keeps failed-password throttling across recovery restarts", async () => {
  let f = await fixture();
  for (let index = 0; index < 6; index++)
    expect((await f.post("choice=move&password=wrong")).status).toBe(403);
  f = await fixture(f.stateDir);
  const answer = await f.post(new URLSearchParams({ choice: "move", password }).toString());
  expect(answer.status).toBe(429);
  expect(Number(answer.headers.get("Retry-After"))).toBeGreaterThan(0);
  expect(f.changes()).toBe(0);
});
