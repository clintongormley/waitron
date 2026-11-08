import { randomBytes } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ALL_MODULES } from "@waitron/composition";
import { expect, it } from "vitest";
import { Agent } from "undici";
import { request, PASSWORD } from "../test/first-fiscal.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { FRESH, writeRecoveryState } from "./recovery-state.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { childProcess, entryWorkspaces, ready } from "../test/first-fiscal-hour-entry.js";

const fixture = entryWorkspaces();

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
            "--venue-name",
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
    const child = await childProcess(
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
    const child = await childProcess(script, f.env, [], { landing: true });
    try {
      const base = `https://127.0.0.1:${child.port}`;
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
        `http://127.0.0.1:${child.landingPort}/setup-api/first-setup/resolution/recover`,
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
