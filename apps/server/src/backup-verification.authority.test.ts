import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { verificationNode } from "./testing/backup-verification-fixture.js";
import { afterEach, expect, it, vi } from "vitest";
import { verifyBackupArtifact } from "./backup-verification-entry.js";
import { readBackupVerificationResult } from "./backup-verification-protocol.js";
import {
  logicalDatabase,
  querySnapshot,
  useBackupVerificationFixture,
} from "./testing/backup-verification-fixture.js";

vi.mock("node:crypto", { spy: true });
const suite = useBackupVerificationFixture();
afterEach(() => vi.restoreAllMocks());

it("genuine complete archive passes without operational authority", async () => {
  const f = await suite.create();
  const bytes = await readFile(f.deps.artifactPath);
  const answer = await verifyBackupArtifact(f.request, f.deps);
  expect(answer.status).toBe("passed");
  expect(answer.reason).toBe("none");
  expect(answer.activation).toBe("not_attempted");
  expect(answer.modules.map((m) => m.name)).toEqual(
    f.request.target.modules.map((m) => m.name).sort(),
  );
  expect(answer.modules.every((m) => m.status === "passed")).toBe(true);
  expect(answer.modules.find((m) => m.name === "fiscal-verifactu")?.checks).toEqual(
    ["chain", "history", "secret", "entries"].map((code) => ({ code, status: "passed" })),
  );
  expect(readBackupVerificationResult(JSON.stringify(answer), f.request)).toEqual(answer);
  expect(logicalDatabase(f.databasePath)).toEqual(f.logical);
  expect(await readFile(f.deps.artifactPath)).toEqual(bytes);
  expect(await readdir(f.deps.scratchRoot)).toEqual([]);
});

async function prohibitOperationalCalls() {
  const [
    module,
    db,
    sale,
    allocation,
    envelope,
    preparation,
    lifecycle,
    registry,
    chain,
    paper,
    drain,
    host,
    first,
    crypto,
  ] = await Promise.all([
    import("@waitron/module"),
    import("@waitron/db"),
    import("@waitron/core"),
    import("@waitron/fiscal-verifactu/src/allocation.js"),
    import("@waitron/fiscal-verifactu/src/allocation-envelope.js"),
    import("@waitron/fiscal-verifactu/src/allocation-preparation.js"),
    import("@waitron/fiscal-verifactu/src/allocated-lifecycle.js"),
    import("@waitron/fiscal-verifactu/src/registro-sif.js"),
    import("@waitron/fiscal-verifactu/src/chain.js"),
    import("@waitron/fiscal-verifactu/src/paper-evidence.js"),
    import("@waitron/fiscal-verifactu/src/drain.js"),
    import("./boot.js"),
    import("./first-fiscal-activation.js"),
    import("node:crypto"),
  ]);
  const forbidden = () => {
    throw new Error("verification attempted an operational effect");
  };
  return [
    vi.spyOn(module, "withOperationAuthority").mockImplementation(forbidden),
    vi.spyOn(db, "allocateInvoiceNumber").mockImplementation(forbidden),
    vi.spyOn(db, "insertNodeSeriesTx").mockImplementation(forbidden),
    vi.spyOn(db, "retireNodeSeriesTx").mockImplementation(forbidden),
    vi.spyOn(sale, "recordSale").mockImplementation(forbidden),
    vi.spyOn(allocation, "activateAllocation").mockImplementation(forbidden),
    vi.spyOn(envelope, "withHourAdmission").mockImplementation(forbidden),
    vi.spyOn(envelope, "drawEmergencyIdentity").mockImplementation(forbidden),
    vi.spyOn(preparation, "activatePreparedModuleAllocation").mockImplementation(forbidden),
    vi.spyOn(preparation, "createAllocationPreparation").mockImplementation(forbidden),
    vi.spyOn(lifecycle, "activatePreparedFiscalStandby").mockImplementation(forbidden),
    vi.spyOn(registry, "registerSif").mockImplementation(forbidden),
    vi.spyOn(registry, "writeReservedSif").mockImplementation(forbidden),
    vi.spyOn(chain, "appendToChain").mockImplementation(forbidden),
    vi.spyOn(chain, "readChainHead").mockImplementation(forbidden),
    vi.spyOn(paper, "signPaperBlock").mockImplementation(forbidden),
    vi.spyOn(paper, "signPaperConsumption").mockImplementation(forbidden),
    vi.spyOn(paper, "signPaperReservationForBlock").mockImplementation(forbidden),
    vi.spyOn(drain, "drain").mockImplementation(forbidden),
    vi.spyOn(host, "startServer").mockImplementation(forbidden),
    vi.spyOn(host, "startLandingListener").mockImplementation(forbidden),
    vi.spyOn(host, "withAutomaticCardRecovery").mockImplementation(forbidden),
    vi.spyOn(host, "withPendingSweep").mockImplementation(forbidden),
    vi.spyOn(host, "withPendingBillPayments").mockImplementation(forbidden),
    vi.spyOn(first, "activateFirstFiscal").mockImplementation(forbidden),
    vi.spyOn(first, "finishFirstFiscalSetup").mockImplementation(forbidden),
    vi.spyOn(crypto, "sign").mockImplementation(forbidden),
    vi.spyOn(globalThis, "fetch").mockImplementation(forbidden),
  ];
}

it.each(["passed", "wrong-key", "invalid-chain", "undeclared-entry"])(
  "verification never prepares activates promotes signs numbers or trades: %s",
  async (kind) => {
    const f = await suite.create();
    if (kind === "wrong-key") f.deps.recoveryKey.secret = "wrong-disposable-key";
    if (kind === "invalid-chain")
      await f.corrupt((db) =>
        db
          .prepare("update registros_facturacion set huella=? where secuencia=1")
          .run("0".repeat(64)),
      );
    let exposed = false;
    let comparisons = 0;
    const hooks = f.deps.modules.map((module) => {
      const restored = vi.fn(() => {
        throw new Error("ordinary restore hook entered");
      });
      const owner = module.backup!.verification!;
      return {
        ...module,
        backup: {
          ...module.backup,
          restore: restored,
          verification:
            kind === "undeclared-entry" && module.name === "core"
              ? {
                  ...owner,
                  async verifyRestoredData(
                    context: Parameters<typeof owner.verifyRestoredData>[0],
                  ) {
                    await context.entries.read("secrets/tls/ca.key");
                    exposed = true;
                    return owner.verifyRestoredData(context);
                  },
                }
              : owner,
        },
      };
    });
    f.deps.modules = hooks.map((module) => {
      const owner = module.backup.verification;
      return {
        ...module,
        backup: {
          ...module.backup,
          verification: {
            ...owner,
            async verifyRestoredData(context: Parameters<typeof owner.verifyRestoredData>[0]) {
              expect(await querySnapshot(context.after)).toEqual(
                await querySnapshot(context.before),
              );
              comparisons++;
              return owner.verifyRestoredData(context);
            },
          },
        },
      };
    });
    const restore = await import("./restore.js");
    const spies = [
      ...(await prohibitOperationalCalls()),
      vi.spyOn(restore, "writeValidated").mockImplementation(() => {
        throw new Error("ordinary restore attempted");
      }),
      vi.spyOn(restore, "runRestoreHooks").mockImplementation(() => {
        throw new Error("ordinary hooks attempted");
      }),
    ];
    const bytes = await readFile(f.deps.artifactPath);
    const answer = await verifyBackupArtifact(f.request, f.deps);
    expect(answer.status).toBe(
      kind === "passed"
        ? "passed"
        : kind === "wrong-key"
          ? "unavailable"
          : kind === "invalid-chain"
            ? "invalid"
            : "unsupported",
    );
    expect(answer.activation).toBe("not_attempted");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const module of hooks) expect(module.backup.restore).not.toHaveBeenCalled();
    expect(exposed).toBe(false);
    expect(comparisons).toBe(
      kind === "wrong-key"
        ? 0
        : kind === "undeclared-entry"
          ? 1
          : f.request.target.modules.filter((m) => f.request.archive.modules[m.name]! > 0).length,
    );
    expect(logicalDatabase(f.databasePath)).toEqual(f.logical);
    expect(await readFile(f.deps.artifactPath)).toEqual(bytes);
    expect(await readdir(f.deps.scratchRoot)).toEqual([]);
  },
);

it("ordinary restore still refuses absent authority after verification passed", async () => {
  const f = await suite.create();
  expect((await verifyBackupArtifact(f.request, f.deps)).status).toBe("passed");
  const { runRestoreHooks } = await import("./restore.js");
  await expect(
    runRestoreHooks({ db: f.db, modules: f.deps.modules, node: verificationNode, log: () => {} }),
  ).rejects.toMatchObject({
    code: "restore.hook_failed",
    params: { module: "fiscal-verifactu", code: "sif.allocation_invalid" },
  });
  const path = join(f.root, "after-refused-restore.db");
  await f.db.archiveTo(path);
  expect(logicalDatabase(path)).toEqual(f.logical);
});

it("ordinary authorised restore still needs genuine binding", async () => {
  const f = await suite.create();
  const { withOperationAuthority } = await import("@waitron/module");
  const { runRestoreHooks } = await import("./restore.js");
  const binding = {
    module: "fiscal-verifactu",
    action: "restore",
    eventId: "fresh-recovery",
    sourceId: "capture-authority",
    targetNodeId: verificationNode.nodeId,
  };
  await withOperationAuthority(binding, "fixture-administrator", async (authority) => {
    await expect(
      runRestoreHooks({
        db: f.db,
        modules: f.deps.modules,
        node: verificationNode,
        log: () => {},
        moduleOperations: new Map([[binding.module, { binding, authority, input: {} }]]),
      }),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
  });
  const path = join(f.root, "after-unbound-restore.db");
  await f.db.archiveTo(path);
  expect(logicalDatabase(path)).toEqual(f.logical);
});

it("genuine archive checks encrypted account enrolment with the managed host key", async () => {
  const f = await suite.create();
  expect(f.logical.totp_enrollments).toHaveLength(1);
  const answer = await verifyBackupArtifact(f.request, f.deps);
  expect(answer.status).toBe("passed");
  expect(answer.modules.find((m) => m.name === "identity")?.checks).toContainEqual({
    code: "secret",
    status: "passed",
  });
  expect(logicalDatabase(f.databasePath)).toEqual(f.logical);
  expect(await readdir(f.deps.scratchRoot)).toEqual([]);
});
