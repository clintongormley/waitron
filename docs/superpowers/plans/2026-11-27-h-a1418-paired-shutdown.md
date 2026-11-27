# A1418 6C — Checked shutdown with a joined spare and streaming off

[Design §§3–4](../specs/2026-11-07-a1418-box-stop-intent-design.md#3-every-start) · [Slice map, item 6](2026-11-26-h-a1418-box-stop-intent.md)

On a main box with a joined spare and streaming and Cloud off, **Shut down this box** takes and
checks the final backup while leaving the spare on. Sales stop until the main box restarts. The
same section gives administrators the choice to open **Servers** and hand over so the spare can
sell. Handover uses its existing confirmation, transfer and return of records. Keep both boxes
connected for that flow.

The watcher assigned pair work in Lane H `questions.md` on 27 November 2026 at 04:47. This PR
covers pairs without streaming, a topology the two-box handover fixture already exercises.
Paired stream catch-up, spare shutdown and reseeding, Cloud and physical power-off remain later work.

## Build

- In `apps/server/src/admin-shutdown-duties.ts`, allow the existing saved-copy or download check when
  the held chart names this box as main and its only other non-evicted member is a serving spare
  with a local node row, using the same join fact as `start-peer-check.ts`. Apply the same
  eligibility on the protected route and when the drained attempt begins its backup. Keep the
  existing Cloud, stream-settings and local pair-link refusals. Keep Retry, Cancel and the explicit
  unchecked choice. Carry `paired: true` through `box-health.ts` and Dashboard `api/servers-api.ts`
  only for an eligible paired shutdown. This is a topology label and says nothing about reachability.
- In `apps/server/src/boot-peer-check.ts` and `start-peer-check.ts`, pass back one extra fact from the
  existing signed query. A counted, readable, joined spare confirms this box's role only if its
  verified chart matches the held term and body and names this box main and itself spare. Use the
  existing signature verdict before comparing bodies. A superseding chart or operation still wins.
  In `boot.ts`, after the peer check and before any trading starts, consume a shutdown mark if the
  paired proof is positive or the HTTPS peer waiting page admitted an administrator who confirmed
  the other box is off and no recovery is underway. Otherwise retain the shutdown hold. Read the
  outcome of a peer wait as well as the initial answer. Keep the current solo hold and restricted
  starts. If durable mark removal fails, refuse to start.
- In `apps/dashboard/src/screens/box-status-screen.ts`, explain the sales stop and link to **Servers**
  with existing navigation when `paired` is present and the person may open it. Use English and
  Spanish `i18n/strings.ts` and matching Box status guides. Explain that **Hand over the venue**
  keeps the old box connected for the records it returns. Record the outcome and remaining pair
  work, including the spare's recovery-pack offer, in `docs/backlog.md`.

## Focused checks

- `apps/server/src/boot.stop-mark.test.ts` — on a named main with a joined spare and saved folder,
  health offers checked shutdown and the mark waits for the check. A chart-only spare and a
  configured stream still refuse the new path. At restart check a positive peer outcome clears
  the mark, silence leaves a wait, explicit carry-on clears once, and supersession fences first.
- `apps/server/src/boot-peer-check.test.ts` — the signed answer's classifier distinguishes a
  matching chart from a stale, unreadable or unrelated role answer. Exercise the actual signed
  query in the existing `start-peer-check` tests. Keep existing outcomes for ordinary starts.
- `apps/dashboard/src/screens/box-status-screen.test.ts` — a paired idle box shows both choices and
  the handover link navigates without writing. Check both guides and look at the screen in English
  and Spanish, both themes and at phone width.

Run the changed test files red before edits and green afterwards. Rerun the unchanged controlled
handover E2E, fiscal and menu gates, guide guards and scoped typechecks. Estimate 110–180 added
production lines and 170–260 added test lines.
