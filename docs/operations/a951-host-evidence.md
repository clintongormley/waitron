# A951-S automatic staff connection, 7 November 2026

The five reviewed cuts combined at `7f64f5a54ae04b0878888ec725cc8240ac48493b` ran against
a fresh disposable venue on the Debian test box. After Cloud approved its signed pairing,
the real boot worker submitted the container's retained public key and wrote the assigned
`10.77.17.3` placement. The restricted peer completed WireGuard handshakes with the gateway.
The certificate worker installed the staff chain and opened its listener without a server restart.

A fresh Chromium session, with normal certificate trust, reached `2.29.248.230:443`, signed in
with the fixture administrator's password and opened `/manage/overview`. Its TLS chain named
issuer `YR2` and the assigned staff hostname. Requests to `/setup`, `/recovery`, `/api/session`,
`/api/devices` and `/print-agent` returned 404. A separate `curl` from the rented server returned
HTTP 200 with certificate verification result 0. Restarting this peer container recovered the
trusted public page. These checks cover those requests and one restart.

Cloud's existing trial worker issued this chain on its production directory after the earlier
demo's staging proof. This fresh CSR had no separate staging issue; no second issue was requested.

You can find the commands and raw results in Lane E's local
`receipts/a951s-integration-20261107/`: `run-first-issuance.sh` and its log,
`run-connected.sh` and its log, `public-browser.mjs`, `public-browser.json`, `outside-trust.log`
and `peer-restart.json`. The browser capture stays there too. The probe's first direct listener
request omitted the hostname header and returned 404; the corrected request returned 200.
The resumed fixture also needed its dashboard rebuilt after a source sync, and its temporary
bind directories needed the ownership used by the Compose volumes.

The bounded run stopped its own fixture and peer and removed its network. It left the existing
managed demo and the owner's containers running. Managed deployment of these combined cuts,
physical reboot, public certificate renewal, wrong-venue refusal, revocation, offline sale and
the remaining cross-venue and LAN isolation checks are still open. Nothing landed during the
A760 freeze. The [later bounded managed check](#bounded-managed-server-restart-7-november-2026)
covers the normal server bundle and restart while off. The earlier native-protocol evidence below
belongs to the parked A951 build.

## Settings on and off, 7 November 2026

Source `9e3ac54d0c6e4e4af2e047b372a18e9fcc1d3be8` ran against the same isolated
registration through `test-box-run.sh E` and the retained tunnel image. The local management
route saved remote access off and removed `peer.json`. A new public HTTPS request then failed
to connect; the local administrator session still answered, and a Cloud refresh kept remote
access off. Turning it on restored public HTTP 200 with normal certificate verification.
The registration, tunnel public key and certificate bytes matched their values before the test.

A fresh Chromium session signed in through the public gateway and opened `/manage/cloud`,
showing the saved choice and **Turn off remote access**. The same five non-staff paths listed
above returned 404. This browser ran on the Mac through the public gateway. The off/on route
checks ran on the Debian box, where the helper reported 5,255 MB available memory.

Commands and results are in Lane E's local `receipts/a951s-settings-20261107/`:
`settings-proof.sh`, `test-box.log`, `public-browser.mjs`, `public-browser.json` and the browser
capture. Five one-time guard removals in a separately installed disposable clone failed
assertions; restoring the source passed the five selected cases (`controls.json`). The clone
was removed. Eight English/Spanish, light/dark, phone/desktop widget captures were also inspected.

The bounded run stopped its own app and peer, removed its network and released the test-box
lock. It did not replace the managed demo or the owner's app. This checks a temporary run;
managed deployment, process restart with this setting, physical reboot and the other finish-line
checks above remain open. The automated client case covers remembering off in a new client
instance. The [later bounded managed check](#bounded-managed-server-restart-7-november-2026)
covers a real server process restart while off. The A760 landing freeze remains in force.

## Bounded managed server restart, 7 November 2026

The combined Settings source at `8a346293a1b106ab010d5fe4871e3d36f6bac02a` was built
on the Debian box and run as its normal `server.js` bundle under a separate systemd unit.
Six relevant server and dashboard source files matched the private checkout by SHA-256.
The fresh registration's state was copied while its fixture was stopped to
`/home/clinton/lanes/E/a951s-managed-20261107`. The earlier `/tmp` fixture is an inactive
snapshot; do not run both copies of this registration.

Public HTTPS returned 200 with normal certificate verification. After remote access was turned
off, restarting the server changed its process ID. A fresh local sign-in and Cloud refresh
succeeded, remote access stayed off and `peer.json` stayed absent. Turning access on restored
trusted public HTTP 200. Registration, public key and certificate bytes were unchanged.
An ordinary TERM of this app made systemd restart it once; trusted public HTTP recovered.
Restarting the peer container also recovered trusted public HTTP.

The initial probe requested a refresh while the new process was already refreshing and received
`cloud.busy`. Its retained replacement waits only for that explicit refusal before checking the
refresh result. No application source changed for this check. Commands, both attempts, source
hashes and results are in Lane E's local `receipts/a951s-managed-20261107/`:
`managed-proof.sh`, `managed-proof.mjs`, `managed-proof.log`, `managed-restored.log`,
`source-match.json` and `managed-result.json`.

This was a bounded managed check. Cleanup removed its systemd unit, peer container and network;
`cleanup.log` confirms those absences, a free test-box lock, the earlier managed demo running and
the owner's three containers healthy. The fresh state and runtime remain for resumption, with
remote access saved on. This unit was not enabled across a physical reboot. Reboot, automatic
public certificate renewal, wrong-venue refusal, revocation, offline sale and the remaining
cross-venue and LAN checks are still open. The earlier managed demo remains the owner's
persistent try-out. Nothing landed during the A760 freeze.

# Current addendum: returned Debian box, 5 November 2026

> 7 November 2026: the owner asked for A951-S on a new branch. The earlier A951 native-protocol
> build and its admission gates below belong to the parked branch. Use the [simple staff tunnel
> runtime](../../deploy/tunnel/README.md) for A951-S; this historical material adds no build steps to it.


The owner/watchers' 11:55 and 12:15 direction chooses Debian 13 on the reinstalled
shared test box, with no EC2 work. The watcher now reports its return and this
inventory: Debian 13.7, kernel 6.12, x86_64, systemd, AppArmor, Docker 29.9.3,
WireGuard and nftables installed. This is relayed watcher inventory, not a
measurement or qualification performed by the Debian-profile documentation task.

The [Debian successor](../superpowers/specs/2026-11-05-a951-debian13-host-profile.md)
is E's proposal only. Matching G acceptance, populated exact pins and the inherited
host matrix remain open. The older Docker-date and wait-for-reinstall statements
below are superseded; all historical bodies and measurement limits remain intact.
Ubuntu and Mac fixture receipts cannot qualify the new Debian profile.

Use the shared test-box helper, one lane at a time, for isolated work within
existing authority and applicable gates. Leave the owner's `/opt/waitron`,
containers and networks untouched. Windows shares the disk; make no partition
changes. Host configuration, sleep and reboot experiments must be safe for owner
Waitron. Configuration changes require separate explicit approval. This addendum
does not authorize host reconfiguration or establish that sleep requirements pass.

Retain every inherited matrix row, including valid positive, negative, failing
deletion/bypass control and restored positive. Unsafe or unrun rows remain
unverified. Host changes invalidate relevant receipts; both engineering ledgers
need matching successor acceptance and exact consumer pins before affected
integration. Existing isolated acceptances remain scoped. Accepted host digest,
both executable consumers and qualified runtime pair remain NONE; admission CLOSED.

---

# A951 preliminary host evidence, 5 November 2026

## Routing intake updated on 5 November 2026

E's matching D136 routing intake is complete for isolated T4 fixtures, as recorded
in the [dated plan amendment](../superpowers/plans/2026-10-22-a951-connection.md#routing-acceptance-amendment-5-november-2026-d136)
and [intake](../developers/cloud-connection.md#a951-build-intake). This supersedes
the pending-intake steps in the earlier report below. Both accepted executable
consumers and the qualified runtime pair remain NONE. Next, write the Debian 13
host-profile successor and continue the separate G1 implementation assignments.
Native runs still wait for the watcher to report the reinstalled test box's return.
The measurements and their limits below are unchanged.

You can resume isolated A951 work: Docker is available. The former “Docker with
the owner on 3 November” wait no longer applies. These measurements begin G7's
host evidence; they do not qualify a tunnel, public certificate or native service.

## Host direction updated after these measurements

The owner chose Debian 13 on the test box, which is being reinstalled. Hold native
runs until the watcher confirms it is back; the shared helper returns 75 while it
is unavailable. Write a Debian-profile successor, not an Ubuntu successor.
B3's approved design chooses a Debian 13 shipped disk in
[section 3](../superpowers/specs/2026-10-21-b3-usb-installer-design.md#3-the-shape-a-small-stick-that-fetches-a-ready-made-box)
and [section 8](../superpowers/specs/2026-10-21-b3-usb-installer-design.md#8-the-boxs-operating-system).
Keep the Ubuntu measurements below as fixture evidence and change no box
configuration. E's D136 intake and Debian-profile writing can proceed independently
of the reinstall and Cloud D582's implementation.

## What ran

The source context was Waitron `924f09bcf506088c2d42915acff5ff00ed09d319`, with the
private foundation retained at `3ffa4c3de63c7d13d02522117520b937677142ad`.
Cloud contract inspection used `7393f4ce582c588466571371d2f83a7a00450656`.
No foundation or Cloud code changed.

| Command or experiment                                 | Observed result                                                                                                                                                                                                                             | Limit                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mac `memory_pressure`; `docker info`                  | 54% free memory; Docker Desktop 29.9.2, aarch64, LinuxKit 7.0.14, cgroup v2/cgroupfs; advertised security options seccomp and cgroupns                                                                                                      | Desktop is outside the proposed native x86_64 Ubuntu 24.04 host profile.                                                                              |
| Isolated Unix-socket probe                            | A forked child wrote through an inherited connection; `SO_PEERCRED` still reported the creator's PID. A descriptor sent with `SCM_RIGHTS` remained usable after its original closed.                                                        | This deliberately unconstrained Python fixture demonstrates the two escape attempts, not an A951 service or its confinement.                          |
| Narrow seccomp checks                                 | Denying process-creation syscalls blocked the fork attempt; denying `sendmsg`/`sendmmsg` blocked the descriptor-transfer attempt. Ordinary socket send/receive passed in both fixtures.                                                     | These filters are diagnostic checks, not complete worker profiles or a restricted Node runtime.                                                       |
| Independent deletion and restoration                  | Removing each corresponding syscall rule made its unchanged assertion fail with “guard deleted: borrowed descriptor remained usable”. Restoring the rule passed.                                                                            | Four guarded/restored runs exited 0; the two deletion runs exited 1 at the intended assertion. No closure deadline was measured.                      |
| Read-only test-box inventory under its exclusive lock | Native x86_64, Ubuntu 26.04.1, kernel 7.0.0-34-generic, systemd PID 1, cgroup v2/systemd, Docker 29.8.0. `aa-status` reported `docker-default` in enforce mode. Available memory 5,808 MiB; available root-disk space 47,649,972,224 bytes. | This is a candidate host inventory. The immutable proposal names Ubuntu 24.04, and no A951 profile, unit or executable was installed or tested there. |

The Mac fixture image was
`python@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea`
(arm64). Each probe container used no network, no capabilities, a read-only root,
no-new-privileges, a read-only probe mount, 128 MiB memory, half a CPU and a
32-process limit. Seven recorded probe containers were removed by their exact
IDs. The six baseline Mac container IDs remained present. The test-box query
changed no service or container and released only the lock it acquired.

The retained local receipt is
`~/waitron-campaign-e/receipts/a951-host-preflight-20261105/`.
`commands.json` and `control-commands.json` retain argv, exit status and output
digests; `test-box-command.json` records the remote query and `cleanup.json`
records owned-container absence. The Python constant for `SO_PEERPIDFD` was not
exposed in this fixture; that observation does not establish kernel API absence.
No host suspend, syscall-lifetime handle, complete policy, network guard,
WireGuard, TLS, expiry, reboot or production-admission result follows.

## Take the fixed-box path first

The [host amendment](../superpowers/specs/2026-11-02-a951-host-custody-amendment.md)
and [G1 acceptance amendment](../superpowers/plans/2026-10-22-a951-connection.md)
remain the contract sources. The first isolated certificate proof can use the
opt-in test staff hostname, with TLS ending at the box and customer routes empty.
Moving an endpoint and admitting customer products remain separate work.

| Gate | Holder                                               | Remaining work                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1   | E and Cloud G/D582; D132/D560 supplied documentation | Return the complete revised appliance artifact and signed corpus. Implement and accept establish/recover/reconnect decisions, authenticated one-use approval storage, registration/node binding, policy/peer/key provisioning and protected four-store participants. Record both executable consumer pins. D560's documentation acceptance is already recorded. |
| G2   | E, A947's owner in lane A and Cloud G/D88            | Agree the actual current-authority source, full pin, freshness and withdrawal semantics. A role boolean, registration or membership alone is insufficient under the plan. A947's later table work remains held by A1308.                                                                                                                                        |
| G3   | E and Cloud G's staff-v1 contract owner              | Agree the exact client policy and demonstrate opt-in/test-installation limits, polling, renewal, reload and failure handling. Production staff exposure and origin/device/passkey acceptance remain separate.                                                                                                                                                   |
| G4   | E and Cloud G/D88                                    | Agree independent public-upstream issuer, trust, mutual TLS and exchange/revocation. This gates customer upstream traffic, not the first isolated staff-certificate fixture.                                                                                                                                                                                    |
| G5   | E, Cloud G/D88 and A947's owner                      | Agree movement/replacement phases, retirement and recovery. Keep these disabled for the first fixed-box proof.                                                                                                                                                                                                                                                  |
| G6   | E, Cloud G/D136 and Cloud D/D101 with E/A980         | Record E's matching routing revision-2 intake; agree diagnostic/export bounds and flow-specific metadata processing/access/retention before affected traffic. An empty customer manifest does not accept staff metadata processing.                                                                                                                             |
| G7   | E, Cloud G and the host qualification reviewer       | Write the Debian 13 host successor, wait for the test box's return, then build native entries/profiles/units, map the complete guard inventory within the existing cap and qualify exact loaded bytes, custody, failure and sleep behavior. Then qualify the applicable DNS/issuer/device/origin path.                                                          |

Cloud G/D582 is queued to return concrete dependency ownership after D581.
Start with E's independent D136 intake and those G1 implementation assignments.
Write the Debian 13 host successor while the test box is reinstalled; continue the
isolated corpus/foundation and G2 mapping where their own gates permit.
Qualify native custody and guards on the agreed host before the test staff
exchange and fixed-box tunnel proof. Resolve G6 processing and applicable
DNS/issuer/device/runtime acceptance before real traffic. G4 and G5 keep their
own affected paths closed.

You do not need to reinstall the test box or perform a manual step for the
preliminary work recorded here. The owner selected Debian 13; engineering
acceptance and qualification of its successor remain open. Later real-device tests
and provider/DNS activation need their separately authorized operational work.
The A1308 table hold remains in force. Local fixture evidence creates no table,
new writer, fiscal permission or customer product.
