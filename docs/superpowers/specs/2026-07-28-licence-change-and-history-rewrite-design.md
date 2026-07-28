# Licence change — MIT to Elastic License 2.0, with history rewrite

**Date:** 2026-07-28
**Status:** design approved, ready for planning
**Supersedes:** the MIT decision recorded in
[implementation-provenance.md](../../compliance/implementation-provenance.md) §"Waitron's own
licence — MIT" (decided 2026-07-18)

---

## 1. The decision

Waitron moves from **MIT** to the **Elastic License 2.0**, applied to the whole repository, with
a small file of additional permissions that only ever *grants* — never restricts.

The goal is not open-source purity and not licence revenue. It is one thing: **a hyperscaler or
funded competitor must not be able to take this codebase and sell a hosted Waitron cheaper than
Waitron sells it.** A restaurant, or a group of forty restaurants, may run it for free, forever,
at any scale, and pay a contractor to look after it.

### Why not AGPL

AGPL is the reflex answer and it is the wrong one. AGPL is precisely the licence AWS defeated
against MongoDB and Elasticsearch: a hyperscaler can comply — publish its modifications — and
still take the business. If the threat is "Amazon hosts my product cheaper", the licence has to
prohibit *the hosting*, not tax it with a source-publication duty. That puts us in
source-available territory, not OSI-approved open source, and that is a deliberate trade.

### Why ELv2 over the alternatives

| Candidate | Verdict |
| --- | --- |
| **Elastic License 2.0** | **Chosen.** Limitation 1 targets exactly the threat model — *hosted or managed service* — rather than competition in general. One page, plain English, in production since 2021, carries the SPDX identifier `Elastic-2.0` so tooling recognises it. |
| PolyForm Shield 1.0.0 | Excellent drafting, but its test is "any product that competes", which is wider than we asked for, vaguer at the edges, evaluated years hence against our whole business — and unfamiliar to any counsel who reviews it. |
| BUSL 1.1 / FSL | Both mandate a Change Date. We rejected the time-delayed model (§3). |
| Bespoke "Waitron Community Licence" | Exact fit, but no SPDX id, scanners report "unknown", every adopter's counsel reads it cold, and we would own all the drafting risk that ELv2 has already absorbed over four years of use. |

---

## 2. The licence stack

Four files at the repository root, plus one CI check. **`LICENSE` is never edited** — a modified ELv2 that still
calls itself ELv2 is worse than a bespoke licence, because readers assume they already know what
it says.

| File | Status | Contents |
| --- | --- | --- |
| `LICENSE` | replaced | Elastic License 2.0, verbatim and unmodified. |
| `LICENSE-GRANTS.md` | new | Additional permissions. **Adds only, never subtracts** — safe because we hold all copyright and may always grant more than the licence does. Two grants, below. |
| `CONTRIBUTING.md` | new | Transferable inbound grant including the right to relicense, plus DCO sign-off. |
| `README.md` | new — none exists today | Plain-English licensing summary, trademark reservation, and a licensing-questions contact. |
| `.github/workflows/` | amended | A DCO check job, so the inbound grant is enforced rather than aspirational. |

Root `package.json` gains `"license": "SEE LICENSE IN LICENSE"`.

### The two additional grants

**Grant 1 — service providers.** Installing, configuring, hosting, administering, monitoring or
supporting the software, for a fee, **on infrastructure the customer controls under the
customer's own accounts**, is not "providing the software to third parties as a hosted or managed
service" for the purposes of ELv2 Limitation 1.

This closes ELv2's one gap for our case. On a literal reading, a contractor administering a
restaurant group's own instance could be caught by Limitation 1; we do not want that. The line is
**who holds the infrastructure account**, not who does the work.

**Grant 2 — abandonment sunset.** If the licensor publicly announces that Waitron is
discontinued, or publishes no release for twelve consecutive months — a release being a tagged
version or a published artefact, not merely a commit — the then-current version converts to the
Apache License 2.0.

This buys the anti-lock-in guarantee a restaurant actually cares about — *my till does not die if
you go bust* — without gifting a competitor the rolling snapshot that BUSL or FSL would.

### Deliberately not doing

- **No `COMMERCIAL.md`.** It would advertise a business we are not in: selling hosting rights to
  other people. The goal is to *reserve* hosting, not sell it. Nothing in the repository grants
  us our own commercial rights — we do not licence to ourselves; our cloud runs on our own
  copyright. The option to dual-licence later is preserved by **owning the copyright**, not by
  announcing it. The README carries a contact line, not an offer.
- **No per-file licence headers.** Five hundred files of churn, zero legal gain, with one
  `LICENSE` at the root of a single-licence monorepo.
- **No per-package `license` fields.** All twelve packages and `apps/server` are
  `"private": true` and never published to npm; the metadata is inert.
- **No permissive carve-out for `packages/verifactu` or `packages/ui`.** One licence, whole
  repository. Loosening later is easy; tightening is not.

---

## 3. Scope of the restriction

Permanent. No change date, no expiry — subject only to the Grant 2 sunset.

| Scenario | Verdict | Source |
| --- | --- | --- |
| A deli runs Waitron on its own till | allowed | ELv2 grant |
| A 40-venue group self-hosts one instance for all its venues | allowed | ELv2 grant — no scale cap |
| That group pays a contractor to install and maintain it **on the group's own servers or cloud account** | allowed | Grant 1 |
| A restaurant pays a developer to add a feature to its own instance | allowed | ELv2 permits modification |
| A hardware vendor sells tills with Waitron pre-installed, restaurant owns and runs the box | allowed | ELv2 grants a distribution licence — accepted deliberately as a channel, not a competitor |
| A consultant hosts Waitron on **their own** infrastructure and sells access to five restaurants | **prohibited** | ELv2 Limitation 1 |
| AWS offers "Managed Waitron" | **prohibited** | ELv2 Limitation 1 |
| Someone forks it, renames it, offers hosting | **prohibited** | Limitation 1; and the name was never licensed |

ELv2's other two limitations carry unchanged: no circumventing licence-key functionality
(forward-useful if a keyed commercial tier ever ships), and no removing or obscuring notices.

---

## 4. What this does not protect

Stated plainly, because a licence oversold is worse than no licence.

- **The MIT grant already given cannot be revoked.** Anyone who cloned or forked while the repo
  was MIT holds an irrevocable licence to that snapshot. The history rewrite in §6 is *hygiene*,
  not erasure. What limits the damage is that a fork goes stale fast against a moving
  fiscal-compliance target, and cannot use the name.
- **Enforcement is ours to fund.** A licence we would never litigate is a signal, not a wall.
- **But the signal is aimed correctly.** The realistic threat is not an anonymous bad actor; it is
  a funded company with a legal department, and no legal department signs off on shipping a
  service a licence prohibits. That is the mechanism that worked for Elastic against AWS's own
  counsel, and it is worth more than litigation we will never file.
- **Ideas are not copyrightable.** Nothing stops a competitor reimplementing.

---

## 5. Contributions, and the licence that actually matters

Dual licensing is only possible while we own or control every line. Today we do: every commit on
`main` is authored by `clintongormley@gmail.com`, and the `Waitron Dev <dev@waitron.dev>`
identity on unmerged branch refs is our own agent identity on our own domain. **There is no
third-party copyright in the tree.**

`CONTRIBUTING.md` keeps it that way. By opening a pull request, a contributor grants a perpetual,
irrevocable, worldwide, **transferable** licence to use, modify, distribute and **relicense** the
contribution, including under commercial terms; and signs off under the DCO, enforced by CI.

> **The grant must run to "Clinton Gormley and his successors and assigns."** If it is personal
> and non-transferable, then when the SL is formed — see
> [action-plan.md](../../compliance/action-plan.md) Step 6, triggered by declaración-responsable
> liability rather than by tax — every merged contribution has to be re-papered to move the
> copyright into the company. One clause today, or a paper chase later.

We chose inbound terms in `CONTRIBUTING.md` plus DCO over a signing bot. It costs an afternoon,
needs no legal review, and is weaker than a signed CLA only in a courtroom we are unlikely to see
at this stage. A full CLA remains available if the project ever takes serious outside
contribution.

The real "private licence" is not a file in this repository. It is the relationship between
Clinton Gormley (today's copyright holder) and Waitron SL (tomorrow's cloud operator) — an
assignment or exclusive licence, without which the company holds no asset. **Out of scope here**;
flagged against action-plan Step 6.

---

## 6. Compliance consequences

This is the one place the licence change reaches outside the licence, and it needs care.

Two documents assert a premise that selling — or merely commercialising — makes false:

- [asesor-questions.md](../../compliance/asesor-questions.md) §Q9(a), the **draft consulta to
  AEAT**: *"no lo comercializamos y no cobramos por él"*. A consulta vinculante binds AEAT only on
  the facts stated. Sent with that sentence intact, it buys a ruling that does not protect the
  business we actually run. **Must be reworded before sending.**
- [verifactu-findings.md](../../compliance/verifactu-findings.md) §218, which classifies
  `packages/verifactu` as a *"reusable MIT library for others to build on"* for
  declaración-responsable purposes.

Which way it cuts:

- **Against:** the LGT art. 201 bis limb of *1.000 € per uncertified system sold* acquires a
  denominator it previously lacked. Though
  [getting-to-production.md](../../compliance/getting-to-production.md) already records that
  *"gratuity is not an obvious exemption"* — free distribution was never clearly safe, so
  commercialising **removes an argument rather than creating the exposure**.
- **For:** it strengthens the producer→client reading that asesor-questions.md already argues.
  Art. 13.2 obliges the producer to put the DR in the client's hands *"en el momento de la
  adquisición"*. Once there is an actual *adquisición*, that article plainly engages — the reading
  stops being an inference.
- **Honestly:** [the architecture design](2026-07-18-pos-architecture-design.md) already commits
  us to a multi-tenant cloud service. We were going to be a *comercializador* regardless. The
  licence change does not create that; it makes it undeniable.

**Re-running the Q9(a) analysis is a lawyer's job and is out of scope here.** This spec reroutes
the paperwork; it does not pre-empt the conclusion.

### The mdiago letter leaves the repository

`docs/compliance/consulta-mdiago.md` — the outreach letter, round 1 sent 2026-07-26 — **has never
been committed.** It is untracked, so there is nothing to remove from history and the §7 rewrite
needs no step for it. It stays out of the published repository permanently, and **no note about
the licence change is added to round 2.**

Three consequences, all cheap:

- **One committed file already links to it**: `docs/superpowers/specs/2026-07-26-server-host-design.md`
  line 108. That link is the only trace of the letter anywhere in history — a filename, never the
  content. The filter-repo pass in §7 is already running, so strip the reference in the same pass
  at near-zero extra cost.
- **Three working-tree files link to it and are about to be committed in PR 0**:
  `asesor-questions.md` line 19, `action-plan.md` line 129, and this spec. Reword all three before
  committing, or the public repository ships links that 404.
- **Prevent accidental staging with `.git/info/exclude`, not `.gitignore`.** A `.gitignore` entry
  is itself committed, and would publicly name the very file it hides. `.git/info/exclude` is
  local to the clone and never published.

What mdiago *answered* stays. It is load-bearing compliance evidence, quoted throughout
`asesor-questions.md` and `implementation-provenance.md`, and none of it identifies the licence.
What leaves is the letter, not the findings. Anything said to him directly is outside the
repository and outside this spec.

### One distinction the doc sweep must not get wrong

Twelve committed files mention MIT. **Almost all are factual statements about other projects'
licences** — `borjamrd/verifactu-conformance`, `inoguerols/verifactu`, `zarpilla/verifactu-node-lib`,
`doscientos-es/verifactu`. Those are true and **must not change**. Only Waitron's own licence
statements are in scope.

---

## 7. History rewrite

Every commit already pushed carries an MIT `LICENSE`. We rewrite so that no commit in Waitron's
published history ever granted MIT. Per §4 this is hygiene, not revocation, and that is understood
and accepted.

**It is close to effective in practice because the repository has 0 forks, 1 star and no open
pull requests.** Without a fork network, GitHub's retention of unreferenced commits is far weaker.
The 235 unique cloners in fourteen days are consistent with our own CI — three workflows, a fresh
runner per job, each counting as a new unique — not with third-party interest.

### Mechanism: a fresh clone, not a git worktree

`git filter-repo` rewrites the entire object store and every ref at once. A linked worktree shares
`.git` with the main checkout, so it cannot isolate anything. A throwaway clone in the scratchpad
delivers the isolation actually wanted: the main checkout and the `db-exports-map` worktree stay
untouched until the push.

### Order of operations

1. **Commit the pending doc files on `main` first** — 24 at the time of the survey, plus this
   spec, and the count is a moving target so re-check rather than trusting the number — then
   clone. The rewrite carries them
   automatically — no transplant, nothing to lose. That commit also fixes
   `implementation-provenance.md` §"Waitron's own licence — MIT", which is the licence decision
   record and would otherwise be baked into the new history.
2. **Bundle the pre-rewrite state** (`git bundle create`) to the scratchpad. The rewrite stays
   reversible for as long as that file is kept.
3. **Rewrite `main` only.** Every commit from the root carries ELv2 at `LICENSE`. Two distinct MIT
   blobs exist in history — one per copyright-holder line, their identifiers recorded only in the
   git-ignored run ledger — and both must be replaced. `LICENSE` is injected from the root
   commit, so no commit in the rewritten history lacks a licence.
   - `LICENSE-GRANTS.md`, `CONTRIBUTING.md` and `README.md` are **not** back-injected; they land
     as a normal commit at the new HEAD. An ELv2 history without the grants file is strictly more
     restrictive, which is safe.
   - **In the same pass, strip the `consulta-mdiago.md` reference** from
     `docs/superpowers/specs/2026-07-26-server-host-design.md` line 108 — a text replacement, and
     the only trace of the mdiago letter anywhere in history. See §6.
4. **Delete every ref that anchors old history**, or the rewrite is defeated:

   | Ref | Anchors | Why it must go |
   | --- | --- | --- |
   | `archive/v1`, local and origin | 42 commits, true orphan (no merge-base with `main`), the previous attempt at building Waitron | Asked for |
   | **14 × `phase-N-complete` tags** | *the same 42 commits* | Every one is on `archive/v1`. **Deleting the branch alone achieves nothing** — a tag keeps its commits reachable |
   | 7 stale merged branches on origin | ~101 commits of MIT-era history | `payment-reconcile-slice-a`, `payment-reconcile-slice-b`, `payments-mode-2b-cycle-b`, `plan-sales-spine-data-model`, `roadmap-menu-hours-procurement`, `workforce-time-record`, `worktree-verifactu-library` — all squash-merged, content already in `main`; left alone they anchor the old history on the remote |

   Twenty-two remote refs deleted, plus one force-push of `main`.
5. **Replay the `db-exports-map` branch onto the new `main`.** It carries one commit of its own —
   `f3f2233`, *"docs(db): design the exports map…"*, whose spec is
   [2026-07-28-db-exports-map-design.md](2026-07-28-db-exports-map-design.md) — with a clean
   working tree, and its work is paused rather than abandoned. Rebase it onto the rewritten
   `main` (`git rebase --onto origin/main <old-main-sha> db-exports-map`); the replayed commit
   inherits ELv2 from its new parent. **Check for uncommitted work in that worktree immediately
   before the rewrite, not from an earlier survey** — this branch gained a commit between the
   survey and the design being written.

### Accepted fallout

- Every SHA on `main` changes. SHA citations in handoff docs and in saved memory — e.g. *"orphan
  drift gate (#31, squash 59ded62)"* — go dangling. Pull-request links survive; the commits inside
  them will show as belonging to no branch.
- The per-commit history of seven already-merged branches is lost. Their content is in `main`.
- Nothing external breaks: 0 forks, no open PRs, 1 star.

---

## 8. Sequencing

Every further commit under MIT widens the free snapshot, so the licence flip is the only
time-sensitive piece. Three units of work:

| PR | Contents | Urgency |
| --- | --- | --- |
| **0 — pending docs** | Commit the outstanding doc files, with the `implementation-provenance.md` licence-decision record rewritten | Immediately, as the precondition for the rewrite |
| **1 — the licence flip + rewrite** | `LICENSE`, `LICENSE-GRANTS.md`, `CONTRIBUTING.md`, DCO workflow, `README.md`, root `package.json`; then the §7 rewrite and ref deletions | Before further public feature work |
| **2 — the paper trail** | The "Open-Source Restaurant POS" title and framing in [the architecture design](2026-07-18-pos-architecture-design.md); the consulta premise in `asesor-questions.md`; `verifactu-findings.md` §218 | Not urgent, needs care, involves Spanish that will be read by AEAT |

---

## 9. Out of scope, flagged not done

- **Copyright assignment or exclusive licence to Waitron SL.** Belongs with
  [action-plan.md](../../compliance/action-plan.md) Step 6. Without it the company holds no asset.
- **Re-running the Q9(a) legal analysis** in light of commercialisation. A lawyer's job.
- **Sending the reworded consulta.**
- **A full signed CLA.** Available later if outside contribution becomes material.
