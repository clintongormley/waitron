# A1308 slice 5f-ii: the unread `cfg` parameters on the invoice path go — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Every rule in
> [the slice rules](2026-11-08-a1308-slice-rules.md) applies ("rules §n"). The sweep's order, shared
> words and the reviewer's re-run: [5a](2026-11-08-a1308-5a-service-and-staff-location-columns.md#the-location-sweep-in-one-place).

**Lands: the owner.** The backlog records it (A1301 entry, S18 bullet): "Removing the ones in
`till-sale.ts` and `working-order.ts` edits files on the invoice path, which the owner lands
(S18b)". No value reaching a fiscal record moves: each parameter is declared and then discarded with
`void cfg;`, so no callee reads it.

**No venue reset:** no starting migration changes; the pull request's first line says "No schema
change."

**Needs before it:** 5f (order only: the two share no file except by chance; overlap is a rebase).
Split out of 5f by the coordinator (2026-11-08) because of the call-site counts below.

## What it builds

Six functions lose their unread second parameter `cfg: TradingContext`, and every call site loses
the argument (backlog A1301 entry, S18 bullet: S18b's codemod started only from parameters named
`_cfg` or `_locationId`, so it left these). Call lines counted by the reviewer on 2026-11-08:

| Function | File | `void cfg;` at | Call lines (files) |
| --- | --- | --- | --- |
| `advanceTicketItem` | `apps/server/src/working-order.ts` | `:7803` | 197 (44) |
| `bumpCourseReady` | `working-order.ts` | `:3000` | 42 (15) |
| `abandonHeldOrder` | `working-order.ts` | `:7164` | 37 (13) |
| `advanceTicket` | `working-order.ts` | `:7850` | 22 (7) |
| `assertPartyBillOpen` | `working-order.ts` | `:1869` | measured in Task 1 |
| `readTenderBlock` | `apps/server/src/till-sale.ts` | `:383` | 20 (5) |

In every one, `cfg` is the second parameter, after `tx` (read at the lines above). Most call sites are
tests, so the removal is done by a committed script, and a hand edit is needed only where the script
cannot see the call.

**The script**, `scripts/a1308/drop-argument.mjs` (structure as 5a's script: `createSourceFile`,
position splices, no reprint, `--write`, a report, the fiscal pair skipped, idempotent):

```text
node scripts/a1308/drop-argument.mjs --call <function>#<index>[,…] --declared-in <file> [--write] <file…>
```

- In `--declared-in`, delete parameter `<index>` of the function declaration named `<function>`, and
  the `void <name>;` statement that discards it.
- Everywhere, at each call whose callee is the bare identifier `<function>` or a property access ending
  in it, delete argument `<index>` when the call has more than `<index>` arguments and none is a spread.
- Report, and do not edit: a call with a spread argument or too few arguments; the function name used
  as a value (passed, assigned, exported under another name); an object-literal member of that name.
- A second run deletes nothing (the parameter is gone, and calls with one fewer argument are left).

## What it leaves out

| Left out | Why |
| --- | --- |
| Other unread parameters anywhere | not in the backlog's list |
| `order-groups.ts` and `parties.ts`, test helpers' `void cfg;` | 5e (lane) |

## Files

Create: `scripts/a1308/drop-argument.mjs`, `scripts/a1308/drop-argument.test.mjs`.

Modify: `apps/server/src/working-order.ts`, `apps/server/src/till-sale.ts`, and the call sites the
script edits (about 85 files, nearly all tests; `git grep -l -w -E "advanceTicketItem|bumpCourseReady|abandonHeldOrder|advanceTicket|assertPartyBillOpen|readTenderBlock" -- apps packages`).

## Size

| Part | Counted |
| --- | --- |
| The script and its test | ~120 + ~100 |
| The two declarations | ~12 |
| Hand edits the script reports | ~30 |
| **Total** | **~260** |

Not counted: the script's output (about 320 call lines).

## Finish line

1. `pnpm exec vitest run scripts/a1308/drop-argument.test.mjs` passes; root coverage for it is at least
   98/98/98/95.
2. The reviewer's re-run gives the output commit (5a, "The location sweep, in one place").
3. `git grep -n "void cfg;" -- apps/server/src/working-order.ts apps/server/src/till-sale.ts` prints
   nothing; control on the base: it prints six lines.
4. `pnpm --filter @waitron/server typecheck` passes, and the suites of the files the script changed
   pass (`git diff --name-only origin/main -- '*.test.ts'`; check free memory first).
5. The fiscal pair passes unedited (A1301 plan, "The fiscal pair").
6. `pnpm protection-list compare` prints `EQUAL`.

## Expected protection-list difference

None: `EQUAL`. No schema changes.

## Stop points (beyond rules §5)

1. **More than about 30 call sites the script reports for one function** (a spread, a value use, a
   call through a type it cannot see): stop and report them; that function becomes a task of its own.
2. A function turns out to be a module-contract member or to be passed through a contract (its
   implementations would have to change together).
3. Removing a parameter changes any test's assertion.

## Assertions that change, by design

None.

---

### Task 1: The script, test first

- [ ] **Step 1: Failing tests:** a declaration loses its parameter and its `void cfg;`; a bare call
  and a property-access call lose the argument; a call with a spread is reported and left; the name
  passed as a value is reported; a second run changes nothing; the fiscal pair files untouched.
- [ ] **Step 2:** Write the script; run; read the coverage row. Measure `assertPartyBillOpen`'s call
  lines with a dry run (no `--write`) and add them to the pull request. Commit.

### Task 2: The run

- [ ] **Step 1:** For `working-order.ts`:
  `node scripts/a1308/drop-argument.mjs --call advanceTicketItem#1,bumpCourseReady#1,abandonHeldOrder#1,advanceTicket#1,assertPartyBillOpen#1 --declared-in apps/server/src/working-order.ts --write $FILES`;
  then for `till-sale.ts`: `--call readTenderBlock#1 --declared-in apps/server/src/till-sale.ts`.
  Prettier on the touched files; commit the output alone (5a's `$FILES`; the base is the reviewer's
  starting point).
- [ ] **Step 2:** Hand-edit what the report lists (stop point 1 above 30 for one function). Run
  Finish lines 3–5. Commit.

### Task 3: Finish

- [ ] **Step 1:** Backlog, A1301 entry: delete the S18 bullet's invoice-path `void cfg` sentence.
- [ ] **Step 2:** `pnpm protection-list compare` (`EQUAL`); `pnpm format:check`; commit;
  `/finish-branch`. The owner lands it.
