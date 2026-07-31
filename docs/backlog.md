# Backlog — what is in flight, what is next, and why

**Last reprioritised: 2026-07-31.** This file is the answer to "what should I work on?". It is
committed rather than held in a session's memory so that it can be diffed, reviewed, and checked
against the tree — memory notes drift, and several currently point at pull request numbers that no
longer exist (the repository was recreated for the licence change and numbering restarted at #1).

Two companion documents, deliberately not duplicated here:

- **[compliance/action-plan.md](compliance/action-plan.md)** — the legal and administrative track:
  certificates, company formation, the declaración responsable. **The deli must be filing by
  1 January 2027.**
- **[superpowers/specs/2026-07-18-pos-architecture-design.md](superpowers/specs/2026-07-18-pos-architecture-design.md)
  §2** — the twenty numbered sub-projects. That table is the strategy and does not change often.
  This file is the current state and changes constantly.

---

## Current direction

**Finish the fiscal story before building anything user-facing.**

The reasoning: the till has to be built against the invoicing model, and that model is mid-change.
Building a counter screen now means building it twice. The fiscal work is also the part that cannot
be repaired afterwards — invoice numbers are never reused and records are hash-chained — so it is
where care pays best.

**The trade being accepted:** there is no application a person can use. Thirteen packages and one
server app exist; `packages/ui` has six primitives and nothing consumes them; there is no
`apps/till`. The system can reconcile a Stripe account and file with AEAT, and cannot ring up a
sandwich. That is a deliberate ordering, not an oversight, but it should be revisited at each
reprioritisation rather than assumed.

---

## Now

| What | State |
| --- | --- |
| **Sale settlement model** — design | **PR #20, open and unmerged.** Docs only. CI green, Copilot's three findings fixed and answered |
| **This backlog** | **PR #21, open and unmerged.** Docs only |
| **Sale settlement model** — implementation plan | Not written. The next build step, once #20 lands |
| **Close Q13 and Q15 on primary source** | Not started. Cheaper than hiring — see below |
| **Consolidate the session-memory notes** | Not started. They predate this file and now overlap it — see below |

Both PRs are waiting on a merge decision, not on work.

---

## Next — the fiscal sequence

Four pieces, in this order. They are sequenced rather than parallelised because each adds a
migration to `packages/db`, and `packages/db/drizzle/meta/_journal.json` conflicts on every
concurrent branch. The collision is **per package**, not repo-wide — five packages carry their own
`drizzle/` directory and journal (`credentials`, `db`, `fiscal-verifactu`, `payments`, `scheduler`),
so work touching a different package's migrations can still run alongside these.

| # | Piece | Why here |
| --- | --- | --- |
| 1 | **Sale settlement model** | Everything else assumes it. Takes the tip and the amount charged off the frozen sale row so an invoice can exist before payment does |
| 2 | **Rectificativas** — sustitución and diferencias | The only lawful way to change an issued invoice. Blocks piece 4 |
| 3 | **F3 canje** — "can I have a proper invoice?" | Unmodelled today, and issuing an ordinary invoice instead would double-declare the sale. Ordinary trade in a restaurant, not an edge case |
| 4 | **Invoice-first mode** | Cannot be offered to staff until 2 exists: a disputed bill, a short payment and a "take a fiver off" all need a rectificativa |

Design and sources for all four:
[2026-07-31-sale-settlement-model-design.md](superpowers/specs/2026-07-31-sale-settlement-model-design.md)
§8, and [compliance/verifactu-findings.md](compliance/verifactu-findings.md) §§7-10.

**Then reassess.** The next question after piece 4 is whether to keep going fiscal (reporting, daily
close) or turn to the till. Do not answer it here in advance.

---

## The advisor gap

**No fiscal advisor is engaged.** The four open questions in
[compliance/asesor-questions.md](compliance/asesor-questions.md) therefore have nowhere to go, which
makes "blocked on the asesor" a wish rather than a queue.

Two of the four are not idle curiosity — they check assumptions **already built into the code**:

| Q | Assumption already in the tree | If the answer is no |
| --- | --- | --- |
| **Q13** | Tips are outside the VAT base and appear on no invoice — `sales.tip_amount`, `record-sale.ts`, and a test pinning that the tip does not enter the huella | Every invoice modelled so far understates its base, and the tip has to enter the hash |
| **Q5(a)** | One invoice series per till | The numbering scheme's foundation moves |
| Q14 | A printed pre-bill obliges an amendment log | Changes the till design, not existing code |
| Q15 | Short payment is a discount | Changes the till design, not existing code |

**Engaging someone is itself a task, and it has a lead time.**
[compliance/who-to-ask.md](compliance/who-to-ask.md) is blunt about the market: *"No Spanish advisory
firm with demonstrated technical depth on encadenamiento or RRSIF architecture was verified — every
candidate turned out to be a marketing page. Assume you will be educating whoever you hire."*

### Read this before engaging anyone: some questions are premised on an architecture we abandoned

[#19](https://github.com/clintongormley/waitron/pull/19) (*"The cloud is a sync root, not a shared
system of record"*, merged 2026-07-31) put a banner at the top of `asesor-questions.md` warning that
several questions assume **Waitron hosts the client's fiscal system**. Under the design it
establishes, the cloud never holds the key ring, the certificate stays on the client's own local
server, and that server always submits. Q11 and Q12 are named as affected, and its instruction is
blunt: *«re-read every question against the new architecture before paying for answers»* — a question
built on the old premise buys an answer to a situation that will not exist.

**So the advisor task is not just "engage someone".** It is: re-read the whole list against the
current architecture, drop or rewrite what the cloud design invalidated, add the replacement question
that design raises (does the RRSIF reach a backup archive that is not itself a SIF?), *then* engage.

Q13, Q14 and Q15 post-date that design and do not depend on hosting, so they are unaffected.

### Task: try to close Q13 and Q15 on primary source first

**Q5(b) was closed without asking anyone** — RD 1619/2012 art. 6.1.a) states it plainly, and reading
the BOE took minutes. Two of the remaining questions may go the same way, and that is worth an
afternoon before committing to a relationship the research above says will need managing.

- **Q13 (tips).** Every secondary source cites **DGT consulta vinculante 2174-03**, and none of them
  was read at source. Start there, in [PETETE](https://petete.tributos.hacienda.gob.es/consultas/).
  Highest value of the four: the answer is already assumed by the schema, by `record-sale.ts`, and by
  a test pinning tips out of the huella.
- **Q15 (short payment).** Discount versus bad debt is well-trodden ground in DGT doctrine; the
  card-present wrinkle — one capture exceeding the invoice — may not be.
- **Q14 (precuenta)** is the one least likely to yield, since it turns on whether AEAT's
  *prefactura* list is exhaustive, which is an interpretive question rather than a stated rule.

Record whatever is found in [compliance/verifactu-findings.md](compliance/verifactu-findings.md)
and mark the question closed in `asesor-questions.md`, following the Q5(b) precedent — do not leave a
closed question sitting in the open list.

---

## Not started

Nothing below has any code.

| Sub-project | Note |
| --- | --- |
| **7 — Counter POS UI** | The till. Also owns the working-order amendment log (art. 29.2.j LGT), deferred here deliberately: nothing writes working orders yet, and a log with no producer cannot be shown to work |
| **5 — Identity** | Users, roles, permissions. The refund/void role gate waits on it |
| **6 — Locations** | Venue and till registration, series assignment |
| **8 — Reporting** | Daily close, VAT summary |
| **16 — Workforce** | The *registro de jornada* is a **launch-day legal duty**, not a nicety |
| **18 — Menu and allergens** | Allergen declaration is a **launch-day legal duty** (EU 1169/2011, RD 126/2015) |
| 10-15, 17, 19, 20 | Tabs, floor plan, KDS, tip payroll, bookings, online ordering, accounting export, opening hours, procurement |

The two marked **launch-day legal duty** are worth watching: they are not fiscal, they are not
optional, and they are currently as unstarted as the restaurant-phase items they sit beside.

---

## Debt and odd jobs

Carried from finished work. None of it blocks anything; all of it makes later work cheaper.

- **`errors.reachability.test.ts` does not test reachability.** Proven by deletion. Eight packages
  carry a copy. Closing it needs a `tsc`-based downstream probe or a narrowed `include`. See
  `CLAUDE.md` §4 — do not cite these tests as evidence in the meantime
- **CI's `test` job is the ~6 minute critical path.** A two-job split is roughly a 2 minute win; job
  ids are a branch-protection interface, so it wants its own PR
- **Payments follow-ups** — the webhook HTTP endpoint (its own cycle: per-tenant signature
  verification needs the tenant, which is only knowable from the unverified payload), `forward`
  retry backoff, the reconcile remediation UI
- **An open product question** — the orphan drift gate holds a customer's money pending a human, and
  the hold is unbounded today because nothing re-sweeps a closed period. Defensible before
  production; deserves a decision before it
- **Fiscal follow-ups** — a partial index on `acks`, a sargable reconcile period filter. Both gated
  on scale that does not exist yet
- **Provisioning and credentials follow-ups** — test-infra duplication, `bin.ts` connect-before-
  validate ordering, `rotate` coupled to `PURPOSES`

---

## Task: consolidate the session-memory notes against this file

The per-topic memory entries were the only record of priorities before this file existed, and now
they overlap it. Left alone they will disagree with it, and memory is the copy nobody can review.

Three specific problems, all present today:

- **Dangling references.** Entries cite pull requests up to #35. The repository was recreated for the
  licence change and numbering restarted at #1, so those point at nothing. Commit SHAs in them
  dangle for the same reason.
- **Overlap.** Several are titled "follow-ups" and hold exactly what the **Debt and odd jobs**
  section above now holds.
- **A known contradiction.** One entry records that `CLAUDE.md` still says the opposite of it.

What to do: move anything that is genuinely a *task* into this file, keep in memory only what memory
is for — durable preferences and hard-won lessons that change how work is done — and delete the
rest. Strip or annotate the dead PR numbers wherever the surrounding fact is still worth keeping.

---

## How to keep this file honest

Update it in the change that makes it stale, the same rule `CLAUDE.md` §7 applies to itself. In
particular:

- When a piece lands, move it out of **Next** rather than leaving it to be discovered.
- When a question is closed on primary source, say so and stop calling it blocked.
- Delete finished items. This is not a history; the git log is.
