# B3-16: measure the name tag on a real encrypted header

Lane K’s B3 ask is to take the next smallest parent-plan cut. Sol high authored the original writer plan; Claude’s sole303-second read questioned its absent user-facing reader. Watcher2026-11-11 08:23 chose PR4’s smaller rig-only route and cleared this revision/build without another read. The installed writer must arrive with its reinstall screen/header reader; it is not built here.

On a disposable Debian13 guest with a virtual TPM, use the real cryptsetup/systemd tools to check three existing [PR4 remap](2026-11-03-b3-4-name-tag-wifi-copy.md#re-map-against-main-on-2026-11-03) questions: an unknown no-keyslot tag leaves automatic chip unlock working; an oversized token replacement is refused without changing either header copy; the largest allowed tag fits beside real chip/recovery tokens. Compare other tokens, keyslots and classification markers. A baseline with no tag must fail the tag assertion; removing chip-unlock material from a disposable control must refuse headless unlock. Retain commands, versions, statuses and small receipts, never keys.

Reuse existing name-tag encoder/planner and the bench’s run-owned Linux/QEMU/swtpm approach. No installed-image assembly, app/server/socket/clock changes, new framework or committed rig code. Temporary probe scripts and disks stay outside the repo and are removed before this firing ends. Expected changes: production0, committed tests/support0, docs about+30/-20 plus this short plan; one scratch probe about100lines. Allow30minutes for feasibility; stop with actual evidence if real chip unlock cannot be exercised, never substitute a fake token.

Record measured results and limits in `docs/backlog/box.md`, removing only the questions actually answered, and add a short pointer to `docs/backlog.md`. This is measurement/documentation, so follow the docs-only signed-branch/direct-main workflow under the shared landing lock; no PR or further review. B3 remains unsigned development,0/6 parent slices complete, and physical hardware/release qualification stays open.


## Measured on 11 November 2026

The disposable amd64 guest used Debian 13, kernel 6.12.116-1, cryptsetup 2.7.5-2 and systemd-cryptsetup 257.13-1~deb13u1, under QEMU 10.0.13 and swtpm 0.7.1. Its 64 MiB LUKS2 file had real systemd recovery and TPM2 tokens, three keyslots and a 12,288-byte JSON area. These measurements used a minimal guest, not the installed Waitron image, Secure Boot or physical hardware.

| Probe and command | Observed result |
| --- | --- |
| `systemd-cryptsetup attach` with `tpm2-device=auto,headless=yes,tries=1,password-cache=no`, before and after importing the canonical no-keyslot tag | Both opened the mapping. The tag was 256 four-byte characters, 1,100 encoded bytes. Other tokens and all non-token JSON matched before/after import. Removing the TPM token from a copy made the same headless attach return 1 with no mapping; it did not time out. The no-tag baseline failed the tag assertion. |
| `cryptsetup token import --token-id 2 --token-replace --json-file` with a 100,076-byte token | Exit 1. Debug output: “JSON does not fit in the designated area.” Header backups before/after were byte-identical across 16,777,216 bytes, including primary/secondary header signatures. SHA-256: `93a1d5fe866b3d9bf8f1c17ca0410c31172cd1f54c088ff4fb6f36f2d67b4b10`. |
| Raw header JSON after the maximum tag, alongside the enrolled tokens | 3,225 bytes occupied the 12,288-byte JSON area in this sample. This does not reserve space for later tokens or qualify other header layouts. |

The final guest emitted each passing assertion and shut down normally. Private disks and emulator state were discarded; only commands, versions and small logs remain in Lane K’s `receipts/b3-16-plan-20261111/`. Earlier harness failures are retained there too. No installed writer, reader, clock service or application behavior changed. The writer must land with the reinstall screen/header reader that uses it, per watcher 08:23.
