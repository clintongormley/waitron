# Later and parked — detail

The open entries are listed in [the backlog](../backlog.md), under "Later and parked". This file holds
their full text.

## Later and parked

**Later and parked** (no owner decision pending; reopen when work reaches them): Square and
generic CSV menu import · accounting export (SP17) · opening hours and channel sync (SP19) ·
per-seat ordering and multiple tabs per table (each reopens a
settled decision — specced with the owner, never landed unattended) · KDS ops polish (routing
audit view, station kind, definable kitchen statuses) · customer-facing menu browse · inventory and
procurement (SP20; the AI forecast waits for the deterministic system) ·
**Bizum** (research in
[2026-09-18-online-payment-providers-bizum.md](../research/2026-09-18-online-payment-providers-bizum.md)).
A Bizum payment costs a FLAT per-payment fee, not a percentage, so a provider that passes the
acquiring cost through and marks it up thinly (Mollie, Sipay) beats one charging a percentage on top
(Stripe at 1,5 % + 0,25 €, MONEI); SumUp offers Bizum on none of its plans. **To close:** a written
quote from Mollie and one from the deli's bank (the pass-through figures that would decide it are
unpublished); and, for in-person Bizum, confirm whether a SumUp or Stripe Tap-to-Pay phone can accept
a Bizum tap before designing any UX.

## A1507. Google sign-in, built in, through one Waitron-owned Google setup

Not a go-live requirement (owner, 2026-11-11: "Move google signin to the backlog, with the intention
of doing it with a single key via waitron, but this is definitely not a go live requirement").
It replaces A646's optional Google module, where each venue would have entered its own client ID and
secret.

The intent: Waitron holds one Google sign-in client, in Cloud; Google returns every person to one
Cloud page, and the box trusts Cloud's signed answer about who signed in. This is A1437's choice 7a
(owner, 2026-11-09, in the [A1437 design](../superpowers/specs/2026-11-09-a1437-dashboard-sign-in-rules-design.md)),
which none of A1437's five pull requests builds. It has a box half (this repository) and a Cloud half.

What it rests on, read 2026-11-11, not tried:
- Today the box asks Google to return the person to its own address plus
  `/management-api/google/callback` (`apps/server/src/config.ts`, `googleOidc.redirectUri`), from
  `WAITRON_GOOGLE_CLIENT_ID` and `WAITRON_GOOGLE_CLIENT_SECRET`. Google's
  "Redirect URI validation rules" say "Host TLDs (Top Level Domains) must belong to the public suffix
  list" and forbid wildcard characters; the public suffix list has no `local` entry (checked
  2026-11-11 against publicsuffix.org's list, which does list `com` and `io`). So Google cannot
  return anyone to a box's `.local` address, whoever owns the client.
- A Google account signs in only a person who already linked it from their profile, by Google's
  account number (`loginWithGoogle` in `packages/identity/src/google-oidc.ts`), so being always
  available lets nobody new in.

Known costs: Google sign-in works only for a Cloud-connected venue with internet (password and
passkey sign-in do not depend on it); the secret stays in Cloud, never on a box; if Google blocks
Waitron's client, Google sign-in stops at every venue at once; Waitron owns the Google app and its
consent screen, and whether Google's app verification applies to basic sign-in is unchecked.
A venue without Cloud gets no Google sign-in (the low-priority entry left by A1437).

