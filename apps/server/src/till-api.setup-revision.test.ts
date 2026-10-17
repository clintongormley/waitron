import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { locations, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createServiceZone } from "@waitron/venue-service";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { createCourse, updateCourse } from "./kitchen.js";
import {
  createBareDepartment,
  provisionSignedInTill,
  sendAsTill,
} from "./testing/signed-in-till.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let nifCounter = 0;
const nextNif = () => nifWithControlLetter(72_000_000 + ++nifCounter);

async function setupTill() {
  return provisionSignedInTill(suite.db, {
    taxId: nextNif(),
    dayCutover: "05:00",
    seed: async (tx, cfg) => {
      const departmentId = await createBareDepartment(tx, cfg, "Restaurant", new Date());
      const zone = await createServiceZone(tx, cfg, { name: "Barra", departmentId });
      return { departmentId, startingZoneId: zone.id };
    },
  });
}

type Till = Awaited<ReturnType<typeof setupTill>>;

async function menuStateRevision(till: Till): Promise<unknown> {
  const answer = await sendAsTill(till, "GET", "/api/menu-state");
  expect(answer.status).toBe(200);
  return answer.body.setupRevision;
}

describe("the till's setup revision", () => {
  it("the start read and menu-state name the same setup revision for one till", async () => {
    const till = await setupTill();
    const start = await sendAsTill(till, "GET", "/api/till");
    expect(start.status).toBe(200);
    expect(typeof start.body.setupRevision).toBe("string");
    expect(await menuStateRevision(till)).toBe(start.body.setupRevision);
  });

  it("the revision stays while nothing changes", async () => {
    const till = await setupTill();
    const first = await menuStateRevision(till);
    expect(typeof first).toBe("string");
    expect(await menuStateRevision(till)).toBe(first);
  });

  it("the revision moves when a course is added, when one is renamed, and when bump mode changes", async () => {
    const till = await setupTill();
    const seen = [await menuStateRevision(till)];
    const course = await withTransaction(suite.db, (tx) =>
      createCourse(tx, till.cfg, { name: "Entrantes" }),
    );
    seen.push(await menuStateRevision(till));
    await withTransaction(suite.db, (tx) =>
      updateCourse(tx, till.cfg, course.id, { name: "Primeros" }),
    );
    seen.push(await menuStateRevision(till));
    await withTransaction(suite.db, (tx) =>
      tx.update(locations).set({ bumpMode: "ticket" }).where(eq(locations.id, till.cfg.locationId)),
    );
    seen.push(await menuStateRevision(till));
    expect(seen.every((revision) => typeof revision === "string")).toBe(true);
    expect(new Set(seen).size).toBe(seen.length);
  });
});
