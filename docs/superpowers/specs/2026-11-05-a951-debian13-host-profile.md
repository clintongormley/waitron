# A951 Debian 13 host-profile successor

**Artifact:** `waitron-a951-host-custody-v1`

**Revision:** `proposal-2026-11-05.1`

**Status:** Lane E proposal only; matching Lane G engineering acceptance absent;
runtime admission CLOSED.

You need host evidence for the chosen Debian target before native custody can
qualify. This delta successor changes the proposed host target, not the custody
contract or its acceptance boundary. It supplies no implementation or measurement.

Treat this file as an immutable publication artifact. Hash its entire UTF-8 file,
including its final newline, with SHA-256. Record the digest outside these bytes
in the plan and intake. Corrections require a successor revision and new digest.

## 1. Complete inherited requirements

Incorporate the entire immutable [previous host/custody artifact](2026-11-02-a951-host-custody-amendment.md),
`waitron-a951-host-custody-v1` / `proposal-2026-11-02.1`, full-file SHA-256
`50001abafc7c3edea270821e0a8570f8c722969d62132070a46d9cd3729956d2`,
by reference. Call that artifact X. Preserve its bytes unchanged.

X incorporates the exact [original helper profile](2026-10-23-a951-local-helper-v1-proposal.md),
H, `waitron-a951-helper-v1` / `proposal-2026-10-23.1`, SHA-256
`da433f66a7dcb835e99eeb4a7e5c6f01f2bc9c69db369c44a5131247a4ab008f`.
H remains unchanged and remains the numerical helper policy. No helper field,
framing, EOF rule, scope, result grammar, identity, mode, address, port, cap,
clock rule, deadline, reserve or acknowledgement bound changes.

Except for the explicit host-target, pinset-metadata and scheduling deltas below,
every requirement in X applies unchanged. This includes all service and trusted-root
boundaries, no-fork/no-transfer socket custody, broker and accepted-socket ownership,
independent guards, persistence, restart/recovery and suspension requirements.
A malicious trusted host root or privileged helper remains outside the protection
claimed by this boundary.

Retain by reference the complete D560 mapping and its matrix as recorded in the
[plan's G1 acceptance amendment](../plans/2026-10-22-a951-connection.md#g1-mapping-acceptance-amendment-2-november-2026-d560):
`cloud-a951-g1-host-custody-v1` / `proposal-2026-11-02.1`, full-file SHA-256
`2f16bd7c01c12849897501fae3bccabb770f9db4006e917b9964573bf994a9cf`.
Its four independently protected safety stores, complete history, protected PP
participants, shared-head/local-progress separation, GUARD16 inventory and aggregate
journal/emergency-reserve accounting remain unchanged. No store, sidecar or host
profile creates another allowance. That mapping's existing acceptance remains
limited to its exact documented isolated-planning scope.

## 2. Sole host-target override

Replace X section 2's Ubuntu 24.04 LTS target and
`a951-linux-systemd-docker-v1` identity with **Debian 13 on native x86_64**,
host profile **`a951-debian13-systemd-docker-v1`**.

Retain every other host requirement in X, including systemd as host PID 1,
unified cgroup v2, Docker Engine with containerd/runc, enforcing AppArmor,
WireGuard, nftables and the stated exclusions. This is a qualification target,
not an accepted package range or a claim that the returned machine satisfies it.

| Decision provenance                                                                                                  | Source words              | Scope                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner direction relayed by watchers at 11:55 and 12:15 on 5 November 2026, supplied for this milestone               | “Debian 13, matching B3.” | Choose the Debian target and returned shared test box for isolated work. This supplies no host qualification or blanket operational approval.      |
| [B3 design section 3](2026-10-21-b3-usb-installer-design.md#3-the-shape-a-small-stick-that-fetches-a-ready-made-box) | “Debian 13, Docker”       | Align the A951 target with B3's designed disk. Section 8 describes the designed operating-system contents; neither section qualifies A951 custody. |

Old Ubuntu and Mac measurements remain historical fixture evidence. They cannot
qualify this distinct Debian host profile.

## 3. Exact pins and unchanged qualification matrix

Use `waitron-a951-host-pinset-v1` revision
`qualification-unpopulated-2026-11-05.1`, with
`hostProfile` equal to `a951-debian13-systemd-docker-v1`.
**No accepted runtime entries exist.**

Inherit X section 8's entire closed pin-manifest grammar, mandatory inventory,
exact-byte provenance, signatures and rejection rules by reference. Its artifact
references must identify this successor and the complete inherited X/H chain.
Fixed executable names and watcher inventory cannot populate missing pins.
The local listener-custody and bench-evidence schema identities/revisions named
in X remain unchanged; this successor does not revise those grammars.

Inherit X section 9's entire qualification matrix and evidence rules by reference,
without omitting or weakening any row. Each row still requires its valid positive,
negative, failing deletion/bypass control and restored positive, at exact loaded
pins and within H's bounds. Missing prerequisites, skipped or unsafe experiments,
unknown custody and unmeasured bounds leave qualification incomplete.

Preserve X section 6's sleep problem explicitly. Packet expiry and elapsed-time
listener closure require separate evidence. Later cleanup cannot prove timely
closure during suspension. The required sleep prevention, controlled pre-sleep
closure and failure handling remain unqualified on this target. A failed listener
bound rejects the host; no sleep test is deemed satisfied by this proposal.

Changes to measured host, kernel, runtime, image, executable, profile, unit, mount
or contract bytes invalidate the relevant receipts under X section 8. Rerun the
affected boundaries and cross-boundary failures before accepting successor pins.

## 4. Returned shared box and operational limits

The watcher reports that the reinstalled Debian box has returned. This supersedes
X's former “Docker/bench returns with the owner on 3 November 2026” scheduling
dependency and later wait-for-reinstall wording. Availability is not qualification.

Use the returned shared test box for isolated work within existing build authority
and each affected path's gates, through the shared test-box helper, one lane at a
time. No EC2 work is selected. Leave the owner's `/opt/waitron`, containers and
networks untouched. Windows shares the disk; make no partition changes.

Host configuration, sleep and reboot experiments may proceed only when safe for
the owner's Waitron. Host reconfiguration requires explicit owner approval;
experiments requiring configuration changes need that separate authorization.
This proposal grants no blanket host-operation approval. Defer unsafe experiments
and retain their missing evidence rather than relaxing the matrix.

## 5. Publication and acceptance

Lane E publishes this proposal only. Matching Lane G acceptance of this successor
is absent. Before affected integration, record matching engineering acceptance
of the exact successor digest, allowed scope and both full executable consumer
pins in the Waitron intake and Cloud's canonical integration ledger. Then qualify
the exact runtime pair under the populated pinset and inherited matrix.

Existing isolated helper, G1-planning and routing acceptances keep their exact
scopes; none inherits acceptance of this successor or a Debian runtime.
G1–G7 retain every remaining affected-path prerequisite. Full appliance acceptance,
accepted host-amendment digest, accepted Waitron executable consumer, accepted
Cloud executable consumer and qualified runtime pair remain **NONE**.

Admission stays **CLOSED**, production customer manifests empty and `.local`
independent. No provider, deployment, customer-product, publication/pause, writer
or fiscal authority follows from this documentation milestone.
