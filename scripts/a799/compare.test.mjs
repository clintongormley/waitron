import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import * as facts from "./facts.mjs";
import * as comparison from "./compare.mjs";

const int = (n) => ({ kind: "integer", decimal: String(n) });
const txt = (s) => ({ kind: "text", base64: Buffer.from(s).toString("base64") });
const row = (table, id, fields) => ({ table, key: [txt(id)], fields: { id: txt(id), ...fields } });
const object = (name, module = "catalogue", protection = "ordinary") => ({
  kind: "table",
  name,
  table: name,
  module,
  protection,
  rawSql: `CREATE TABLE ${name}(id TEXT PRIMARY KEY)`,
  columns: [{ name: "id", type: "TEXT", notNull: false, defaultSql: null, primaryKey: 1 }],
  keys: [],
  checks: [],
  foreignKeys: [],
});
const make = () => ({
  version: 1,
  fixtureId: "R1-required",
  rows: [
    row("sales", "sale-1", {
      total: int(1353),
      tender: int(2000),
      change: int(647),
      invoiceNumber: txt("H-0001"),
      issuedAt: txt("2026-11-04T12:15:00.000Z"),
      offset: int(60),
      actor: txt("person-1"),
      type: txt("F1"),
      customer: txt("customer-1"),
      recipientName: txt("Mara Soler"),
      recipientAddress: txt("18 Market Street"),
    }),
    row("lines", "line-1", {
      sale: txt("sale-1"),
      quantity: int(350),
      gross: int(770),
      decimalText: txt("7.70"),
      product: txt("product-1"),
    }),
    row("taxes", "tax-10", { base: int(900), tax: int(90), rate: int(1000) }),
    row("taxes", "tax-21", { base: int(300), tax: int(63), rate: int(2100) }),
    row("products", "product-1", {
      staffName: txt("Cheese staff"),
      customerName: txt("Farm cheese"),
      kitchenName: txt("Cold cheese"),
    }),
    row("customers", "customer-1", { name: txt("Mara Current"), address: txt("20 New Street") }),
    row("persons", "person-1", { name: txt("Ana") }),
    row("menus", "menu-1", { name: txt("Lunch") }),
    row("registros_facturacion", "fiscal-1", {
      sale: txt("sale-1"),
      huella: txt("original-hash"),
      predecessor: txt("previous"),
      sequence: int(2),
      payload: txt('{"amount":"13.53"}'),
      environment: txt("preproduction"),
      sif: txt("sif-1"),
    }),
    row("events", "event-1", { actor: txt("person-1"), bytes: { kind: "blob", base64: "AAE=" } }),
    row("workforce", "event-1", {
      predecessor: txt("old"),
      hash: txt("head"),
      time: txt("2026-11-04T10:00:00+01:00"),
    }),
    row("outbox", "send-1", {
      fiscal: txt("fiscal-1"),
      state: txt("waiting"),
      attempts: int(0),
      due: txt("2026-11-04T13:00:00Z"),
    }),
    row("bookings", "booking-1", { name: txt("Window seat") }),
  ],
  schema: [
    object("sales", "sales"),
    object("lines"),
    object("taxes"),
    object("products"),
    object("customers"),
    object("persons", "identity"),
    object("menus"),
    object("registros_facturacion", "fiscal-verifactu", "fiscal"),
    object("events", "orders"),
    object("workforce", "workforce", "fiscal"),
    object("outbox", "fiscal-verifactu", "fiscal"),
    object("bookings", "bookings", "disabled"),
  ],
  journals: [
    {
      set: "core",
      table: "__core_migrations",
      rows: [{ id: int(1), hash: "1".repeat(64), createdAt: int(1000) }],
    },
  ],
  files: [{ path: "node-key.sealed", sha256: "2".repeat(64), bytes: 80, mode: 384 }],
  relationships: [
    {
      id: "line-sale",
      fromTable: "lines",
      fromKey: [txt("line-1")],
      fromColumns: ["sale"],
      toTable: "sales",
      toKey: [txt("sale-1")],
      toColumns: ["id"],
    },
    {
      id: "outbox-fiscal",
      fromTable: "outbox",
      fromKey: [txt("send-1")],
      fromColumns: ["fiscal"],
      toTable: "registros_facturacion",
      toKey: [txt("fiscal-1")],
      toColumns: ["id"],
    },
  ],
  coverage: {
    sales: [{ table: "sales", key: [txt("sale-1")] }],
    fiscal: [{ table: "registros_facturacion", key: [txt("fiscal-1")] }],
    people: [{ table: "persons", key: [txt("person-1")] }],
    menus: [{ table: "menus", key: [txt("menu-1")] }],
    events: [{ table: "events", key: [txt("event-1")] }],
    issuedF1: [
      {
        table: "sales",
        key: [txt("sale-1")],
        typeField: "type",
        numberField: "invoiceNumber",
        number: txt("H-0001"),
        nameField: "recipientName",
        name: txt("Mara Soler"),
        addressField: "recipientAddress",
        address: txt("18 Market Street"),
      },
    ],
    optional: { module: "bookings", state: "disabled-retained", tables: ["bookings"] },
  },
  identity: {
    node: txt("node-1"),
    keyHash: txt("sealed-key-hash"),
    sif: txt("sif-1"),
    installation: txt("installation-1"),
    series: txt("H"),
    nextNumber: int(2),
    fiscalHead: txt("original-hash"),
    workforceHead: txt("head"),
  },
  operationalRules: [],
  newSale: {
    quantity: int(350),
    unitPrice: int(2400),
    total: int(840),
    tender: int(1000),
    change: int(160),
  },
});
const cell = () => ({
  sourceEpoch: "post-reset",
  sourceSha: "1".repeat(40),
  candidateSha: "2".repeat(40),
  migrations: [{ hash: "3".repeat(64), module: "catalogue" }],
  disabledModules: ["bookings"],
});
const mapping = (overrides = {}) => ({
  id: "new-label",
  sourceEpoch: "post-reset",
  sourceSha: "1".repeat(40),
  candidateSha: "2".repeat(40),
  migrationHash: "3".repeat(64),
  module: "catalogue",
  object: { subject: "rows", key: "products" },
  field: "label",
  before: null,
  after: { kind: "null" },
  exactTransform: "add-null-field",
  reason: "New optional label",
  approvalReceipt: "review-1",
  ...overrides,
});
const changed = (f, table, field, value) => {
  f.rows.find((r) => r.table === table).fields[field] = value;
  return f;
};

describe("typed storage", () => {
  it.each([
    ["null", null, { kind: "null" }],
    ["integer", "-9223372036854775808", int("-9223372036854775808")],
    ["integer", "9223372036854775807", int("9223372036854775807")],
    ["text", Buffer.from("7.70"), txt("7.70")],
    ["blob", new Uint8Array([0, 255]), { kind: "blob", base64: "AP8=" }],
    [
      "real",
      Buffer.from("8000000000000000", "hex"),
      { kind: "real", ieee754Hex: "8000000000000000" },
    ],
  ])("encodes %s without numeric or text normalization", (kind, input, expected) => {
    expect(facts.encodeTyped(kind, input)).toEqual(expected);
  });
  it.each([
    ["integer", 350],
    ["integer", "01"],
    ["integer", "-0"],
    ["integer", "9223372036854775808"],
    ["integer", "-9223372036854775809"],
    ["null", "null"],
    ["real", Buffer.alloc(7)],
    ["real", Buffer.from("7ff0000000000000", "hex")],
    ["real", Buffer.from("7ff8000000000001", "hex")],
    ["unknown", Buffer.alloc(0)],
    ["text", "7.70"],
  ])("refuses ambiguous or invalid storage %#", (kind, value) => {
    expect(() => facts.encodeTyped(kind, value)).toThrow("history.invalid");
  });
});

describe("independent original facts", () => {
  it("reports a different fixture identity", () => {
    const f = make();
    f.fixtureId = "other";
    expect(comparison.compareFacts(make(), f).diffs).toContainEqual(
      expect.objectContaining({ subject: "facts", field: "fixtureId" }),
    );
  });
  it.each([
    (f) => {
      f.rows[0].fields = null;
    },
    (f) => {
      f.rows[0].fields = [];
    },
    (f) => {
      f.rows[0].fields = {};
    },
    (f) => {
      f.rows[0].key = [];
    },
    (f) => {
      f.rows = null;
    },
    (f) => {
      f.rows[0].fields[" "] = int(1);
    },
    (f) => {
      f.rows[0].fields.extra = { kind: "blob", base64: 42 };
    },
    (f) => {
      f.files[0].mode = 512;
    },
    (f) => {
      f.files[0].bytes = -1;
    },
    (f) => {
      f.relationships[0].toColumns = ["id", "other"];
    },
    (f) => {
      f.coverage.optional.state = "unsupported";
    },
    (f) => {
      delete f.identity.node;
      f.identity.extra = int(1);
    },
  ])("refuses malformed values without coercion %#", (mutate) => {
    const f = make();
    mutate(f);
    expect(() => facts.parseFacts(f)).toThrow("history.invalid");
  });
  it("ignores object insertion order in original compound keys", () => {
    const f = make();
    f.rows[0].key[0] = { base64: "c2FsZS0x", kind: "text" };
    expect(comparison.compareFacts(make(), f, []).ok).toBe(true);
  });
  it("reports complete missing and unexpected fields as distinct from a stored null", () => {
    const f = make();
    delete f.rows.find((r) => r.table === "products").fields.staffName;
    f.rows.find((r) => r.table === "products").fields.extra = { kind: "null" };
    expect(
      comparison
        .compareFacts(make(), f, [])
        .diffs.filter((d) => d.subject === "rows")
        .map((d) => [d.field, d.cause]),
    ).toEqual([
      ["staffName", "missing"],
      ["extra", "unexpected"],
    ]);
  });
  it("compares arbitrary field names without inheriting object prototype values", () => {
    const f = make();
    Object.defineProperty(f.rows[0].fields, "__proto__", {
      value: txt("stored"),
      enumerable: true,
    });
    expect(comparison.compareFacts(make(), f, []).diffs).toContainEqual(
      expect.objectContaining({ field: "__proto__", cause: "unexpected" }),
    );
  });
  it("does not silently accept coverage pointers to unrelated scenario entities", () => {
    const f = make();
    f.coverage.fiscal = f.coverage.people;
    expect(() => facts.validateCoverage(f)).toThrow("history.coverage");
  });
  it("accepts complete small facts and row reordering with nonzero comparison counts", () => {
    const old = make();
    const actual = globalThis.structuredClone(old);
    actual.rows.reverse();
    actual.schema.reverse();
    actual.relationships.reverse();
    const result = comparison.compareFacts(old, actual, []);
    expect(result).toEqual({
      ok: true,
      diffs: [],
      comparedByKind: {
        rows: 13,
        fields: 59,
        schema: 12,
        journals: 1,
        files: 1,
        relationships: 2,
        identity: 8,
        coverage: 1,
        operationalRules: 0,
        newSale: 5,
      },
    });
    expect(facts.parseFacts(old)).toEqual(old);
    expect(facts.parseFacts(old)).not.toBe(old);
  });
  it.each([
    ["quantity scale", "lines", "quantity", int(35)],
    ["money", "lines", "gross", int(77)],
    ["decimal spelling", "lines", "decimalText", txt("7.7")],
    ["VAT base", "taxes", "base", int(990)],
    ["VAT grouping", "taxes", "rate", int(2100)],
    ["tender", "sales", "tender", int(1353)],
    ["change", "sales", "change", int(0)],
    ["actor", "events", "actor", txt("other")],
    ["product customer name", "products", "customerName", txt("Cheese staff")],
    ["time spelling", "sales", "issuedAt", txt("2026-11-04T13:15:00.000+01:00")],
    ["offset", "sales", "offset", int(0)],
    ["fiscal bytes", "registros_facturacion", "payload", txt('{"amount":"13.530"}')],
    ["hash", "registros_facturacion", "huella", txt("recomputed")],
    ["predecessor", "registros_facturacion", "predecessor", txt("other")],
    ["fiscal sequence", "registros_facturacion", "sequence", int(3)],
    ["environment", "registros_facturacion", "environment", txt("production")],
    ["SIF", "registros_facturacion", "sif", txt("other")],
    ["workforce bytes", "workforce", "hash", txt("new-head")],
    ["outbox attempts", "outbox", "attempts", int(1)],
    ["outbox due", "outbox", "due", txt("later")],
    ["outbox state", "outbox", "state", txt("sent")],
  ])("detects changed %s by original row key and field", (_name, table, field, value) => {
    const result = comparison.compareFacts(make(), changed(make(), table, field, value), []);
    expect(result.ok).toBe(false);
    expect(result.diffs).toContainEqual(
      expect.objectContaining({
        subject: "rows",
        key: `${table}:${JSON.stringify(
          make()
            .rows.find((r) => r.table === table)
            .key.map((v) => ({ base64: v.base64, kind: v.kind })),
        )}`,
        field,
        actual: value,
      }),
    );
  });
  it("reports replaced children in both directions despite equal row counts", () => {
    const next = make();
    next.rows.find((r) => r.table === "lines").key = [txt("line-2")];
    next.relationships[0].fromKey = [txt("line-2")];
    const result = comparison.compareFacts(make(), next, []);
    expect(result.diffs.filter((d) => d.subject === "rows").map((d) => d.cause)).toEqual([
      "missing",
      "unexpected",
    ]);
  });
  it("checks relationship fields even when their endpoints and counts stay equal", () => {
    const next = make();
    next.relationships[0].fromColumns = ["product"];
    const result = comparison.compareFacts(make(), next, []);
    expect(result.diffs).toContainEqual(
      expect.objectContaining({ subject: "relationships", key: "line-sale", field: "fromColumns" }),
    );
  });
  it.each(["rows", "schema", "files", "relationships", "journals"])(
    "refuses duplicate %s identities",
    (section) => {
      const next = make();
      next[section].push(globalThis.structuredClone(next[section][0]));
      expect(() => facts.parseFacts(next)).toThrow("history.invalid");
    },
  );
  it.each([
    (f) => {
      f.version = 2;
    },
    (f) => {
      f.unknown = 1;
    },
    (f) => {
      delete f.identity;
    },
    (f) => {
      f.identity.nextNumber.decimal = "01";
    },
    (f) => {
      f.rows[0].fields.extra = { kind: "text", base64: "Zg" };
    },
    (f) => {
      f.rows[0].fields.extra = { kind: "real", ieee754Hex: "zzzzzzzzzzzzzzzz" };
    },
    (f) => {
      f.rows[0].fields.extra = { kind: "text", base64: "Zh==" };
    },
    (f) => {
      f.rows[0].fields.extra = { kind: "null", value: null };
    },
    (f) => {
      f.rows[0].fields.extra = { kind: "unknown" };
    },
    (f) => {
      f.files[0].sha256 = "bad";
    },
    (f) => {
      f.files[0].path = "../key";
    },
    (f) => {
      f.rows[0].table = "unknown";
    },
  ])("refuses unvalidated facts %#", (mutate) => {
    const f = make();
    mutate(f);
    expect(() => facts.parseFacts(f)).toThrow("history.invalid");
  });
  it.each(["sales", "fiscal", "people", "menus", "events", "issuedF1"])(
    "requires nonempty %s coverage",
    (category) => {
      const f = make();
      f.coverage[category] = [];
      expect(() => facts.validateCoverage(f)).toThrow("history.coverage");
    },
  );
  it("refuses unpaid/F2 coverage and altered original F1 recipient bytes", () => {
    for (const mutate of [
      (f) => {
        f.rows[0].fields.type = txt("F2");
      },
      (f) => {
        f.rows[0].fields.recipientName = txt("Mara Current");
      },
      (f) => {
        f.rows[0].fields.recipientAddress = txt("20 New Street");
      },
      (f) => {
        f.coverage.issuedF1[0].key = [txt("unpaid")];
      },
    ]) {
      const f = make();
      mutate(f);
      expect(() => facts.validateCoverage(f)).toThrow("history.coverage");
    }
  });
  it("distinguishes retained disabled history from never-enabled coverage", () => {
    const f = make();
    f.rows = f.rows.filter((r) => r.table !== "bookings");
    f.schema = f.schema.filter((o) => o.name !== "bookings");
    f.coverage.optional.state = "never-enabled";
    expect(() => facts.validateCoverage(f)).not.toThrow();
    f.coverage.optional.state = "disabled-retained";
    expect(() => facts.validateCoverage(f)).toThrow("history.coverage");
  });
  it.each(["files", "journals", "identity", "newSale"])(
    "detects changed %s separately",
    (section) => {
      const f = make();
      if (section === "files") f.files[0].mode = 256;
      if (section === "journals") f.journals[0].rows[0].createdAt = int(1001);
      if (section === "identity") f.identity.nextNumber = int(3);
      if (section === "newSale") f.newSale.total = int(841);
      expect(comparison.compareFacts(make(), f, []).diffs).toContainEqual(
        expect.objectContaining({ subject: section }),
      );
    },
  );
});

describe("exact reviewed transformations", () => {
  it.each([
    ["registros_facturacion", "fiscal-verifactu"],
    ["bookings", "bookings"],
  ])("refuses a correctly bound row mapping to protected %s", (table, module) => {
    const context = cell();
    context.disabledModules = [];
    context.migrations.push({ hash: "4".repeat(64), module });
    expect(() =>
      comparison.compareFacts(
        make(),
        make(),
        [
          mapping({
            module,
            migrationHash: "4".repeat(64),
            object: { subject: "rows", key: table },
          }),
        ],
        context,
      ),
    ).toThrow("history.mapping");
  });
  it("validates each complete schema mapping before returning an admitted descriptor", () => {
    const before = object("products");
    const after = { ...before, extra: true };
    expect(() =>
      comparison.validateMappings(
        [
          mapping({
            object: { subject: "schema", key: "table:products" },
            field: "object",
            before,
            after,
            exactTransform: "replace-exact",
          }),
        ],
        cell(),
      ),
    ).toThrow("history.mapping");
  });
  it("adds a mapped field named __proto__ as stored data", () => {
    const next = make();
    Object.defineProperty(next.rows.find((r) => r.table === "products").fields, "__proto__", {
      value: { kind: "null" },
      enumerable: true,
    });
    expect(
      comparison.compareFacts(make(), next, [mapping({ field: "__proto__" })], cell()).ok,
    ).toBe(true);
    expect(
      comparison.compareFacts(make(), make(), [mapping({ field: "__proto__" })], cell()).ok,
    ).toBe(false);
  });
  it("renames a referenced parent table and its coverage reference without replacing rows", () => {
    const old = make();
    const next = make();
    const before = old.schema.find((s) => s.name === "sales");
    const after = {
      ...before,
      name: "orders",
      table: "orders",
      rawSql: "CREATE TABLE orders(id TEXT PRIMARY KEY)",
    };
    next.schema[next.schema.findIndex((s) => s.name === "sales")] = after;
    next.rows[0].table = "orders";
    next.relationships[0].toTable = "orders";
    next.coverage.sales[0].table = "orders";
    next.coverage.issuedF1[0].table = "orders";
    const context = cell();
    context.migrations.push({ hash: "4".repeat(64), module: "sales" });
    const mappings = [
      mapping({
        id: "parent-rows",
        module: "sales",
        migrationHash: "4".repeat(64),
        object: { subject: "rows", key: "sales" },
        field: "table",
        before: "sales",
        after: "orders",
        exactTransform: "rename-object",
      }),
      mapping({
        id: "parent-schema",
        module: "sales",
        migrationHash: "4".repeat(64),
        object: { subject: "schema", key: "table:sales" },
        field: "object",
        before,
        after,
        exactTransform: "replace-exact",
      }),
    ];
    expect(comparison.compareFacts(old, next, mappings, context).ok).toBe(true);
  });
  it.each([
    { object: { subject: "rows", key: "products" }, field: "staffName" },
    { object: { subject: "rows", key: "persons" } },
    {
      object: { subject: "rows", key: "products" },
      field: "table",
      before: "products",
      after: "menus",
      exactTransform: "rename-object",
    },
    {
      object: { subject: "rows", key: "products" },
      field: "other",
      before: "products",
      after: "new",
      exactTransform: "rename-object",
    },
    { exactTransform: "replace-exact", before: int(1), after: int(2) },
    { sourceSha: "invalid" },
    { migrationHash: "invalid" },
  ])("refuses contradictory transforms %#", (override) => {
    expect(() => comparison.compareFacts(make(), make(), [mapping(override)], cell())).toThrow(
      "history.mapping",
    );
  });
  it("refuses mappings when a module is disabled or a target has no historical rows", () => {
    const context = cell();
    context.disabledModules.push("catalogue");
    expect(() => comparison.validateMappings([mapping()], context)).toThrow("history.mapping");
    const old = make();
    old.rows = old.rows.filter((r) => r.table !== "products");
    expect(() => comparison.compareFacts(old, old, [mapping()], cell())).toThrow("history.mapping");
    expect(() => comparison.validateMappings(null, cell())).toThrow("history.mapping");
  });
  it("renames a table with its original keys and relationship endpoints, using an exact independent schema mapping", () => {
    const old = make();
    const next = make();
    const oldObject = old.schema.find((s) => s.name === "lines");
    const newObject = globalThis.structuredClone(oldObject);
    newObject.name = "dishes";
    newObject.table = "dishes";
    newObject.rawSql = "CREATE TABLE dishes(id TEXT PRIMARY KEY)";
    next.schema[next.schema.findIndex((s) => s.name === "lines")] = newObject;
    next.rows.find((r) => r.table === "lines").table = "dishes";
    next.relationships[0].fromTable = "dishes";
    const mappings = [
      mapping({
        id: "rename-rows",
        object: { subject: "rows", key: "lines" },
        field: "table",
        before: "lines",
        after: "dishes",
        exactTransform: "rename-object",
      }),
      mapping({
        id: "rename-schema",
        object: { subject: "schema", key: "table:lines" },
        field: "object",
        before: oldObject,
        after: newObject,
        exactTransform: "replace-exact",
      }),
    ];
    expect(comparison.compareFacts(old, next, mappings, cell()).ok).toBe(true);
    next.rows.find((r) => r.table === "dishes").key = [txt("new-id")];
    expect(comparison.compareFacts(old, next, mappings, cell()).diffs).toContainEqual(
      expect.objectContaining({ subject: "rows", cause: "missing" }),
    );
  });
  it("accepts only an explicitly recorded operational field transition", () => {
    const old = make();
    const next = make();
    const rule = {
      table: "persons",
      key: [txt("person-1")],
      field: "lastSeen",
      before: txt("old-time"),
      after: txt("read-time"),
      cause: "Authenticated historical read",
      approvalReceipt: "review-read",
    };
    for (const f of [old, next]) {
      f.rows.find((r) => r.table === "persons").fields.lastSeen = txt("old-time");
      f.operationalRules = [rule];
    }
    next.rows.find((r) => r.table === "persons").fields.lastSeen = txt("read-time");
    expect(comparison.compareFacts(old, next, []).ok).toBe(true);
    next.rows.find((r) => r.table === "persons").fields.name = txt("Other");
    expect(comparison.compareFacts(old, next, []).diffs).toContainEqual(
      expect.objectContaining({ field: "name" }),
    );
  });
  it("refuses operational changes to fiscal or disabled rows, missing fields and incorrect before values", () => {
    for (const rule of [
      { table: "outbox", key: [txt("send-1")], field: "attempts", before: int(0), after: int(1) },
      {
        table: "bookings",
        key: [txt("booking-1")],
        field: "name",
        before: txt("Window seat"),
        after: txt("Other"),
      },
      {
        table: "persons",
        key: [txt("person-1")],
        field: "absent",
        before: txt("old"),
        after: txt("new"),
      },
      {
        table: "persons",
        key: [txt("person-1")],
        field: "name",
        before: txt("wrong"),
        after: txt("new"),
      },
    ]) {
      const old = make();
      old.operationalRules = [{ ...rule, cause: "Read", approvalReceipt: "review" }];
      expect(() => comparison.compareFacts(old, make(), [])).toThrow("history.mapping");
    }
  });
  it("allows only the reviewed added-null field, preserving every old value", () => {
    const old = make();
    const next = changed(make(), "products", "label", { kind: "null" });
    expect(comparison.compareFacts(old, next, [mapping()], cell()).ok).toBe(true);
    next.rows.find((r) => r.table === "products").fields.staffName = txt("Changed");
    expect(comparison.compareFacts(old, next, [mapping()], cell()).diffs).toContainEqual(
      expect.objectContaining({ field: "staffName" }),
    );
    expect(old.rows.find((r) => r.table === "products").fields).not.toHaveProperty("label");
  });
  it.each([
    { approvalReceipt: "" },
    { sourceEpoch: "wrong" },
    { sourceSha: "4".repeat(40) },
    { candidateSha: "4".repeat(40) },
    { migrationHash: "4".repeat(64) },
    { module: "unknown" },
    { field: "*" },
    { exactTransform: "tolerance" },
    { after: int(0) },
    { before: int(1) },
    { object: { subject: "rows", key: "registros_facturacion" }, field: "huella" },
    { object: { subject: "rows", key: "bookings" } },
  ])("rejects an unbound or forbidden mapping %#", (override) => {
    expect(() => comparison.compareFacts(make(), make(), [mapping(override)], cell())).toThrow(
      "history.mapping",
    );
  });
  it("requires context and refuses duplicate or unused mappings", () => {
    expect(() => comparison.compareFacts(make(), make(), [mapping()])).toThrow("history.mapping");
    expect(() => comparison.validateMappings([mapping(), mapping()], cell())).toThrow(
      "history.mapping",
    );
    expect(() =>
      comparison.compareFacts(
        make(),
        make(),
        [mapping({ object: { subject: "rows", key: "absent" } })],
        cell(),
      ),
    ).toThrow("history.mapping");
  });
});
