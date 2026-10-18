import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Agent } from "undici";
import { expect, it } from "vitest";
import { verifySecretAsync } from "@waitron/identity";
import { startServer, type StartedServer } from "./boot.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { request, PASSWORD } from "../test/first-fiscal.js";

it("reissues on the real setup HTTPS listener after a restart loses the raw key", async () => {
  const root = await mkdtemp(join(tmpdir(), "reissue-https-"));
  let server: StartedServer | undefined;
  let agent: Agent | undefined;
  try {
    const stateDir = join(root, "state"),
      venueDir = join(root, "venue"),
      migrations = join(root, "migrations");
    await copyMigrationsRoot(migrations);
    const [port] = await freePorts(1);
    const env = {
      WAITRON_ENV: "production",
      WAITRON_STATE_DIR: stateDir,
      WAITRON_VENUE_DIR: venueDir,
      WAITRON_MIGRATIONS_DIR: migrations,
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_MANAGEMENT_RP_ID: "localhost",
      WAITRON_MANAGEMENT_ORIGIN: "https://localhost",
    };
    server = await startServer(env);
    agent = new Agent({ connect: { ca: await readFile(join(stateDir, "tls/ca.crt")) } });
    const url = `https://127.0.0.1:${port}`;
    let headers: Record<string, string> = {};
    const post = async (path: string, body: unknown) => {
      const response = await fetch(url + "/setup-api/first-setup/" + path, {
        dispatcher: agent,
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      } as RequestInit);
      return { status: response.status, headers: response.headers, body: await response.json() };
    };
    const nonce = randomBytes(32).toString("base64url");
    const claim = await post("claim", { clientClaimNonce: nonce, venue: request });
    expect(claim.status).toBe(200);
    const own = (result: typeof claim.body) => {
      headers = {
        "X-Waitron-Setup-Owner": result.capability,
        "X-Waitron-Setup-Attempt": result.state.attemptId,
        "X-Waitron-Setup-Revision": String(result.state.revision),
        "X-Waitron-Setup-Generation": String(result.state.ownerGeneration),
      };
    };
    own(claim.body);
    const proof = await post("reconfirm", { password: PASSWORD, purpose: "block-use" });
    expect(proof.status).toBe(200);
    const initial = await post("node-key", proof.body);
    expect(initial.status).toBe(200);
    const keyPath = join(stateDir, "first-setup-node-key.json");
    const original = JSON.parse(await readFile(keyPath, "utf8"));
    await server.close();
    server = undefined;
    server = await startServer(env);
    const resumed = await post("resume", { clientClaimNonce: nonce, password: PASSWORD });
    expect(resumed.status).toBe(200);
    own(resumed.body);
    const before = await readFile(join(stateDir, "first-setup.json"));
    const refused = await post("node-key-reissue", { password: "wrong password" });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("setup.owner_required");
    expect(JSON.parse(await readFile(keyPath, "utf8"))).toEqual(original);
    const reissued = await post("node-key-reissue", { password: PASSWORD });
    expect(reissued.status).toBe(200);
    expect(reissued.headers.get("cache-control")).toBe("no-store");
    const replacement = JSON.parse(await readFile(keyPath, "utf8"));
    expect(reissued.body.stage.stageId).not.toBe(initial.body.stage.stageId);
    expect(await verifySecretAsync(reissued.body.key.secret, replacement.verifier)).toBe(true);
    expect(await verifySecretAsync(initial.body.key.secret, replacement.verifier)).toBe(false);
    expect(await readFile(join(stateDir, "first-setup.json"))).toEqual(before);
  } finally {
    await agent?.close();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  }
});
