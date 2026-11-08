# A1308 dv0: configuration import rewrites ids inside JSON lists — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Give the three areas that keep short id lists as JSON on their owner's row (README R4's
exception) the shared machinery that exception costs: a configuration export and import that
rewrite, prune and refuse ids inside declared JSON columns, one helper that removes a deleted
row's id from every JSON list naming it, one CHECK helper for the lists' shape, and a guard that
knows a JSON list column when it sees one.

**Spec:** [README](../specs/2026-11-02-rationalisation/README.md) §3 R4 ("configuration import must
rewrite these ids, which it does not do today"); [tables-devices.md](../specs/2026-11-02-rationalisation/tables-devices.md)
§1 "What moves from the database to code" and §7 "Configuration export and import need new code for
the JSON lists" (gaps 1 and 2, and the guard paragraph after them; gap 3 is not built, decision 4). Every slice follows
[the slice rules](2026-11-08-a1308-slice-rules.md), cited as "rules §n".

**Base:** any `main`. Line numbers were read at `a086eedfb7`. This pull request changes no table
and no starting migration, so it needs neither slice 1a nor a venue reset, and it can land before
batch 1 finishes. A cite whose code no longer says what this plan says is a stop (rules §5.1); a
cite that only moved is not.

**Owner lands:** no. It touches the configuration export and import, not `sales`, invoice
numbering, `registros_facturacion`, the fiscal identity, AEAT sending or a hashed value (rules §6).

**Pull request's first line:** none needed: no venue is reset (rules §2 applies only to a slice
that changes a starting migration).

**Who builds it, and when:** it must land before the first of its users starts: the devices
area's `dv6` (`device_profiles.order_zone_ids`), A1002's second cut (device admission role ids;
its plan, Task 3: "Transfer … policy IDs through normal mapping, including nested JSON IDs"),
floor and kitchen (`kitchen_stations.printer_ids`) and menu and photos (`menu_periods.staff_menu_ids`).
Floor and menu are lane 2 and A1002 is lane K, so build it in **whichever lane is free first, now**;
it waits on nothing.

## Decisions this plan makes

1. **Built against a synthetic table, not a real first user.** No transferred table holds a JSON
   list of row ids today: the only `_ids` columns in any starting migration are
   `deferred_shift_ids` and `entry_ids`, both in `workforce`, whose tables are not exported
   (`grep -n "_ids\`" packages/*/drizzle/0000_baseline.sql`). Waiting for a real user would put this
   code inside a slice that is already near its size cap, in another lane. The tests use the
   `zz_*` synthetic-table pattern `packages/provisioning/src/configuration-transfer.boundaries.test.ts`
   already uses (`moduleWith` at `:33`, `scratch` at `:40`, the import case at `:409-452`). Each
   later user adds its declaration and a case of its own.
2. **A path language of three words, not JSONPath.** A path is a list of steps; a step is a key
   name, or `"*"` for every key of an object or every element of an array. That covers every list
   the design names: `["*"]` for an array of ids; `["*", "ids", "*"]` and `["*", "defaultId"]` for
   `printer_lists`; `["*", "stationIds", "*"]` and `["*", "zoneIds", "*"]` for `kitchen_views`.
3. **Export prunes, import refuses.** Gap 2 offers "prune such ids from a list … or carry them
   forward"; carrying a dead id forward is what M4 names as a failure, so export prunes. On export,
   every id at a declared path that names **no exported row** is dropped: an array loses the
   element, an object field holding it becomes `null`. That covers both a row the export leaves
   behind and an id that names nothing. On import, an id at a declared path that names no row in
   the bundle is refused, `setup.request_invalid` with `field: "<table>.<column>"`, because a
   hand-edited or older bundle must never plant the exporting venue's id.
   **Nulls:** a whole column that is `null` (for example `order_zone_ids`, null = every zone) is
   skipped. A `null` met partway down a path (a view's `"stationIds": null`, meaning every station)
   ends that path: nothing below it is an id. A `null` at the last step (`"defaultId": null`) is
   "no id" and passes. Only a value that is present, not `null`, and not a string at an id step is
   refused (a number, an object, a list where an id should be); a step that names a key the value
   does not have is skipped. **A row an import keeps by a fixed key** (a fixed built-in a module
   preserves across import rather than renumbering) is not in the bundle's id map, so an id naming
   it is refused by this rule; a user with such rows (A1002's fixed built-in roles) must put their
   ids in the map itself, or this rule refuses them. Stated for A1002's plan, not solved here.
4. **Gap 3 is not built: it cannot happen** (coordinator's review, 2026-11-08). Gap 3 feared a live
   profile left behind because its department or starting zone is switched off. The product
   refuses every way there: deleting a department a live profile uses
   (`packages/venue-service/src/service-delete.ts:217-226`), scoping a profile to a switched-off
   department or zone (`packages/venue-service/src/profile-access.ts:358-361`); retired profiles
   are left behind on purpose (`leaveBehindWhenSet: "retired_at"`), and kitchen displays hold no
   scope. So no "clear these columns instead" declaration is added.
5. **The guard knows a JSON list column by its shape CHECK.** The design gives every R4 list a
   CHECK of `json_valid(x) and json_type(x) = …` (`tables-devices.md` §1 "What moves from the
   database to code"). The guard reads each transferred table's stored `CREATE TABLE` text and
   treats every column a `json_valid(…)` names as a column that may hold ids: it must be in
   `jsonReferences`, in `omit`, or in a new `JSON_WITHOUT_IDS` list with a reason. It also stops
   accepting an `_ids` column declared in `references`, the weakness its own header names
   (`scripts/id-columns-are-references.test.ts:24-25`). It stays weaker than its name: a JSON
   column with no `json_valid` CHECK is invisible to it.
6. **One clearing helper for every area.** R4's other cost: "the code must clear a deleted id".
   `removeIdFromJson` removes one id from every place it sits in one JSON column of every row, in
   the caller's transaction. The devices, floor and menu delete flows call it in place of today's
   `tx.delete(...)` of link rows.

## What it builds

- `JsonReference` and one new optional field on `ConfigurationTransferTable`
  (`packages/module/src/module.ts:1453-1469`): `jsonReferences`.
- In `exportConfigurationTables` (`packages/provisioning/src/configuration-transfer.ts:244`): pruning
  of declared JSON columns after the exported rows are chosen (`:306-321`).
- In `importConfigurationTables` (`:622`): rewriting and refusing ids at declared paths beside the
  whole-value rewrite at `:741-742`.
- `jsonShapeCheck` in `packages/db/src/schema/columns.ts` (beside `enumCheck`, `:128`).
- `withoutId` and `removeIdFromJson` in a new `packages/db/src/json-id-lists.ts`, exported from
  `@waitron/db`.
- `scripts/id-columns-are-references.test.ts` learning `jsonReferences`, `JSON_WITHOUT_IDS`, and the
  `_ids`-in-`references` refusal.
- CLAUDE.md §3's id-column rule extended by one clause; the receipt in
  `docs/developers/conventions-data.md`.

## What it leaves out

| Left out | Who takes it |
| --- | --- |
| Every real declaration (`order_zone_ids`, `printer_lists`, `kitchen_views`, admitted role ids, `kitchen_stations.printer_ids`, `menu_periods.staff_menu_ids`) and its M4-style round-trip case | The slice that creates the column: devices `dv6`–`dv8`, A1002 cut 2, floor and kitchen, menu and photos |
| Each table's JSON shape CHECK | The slice that creates the column, using `jsonShapeCheck` |
| Each delete flow switching to `removeIdFromJson` | The slice that folds that list |
| Validating that an imported id names a row **of the right table** | Not built: ids are random UUIDs across every table (`newId`, `packages/db/src/schema/columns.ts:178`), and the whole-value rewrite at `:741` does not check the table either. The writers check kinds on the next save |

## Files

**Modify**
- `packages/module/src/module.ts:1453-1469` — the type.
- `packages/provisioning/src/configuration-transfer.ts` — export (`:244-321`) and import (`:660-745`).
- `packages/db/src/schema/columns.ts` — `jsonShapeCheck`.
- `packages/db/src/index.ts` — export the new helpers.
- `scripts/id-columns-are-references.test.ts` — the guard.
- `CLAUDE.md` §3 (the "A column of a transferred table that holds another row's id" entry);
  `docs/developers/conventions-data.md` (its receipt section, found by that entry's link).

**Create**
- `packages/db/src/json-id-lists.ts`, `packages/db/src/json-id-lists.test.ts`.
- `packages/provisioning/src/configuration-transfer.json-lists.test.ts` (the synthetic-table cases;
  a new file so the 700-line boundaries suite does not grow).
- `packages/db/src/schema/columns.json-shape.test.ts`.

## Size

| Counted (hand-written) | Lines, estimated |
| --- | --- |
| Code: type 20, export prune 70, import rewrite 45, `jsonShapeCheck` 10, `json-id-lists.ts` 50, guard 45 | ~240 |
| Tests: transfer cases 210, helper cases 70, shape CHECK cases 30, guard cases 50 | ~360 |
| Docs: CLAUDE.md, conventions-data.md | ~20 |
| **Total** | **~620** |

Nothing uncounted. About 2½ hours; one pull request.

## Finish line

```bash
pnpm --filter @waitron/provisioning exec vitest run src/configuration-transfer.json-lists.test.ts src/configuration-transfer.boundaries.test.ts src/configuration-import.test.ts
pnpm --filter @waitron/db exec vitest run src/json-id-lists.test.ts src/schema/columns.json-shape.test.ts src/schema/columns.test.ts
pnpm --filter @waitron/server exec vitest run src/configuration-transfer.test.ts
pnpm --filter @waitron/module --filter @waitron/provisioning --filter @waitron/db typecheck
pnpm exec vitest run scripts/id-columns-are-references.test.ts scripts/claude-md-pointers.test.ts scripts/column-vocabulary.test.ts
```

Each Vitest run shows a `Tests` count with no failures (CLAUDE.md §4).

## Expected protection-list difference

None: `pnpm protection-list compare` prints `EQUAL`. No table, column, index, CHECK or trigger
changes (the new CHECK helper is only called by later slices). Run the list before and after anyway
(rules §3); a line here is a stop.

## Stop points (beyond rules §5)

1. An existing configuration test (`apps/server/src/configuration-transfer.test.ts`, the
   provisioning suites) changes result. Nothing real declares the new fields yet, so none should.
2. The guard's new JSON-column reading finds a column in today's transferred tables (one with a
   `json_valid` CHECK). Decision 1 says there is none; if there is, it needs an owner for its
   declaration before this lands.
3. `removeIdFromJson` cannot be written without a per-table branch (it must work from the drizzle
   column alone).

## In-flight work (rules §8)

None changes a table here. A1002's second cut (lane K) is its first likely user after `dv6`; its
plan's Task 3 transfer step uses `jsonReferences` instead of inventing a remap of its own. Tell
lane K's watcher when this lands.

---

### Task 0: record the base protection list

- [ ] In a throwaway worktree of the base commit, from `apps/server`:
  `pnpm protection-list list --out <empty absolute dir A outside the repo>`. Keep it for Task 5.

### Task 1: the declaration type and the shape CHECK helper

**Files:** `packages/module/src/module.ts`, `packages/db/src/schema/columns.ts`,
`packages/db/src/schema/columns.json-shape.test.ts`.

**Interfaces (produced, used by every later user):**

```ts
// packages/module/src/module.ts
/** Where the ids sit inside one JSON column. A step is an object key, or "*" for every key of an
 *  object or every element of an array. */
export interface JsonReference {
  readonly column: string;
  readonly paths: readonly (readonly string[])[];
}
export interface ConfigurationTransferTable {
  // …existing fields…
  /** JSON columns holding other rows' ids (README R4's exception). Export drops an id that names
   *  no exported row; import rewrites each to the importing venue's id and refuses one the bundle
   *  does not hold. Nulls as decision 3 says. */
  readonly jsonReferences?: readonly JsonReference[];
}

// packages/db/src/schema/columns.ts
/** `json_valid(c) and json_type(c) = '<shape>'`: the shape CHECK every R4 list carries. A NULL
 *  passes it (`json_valid(NULL)` is NULL, and a CHECK refuses only false), so a nullable list needs
 *  no other form; a list that must be present is declared `notNull()`. */
export const jsonShapeCheck: (column: AnyColumn, shape: "array" | "object") => SQL;
```

- [ ] **Step 1: failing test** `columns.json-shape.test.ts`: a scratch `node:sqlite` table built
  from `check("t_list_ck", jsonShapeCheck(t.list, "array"))` (nullable column) and
  `check("t_doc_ck", jsonShapeCheck(t.doc, "object"))` (`notNull`). Cases: "accepts an array,
  refuses an object, a number and text that is not JSON" (`[]` and `["a"]` pass; `{}`, `3`, `'nope'`
  raise a CHECK failure naming `t_list_ck`); "a nullable column with the CHECK accepts null"; "a
  not-null column refuses null by its NOT NULL, not by the CHECK".
  Run `pnpm --filter @waitron/db exec vitest run src/schema/columns.json-shape.test.ts`: FAIL.
- [ ] **Step 2:** implement both; run the test and `src/schema/columns.test.ts`: PASS. Typecheck
  `@waitron/module` and `@waitron/db`. Commit.

### Task 2: export prunes declared lists

**Files:** `packages/provisioning/src/configuration-transfer.ts`,
`packages/provisioning/src/configuration-transfer.json-lists.test.ts`.

Synthetic schema for every case in this file (created inside `scratch`, as the boundaries suite does):

```sql
create table zz_targets (id text primary key, active integer not null default 1);
create table zz_owners (
  id text primary key,
  ids text check (json_valid(ids) and json_type(ids) = 'array'),
  doc text not null default '{}' check (json_valid(doc) and json_type(doc) = 'object'));
```

declared as `moduleWith([{ name: "zz_targets", leaveBehindWhenFalse: "active", before: ["zz_owners"] },
{ name: "zz_owners", jsonReferences: [{ column: "ids", paths: [["*"]] }, { column: "doc", paths:
[["*", "ids", "*"], ["*", "defaultId"], ["*", "stationIds", "*"]] }] }])`. (`ids` is nullable to
test a whole null column.)

- [ ] **Step 1: failing cases** (export side):
  - "drops from a list and from a single field an id whose row is left behind": targets `A`
    (active) and `B` (inactive); an owner with `ids = ["A","B"]` and
    `doc = {"r":{"ids":["B","A"],"defaultId":"B"}}`. The export's owner row has `ids = ["A"]` and
    `doc = {"r":{"ids":["A"],"defaultId":null}}`.
  - "drops an id that names no row at all": `ids = ["A","gone"]` exports as `["A"]`.
  - "passes nulls as decision 3 says": an owner with `ids = null` and
    `doc = {"r":{"ids":["A"],"defaultId":null},"v":{"stationIds":null}}` exports unchanged.
  - "an owner is never left behind for what its lists name": an owner whose every id names `B`
    still travels, with empty lists (control: the owner count before and after is equal).
  - "refuses a declared column whose text is not JSON": `ids` stored through a raw insert with the
    CHECK dropped (create the table without it for this case) as `'nope'`; export throws
    `setup.request_invalid` with `field: "zz_owners.ids"`.
  Run `pnpm --filter @waitron/provisioning exec vitest run src/configuration-transfer.json-lists.test.ts`: FAIL.
- [ ] **Step 2: implement.**
  - When building the exported copy (`:306-321`), walk each `jsonReferences` path and drop ids not in `exportedIds` (the set of `id` values of
    every row the export keeps, across all declared tables). Write the JSON back with
    `JSON.stringify`. Nulls as decision 3. Unparseable text or a present non-null non-string at an
    id step refuses as in the case above.
  - Pure helpers live in this file: `idsAt(value, path)` and `pruneAt(value, path, keep)`.
- [ ] **Step 3:** run the new file and `src/configuration-transfer.boundaries.test.ts`: PASS. Commit.

### Task 3: import rewrites ids at declared paths and refuses foreign ones

**Files:** same two.

- [ ] **Step 1: failing cases** (import side; bundle built by hand, as the boundaries import case
  does at `:414-430`):
  - "rewrites every id at a declared path to the importing venue's new id": a bundle whose
    `zz_targets` holds `old-A` and `old-B` and whose owner holds `ids = '["old-A","old-B"]'`,
    `doc = '{"r":{"ids":["old-B"],"defaultId":"old-B"},"s":{"ids":[],"defaultId":null}}'`. After
    `importConfigurationTables`, the owner's `ids` equals the two new target ids in the same order,
    `doc.r.ids` and `doc.r.defaultId` equal `old-B`'s new id, `doc.s` is unchanged, and
    `pragma foreign_key_check` is empty.
  - "refuses an id the bundle does not hold": `ids = '["old-A","elsewhere"]'` throws
    `setup.request_invalid` with `field: "zz_owners.ids"`, and no `zz_owners` row exists after the
    rollback.
  - "refuses a non-string at an id step": `ids = '[3]'` and `doc = '{"r":{"ids":[{"x":1}]}}'` each
    throw the same.
  - "passes nulls": `ids = null`, a view's `"stationIds": null` and `"defaultId": null` import as
    they are.
  - "a value outside the declared paths is left alone": `doc = '{"r":{"ids":[],"defaultId":null,"note":"old-A"}}'`
    imports with `note` still `"old-A"`.
  - "round trip": export from a venue with the synthetic rows, then, in a second `useVenueDb` venue,
    **create the same two synthetic tables first**, import the bundle, and read every id in the
    owner's lists: each names a `zz_targets` row of the importing venue (the M4 failure shape for a
    synthetic table: no old id, no dead id).
- [ ] **Step 2: implement** beside the whole-value rewrite at `:741-742`: for each declared
  `jsonReferences` column of the row being inserted, parse, map each id at each path through
  `idMap`, refuse an id with no entry, stringify. Run the file: PASS.
- [ ] **Step 3:** run `src/configuration-import.test.ts` and `apps/server`'s
  `src/configuration-transfer.test.ts`: PASS and unchanged (stop 1). Commit.

### Task 4: the clearing helper and the guard

**Files:** `packages/db/src/json-id-lists.ts` and its test, `packages/db/src/index.ts`,
`scripts/id-columns-are-references.test.ts`.

**Interfaces:**

```ts
// packages/db/src/json-id-lists.ts — re-exported from "@waitron/db"
/** `value` with every occurrence of `id` taken out: an array loses the element, an object field
 *  holding it becomes null. Anything else is returned unchanged. */
export function withoutId<T>(value: T, id: string): T;
/** Removes `id` from `column` in every row of its table that names it, in the caller's
 *  transaction; returns how many rows changed. Finds them with `json_tree`, rewrites in code. */
export function removeIdFromJson(tx: Transaction, column: AnySQLiteColumn, id: string): Promise<number>;
```

- [ ] **Step 1: failing tests** `json-id-lists.test.ts` (`useVenueDb` with a synthetic table made in
  the test, as Task 2's): "removes the id from a top-level array and a nested one, and nulls a
  field holding it" (`withoutId(["a","b"], "a")` → `["b"]`; `withoutId({r:{ids:["a"],defaultId:"a"}}, "a")`
  → `{r:{ids:[],defaultId:null}}`); "leaves a value that does not hold it identical (same
  reference)"; "`removeIdFromJson` changes only the rows naming it and returns their count"
  (three rows, two naming `a`: returns 2; the third row's text is byte-identical); "an id that is
  only part of a longer string is not touched" (`["ab"]` stays).
- [ ] **Step 2:** implement and export; run: PASS.
- [ ] **Step 3: the guard.** Extend `TableSchema` with `jsonColumns: string[]`: the columns named
  inside a `json_valid(` call in `select sql from sqlite_schema where type='table' and name=?`
  (match `json_valid\("?<table>"?\."?(\w+)"?\)` and the unqualified `json_valid\("?(\w+)"?\)`).
  Treat a `jsonReferences` column as handled. Report `table.column` for a JSON column that is not
  handled and not in a new `JSON_WITHOUT_IDS: Record<string, string>` (starts empty). Report an
  `_ids` column that is declared only in `references`. Update the header comment: say what it now
  reads, and that it is weaker than its name because a JSON column without a `json_valid` CHECK is
  invisible to it. New cases, each with a synthetic `schema` callback as the existing cases use,
  except the first: "reads a JSON column from a real table's stored definition" (the extraction run
  on the real migrated database: `party_allergy_guests.allergens`, which carries a real
  `json_valid` CHECK, `packages/db/drizzle/0000_baseline.sql:2874`, and is not transferred, so the
  main case is unaffected; control: `party_allergy_guests.party_id` is not extracted);
  "reports a JSON-checked column until it is declared in jsonReferences"; "passes a JSON-checked
  column listed in JSON_WITHOUT_IDS, and reports it unlisted"; "reports an _ids column declared
  only in references"; "every jsonReferences entry names a column its table has" (over the real
  declarations; passes vacuously today and holds every later user to it).
- [ ] **Step 4:** run `pnpm exec vitest run scripts/id-columns-are-references.test.ts`: PASS on the
  real tree (stop 2 if not). Prove the new branch by deletion: comment out the `jsonReferences`
  handling and see the first new case fail; restore. Commit.

### Task 5: docs and finishing

- [ ] **Step 1: CLAUDE.md §3.** In "A column of a transferred table that holds another row's id is a
  foreign key, a declared `references` entry or left out of the export", add: "; a short id list
  kept as JSON (README R4's exception) is a `jsonReferences` entry, which export prunes and import
  rewrites, and a delete clears it with `removeIdFromJson`." Extend its guard clause: "weaker than
  its name — it knows an id column only by a name ending `_id` or `_ids`, and a JSON list only by a
  `json_valid` CHECK naming it."
- [ ] **Step 2: conventions-data.md**, in the section that entry links to: the three gaps from
  `tables-devices.md` §7, the prune-on-export and refuse-on-import choice and why (M4's failures),
  the null rules, why gap 3 is not built (decision 4), the fixed-key limit, and the guard's limits.
- [ ] **Step 3:** `pnpm exec vitest run scripts/claude-md-pointers.test.ts` and
  `pnpm exec prettier --check CLAUDE.md`: PASS.
- [ ] **Step 4:** protection list after; `compare` prints `EQUAL`.
- [ ] **Step 5:** commit; `/finish-branch`; tell the lane 2 and lane K watchers it has landed.
