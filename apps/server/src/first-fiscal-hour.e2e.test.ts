import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ALL_MODULES } from "@waitron/composition";
import { afterEach, expect, it } from "vitest";
import { Agent } from "undici";
import { request, PASSWORD } from "../test/first-fiscal.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { FRESH, writeRecoveryState } from "./recovery-state.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { resolveFirstSetupWorkspace } from "@waitron/provisioning";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(
  ["src/bin.ts", "src/node-entry.ts"].flatMap((script) =>
    ["complete", "state-selection", "target-backlink"].map((selectionState) => ({
      script,
      selectionState,
    })),
  ),
)(
  "$script restarts into its password-authorised replacement after $selectionState and keeps the retired database absent",
  async ({ script, selectionState }) => {
    const f = await fixture();
    const host = createFirstSetupModuleHost({ ...f, modules: ALL_MODULES, environment: f.env });
    await host.owner.claimFirstSetup(
      { environment: "preproduction", request },
      randomBytes(32).toString("base64url"),
    );
    await ensureBoxSecrets({
      stateDir: f.stateDir,
      hostnames: ["localhost", "waitron.local"],
      now: () => new Date(),
      listIpv4: () => ["127.0.0.1"],
    });
    const ca = await readFile(join(f.stateDir, "tls", "ca.crt"));
    let agent = new Agent({ connect: { ca } });
    let agentClosed = false;
    const closeAgent = async () => {
      if (agentClosed) return;
      agentClosed = true;
      await agent.close();
    };
    let child = childProcess(script, f.env);
    const origin = `https://127.0.0.1:${f.port}`;
    try {
      expect(await ready(child, origin, agent)).toEqual({ claimed: true, resolution: true });
      const get = (path: string) => fetch(`${origin}${path}`, { dispatcher: agent } as RequestInit);
      const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
        fetch(`${origin}${path}`, {
          dispatcher: agent,
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin, ...headers },
          body: JSON.stringify(body),
        } as RequestInit);
      const snapshot = await (await get("/setup-api/first-setup/resolution")).json();
      const recovered = await post("/setup-api/first-setup/resolution/recover", {
        inspectionId: snapshot.inspectionId,
        revision: snapshot.revision,
        ownerGeneration: snapshot.ownerGeneration,
        clientClaimNonce: randomBytes(32).toString("base64url"),
        password: PASSWORD,
      });
      expect(recovered.status).toBe(200);
      const owner = await recovered.json();
      await writeFile(join(f.stateDir, "restore-request.json"), "retired restore must not run");
      await writeFile(join(f.stateDir, "reset-request.json"), "retired reset must not run");
      const fresh = await (await get("/setup-api/first-setup/resolution")).json();
      const originals = await Promise.all(
        [join(f.stateDir, "first-setup.json"), join(f.venueDir, "first-setup-claim.json")].map(
          (path) => readFile(path),
        ),
      );
      const selected = await post(
        "/setup-api/first-setup/resolution/start-again",
        {
          inspectionId: fresh.inspectionId,
          revision: fresh.revision,
          ownerGeneration: fresh.ownerGeneration,
        },
        {
          "X-Waitron-Setup-Owner": owner.capability,
          "X-Waitron-Setup-Attempt": owner.state.attemptId,
          "X-Waitron-Setup-Revision": String(owner.state.revision),
          "X-Waitron-Setup-Generation": String(owner.state.ownerGeneration),
        },
      );
      expect(selected.status).toBe(200);
      const selection = await selected.json();
      expect(selection).toEqual({
        workspaceId: expect.any(String),
        selectionGeneration: 1,
        restarting: true,
      });
      await closeAgent();
      await expectRestartExit(child);
      const target = await resolveFirstSetupWorkspace(f);
      expect(target.binding).toMatchObject({
        workspaceId: selection.workspaceId,
        selectionGeneration: 1,
      });
      expect(target.venueDir).not.toBe(f.venueDir);
      expect(target.stateDir).not.toBe(f.stateDir);
      if (selectionState !== "complete") {
        await rm(
          selectionState === "state-selection"
            ? join(f.stateDir, "first-setup-selection.json")
            : join(target.venueDir, "first-setup-workspace.json"),
        );
        agent = new Agent({ connect: { ca } });
        agentClosed = false;
        child = childProcess(script, f.env);
        expect(await ready(child, origin, agent)).toEqual({ claimed: true, resolution: true });
        await expect(stat(join(target.venueDir, "venue.db"))).rejects.toMatchObject({
          code: "ENOENT",
        });
        const pending = await (await get("/setup-api/first-setup/resolution/selection")).json();
        expect(pending).toMatchObject({
          workspaceId: selection.workspaceId,
          selectionGeneration: 1,
        });
        const wrongPassword = await post("/setup-api/first-setup/resolution/resume-selection", {
          ...pending,
          password: "wrong-password",
        });
        expect(wrongPassword.status).toBe(403);
        expect(await wrongPassword.json()).toMatchObject({
          error: { code: "setup.owner_required" },
        });
        const changedWorkspace = await post("/setup-api/first-setup/resolution/resume-selection", {
          ...pending,
          workspaceId: randomBytes(16).toString("hex"),
          password: PASSWORD,
        });
        expect(changedWorkspace.status).toBe(409);
        expect(await changedWorkspace.json()).toMatchObject({
          error: { code: "setup.attempt_conflict" },
        });
        const resumed = await post("/setup-api/first-setup/resolution/resume-selection", {
          ...pending,
          password: PASSWORD,
        });
        expect(resumed.status).toBe(200);
        expect(await resumed.json()).toEqual(selection);
        await closeAgent();
        await expectRestartExit(child);
        expect(await resolveFirstSetupWorkspace(f)).toEqual(target);
      }
      child = childProcess(script, f.env);
      await expect
        .poll(() => readFile(join(target.stateDir, "tls", "ca.crt")), { timeout: 45_000 })
        .toBeDefined();
      const selectedCa = await readFile(join(target.stateDir, "tls", "ca.crt"));
      agent = new Agent({ connect: { ca: selectedCa } });
      agentClosed = false;
      expect(await ready(child, origin, agent)).toEqual({ claimed: false });
      expect((await stat(join(target.venueDir, "venue.db"))).size).toBeGreaterThan(0);
      await child.stop();
      child = childProcess(script, f.env);
      expect(await ready(child, origin, agent)).toEqual({ claimed: false });
      expect(await resolveFirstSetupWorkspace(f)).toEqual(target);
      expect(await readFile(join(target.stateDir, "tls", "ca.crt"))).toEqual(selectedCa);
      expect(await readFile(join(f.stateDir, "tls", "ca.crt"))).toEqual(ca);
      expect(
        await Promise.all(
          [join(f.stateDir, "first-setup.json"), join(f.venueDir, "first-setup-claim.json")].map(
            (path) => readFile(path),
          ),
        ),
      ).toEqual(originals);
      expect(await readFile(join(f.stateDir, "restore-request.json"), "utf8")).toBe(
        "retired restore must not run",
      );
      expect(await readFile(join(f.stateDir, "reset-request.json"), "utf8")).toBe(
        "retired reset must not run",
      );
      await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await child.stop();
      await closeAgent();
    }
  },
  300_000,
);

it.each(["src/bin.ts", "src/node-entry.ts"])(
  "%s recovers the original password over its retained trusted HTTPS without creating the missing database",
  async (script) => {
    const f = await fixture();
    const host = createFirstSetupModuleHost({ ...f, modules: ALL_MODULES, environment: f.env });
    const claim = await host.owner.claimFirstSetup(
      { environment: "preproduction", request },
      randomBytes(32).toString("base64url"),
    );
    const frozen = (await host.store.read())!.frozen;
    await ensureBoxSecrets({
      stateDir: f.stateDir,
      hostnames: ["localhost", "waitron.local"],
      now: () => new Date(),
      listIpv4: () => ["127.0.0.1"],
    });
    const ca = await readFile(join(f.stateDir, "tls", "ca.crt"));
    const agent = new Agent({ connect: { ca } });
    const child = childProcess(script, { ...f.env, WAITRON_ENV: "production" });
    try {
      const origin = `https://127.0.0.1:${f.port}`;
      expect(await ready(child, origin, agent)).toEqual({ claimed: true, resolution: true });
      const get = (path: string) => fetch(`${origin}${path}`, { dispatcher: agent } as RequestInit);
      expect(await (await get("/setup-api/status")).json()).toEqual({
        provisioned: false,
        environment: "preproduction",
        needs: ["first-setup-resolution"],
      });
      expect(await (await get("/setup-api/discovery")).json()).toEqual({
        caDownloadAvailable: true,
      });
      const snapshot = await (await get("/setup-api/first-setup/resolution")).json();
      const body = {
        inspectionId: snapshot.inspectionId,
        revision: snapshot.revision,
        ownerGeneration: snapshot.ownerGeneration,
        clientClaimNonce: randomBytes(32).toString("base64url"),
        password: PASSWORD,
      };
      const post = (password: string, requestOrigin = origin) =>
        fetch(`${origin}/setup-api/first-setup/resolution/recover`, {
          dispatcher: agent,
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: requestOrigin },
          body: JSON.stringify({ ...body, password }),
        } as RequestInit);
      for (const response of [
        await post(PASSWORD, "https://another.test"),
        await post("wrong-password"),
      ]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: { code: "setup.owner_required" } });
      }
      const response = await post(PASSWORD);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toMatchObject({
        capability: expect.any(String),
        state: { attemptId: claim.state.attemptId, ownerGeneration: 2, status: "claimed" },
      });
      expect((await host.store.read())!.frozen).toEqual(frozen);
      await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(f.stateDir, "tls", "ca.crt"))).toEqual(ca);
    } finally {
      await child.stop();
      await agent.close();
    }
  },
);

it.each([
  { kind: "restore", intent: false, code: "setup.attempt_conflict" },
  { kind: "provision", intent: false, code: "setup.attempt_conflict" },
  { kind: "restore", intent: true, code: "setup.attempt_uncertain" },
  { kind: "provision", intent: true, code: "setup.attempt_conflict" },
])(
  "the real $kind command refuses outstanding setup (intent $intent) before placing or opening a database",
  async ({ kind, intent, code }) => {
    const f = await fixture();
    const host = createFirstSetupModuleHost({ ...f, modules: ALL_MODULES, environment: f.env });
    const claim = await host.owner.claimFirstSetup(
      { environment: "preproduction", request },
      randomBytes(32).toString("base64url"),
    );
    if (intent)
      await host.store.update(claim.state.attemptId, claim.state.revision, {
        kind: "consumption-intent",
      });
    const marker = await readFile(join(f.venueDir, "first-setup-claim.json"));
    const archive = join(f.root, "unopened-archive");
    await writeFile(archive, "retained-archive");
    const args =
      kind === "restore"
        ? ["restore", archive]
        : [
            "venue",
            "--venue-dir",
            f.venueDir,
            "--country",
            "ES",
            "--tax-id",
            request.taxId,
            "--legal-name",
            request.legalName,
            "--taxpayer-domicile",
            "Mayor 1, Madrid",
            "--location-name",
            "Olivo",
            "--territory",
            "ES-common",
            "--locale",
            "es-ES",
            "--operation-description",
            "Restaurante",
            "--address-line1",
            "Mayor 1",
            "--address-line2",
            "",
            "--postal-code",
            "28001",
            "--city",
            "Madrid",
            "--province",
            "Madrid",
            "--time-zone",
            "Europe/Madrid",
            "--day-cutover",
            "06:00",
            "--series-code",
            "B",
            "--rectificative-code",
            "R",
            "--admin-name",
            "Elena",
            "--admin-email",
            "elena@example.test",
            "--yes",
          ];
    const child = childProcess(
      kind === "restore" ? "src/bin-restore.ts" : "../../packages/provisioning/src/bin.ts",
      {
        ...f.env,
        WAITRON_ADMIN_PASSWORD: PASSWORD,
        WAITRON_ADMIN_PIN: "4826",
        WAITRON_BACKUP_RECOVERY_KEY: "synthetic-archive-secret",
      },
      args,
    );
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        child.exited,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Owned command did not exit: ${child.output()}`)),
            45_000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      expect(result).toEqual({ code: 1, signal: null });
      expect(child.output()).toContain(code);
      expect(child.output()).not.toContain(PASSWORD);
      expect(child.output()).not.toContain("synthetic-archive-secret");
      expect(await readFile(join(f.venueDir, "first-setup-claim.json"))).toEqual(marker);
      expect(await readFile(archive, "utf8")).toBe("retained-archive");
      await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await child.stop();
    }
  },
);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "hour-entry-process-"));
  roots.push(root);
  const stateDir = join(root, "state"),
    venueDir = join(root, "venue");
  await mkdir(stateDir);
  await mkdir(venueDir);
  const [port, landingPort] = await freePorts(2);
  const migrations = join(root, "migrations");
  await copyMigrationsRoot(migrations);
  const setupApp = join(root, "setup-app");
  await mkdir(join(setupApp, "assets"), { recursive: true });
  await writeFile(
    join(setupApp, "index.html"),
    '<!doctype html><div id="app"></div><script type="module" src="/assets/setup-fixture.js"></script>',
  );
  await writeFile(
    join(setupApp, "assets", "setup-fixture.js"),
    'document.querySelector("#app").textContent = "Setup fixture";',
  );
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("WAITRON_")),
  );
  Object.assign(env, {
    WAITRON_STATE_DIR: stateDir,
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_MIGRATIONS_DIR: migrations,
    WAITRON_HTTP_HOST: "127.0.0.1",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_ENV: "dev",
    WAITRON_SETUP_APP_DIR: setupApp,
  });
  return { root, stateDir, venueDir, port, landingPort, env };
}

function childProcess(script: string, env: NodeJS.ProcessEnv, args: string[] = []) {
  const child = spawn(process.execPath, ["--import", "tsx", resolve(script), ...args], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (bytes: Buffer) => {
    output += bytes.toString();
  });
  child.stderr.on("data", (bytes: Buffer) => {
    output += bytes.toString();
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((res, rej) => {
    child.once("error", rej);
    child.once("exit", (code, signal) => res({ code, signal }));
  });
  return {
    child,
    output: () => output,
    exited,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return exited;
      child.kill("SIGTERM");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          exited,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              child.kill("SIGKILL");
              reject(new Error(`Owned entry process ${child.pid} did not stop: ${output}`));
            }, 10_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        await exited;
      }
    },
  };
}

async function expectRestartExit(process: ReturnType<typeof childProcess>) {
  let result: Awaited<ReturnType<typeof childProcess>["exited"]> | undefined;
  const observed = process.exited.then((value) => {
    result = value;
  });
  await expect.poll(() => result, { timeout: 10_000 }).toEqual({ code: 0, signal: null });
  await observed;
}

async function ready(process: ReturnType<typeof childProcess>, url: string, agent?: Agent) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null || process.child.signalCode !== null)
      throw new Error(`Entry exited before listening: ${process.output()}`);
    try {
      const response = await fetch(`${url}/setup-api/first-setup/status`, {
        ...(agent === undefined ? {} : { dispatcher: agent }),
        signal: AbortSignal.timeout(1000),
      } as RequestInit);
      const value: unknown = await response.json();
      if (response.status === 200) return value;
    } catch {
      /* Wait only for the owned listener's actual response. */
    }
    await delay(25);
  }
  throw new Error(`Entry did not listen: ${process.output()}`);
}

it.each(["src/bin.ts", "src/node-entry.ts"])(
  "%s boots a fresh workspace and keeps its trusted setup listener available after restart",
  async (script) => {
    const f = await fixture();
    let child: ReturnType<typeof childProcess> | undefined;
    let agent: Agent | undefined;
    try {
      child = childProcess(script, f.env);
      await expect
        .poll(async () => readFile(join(f.stateDir, "tls", "ca.crt")), {
          timeout: 45_000,
        })
        .toBeDefined();
      const ca = await readFile(join(f.stateDir, "tls", "ca.crt"));
      agent = new Agent({ connect: { ca } });
      expect(await ready(child, `https://127.0.0.1:${f.port}`, agent)).toEqual({ claimed: false });
      expect((await stat(join(f.venueDir, "venue.db"))).size).toBeGreaterThan(0);
      await child.stop();
      child = childProcess(script, f.env);
      expect(await ready(child, `https://127.0.0.1:${f.port}`, agent)).toEqual({ claimed: false });
      expect(await readFile(join(f.stateDir, "tls", "ca.crt"))).toEqual(ca);
    } finally {
      await child?.stop();
      await agent?.close();
    }
  },
  180_000,
);

it.each([
  { script: "src/bin.ts", interrupted: "paired" },
  { script: "src/bin.ts", interrupted: "torn" },
  { script: "src/node-entry.ts", interrupted: "paired" },
  { script: "src/node-entry.ts", interrupted: "torn" },
  { script: "src/node-entry.ts", interrupted: "escalated" },
])(
  "$script serves only repair for $interrupted setup before opening a database or staged work",
  async ({ script, interrupted }) => {
    const f = await fixture();
    if (interrupted === "torn") {
      await writeFile(join(f.venueDir, "first-setup-claim.json"), "torn-write");
    } else {
      const host = createFirstSetupModuleHost({ ...f, modules: ALL_MODULES, environment: f.env });
      await host.owner.claimFirstSetup(
        { environment: "preproduction", request },
        randomBytes(32).toString("base64url"),
      );
    }
    if (interrupted === "escalated")
      await writeRecoveryState(f.stateDir, { ...FRESH, failures: 3, level: "recovery" });
    await writeFile(join(f.stateDir, "restore-request.json"), "retained-restore");
    await writeFile(join(f.stateDir, "reset-request.json"), "retained-reset");
    const marker = await readFile(join(f.venueDir, "first-setup-claim.json"));
    await ensureBoxSecrets({
      stateDir: f.stateDir,
      hostnames: ["localhost", "waitron.local"],
      now: () => new Date(),
      listIpv4: () => ["127.0.0.1"],
    });
    const agent = new Agent({ connect: { ca: await readFile(join(f.stateDir, "tls/ca.crt")) } });
    const fetch: typeof globalThis.fetch = (url, init) =>
      globalThis.fetch(url, { ...init, dispatcher: agent } as RequestInit);
    const child = childProcess(script, {
      ...f.env,
      WAITRON_HTTP_LANDING_PORT: String(f.landingPort),
    });
    try {
      const base = `https://127.0.0.1:${f.port}`;
      expect(await ready(child, base, agent)).toEqual({ claimed: true, resolution: true });
      const inspection = await fetch(`${base}/setup-api/first-setup/resolution`);
      expect(inspection.status).toBe(200);
      const inspected = await inspection.json();
      expect(inspected).toMatchObject({ database: "missing" });
      const shell = await fetch(base, { headers: { Accept: "text/html" } });
      expect(shell.status).toBe(200);
      expect(shell.headers.get("content-type")).toContain("text/html");
      expect(await shell.text()).toContain("/assets/setup-fixture.js");
      const asset = await fetch(`${base}/assets/setup-fixture.js`);
      expect(asset.status).toBe(200);
      expect(await asset.text()).toContain('"Setup fixture"');
      const status = await fetch(`${base}/setup-api/status`);
      expect(status.status).toBe(200);
      expect(await status.json()).toEqual({
        provisioned: false,
        environment: "preproduction",
        developmentMode: true,
        needs: ["first-setup-resolution"],
      });
      const discovery = await fetch(`${base}/setup-api/discovery`);
      expect(discovery.status).toBe(200);
      expect(await discovery.json()).toEqual({ caDownloadAvailable: true });
      for (const path of [
        "/retry",
        "/setup-api/provision",
        "/setup-api/restore",
        "/setup-api/first-setup/claim",
        "/api/till/session",
      ]) {
        const response = await fetch(`${base}${path}`, { method: "POST" });
        expect(response.status, path).toBe(404);
        await response.body?.cancel();
      }
      const refused = await globalThis.fetch(
        `http://127.0.0.1:${f.landingPort}/setup-api/first-setup/resolution/recover`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password: PASSWORD,
            inspectionId: inspected.inspectionId,
            revision: inspected.revision,
            ownerGeneration: inspected.ownerGeneration,
            clientClaimNonce: randomBytes(32).toString("base64url"),
          }),
        },
      );
      expect(refused.status).toBe(404);
      expect(await refused.text()).toBe("404 Not Found");
      await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(f.venueDir, "first-setup-claim.json"))).toEqual(marker);
      expect(await readFile(join(f.stateDir, "restore-request.json"), "utf8")).toBe(
        "retained-restore",
      );
      expect(await readFile(join(f.stateDir, "reset-request.json"), "utf8")).toBe("retained-reset");
    } finally {
      await child.stop();
      await agent.close();
    }
  },
);
