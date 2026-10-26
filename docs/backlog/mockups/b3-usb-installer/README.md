# B3: approved design, six-slice plan and recovery choice

[Design](../../../superpowers/specs/2026-10-21-b3-usb-installer-design.md) ·
[Plan](../../../superpowers/plans/2026-10-26-b3-usb-installer.md) ·
[One remaining question](question.txt)

The owner approved the design with changes on 26 October: no setup codes or new private setup
continuation grants; the disk key on every later recovery sheet; and a Waitron recovery screen
on the box and over the network. Prepare runs on the same box, then a freshly authenticated
admin saves allowed configuration and starts fresh Live setup without reinstalling the system.
No practice sale, invoice number, chain or database crosses. Planning is authorised; building
still needs its own go-ahead. Only the proposed unlock reachability/connection/attempt policy
awaits the owner’s choice. The protected disk-key delivery remains separate from public setup.

[Current views](approved-2026-10-26/) cover English and Spanish, light and dark, at 390 and
1280 px. They are illustrations rendered from HTML with the real theme tokens. They demonstrate
the proposed layout, not Linux startup, certificate trust or a working unlock service. Picture
12 depicts the state after identity verification; new-device trust and real phones need the
qualification specified in design §7.5. Three new primary-source bounds and a four-handshake
Node TLS probe do not establish that qualification.

| Picture | Current content |
| --- | --- |
| 1 · `1-unattended-install.png` | Installer status, verified release and 60-second erase wait; no setup-code wording. |
| 2 · `2-existing-box.png` | Existing Waitron box starts after 15 seconds unless a keyboard choice opens reinstall. Unchanged. |
| 3 · `3-no-network.png` | Installer-only open network and progress. Unchanged; recovery networking is a separate choice. |
| 4 · `4-installing-done.png` | USB removal is mandatory before restart, including firmware that ignores boot order. |
| 5 · `5-box-screen.png` | Setup without a code, then a local-screen till card with ordinary manager acceptance. |
| 6 · `6-stick-and-disk.png` | Stick contains no codes/keys; retained disk key stays inside encryption, outside venue backups. |
| 7 · `7-till-and-dashboard.png` | Sign out when switching between till and dashboard. Unchanged. |
| 8 · `8-box-settings.png` | Separate time-zone choice; later maintenance feature stays outside this six-slice plan. Unchanged. |
| 9 · `9-recovery-key.png` | Every later sheet, correct-disk restore/spare page and local Waitron unlock, with startup warning. |
| 10 · `10-setup-modes.png` | No setup code; blank-stick and production mode rules remain distinct. |
| 11 · `11-q2-practise.png` | Same-box action, fresh admin proof before removal, open fresh-Live continuation and no second erase. |
| 12 · `12-network-unlock.png` | Proposed encrypted network form and shared wrong-key delay, after peer identity verification. |

Root picture names show Spanish/light/1280 px. The matching eight variants of each changed view
are in the current-view directory. No real disk key appears in these illustrations.

[Pictures before this approval](superseded-before-approval-2026-10-26/) retain the old root views.
The [earlier 26 October revision](revision-2026-10-26/) is historical: its old setup-code and
private-continuation views are superseded, while picture 8 remains applicable. The
[21 October set](superseded-2026-10-21/) also remains historical. Unchanged views above retain
the original design’s other decisions.
