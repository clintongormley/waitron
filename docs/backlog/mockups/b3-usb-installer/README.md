# B3: approved design, six-slice plan and settled unlock policy

[Design](../../../superpowers/specs/2026-10-21-b3-usb-installer-design.md) ·
[Plan](../../../superpowers/plans/2026-10-26-b3-usb-installer.md) ·
[Owner-decision FYI](question.txt)

The owner approved the design with changes on 26 October: no setup codes or new private setup
continuation grants; the disk key on every later recovery sheet; and a Waitron recovery screen
on the box and over the network. Prepare runs on the same box, then a freshly authenticated
admin saves allowed configuration and starts fresh Live setup without reinstalling the system.
No practice sale, invoice number, chain or database crosses. Planning is authorised; building
still needs its own go-ahead. The owner's ~13:45/~14:00 CET answers settle unlock reachability
and normal Wi-Fi copying; the earlier A/B/C picker is superseded. The protected disk-key delivery
remains separate from public setup, with no new sign-in or first-claim authority.

While locked, HTTP `waitron.local` redirects directly to the trusted per-disk HTTPS unlock URL.
HTTPS `waitron.local` uses a deliberately untrusted redirect-only certificate, not signed by the
box CA. The owner accepts that one warning solely to reach the redirect; no key form appears there.
You enter the key only locally or at the verified trusted recovery hostname. The full URL and
fingerprints stay on the sheet. Normal server certificate/key and CA signing key stay encrypted;
the separate recovery leaf private key stays outside encryption.

The normal Wi-Fi SSID/password and only necessary join fields may be copied unencrypted to boot.
Someone holding the box can extract them; the operator guide must tell the venue to change its
Wi-Fi password after theft. The running host updates the fixed minimal copy on every Wi-Fi change,
removes it for cable-only, and durably cleans obsolete copies without changing measured boot bytes
(design §7.5's proposed contract). Stale/missing/corrupt/unjoinable copies or interrupted updates
fall back to cable/local display; no separate recovery SSID, unlock hotspot or guaranteed wireless
reachability. Shared 2/4/8/16/32/60-second backoff, cap 60 and reboot reset remain the plan proposal,
not an explicit numeric owner choice.

Actual Android Chrome controls are **UNVERIFIED / NOT RUN**. Commit
`75f17f9e36125af3a620266a584507420e7197de` records one 2026-09-08 Android outside-subtree
acceptance, with no captured versions. It does not establish hostname-mismatch behavior or a
current-device pass. Design §7.5/plan 6.1 hold the affected trust design/release for real-device
hostname/CA-subtree negatives and a correct-name positive on the same build with explicit trust.
The accepted redirect-only warning is separate; failed controls cannot be waived silently.

[Updated unlock views](unlock-policy-2026-10-26/) cover pictures 6, 9 and 12 in English and Spanish,
light and dark, at 390 and 1280 px. The [other approved views](approved-2026-10-26/) retain their
existing content; pictures 6, 9 and 12 in that older set are superseded by the updated set. They are illustrations rendered from HTML with the real theme tokens. They demonstrate
the proposed layout, not Linux startup, certificate trust or a working unlock service. Picture
12 depicts the state after identity verification; new-device trust and real phones need the
qualification specified in design §7.5. Three new primary-source bounds and a four-handshake
Node TLS probe do not establish that qualification. The updated views show the redirect-only
warning exception, trusted key-entry address and normal Wi-Fi copy with theft guidance. They
are documentation illustrations; no real recovery or Android check is depicted as passing.

| Picture | Current content |
| --- | --- |
| 1 · `1-unattended-install.png` | Installer status, verified release and 60-second erase wait; no setup-code wording. |
| 2 · `2-existing-box.png` | Existing Waitron box starts after 15 seconds unless a keyboard choice opens reinstall. Unchanged. |
| 3 · `3-no-network.png` | Installer-only open network and progress. Unchanged; preboot joins normal Wi-Fi from the minimal boot copy or uses cable/local display. |
| 4 · `4-installing-done.png` | USB removal is mandatory before restart, including firmware that ignores boot order. |
| 5 · `5-box-screen.png` | Setup without a code, then a local-screen till card with ordinary manager acceptance. |
| 6 · `6-stick-and-disk.png` | Stick contains no codes/keys; retained disk key stays encrypted. Separate boot Wi-Fi copy, physical extraction and theft/password-change guidance. |
| 7 · `7-till-and-dashboard.png` | Sign out when switching between till and dashboard. Unchanged. |
| 8 · `8-box-settings.png` | Separate time-zone choice; later maintenance feature stays outside this six-slice plan. Unchanged. |
| 9 · `9-recovery-key.png` | Every later sheet, correct-disk restore/spare page and local Waitron unlock, with startup warning. Full URL/fingerprints retained; HTTP/HTTPS redirect routes and trusted-only key entry. |
| 10 · `10-setup-modes.png` | No setup code; blank-stick and production mode rules remain distinct. |
| 11 · `11-q2-practise.png` | Same-box action, fresh admin proof before removal, open fresh-Live continuation and no second erase. |
| 12 · `12-network-unlock.png` | Proposed trusted network form and retained shared-delay proposal, after peer identity verification. Normal Wi-Fi/cable discovery and the redirect-only warning are separate from verified key entry. |

Root picture names show Spanish/light/1280 px. The matching eight variants of each changed view
are in the corresponding view directory. No real disk key appears in these illustrations.

[Pictures before this approval](superseded-before-approval-2026-10-26/) retain the old root views.
The [earlier 26 October revision](revision-2026-10-26/) is historical: its old setup-code and
private-continuation views are superseded, while picture 8 remains applicable. The
[21 October set](superseded-2026-10-21/) also remains historical. Unchanged views above retain
the original design’s other decisions.
