# LAN HTTPS: installable handheld + name-constrained CA — spike and build definition

**Date:** 2026-09-08
**Status:** Defined, not run. Owner asked for the two open items in
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
   `nameConstraints=critical,permitted;DNS:waitron.local,permitted;IP:192.168.1.10/255.255.255.255,excluded;DNS:.,excluded;IP:0.0.0.0/0.0.0.0`
   (the exact permitted IP is the box's; the exclusions close everything else).
2. Leaf A: `waitron.local` + the box IP in SANs — must be ACCEPTED.
3. Leaf B (control): `example.com` — must be REFUSED.
4. Leaf C (second control, optional): a name inside the permitted set but signed by an
   UNCONSTRAINED root that is not installed — must be refused, proving the harness detects refusal.
5. A local host entry so `example.com` resolves to the box for the test.

**Matrix.** Chrome on Android, Safari on iOS, Chrome on macOS, Safari on macOS, Chromium on Linux
(the box image). Record the browser and OS version for each row.

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
3. **Trust flow reachable from the till's origin**, not only setup mode: a phone is pointed at the
   till URL first; the "install our certificate" page and the CA download must be one tap away from
   the till's own error/landing state, with the iOS "Enable full trust" step spelled out.
4. **Screen wake lock** requested while an operator is logged in.
5. **Acceptance (run on a real Android phone and an iPhone on the shop WiFi):** install the CA;
   open the till; Chrome/Safari offer install; the installed app opens standalone with no address
   bar; a passkey login, a QR scan and the wake lock all work; the app survives a reload with the
   operator's state intact.

Sits in the on-prem push under *device onboarding and the three displays*; it is on the critical
path for waiters' own phones and nothing else.

## 4. An option to keep in view — bring your own domain

The paid tier's public certificate needs Waitron Cloud to broker the DNS-01 challenge, which is on
the back burner. A single venue that controls a real domain does not need the broker: the box can
hold a DNS-provider API token and complete DNS-01 itself, then serve `<box>.<venue-domain>` with a
Let's Encrypt certificate — no per-phone CA install. The box keeps its private CA + `waitron.local`
leaf as the offline fallback exactly as the findings note §3 describes for the paid tier. Worth a
half-day design if the spike's decision rule comes out badly, or if the deli would rather skip the
per-phone install. The later cloud broker replaces only where the DNS-01 answer comes from, so the
decision is cloud-compatible.

## 5. Provenance

| Claim | Source / status |
| --- | --- |
| Chrome install criteria: manifest fields + HTTPS | <https://web.dev/articles/install-criteria> (read for the findings note, 2026-09-08) |
| Screen Wake Lock needs a secure context; iOS Safari 16.4+ | <https://caniuse.com/wake-lock> |
| Chrome and Safari honour `nameConstraints` on a user-installed root | **belief — the spike measures it** |
| No service worker is required for Chrome install | belief from the same install-criteria page; the spike's "Install appears" row confirms |
