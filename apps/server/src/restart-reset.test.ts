import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { emptyDrainResult } from "@waitron/fiscal";
import { withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { FISCAL_SLOT } from "@waitron/fiscal-verifactu";
import { seedPendingEnvios } from "@waitron/fiscal-verifactu/test/drain-fixtures.js";
import { resetBeforeFirstDrain } from "./restart-reset.js";

const NOW = new Date("2026-07-21T00:01:00Z");

describe("resetBeforeFirstDrain", () => {
  it("resets before the first drain of this boot and never again", async () => {
    const calls: string[] = [];
    const drain = resetBeforeFirstDrain(
      async () => {
        calls.push("reset");
      },
      async () => {
        calls.push("drain");
        return emptyDrainResult();
      },
    );

    await drain(NOW);
    await drain(NOW);

    expect(calls).toEqual(["reset", "drain", "drain"]);
  });

  it("does not drain when the reset fails, and tries the reset again on the next pass", async () => {
    const calls: string[] = [];
    let failures = 1;
    const drain = resetBeforeFirstDrain(
      async () => {
        calls.push("reset");
        if (failures-- > 0) throw new Error("database busy");
      },
      async () => {
        calls.push("drain");
        return emptyDrainResult();
      },
    );

    await expect(drain(NOW)).rejects.toThrow("database busy");
    await drain(NOW);

    expect(calls).toEqual(["reset", "reset", "drain"]);
  });

  it("runs one reset when two first passes overlap", async () => {
    const calls: string[] = [];
    const drain = resetBeforeFirstDrain(
      async () => {
        calls.push("reset");
        await new Promise((resolve) => setImmediate(resolve));
      },
      async () => {
        calls.push("drain");
        return emptyDrainResult();
      },
    );

    await Promise.all([drain(NOW), drain(NOW)]);

    expect(calls).toEqual(["reset", "drain", "drain"]);
  });
});

describe("resetBeforeFirstDrain over the Veri*Factu seat", () => {
  const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

  const claim = (registroId: string) =>
    withTransaction(suite.db, (tx) =>
      tx.execute(sql`
        update envios set estado = 'enviando', enviado_en = ${new Date(NOW.getTime() - 1_000).toISOString()}
        where registro_id = ${registroId}
      `),
    );
  const estadoOf = async (registroId: string) =>
    (
      await suite.db.execute<{ estado: string }>(
        sql`select estado from envios where registro_id = ${registroId}`,
      )
    ).rows[0]?.estado;

  it("releases a previous run's claim, and leaves a claim this boot's own drain made", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    const [inherited, ownClaim] = seeded.registroIds as [string, string];
    await claim(inherited);

    const drain = resetBeforeFirstDrain(
      (at) => FISCAL_SLOT.resetInFlight({ db: suite.db }, at),
      async () => emptyDrainResult(),
    );

    await drain(NOW);
    expect(await estadoOf(inherited)).toBe("pendiente");

    await claim(ownClaim);
    await drain(NOW);
    expect(await estadoOf(ownClaim)).toBe("enviando");
  });
});
