# A951 preliminary host evidence, 5 November 2026

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
