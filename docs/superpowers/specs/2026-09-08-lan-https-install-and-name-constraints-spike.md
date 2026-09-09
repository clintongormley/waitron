# LAN HTTPS: installable handheld + name-constrained CA — spike and build definition

**Date:** 2026-09-08
**Status:** Desktop half RUN and PASSED; Android RUN and FAILED (§6, §7) — a user-installed name-constrained root is NOT constrained on Android. iOS still owed. Owner asked for the two open items in
[2026-09-08-handheld-app-store-and-kiosk-findings.md](2026-09-08-handheld-app-store-and-kiosk-findings.md)
§2–§3 to be nailed down. This note turns them into one measured spike and one small build, each
with its failing case stated up front (CLAUDE.md §1). The onboarding design
([2026-08-26-appliance-onboarding-design.md](2026-08-26-appliance-onboarding-design.md) §7–§8, §18)
already decides the two-tier certificate model; nothing here re-decides it.

**Why it matters now.** Most waiters will use their own phones as the handheld (owner, 2026-09-08).
On the free tier that phone must trust the box's private CA before the till is a real installed
app (Chrome's install criteria need HTTPS; passkeys, camera QR scanning and the screen wake lock
need a secure context). Installing a root CA on a personal phone is only acceptable if that root
cannot be used against the phone's other traffic — which is what a name constraint promises, and
what nobody has measured.

---

## 1. What exists today

> **Retired 2026-09-09** by the installable-till + LAN-HTTPS build (§3/§8): the box CA is now
> name-constrained with `pathLen:0` and its leaf SANs are filtered to the permitted set; the trust
> page + CA download are served in all boot modes over a plain-HTTP landing listener (port 80), not
> only setup; and the till now ships a web app manifest (still no service worker). The bullets below
> describe the pre-build state and are kept for the record.


- The box mints a self-signed CA and a leaf for `waitron.local` + its LAN address and serves HTTPS
  from boot (`apps/server/src/self-signed-cert.ts`, onboarding slice 2a). The CA carries **no
  `nameConstraints`** and no `pathLen` (backlog *Debt → Provisioning*, item (a)).
- Setup mode serves a CA download and a trust page that instructs but does not assert trust state.
- The till ships **no web app manifest** and no service worker (`apps/till`, checked 2026-09-08).

## 2. The spike — does a name-constrained root actually constrain?

**Question.** When a root CA carries `nameConstraints` (permitted: `waitron.local`, the box's LAN
IP; excluded: everything else), do the browsers waiters use refuse a leaf for any other name signed
by that same root?

**The failing case, stated first.** If a browser accepts the `example.com` control leaf, name
constraints are NOT honoured on a user-installed root and the "safe to install on your own phone"
argument is false. A run in which both leaves are accepted is the result we are guarding against;
a run in which both are refused means the harness is wrong (the constrained leaf should pass).

**Materials (one script, `openssl`, kept in the repo when the spike lands):**

1. Root CA with `basicConstraints=CA:TRUE,pathlen:0` and
   `nameConstraints=critical,permitted;DNS:waitron.local,permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0`.
   The permitted set is the name plus the three PRIVATE address ranges, not the box's own IP: the
   root is minted once at first boot, before the box knows what address the router will give it,
   and a DHCP change must not force every phone to reinstall a root. The leaf (re-minted at boot)
   carries the box's actual address. A constraint to private ranges still keeps the promise that
   matters — the root can never vouch for any public name or address. (A `permitted` list is
   exclusive by itself; no `excluded` entries are needed. The spike's Leaf B tests exactly that.)
2. Leaf A: `waitron.local` + the box IP in SANs — must be ACCEPTED.
3. Leaf B (control): `example.com` — must be REFUSED.
4. Leaf C (second control, optional): a name inside the permitted set but signed by an
   UNCONSTRAINED root that is not installed — must be refused, proving the harness detects refusal.
5. A local host entry so `example.com` resolves to the box for the test.

**Matrix.** Chrome on Android, Safari on iOS, Chrome on macOS, Safari on macOS, Chromium on Linux
(the box image). Record the browser and OS version for each row.

**Two extra rows the trust flow (§3) depends on:**

- **Click-through detection.** After a user clicks past the browser's "not private" warning, can
  the page tell that the root is NOT trusted? Belief: `navigator.serviceWorker.register()` throws a
  `SecurityError` on an origin with a certificate error in Chrome and Safari, while it succeeds once
  the root is trusted — so a failed registration is the signal. Failing case: registration succeeds
  either way, in which case the page cannot detect it and the instructions must be shown on the
  HTTP page only. Also record whether the click-through is even offered (some managed devices hide
  it).
- **HSTS must NOT be sent on the private-CA origin.** A `Strict-Transport-Security` header removes
  the click-through entirely, which would strand a phone on an error page with no route to the
  instructions. Confirm the box sends none today and pin it with a test.

**What to record per row:** Leaf A accepted? Leaf B refused? With the root NOT yet trusted: is
service-worker registration blocked, does "Install" appear, does `navigator.credentials` work,
does `getUserMedia` work (the onboarding §18 row marked load-bearing)? With the root trusted: does
"Install" appear once the manifest is present, and does the installed app open standalone?
On iOS: was the separate "Enable full trust" step needed, and what does the phone show afterwards?
On Android: the permanent "network may be monitored" notice — present?

**Decision rule.** If every browser in the matrix refuses Leaf B, the free-tier trust step stays
as designed and the CA is name-constrained in the build below. If any browser accepts Leaf B, the
free tier keeps working on shop-owned devices only, and waiters' own phones need the paid-tier
public certificate — or the bring-your-own-domain option in §4 — before go-live.

**Who runs what.** The desktop rows can be run from the development machine (installing a root
into the login keychain / a throwaway Chrome profile — needs the owner's say-so, it changes
system trust). The phone rows need real devices on the shop WiFi and are the owner's.

## 3. The build — an installable till on the LAN (small)

1. **Web app manifest** for the till: `name`, `short_name`, 192 and 512 px icons, `start_url`,
   `display: standalone`, `theme_color`, served from the till's own origin. No service worker is
   required for install (web.dev install criteria; confirmed by the spike's "Install appears" row).
2. **Name-constrain the CA** to `waitron.local` + the box's LAN address, `pathlen:0`. Pre-production:
   regenerate, no migration of existing certs. This is *Debt → Provisioning* item (a).
3. **The trust flow, owner-specified (2026-09-08):**
   - `http://waitron.local` (port 80) never redirects. It serves one page: "you have reached the
     unencrypted address", a download button for the certificate, install steps chosen from the
     device's user agent (iOS: install the profile, then Settings → General → About → Certificate
     Trust Settings → enable full trust; Android: Settings → Security → install a CA certificate;
     macOS/Windows/Linux their own), and a link to `https://waitron.local`.
   - On `https://waitron.local` the app runs the click-through detector (the spike row above). If the
     root is not trusted it shows the SAME instructions page instead of the till, with the link back
     to the HTTP page for the download. Nothing else loads until the check passes.
   - No HSTS on this origin (spike row above).
4. **Screen wake lock** requested while an operator is logged in.
5. **Acceptance (run on a real Android phone and an iPhone on the shop WiFi):** install the CA;
   open the till; Chrome/Safari offer install; the installed app opens standalone with no address
   bar; a passkey login, a QR scan and the wake lock all work; the app survives a reload with the
   operator's state intact.

Sits in the on-prem push under *device onboarding and the three displays*; it is on the critical
path for waiters' own phones and nothing else.

## 4. An option for technical installers — bring your own domain

The paid tier's public certificate needs Waitron Cloud to broker the DNS-01 challenge, which is on
the back burner. A venue that controls a real domain does not need the broker: the box can hold a
DNS-provider API token and complete DNS-01 itself, then serve `<box>.<venue-domain>` with a Let's
Encrypt certificate — no per-phone CA install. **This is NOT the default for non-technical owners**
(owner, 2026-09-08): it needs a domain, a DNS provider with an API, and a token pasted into the
box. It is documented as an option for a technical installer (the deli's own owner is one), and
the private CA with the guided page above stays the default. The box keeps its private CA +
`waitron.local` leaf as the offline fallback either way. The later cloud broker replaces only where
the DNS-01 answer comes from, so the decision is cloud-compatible.

## 6. Desktop spike results — RUN 2026-09-08 (all three engines honour the constraint)

Run on this macOS machine. Root minted per §2 (constrained to `waitron.local` + the three private
IP ranges, **not** the box's own address), one leaf for `waitron.local` (+ a `192.168.1.10` SAN)
that must be accepted, one control leaf for `example.com` that must be refused. The root was added
to the login keychain as an SSL anchor for the test and **removed afterwards** (confirmed absent;
Leaf A stopped verifying once the anchor was gone — the negative control).

| Engine (what uses it) | Leaf A `waitron.local` | Leaf B `example.com` (control) | Reason given for B |
| --- | --- | --- | --- |
| OpenSSL 3.6.3 `verify` (well-formedness) | OK | **REFUSED** | `permitted subtree violation` (error 47) |
| macOS SecTrust — `security verify-cert -p ssl` (**Safari, WebKit, iOS**) | verification successful | **REFUSED** | `CSSMERR_TP_INVALID_CERTIFICATE` |
| Chrome 152 (its own verifier) | page LOADED | **BLOCKED** | net log: `name constraint` |

**Decision rule (§2) on the desktop rows: PASSED.** A user-installed, name-constrained root is
honoured on macOS by both the system evaluator (so Safari and, via the shared Security framework,
iOS Safari — high confidence, not a device measurement) and by Chrome's independent verifier. The
control leaf is refused by all three, and Chrome names the reason as a name-constraint violation.
The build in §3 can constrain the box CA to `waitron.local` + the private ranges with confidence.

**Still owed — the owner's phone rows** (Android Chrome and iOS Safari on the shop WiFi): confirm
the same accept/refuse split on-device, and the install UX (iOS "enable full trust"; Android's
"network may be monitored" notice). The macOS SecTrust pass raises confidence for iOS but does not
replace the on-device check.

**Click-through detection (§3) — NOT measurable headlessly; correction to the plan.** Headless
Chrome offers no "proceed anyway" on a cert error, so the interactive click-through and the
service-worker-registration probe could not be exercised here. More important, an untrusted HTTPS
origin shows the **browser's own full-page interstitial before any of our JavaScript runs**, so the
HTTPS page cannot itself present install instructions to a user who has not already trusted the
root. Consequence for the build: **the instructions must live on the plain-HTTP `waitron.local`
page** (which always loads), and the HTTPS-side detector is only a nice-to-have for users who have
clicked through — measure whether `navigator.serviceWorker.register()` throws in that state on a
real device, but do not depend on it. The `http://waitron.local` landing page (§3, never redirects)
is therefore the load-bearing surface, exactly as the owner specified.

## 7. Android result — RUN 2026-09-08 — the constraint is NOT enforced (design-changing)

Run on one Android phone (Chrome; exact version not captured — **record it next time**) on the shop
WiFi, against this Mac standing in for the box. Clean method: the old root removed, Chrome fully
closed, the root reinstalled, then both URLs opened in a **fresh Incognito tab with no
click-through** (the earlier confound). The box server logged every TLS handshake, so the result is
ground truth, not a read of the address bar:

```
TLS-SNI servername=probe.192-168-10-101.sslip.io -> serving leaf B(control)
HTTPS 192.168.10.242 host=probe.192-168-10-101.sslip.io:8443 / -> 200
```

The phone was served leaf B — a certificate for a name OUTSIDE the root's permitted subtree — and
**completed the connection and loaded the page with a clean padlock.** The positive leaf A also
loaded cleanly. So on Android, a user-installed root is trusted for EVERY name; the `nameConstraints`
extension is not enforced by the Android user-CA trust path that Chrome uses. The same leaf B is
refused by desktop Chrome 152, macOS SecTrust (Safari/iOS) and OpenSSL (§6).

**This falsifies the §3 premise for Android.** "Installing the box's CA on a personal phone is
acceptable because the root is name-constrained" is TRUE on desktop and on Apple platforms and
**FALSE on Android**: the Android install warning ("the certificate owner could access your data …
from websites that you visit") is literally accurate, because Android will not honour the constraint
that was supposed to contain it. Scope: one device, user trust store (the relevant case — that is
where a waiter installs it); Android's incomplete name-constraint enforcement on user roots is
long-standing, so one device is enough to change the decision, but the Chrome/Android version should
be recorded on the next run and an iOS device still measured.

**Decisions this forces (for the owner):**

- **Keep the name constraint in the box CA anyway** — it costs nothing and it DOES contain the root
  on desktop and iOS, and it is correct hygiene. Just do not rely on it for the Android threat model.
- **For a personal ANDROID phone, installing the box CA means broad device trust.** Two ways to live
  with it: (a) treat the box CA private key as high-value (it already lives only on the box; document
  that a leak would let an attacker MITM that phone's other traffic — the protection a constraint
  would have given is absent on Android); or (b) use the **public-certificate path for BYOD Android**
  so no CA install is needed — bring-your-own-domain now (§4), the cloud broker later. Shop-owned
  Android tablets carry the same risk but the venue owns it. iOS BYOD keeps the constraint, so it is
  the lower-risk personal device.
- **This sharpens the owner's 2026-09-08 "most waiters use their own phones" decision:** on Android
  those phones either accept broad trust in the box CA or need the public-cert path. Worth an explicit
  owner call before go-live.

## 5. Provenance

| Claim | Source / status |
| --- | --- |
| Chrome install criteria: manifest fields + HTTPS | <https://web.dev/articles/install-criteria> (read for the findings note, 2026-09-08) |
| Screen Wake Lock needs a secure context; iOS Safari 16.4+ | <https://caniuse.com/wake-lock> |
| Chrome and Safari honour `nameConstraints` on a user-installed root | **MIXED, measured 2026-09-08: TRUE on macOS Chrome 152 + SecTrust (§6); FALSE on Android — the control leaf loaded (§7)** |
| No service worker is required for Chrome install | belief from the same install-criteria page; the spike's "Install appears" row confirms |
| Service-worker registration fails with `SecurityError` on a click-through (untrusted) HTTPS origin | **belief — not measurable headlessly (§6); a real-device row** |
| HSTS disables the interstitial click-through | belief (documented Chrome/Safari behaviour); the spike confirms the box sends no HSTS |

## 8. Inactivity timeout & wake lock — owner addition 2026-09-09

The wake lock (§3.4) is extended with a per-device-profile **inactivity timeout**, set in the
dashboard's device-profile editor:

- A nullable `inactivity_timeout_seconds` column on `device_profiles` (NULL = never). The editor
  works in whole minutes.
- **KDS is exempt**: it holds the wake lock indefinitely (no operator session) and is never
  idle-logged-out; the field is hidden for a `kds` form factor and forced NULL server-side.
- A **session-bearing device** (handheld, counter till) holds the wake lock while an operator is
  logged in and, when its profile carries a timeout, returns to the PIN/lock screen after that long
  with no pointer/key interaction — reusing the existing drop-and-lock logout path. Seeded default:
  handheld profiles 300 s, till/KDS NULL (owner to confirm at review).
- The value rides the existing `GET /api/till` boot payload beside `capabilities`.
- **Schema note:** the column is added via `db:generate:custom` (a hand-written
  `ALTER TABLE … ADD COLUMN`), never `db:generate`, which proposes `DROP TABLE bookings` on the core
  set (CLAUDE.md §6 hazard).
