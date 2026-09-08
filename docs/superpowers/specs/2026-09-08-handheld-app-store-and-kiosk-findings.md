# Handheld — app-store commission, kiosk mode, and HTTPS on the LAN (findings)

**Date:** 2026-09-08
**Status:** Findings from an owner conversation. **Nothing here is committed to build.** It answers
three recurring questions so they are not re-researched, and records the owner's decisions at the
end. Companion to
[2026-08-30-native-app-capabilities.md](2026-08-30-native-app-capabilities.md) (this note closes its
row N5) and to
[2026-08-26-appliance-onboarding-design.md](2026-08-26-appliance-onboarding-design.md) §7–§8, which
already designs the box's own certificate authority and the paid real-cert tier — this note does not
re-decide those, it adds one argument for keeping the private CA as the offline fallback.

---

## 1. Does Apple or Google take a cut of payments taken through a handheld POS app?

**No.** The 15–30 % commission applies to digital goods and services consumed inside the app.
Physical goods and services are the opposite case, and both stores forbid or exempt them from the
store's own billing:

- Apple 3.1.1 makes in-app purchase mandatory when you _"unlock features or functionality within
  your app, (by way of example: subscriptions, in-game currencies, game levels, access to premium
  content, or unlocking a full version)"_. That is why the Kindle app cannot sell ebooks — an ebook
  read in the app is digital content.
- Apple 3.1.3(e): _"If your app enables people to purchase physical goods or services that will be
  consumed outside of the app, you must use purchase methods other than in-app purchase to collect
  those payments, such as Apple Pay or traditional credit card entry."_
- Google Play lists _"Purchases or rentals of physical goods (such as groceries, clothing, home
  appliances, or electronics)"_ and _"Purchases of physical services (such as transportation
  services, airfare, gym memberships, or food delivery)"_ among the cases where Google Play's
  billing system is not required.

A sandwich sold at a counter is physical goods on both stores. Square, SumUp, Toast, Stripe
Terminal and Apple's own Tap to Pay on iPhone all live in the stores with no store commission on
top of the card fee.

**Waitron's shape is the cleanest case.** The handheld sends "charge €X for this order" to our
server; the server drives the card reader over the network (the SumUp Solo path in
[2026-07-30-deli-hardware-design.md](2026-07-30-deli-hardware-design.md) §5). The app is a user
interface for the venue's staff, never a checkout for the app's own user, and never touches card
data.

**Where a cut WOULD appear, and the avoidance:**

- Selling Waitron itself (a venue subscription) inside a store app is a digital service consumed in
  the app → in-app purchase with the cut. Sell it on the web; the app only logs in (the
  Netflix/Kindle shape).
- A digital gift card redeemable for digital goods needs IAP; a deli gift card redeemable for food
  is a voucher for physical goods and is exempt on both stores. Never make one redeemable for
  anything digital in the app.
- Apple 4.2 rejects a store app that is only a website in a wrapper. A native app, if ever built,
  must do something native (the list in
  [2026-08-30-native-app-capabilities.md](2026-08-30-native-app-capabilities.md)).

A venue-owned device can also receive a native app through Apple Business Manager custom apps or
Android Enterprise managed distribution, skipping public review — a distribution choice, not a fee
question.

---

## 2. Kiosk mode without a native app — resolves N5

Kiosk lockdown is a property of the operating system and its device management, not of the app.
Every platform can lock a device to a browser showing one URL. **N5 is not a reason for a native
app.**

| Option | Cost | Survives reboot | Setup by | Notes |
| --- | --- | --- | --- | --- |
| **Linux box + Chromium/Chrome `--kiosk`** | free | yes | us, once (box image) | The node itself, or a second cheap Linux box / Pi with a touchscreen, boots straight into the till page. Entirely ours; no licence, no enrolment. Chromium and Chrome are the same browser with the same kiosk switch; Chrome adds Google's closed pieces (self-update, account sync, DRM, crash reporting) which a till page does not need |
| **Android app pinning** | free | **no** (re-pin after a reboot; I believe — unmeasured) | staff, one tap | Built in. _"When app pinning is on, you need to enter your PIN, pattern, or password before you can unpin."_ Stops leaving the app. Manufacturers' "Lock in Recents" (keeps the app in memory) and "App lock" (PIN to OPEN the app) are different features and do not stop leaving |
| **iOS Guided Access** | free | no | staff, triple-click | _"With Guided Access, you can temporarily restrict your device to a single app."_ Ended with the passcode |
| **iOS Single App Mode** | free from Apple; needs an MDM | yes | admin | Supervised device (Apple Business Manager or Configurator) + MDM; relaunches the app after reboot; can lock to a full-screen web clip with Safari hidden. Standard for iPads as POS terminals |
| **Android Management API (dedicated device)** | Google charges nothing; the CONTROL PANEL is what vendors sell per device | yes | owner, scan a QR | Policy names our web app with `installType: KIOSK` and force-installs Chrome with a URL allowlist. What the QR installs is **Google's** Android Device Policy app on _"a new or factory-reset device"_; needs Google Play services (rules out Fire tablets and some no-name imports — belief, not sourced). "Be our own vendor" = Waitron Cloud holds the control-panel role and mints the QR; our app stays a web page. Waitron Cloud does not exist yet |
| **Fully Kiosk Browser** (Android) | €8.90 once per device list; owner reports ~$3 at volume | yes | owner, install one app + paste the URL | _"one key for 10+ devices"_, keys tied to a device ID, _"customized and white label solutions available"_; **no published reseller terms** — ask before bundling |
| **ChromeOS Flex kiosk** | $25 / device / year (Kiosk & Signage Upgrade) | yes | Google Admin | Installing Flex is free but kiosk needs enrolment, which is the paid upgrade. **Cannot run on the node** — Flex is a whole OS and would replace the Linux that runs Postgres and the server. **Skip** |

**What the web app must do to be a good kiosk citizen** (all web-platform, none native):

- Publish a **web app manifest** (name, 192/512 px icons, `start_url`, `display: standalone`) so
  Chrome offers a real "Install" rather than a shortcut that opens in a tab with the address bar.
  **The till ships no manifest today** (grep of `apps/*` for `webmanifest` / `manifest.json` on
  2026-09-08: nothing). Chrome's criteria also require the page _"Be served over HTTPS"_ — see §3.
- Hold a **Screen Wake Lock** (iOS Safari 16.4+; secure context only).
- Never link off its own origin (an allowlist blocks it anyway).
- Provide its own **staff lock / switch screen with a PIN**, because the OS lock screen is disabled
  under a kiosk lock (the device-enrolment-and-login work covers this).
- Tolerate a reload without losing state (till-follows-the-primary already gives this).

---

## 3. HTTPS on the LAN — public name vs the box's own CA

The onboarding design §7–§8 already decides: free tier = the box mints its own CA and serves
`waitron.local`; paid tier = a real Let's Encrypt cert for `<box-id>.waitron.<tld>` via a
cloud-brokered DNS-01 challenge. This note adds the operational comparison behind it, because the
"why not just a public name?" question will recur.

**How a public name reaches a LAN address:** ordinary DNS — our public zone answers
`<box-id>.venues.waitron.io` with the box's PRIVATE address (192.168.x.y); a phone on the shop WiFi
resolves it through its normal resolver and connects across the LAN; the cert is for the name so
HTTPS is satisfied. Plex's `*.plex.direct` is this pattern (onboarding §18 row: [verify]). Two
catches:

- **It needs the internet to resolve.** Shop line down + a phone whose cached answer has expired =
  the phone cannot find a box a metre away. That is the outage `CLAUDE.md` §5 says must never block
  a sale. A long TTL helps; a box-side DNS handed out by the router is router configuration, which a
  non-technical owner will not do.
- **DNS-rebinding protection** on some routers (Fritz!Box; some business firewalls) refuses answers
  containing a private address. Most Spanish ISP routers do not — an unknown per venue.

**The box's own CA** avoids both: the box is reachable by its fixed LAN address (DHCP reservation,
onboarding §6) and a private CA can put an IP address AND `waitron.local` in one leaf, which no
public CA will do for a private address or a `.local` name. Costs: one root install per device
(Android: "install a CA certificate", then a permanent "network may be monitored" notice; iOS:
install the profile AND separately enable full trust under Certificate Trust Settings — the step
people miss); and installing a root on a waiter's OWN phone is a bigger ask than on a shop tablet.
Name-constrain the CA to the box's own names so it cannot be used against their other traffic
(Chrome and Safari honour name constraints — belief; onboarding §18's browser spike should include
it).

| | Box's own root CA (free tier) | Cloud-issued public cert (paid tier) |
| --- | --- | --- |
| Needs Waitron Cloud | no | yes |
| Per-device setup | install root once | none |
| Works with the internet down | yes | only while the DNS answer is cached |
| Works on waiters' own phones | yes, with the install step | yes, nothing to do |
| Router surprises | none | rebinding protection on some routers |

**Consequence for the paid tier:** the box serves the cloud cert when it has one and keeps its own
CA + leaf as the fallback origin for the offline case — the two are not in conflict, and the free
tier's per-device trust step remains the price of offline reachability, not a stopgap.

---

## 4. Owner decisions (2026-09-08)

- **Kiosk lockdown is OPTIONAL, never required.** The baseline handheld is an installed home-screen
  web app plus the till's own staff PIN, on anyone's phone. Fully Kiosk / managed enrolment are a
  documented option for venues that buy dedicated tablets.
- **Most waiters will use their own phones as the handheld.** Consequences: managed enrolment
  (factory reset) is off the table for them; the app must work equally on iPhone and Android, which
  the web app does and a native app would do twice; a root-CA install on a personal phone is the
  free tier's one real ask, removed by the paid tier.
- **Fully Kiosk at volume (~$3/device, owner's figure) could be resold** — check the reseller terms
  first; none are published.
- **Chromium kiosk on the node** is the cheapest counter till there is (a touchscreen on the box); a
  second counter is a second cheap Linux box imaged the same way. Roadmap for the box image, not now.
- **Android Management API enrolment** is a Waitron Cloud feature for later, not a per-venue
  vendor subscription.

---

## 5. Provenance — external claims (read 2026-09-08)

| Claim | Source |
| --- | --- |
| Apple 3.1.1 IAP scope; 3.1.3(e) physical goods must NOT use IAP | <https://developer.apple.com/app-store/review/guidelines/> |
| Google Play billing not required for physical goods / physical services | <https://support.google.com/googleplay/android-developer/answer/10281818> |
| Guided Access wording, start/end | <https://support.apple.com/en-us/111795> |
| Single App Mode: supervised + MDM, relaunches on reboot, web clip with Safari hidden | <https://www.manageengine.com/mobile-device-management/single-app-mode-ios-devices.html>, <https://support.addigy.com/hc/en-us/articles/4403542477459-Setting-Up-Single-App-Mode-Single-App-Lock-with-Addigy>, <https://support.apple.com/guide/deployment/web-clips-payload-settings-depbc7c7808/web> |
| Android Management API: web app `installType: KIOSK` + Chrome allowlist; Android Device Policy installed on a factory-reset device; needs Play services; API itself free | <https://developers.google.com/android/management/policies/dedicated-devices>, <https://developers.google.com/android/management/provision-device>, <https://blog.cortado.com/en/android-for-work-cost/> (third party, for "free") |
| Android app pinning wording | <https://support.google.com/android/answer/9455138> |
| ChromeOS kiosk web app auto-launch; Kiosk & Signage Upgrade $25/device/year; Flex needs enrolment | <https://support.google.com/chrome/a/answer/9781496>, <https://support.google.com/chrome/a/answer/7613771>, <https://fydeos.io/enterprise-solution/resources/fydeos-vs-chromeos/> (third party, for the price) |
| Fully Kiosk: €8.90 one-time list, volume key for 10+, white-label available, no reseller terms | <https://www.fully-kiosk.com/> |
| Chrome install criteria: manifest fields, HTTPS | <https://web.dev/articles/install-criteria> |
| Screen Wake Lock: iOS Safari 16.4+ | <https://caniuse.com/wake-lock> |

Unsourced beliefs, labelled as such above: app pinning does not survive reboot; Android Management
API needs Play-certified devices; Chrome/Safari honour CA name constraints; which Spanish ISP routers
apply rebinding protection.
