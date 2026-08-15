import { and, eq, gte, lt, sql } from "drizzle-orm";
import { isUniqueViolation, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { appendToChain } from "./chain.js";
import { timeEntries } from "./schema/time-entries.js";
import {
  dailyContractedTargetMinutes,
  projectWorkSessions,
  summarisePeriod,
  type OvertimeModel,
  type Period,
  type PeriodSummary,
  type TimeEntryRecord,
  type WorkforceEntryKind,
} from "./projection.js";
import { validateRoster, type PlannedShift, type RosterBreach } from "./roster-validation.js";
import type { WorkTimeRuleset } from "./ruleset.js";
// Side-effect: registers this package's attendance.*/employment.* codes so `new AppError(...)`
// below type-checks against the shared registry (packages/shared reachability rule).
import "./errors.js";

/** One clock event's inputs. `at`/`offsetMinutes` are the trusted event timestamp and its wall
 * offset, supplied by the caller (as `recordSale` is handed `issuedAt`), never read here. */
export interface ClockEventInput {
  tenantId: string;
  personId: string;
  locationId: string;
  at: string;
  offsetMinutes: number;
  /** The till that captured the event, if any. */
  tillId?: string | null;
  /** Who recorded it; defaults to the subject (self-service clock-in). */
  recordedByPersonId?: string;
}

export interface WorkSummaryQuery {
  tenantId: string;
  personId: string;
  /** The pay period, as a half-open local-date window `[start, end)`. */
  period: Period;
}

/**
 * The convenio-driven inputs `workSummary` reads — resolved from a `convenio_config` row by
 * `packages/workforce-es` and passed in (a full `WorkTimeRuleset` satisfies this subset). The single
 * source of their defaults is the `convenio_config` column defaults: a DEFAULT row resolves to
 * `working_days_per_week = 5` / `overtime_model = daily_accrual` / `daily_target_minutes = NULL`, and
 * that this reproduces today's numbers is pinned as a checked invariant by `packages/workforce-es`'s
 * `work-summary.test.ts` (a default row resolved through `resolveWorkTimeRuleset`), not asserted by a
 * comment the code does not enforce. `dailyTargetMinutes` is the one field with a code-side fallback
 * — a null column means "derive the per-day target from the weekly jornada ÷ `workingDaysPerWeek`"
 * rather than a duplicated numeric default.
 */
export interface WorkSummaryRuleset {
  /** Ordinary working days per week — the daily-target denominator when `dailyTargetMinutes` is null
   * (`convenio_config.working_days_per_week`). */
  workingDaysPerWeek: number;
  /** Which overtime reading is the headline (`convenio_config.overtime_model`). Changing it moves
   * only the headline, never the two underlying figures. */
  overtimeModel: OvertimeModel;
  /** An explicit per-day target (`convenio_config.daily_target_minutes`). When non-null it IS the
   * daily-accrual target and the weekly ÷ `workingDaysPerWeek` derivation is bypassed; null falls
   * back to that derivation. A DEFAULT convenio_config row leaves it null, so the derivation — and
   * today's numbers — are unchanged. */
  dailyTargetMinutes: number | null;
}

/** A request to correct an entry's timestamp — an append, never an edit of the target. */
export interface CorrectionRequestInput {
  tenantId: string;
  /** The entry whose timestamp is wrong (a base clock event, or an earlier correction). */
  correctsEntryId: string;
  /** The corrected event instant and its wall offset — what the entry SHOULD have been. */
  at: string;
  offsetMinutes: number;
  /** Why the correction is needed (art. 34.9's attributable, contestable requirement). */
  reason: string;
  /** Who is asking — the worker contesting, or a supervisor. Recorded as the correction actor. */
  actorPersonId: string;
  /** The till the request came from, if any. */
  tillId?: string | null;
}

/** A supervisor's approval of a requested correction — the second append that gives it effect. */
export interface CorrectionApprovalInput {
  tenantId: string;
  /** The `requested` correction to approve. */
  correctionId: string;
  /** Who is approving — must hold a supervisor/manager/admin role. */
  approverPersonId: string;
}

/** A request to publish a draft roster version — flip it to `published`, stamp it, and attach its
 * planned shifts. Publishing is a plain mutation over PLANNING data, not an append to the immutable
 * record (design §2.1): `roster_versions`/`shifts` take UPDATE, unlike `time_entries`. */
export interface PublishRosterInput {
  tenantId: string;
  /** The `roster_versions` row to publish. Must be a `draft`, or `roster.already_published`. */
  versionId: string;
  /** Who published it — recorded on the version; null when the caller does not attribute it. */
  publishedByPersonId?: string | null;
  /** The resolved work-time ruleset the roster is checked against (D2.3). Supplied by the caller —
   * `packages/workforce-es` resolves a `convenio_config` row into it (the Spain→generic boundary,
   * plan §3.3); the generic `publishRoster` never touches `convenio_config`. When present, the
   * published shifts are validated and any breaches are RETURNED (advisory — publish proceeds
   * regardless, OWNER DECISION 2026-08-02). When omitted, guardrails are not evaluated and the
   * return is empty. */
  ruleset?: WorkTimeRuleset;
}

/** A request to open a DRAFT roster version for one location's week (design §3a). */
export interface CreateRosterVersionInput {
  tenantId: string;
  locationId: string;
  /** The Monday (YYYY-MM-DD) of the week to author — period_start; period_end is derived as +6 days. */
  period: string;
}

/** One `roster_versions` row, mapped to the camelCase shape the API/screen read (dates as
 * 'YYYY-MM-DD' strings, `published_at` as a UTC ISO instant). */
export interface RosterVersionRow {
  id: string;
  locationId: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "published" | "superseded";
  publishedAt: string | null;
  publishedByPersonId: string | null;
}

/** One `shifts` row, mapped to camelCase with UTC ISO instants for the grid. */
export interface ShiftRow {
  id: string;
  personId: string;
  locationId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  role: string | null;
  rosterVersionId: string | null;
}

/** The week's roster snapshot for the authoring grid — the current draft (or, if none, the published
 * version) and its attached shifts, or `{ version: null, shifts: [] }` for an unrostered week. */
export interface RosterSnapshot {
  version: RosterVersionRow | null;
  shifts: ShiftRow[];
}

/** A request to add one planned shift to a DRAFT roster version (design §3a). */
export interface AddShiftInput {
  tenantId: string;
  versionId: string;
  personId: string;
  /** The centro de trabajo — should match the version's location (the screen uses the roster's). */
  locationId: string;
  startsAt: string;
  startsOffsetMinutes: number;
  endsAt: string;
  endsOffsetMinutes: number;
  role: string | null;
}

/** The three states a worker's shift can be in, derived from the most recent clock event. */
type ShiftState = "out" | "working" | "on_break";

/** The clock kinds that drive live shift state — every kind except `correction`, which never does. */
type LiveEntryKind = Exclude<WorkforceEntryKind, "correction">;

/** The roles permitted to APPROVE a correction (design §5, supervisor-gated). */
const SUPERVISOR_ROLES = new Set(["supervisor", "manager", "admin"]);

const MS_PER_DAY = 86_400_000;

/** The state each live entry kind LEAVES the worker in. */
const STATE_AFTER: Record<LiveEntryKind, ShiftState> = {
  in: "working",
  break_end: "working",
  break_start: "on_break",
  out: "out",
};

/**
 * The clock-in/out/break write path over the immutable `time_entries` stream — the seam a till
 * calls (design §6). Stateless in Slice 2: the trusted timestamp arrives on the input, and the
 * hash-chain dependencies that will give this a constructor are Slice 4.
 *
 * Every method reads the worker's current shift state and refuses an illegal transition
 * (`attendance.*`) BEFORE appending — the state machine is `out →in→ working →break_start→ on_break
 * →break_end→ working →out→ out`, which keeps the live stream well-formed for the projection.
 */
export class WorkforceBackend {
  /** out → working. */
  async clockIn(tx: Transaction, input: ClockEventInput): Promise<void> {
    await this.lockPerson(tx, input.tenantId, input.personId);
    const state = await this.currentState(tx, input.tenantId, input.personId);
    if (state !== "out") throw this.alreadyOpen(input);
    await this.append(tx, input, "in");
  }

  /** working → out. */
  async clockOut(tx: Transaction, input: ClockEventInput): Promise<void> {
    await this.lockPerson(tx, input.tenantId, input.personId);
    const state = await this.currentState(tx, input.tenantId, input.personId);
    if (state !== "working") throw this.noOpenEntry(input);
    await this.append(tx, input, "out");
  }

  /** working → on_break. */
  async breakStart(tx: Transaction, input: ClockEventInput): Promise<void> {
    await this.lockPerson(tx, input.tenantId, input.personId);
    const state = await this.currentState(tx, input.tenantId, input.personId);
    if (state === "on_break") throw this.alreadyOpen(input);
    if (state !== "working") throw this.noOpenEntry(input);
    await this.append(tx, input, "break_start");
  }

  /** on_break → working. */
  async breakEnd(tx: Transaction, input: ClockEventInput): Promise<void> {
    await this.lockPerson(tx, input.tenantId, input.personId);
    const state = await this.currentState(tx, input.tenantId, input.personId);
    if (state !== "on_break") throw this.noOpenEntry(input);
    await this.append(tx, input, "break_end");
  }

  /**
   * Worked minutes and overtime for a person over a pay period, computed from the `time_entries`
   * stream against the employment's contracted week. Returns BOTH overtime models (daily-accrual and
   * period-net) side by side plus the per-day breakdown, and selects the headline model from the
   * supplied `ruleset.overtimeModel` (convenio_config-sourced) — which model BINDS for a given
   * employment is still a convenio/asesor-laboral decision, carried on that row, not hard-coded here
   * (see `summarisePeriod`). The period-net baseline scales the weekly jornada to the period length.
   * The daily-accrual target is `ruleset.dailyTargetMinutes` when the convenio sets one, else the
   * weekly jornada ÷ `ruleset.workingDaysPerWeek` derivation (`dailyContractedTargetMinutes`); a
   * DEFAULT convenio_config row leaves `dailyTargetMinutes` null, so today's per-day figure stands.
   */
  async workSummary(
    tx: Transaction,
    query: WorkSummaryQuery,
    ruleset: WorkSummaryRuleset,
  ): Promise<PeriodSummary> {
    const { workingDaysPerWeek, overtimeModel, dailyTargetMinutes } = ruleset;
    const contractedPerWeek = await this.contractedMinutesPerWeek(
      tx,
      query.tenantId,
      query.personId,
    );
    const entries = await this.entriesInPeriod(tx, query);
    const sessions = projectWorkSessions(entries);
    const periodDays = (Date.parse(query.period.end) - Date.parse(query.period.start)) / MS_PER_DAY;
    return summarisePeriod(
      sessions,
      query.period,
      {
        periodMinutes: Math.round((contractedPerWeek * periodDays) / 7),
        // An explicit convenio per-day target wins; a null column falls back to the weekly derivation
        // (`??` treats only null/undefined as "unset", so a 0 override — a CHECK would reject it — is
        // still honoured rather than silently re-derived).
        dailyTargetMinutes:
          dailyTargetMinutes ?? dailyContractedTargetMinutes(contractedPerWeek, workingDaysPerWeek),
      },
      overtimeModel,
    );
  }

  /**
   * Records a REQUEST to correct an entry's timestamp (art. 34.9's right to see and contest).
   *
   * An append of a `correction` row pointing at `correctsEntryId`, status `requested` — it has NO
   * effect on the projection until a supervisor approves it (`approveCorrection`). The row copies its
   * person and location from the entry it corrects, so a correction is always attributed to the same
   * worker and workplace as its target. Returns the new correction's id, which `approveCorrection`
   * names. Throws `correction.target_not_found` if the target does not exist under this tenant.
   */
  async requestCorrection(tx: Transaction, input: CorrectionRequestInput): Promise<string> {
    const target = await this.entryById(tx, input.tenantId, input.correctsEntryId);
    return this.appendCorrection(tx, {
      tenantId: input.tenantId,
      personId: target.personId,
      locationId: target.locationId,
      correctsEntryId: input.correctsEntryId,
      at: input.at,
      offsetMinutes: input.offsetMinutes,
      reason: input.reason,
      actorPersonId: input.actorPersonId,
      status: "requested",
      tillId: input.tillId ?? null,
    });
  }

  /**
   * Approves a requested correction so it takes effect — supervisor-gated (design §5).
   *
   * The immutability floor forbids UPDATE-ing the request's status, so approval is a SECOND append:
   * an `approved` correction targeting the SAME entry the request did, carrying the same corrected
   * value. The request row stays in history beside it. Only `approved` corrections are followed by
   * the projection, so the approval — targeting the original entry — is what the reprojection sees.
   *
   * Throws `correction.not_permitted` if the approver's role is not supervisor/manager/admin,
   * `correction.target_not_found` if no such correction row exists under this tenant, and
   * `correction.not_pending` if that correction's target already carries an approved correction —
   * a second approval of the same request, or an approval naming an already-`approved` row, both of
   * which would append a duplicate `approved` row (the request→approve-once invariant).
   */
  async approveCorrection(tx: Transaction, input: CorrectionApprovalInput): Promise<string> {
    const role = await this.roleOf(tx, input.tenantId, input.approverPersonId);
    if (role === undefined || !SUPERVISOR_ROLES.has(role)) {
      throw new AppError("correction.not_permitted", {
        tenantId: input.tenantId,
        personId: input.approverPersonId,
      });
    }
    const request = await this.correctionById(tx, input.tenantId, input.correctionId);
    // Refuse a second approval BEFORE appending (the immutability floor forbids mutating the request
    // row, so its status stays `requested` and cannot itself signal "already approved"; the signal is
    // an existing approved correction against the SAME target). This is a guard on the append, not a
    // mutation — the request and any prior approval stay in history untouched (design §5).
    if (await this.hasApprovedCorrection(tx, input.tenantId, request.correctsEntryId)) {
      throw new AppError("correction.not_pending", {
        tenantId: input.tenantId,
        correctionId: input.correctionId,
      });
    }
    return this.appendCorrection(tx, {
      tenantId: input.tenantId,
      personId: request.personId,
      locationId: request.locationId,
      // The ORIGINAL entry, not the request row: the projection walks approved corrections from base
      // events, so an approval that pointed at the (unapproved) request would be orphaned and never
      // applied.
      correctsEntryId: request.correctsEntryId,
      at: request.eventAt,
      offsetMinutes: request.offsetMinutes,
      reason: request.reason,
      actorPersonId: input.approverPersonId,
      status: "approved",
      tillId: null,
    });
  }

  /**
   * Serialises every clock operation for ONE person by taking a row lock on that person's `persons`
   * row, held to the end of the caller's transaction. Each of the four clock methods calls this
   * BEFORE reading `currentState`, which makes the read-state-then-append sequence atomic per person:
   * a second concurrent operation for the same person BLOCKS here until the first commits, then reads
   * the UPDATED state and is correctly refused by the state-machine guard (`attendance.already_open` /
   * `attendance.no_open_entry`). Without it (proven by deletion in clocking.concurrency.test.ts) two
   * same-person operations both observe the same state and both append — a double-`in` the projection
   * then undercounts (projection.ts:287 `case "in": open = { start: e }`), corrupting a LEGAL
   * working-time record.
   *
   * `SELECT … FOR NO KEY UPDATE` on the actual person row, NOT `pg_advisory_xact_lock`: it is
   * collision-free (no key hashing), self-documenting, and RLS-respecting — the app role holds UPDATE
   * on `persons` (@waitron/identity's drizzle/0001_identity_rls.sql; that package's persons.rls.test.ts
   * pins that grant), which is the
   * privilege the `FOR …` row-lock clauses require, so it is permitted for the non-superuser
   * deployment role (exercised as that role in clocking.concurrency.test.ts). A person id that does
   * not exist locks nothing, which is harmless: `currentState` then reports `out` exactly as before
   * this lock existed, and `time_entries`' foreign key remains the backstop.
   *
   * WHY `FOR NO KEY UPDATE` AND NOT `FOR UPDATE` — the lock modes are NOT interchangeable here, and
   * `FOR UPDATE` reintroduces a deadlock this exact clause was added to avoid. The lock ORDER is not
   * uniform across the write paths: this clock path takes the `persons` lock BEFORE `appendToChain`'s
   * per-location `workforce_chains` head lock, but the CORRECTION paths (`requestCorrection` /
   * `approveCorrection` → `appendCorrection` → `appendToChain`) do NOT call this — they lock the chain
   * head FIRST and then, on the `time_entries` INSERT, implicitly take `FOR KEY SHARE` on the
   * referenced `persons` rows via the FKs (`time_entries_person_fk`, `_recorded_by_person_fk`,
   * `_correction_actor_fk`) — the OPPOSITE order (chain → persons). Per PostgreSQL's row-lock conflict
   * matrix, `FOR UPDATE` conflicts with `FOR KEY SHARE`, so a same-person clock-in racing a correction
   * of that person at the same location is an ABBA cycle → `deadlock detected` (40P01), which
   * `appendToChain` does not retry (it retries only 23505). Reproduced deterministically on
   * postgres:18 (clocking.concurrency.test.ts's clock-vs-correction case, RED under `FOR UPDATE`).
   * `FOR NO KEY UPDATE` does NOT conflict with `FOR KEY SHARE`, so the clock path's `persons` lock and
   * the correction INSERT's FK lock never block each other → no ABBA; and it DOES self-conflict, so
   * two same-person clock-ins still serialise and the read→append TOCTOU stays closed (the
   * clock-vs-clock case). `pg_advisory_xact_lock` would also dodge the ABBA (it is disjoint from the
   * FK locks), but at the cost of a hashed key space and a lock nobody reading the row can see.
   */
  private async lockPerson(tx: Transaction, tenantId: string, personId: string): Promise<void> {
    await tx.execute(sql`
      select id from persons where tenant_id = ${tenantId} and id = ${personId} for no key update`);
  }

  /**
   * Opens a DRAFT roster version for one location's week (design §3a) — planning data (mutable),
   * inserted with status 'draft' and a null publish stamp. `period_end` is derived in SQL as the
   * inclusive Sunday (`+ 6` days), so no date value round-trips through TypeScript. Throws
   * `roster.draft_exists` when a draft for this (tenant, location, week) already exists — the
   * published-uniqueness index does not cover drafts, so this check-then-insert is the guard.
   * Slice-1 single-author screen: a concurrent double-create could still fork two drafts (no draft
   * unique index — that would be a migration); acceptable and documented here.
   */
  async createRosterVersion(tx: Transaction, input: CreateRosterVersionInput): Promise<string> {
    const existing = await tx.execute<{ id: string }>(sql`
      select id from roster_versions
      where tenant_id = ${input.tenantId} and location_id = ${input.locationId}
        and period_start = ${input.period} and status = 'draft'
      limit 1`);
    if (existing.rows.length > 0) {
      throw new AppError("roster.draft_exists", {
        tenantId: input.tenantId,
        locationId: input.locationId,
      });
    }
    const { rows } = await tx.execute<{ id: string }>(sql`
      insert into roster_versions (tenant_id, location_id, period_start, period_end)
      values (${input.tenantId}, ${input.locationId}, ${input.period}, ${input.period}::date + 6)
      returning id`);
    return rows[0]!.id;
  }

  /**
   * Reads the roster snapshot for one location's week (design §3a) — the current DRAFT (what is being
   * edited) or, when there is none, the current PUBLISHED version, plus its attached shifts. Returns
   * `{ version: null, shifts: [] }` for a week with no roster.
   */
  async getRoster(
    tx: Transaction,
    input: { tenantId: string; locationId: string; period: string },
  ): Promise<RosterSnapshot> {
    // Prefer the DRAFT (what is being edited); fall back to the current PUBLISHED version for the week.
    // `period_start/end::text`: node-postgres parses a `date` column into a JS Date, PGlite into a
    // string — the same driver divergence `attachedShifts` handles with `to_char`. The `::text` cast
    // pins both to a 'YYYY-MM-DD' string, so the row (and its JSON to the browser) is stable.
    const { rows } = await tx.execute<RosterVersionDbRow>(sql`
      select id, location_id, period_start::text as period_start, period_end::text as period_end, status,
        to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as published_at,
        published_by_person_id
      from roster_versions
      where tenant_id = ${input.tenantId} and location_id = ${input.locationId}
        and period_start = ${input.period} and status in ('draft', 'published')
      order by case when status = 'draft' then 0 else 1 end
      limit 1`);
    const row = rows[0];
    if (row === undefined) return { version: null, shifts: [] };
    const version = mapRosterVersion(row);
    return { version, shifts: await this.shiftsForVersion(tx, input.tenantId, version.id) };
  }

  /**
   * Reads one `roster_versions` row by id, or throws `roster.not_found`. The publish route reads a
   * version's `locationId` off this before resolving its convenio ruleset.
   */
  async getRosterVersion(
    tx: Transaction,
    input: { tenantId: string; versionId: string },
  ): Promise<RosterVersionRow> {
    const { rows } = await tx.execute<RosterVersionDbRow>(sql`
      select id, location_id, period_start::text as period_start, period_end::text as period_end, status,
        to_char(published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as published_at,
        published_by_person_id
      from roster_versions
      where tenant_id = ${input.tenantId} and id = ${input.versionId}
      limit 1`);
    const row = rows[0];
    if (row === undefined) {
      throw new AppError("roster.not_found", {
        tenantId: input.tenantId,
        rosterVersionId: input.versionId,
      });
    }
    return mapRosterVersion(row);
  }

  /** The shifts attached to a version, mapped to `ShiftRow`s ordered by start instant. */
  private async shiftsForVersion(
    tx: Transaction,
    tenantId: string,
    versionId: string,
  ): Promise<ShiftRow[]> {
    const { rows } = await tx.execute<ShiftDbRow>(sql`
      select id, person_id, location_id,
        to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as starts_at,
        starts_offset_minutes,
        to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as ends_at,
        ends_offset_minutes, role, roster_version_id
      from shifts
      where tenant_id = ${tenantId} and roster_version_id = ${versionId}
      order by starts_at`);
    return rows.map(mapShift);
  }

  /**
   * Adds a planned shift to a DRAFT roster version (design §3a), attaching it directly
   * (`roster_version_id = versionId`). Refuses a malformed interval up front (`shift.invalid`, not the
   * `shifts_interval_ck` 500), a missing version (`roster.not_found`, via `rosterVersionStatus`) and a
   * non-draft version (`roster.not_draft`). Planning data — a plain INSERT, no chain.
   */
  async addShift(tx: Transaction, input: AddShiftInput): Promise<string> {
    if (Date.parse(input.startsAt) >= Date.parse(input.endsAt)) {
      throw new AppError("shift.invalid", { tenantId: input.tenantId, reason: "ends_not_after_starts" });
    }
    const status = await this.rosterVersionStatus(tx, input.tenantId, input.versionId); // throws roster.not_found
    if (status !== "draft") {
      throw new AppError("roster.not_draft", {
        tenantId: input.tenantId,
        rosterVersionId: input.versionId,
      });
    }
    const { rows } = await tx.execute<{ id: string }>(sql`
      insert into shifts (tenant_id, person_id, location_id, starts_at, starts_offset_minutes,
        ends_at, ends_offset_minutes, role, roster_version_id)
      values (${input.tenantId}, ${input.personId}, ${input.locationId},
        ${input.startsAt}, ${input.startsOffsetMinutes}, ${input.endsAt}, ${input.endsOffsetMinutes},
        ${input.role}, ${input.versionId})
      returning id`);
    return rows[0]!.id;
  }

  /**
   * Publishes a draft roster version (design §2.1) — the ONLY scheduling write that touches the
   * legal-vs-planning seam, and it lands squarely on the planning side. Unlike a clock event
   * (`append`, an immutable-ledger INSERT), this UPDATEs mutable planning rows:
   *
   * 1. supersedes any incumbent published version for the SAME (location, exact period), then flips
   *    THIS version `draft → published` and stamps `published_at` (and `published_by_person_id` when
   *    supplied) — the `roster_versions_publish_shape_ck` invariant pairs the two. The supersede runs
   *    FIRST so the incumbent is out of the `roster_versions_published_period_uq` partial index before
   *    this one enters it (§`supersedePriorPublished`);
   * 2. attaches every still-unattached (`roster_version_id is null`) draft shift AT THE VERSION'S
   *    LOCATION whose LOCAL wall date falls within the version's inclusive period, by setting its
   *    `roster_version_id`. The local date is `starts_at` shifted by its wall offset — the same
   *    offset semantics `time_entries` uses — so a shift whose UTC instant sits just outside the
   *    period still attaches when its local date is inside.
   *
   * Throws `roster.not_found` if no such version exists under the tenant, `roster.already_published`
   * if THIS version is no longer a `draft` (a version is published exactly once — republishing it is
   * refused, never a silent re-stamp), and `roster.period_already_published` if a DIFFERENT version
   * won a concurrent race to publish the same period (the unique-index backstop firing — see
   * `supersedePriorPublished`).
   *
   * Returns the guardrail breaches of the published roster (D2.3) when `input.ruleset` is supplied,
   * an empty array otherwise. Breaches are ADVISORY (OWNER DECISION 2026-08-02): a breaching roster
   * still publishes and the breaches are surfaced here, never thrown — see `validateRoster`.
   */
  async publishRoster(tx: Transaction, input: PublishRosterInput): Promise<RosterBreach[]> {
    const status = await this.rosterVersionStatus(tx, input.tenantId, input.versionId);
    if (status !== "draft") {
      throw new AppError("roster.already_published", {
        tenantId: input.tenantId,
        rosterVersionId: input.versionId,
      });
    }
    await this.supersedePriorPublished(tx, input.tenantId, input.versionId);
    try {
      await tx.execute(sql`
        update roster_versions
        set status = 'published', published_at = now(),
            published_by_person_id = ${input.publishedByPersonId ?? null}
        where tenant_id = ${input.tenantId} and id = ${input.versionId}`);
    } catch (error) {
      // The partial-index backstop firing: a concurrent publish of a DIFFERENT draft for this same
      // (location, period) committed after `supersedePriorPublished` took its lock snapshot, so its
      // published row was invisible to the supersede yet collides here (23505). A translation, not a
      // recovery — Postgres has already aborted the transaction; catching only hands the caller a
      // structured code instead of a raw driver string.
      if (isUniqueViolation(error)) {
        throw new AppError("roster.period_already_published", {
          tenantId: input.tenantId,
          rosterVersionId: input.versionId,
        });
      }
      throw error;
    }
    // UPDATE ... FROM reads location_id/period_start/period_end straight off the version row, so no
    // date value round-trips through TypeScript. `starts_offset_minutes * interval '1 minute'` turns
    // the wall offset into the shift of the absolute instant onto local wall time before ::date.
    await tx.execute(sql`
      update shifts s
      set roster_version_id = rv.id
      from roster_versions rv
      where rv.id = ${input.versionId} and rv.tenant_id = ${input.tenantId}
        and s.tenant_id = ${input.tenantId}
        and s.location_id = rv.location_id
        and s.roster_version_id is null
        and (s.starts_at at time zone 'UTC' + s.starts_offset_minutes * interval '1 minute')::date
            between rv.period_start and rv.period_end`);
    // Advisory guardrails: only when the caller supplied a ruleset (the workforce-es resolver's
    // output). Validate exactly the shifts now attached to this version, then return the breaches —
    // publishing has already committed above, so a breach never blocks it.
    if (input.ruleset === undefined) return [];
    return validateRoster(
      await this.attachedShifts(tx, input.tenantId, input.versionId),
      input.ruleset,
    );
  }

  /** The shifts attached to a published version, as neutral `PlannedShift`s for `validateRoster`.
   * `event_at` is normalised to a UTC ISO instant so the pure engine's `Date.parse` sees a string
   * under either driver (node-postgres returns a Date, PGlite a string). */
  private async attachedShifts(
    tx: Transaction,
    tenantId: string,
    versionId: string,
  ): Promise<PlannedShift[]> {
    const { rows } = await tx.execute<{
      id: string;
      person_id: string;
      starts_at: string;
      starts_offset_minutes: number;
      ends_at: string;
      ends_offset_minutes: number;
    }>(sql`
      select id, person_id,
        to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as starts_at,
        starts_offset_minutes,
        to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as ends_at,
        ends_offset_minutes
      from shifts
      where tenant_id = ${tenantId} and roster_version_id = ${versionId}`);
    return rows.map((r) => ({
      shiftId: r.id,
      personId: r.person_id,
      startsAt: r.starts_at,
      startsOffsetMinutes: r.starts_offset_minutes,
      endsAt: r.ends_at,
      endsOffsetMinutes: r.ends_offset_minutes,
    }));
  }

  /** A roster version's `status`, or `roster.not_found` if there is no such version under the
   * tenant. `publishRoster` reads the publish guard off this. The row is locked `for update`, so the
   * check-then-publish is race-free: a second concurrent publish blocks on this SELECT until the
   * first commits, then reads `published` and is refused. Without the lock both could observe `draft`
   * and the later would silently re-stamp `published_at`/`published_by_person_id` (the guard is a
   * separate statement from the UPDATE, so a bare read cannot serialise them). The lock rides the
   * caller's transaction, which `publishRoster` always supplies. */
  private async rosterVersionStatus(
    tx: Transaction,
    tenantId: string,
    versionId: string,
  ): Promise<string> {
    const { rows } = await tx.execute<{ status: string }>(sql`
      select status from roster_versions
      where tenant_id = ${tenantId} and id = ${versionId}
      limit 1
      for update`);
    const version = rows[0];
    if (version === undefined) {
      throw new AppError("roster.not_found", { tenantId, rosterVersionId: versionId });
    }
    return version.status;
  }

  /**
   * Demotes any incumbent `published` version for the SAME (location, exact period) as the version
   * about to be published, so at most one published version survives per period (design §2.1, the
   * mutable + supersede model — OWNER DECISION).
   *
   * Locks the incumbent published rows `for update` FIRST (`for update of prior`, so only the
   * incumbents — not this version's own already-locked row — are locked): this serialises concurrent
   * publishes of the same period against a common row, so the second blocks until the first commits
   * rather than racing it. It is NOT, however, what guarantees the invariant — a concurrent
   * FIRST publish of two different drafts for a period with no incumbent has no row to lock, and even
   * with an incumbent the loser's READ COMMITTED snapshot cannot see the winner's freshly-published
   * row (it was demoted, not the one this saw). The `roster_versions_published_period_uq` partial
   * unique index is the actual guarantee: it raises 23505 whenever a publish would leave a second
   * published row, which `publishRoster` translates to `roster.period_already_published`. This lock
   * makes the common (sequential, lightly-contended) supersede orderly and cuts index-abort churn;
   * the index makes it CORRECT. Verified against real Postgres in scheduling.concurrency.test.ts.
   *
   * The self-join reads the target's location/period straight off its row (no value round-trips
   * through TypeScript), the same pattern the shift-attach UPDATE in `publishRoster` uses. `prior.id
   * <> versionId` is belt-and-suspenders: the version being published is still `draft` here, so it
   * cannot match `status = 'published'` anyway.
   */
  private async supersedePriorPublished(
    tx: Transaction,
    tenantId: string,
    versionId: string,
  ): Promise<void> {
    const { rows } = await tx.execute<{ id: string }>(sql`
      select prior.id
      from roster_versions prior
      join roster_versions target on target.id = ${versionId} and target.tenant_id = ${tenantId}
      where prior.tenant_id = ${tenantId}
        and prior.location_id = target.location_id
        and prior.period_start = target.period_start
        and prior.period_end = target.period_end
        and prior.status = 'published'
        and prior.id <> ${versionId}
      for update of prior`);
    if (rows.length === 0) return;
    await tx.execute(sql`
      update roster_versions prior
      set status = 'superseded'
      from roster_versions target
      where target.id = ${versionId} and target.tenant_id = ${tenantId}
        and prior.tenant_id = ${tenantId}
        and prior.location_id = target.location_id
        and prior.period_start = target.period_start
        and prior.period_end = target.period_end
        and prior.status = 'published'
        and prior.id <> ${versionId}`);
  }

  /** The state the worker's most recent event left them in — `out` when they have no events yet.
   * Corrections are excluded: a correction of a past shift is not a live clock event and must not
   * drive today's open/closed state (and `correction` has no `STATE_AFTER` entry). */
  private async currentState(
    tx: Transaction,
    tenantId: string,
    personId: string,
  ): Promise<ShiftState> {
    const { rows } = await tx.execute<{ entry_kind: LiveEntryKind }>(sql`
      select entry_kind from time_entries
      where tenant_id = ${tenantId} and person_id = ${personId} and entry_kind <> 'correction'
      order by event_at desc, ingest_seq desc
      limit 1`);
    const last = rows[0];
    return last === undefined ? "out" : STATE_AFTER[last.entry_kind];
  }

  private async append(
    tx: Transaction,
    input: ClockEventInput,
    entryKind: WorkforceEntryKind,
  ): Promise<void> {
    // Every clock event is appended to its location's tamper-evidence chain (Slice 4) under a row
    // lock on the chain head — the single-writer path (design §5). The hash and chain position are
    // computed there, never supplied here.
    await appendToChain(tx, input.tenantId, input.locationId, {
      personId: input.personId,
      entryKind,
      eventAt: input.at,
      eventOffsetMinutes: input.offsetMinutes,
      recordedByPersonId: input.recordedByPersonId ?? input.personId,
      capturedByTillId: input.tillId ?? null,
    });
  }

  /** The person and location of an entry, or `correction.target_not_found` if it does not exist. */
  private async entryById(
    tx: Transaction,
    tenantId: string,
    entryId: string,
  ): Promise<{ personId: string; locationId: string }> {
    const { rows } = await tx.execute<{ person_id: string; location_id: string }>(sql`
      select person_id, location_id from time_entries
      where tenant_id = ${tenantId} and id = ${entryId}
      limit 1`);
    const entry = rows[0];
    if (entry === undefined) {
      throw new AppError("correction.target_not_found", { tenantId, entryId });
    }
    return { personId: entry.person_id, locationId: entry.location_id };
  }

  /** A correction row's fields (whatever its `correction_status`), or `correction.target_not_found`
   * if there is no such `correction` row — `approveCorrection` reads the status guard off the target,
   * so it must be handed an already-`approved` row rather than told it does not exist. */
  private async correctionById(
    tx: Transaction,
    tenantId: string,
    correctionId: string,
  ): Promise<{
    personId: string;
    locationId: string;
    correctsEntryId: string;
    eventAt: string;
    offsetMinutes: number;
    reason: string;
  }> {
    const { rows } = await tx.execute<{
      person_id: string;
      location_id: string;
      corrects_entry_id: string;
      event_at: string;
      event_offset_minutes: number;
      correction_reason: string;
    }>(sql`
      select person_id, location_id, corrects_entry_id,
        to_char(event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as event_at,
        event_offset_minutes, correction_reason
      from time_entries
      where tenant_id = ${tenantId} and id = ${correctionId} and entry_kind = 'correction'
      limit 1`);
    const row = rows[0];
    if (row === undefined) {
      throw new AppError("correction.target_not_found", { tenantId, entryId: correctionId });
    }
    return {
      personId: row.person_id,
      locationId: row.location_id,
      correctsEntryId: row.corrects_entry_id,
      eventAt: row.event_at,
      offsetMinutes: row.event_offset_minutes,
      reason: row.correction_reason,
    };
  }

  /** Whether an `approved` correction already targets `targetEntryId` under this tenant — the signal
   * that a request has already been approved (approval targets the ORIGINAL entry, not the request
   * row). One approved correction per target is the invariant `approveCorrection` enforces; a further
   * correction of an already-corrected value chains off the approval instead (a distinct target). */
  private async hasApprovedCorrection(
    tx: Transaction,
    tenantId: string,
    targetEntryId: string,
  ): Promise<boolean> {
    const { rows } = await tx.execute<{ one: number }>(sql`
      select 1 as one from time_entries
      where tenant_id = ${tenantId} and corrects_entry_id = ${targetEntryId}
        and entry_kind = 'correction' and correction_status = 'approved'
      limit 1`);
    return rows.length > 0;
  }

  /** A person's `role`, or `undefined` when no such person exists under the tenant. */
  private async roleOf(
    tx: Transaction,
    tenantId: string,
    personId: string,
  ): Promise<string | undefined> {
    const { rows } = await tx.execute<{ role: string }>(sql`
      select role from persons where tenant_id = ${tenantId} and id = ${personId} limit 1`);
    return rows[0]?.role;
  }

  /** Appends one `correction` row. Shared by request and approve — the only difference is `status`
   * and the actor. */
  private async appendCorrection(
    tx: Transaction,
    params: {
      tenantId: string;
      personId: string;
      locationId: string;
      correctsEntryId: string;
      at: string;
      offsetMinutes: number;
      reason: string;
      actorPersonId: string;
      status: "requested" | "approved";
      tillId: string | null;
    },
  ): Promise<string> {
    // A correction is an append like any other — it rides the SAME location chain as the clock
    // events it supersedes, so it cannot dodge the tamper-evidence (design §5). The chain hash
    // commits the correction's OWN content too — its reason, its accountable actor and any capturing
    // till (chain-hash.ts's `canonicalString`) — so a party past the immutability floor (the REVOKE +
    // reject_mutation trigger) that rewrites the reason or the actor breaks `verifyChain`, not just
    // one that reorders or deletes rows. The actor is written to BOTH `recorded_by_person_id` (the
    // operator) and `correction_actor_id` (the accountable actor), and both are hashed, so the actor
    // no longer rides only on the coincidence that the two are the same person here.
    const { id } = await appendToChain(tx, params.tenantId, params.locationId, {
      personId: params.personId,
      entryKind: "correction",
      eventAt: params.at,
      eventOffsetMinutes: params.offsetMinutes,
      recordedByPersonId: params.actorPersonId,
      capturedByTillId: params.tillId,
      correctsEntryId: params.correctsEntryId,
      correctionReason: params.reason,
      correctionStatus: params.status,
      correctionActorId: params.actorPersonId,
    });
    return id;
  }

  private async contractedMinutesPerWeek(
    tx: Transaction,
    tenantId: string,
    personId: string,
  ): Promise<number> {
    const { rows } = await tx.execute<{ contracted: number }>(sql`
      select contracted_minutes_per_week as contracted from employments
      where tenant_id = ${tenantId} and person_id = ${personId}
      order by start_date desc
      limit 1`);
    const employment = rows[0];
    if (employment === undefined) {
      throw new AppError("employment.not_found", { tenantId, personId });
    }
    return employment.contracted;
  }

  private async entriesInPeriod(
    tx: Transaction,
    query: WorkSummaryQuery,
  ): Promise<TimeEntryRecord[]> {
    // Widen the query window by a day on each side so a session whose LOCAL date falls in the period
    // is fetched even when its UTC instant sits just outside it (max wall offset ±14h < 1 day); the
    // precise local-date filter is `summarisePeriod`'s. `event_at` is read through the timestamptz
    // column's mode:"string", normalised to a UTC ISO instant so the projection's `Date.parse` sees
    // a string under either driver (node-postgres returns a Date, PGlite a string — registro-row.ts).
    const windowStart = shiftDay(query.period.start, -1);
    const windowEnd = shiftDay(query.period.end, 1);
    // Corrections are fetched alongside base events (no `entry_kind` filter) so `projectWorkSessions`
    // can fold them in. A correction's `event_at` is the CORRECTED clock time — near the original, so
    // the ±1-day window catches it; a correction whose value lands outside the window is out of scope
    // for the floor.
    const rows = await tx
      .select({
        entryId: timeEntries.id,
        personId: timeEntries.personId,
        locationId: timeEntries.locationId,
        entryKind: timeEntries.entryKind,
        eventAt: sql<string>`to_char(${timeEntries.eventAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
        offsetMinutes: timeEntries.eventOffsetMinutes,
        ingestSeq: timeEntries.ingestSeq,
        sequenceNo: timeEntries.sequenceNo,
        correctsEntryId: timeEntries.correctsEntryId,
        correctionStatus: timeEntries.correctionStatus,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.tenantId, query.tenantId),
          eq(timeEntries.personId, query.personId),
          gte(timeEntries.eventAt, windowStart),
          lt(timeEntries.eventAt, windowEnd),
        ),
      );
    return rows;
  }

  private alreadyOpen(input: ClockEventInput): AppError {
    return new AppError("attendance.already_open", {
      tenantId: input.tenantId,
      personId: input.personId,
    });
  }

  private noOpenEntry(input: ClockEventInput): AppError {
    return new AppError("attendance.no_open_entry", {
      tenantId: input.tenantId,
      personId: input.personId,
    });
  }
}

/** The UTC ISO instant `deltaDays` from a local date's midnight — bounds the fetch window. */
function shiftDay(date: string, deltaDays: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + deltaDays * MS_PER_DAY).toISOString();
}

/** The raw `roster_versions` shape `getRoster`/`getRosterVersion` read — snake_case, dates cast to
 * 'YYYY-MM-DD' text and `published_at` to a UTC ISO instant, so no driver divergence reaches the map. */
type RosterVersionDbRow = {
  id: string;
  location_id: string;
  period_start: string;
  period_end: string;
  status: string;
  published_at: string | null;
  published_by_person_id: string | null;
};

/** The raw `shifts` shape the read verbs return — instants normalised to UTC ISO by `to_char`. A
 * `type` object literal (not an `interface`) so it satisfies `tx.execute`'s `Record<string, unknown>`
 * constraint via TypeScript's implicit index signature, matching this file's inline row types. */
type ShiftDbRow = {
  id: string;
  person_id: string;
  location_id: string;
  starts_at: string;
  starts_offset_minutes: number;
  ends_at: string;
  ends_offset_minutes: number;
  role: string | null;
  roster_version_id: string | null;
};

function mapRosterVersion(r: RosterVersionDbRow): RosterVersionRow {
  return {
    id: r.id,
    locationId: r.location_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    status: r.status as RosterVersionRow["status"],
    publishedAt: r.published_at,
    publishedByPersonId: r.published_by_person_id,
  };
}

function mapShift(r: ShiftDbRow): ShiftRow {
  return {
    id: r.id,
    personId: r.person_id,
    locationId: r.location_id,
    startsAt: r.starts_at,
    startsOffsetMinutes: r.starts_offset_minutes,
    endsAt: r.ends_at,
    endsOffsetMinutes: r.ends_offset_minutes,
    role: r.role,
    rosterVersionId: r.roster_version_id,
  };
}
