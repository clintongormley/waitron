# Factory reset — design note (onboarding slice 4c, DESIGN-ONLY, not built)

> **Nothing here is implemented.** Slice 4c ships the *admin-credential* break-glass (an on-box
> `waitron-break-glass` CLI that resets a locked-out admin's password/PIN with **no chain impact**).
> A **factory reset** is the separate, nuclear option, and spec §12 is explicit: *"Design the
> credential-reset break-glass; do not make factory-reset casual."* This note records that design so a
> future firmware slice can build it correctly — and, more importantly, records **why it must never be
> easy to reach.**

## What a factory reset is, and why it is not break-glass

Break-glass (built, 4c) resets a credential and **preserves the fiscal chain** — the box keeps its
tenant, its SIF, and its `registros_facturacion` / `cadenas` history; only the admin's login secret
changes. It is safe to run whenever an operator is locked out.

A factory reset wipes the box and **re-provisions from scratch**. That is **chain-destructive** and
**irreversible**:

- Re-provisioning mints a **fresh SIF and a fresh installation number** and starts a **new hash chain**
  (`registerSif` — the same machinery the cold-restore runbook uses). The old chain is stranded.
- Any records the old chain **filed with AEAT but that are wiped locally** become **locally
  unverifiable** — the box can no longer produce the hash predecessors AEAT holds. Unlike a cold
  restore (which *restores* the ledger and only mints a fresh chain forward), a factory reset
  *discards* the ledger. There is no undo (fiscal §5: `registros_facturacion` is append-only and
  hash-chained; a chain thrown away cannot be reconstructed).

So a factory reset is the correct action only for a genuinely disposable box — a demo/preproduction
box being recycled, or hardware leaving service whose data is provably captured elsewhere — and is
**never** a troubleshooting step, never a way out of a lockout (that is break-glass), and never
reachable from the normal operator UI.

## Mechanism (parked with the firmware slices 5–7)

The router-style options in spec §12/§17 are all **firmware-dependent**, which is why this is
design-only until the appliance-image slices:

- **Recovery-boot / held-button** — a bootloader or GPIO path that wipes the data volume before the
  app starts. Needs the OS image (slice 6) and hardware GPIO (slice 5). Preferred long-term: it works
  even when the app will not boot.
- **On-box console command** — a `waitron-factory-reset` CLI, the same physical-shell gate as
  break-glass. Buildable without firmware, but deliberately **not** built in 4c so that a
  chain-destructive action does not ship alongside the safe credential reset and get run by reflex.

## Guard-rails a future factory-reset MUST carry

Whichever mechanism ships, it must:

1. **Name the consequence in a typed confirmation.** Not `--yes` / a single keypress — the operator
   types back a phrase that states what is destroyed (e.g. the tenant's NIF + "destroy the fiscal
   chain"), so the action cannot be taken without reading it. Router-style "hold for 10 seconds" is
   acceptable *only* as the hardware path where a typed prompt is impossible, and even then the app
   must refuse to re-provision silently.
2. **Warn loudly and specifically** that filed-but-wiped records become unverifiable, and that this is
   irreversible — distinguishing it in words from break-glass ("this does NOT just reset a password")
   and from cold restore ("this does NOT restore your data — it destroys it").
3. **Never be reachable from the normal UI** — no dashboard button, no setup-wizard step. It lives
   only behind the physical/recovery gate.
4. **Refuse on a `production` box unless the operator additionally attests the box is being disposed
   of** — the same care the disposal design (`promotion-failover-and-node-lifecycle` §5.1) applies to
   *voluntary* retirement. A production chain is never discarded casually.
5. **Emit a durable, attributable record** of the reset. (Note the gap: the shipped break-glass CLI
   only prints a `break-glass: reset admin <id> …` line to **stdout** — it is a console tool, not an
   HTTP route with the server's structured `Logger`, so there is no queryable audit row today. A
   factory reset — more destructive still — should do at least as much, and a durable admin-action
   audit trail is a worthwhile follow-up for both.)

## Cross-references

- Break-glass (built, 4c): `break-glass-command.ts` / `waitron-break-glass`; spec §12/§17 resolution.
- Cold restore (a *restore*, not a factory reset): the runbook explicitly says "It is not a factory
  reset" — `docs/superpowers/plans/2026-08-30-onboarding-slice4b-iii-cold-restore-runbook.md`.
- Disposal guard (design-only, *voluntary* retirement): `promotion-failover-and-node-lifecycle` §5.1.
- The fresh-chain machinery a factory reset would invoke: `registerSif` / `provisionNode`.
- Fiscal invariants: `CLAUDE.md` §5 (`registros_facturacion` append-only; a wrong/destroyed chain
  stays wrong).
