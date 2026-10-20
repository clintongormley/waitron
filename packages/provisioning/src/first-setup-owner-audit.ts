import "./errors.js";
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "@waitron/shared";
import { createFirstSetupCoordinator, type FirstSetupState } from "./first-setup-state.js";
import { createFirstSetupResolutionStore } from "./first-setup-resolution.js";
import type { createFirstSetupResolutionInspection } from "./first-setup-resolution-inspection.js";

export function createFirstSetupOwnerAudit(
  state: FirstSetupState,
  inspection: ReturnType<typeof createFirstSetupResolutionInspection>,
) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        "waitron-owner-audit-v1",
        state.stateDir,
        state.venueDir,
        state.frozen.attemptId,
      ]),
    )
    .digest("hex");
  const resolutionId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  // The caller already holds the venue exclusion and setup coordinator.
  const records = createFirstSetupResolutionStore({
    stateDir: state.stateDir,
    venueDir: state.venueDir,
    coordinator: createFirstSetupCoordinator(),
  });
  return {
    async reconcile(before: FirstSetupState): Promise<void> {
      const first = await lstat(
        join(state.stateDir, "first-setup-resolutions", resolutionId, "000001.json"),
      ).catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return null;
        throw error;
      });
      if (first === null) return;
      const history = await records.read(resolutionId);
      const last = history[history.length - 1]!;
      if (last.phase === "applied") {
        await records.apply(history[history.length - 2]!);
        return;
      }
      if (
        last.register !== null ||
        last.authority !== "original-password" ||
        last.attemptId !== before.frozen.attemptId ||
        !["marker-repair", "ownership-rebind"].includes(last.action)
      )
        throw new AppError("setup.attempt_invalid", {});
      const originals = await records.readOriginals(resolutionId, last.sequence);
      const original = (name: string) => {
        const bytes = originals.find((entry) => entry.name === name)?.bytes;
        if (bytes == null) throw new AppError("setup.attempt_invalid", {});
        return bytes;
      };
      const source = JSON.parse(
        original("state/first-setup.json").toString("utf8"),
      ) as FirstSetupState;
      if (
        source.revision !== last.observedRevision ||
        source.ownerGeneration !== last.observedOwnerGeneration
      )
        throw new AppError("setup.attempt_invalid", {});
      const snapshot = await inspection.captureFirstSetupOriginals();
      const mutated =
        last.action === "marker-repair" ? "venue/first-setup-claim.json" : "state/first-setup.json";
      if (
        !isDeepStrictEqual(
          originals.filter((entry) => entry.name !== mutated),
          snapshot.originals.filter((entry) => entry.name !== mutated),
        )
      )
        throw new AppError("setup.attempt_conflict", {});
      if (last.action === "marker-repair") {
        if (!isDeepStrictEqual(source, before)) throw new AppError("setup.attempt_conflict", {});
        const oldMarker: unknown = JSON.parse(original(mutated).toString("utf8"));
        const current = snapshot.originals.find((entry) => entry.name === mutated)?.bytes;
        if (current == null || typeof oldMarker !== "object" || oldMarker === null)
          throw new AppError("setup.attempt_invalid", {});
        const marker: unknown = JSON.parse(current.toString("utf8"));
        if (isDeepStrictEqual(marker, oldMarker)) return;
        if (
          !isDeepStrictEqual(marker, {
            ...oldMarker,
            status: source.status === "abandoned" ? "abandoned" : "active",
          })
        )
          throw new AppError("setup.attempt_conflict", {});
      } else {
        if (isDeepStrictEqual(source, before)) return;
        if (
          !isDeepStrictEqual(before, {
            ...source,
            revision: source.revision + 1,
            ownerGeneration: source.ownerGeneration + 1,
            capabilityHash: before.capabilityHash,
            claimNonceHash: before.claimNonceHash,
            status: source.status === "complete" ? "publication" : source.status,
            history: [
              ...source.history,
              {
                kind: "recover",
                revision: source.revision + 1,
                ownerGeneration: source.ownerGeneration + 1,
              },
            ],
          })
        )
          throw new AppError("setup.attempt_conflict", {});
      }
      await records.apply(last);
    },
    async perform<T>(
      action: "marker-repair" | "ownership-rebind",
      before: FirstSetupState,
      body: () => Promise<T>,
    ): Promise<T> {
      const snapshot = await inspection.captureFirstSetupOriginals();
      if (
        snapshot.inspection.revision !== before.revision ||
        snapshot.inspection.ownerGeneration !== before.ownerGeneration
      )
        throw new AppError("setup.attempt_conflict", {});
      const prepared = await records.prepare(
        {
          resolutionId,
          attemptId: before.frozen.attemptId,
          observedRevision: before.revision,
          observedOwnerGeneration: before.ownerGeneration,
          database:
            snapshot.inspection.database === "missing"
              ? "missing"
              : snapshot.inspection.repairEligible
                ? "empty-preactivation"
                : "unknown-or-nonempty",
          authority: "original-password",
          register: null,
          action,
          nextWorkspace: null,
        },
        snapshot.originals,
      );
      const result = await body();
      await records.apply(prepared);
      return result;
    },
  };
}
