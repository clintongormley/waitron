import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createClient } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendPendingAlta, seedPendingEnvios } from "../test/drain-fixtures.js";
import { drain, DEFAULT_SKIP_RETRY_MS } from "./drain.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const at = (minute: number) => new Date(Date.UTC(2026, 6, 21, 0, minute));
const flag = "<sf:Incidencia>S</sf:Incidencia>";

function transport(fetch?: typeof globalThis.fetch) {
  const authority = createFakeAeat({ serverNow: at(0) });
  const xml: string[] = [];
  const client = createClient({
    endpoint: "https://example.test/soap",
    fetch: async (input, init) => {
      xml.push(String(init?.body));
      return (fetch ?? authority.fetch)(input, init);
    },
  });
  return {
    authority,
    xml,
    client,
    deps: {
      db: suite.db,
      environment: "production" as const,
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      resolveClient: async () => client,
    },
  };
}

it.each([false, true])(
  "remembers a preclaim client failure with metadata writes refused=%s",
  async (refuseWrites) => {
    await seedPendingEnvios(suite.db, { count: 1 });
    const t = transport();
    if (refuseWrites)
      await suite.db.execute(sql`
    create trigger outage_metadata_refusal before insert on envio_flujo
    begin select raise(abort, 'test metadata unavailable'); end
  `);
    try {
      const failed = await drain(
        {
          ...t.deps,
          resolveClient: async () => {
            throw new Error("certificate unavailable");
          },
        },
        at(1),
      );
      expect(failed.skipped).toHaveLength(1);
      expect(failed.recordsSubmitted).toBe(0);
      expect((await suite.db.execute(sql`select estado, intentos from envios`)).rows).toEqual([
        { estado: "pendiente", intentos: 0 },
      ]);
    } finally {
      if (refuseWrites) await suite.db.execute(sql`drop trigger outage_metadata_refusal`);
    }
    const recovered = await drain(t.deps, at(7));
    expect(recovered.recordsAccepted).toBe(1);
    expect(t.xml).toHaveLength(1);
    expect(t.xml[0]).toContain(flag);
  },
);

it("marks records appended after failure and during recovery, retaining the tail across cap and name boundaries", async () => {
  const seeded = await seedPendingEnvios(suite.db, { count: 3 });
  const authority = createFakeAeat({ serverNow: at(0) });
  let fail = true;
  let duringRecovery = false;
  const t = transport(async (input, init) => {
    if (fail) throw new Error("network down");
    if (!duringRecovery) {
      duringRecovery = true;
      await appendPendingAlta(suite.db, seeded, 5, { nombreRazonEmisor: "Renamed business" });
    }
    return authority.fetch(input, init);
  });
  const deps = { ...t.deps, maxRegistrosPorEnvio: 2 };
  await drain(deps, at(1));
  const fourth = await appendPendingAlta(suite.db, seeded, 4);
  fail = false;
  const firstRecovery = await drain(deps, at(3));
  expect(firstRecovery.recordsAccepted).toBe(4);
  expect(t.xml.slice(1).every((xml) => xml.includes(flag))).toBe(true);
  expect(
    (
      await suite.db.execute(
        sql`select technical_incidence from envios where registro_id = ${fourth.registroId}`,
      )
    ).rows,
  ).toEqual([{ technical_incidence: 1 }]);
  const renamed = await drain(deps, at(5));
  expect(renamed.recordsAccepted).toBe(1);
  expect(t.xml.at(-1)).toContain("Renamed business");
  expect(t.xml.at(-1)).toContain(flag);
  await appendPendingAlta(suite.db, seeded, 6, { nombreRazonEmisor: "Renamed business" });
  const clean = await drain(deps, at(7));
  expect(clean.recordsAccepted).toBe(1);
  expect(t.xml.at(-1)).not.toContain(flag);
});

it("marks newly claimed rows before sending while an older recovery request is held", async () => {
  const seeded = await seedPendingEnvios(suite.db, { count: 1 });
  const authority = createFakeAeat({ serverNow: at(0) });
  let fail = true;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let hold = true;
  const t = transport(async (input, init) => {
    if (fail) throw new Error("network down");
    if (hold) {
      hold = false;
      entered();
      await gate;
    }
    return authority.fetch(input, init);
  });
  await drain(t.deps, at(1));
  fail = false;
  const recovery = drain(t.deps, at(3));
  try {
    await waiting;
    const { seedSecondChain } = await import("../test/drain-fixtures.js");
    await seedSecondChain(suite.db, seeded, 2);
    const concurrent = await drain(t.deps, at(3));
    expect(concurrent.recordsAccepted).toBe(1);
    expect(t.xml.at(-1)).toContain(flag);
  } finally {
    release();
    await recovery;
  }
});

it("uses a marked later row in a mixed ordinary batch", async () => {
  const seeded = await seedPendingEnvios(suite.db, { count: 2 });
  await suite.db.execute(
    sql`update envios set technical_incidence = 1 where registro_id = ${seeded.registroIds[1]!}`,
  );
  const t = transport();
  expect((await drain(t.deps, at(1))).recordsAccepted).toBe(2);
  expect(t.xml[0]).toContain(flag);
});

it.each(["lost", "http", "xml", "save"])(
  "preserves retry outcomes through a %s failure",
  async (fault) => {
    await seedPendingEnvios(suite.db, { count: 1 });
    const authority = createFakeAeat({ serverNow: at(0) });
    let failing = true;
    const t = transport(async (input, init) => {
      if (failing && fault === "http") return new Response("unavailable", { status: 503 });
      if (failing && fault === "xml") return new Response("<broken>", { status: 200 });
      const response = await authority.fetch(input, init);
      if (failing && fault === "lost") throw new Error("response lost");
      return response;
    });
    if (fault === "save")
      await suite.db.execute(sql`
    create trigger outage_response_refusal before update of estado on envios
    when new.estado in ('aceptado', 'aceptado_con_errores')
    begin select raise(abort, 'test response save unavailable'); end
  `);
    try {
      const failed = await drain(t.deps, at(1));
      expect(failed.recordsAccepted).toBe(0);
      expect(failed.recordsSubmitted).toBe(fault === "save" ? 1 : 0);
      expect((await suite.db.execute(sql`select estado from envios`)).rows).toEqual([
        { estado: "pendiente" },
      ]);
    } finally {
      if (fault === "save") await suite.db.execute(sql`drop trigger outage_response_refusal`);
    }
    failing = false;
    const recovered = await drain(t.deps, at(3));
    expect(recovered.recordsAccepted).toBe(1);
    expect(recovered.recordsSubmitted).toBe(1);
    expect(t.xml[1]).toContain(flag);
    expect(
      (await suite.db.execute(sql`select estado, intentos, technical_incidence from envios`)).rows,
    ).toEqual([{ estado: "aceptado", intentos: 2, technical_incidence: 1 }]);
  },
);

it("a late success keeps a newer failure token open for newly arriving work", async () => {
  const seeded = await seedPendingEnvios(suite.db, { count: 1 });
  const authority = createFakeAeat({ serverNow: at(0) });
  let fail = true;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let hold = true;
  const t = transport(async (input, init) => {
    if (fail) throw new Error("network down");
    if (hold) {
      hold = false;
      entered();
      await gate;
    }
    return authority.fetch(input, init);
  });
  await drain(t.deps, at(1));
  const original = (await suite.db.execute(sql`select technical_incident_token from envio_flujo`))
    .rows[0];
  fail = false;
  const recovery = drain(t.deps, at(3));
  try {
    await waiting;
    const { seedSecondChain } = await import("../test/drain-fixtures.js");
    await seedSecondChain(suite.db, seeded, 2);
    fail = true;
    await drain(t.deps, at(3));
    const newer = (await suite.db.execute(sql`select technical_incident_token from envio_flujo`))
      .rows[0];
    expect(newer).not.toEqual(original);
    release();
    expect((await recovery).recordsAccepted).toBe(1);
    expect(
      (await suite.db.execute(sql`select technical_incident_token from envio_flujo`)).rows[0],
    ).toEqual(newer);
  } finally {
    release();
    await recovery;
  }
  fail = false;
  await drain(t.deps, at(6));
  expect(t.xml.at(-1)).toContain(flag);
  expect(
    (await suite.db.execute(sql`select technical_incident_token from envio_flujo`)).rows,
  ).toEqual([{ technical_incident_token: null }]);
});

it("marks due held probes but excludes terminal, set-aside, not-yet-due holds", async () => {
  const heldChain = await seedPendingEnvios(suite.db, { count: 3 });
  const t = transport();
  for (const key of heldChain.facturaKeys) t.authority.reject(key, 1100, "Invalid test record");
  await drain(t.deps, at(1));
  const firstHeld = await appendPendingAlta(suite.db, heldChain, 4);
  const laterHeld = await appendPendingAlta(suite.db, heldChain, 5);
  await drain(t.deps, at(2));
  const { seedSecondChain } = await import("../test/drain-fixtures.js");
  const ordinary = await seedSecondChain(suite.db, heldChain, 6);
  const wrong = await appendPendingAlta(suite.db, heldChain, 7);
  await suite.db.execute(
    sql`update envios set estado = 'retenido' where registro_id = ${wrong.registroId}`,
  );
  await drain(
    {
      ...t.deps,
      resolveClient: async () => {
        throw new Error("certificate failure");
      },
    },
    at(63),
  );
  const rows = (await suite.db.execute(sql`select registro_id, technical_incidence from envios`))
    .rows;
  expect(rows.find((row) => row.registro_id === firstHeld.registroId)?.technical_incidence).toBe(1);
  expect(rows.find((row) => row.registro_id === laterHeld.registroId)?.technical_incidence).toBe(0);
  expect(rows.find((row) => row.registro_id === ordinary.registroId)?.technical_incidence).toBe(1);
  for (const id of [...heldChain.registroIds, wrong.registroId])
    expect(rows.find((row) => row.registro_id === id)?.technical_incidence).toBe(0);
});

it("retains failed-probe evidence through a reopened database and an ordinary refusal", async () => {
  const seeded = await seedPendingEnvios(suite.db, { count: 3 });
  const authority = createFakeAeat({ serverNow: at(0) });
  for (const key of seeded.facturaKeys) authority.reject(key, 1100, "Invalid test record");
  let unavailable = false;
  const t = transport((input, init) => {
    if (unavailable) return Promise.reject(new Error("connection reset"));
    return authority.fetch(input, init);
  });
  await drain(t.deps, at(1));
  const held = await appendPendingAlta(suite.db, seeded, 4);
  authority.reject(held.facturaKey, 1100, "Invalid test record");
  const successor = await appendPendingAlta(suite.db, seeded, 5);
  await drain(t.deps, at(2));
  unavailable = true;
  expect((await drain(t.deps, at(62))).recordsSubmitted).toBe(0);
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { openVenueDatabase } = await import("@waitron/db");
  const { resetInFlightClaims } = await import("./drain.js");
  const directory = await mkdtemp(join(tmpdir(), "waitron-outage-reopen-"));
  let reopened: Awaited<ReturnType<typeof openVenueDatabase>> | undefined;
  try {
    await suite.db.archiveTo(join(directory, "venue.db"));
    reopened = await openVenueDatabase(directory);
    await reopened.close();
    reopened = undefined;
    reopened = await openVenueDatabase(directory);
    const db = reopened.venue;
    await resetInFlightClaims(db, at(63));
    unavailable = false;
    expect((await drain({ ...t.deps, db }, at(63))).recordsSubmitted).toBe(0);
    const refused = await drain({ ...t.deps, db }, at(122));
    expect(refused.recordsSubmitted).toBe(1);
    expect(refused.recordsAccepted).toBe(0);
    expect(t.xml.at(-1)).toContain(flag);
    expect(
      (
        await db.execute(
          sql`select estado, intentos, technical_incidence from envios where registro_id = ${held.registroId}`,
        )
      ).rows,
    ).toEqual([{ estado: "rechazado", intentos: 3, technical_incidence: 1 }]);
    expect((await db.execute(sql`select technical_incident_token from envio_flujo`)).rows).toEqual([
      { technical_incident_token: null },
    ]);
    const healthyAuthority = createFakeAeat({ serverNow: at(0) });
    const healthy = transport(healthyAuthority.fetch);
    const accepted = await drain({ ...healthy.deps, db }, at(182));
    expect(accepted.recordsAccepted).toBe(1);
    expect(healthy.xml[0]).not.toContain(flag);
    expect(
      (
        await db.execute(
          sql`select estado, technical_incidence from envios where registro_id = ${successor.registroId}`,
        )
      ).rows,
    ).toEqual([{ estado: "aceptado", technical_incidence: 0 }]);
  } finally {
    if (reopened !== undefined) await reopened.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("excludes a pending cancellation of a refused original from an unrelated technical cohort", async () => {
  const seeded = await seedPendingEnvios(suite.db, { count: 1 });
  const t = transport();
  t.authority.reject(seeded.facturaKeys[0]!, 1100, "Invalid test record");
  await drain(t.deps, at(1));
  const { appendCancellation, seedIndependentChain } = await import("../test/drain-fixtures.js");
  const cancellation = await appendCancellation(suite.db, seeded, seeded.registroIds[0]!, 2);
  const wrong = await seedIndependentChain(suite.db, {
    sifId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    secuencia: 1,
    entorno: "preproduction",
  });
  await drain(
    {
      ...t.deps,
      resolveClient: async () => {
        throw new Error("certificate unavailable");
      },
    },
    at(3),
  );
  for (const id of [cancellation, wrong.registroId]) {
    expect(
      (
        await suite.db.execute(
          sql`select technical_incidence from envios where registro_id = ${id}`,
        )
      ).rows,
    ).toEqual([{ technical_incidence: 0 }]);
  }
});

it("remembers a failed metadata write after a committed claim until stale recovery can retry", async () => {
  await seedPendingEnvios(suite.db, { count: 1 });
  const failedTransport = transport(async () => {
    throw new Error("network down");
  });
  await suite.db.execute(sql`create trigger outage_metadata_refusal before insert on envio_flujo
    begin select raise(abort, 'test metadata unavailable'); end`);
  try {
    const failed = await drain(failedTransport.deps, at(1));
    expect(failed.skipped).toHaveLength(1);
    expect((await suite.db.execute(sql`select estado, intentos from envios`)).rows).toEqual([
      { estado: "enviando", intentos: 1 },
    ]);
  } finally {
    await suite.db.execute(sql`drop trigger outage_metadata_refusal`);
  }
  const recoveredTransport = transport();
  const recovered = await drain(recoveredTransport.deps, at(7));
  expect(recovered.recordsAccepted).toBe(1);
  expect(recoveredTransport.xml[0]).toContain(flag);
});

it("reads a marked probe after a clean ordinary row when building the shared batch header", async () => {
  const seeded = await seedPendingEnvios(suite.db, { count: 3 });
  const t = transport();
  for (const key of seeded.facturaKeys) t.authority.reject(key, 1100, "Invalid test record");
  await drain(t.deps, at(1));
  const held = await appendPendingAlta(suite.db, seeded, 4);
  await drain(t.deps, at(2));
  const { seedSecondChain } = await import("../test/drain-fixtures.js");
  const clean = await seedSecondChain(suite.db, seeded, 6);
  await suite.db.execute(
    sql`update envios set technical_incidence = 1 where registro_id = ${held.registroId}`,
  );
  t.xml.length = 0;
  const result = await drain(t.deps, at(62));
  expect(result.recordsSubmitted).toBe(2);
  expect(result.recordsAccepted).toBe(2);
  expect(t.xml).toHaveLength(1);
  expect(t.xml[0]!.indexOf(clean.registroId)).toBeLessThan(t.xml[0]!.indexOf(held.registroId));
  expect(t.xml[0]).toContain(flag);
});

it.each(["warning", "unknown"])(
  "does not call a readable %s response a technical outage",
  async (kind) => {
    await seedPendingEnvios(suite.db, { count: 1, futureDated: kind === "warning" });
    const authority = createFakeAeat({ serverNow: at(0) });
    const t = transport(async (input, init) => {
      const response = await authority.fetch(input, init);
      if (kind === "warning") return response;
      const body = (await response.text()).replace(
        /<sfR:EstadoRegistro>Correcto<\/sfR:EstadoRegistro>/g,
        "<sfR:EstadoRegistro>Unexpected</sfR:EstadoRegistro>",
      );
      return new Response(body, { status: response.status, headers: response.headers });
    });
    const result = await drain(t.deps, at(1));
    expect(result.recordsSubmitted).toBe(1);
    expect(t.xml[0]).not.toContain(flag);
    expect((await suite.db.execute(sql`select technical_incidence from envios`)).rows).toEqual([
      { technical_incidence: 0 },
    ]);
    expect(
      (await suite.db.execute(sql`select technical_incident_token from envio_flujo`)).rows,
    ).toEqual([{ technical_incident_token: null }]);
    expect((await suite.db.execute(sql`select estado, incidencia from envios`)).rows).toEqual([
      {
        estado: kind === "warning" ? "aceptado_con_errores" : "pendiente",
        incidencia: kind === "warning" ? 0 : 1,
      },
    ]);
  },
);

it("flushes a concurrent failed metadata write before a delayed resolver may claim new work", async () => {
  const seeded = await seedPendingEnvios(suite.db, { count: 1 });
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const t = transport();
  const delayed = drain(
    {
      ...t.deps,
      resolveClient: async () => {
        entered();
        await gate;
        return t.client;
      },
    },
    at(1),
  );
  await waiting;
  const failedTransport = transport(async () => {
    throw new Error("network down");
  });
  await suite.db.execute(sql`create trigger outage_metadata_refusal before insert on envio_flujo
    begin select raise(abort, 'test metadata unavailable'); end`);
  let resumed: Awaited<ReturnType<typeof drain>>;
  try {
    expect((await drain(failedTransport.deps, at(1))).skipped).toHaveLength(1);
    const { seedSecondChain } = await import("../test/drain-fixtures.js");
    await seedSecondChain(suite.db, seeded, 2);
    release();
    resumed = await delayed;
  } finally {
    release();
    await delayed;
    await suite.db.execute(sql`drop trigger outage_metadata_refusal`);
  }
  const recovered = await drain(t.deps, at(7));
  expect(resumed!.recordsSubmitted).toBe(0);
  expect(recovered.recordsAccepted).toBe(2);
  expect(t.xml).toHaveLength(1);
  expect(t.xml[0]).toContain(flag);
});

it.each([false, true])(
  "keeps failed-probe evidence when another send fails with overlap=%s",
  async (overlap) => {
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    const t = transport();
    for (const key of seeded.facturaKeys) t.authority.reject(key, 1100, "Invalid test record");
    await drain(t.deps, at(1));
    const held = await appendPendingAlta(suite.db, seeded, 4);
    await drain(t.deps, at(2));
    const { seedSecondChain } = await import("../test/drain-fixtures.js");
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ordinary = transport(async () => {
      entered();
      await gate;
      throw new Error("ordinary transport failed");
    });
    let pending: ReturnType<typeof drain> | undefined;
    if (overlap) {
      await seedSecondChain(suite.db, seeded, 6);
      pending = drain({ ...ordinary.deps, maxRegistrosPorEnvio: 1 }, at(62));
      await waiting;
    }
    const probe = transport(async () => {
      throw new Error("probe transport failed");
    });
    await suite.db.execute(sql`create trigger outage_metadata_refusal before insert on envio_flujo
    begin select raise(abort, 'test metadata unavailable'); end`);
    try {
      expect(
        (await drain({ ...probe.deps, maxRegistrosPorEnvio: 1 }, at(62))).skipped,
      ).toHaveLength(1);
    } finally {
      await suite.db.execute(sql`drop trigger outage_metadata_refusal`);
      release();
      if (pending !== undefined) await pending;
    }
    if (!overlap) await seedSecondChain(suite.db, seeded, 6);
    expect((await drain(t.deps, at(64))).recordsAccepted).toBe(1);
    expect(
      (
        await suite.db.execute(
          sql`select technical_incidence from envios where registro_id = ${held.registroId}`,
        )
      ).rows,
    ).toEqual([{ technical_incidence: 1 }]);
    t.xml.length = 0;
    expect((await drain(t.deps, at(122))).recordsAccepted).toBe(1);
    expect(t.xml).toHaveLength(1);
    expect(t.xml[0]).toContain(flag);
  },
);
