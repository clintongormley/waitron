import { withFoldedPersonKeys } from "@waitron/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, RESTRICT_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { persons } from "./identity/persons.js";
import { incidents } from "./incidents.js";

describe("incident handlers", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  const insert = () =>
    suite.db
      .insert(incidents)
      .values({
        source: "backup",
        code: "backup.stream_behind",
        severity: "warning",
        detectedAt: "2026-11-14T12:00:00.000Z",
      })
      .returning();

  it("refuses handling an incident by a person who does not exist", async () => {
    const [incident] = await insert();
    const error = await captureError(() =>
      suite.db
        .update(incidents)
        .set({ acknowledgedBy: "missing" })
        .where(eq(incidents.id, incident!.id)),
    );
    expect(FOREIGN_KEY_VIOLATION).toContain((error as { errcode: number } | undefined)?.errcode);
    expect((await suite.db.select().from(incidents))[0]!.acknowledgedBy).toBeNull();
  });

  it("accepts a real person", async () => {
    const [person] = await suite.db
      .insert(persons)
      .values(withFoldedPersonKeys({ displayName: "Manager" }))
      .returning();
    const [incident] = await insert();
    const [handled] = await suite.db
      .update(incidents)
      .set({ acknowledgedBy: person!.id })
      .where(eq(incidents.id, incident!.id))
      .returning();
    expect(handled!.acknowledgedBy).toBe(person!.id);
  });

  it("refuses deleting a person who handled an incident", async () => {
    const [person] = await suite.db
      .insert(persons)
      .values(withFoldedPersonKeys({ displayName: "Manager" }))
      .returning();
    const [incident] = await insert();
    await suite.db
      .update(incidents)
      .set({ acknowledgedBy: person!.id })
      .where(eq(incidents.id, incident!.id));
    const error = await captureError(() =>
      suite.db.delete(persons).where(eq(persons.id, person!.id)),
    );
    expect(RESTRICT_VIOLATION).toContain((error as { errcode: number } | undefined)?.errcode);
    expect((await suite.db.select().from(persons)).map((row) => row.id)).toEqual([person!.id]);
  });

  it("accepts an incident handled by no person", async () => {
    const [incident] = await insert();
    const [handled] = await suite.db
      .update(incidents)
      .set({ acknowledgedAt: "2026-11-14T12:01:00.000Z", acknowledgedBy: null })
      .where(eq(incidents.id, incident!.id))
      .returning();
    expect(handled).toMatchObject({
      acknowledgedAt: "2026-11-14T12:01:00.000Z",
      acknowledgedBy: null,
    });
  });
});
