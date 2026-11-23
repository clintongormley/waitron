import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { checkFiscalChains } from "@waitron/fiscal-verifactu/src/handover-chain-check.js";
import { PERSON_HEADER } from "@waitron/shared";
import { openBackupQuery } from "@waitron/store";
import { SESSION_COOKIE } from "../../src/till-session.js";
import { installBenchClock } from "./bench-clock.js";
import { openBenchVenue } from "./bench-venue.js";
import { runCli } from "./cli.js";
import { countRows, tradeDay } from "./trading-day.js";

async function chainIn(dir: string) {
  const handle = await openBackupQuery(join(dir, "venue.db"));
  try {
    return await checkFiscalChains(handle.query);
  } finally {
    await handle.close();
  }
}

it("grows a bench chain with complete synthetic records and keeps the next counter sale linked", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-bench-grow-fiscal-"));
  const clock = installBenchClock(new Date("2025-11-03T08:00:00Z"));
  try {
    const base = await openBenchVenue(dir, { seed: 1 });
    let before: ReturnType<typeof countRows>;
    let firstGrownPosition: number;
    try {
      await tradeDay(base, "2025-11-03", 3);
      await tradeDay(base, "2025-11-04", 3);
      before = countRows(base);
      const [template] = base.db.all<{ orderId: string; position: number }>(
        sql`select s.working_order_id as orderId, r.secuencia as position
              from verifactu_records r join sales s on s.id = r.sale_id
              order by r.secuencia desc limit 1`,
      );
      expect(template?.orderId).toBeTruthy();
      firstGrownPosition = template!.position + 1;
    } finally {
      await base.close();
    }

    const output: string[] = [];
    await runCli(
      ["grow-fiscal", "--venue", dir, "--records", String(before.verifactu_records! + 50)],
      (line) => output.push(line),
    );
    expect(output).toContain("chains ok");

    const grown = await openBenchVenue(dir, { seed: 1 });
    try {
      const after = countRows(grown);
      for (const table of ["verifactu_records", "sales", "verifactu_submissions"])
        expect(after[table], table).toBe(before[table]! + 50);
      const grownRecords = grown.db.all<{ orderId: string | null; huella: string }>(
        sql`select s.working_order_id as orderId, r.huella
              from verifactu_records r join sales s on s.id = r.sale_id
              where r.secuencia >= ${firstGrownPosition}
              order by r.secuencia`,
      );
      expect(grownRecords.map((record) => record.orderId)).toEqual(Array(50).fill(null));
      expect(await chainIn(dir)).toBe("ok");

      clock.set(new Date("2025-11-05T09:00:00Z"));
      const till = grown.tills[0]!;
      const waiter = grown.waiters[0]!;
      const login = await grown.app.request("/api/session", {
        method: "POST",
        headers: { cookie: till.cookie, "content-type": "application/json" },
        body: JSON.stringify({ personId: waiter.id, pin: waiter.pin }),
      });
      expect(login.status, await login.text()).toBe(200);
      const session = login.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))!
        .split(";")[0];
      const orderId = randomUUID();
      const sale = await grown.app.request(`/api/working-orders/${orderId}/payments`, {
        method: "POST",
        headers: {
          cookie: `${session}; ${till.cookie}`,
          [PERSON_HEADER]: waiter.id,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          submissionId: orderId,
          kind: "share",
          shareOf: 1,
          method: "cash",
          tendered: "200.00",
          dining: "eat_in",
          basket: { lines: [{ menuItemId: grown.dishes[0]!.menuItemId, quantity: "1" }] },
        }),
      });
      expect(sale.status, await sale.text()).toBe(200);
      expect(
        grown.db.all(sql`
          select secuencia, anterior_huella from verifactu_records order by secuencia desc limit 1
        `),
      ).toEqual([
        {
          secuencia: firstGrownPosition + 50,
          anterior_huella: grownRecords.at(-1)!.huella,
        },
      ]);
    } finally {
      await grown.close();
    }

    const damage = new DatabaseSync(join(dir, "venue.db"));
    try {
      damage.exec("drop trigger verifactu_records_append_only_update");
      damage
        .prepare("update verifactu_records set huella = ? where secuencia = ?")
        .run("0".repeat(64), firstGrownPosition);
    } finally {
      damage.close();
    }
    expect(await chainIn(dir)).toBe("broken");
  } finally {
    clock.uninstall();
    rmSync(dir, { recursive: true, force: true });
  }
}, 60_000);
