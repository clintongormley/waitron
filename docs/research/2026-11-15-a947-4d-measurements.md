# A947 4d: reaching the switch — the lane's browser measurements, and the owner's checklist

Task 8 of [the 4d plan](https://github.com/clintongormley/waitron/blob/0baa2c3869d2a4b5e4f7e632c081ad0b8da7a2ec/docs/superpowers/plans/2026-11-15-a947-4d-reach-the-switch.md). Two parts:
what the lane measured in a browser on the Mac on 15 November 2026, and the checks only the owner
can run, on the venue's own tills and phones.

## What the lane measured

**Set-up.** Playwright 1.65.0's Chromium 158.0.8127.18 on macOS, run by a throwaway probe kept
outside the repository (`~/waitron-campaign/a947-4d-measure/probe.mjs`; its full output is
`run1/result.txt` beside it). The probe makes a throwaway certificate authority and one
certificate for `waitron.local` and `box-abcd.waitron.local`, serves both names from one HTTPS
server on this Mac, and starts Chromium with `--host-resolver-rules` sending both names to that
server and `--ignore-certificate-errors-spki-list` naming that certificate's key, so the browser
treats the certificate as trusted rather than skipping a warning. Passkeys come from Chrome's
virtual authenticator. The server listened on port 8443, because macOS refused port 443 to a
non-root process (`listen EACCES: permission denied 127.0.0.1:443`); the port changes the
addresses' text (`https://waitron.local:8443`) but not which names count as one site, nor a
passkey's relying-party name, which carry no port.

```sh
node ~/waitron-campaign/a947-4d-measure/probe.mjs <new-empty-folder> 8443
```

### The device cookie crosses to a server's own name only when it names the venue's domain

The cookie carries the attributes `setDeviceCookie` gives the device cookie
(`apps/server/src/device-session.ts:62-77`): `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, a
year's `Max-Age`, and a `Domain` only when `cookieDomainFor` returns one. Before the run, the failing
case was written down as: the request to `box-abcd.waitron.local` arrives with an empty cookie
header.

| Cookie set at `https://waitron.local` | Opening `box-abcd…` | A request from a `waitron.local` page to `box-abcd…` (`credentials: "include"`, as the till sends) | `waitron.local` → `box-abcd…` → `waitron.local` redirects |
| --- | --- | --- | --- |
| `Domain=waitron.local` | sent | sent | sent at all three steps |
| no `Domain` (the control) | not sent | not sent | sent only at the two `waitron.local` steps |

So a device cookie scoped to `waitron.local` reaches a server's own name, in a request, a page
opened there and across redirects in both directions; one with no `Domain` stays with the name that
set it.

**Which of the two a box sets today.** `cookieDomainFor` returns a domain only when
`WAITRON_VENUE_DOMAIN` is set (`apps/server/src/config.ts:272-283`, `device-session.ts:48-56`). The
box image sets `WAITRON_MANAGEMENT_RP_ID` and `WAITRON_MANAGEMENT_ORIGIN` but not
`WAITRON_VENUE_DOMAIN` (`deploy/Dockerfile:318-329`), nor does `deploy/compose.yml`'s environment,
and `git grep -n VENUE_DOMAIN -- ':!docs'` on `main` at 4f51f11430 finds it read only in
`config.ts` (plus a rename table in `scripts/a1308/rename-tenant.mjs`). So, by reading, a box today
sets the second row's cookie, though `config.ts:100-104` says the variable exists "so one credential
reaches every one of the venue's servers after a promotion". The till sends its requests to the
address its router has chosen (`withServerTarget`, `apps/till/src/api/server-router.ts:466-478`).
Whether that address is ever a server's own name for a till opened at `waitron.local`, and so
whether a till would arrive there without its device cookie, was read, not run; the two-box
rehearsal or a test on the router would settle it. The question is with the watcher.

> **Pointer, 2026-11-15.** The router does move a till opened at
> `waitron.local` to a server's own name (the case "follows the promoted box at its own name, then
> back to the page when the page answers as it" in `apps/till/src/api/server-router.test.ts`), and
> the box image now sets `WAITRON_VENUE_DOMAIN=waitron.local` (`deploy/Dockerfile`), so a box sets
> the first row's cookie.

### A passkey made at the venue's name works at a server's own name, and only when that server is listed

Before the run, the failing case was written down as: the browser refuses with a `SecurityError`,
or the check refuses with "Unexpected authentication response origin".

1. A passkey made at `https://waitron.local:8443` for the relying party `waitron.local` passed
   `@simplewebauthn/server` 14.0.3's registration check (the version `packages/identity` uses).
2. **Control:** at `https://box-abcd.waitron.local:8443`, asking for the relying party
   `other.local` was refused by the browser: "SecurityError: The relying party ID is not a
   registrable domain suffix of, nor equal to the current domain."
3. At the same page, asking for `waitron.local` answered, and the answer names the page it came
   from: `https://box-abcd.waitron.local:8443`.
4. That answer passed the check with the list `venuePasskeyOrigins`
   (`apps/server/src/passkey-origins.ts`) gives when the server chart lists `box-abcd`
   (`["https://waitron.local:8443", "https://box-abcd.waitron.local:8443"]`), and was refused with
   the box left out: "Unexpected authentication response origin
   "https://box-abcd.waitron.local:8443", expected one of: https://waitron.local:8443".

The check in step 4 calls the library directly with that list, as `packages/identity/src/passkey.ts`
passes it (`expectedOrigin`, `:309`); the server's own routes were not run here (#3347's tests run
them in Node).

### Not measured here

- **A page whose certificate is not trusted (the owner's question 5).** The probe also opened
  `box-abcd…` in a browser told to ignore certificate errors, and a passkey could be made there.
  That says nothing about a phone showing a certificate warning: Playwright's setting removes the
  error inside the browser, which a person tapping past a warning does not. Only the owner's phones
  answer it.
- Safari, Firefox, Android, iOS, the venue's tills, real authenticators, and names found over the
  network (both names were mapped to this Mac by a browser flag).

## What the owner checks on the venue's tills and phones

For each till model the venue uses, one iPhone and one Android phone. Both boxes running, the spare
joined; `<id>` is a box's id as its label shows it.

1. **Two-part names.** Open `https://box-<id>.waitron.local` for each box. Does it open?
2. **The main box dies.** With a till open at `https://waitron.local`, pull the main box's power.
   How many seconds until a reload of the till shows the switch page? Plug it back in: how many
   seconds until a reload reaches the main box again?
3. **Across the take.** Start a switch from a page opened at `https://waitron.local`. Does the page
   keep working while the spare restarts to take over?
4. **A passkey at each way in.** Sign in with a passkey at `https://waitron.local`, at the address
   on the switch label, and, on a phone, with the phone's own passkey after scanning the label.
5. **No certificate installed.** On a phone that has not installed the venue's certificate, scan
   the label. Does the page open, and does a passkey work? The answer decides whether the guide asks
   managers to install the certificate on their phone at `/setup/trust`.
6. **The device sign-in across the switch.** Enrol a till at `https://waitron.local`, switch to the
   spare, and check the till still works at the spare's own name without being enrolled again.

Write each answer, with the device and its system version, under this list.
