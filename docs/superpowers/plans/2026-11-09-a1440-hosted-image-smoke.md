# A1440: keep image smoke on GitHub

**Ask and authority:** watcher, 2026-11-09 08:20, Lane I questions.md:
“image smoke always runs on GitHub's machines, until a guest is proven to run it.”
The same note parks A1454 with six slots retained. Claude read the initial plan
in 216 seconds; findings and triage are in
`~/waitron-campaign-i/receipts/a1440-hosted-image-20261109/`.
**Build approval:** watcher, Lane I questions.md, 2026-11-09 08:52:
“Approved as planned: the six files, the stricter hosted checks replacing image's
server-label checks, the exact-candidate manual image run before landing, and the
dated A1454 backlog line. … Build, finish, land”. The watcher's 08:53 follow-up
requires the manual main run immediately after landing and says to report any
unrelated failure without rerunning it.

**Outcome:** retain every image check, run it on GitHub, and stop assigning it to
unqualified guests. Retained logs for nightly42550200310 and PR2543/run42525659420
both fail Bluetooth step27 with `dbus_unreachable`. The nightly's ssh2 optional
binding compiler error ends in `Done` before later image-build success; it is not
the reported failing step. See `failure-evidence.md` beside the review.

**Files and size:** configuration one changed line; runtime code zero; tests about
5–12 changed lines; existing docs about15–30 changed lines, plus this plan.

| File | Change |
| --- | --- |
| `.github/workflows/image-smoke.yml` | Literal `jobs.smoke.runs-on: ubuntu-latest`; keep declared `server_route` input and caller unchanged. |
| `scripts/ci-server-first.test.mjs` | Assert image's route is literal `ubuntu-latest`; add image to the hosted exception list and exclude it from the ordinary-rerun server list. Preserve all other checks. |
| `docs/developers/ci-and-gates.md` | Image always hosted; retained input unused for placement; remove current image-key and guest-activation requirements. |
| `docs/backlog.md` | Network-step bundle: hosted image exception, A1454 parked. |
| `docs/backlog/ci.md` | Same bundle and hosted list; retain guest investigation and unfinished routing. Add dated pointer to the A1454 parking decision. |
| `docs/superpowers/plans/2026-11-09-a1440-hosted-image-smoke.md` | This plan. |

**Build after approval:**

1. Add the literal assertion and two exception-list edits first. Run
   `pnpm exec vitest run scripts/ci-server-first.test.mjs`; observe failure because
   image still has the self-hosted expression. These changes replace image's
   server-label and ordinary-rerun assertions with strict hosted assertions;
   the existing event/attempt matrix still checks hosted placement.
2. Make the one-line workflow edit and named prose changes; rerun that suite.
   Restore the old routing line in a disposable copy and observe the guard fail,
   as the campaign's guard-deletion rule requires. Keep the feature tree intact.
3. Run `finish-branch`: Claude run-it, signed-off commits, normal push hook and
   required exact-head CI. Name changed checks in the PR. Ordinary PR CI skips
   image for these paths, so also dispatch `image-nightly.yml` on this branch and
   require its hosted smoke job to pass at the exact candidate before landing.
4. Land under `main.lock` with `land-branch`. The nightly failure rule requires
   `gh workflow run ci.yml --ref main`; read its result. Require `image / smoke`
   success on a GitHub runner, handle any other failure under the shared rule,
   and report result/source/runner to lane E and the watcher.

**Leaves out:** guest qualification or cause fixes, capacity changes, new controls,
credentials or further A1454 measurement. No extra files without approval.
**Finish line:** exact-head checks and hosted image smoke pass, correction is on
main and its manual full CI follow-up has been read. No guest repair is claimed.
