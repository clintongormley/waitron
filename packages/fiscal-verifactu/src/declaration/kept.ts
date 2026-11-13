import { eq } from "drizzle-orm";
import type { FiscalDeclarationsSeat } from "@waitron/fiscal";
import { declaracionesResponsables } from "../schema/declarations.js";

export const keptDeclarations: FiscalDeclarationsSeat = {
  async keep(tx, { version, text, at }) {
    await tx
      .insert(declaracionesResponsables)
      .values({ version, text, firstStartedAt: at })
      .onConflictDoNothing({ target: declaracionesResponsables.version });
  },
  async versions(tx) {
    const rows = await tx
      .select({ version: declaracionesResponsables.version })
      .from(declaracionesResponsables);
    return rows.map((row) => row.version);
  },
  async text(tx, version) {
    const rows = await tx
      .select({ text: declaracionesResponsables.text })
      .from(declaracionesResponsables)
      .where(eq(declaracionesResponsables.version, version));
    return rows[0]?.text ?? null;
  },
};
