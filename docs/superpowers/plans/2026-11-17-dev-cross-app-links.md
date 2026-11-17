# Development cross-app links implementation plan

**Status:** Draft only; driver checks/commits. Before code, Claude reviews with `~/workspace/tools/claude-seat.sh review-branch` and the watcher clears it. The watcher cleared the development-only /setup/ choice at 01:59 on 17 November (Lane I questions.md); the complete plan still needs Claude review and watcher clearance. No owner design approval is claimed.

**Ask, verbatim (lane I DEV-CROSS-APP-LINKS brief; backlog: `docs/backlog/ci.md`, “Cross-app links in the split Vite dev stack”):**
> "Cross-app links in the split Vite dev stack" in `docs/backlog/ci.md`. `pnpm dev` runs the till on 5190, the dashboard on 5191 (base `/manage/`) and setup on 5192, so a link to `/manage/devices` from the till's dev server gets the till's page. Make each dev server pass the other apps' paths on to the right dev server (for example the till's Vite proxy sends `/manage` to the dashboard's), honouring the `WAITRON_*_VITE_PORT` overrides, with a test beside `scripts/dev-proxy-config.test.ts`. Show the wrong page first with `curl` against the running dev stack, then the right one after. Cover setup's existing links too. Delete the entry when done.

**Outcome/reuse:** Existing links and destination modules reach the correct app. Reuse `devPort`, `devServerProxy`, Vite proxy/`bypass` options and config-import tests; no framework/dependency.

**Routing decisions to review before building:**
- Till/setup proxy bounded `/manage` to dashboard, including `/manage/` module resources. Normalize bare `/manage` to `/manage/`; never match `/management-api`.
- Dashboard/setup redirect exact `/` and bounded `/tabs` to till through proxy bypass, keeping path/query. Till's unprefixed `/src`, `/@vite/client`, `/@fs` and optimized imports then use its own origin.
- Till/dashboard likewise redirect `/handover/emergency` and `/handover/:operationId` to setup; `apps/setup/src/main.ts` already selects these pages.
- Per watcher 01:59, move setup's development base/advertised entry to `/setup/`; preserve `base: "./"` for builds. Till/dashboard forward the setup app's paths/assets there; on the setup server exact `/` redirects to the till, preserving the existing done-screen href. Update the repository's printed URLs/tests only; no `~/workspace/tools` edits.
- Proxy setup's existing `/setup/trust`, `/setup/connection` and linked `/ca.crt` to the box (`discovery-api.ts`, `connection-bootstrap.ts`). Box rules precede app rules; `/setup-api` remains an API.

**Exact change set:**
- Code: `scripts/dev-server-proxy.ts`; `apps/till/vite.config.ts`, `apps/dashboard/vite.config.ts`, `apps/setup/vite.config.ts`.
- Tests: modify `scripts/dev-proxy-config.test.ts`; add `scripts/dev-cross-app-links.test.ts` beside it; extend `apps/server/scripts/dev-setup.test.ts` and `apps/server/scripts/dev-onboard.test.ts` for printed URLs.
- Support: `apps/server/scripts/dev-setup.ts`, `apps/server/scripts/dev-onboard.ts` (printed setup entry only).
- Docs: this plan; `docs/developers/workflow-guide.md` (dev entry/routing); delete the completed cross-app entries from `docs/backlog/ci.md` and `docs/backlog.md`.

**Implementation and focused verification, after review/clearance:**
1. Reproduction already observed in `receipts/dev-cross-app-links-20261117/curl-before.json`; use the driver's OWN `wa-wt demo waitron-fix-dev-cross-app-links` stack; get ports from `wa-wt ls`. Save `curl -fsS -H 'Accept: text/html' "http://localhost:$TILL_PORT/manage/devices"` showing `Waitron Till`, plus the dashboard-port control showing `Waitron Dashboard`. This drafting session leaves that process untouched.
2. TDD: add assertions; run `pnpm exec vitest run scripts/dev-proxy-config.test.ts scripts/dev-cross-app-links.test.ts`; observe missing-routing failures, implement, then rerun to a printed passing count.
3. Deliberately replace **all proxies target the box** assertions in the root suite's shifted-stack and HTTP/HTTPS inventory cases with box/app assertions. Retain existing box targets, leaf-dependent HTTP/HTTPS, HTTPS `secure: false`, invalid-port refusal and strict listeners.
4. Test defaults 5190/5191/5192/8080 and overrides 5290/5291/5292/8180; restore environment. Assert bare `/manage`, queries, boundaries, local ownership, redirects and emitted scripts/transitive imports. Cover setup's `/`, `/manage`, `/manage/email`, `/manage/opening-hours/view/year`, `/manage/backup`, trust/connection/download and handover links.
5. TDD for printed URLs: `pnpm --filter @waitron/server exec vitest run scripts/dev-setup.test.ts scripts/dev-onboard.test.ts`. After Vite reload, repeat the same OWN-stack curl/control expecting dashboard HTML; curl setup destinations and fetch entry scripts/transitive imports, checking app identity and content type. Keep before/after receipts untracked.
6. Update named docs/backlog after verification. Normal hook/scoped CI and later `finish-branch` Claude review apply; no whole-workspace local run solely for finishing.

**Exclusions:** App hrefs/source behavior, deployed routes, API semantics and existing `/api`, `/help`, `/legal`, `/media` box behavior; no new framework, protocol or speculative rewrite layer.
**Estimate (changed lines, additions + deletions):** code 80–110; tests 140–180; support 10–20; docs 45–60; total 275–370. Stop for watcher direction before a material departure or exceeding 555 total (1.5× upper estimate); another read only as campaign rules permit.
