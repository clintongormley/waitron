import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, transformSource } from "./a1301-seed-codemod.mjs";

const OUTSIDE = "apps/server/src/x.test.ts";
const lines = (...rows) => rows.join("\n") + "\n";
const SEED = `import { seedVenue } from "@waitron/db/testing/seed.js";`;

describe("rule 1: the venue row", () => {
  it("rewrites the statement form", () => {
    const input = lines(
      `import { it } from "vitest";`,
      `import { locations } from "@waitron/db";`,
      ``,
      `beforeAll(async () => {`,
      `  await db.insert(locations).values({ name: "Bar", invoiceLocales: ["es"] });`,
      `});`,
    );
    const result = transformSource(OUTSIDE, input);
    expect(result.output).toBe(
      lines(
        `import { it } from "vitest";`,
        SEED,
        ``,
        `beforeAll(async () => {`,
        `  await seedVenue(db, { name: "Bar", invoiceLocales: ["es"] });`,
        `});`,
      ),
    );
    expect(result.edits).toBe(1);
    expect(result.left).toEqual([]);
  });

  it("turns an id constant still in use into a let assigned from venueLocationId", () => {
    const input = lines(
      `import { locations } from "./tenants.js";`,
      `import { seedNode } from "../testing/seed.js";`,
      ``,
      `const LOCATION = "aaaaaaaa-0000-4000-8000-000000000001";`,
      ``,
      `beforeAll(async () => {`,
      `  await db.insert(locations).values({`,
      `    id: LOCATION,`,
      `    name: "Bar",`,
      `  });`,
      `  nodeId = await seedNode(db, LOCATION);`,
      `});`,
      ``,
      `it("reads", () => expect(row.locationId).toBe(LOCATION));`,
    );
    const result = transformSource("packages/db/src/schema/x.test.ts", input);
    expect(result.output).toBe(
      lines(
        `import { seedNode, seedVenue } from "../testing/seed.js";`,
        `import { venueLocationId } from "../venue.js";`,
        ``,
        `let LOCATION: string;`,
        ``,
        `beforeAll(async () => {`,
        `  await seedVenue(db, {`,
        `    name: "Bar",`,
        `  });`,
        `  LOCATION = await venueLocationId(db);`,
        `  nodeId = await seedNode(db);`,
        `});`,
        ``,
        `it("reads", () => expect(row.locationId).toBe(LOCATION));`,
      ),
    );
    expect(result.edits).toBe(2);
    expect(result.left).toEqual([]);
  });

  it("deletes an id constant nothing else uses", () => {
    const input = lines(
      `import { it } from "vitest";`,
      `import { locations } from "@waitron/db";`,
      ``,
      `/** The venue. */`,
      `const LOCATION = "aaaa";`,
      ``,
      `beforeAll(async () => {`,
      `  await db.insert(locations).values({ id: LOCATION, name: "Bar" });`,
      `});`,
    );
    expect(transformSource(OUTSIDE, input).output).toBe(
      lines(
        `import { it } from "vitest";`,
        SEED,
        ``,
        `beforeAll(async () => {`,
        `  await seedVenue(db, { name: "Bar" });`,
        `});`,
      ),
    );
  });

  it("makes `const [loc]` used only in seedNode a plain statement", () => {
    const input = lines(
      `import { it } from "vitest";`,
      `import { locations } from "@waitron/db";`,
      `import { seedNode } from "@waitron/db/testing/seed.js";`,
      ``,
      `beforeAll(async () => {`,
      `  const [loc] = await db.insert(locations).values({ name: "Bar" }).returning();`,
      `  nodeId = await seedNode(db, loc!.id);`,
      `});`,
    );
    expect(transformSource(OUTSIDE, input).output).toBe(
      lines(
        `import { it } from "vitest";`,
        `import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";`,
        ``,
        `beforeAll(async () => {`,
        `  await seedVenue(db, { name: "Bar" });`,
        `  nodeId = await seedNode(db);`,
        `});`,
      ),
    );
  });

  it("reports `const [loc]` still used in loc!.id and leaves the file unchanged", () => {
    const input = lines(
      `beforeAll(async () => {`,
      `  const [loc] = await db.insert(locations).values({ name: "Bar" }).returning();`,
      `  locationId = loc!.id;`,
      `});`,
    );
    expect(transformSource(OUTSIDE, input)).toEqual({
      output: input,
      edits: 0,
      left: [{ line: 2, reason: "const [loc] is still referenced" }],
    });
  });

  it("renames catalogueId, drops a whole argument left empty, and reads schema.locations and onConflictDoNothing", () => {
    const input = lines(
      `await db.insert(schema.locations).values({ catalogueId: CAT }).onConflictDoNothing();`,
      `await db.insert(locations).values({ id: "x" });`,
    );
    // Two inserts: neither is rewritten, so check the single-insert forms one at a time.
    expect(transformSource(OUTSIDE, input).edits).toBe(0);
    expect(
      transformSource(
        OUTSIDE,
        lines(
          `await db.insert(schema.locations).values({ catalogueId: CAT }).onConflictDoNothing();`,
        ),
      ).output,
    ).toBe(lines(SEED, `await seedVenue(db, { defaultCatalogueId: CAT });`));
    expect(
      transformSource(
        OUTSIDE,
        lines(`const LOC = "a";`, `await tx.insert(locations).values({ id: LOC, catalogueId });`),
      ).output,
    ).toBe(lines(SEED, `await seedVenue(tx, { defaultCatalogueId: catalogueId });`));
    expect(
      transformSource(
        OUTSIDE,
        lines(`const LOC = "a";`, `await db.insert(locations).values({ id: LOC });`),
      ).output,
    ).toBe(lines(SEED, `await seedVenue(db);`));
  });
});

describe("rules 2-4: nodes, devices and orders", () => {
  const VENUE_IN = `await db.insert(locations).values({ name: "V" });`;
  const VENUE_OUT = `await seedVenue(db, { name: "V" });`;

  it("drops seedNode's location argument", () => {
    const result = transformSource(OUTSIDE, lines(VENUE_IN, `nodeId = await seedNode(db, LOC);`));
    expect(result.output).toBe(lines(SEED, VENUE_OUT, `nodeId = await seedNode(db);`));
    expect(result.edits).toBe(2);
  });

  it("drops seedDevice's locationId beside other keys", () => {
    expect(
      transformSource(
        OUTSIDE,
        lines(VENUE_IN, `await seedDevice(db, { locationId: LOC, label: "Till" });`),
      ).output,
    ).toBe(lines(SEED, VENUE_OUT, `await seedDevice(db, { label: "Till" });`));
  });

  it("drops seedDevice's whole options when locationId was the only key", () => {
    expect(
      transformSource(OUTSIDE, lines(VENUE_IN, `await seedDevice(db, { locationId: LOC });`))
        .output,
    ).toBe(lines(SEED, VENUE_OUT, `await seedDevice(db);`));
  });

  it("drops seedDevice's shorthand locationId", () => {
    expect(
      transformSource(OUTSIDE, lines(VENUE_IN, `await seedDevice(db, { label: "T", locationId });`))
        .output,
    ).toBe(lines(SEED, VENUE_OUT, `await seedDevice(db, { label: "T" });`));
  });

  it("rewrites an insert(workingOrders) statement", () => {
    const result = transformSource(
      OUTSIDE,
      lines(
        VENUE_IN,
        `await db.insert(workingOrders).values({ source: "dashboard", locationId: LOC, orderNumber: 1 });`,
      ),
    );
    expect(result.output).toBe(
      lines(
        `import { seedVenue, seedWorkingOrder } from "@waitron/db/testing/seed.js";`,
        VENUE_OUT,
        `await seedWorkingOrder(db, { source: "dashboard", orderNumber: 1 });`,
      ),
    );
  });

  it("rewrites a `const [o] = … .returning()` order", () => {
    expect(
      transformSource(
        OUTSIDE,
        lines(
          VENUE_IN,
          `const [order] = await db.insert(schema.workingOrders).values({ locationId: LOC }).returning();`,
        ),
      ).output,
    ).toBe(
      lines(
        `import { seedVenue, seedWorkingOrder } from "@waitron/db/testing/seed.js";`,
        VENUE_OUT,
        `const order = await seedWorkingOrder(db);`,
      ),
    );
  });
});

describe("what it leaves alone", () => {
  it("leaves helper calls with no location, and inserts into other tables", () => {
    const body = [
      `await seedNode(db);`,
      `await seedDevice(db);`,
      `await seedDevice(db, OPTIONS);`,
      `await seedDevice(db, { label: "x" });`,
      `await db.insert(other.locations).values({});`,
      `await db.insert(tableFor("locations")).values({});`,
    ];
    const result = transformSource(
      OUTSIDE,
      lines(`await db.insert(locations).values({ name: "V" });`, ...body),
    );
    expect(result).toEqual({
      output: lines(SEED, `await seedVenue(db, { name: "V" });`, ...body),
      edits: 1,
      left: [],
    });
  });

  it("counts only real references to the id constant, and keeps a comment set apart from it", () => {
    const input = lines(
      `// Section.`,
      ``,
      `const LOC = "a";`,
      `await db.insert(locations).values({ id: LOC });`,
      `const { LOC: alias } = obj;`,
      `type T = ns.LOC;`,
    );
    expect(transformSource(OUTSIDE, input).output).toBe(
      lines(
        SEED,
        `// Section.`,
        ``,
        `await seedVenue(db);`,
        `const { LOC: alias } = obj;`,
        `type T = ns.LOC;`,
      ),
    );
  });
});

describe("what it reports and leaves", () => {
  it("reports two locations inserts and applies no location rule", () => {
    const input = lines(
      `await db.insert(locations).values({ name: "A" });`,
      `await db.insert(locations).values({ name: "B" });`,
      `nodeId = await seedNode(db, X);`,
    );
    expect(transformSource(OUTSIDE, input)).toEqual({
      output: input,
      edits: 0,
      left: [
        { line: 1, reason: "one of 2 locations inserts: no location rule applied" },
        { line: 2, reason: "one of 2 locations inserts: no location rule applied" },
      ],
    });
  });

  it("reports a .values([…]) array", () => {
    const input = lines(
      `await db.insert(locations).values({ name: "V" });`,
      `await db.insert(workingOrders).values([{ locationId: L }]);`,
    );
    const result = transformSource(OUTSIDE, input);
    expect(result.output).toBe(
      lines(
        SEED,
        `await seedVenue(db, { name: "V" });`,
        `await db.insert(workingOrders).values([{ locationId: L }]);`,
      ),
    );
    expect(result.left).toEqual([{ line: 2, reason: "values([…]) array: not rewritten" }]);
  });

  it("reports raw SQL insert into locations, and still applies rules 2-4", () => {
    const input = lines(
      "await db.run(sql`insert into locations (id, name) values (${ID}, 'V')`);",
      `nodeId = await seedNode(db, ID);`,
    );
    expect(transformSource(OUTSIDE, input)).toEqual({
      output: lines(
        "await db.run(sql`insert into locations (id, name) values (${ID}, 'V')`);",
        `nodeId = await seedNode(db);`,
      ),
      edits: 1,
      left: [{ line: 1, reason: "raw SQL insert into locations" }],
    });
  });

  it("reports a file that writes its own tenants row and leaves its venue insert", () => {
    const input = lines(
      `await db.run("insert into tenants (id) values (1)");`,
      `await db.insert(tenants).values({ id: 1 });`,
      `await db.insert(locations).values({ name: "V" });`,
    );
    expect(transformSource(OUTSIDE, input)).toEqual({
      output: input,
      edits: 0,
      left: [
        { line: 1, reason: "writes its own tenants row" },
        { line: 2, reason: "writes its own tenants row" },
      ],
    });
  });

  it("reports a file defining its own seedVenue and adds no import", () => {
    const input = lines(
      `async function seedVenue(db) {`,
      `  await db.insert(locations).values({ name: "V" });`,
      `}`,
      `const seedVenue2 = 1;`,
      `await db.insert(workingOrders).values({ locationId: L, orderNumber: 1 });`,
      `nodeId = await seedNode(db, L);`,
    );
    expect(transformSource(OUTSIDE, input)).toEqual({
      output: input,
      edits: 0,
      left: [
        { line: 1, reason: "defines its own seedVenue: no import added" },
        {
          line: 2,
          reason: "locations insert inside a helper function or loop: no location rule applied",
        },
      ],
    });
    const arrow = lines(`const seedVenue = async () => {};`);
    expect(transformSource(OUTSIDE, arrow).left).toEqual([
      { line: 1, reason: "defines its own seedVenue: no import added" },
    ]);
  });

  it("leaves a fiscal pair path unread", () => {
    const input = lines(`await db.insert(locations).values({ name: "V" });`);
    for (const path of [
      "packages/fiscal-verifactu/src/write-path.e2e.test.ts",
      "/abs/packages/fiscal-verifactu/src/inmutabilidad.test.ts",
    ]) {
      expect(transformSource(path, input)).toEqual({
        output: input,
        edits: 0,
        left: [{ line: 1, reason: "fiscal pair file: never rewritten" }],
      });
    }
  });

  it("reports raw insert(nodes) and insert(devices)", () => {
    const input = lines(
      `await db.insert(nodes).values({});`,
      `await db.insert(schema.devices).values({});`,
    );
    expect(transformSource(OUTSIDE, input).left).toEqual([
      { line: 1, reason: "raw insert(nodes)" },
      { line: 2, reason: "raw insert(devices)" },
    ]);
  });

  it("reports spread elements, computed keys and keys outside the Venue set", () => {
    const cases = [
      [
        `await db.insert(locations).values({ ...BASE });`,
        "spread element in values: not rewritten",
      ],
      [`await db.insert(locations).values({ [KEY]: 1 });`, "computed key in values: not rewritten"],
      [
        `await db.insert(locations).values({ bumpMode: "x" });`,
        "key outside the Venue set (bumpMode): not rewritten",
      ],
      [
        `await db.insert(locations).values({ go() {} });`,
        "key outside the Venue set (go): not rewritten",
      ],
      [
        `await db.insert(locations).values(VALUES);`,
        "locations insert of an unknown number of rows: no location rule applied",
      ],
      [
        `const rows = await db.insert(locations).values({ name: "V" });`,
        "locations insert in a shape the codemod does not rewrite",
      ],
      [
        `db.insert(locations).values({ name: "V" });`,
        "locations insert in a shape the codemod does not rewrite",
      ],
      [
        `await db.insert(locations);`,
        "locations insert of an unknown number of rows: no location rule applied",
      ],
      [
        `await db.insert(locations).values({ name: "V" }).where(x);`,
        "locations insert in a shape the codemod does not rewrite",
      ],
      [
        `await db.insert(locations).values({ name: "V" }, extra);`,
        "locations insert in a shape the codemod does not rewrite",
      ],
      [`await db.insert(locations).values([{ name: "V" }]);`, "values([…]) array: not rewritten"],
    ];
    for (const [input, reason] of cases) {
      expect(transformSource(OUTSIDE, lines(input))).toEqual({
        output: lines(input),
        edits: 0,
        left: [{ line: 1, reason }],
      });
    }
  });

  it("reports order inserts it cannot rewrite", () => {
    const venue = `await db.insert(locations).values({ name: "V" });`;
    const cases = [
      [
        `await db.insert(workingOrders).values({ ...DASHBOARD, orderNumber: 1 });`,
        "spread element in values: not rewritten",
      ],
      [
        `await db.insert(workingOrders).values({ [K]: 1, locationId: L });`,
        "computed key in values: not rewritten",
      ],
      [
        `await db.insert(workingOrders).values({ orderNumber: 1 });`,
        "workingOrders insert without a locationId key",
      ],
      [
        `const [o] = await db.insert(workingOrders).values({ locationId: L });`,
        "workingOrders insert in a shape the codemod does not rewrite",
      ],
      [
        `const orders = await db.insert(workingOrders).values({ locationId: L }).returning();`,
        "workingOrders insert in a shape the codemod does not rewrite",
      ],
      [
        `let [o] = await db.insert(workingOrders).values({ locationId: L }).returning();`,
        "workingOrders insert in a shape the codemod does not rewrite",
      ],
      [
        `db.insert(workingOrders).values({ locationId: L });`,
        "workingOrders insert in a shape the codemod does not rewrite",
      ],
      [
        `await db.insert(workingOrders).values(ORDER);`,
        "workingOrders insert in a shape the codemod does not rewrite",
      ],
    ];
    for (const [order, reason] of cases) {
      const result = transformSource(OUTSIDE, lines(venue, order));
      expect(result.output).toBe(lines(SEED, `await seedVenue(db, { name: "V" });`, order));
      expect(result.left).toEqual([{ line: 2, reason }]);
    }
  });

  it("reports an id that is not a module-level const", () => {
    const cases = [
      `await db.insert(locations).values({ id: "aaaa" });`,
      `let LOC = "a";\nawait db.insert(locations).values({ id: LOC });`,
      `const LOC = "a", OTHER = "b";\nawait db.insert(locations).values({ id: LOC });`,
      `function f() { const LOC = "a"; }\nawait db.insert(locations).values({ id: LOC });`,
      `const [LOC] = ["a"];\nawait db.insert(locations).values({ id: LOC });`,
      `await db.insert(locations).values({ id });`,
    ];
    for (const input of cases) {
      const text = lines(input);
      const line = input.includes("\n") ? 2 : 1;
      expect(transformSource(OUTSIDE, text)).toEqual({
        output: text,
        edits: 0,
        left: [{ line, reason: "id is not a module-level const" }],
      });
    }
  });

  it("reports an id constant read at module load, before seedVenue assigns it", () => {
    const input = lines(
      `const LOC = "a";`,
      `const DASHBOARD = { locationId: LOC };`,
      `describe("x", () => {`,
      `  const rows = [LOC];`,
      `  beforeAll(async () => {`,
      `    await db.insert(locations).values({ id: LOC });`,
      `    use(LOC);`,
      `  });`,
      `});`,
    );
    expect(transformSource(OUTSIDE, input)).toEqual({
      output: input,
      edits: 0,
      left: [{ line: 6, reason: "LOC is read at module load, before seedVenue assigns it" }],
    });
    const eachBody = lines(
      `const LOC = "a";`,
      `describe.each([1])("x", () => {`,
      `  use(LOC);`,
      `  beforeAll(async () => { await db.insert(locations).values({ id: LOC }); });`,
      `});`,
    );
    expect(transformSource(OUTSIDE, eachBody).left).toEqual([
      { line: 4, reason: "LOC is read at module load, before seedVenue assigns it" },
    ]);
    const deferred = lines(
      `const LOC = "a";`,
      `describe.each([1])("x", async function () {`,
      `  await db.insert(locations).values({ id: LOC });`,
      `  it("y", () => use(LOC));`,
      `});`,
    );
    expect(transformSource(OUTSIDE, deferred).left).toEqual([
      { line: 3, reason: "LOC may be read before seedVenue assigns it" },
    ]);
  });
});

describe("rule 5: imports", () => {
  it("imports from relative paths inside packages/db, in the file's quote style", () => {
    const input = lines(
      `import { it } from 'vitest';`,
      `const LOC = 'a';`,
      `beforeAll(async () => {`,
      `  await db.insert(locations).values({ id: LOC, name: 'V' });`,
      `  use(LOC);`,
      `});`,
    );
    expect(transformSource("/repo/packages/db/src/x.test.ts", input).output).toBe(
      lines(
        `import { it } from 'vitest';`,
        `import { seedVenue } from './testing/seed.js';`,
        `import { venueLocationId } from './venue.js';`,
        `let LOC: string;`,
        `beforeAll(async () => {`,
        `  await seedVenue(db, { name: 'V' });`,
        `  LOC = await venueLocationId(db);`,
        `  use(LOC);`,
        `});`,
      ),
    );
  });

  it("adds to an existing @waitron/db import and removes emptied specifiers", () => {
    const input = lines(
      `import { locationId as brandLocationId, type LocationId } from "@waitron/shared";`,
      `import { locations, readVenue } from "@waitron/db";`,
      `import type { Unused } from "./unused.js";`,
      `import { workingOrders, sales } from "./schema.js";`,
      `import { aaa, zzz } from "@waitron/db/testing/seed.js";`,
      `const LOC: LocationId = brandLocationId("a");`,
      `await db.insert(locations).values({ id: LOC });`,
      `await seedNode(db, brandLocationId(LOC));`,
      `await db.insert(workingOrders).values({ locationId: LOC, orderNumber: 1 });`,
      `it("x", () => use(LOC, sales, readVenue));`,
    );
    expect(transformSource(OUTSIDE, input).output).toBe(
      lines(
        `import { readVenue, venueLocationId } from "@waitron/db";`,
        `import type { Unused } from "./unused.js";`,
        `import { sales } from "./schema.js";`,
        `import { aaa, seedVenue, seedWorkingOrder, zzz } from "@waitron/db/testing/seed.js";`,
        `let LOC: string;`,
        `await seedVenue(db);`,
        `LOC = await venueLocationId(db);`,
        `await seedNode(db);`,
        `await seedWorkingOrder(db, { orderNumber: 1 });`,
        `it("x", () => use(LOC, sales, readVenue));`,
      ),
    );
  });

  it("removes brand helpers the rewrite left unused, and keeps an import already present", () => {
    const input = lines(
      `import { locationId as brandLocationId } from "@waitron/shared";`,
      `import type { LocationId } from "@waitron/shared";`,
      `import * as schema from "./schema.js";`,
      `import "./side-effect.js";`,
      `import { seedVenue } from "@waitron/db/testing/seed.js";`,
      `await db.insert(locations).values({ name: "V" });`,
      `await seedNode(db, brandLocationId("a") as LocationId);`,
    );
    expect(transformSource(OUTSIDE, input).output).toBe(
      lines(
        `import * as schema from "./schema.js";`,
        `import "./side-effect.js";`,
        SEED,
        `await seedVenue(db, { name: "V" });`,
        `await seedNode(db);`,
      ),
    );
  });
});

describe("main", () => {
  let dir;
  let out;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "a1301-codemod-"));
    out = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const source = lines(
    `await db.insert(locations).values({ name: "V" });`,
    `await db.insert(nodes).values({});`,
    `const SEED_SCRIPT = 1;`,
  );

  it("reports and writes nothing without --write", () => {
    const file = join(dir, "a.test.mjs");
    writeFileSync(file, source);
    const before = readFileSync(file);
    expect(main([file], { stdout: (line) => out.push(line) })).toBe(0);
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(out).toEqual([`${file}:2: raw insert(nodes)`, `${file}: 1 edit`]);
  });

  it("writes the rewrite with --write, and never opens a fiscal pair file", () => {
    const file = join(dir, "a.test.ts");
    writeFileSync(file, source);
    const fiscal = join(dir, "packages/fiscal-verifactu/src/inmutabilidad.test.ts");
    expect(main(["--write", file, fiscal], { stdout: (line) => out.push(line) })).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(
      lines(
        SEED,
        `await seedVenue(db, { name: "V" });`,
        `await db.insert(nodes).values({});`,
        `const SEED_SCRIPT = 1;`,
      ),
    );
    expect(out).toEqual([
      `${file}:2: raw insert(nodes)`,
      `${file}: 1 edit`,
      `${fiscal}:1: fiscal pair file: never rewritten`,
      `${fiscal}: 0 edits`,
    ]);
  });

  it("prints to the console by default", () => {
    const file = join(dir, "b.test.ts");
    writeFileSync(file, lines(`use(1);`));
    expect(main([file])).toBe(0);
  });
});

describe("review round 1", () => {
  const HELPER = "locations insert inside a helper function or loop: no location rule applied";

  it("counts the rows of a multi-row array, so no location rule applies", () => {
    const input = lines(
      `await db.insert(locations).values([{ name: "A" }, { name: "B" }]);`,
      `nodeId = await seedNode(db, B);`,
    );
    expect(transformSource(OUTSIDE, input)).toEqual({
      output: input,
      edits: 0,
      left: [{ line: 1, reason: "one of 2 locations inserts: no location rule applied" }],
    });
  });

  it("treats an array with a spread as an unknown number of rows", () => {
    const input = lines(
      `await db.insert(locations).values([...ROWS]);`,
      `nodeId = await seedNode(db, B);`,
    );
    expect(transformSource(OUTSIDE, input)).toEqual({
      output: input,
      edits: 0,
      left: [
        {
          line: 1,
          reason: "locations insert of an unknown number of rows: no location rule applied",
        },
      ],
    });
  });

  it("skips every location rule when an insert sits in a helper function or loop", () => {
    const cases = [
      [
        `async function seedLocation(db) {`,
        `  await db.insert(locations).values({ name: "A" });`,
        `}`,
      ],
      [
        `const location = async () => {`,
        `  await db.insert(locations).values({ name: "A" });`,
        `};`,
      ],
      [`for (const name of NAMES) {`, `  await db.insert(locations).values({ name });`, `}`],
      [`NAMES.forEach(async (name) => {`, `  await db.insert(locations).values({ name });`, `});`],
      [
        `const helpers = {`,
        `  async seed() { await db.run("insert into locations (name) values ('A')"); },`,
        `};`,
      ],
    ];
    for (const shape of cases) {
      const input = lines(
        ...shape,
        `nodeId = await seedNode(db, await seedLocation(db));`,
        `await seedDevice(db, { locationId: L });`,
      );
      const result = transformSource(OUTSIDE, input);
      expect(result.output).toBe(input);
      expect(result.edits).toBe(0);
      expect(result.left).toContainEqual({ line: 2, reason: HELPER });
    }
  });

  it("rewrites inserts on a transaction receiver as written, inside a file-level hook's callback", () => {
    const input = lines(
      `const LOC = "a";`,
      `beforeAll(async () => {`,
      `  await withTransaction(db, async (tx) => {`,
      `    await tx.insert(locations).values({ id: LOC, name: "V" });`,
      `    await tx.insert(workingOrders).values({ locationId: LOC, orderNumber: 1 });`,
      `  });`,
      `});`,
      `it("x", () => use(LOC));`,
    );
    expect(transformSource(OUTSIDE, input)).toEqual({
      output: lines(
        `import { seedVenue, seedWorkingOrder } from "@waitron/db/testing/seed.js";`,
        `import { venueLocationId } from "@waitron/db";`,
        `let LOC: string;`,
        `beforeAll(async () => {`,
        `  await withTransaction(db, async (tx) => {`,
        `    await seedVenue(tx, { name: "V" });`,
        `    LOC = await venueLocationId(tx);`,
        `    await seedWorkingOrder(tx, { orderNumber: 1 });`,
        `  });`,
        `});`,
        `it("x", () => use(LOC));`,
      ),
      edits: 2,
      left: [],
    });
  });

  it("reports a location argument with side effects and leaves that call", () => {
    const NOT_PLAIN = "location argument is not a plain value: not dropped";
    const input = lines(
      `import { locationId as brandLocationId, type LocationId } from "@waitron/shared";`,
      `await db.insert(locations).values({ name: "V" });`,
      `nodeId = await seedNode(db, await seedLocation(db));`,
      `await seedDevice(db, { locationId: makeId(LOC) });`,
      `await db.insert(workingOrders).values({ locationId: ids[0], orderNumber: 1 });`,
      `await seedNode(db, brandLocationId(venue!.loc.id) as LocationId);`,
      `await seedNode(db, (LOC));`,
      `await seedNode(db, 7);`,
      `await seedDevice(db, { label: "x", locationId: \`l\` });`,
      `await seedNode(db, brandLocationId(a, b));`,
      `await seedNode(db, brandLocationId(make()));`,
      `await seedNode(db, this.loc);`,
    );
    expect(transformSource(OUTSIDE, input)).toEqual({
      output: lines(
        `import { locationId as brandLocationId } from "@waitron/shared";`,
        SEED,
        `await seedVenue(db, { name: "V" });`,
        `nodeId = await seedNode(db, await seedLocation(db));`,
        `await seedDevice(db, { locationId: makeId(LOC) });`,
        `await db.insert(workingOrders).values({ locationId: ids[0], orderNumber: 1 });`,
        `await seedNode(db);`,
        `await seedNode(db);`,
        `await seedNode(db);`,
        `await seedDevice(db, { label: "x" });`,
        `await seedNode(db, brandLocationId(a, b));`,
        `await seedNode(db, brandLocationId(make()));`,
        `await seedNode(db, this.loc);`,
      ),
      edits: 5,
      left: [3, 4, 5, 10, 11, 12].map((line) => ({ line, reason: NOT_PLAIN })),
    });
  });

  it("reports an id constant a sibling describe could read before the seed assigns it", () => {
    const input = lines(
      `const LOC = "a";`,
      `describe("A", () => {`,
      `  beforeEach(async () => {`,
      `    await db.insert(locations).values({ id: LOC });`,
      `  });`,
      `});`,
      `describe("B", () => {`,
      `  it("reads", () => use(LOC));`,
      `});`,
    );
    expect(transformSource(OUTSIDE, input)).toEqual({
      output: input,
      edits: 0,
      left: [{ line: 4, reason: "LOC may be read before seedVenue assigns it" }],
    });
    const inTest = lines(
      `const LOC = "a";`,
      `it("seeds", async () => {`,
      `  await db.insert(locations).values({ id: LOC });`,
      `  use(LOC);`,
      `});`,
    );
    expect(transformSource(OUTSIDE, inTest).left).toEqual([
      { line: 3, reason: "LOC may be read before seedVenue assigns it" },
    ]);
  });

  it("reports an id constant a beforeAll reads while the seed runs in beforeEach", () => {
    const input = lines(
      `const LOC = "a";`,
      `beforeAll(() => use(LOC));`,
      `beforeEach(async () => {`,
      `  await db.insert(locations).values({ id: LOC });`,
      `});`,
      `it("reads", () => use(LOC));`,
    );
    expect(transformSource(OUTSIDE, input)).toEqual({
      output: input,
      edits: 0,
      left: [{ line: 4, reason: "LOC may be read before seedVenue assigns it" }],
    });
    const fine = lines(
      `const LOC = "a";`,
      `beforeEach(async () => {`,
      `  await db.insert(locations).values({ id: LOC });`,
      `});`,
      `it("reads", () => use(LOC));`,
    );
    expect(transformSource(OUTSIDE, fine).output).toBe(
      lines(
        SEED,
        `import { venueLocationId } from "@waitron/db";`,
        `let LOC: string;`,
        `beforeEach(async () => {`,
        `  await seedVenue(db);`,
        `  LOC = await venueLocationId(db);`,
        `});`,
        `it("reads", () => use(LOC));`,
      ),
    );
  });

  it("adds no duplicate of a helper name the file already declares or imports from elsewhere", () => {
    const collision = (name) =>
      `${name} is already declared or imported from elsewhere: rule not applied`;
    const venueHelper = lines(
      `import { venueLocationId } from "./helpers.js";`,
      `const LOC = "a";`,
      `beforeAll(async () => {`,
      `  await db.insert(locations).values({ id: LOC });`,
      `});`,
      `it("x", () => use(LOC));`,
    );
    expect(transformSource(OUTSIDE, venueHelper)).toEqual({
      output: venueHelper,
      edits: 0,
      left: [{ line: 4, reason: collision("venueLocationId") }],
    });
    const localVenueHelper = venueHelper.replace(
      `import { venueLocationId } from "./helpers.js";`,
      `function venueLocationId() {}`,
    );
    expect(transformSource(OUTSIDE, localVenueHelper).left).toEqual([
      { line: 4, reason: collision("venueLocationId") },
    ]);
    const seedVenueImport = lines(
      `import { seedVenue } from "./venue-helpers.js";`,
      `await db.insert(locations).values({ name: "V" });`,
      `await db.insert(workingOrders).values({ locationId: L, orderNumber: 1 });`,
    );
    expect(transformSource(OUTSIDE, seedVenueImport)).toEqual({
      output: lines(
        `import { seedVenue } from "./venue-helpers.js";`,
        `import { seedWorkingOrder } from "@waitron/db/testing/seed.js";`,
        `await db.insert(locations).values({ name: "V" });`,
        `await seedWorkingOrder(db, { orderNumber: 1 });`,
      ),
      edits: 1,
      left: [{ line: 2, reason: collision("seedVenue") }],
    });
    const orderImport = lines(
      `import seedWorkingOrder from "./orders.js";`,
      `await db.insert(locations).values({ name: "V" });`,
      `await db.insert(workingOrders).values({ locationId: L, orderNumber: 1 });`,
    );
    expect(transformSource(OUTSIDE, orderImport)).toEqual({
      output: lines(
        `import seedWorkingOrder from "./orders.js";`,
        SEED,
        `await seedVenue(db, { name: "V" });`,
        `await db.insert(workingOrders).values({ locationId: L, orderNumber: 1 });`,
      ),
      edits: 1,
      left: [{ line: 3, reason: collision("seedWorkingOrder") }],
    });
    const namespaced = orderImport.replace(
      `import seedWorkingOrder from "./orders.js";`,
      `import * as seedWorkingOrder from "./orders.js";`,
    );
    expect(transformSource(OUTSIDE, namespaced).left).toEqual([
      { line: 3, reason: collision("seedWorkingOrder") },
    ]);
  });
});
