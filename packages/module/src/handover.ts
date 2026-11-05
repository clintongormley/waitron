import type { CanonicalValue } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import type { BackupQuery } from "@waitron/store";
import type { WaitronModule } from "./module.js";
import "./errors.js";

/** What a module vouches for, and checks, in a copy of the venue database handed to another box. */
export interface ModuleHandoverContribution {
  summarise(query: BackupQuery): Promise<CanonicalValue>;
  checkCopy?(query: BackupQuery): Promise<"ok" | "broken">;
}

function byName(modules: readonly WaitronModule[]): WaitronModule[] {
  return [...modules].sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Callers pass the enabled modules. */
export async function collectHandoverSummaries(
  modules: readonly WaitronModule[],
  query: BackupQuery,
): Promise<Record<string, CanonicalValue>> {
  const summaries: Record<string, CanonicalValue> = {};
  for (const m of byName(modules)) {
    if (m.handover === undefined) continue;
    try {
      summaries[m.name] = await m.handover.summarise(query);
    } catch (e) {
      throw new AppError(
        "handover.summary_failed",
        { module: m.name },
        { reason: e instanceof Error ? e.message : String(e) },
      );
    }
  }
  return summaries;
}

export async function checkHandoverCopy(
  modules: readonly WaitronModule[],
  query: BackupQuery,
): Promise<{ ok: true } | { ok: false; module: string }> {
  for (const m of byName(modules)) {
    const handover = m.handover;
    if (handover?.checkCopy === undefined) continue;
    let answer: "ok" | "broken";
    try {
      answer = await handover.checkCopy(query);
    } catch (e) {
      throw new AppError(
        "handover.copy_check_failed",
        { module: m.name },
        { reason: e instanceof Error ? e.message : String(e) },
      );
    }
    if (answer === "broken") return { ok: false, module: m.name };
  }
  return { ok: true };
}
