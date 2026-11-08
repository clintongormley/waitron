# D2: One count of items everywhere

**Approved by watcher, 2026-11-08 11:43**, now retained in Lane D progress.log: “Amend and build; no further approval needed unless the build goes outside it.” Approval requires the spanning-station exception and the named draft control below. Assignment: Lane D queue, watcher 2026-11-08 10:52, “One count of items everywhere (A995, A996, A1293)”. A997 stays. One PR, implemented inline after approval. Revised from `d2-plan-review.txt`: simplify to server classification and one wire flag; no shared package or draft changes. The watcher approval resolves the restricted reviewer's external-provenance/simplification hold.

**Build.** Export a small unit-classification helper beside `dishCounts` in `order-state-counts.ts`. Keep its existing whole-portion rule: no hardware unit, zero effective precision, not measured; fractional active quantities count as one, zero as zero. Preserve frozen-precision precedence and current-unit inheritance. Use it in floor ready/held reads and Current orders. Send Sent one optional unit-classification flag, not a unit object; retain real quantity/money strings and all service/editing controls.

Sent applies the same fraction/remaining rules to summaries and its held-by-course labels. Measured food counts once in each state; whole portions remaining round up. For partially served whole portions, Served is ordered minus remaining so the counts add up. Retain charged cancellations in Served; group slices of the same measured dish before counting. Keep the existing held read's serving treatment, avoiding the unrelated reminder change. The draft already uses `takesExtras` and needs no change.

Use ready-signal counts for the floor look and table-status flash when available, preserving no-signal fallbacks and line-based detail progress. At each station count a parent dish once; a dish spanning stations still appears once at each station, preserving per-station work/readiness. Do not change when components become ready. Parent quantities already reduced by the cancellation path must not be reduced again.

Find a bill replaces `count(*)` with a coalesced sum over saved active parent dishes using that rule, including inherited units, before Items sorting/pagination. Drafts on an existing bill remain outside Find a bill, while Parked orders may include them; that difference is deliberate. No schema, migration, fiscal, snapshot or unrelated cleanup. A997 remains: unit reassignment can change these counts; update its affected-reader list.

**Review amendments approved by watcher, 2026-11-08 14:23**, now recorded in Lane D progress.log: add at most 300 test lines for the deletion gaps, correct the ready-count comment in `packages/shared/src/table-signals.ts`, and narrow readiness wording without changing product behavior. The 11:43 approval is also retained in progress.log after resolution. Watcher 14:13 allowed another 45 minutes to open the same PR, keeping the original start stamp.

**Exact allowed paths** (others require approval):

- Server `apps/server/src/{order-state-counts.ts,order-state-counts.test.ts,table-signals.ts,table-signals.test.ts,order-groups.ts,current-orders.test.ts,find-bill-bills.ts,find-bill-bills.test.ts}`.
- Till `apps/till/src/api/client.ts`; `apps/till/src/state/{sent-panel.ts,sent-panel.test.ts,floor-look.ts,floor-look.test.ts}`; `apps/till/src/widgets/{sent-orders.ts,sent-orders.test.ts,table-status.ts,table-status.test.ts}`; `apps/till/src/screens/till-table-order-screen.sent.test.ts`.
- Docs: this plan, `docs/backlog.md`, `docs/backlog/till.md`, `apps/server/src/guide/{en,es}/kitchen-service.md`. Update the existing ready-count guidance to direct staff to the matching station/card counts; no new section.

Estimate **150–200 code lines, 250–350 test lines**, plus concise docs. No generated files.

**Test first and finish.**

- [ ] Fail first on 0.64 kg, 150 g and 330 ml, custom zero-precision measures, counted 3, fractional non-measures, cancellations, parent/extra stations, partial serving and per-course Sent labels. Preserve price, slice and action assertions. Include inherited/changed/missing units within A997's deliberate limit and a 330 ml draft reading 1 in `till-table-order-screen.sent.test.ts` as the already-correct A995 control. Implement minimally, rerun to pass.
- [ ] Test Items both ways across a 50-row page boundary with row counts differing from item counts; explicit saved-line versus open-draft behavior. Test ready-signal preference and no-signal fallback. Preserve actual quantities and reminder behavior.
- [ ] Use `pnpm --filter <package> exec vitest run <named test paths>` for every allowed test above; add server `history-read-plans.test.ts` and `guide-content.test.ts`, plus root `scripts/guide-links.test.ts`. Require passing nonzero counts. LOOK light/dark at phone/desktop. Remove only A995/A996/A1293 and their obsolete detail; retain A997 and correct bundle/index counts. Finish: measured dishes read one and whole portions read their count across floor/Sent/course summaries; readiness still follows each surface's existing component rules. The floor counts ready work at each station even if other components there are queued, while Sent's Ready requires all components. Find a bill sorts/pages by the saved count. Normal finish-branch review, push gate and current-head CI remain required.
