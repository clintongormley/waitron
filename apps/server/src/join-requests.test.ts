import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  JOIN_TTL_MS,
  PENDING_CAP,
  acceptDeviceJoinRequest,
  challengeFor,
  createJoinRequest,
  denyJoinRequest,
  listPendingJoinRequests,
  readJoinStatus,
} from "./join-requests.js";
// `useTemplateDb` is NOT on the `@waitron/db` barrel — the exports map is enumerated (CLAUDE.md §3),
// and the sibling suite imports it from the subpath (`device-api.pg.test.ts:5-6`).
import { asAppUser, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import type { TillConfig } from "./till-config.js";
import { setupVenue } from "./testing/venue-fixtures.js";

// Real Postgres, not PGlite — these verbs run as `app_user` and the `join_requests` grants (SELECT,
// INSERT, DELETE, no UPDATE) are part of what is being asserted; PGlite connects as a superuser, where
// a missing grant passes and the run would be a false pass.
const suite = useTemplateDb({ template: "manifest" });

// A device_profiles row of the given form factor, seeded directly (superuser connection — this table's
// grants are not what any test here is asserting). Copied from device-api.pg.test.ts:177-188 rather than
// shared, the same call this file's sibling suites make (module state — the counter — resets per file).
let profileCounter = 0;
async function seedProfile(
  cfg: TillConfig,
  formFactor: "till" | "kds" | "phone-portrait" | "tablet-landscape",
): Promise<string> {
  profileCounter += 1;
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    insert into device_profiles (tenant_id, name, form_factor, capabilities)
    values (${cfg.tenantId}, ${`Profile ${profileCounter}`}, ${formFactor}, '[]'::jsonb)
    returning id`);
  return rows[0]!.id;
}

describe("createJoinRequest", () => {
  it("mints a two-digit number, an id and a token, and leaves one pending row", async () => {
    const venue = await setupVenue(suite.admin);
    const made = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "Bar till",
      });
    });
    expect(made.verificationNumber).toMatch(/^\d{2}$/);
    expect(made.token.length).toBeGreaterThan(20);
    expect(made.joinId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("never mints a number another pending request already holds, in EITHER kind", async () => {
    const venue = await setupVenue(suite.admin);
    // Force the generator to want 47 every time; the first request takes it, the second must not.
    const always47 = () => 47;
    const first = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, {
        kind: "print_agent",
        label: "Kitchen box",
        numbers: always47,
      });
    });
    expect(first.verificationNumber).toBe("47");
    const second = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, {
        kind: "device",
        label: "Bar till",
        numbers: (() => {
          let n = 0;
          return () => (n++ === 0 ? 47 : 13);
        })(),
      });
    });
    expect(second.verificationNumber).toBe("13");
  });

  it("refuses a real number that is already someone else's DECOY (rule: real avoids issued decoys)", async () => {
    const venue = await setupVenue(suite.admin);
    // Seeded directly via the superuser connection, bypassing createJoinRequest entirely — decoys
    // are deliberately non-injectable (production always draws them from randomInt), so this is the
    // only way to pin one to a known value. The seeded row's own REAL number is 77, unrelated to 13:
    // if it were 13 too, a broken "real avoids existing reals" rule would make this pass for the
    // wrong reason.
    await suite.admin.execute(sql`
      insert into join_requests (tenant_id, location_id, kind, label, token_hash, verification_number, decoy_numbers)
      values (${venue.cfg.tenantId}, ${venue.cfg.locationId}, 'device'::join_request_kind, 'seeded', 'x', '77', '{13,86}'::text[])
    `);
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await expect(
        createJoinRequest(tx, venue.cfg, { kind: "device", label: "wants 13", numbers: () => 13 }),
      ).rejects.toMatchObject({ code: "device.join_full" });
    });
  });

  it("refuses to mint the second DECOY once every other value is already someone's real number (rule: decoys avoid existing reals)", async () => {
    const venue = await setupVenue(suite.admin);
    // 98 of the 100 two-digit values are already reals, seeded under a DIFFERENT kind so the
    // per-(tenant, kind) cap (10) never trips on them — pendingNumbers reads across BOTH kinds
    // (design §1.2 rule 3), so they still count toward this request's forbidden set. "00" and "01"
    // are the only two values left free.
    await suite.admin.execute(sql`
      insert into join_requests (tenant_id, location_id, kind, label, token_hash, verification_number, decoy_numbers)
      select ${venue.cfg.tenantId}, ${venue.cfg.locationId}, 'print_agent'::join_request_kind,
             'seed ' || n, 'x', lpad(n::text, 2, '0'), '{}'::text[]
      from generate_series(2, 99) as n
    `);
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      // Force the real pick onto "00", the first free value — "01" is then the ONLY value left for
      // the two decoys, which is not enough: the second decoy can never be found.
      await expect(
        createJoinRequest(tx, venue.cfg, { kind: "device", label: "wants 00", numbers: () => 0 }),
      ).rejects.toMatchObject({ code: "device.join_full" });
    });
  });

  it("refuses past the cap, per (tenant, kind)", async () => {
    const venue = await setupVenue(suite.admin);
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      for (let i = 0; i < PENDING_CAP; i++) {
        await createJoinRequest(tx, venue.cfg, {
          kind: "device",
          label: `d${i}`,
        });
      }
      await expect(
        createJoinRequest(tx, venue.cfg, {
          kind: "device",
          label: "one too many",
        }),
      ).rejects.toMatchObject({ code: "device.join_full" });
      // The OTHER kind is unaffected — the cap is per (tenant, kind).
      await expect(
        createJoinRequest(tx, venue.cfg, {
          kind: "print_agent",
          label: "agent",
        }),
      ).resolves.toBeDefined();
    });
  });

  it("sweeps lapsed requests, so they do not occupy the cap or a number", async () => {
    const venue = await setupVenue(suite.admin);
    const stale = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "stale" });
    });
    // Back-date it as the SUPERUSER connection — app_user holds no UPDATE on join_requests
    // (deliberately, CLAUDE.md §3), so this fixture step cannot run inside an asAppUser transaction.
    const lapsed = new Date(Date.now() - JOIN_TTL_MS - 60_000).toISOString();
    await suite.admin.execute(
      sql`update join_requests set created_at = ${lapsed} where id = ${stale.joinId}`,
    );
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createJoinRequest(tx, venue.cfg, { kind: "device", label: "fresh" });
      // Scoped to this venue's tenant — the suite shares one database clone across tests, so an
      // unscoped select would also see other tests' rows.
      const { rows } = await tx.execute<{ label: string }>(
        sql`select label from join_requests where tenant_id = ${venue.cfg.tenantId}`,
      );
      expect(rows.map((r) => r.label)).toEqual(["fresh"]);
    });
  });
});

describe("readJoinStatus", () => {
  it("is pending for a live request with the right token", async () => {
    const venue = await setupVenue(suite.admin);
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
      const status = await readJoinStatus(tx, venue.cfg, made.joinId, made.token);
      expect(status).toBe("pending");
    });
  });

  it("is not_approved for a wrong token on a live request", async () => {
    const venue = await setupVenue(suite.admin);
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
      const status = await readJoinStatus(tx, venue.cfg, made.joinId, "wrong-token");
      expect(status).toBe("not_approved");
    });
  });

  it("does not leak another tenant's pending request — the id alone is not enough", async () => {
    // A globally-unique join id is not the query's isolation boundary (CLAUDE.md §3, since RLS was
    // dropped): venue B's session must not resolve venue A's join id, right token and all.
    const venueA = await setupVenue(suite.admin);
    const venueB = await setupVenue(suite.admin);
    const madeA = await withTenant(suite.admin, venueA.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venueA.cfg, { kind: "device", label: "A's till" });
    });
    await withTenant(suite.admin, venueB.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const status = await readJoinStatus(tx, venueB.cfg, madeA.joinId, madeA.token);
      expect(status).toBe("not_approved");
    });
  });

  it("is not_approved for an id that never existed", async () => {
    const venue = await setupVenue(suite.admin);
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const status = await readJoinStatus(
        tx,
        venue.cfg,
        "00000000-0000-4000-8000-000000000000",
        "irrelevant-token",
      );
      expect(status).toBe("not_approved");
    });
  });

  it("is not_approved once the request has lapsed", async () => {
    const venue = await setupVenue(suite.admin);
    const made = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
    });
    // Back-date it as the SUPERUSER connection — app_user holds no UPDATE on join_requests
    // (deliberately, CLAUDE.md §3), so this fixture step cannot run inside an asAppUser transaction.
    const lapsed = new Date(Date.now() - JOIN_TTL_MS - 60_000).toISOString();
    await suite.admin.execute(
      sql`update join_requests set created_at = ${lapsed} where id = ${made.joinId}`,
    );
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const status = await readJoinStatus(tx, venue.cfg, made.joinId, made.token);
      expect(status).toBe("not_approved");
    });
  });
  // The `approved` case needs an accepted device — see acceptDeviceJoinRequest's own first test below,
  // which asserts it via this same function.
});

describe("listPendingJoinRequests", () => {
  it("returns pending rows of the asked-for kind and NEVER the number", async () => {
    const venue = await setupVenue(suite.admin);
    const rows = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
      await createJoinRequest(tx, venue.cfg, { kind: "print_agent", label: "Box" });
      return listPendingJoinRequests(tx, venue.cfg, "device");
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe("Bar till");
    // The whole point of the numeric match: the list cannot show the answer beside the question. The
    // key set is what expresses that — a "no two digits anywhere" assertion would trip on the row's
    // own UUID and ISO timestamp and could never pass.
    expect(Object.keys(rows[0]!).sort()).toEqual(["createdAt", "id", "kind", "label"]);
  });
});

describe("challengeFor", () => {
  it("returns three choices, one of which is the request's own number", async () => {
    const venue = await setupVenue(suite.admin);
    const { made, choices } = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
      return { made, choices: (await challengeFor(tx, venue.cfg, made.joinId)).choices };
    });
    expect(choices).toHaveLength(3);
    expect(new Set(choices).size).toBe(3);
    expect(choices).toContain(made.verificationNumber);
    for (const c of choices) expect(c).toMatch(/^\d{2}$/);
  });

  it("returns the SAME three numbers on every call — a second call must teach nothing", async () => {
    const venue = await setupVenue(suite.admin);
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
      const first = await challengeFor(tx, venue.cfg, made.joinId);
      const second = await challengeFor(tx, venue.cfg, made.joinId);
      // Sets, not arrays: the order is shuffled per call, the MEMBERSHIP is fixed. Two re-rolled sets
      // would intersect in exactly one value — the real one — handing the answer to any client with a
      // management session.
      expect(new Set(second.choices)).toEqual(new Set(first.choices));
    });
  });

  it("never offers a decoy that is another pending request's real number, in EITHER kind", async () => {
    const venue = await setupVenue(suite.admin);
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      // The agent request's REAL number is spoken for the moment it exists — createJoinRequest's own
      // forbidden set (reals ∪ decoys, both kinds) is what keeps the device request's pick and decoys
      // off it; challengeFor has no number source to rig, so this is proven by construction, not by
      // forcing a collision attempt.
      const agent = await createJoinRequest(tx, venue.cfg, { kind: "print_agent", label: "a" });
      const device = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
      const { choices } = await challengeFor(tx, venue.cfg, device.joinId);
      expect(choices).toContain(device.verificationNumber);
      expect(choices).not.toContain(agent.verificationNumber);
    });
  });

  it("shuffles the choice order — the real number is not always at the same index", async () => {
    const venue = await setupVenue(suite.admin);
    // One pending request at a time, denied before the next is made, to stay under PENDING_CAP while
    // sampling enough shuffles that a fixed position (a broken Fisher-Yates) would show up reliably.
    const positions = new Set<number>();
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      for (let i = 0; i < 30; i++) {
        const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: `d${i}` });
        const { choices } = await challengeFor(tx, venue.cfg, made.joinId);
        positions.add(choices.indexOf(made.verificationNumber));
        await denyJoinRequest(tx, venue.cfg, made.joinId);
      }
    });
    expect(positions.size).toBeGreaterThan(1);
  });

  it("throws join_request.not_found for an unknown id, and for another tenant's request", async () => {
    const venueA = await setupVenue(suite.admin);
    const venueB = await setupVenue(suite.admin);
    const madeA = await withTenant(suite.admin, venueA.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venueA.cfg, { kind: "device", label: "A's till" });
    });
    await withTenant(suite.admin, venueA.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await expect(
        challengeFor(tx, venueA.cfg, "00000000-0000-4000-8000-000000000000"),
      ).rejects.toMatchObject({ code: "join_request.not_found" });
    });
    await withTenant(suite.admin, venueB.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await expect(challengeFor(tx, venueB.cfg, madeA.joinId)).rejects.toMatchObject({
        code: "join_request.not_found",
      });
    });
  });
});

describe("acceptDeviceJoinRequest", () => {
  it("creates the device with the request's OWN id, so the joiner's cookie survives", async () => {
    const venue = await setupVenue(suite.admin);
    const profileId = await seedProfile(venue.cfg, "till");
    const { made, accepted, status } = await withTenant(
      suite.admin,
      venue.cfg.tenantId,
      async (tx) => {
        await asAppUser(tx);
        const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label: "Bar till" });
        const accepted = await acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
          choice: made.verificationNumber,
          profileId,
        });
        return {
          made,
          accepted,
          status: await readJoinStatus(tx, venue.cfg, made.joinId, made.token),
        };
      },
    );
    expect(accepted).toMatchObject({ ok: true, deviceId: made.joinId, formFactor: "till" });
    expect(status).toBe("approved");
  });

  it("auto-creates the register for a till form factor, in the SAME transaction as the device", async () => {
    const venue = await setupVenue(suite.admin);
    const profileId = await seedProfile(venue.cfg, "till");
    const label = "Bar till";
    const accepted = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const made = await createJoinRequest(tx, venue.cfg, { kind: "device", label });
      return acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
        choice: made.verificationNumber,
        profileId,
      });
    });
    if (!accepted.ok) throw new Error("expected accept to succeed");
    const { rows } = await suite.admin.execute<{ id: string; till_id: string | null }>(sql`
      select t.id, d.till_id from tills t
      join devices d on d.till_id = t.id
      where t.tenant_id = ${venue.cfg.tenantId} and t.name = ${label} and d.id = ${accepted.deviceId}
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.till_id).toBe(rows[0]!.id);
  });

  it("rolls the register back when the device insert fails", async () => {
    const venue = await setupVenue(suite.admin);
    const profileId = await seedProfile(venue.cfg, "till");
    const made = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "Blocked till" });
    });
    // Plant a devices row under the request's OWN id first: acceptDeviceJoinRequest reuses that id, so
    // its device INSERT collides on the primary key AFTER resolveDeviceBinding has already
    // auto-created the till-form-factor register — the write order the "one transaction" comment
    // depends on. `device_binding_rule` demands a till_id for this profile's form factor, so the
    // blocker borrows the venue's own provisioned register — any live till satisfies the trigger.
    await suite.admin.execute(sql`
      insert into devices (id, tenant_id, location_id, till_id, device_profile_id, label, token_hash, active)
      values (${made.joinId}, ${venue.cfg.tenantId}, ${venue.cfg.locationId}, ${venue.cfg.tillId}, ${profileId}, 'blocker', 'x', true)
    `);
    await expect(
      withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
          choice: made.verificationNumber,
          profileId,
        });
      }),
    ).rejects.toThrow();
    const { rows } = await suite.admin.execute<{ id: string }>(
      sql`select id from tills where tenant_id = ${venue.cfg.tenantId} and name = 'Blocked till'`,
    );
    expect(rows).toHaveLength(0);
  });

  it("DENIES on a wrong choice, and the deny SURVIVES THE TRANSACTION", async () => {
    const venue = await setupVenue(suite.admin);
    const profileId = await seedProfile(venue.cfg, "till");
    // Two SEPARATE withTenant blocks on purpose. A single block that catches the rejection inside
    // itself never commits or rolls anything back, so it would pass against code that throws from
    // inside the transaction and loses the DELETE — the defect this test exists to catch.
    const made = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
    });
    const wrong = made.verificationNumber === "00" ? "01" : "00";
    const refused = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, { choice: wrong, profileId });
    });
    expect(refused).toEqual({ ok: false, reason: "mismatch" });
    // Gone AFTER the transaction committed — this is what makes one-in-three an acceptable guess rate.
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await expect(
        acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
          choice: made.verificationNumber,
          profileId,
        }),
      ).rejects.toMatchObject({ code: "join_request.not_found" });
      expect(await readJoinStatus(tx, venue.cfg, made.joinId, made.token)).toBe("not_approved");
    });
  });

  it("refuses a print_agent request — a device accept cannot turn an agent's ask into a device", async () => {
    const venue = await setupVenue(suite.admin);
    const profileId = await seedProfile(venue.cfg, "till");
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      const made = await createJoinRequest(tx, venue.cfg, {
        kind: "print_agent",
        label: "Kitchen box",
      });
      await expect(
        acceptDeviceJoinRequest(tx, venue.cfg, made.joinId, {
          choice: made.verificationNumber,
          profileId,
        }),
      ).rejects.toMatchObject({ code: "join_request.not_found" });
    });
  });

  it("refuses another tenant's request", async () => {
    const venueA = await setupVenue(suite.admin);
    const venueB = await setupVenue(suite.admin);
    const profileIdB = await seedProfile(venueB.cfg, "till");
    const madeA = await withTenant(suite.admin, venueA.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venueA.cfg, { kind: "device", label: "A's till" });
    });
    await withTenant(suite.admin, venueB.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await expect(
        acceptDeviceJoinRequest(tx, venueB.cfg, madeA.joinId, {
          choice: madeA.verificationNumber,
          profileId: profileIdB,
        }),
      ).rejects.toMatchObject({ code: "join_request.not_found" });
    });
  });
});

describe("denyJoinRequest", () => {
  it("deletes the request, and the joiner reads not_approved", async () => {
    const venue = await setupVenue(suite.admin);
    const made = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
    });
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await denyJoinRequest(tx, venue.cfg, made.joinId);
    });
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      expect(await readJoinStatus(tx, venue.cfg, made.joinId, made.token)).toBe("not_approved");
    });
  });

  it("throws join_request.not_found for an unknown id or another tenant's", async () => {
    const venueA = await setupVenue(suite.admin);
    const venueB = await setupVenue(suite.admin);
    const madeA = await withTenant(suite.admin, venueA.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venueA.cfg, { kind: "device", label: "A's till" });
    });
    await withTenant(suite.admin, venueA.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await expect(
        denyJoinRequest(tx, venueA.cfg, "00000000-0000-4000-8000-000000000000"),
      ).rejects.toMatchObject({ code: "join_request.not_found" });
    });
    await withTenant(suite.admin, venueB.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await expect(denyJoinRequest(tx, venueB.cfg, madeA.joinId)).rejects.toMatchObject({
        code: "join_request.not_found",
      });
    });
  });

  it("returns the kind it deleted, so the shared route can authorize against it", async () => {
    const venue = await setupVenue(suite.admin);
    const madeDevice = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, { kind: "device", label: "d" });
    });
    const madeAgent = await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return createJoinRequest(tx, venue.cfg, { kind: "print_agent", label: "a" });
    });
    await withTenant(suite.admin, venue.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      expect(await denyJoinRequest(tx, venue.cfg, madeDevice.joinId)).toBe("device");
      expect(await denyJoinRequest(tx, venue.cfg, madeAgent.joinId)).toBe("print_agent");
    });
  });
});
