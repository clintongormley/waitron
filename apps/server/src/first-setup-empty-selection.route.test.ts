import { randomBytes } from "node:crypto";
import { mkdtemp, realpath, readFile, rm, stat, writeFile } from "node:fs/promises";
import * as filesystem from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Agent } from "undici";
import { afterEach, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  createFirstSetupResolutionStore,
  createFirstSetupCoordinator,
  resolveFirstSetupWorkspace,
  type FirstSetupFrozen,
} from "@waitron/provisioning";
import { createFirstSetupOwner } from "./first-setup-owner.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { startServerOrFirstSetupResolution } from "./node-entry.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { freePorts } from "./testing/free-ports.js";
import { request, PASSWORD } from "../test/first-fiscal.js";

vi.mock("node:fs/promises", { spy: true });
afterEach(() => vi.restoreAllMocks());
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const noMaster = { kind: "no-current-master", confirmed: true } as const;

async function fixture(
  point = "first-setup-workspace.json",
  tls = true,
  outsideHistory = false,
  passwordRetirement = false,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "empty-selection-")));
  const roots = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  let server: { close(): Promise<void> } | undefined;
  let agent: Agent | undefined;
  try {
    const host = createFirstSetupModuleHost({ ...roots, environment: {}, modules: [] });
    const owner = createFirstSetupOwner({
      ...roots,
      store: host.store,
      coordinator: host.coordinator,
      bootId: "empty-test",
      freeze: async (
        request: FirstSetupFrozen["request"],
        environment: FirstSetupFrozen["environment"],
        ids: Pick<FirstSetupFrozen, "attemptId" | "nodeId" | "administratorId">,
      ) => ({
        ...ids,
        sourceId: `first-setup:${ids.attemptId}`,
        request,
        environment,
        modules: [],
      }),
    });
    const claim = await owner.claimFirstSetup(
      { environment: "production", request },
      randomBytes(32).toString("base64url"),
    );
    await host.store.update(claim.state.attemptId, 1, { kind: "abandoned" });
    await suite.db.archiveTo(join(roots.venueDir, "venue.db"));
    let recovered;
    if (passwordRetirement) {
      const inspection = await host.resolution.inspectFirstSetupResolution();
      recovered = await host.owner.recoverFirstSetupOwner({
        inspectionId: inspection.inspectionId,
        revision: inspection.revision!,
        ownerGeneration: inspection.ownerGeneration!,
        password: PASSWORD,
        clientClaimNonce: randomBytes(32).toString("base64url"),
      });
    }
    if (tls)
      await ensureBoxSecrets({
        stateDir: roots.stateDir,
        hostnames: ["localhost"],
        now: () => new Date(),
        listIpv4: () => ["127.0.0.1"],
      });
    const stateBefore = await readFile(join(roots.stateDir, "first-setup.json"));
    const dbBefore = await readFile(join(roots.venueDir, "venue.db"));
    const inspected = await host.resolution.inspectFirstSetupResolution();
    expect(inspected.database).toBe("no-venue-rows");
    const actual = (await vi.importActual<typeof filesystem>("node:fs/promises")).rename;
    let injected = false;
    vi.spyOn(filesystem, "rename").mockImplementation(async (from, to) => {
      if (String(to).endsWith(point) && !injected) {
        injected = true;
        throw new Error("empty selection interruption");
      }
      await actual(from, to);
    });
    const actions = createFirstSetupResolutionActions({ ...roots, host });
    await expect(
      actions.startAgainFirstSetup({
        inspectionId: inspected.inspectionId,
        revision: inspected.revision!,
        ownerGeneration: inspected.ownerGeneration!,
        register: noMaster,
        ...(recovered === undefined
          ? {}
          : {
              owner: {
                attemptId: recovered.state.attemptId,
                revision: recovered.state.revision,
                ownerGeneration: recovered.state.ownerGeneration,
                capability: recovered.capability,
              },
            }),
      }),
    ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
    expect(injected).toBe(true);
    vi.mocked(filesystem.rename).mockRestore();
    const [port] = await freePorts(1);
    const restart = vi.fn();
    server = await startServerOrFirstSetupResolution(
      {
        WAITRON_STATE_DIR: roots.stateDir,
        WAITRON_VENUE_DIR: roots.venueDir,
        WAITRON_HTTP_HOST: "127.0.0.1",
        WAITRON_HTTP_PORT: String(port),
        ...(outsideHistory
          ? { WAITRON_FISCAL_PAPER_HISTORY_FILE: join(root, "new-outside-history.json") }
          : {}),
      },
      {},
      { requestRestart: restart },
    );
    agent = tls
      ? new Agent({ connect: { ca: await readFile(join(roots.stateDir, "tls/ca.crt")) } })
      : new Agent();
    const origin = `${tls ? "https" : "http"}://127.0.0.1:${port}`;
    const get = async () => {
      const response = await fetch(`${origin}/setup-api/first-setup/resolution/selection`, {
        dispatcher: agent,
      } as RequestInit);
      expect(response.status).toBe(200);
      return response.json();
    };
    const post = (body: unknown, headers = {}) =>
      fetch(`${origin}/setup-api/first-setup/resolution/resume-selection`, {
        method: "POST",
        dispatcher: agent,
        headers: { "Content-Type": "application/json", Origin: origin, ...headers },
        body: JSON.stringify(body),
      } as RequestInit);
    return {
      root,
      roots,
      host,
      actions,
      get,
      post,
      restart,
      stateBefore,
      dbBefore,
      dispose: async () => {
        await server?.close();
        await agent?.close();
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await server?.close();
    await agent?.close();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

it.each(["first-setup-workspace.json", "first-setup-selection.json", "000004.json"])(
  "HTTPS resumes the same authorised empty reset without a password after %s",
  async (point) => {
    const f = await fixture(point);
    try {
      const inspection = await f.get();
      const response = await f.post({ ...inspection, register: noMaster });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        workspaceId: inspection.workspaceId,
        selectionGeneration: 1,
        restarting: true,
      });
      await vi.waitFor(() => expect(f.restart).toHaveBeenCalledOnce());
      const selected = await resolveFirstSetupWorkspace(f.roots);
      expect(selected.binding?.workspaceId).toBe(inspection.workspaceId);
      expect(await readFile(join(f.roots.stateDir, "first-setup.json"))).toEqual(f.stateBefore);
      expect(await readFile(join(f.roots.venueDir, "venue.db"))).toEqual(f.dbBefore);
      await expect(stat(join(selected.venueDir, "venue.db"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      const records = await createFirstSetupResolutionStore({
        ...f.roots,
        coordinator: createFirstSetupCoordinator(),
      }).read(selected.binding!.resolutionId);
      expect(
        records.map(({ action, phase, authority, register }) => ({
          action,
          phase,
          authority,
          register,
        })),
      ).toEqual([
        {
          action: "retire",
          phase: "prepared",
          authority: "local-empty-no-custodian",
          register: noMaster,
        },
        {
          action: "retire",
          phase: "applied",
          authority: "local-empty-no-custodian",
          register: noMaster,
        },
        {
          action: "select-workspace",
          phase: "prepared",
          authority: "local-empty-no-custodian",
          register: noMaster,
        },
        {
          action: "select-workspace",
          phase: "applied",
          authority: "local-empty-no-custodian",
          register: noMaster,
        },
      ]);
      const replay = await f.post({ ...inspection, register: noMaster });
      expect(replay.status).toBe(409);
    } finally {
      await f.dispose();
    }
  },
);

it("HTTP refuses the empty-reset declaration despite forwarded HTTPS", async () => {
  const f = await fixture("first-setup-selection.json", false);
  try {
    const inspection = await f.get();
    const response = await f.post(
      { ...inspection, register: noMaster },
      { "X-Forwarded-Proto": "https" },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "setup.owner_required" } });
    expect(f.restart).not.toHaveBeenCalled();
  } finally {
    await f.dispose();
  }
});

it("serialises competing password-free resumptions of the same empty reset", async () => {
  const f = await fixture();
  try {
    const inspection = await f.get();
    const responses = await Promise.all([
      f.post({ ...inspection, register: noMaster }),
      f.post({ ...inspection, register: noMaster }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    await vi.waitFor(() => expect(f.restart).toHaveBeenCalledOnce());
  } finally {
    await f.dispose();
  }
});

it("rejects altered observations and ambiguous authority without selecting a workspace", async () => {
  const f = await fixture();
  try {
    const inspection = await f.get();
    for (const [body, status, code] of [
      [{ ...inspection, register: noMaster, password: "ambiguous" }, 400, "setup.request_invalid"],
      [{ ...inspection }, 400, "setup.request_invalid"],
      [
        { ...inspection, register: { ...noMaster, confirmed: false } },
        400,
        "setup.request_invalid",
      ],
      [
        { ...inspection, register: noMaster, inspectionId: "a".repeat(64) },
        409,
        "setup.attempt_conflict",
      ],
      [{ ...inspection, register: noMaster, ownerGeneration: 999 }, 409, "setup.attempt_conflict"],
    ] as const) {
      const response = await f.post(body);
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ error: { code } });
    }
    await expect(resolveFirstSetupWorkspace(f.roots)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
    expect(f.restart).not.toHaveBeenCalled();
  } finally {
    await f.dispose();
  }
});

it.each(["module-operation-public.json", "first-setup-node-key.json", "trading.env"])(
  "refuses an empty-reset resumption when %s appears after retirement",
  async (name) => {
    const f = await fixture();
    try {
      const inspection = await f.get();
      await writeFile(join(f.roots.stateDir, name), "{}");
      const response = await f.post({ ...inspection, register: noMaster });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "setup.attempt_uncertain" } });
      expect(f.restart).not.toHaveBeenCalled();
    } finally {
      await f.dispose();
    }
  },
);

it("a newly configured but missing outside register cannot resume an empty reset without a password", async () => {
  const f = await fixture("first-setup-selection.json", true, true);
  try {
    const inspection = await f.get();
    const response = await f.post({ ...inspection, register: noMaster });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "setup.not_ready" } });
    expect(f.restart).not.toHaveBeenCalled();
  } finally {
    await f.dispose();
  }
});

it("an unused password-authorised retirement still requires its original password", async () => {
  const f = await fixture("first-setup-workspace.json", true, false, true);
  try {
    const inspection = await f.get();
    const refused = await f.post({ ...inspection, register: noMaster });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ error: { code: "setup.not_ready" } });
    const permitted = await f.post({ ...inspection, password: PASSWORD });
    expect(permitted.status).toBe(200);
    expect((await resolveFirstSetupWorkspace(f.roots)).binding?.workspaceId).toBe(
      inspection.workspaceId,
    );
  } finally {
    await f.dispose();
  }
});

it("rechecks the empty proof against the current image before resuming local reset", async () => {
  const f = await fixture();
  try {
    const host = createFirstSetupModuleHost({
      ...f.roots,
      environment: { WAITRON_MIGRATIONS_DIR: "/missing/setup-empty-proof-migrations" },
      modules: [],
    });
    const actions = createFirstSetupResolutionActions({ ...f.roots, host });
    const inspection = await actions.inspectWorkspaceSelection();
    expect(inspection).not.toBeNull();
    await expect(
      actions.resumeWorkspaceSelection({ ...inspection!, register: noMaster }),
    ).rejects.toMatchObject({ code: "setup.not_ready" });
    await expect(resolveFirstSetupWorkspace(f.roots)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
  } finally {
    await f.dispose();
  }
});
