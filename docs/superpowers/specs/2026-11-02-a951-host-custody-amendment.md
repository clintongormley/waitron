# A951 host and socket custody amendment

**Artifact:** `waitron-a951-host-custody-v1`

**Revision:** `proposal-2026-11-02.1`

**Status:** engineering choices offered for bilateral E/G review; runtime admission CLOSED.

You need to withdraw remote access even when the application stops cooperating.
A process ID, a closed control connection or a successful command cannot establish
that every remote socket is closed. This amendment chooses the local ownership
and failure boundary that T3 needs, and specifies the host evidence T14 must obtain.
It supplies documentation, not those implementations or that evidence.
Custody means control over every listening and accepted socket. A file descriptor
(FD) is a process handle to an open object; copies can outlive the original holder.

Treat this file as an immutable publication artifact. Hash its entire UTF-8 file,
including its final newline, with SHA-256; record that publication digest in the
plan and intake, outside these bytes. A correction needs a successor revision and
a new digest. Publication and an engineering review do not accept a runtime pair.

## 1. Inherited contract and acceptance boundary

`H` below means the exact [original helper profile](2026-10-23-a951-local-helper-v1-proposal.md),
`waitron-a951-helper-v1` / `proposal-2026-10-23.1`, publication SHA-256
`da433f66a7dcb835e99eeb4a7e5c6f01f2bc9c69db369c44a5131247a4ab008f`.
Its bytes remain unchanged. The [plan's D130/D132 amendment](../plans/2026-10-22-a951-connection.md#focused-d130d132-amendment-2026-10-23)
records E/G acceptance solely for isolated helper implementation with injected
policy. That acceptance supplies neither appliance mapping nor actual host proof.

Use H as the single numerical policy: its identities, modes, framing, operations,
EOF requirement, concurrency, state caps, ownership, addresses, ports, network
matrix, clocks, deadlines, closure reserve, checks, polling and acknowledgement
bounds all apply unchanged. References to a check interval or closure bound below
mean H's named bound, not a new timer default. Keep H's three scope names and
separate network/listener result enums. No helper request or response field changes.

This amendment fixes local service identities and custody mechanics. It does not
choose D132's appliance closure classifications, trust-history representation,
maximum history, all-store mapping, reconnect approval consumers or intact-reboot
authentication. Lane G maps those to this digest after D462; retain all G1 bounds
and return any required bound amendment explicitly. A local record checksum is
an exact-byte reference, not authenticated Cloud authority or privileged-tamper proof.

G2 remains the actual A947 current-authority/freshness/withdrawal agreement. G3
staff v1 remains opt-in and test-only. G4 upstream, G5 movement and G6 routing and
A980/D101 privacy retain their gates. The production customer manifest stays empty;
`.local` stays independent. A951 serves one venue, with no location parameter.
There is no writer, fiscal, production, provider, publication or pause authority here.

## 2. Proposed host, and what source inspection actually establishes

Choose host profile `a951-linux-systemd-docker-v1`: native Linux on x86_64,
Ubuntu 24.04 LTS, systemd as host PID 1, unified cgroup v2, Docker Engine with
containerd/runc, enforcing AppArmor, WireGuard and nftables. This is a proposed
qualification target, not an observed machine or an accepted version range.
Exact kernel/package/build bytes must fill section 8. Docker Desktop, rootless
Docker, user-namespace remapping and another architecture are outside this edition.

All Linux, systemd, Docker, LSM (kernel security policy) and BPF (kernel program) behavior below is
**a proposed requirement awaiting host proof**, including named API candidates.
The primary-source rows below support only their stated mechanisms. All other
behavior, especially bounded custody and suspension handling, awaits host proof.
Qualification must pin the selected implementation's sources and run section 9.

| Primary source, read 2 November 2026 | Source words; exact meaning and limit |
| --- | --- |
| [Linux man-pages 6.19, fork(2), DESCRIPTION](https://man7.org/linux/man-pages/man2/fork.2.html) | “The child inherits copies of the parent's set of open file descriptors.” Inherited descriptors motivate the no-fork requirement; this is not proof of confinement. |
| [Linux man-pages 6.19, unix(7), SO_PEERCRED / SCM_RIGHTS](https://man7.org/linux/man-pages/man7/unix.7.html) | “credentials are those that were in effect at the time” and “a reference to an open file description”. Connector credentials and transferred references are distinct; authenticate the lifetime and prevent export. |
| [systemd.service, systemd 262, WatchdogSec](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html#WatchdogSec=) | “The watchdog is activated when the start-up is completed.” This documents a watchdog mechanism, not the proposed closure deadline, container tracking or suspend safety. |
| [Docker host driver, host-mode description](https://docs.docker.com/engine/network/drivers/host/) | “the container shares the host's networking namespace”. Host networking is not containment of the helper's network authority. |

Read-only receipts at Waitron `701cb68da6cf6478b42bd2886a37179d7a6d29e1`:

| Source receipt | Observed source words/structure; limit |
| --- | --- |
| `deploy/compose.yml:10`, `:17` | App uses an overridable `:main` image and `network_mode: host`. This is not an exact A951 image pin. |
| `deploy/Dockerfile:179`, `:185`, `:280`, `:286` | Node receives `cap_net_bind_service`; app user is UID 10001; entry is `node /app/node-entry.js`. This does not implement H's application identity/capability profile. |
| `apps/server/src/node-entry.ts:763`, `:777`; `apps/server/src/boot.ts:672`, `:682` | Entry calls `runEntry` with `startServer`; the app's listener uses `serve`/`buildServeOptions`. No A951 custody receipt follows from it. |
| `apps/server/package.json:7`, `:17`; `git ls-tree -r --name-only HEAD apps/server/src/connection deploy/box` | Declared bundles/commands do not include the proposed native entries; the tree query lists only existing box-service files. |
| `deploy/box/waitron-box.socket:5`; `deploy/box/waitron-box@.service:6`; `deploy/waitron.sh:334`, `:346` | The existing clock service uses another socket, handler and group. Do not reuse it as the A951 supervisor or silently change its consumers. |
| `helper-key-store.ts:70`, `:108` and `helper-native-data.ts:106` at `3ffa4c3de`, read with `git show 3ffa4c3de:apps/server/src/connection/helper-key-store.ts` and the companion path | Preserved foundation declares an isolated fixture store and staging data without native execution. It supplies no host identity, mount or socket-custody qualification. No tests from that tree were run here. |

The future application profile must reconcile UID, file ownership and the existing
clock-service consumer explicitly before installation. This document changes none
of them. Generated native binaries, remote bundles, profiles and exact build hashes
below are unavailable qualification inputs, not names of files already shipped.

## 3. Executables, services and trusted root

Use these fixed future launch identities. `node` below means only the pinned
`/usr/local/bin/node`. Native entries live under
`/usr/local/libexec/waitron-a951/`; remote JS entries live under `/app/` in their
own immutable images. No shell, PATH search, user hook or caller-selected argv
is permitted. Register optional commands through `waitron.commands` when built.

| Role from H | Proposed executable and owning service | Required boundary |
| --- | --- | --- |
| Application | Existing `node /app/node-entry.js` in future `waitron-app.service` outside the remote slice; helper requests originate only from native `waitron-a951-caller` in `waitron-a951-caller.service` | Both use H's application UID; caller has only H's application operations, never activation. Application feeds bounded messages over a supervisor-created private pipe. |
| Verifier | Native `waitron-a951-verifier`, `waitron-a951-verifier.service` | H's verifier UID and specified group memberships and no capabilities; own container, lifetime and restart policy. Checks independent G1/G2/path inputs, not app heartbeat or role boolean. |
| Helper | Native `waitron-a951-helper`, `waitron-a951-helper.service` | H's root identity/group and sole network-admin capability; its own container, PID and mount namespaces, host network namespace. Fixed `/usr/sbin/ip`, `/usr/bin/wg`, `/usr/sbin/nft` execution only. |
| Host launch/retirement | Native `waitron-a951-launch` / `waitron-a951-retire`, fixed manager actions of the role services | Track actual container init/cgroups, not a Docker CLI PID; stop the registered remote closure domain independently of the supervisor. |
| Supervisor | Native `waitron-a951-supervisor`, `waitron-a951-supervisor.service` | Host root component outside application/helper containers. Owns IPC listener, TCP accept broker, process handles, private registry, independent guard and deadline enforcement. |
| Staff worker | `node /app/a951-staff-entry.js`, `waitron-a951-staff.service` | H's staff-worker UID, no capabilities; remote-only TLS/dispatch seat. |
| Public worker | `node /app/a951-public-entry.js`, `waitron-a951-public.service` | H's public-worker UID, no capabilities; separate upstream TLS/empty-manifest seat. |
| Isolated probe worker | Native `waitron-a951-probe`, `waitron-a951-probe.service` | H's public-worker UID with a distinct service/cgroup/profile; fixture only, no business dispatcher or production launch. |

Names above are fixed contract identities; actual unit/container invocations are
new per launch. The host system manager, its root launch agent, kernel, runtime,
supervisor and privileged helper are trusted. A malicious host root or helper
can defeat this boundary; record hashes, UID checks and capability reduction do
not prevent that replacement. No untrusted role gets the manager bus, runtime
socket, host root, cgroup write access, ptrace, namespace entry or policy loading.

The manager creates a nondelegated `waitron-a951.slice` for remote roles only.
The app/local listener stay outside it; no remote failure/stop dependency may stop
the app. Remote units use `Restart=no` and containers have restart disabled; a new
invocation starts closed only after verified retirement. Failure targets fixed
`waitron-a951-retire.service`, running the native retire entry. Register each invocation
with boot identity, H's slot/node/generation/owner, exact executable closure,
manager invocation ID, runtime container ID, open process-lifetime handle, open
cgroup handle and pinned namespace handles. A cgroup is a kernel-managed collection of processes
used here for custody; its pathname and a numeric PID are lookup hints only. Never
adopt a restarted process or recreated cgroup through the old record. Record the
new invocation before use and retain old handles until verified retirement.

Keep H's host network namespace and separate PID/mount namespaces, with no user
remapping; verify actual host UID/group membership and namespace handles at launch.
Private read-only roots, no-new-privileges, exact capability sets, seccomp and
AppArmor profiles are mandatory for every role. Workers cannot fork a process,
exec another image, bind/listen/connect network sockets, export descriptors,
or import anything except registered broker sockets on the fixed private channel.
They cannot read another process's descriptors or move to another cgroup. Pin the restricted
Node runtime, native FD adapter and allowed thread behavior; a broad clone allow
rule that also permits fork is not acceptable. The app's broader needs do not
weaken the separate caller or remote workers.

## 4. Unix socket and one-request lifetime

The supervisor alone creates H's fixed helper socket and parent with H's exact
owner/group/modes, after checking exclusive ownership of the directory and absence
of an unresolved predecessor. It keeps the listening handle and gives only that
handle to its registered helper invocation through trusted launch plumbing.
That launch transfer is not descriptor passing on H's request protocol.
The helper accepts; callers never obtain a server/listening descriptor.

Read-only directory mounts expose only the socket to the application caller and
verifier. Root policy binds mount source, filesystem, mount identity, directory
handle and service lifetime. Mount replacement, path substitution, unexpected
links/permissions or loss of endpoint custody closes admission. A socket inode
comparison alone authenticates neither its serving process nor its clients.

For every accept, the native helper must obtain a kernel-bound connector process
handle (proposed API: `SO_PEERPIDFD`) and host peer credentials, then match the
supervisor registry's invocation, executable closure, cgroup and namespace handles.
Missing API, unavailable evidence or a race acquiring the handle refuses before
parsing. Recheck liveness/membership before intent persistence, before effects,
before activation commit and while the request is outstanding. A dead handle
cannot be replaced with a PID lookup. An operation already crossing the effect
boundary uses H's uncertain/reconciliation path; never report zero effects then.

Peer credentials describe a connector, not every later writer using its connected
FD. Therefore each permitted connector is a pinned native, single-request client:
it connects only after final sandbox installation, cannot fork/exec while connected,
cannot export or import descriptors, and closes on completion/death/deadline.
Reject all incoming ancillary data under H. Kernel-generated peer evidence is
not caller-supplied ancillary authentication. Profiles must block SCM_RIGHTS
export on any other channel, ptrace, `pidfd_getfd`, `/proc` descriptor access and
alternate escape paths. CLOEXEC alone is insufficient because fork can retain FDs.
A direct Node connection, a same-UID process or a borrowed connected FD has no seat.

The native supervisor's H-protocol client runs in a separately restricted task
within its trusted service, with its own registered lifetime. It follows the same
no-transfer rule; privileged supervisor integrity remains a trust assumption.
Private launch pipes do not let the app request activation or select identities.
One H frame, mandatory EOF, one response and close remain unchanged. Idle opens,
partial frames or helper restarts cannot reserve authority beyond H's deadlines.

On caller crash, cancel its request and close admission if effects are uncertain.
On helper restart, stop accepting, close all accepted IPC connections, close both
remote guards and require fresh inspection/evidence. On supervisor restart, the
manager first stops all remote workers, caller, verifier and helper, and discards
all prior IPC and listener handles. Only after verified closed/absent custody may
a new supervisor recreate the socket and publish a new invocation registry.
An unlink/rebind while an old server or connected FD survives is forbidden.
Reboot invalidates every old handle/acknowledgement; no request is reattached.

## 5. Stores, listener creation and accepted sockets

Preserve H's helper/verifier paths, owners, modes and read/write split. Use fixed
`/var/lib/waitron/connection/supervisor/` for supervisor-only persistent records and
`/run/waitron-a951/supervisor/` for live handles/registry endpoints; both are root
private directories with H's helper-private directory/file modes. Root-provisioned
policy lives at `/etc/waitron-a951/`, mounted read-only per consumer. Expose only
H's slot and custody acknowledgement files read-only to the helper, never the
supervisor's writable directory. Supervisor reads the helper plan through a
read-only mount; helper cannot write acknowledgements or supervisor safety.

Use opened directory handles, no-follow constrained resolution, exclusive
creation, exact ownership/mode/link/mount checks, synced temporary writes, rename
and directory sync. Verify saved bytes through the pinned handles before adoption.
Untrusted app/worker mounts contain no helper keys, verifier records, policy or
supervisor store. No venue DB, recovery archive, machine key or TLS private key
enters the helper. Verifier authentication needs a separately accepted least-access
G1/G2 consumer seat, not an unrestricted mount of application secrets. Endpoint
stores remain excluded at archive collection and import boundaries.

Verifier records retain H's exact schemas and byte digests. Supervisor produces
local `waitron-a951-listener-custody-v1` / `proposal-2026-11-02.1` receipts, saved
by digest in its private registry and exposed read-only to verifier/helper. Each
receipt binds node, boot, generation/ownerRef, scope, intent, observation time,
loaded TLS identity reference, broker/worker invocation references, listener and
accepted-socket registry digest, current floors/deadline and observed custody
state. No secret key, customer payload or arbitrary path appears in the receipt.
This is a proposed local receipt contract, not a Cloud token or added helper field.
Choose a closed receipt with exactly `schema`, `revision`, `node`, `boot`,
`generation`, `ownerRef`, `scope`, `intentRef`, `observation`, `atBootMs`,
`loadedIdentityRef`, `brokerInvocationRef`, `workerInvocationRef`,
`socketRegistryRef`, `stopGeneration`, `withdrawalGeneration`,
`deadlineBootMs`, `state`. Schema/revision are the artifact values just named;
all other types use H's H/D/U/timestamp/scope/listener-state definitions, with
invocation and registry references of type D. `loadedIdentityRef` may be null for
closed/unknown custody or the non-TLS probe; deadline nullability follows H. Apply H's closed JSON and
response-payload bound; the live registry digest is not an unbounded safety store.
A ready receipt requires complete live handles; saved receipt bytes cannot revive
handles after restart. Registry overflow or inspection failure closes admission.

Charge all retained supervisor receipt bytes, registry metadata and unfinished
retirement records to H's journal byte budget, aggregated with the helper and
verifier journals. This is one shared budget, not another allowance per store.
H's independent safety-record budget holds the durable floors and recovery hold;
do not borrow it for socket observations. A handle's registry entry carries its
scope, boot/generation, invocation references, descriptor identity and custody
state; charge its complete encoded metadata even while the handle is only in
memory. Reserve that space before accepting or handing off a connection. At the
limit, stop new accepts and refuse renewal rather than evicting live evidence;
priority closure still runs. Qualification must prove the maximum retained set
fits both budgets and closes within H's bound.

Keep every receipt referenced by the current intent, custody plan/ack, live
registry, unresolved operation or H's retained replay results. A newer observation
can replace a receipt only after no such reference remains. Retire a socket entry
only after broker and worker read-back establish that every copy is closed;
unknown copies retain their entry and block admission. Unreferenced completed
observations may then be deleted. This registry keeps current custody and pending
retirement, not an ever-growing connection history. Neither retirement nor replay
eviction changes safety floors; G's separate mandatory trust history cannot be
discarded to make space.

The supervisor's native accept broker creates each TCP listener only at H's exact
scope address/port, with both guards closed, after H's collision checks. It alone
may bind/listen/accept those ports. It retains each listener and every accepted
socket in its live registry before handing a connected socket to the correct
worker over a separate private launch/data channel. No TCP listener FD enters a
worker; neither worker nor app may forward an accepted FD or open a replacement.
The supervisor retains a shutdown-capable handle to every handed-off socket.
Bind exclusions must remain enforced after preflight: the pinned host LSM policy
reserves H's ports/assigned addresses to this broker and outer tunnel owner across
untrusted services. Concurrent privileged reconfiguration invalidates custody and
closes admission. Snapshot checks alone do not satisfy H's collision condition.

Choose this accept-broker design to cover sockets accepted just as withdrawal
starts. A scope lock serializes accept registration/handoff against closing that
scope. Closing marks the scope closed and closes every broker-owned listening
handle for that scope; disabling accepts alone is insufficient. An accept already
in progress is registered and shut down before releasing the lock, never handed
off afterwards. Accept/handoff under this lock is nonblocking metadata work:
no TLS, worker acknowledgement, disk write or ordinary helper effect may hold it.
Close the independent guard before waiting for the lock. A stalled lock invokes
the registered remote failure-domain shutdown, never waits past H's closure bound.
No TLS handshake, keep-alive, upgrade or slow-reader connection is exempt. Observe
socket state after shutdown, close broker copies, terminate that scope's complete
worker cgroup and verify both listener absence and closure of every accepted copy
within H's bound. Unknown listener absence or socket custody cannot produce
`closed_verified`. Reopening needs a newly registered listener and fresh readiness.
Remote clients may observe a timeout when the network gate drops traffic; this
is no claim of a delivered FIN, RST or business-operation cancellation.

The native FD-to-Node TLS adapter and scoped business dispatcher are unimplemented
requirements. A generic proxy to the unrestricted local app is not a substitute.
Do not copy the existing `startListening` exit-on-bind-error behavior into these
workers. Their failure closes their remote scope and leaves the local app running.

Publish H's exact custody-plan/ack handoff only after independently validating
evidence, floors, ownership, worker/broker lifetimes, loaded identity and armed
deadlines. Acknowledgements match the exact planRef; old readiness cannot arm a
new invocation. Prepared listeners with guards closed can produce local custody
readiness, never a gateway-reachability receipt. Final open rechecks the same
scope lock/floors/ack; a concurrent stop wins. Network effects
remain `observed_active`, `observed_blocked`, `verified_removed` or `unknown`;
listener results remain `ready_verified`, `closed_verified`, `pending` or `unknown`.
Keep operation `may_have_applied` separate. Killing a PID, emptying a cgroup,
closing IPC or returning from nft is never the combined removal receipt.

## 6. Independent deadlines, failures and suspension

Verifier polls independent authority/path sources under H's observation bounds.
Helper checks its own persisted floors, deadlines and actual ownership at H's
check interval. Supervisor independently validates the plan/evidence and enforces
its guard and socket deadlines, without waiting on helper effects or app RPC.
Use H's boot-elapsed clock including suspension, uncertainty subtraction, first
saved deadlines, early kernel closure reserve and backward-clock rule throughout.

Both helper permission and supervisor permission must be required on every packet,
including established traffic and reverse tuples. Choose a future pinned kernel
packet gate, `waitron-a951-deadline.bpf.o`, as part of the supervisor guard's
implementation alongside H's guard table. It must check boot-elapsed deadlines
at every relevant packet hook, default deny without a current entry and prevent
post-resume packets before userspace runs. Loader, maps, hook coverage and complete
object inventory are mandatory qualification inputs. This object does not exist
in the inspected build; kernel acceptance of its program/API and exact enforcement
remain unproved. Do not assume nft timed elements alone account for suspension.
It adds no allowance and changes neither H's resource-result grammar nor its caps;
G must map the complete guard inventory before a producer reports it as verified.

The host manager independently watches native supervisor progress using a watchdog
budget no longer than H's independent check interval. It watches helper/verifier
progress through the supervisor, and its failure action stops the whole remote
closure domain, including broker copies and worker groups. Require `KillMode=control-group`,
`WatchdogSignal=SIGKILL`, `NotifyAccess=main`, fixed native retirement actions and
explicit dependency stops. Manager-held lifetime/cgroup handles must survive the
supervisor; it must retain no TCP or accepted IPC copies. Repeated
heartbeats detached from successful safety-loop progress cannot renew health.
The normal path closes a failed role's affected scopes at detection, never waits
for grant expiry when it already knows the role failed. No armed acknowledgement
precedes manager confirmation that the watchdog and complete failure domain are active.

| Failure/event | Required handling under H's existing bounds |
| --- | --- |
| App death/stall | Verifier/helper/supervisor continue; no renewal from app liveness; supervisor closes its caller IPC. |
| Verifier death/freeze or stale source | No new activation/renewal; supervisor closes affected scopes on detected failure; existing kernel permission cannot outlast its saved deadline. |
| Helper death/freeze, ordinary effect blocked | Supervisor closes independent guard and sockets through the priority safety path; manager stops/reaps helper before replacement; no stale effect can reopen the supervisor guard. |
| Supervisor death/freeze | Independent manager watchdog kills/reaps broker and workers and stops helper/verifier/caller; kernel deadlines remain independently restrictive. No new supervisor admission until cleanup verifies. |
| Multiple safety workers frozen/dead | Manager closes their complete registered domain. An unkillable task, lost manager response or uninspectable socket produces `unknown`, never a success receipt or automatic restart-open. |
| Learned authenticated stop/withdrawal | Start H's closure stopwatch on acceptance by helper or supervisor. Close guard/accepts/sockets on priority path, persist floors, then clean owned network resources; storage waits never delay emergency blocking. |
| Planned suspend/hibernate | Manager requires synchronous verified remote closure before sleeping; veto sleep if unknown. Resume stays closed pending current boot-bound revalidation. |
| Unplanned suspend/resume | Kernel deadline checks must deny expired traffic before the first resumed packet. Listener closure must meet H's elapsed bound; a host that cannot do so is unsupported, even if it later cleans up. |

No userspace watchdog is claimed to run during whole-host suspension or a stopped
system manager. If suspension crosses a custody deadline with live sockets, the
required elapsed-time listener result cannot be inferred from a later kill.
Qualify this target with host sleep/hibernate disabled and controlled pre-sleep
closure. This edition offers no bounded listener-cleanup guarantee while PID 1
or the kernel is stopped. G7 must qualify prevention of that state with remote
sockets live, or reject the host; a weaker bound requires an explicit successor.
Unexpected sleep invalidates qualification and requires closed recovery. No
kernel-only socket-cleanup primitive is implemented or qualified here. Test network
expiry and listener custody separately; a passing packet gate does not fill that
gap. The trusted-root limits must be explicit in acceptance.

## 7. Restart, stop and generation reconciliation

Close first on every safety-role restart. Keep H's absolute expiry, independent
counters, caller replay floors, scope stop/withdrawal floors and ownership nonce.
A new invocation, new socket or higher grant never clears a stop. Until G accepts
the separate closure-kind/reconnect mapping, keep H's conservative stopped-scope
rules; this artifact does not auto-clear an expired/fault/withdrawn stop.

Save intent/floors before effects under H. Supervisor arms only the exact complete
plan after its own safety checks. Emergency closure precedes waiting for durable
storage; a failed write leaves a recovery hold and cannot claim durable success.
Cross-store disagreement, loss, oversized history or missing established state
stays closed. G's mapping must prove the full safety/history encoding fits H's
caps, with no truncation, silent eviction or transfer into an unbounded sidecar.
Root-owned storage protects against unprivileged substitution; a checksum cannot
establish freshness against rollback or a malicious privileged replacement.

On reboot, discard all old process/socket/cgroup/namespace/ack handles and derive
fresh H-format boot identity from the actual boot. Enumerate surviving owned
network objects and safety evidence with admission closed. Require authenticated
recovery/revalidation, trusted time and fresh G2/grant/custody under the eventual
G1 mapping; this document does not accept the appliance's intact-reboot shortcut.
Missing state is not first installation. Never relaunch from cached remaining time.

Generation handoff follows H's exact slot schema and predecessor-removal digest.
Enumerate all known invocations and owned generations, not only the current unit
name. An old worker, duplicate socket owner, unknown resource or ambiguous cgroup
blocks the handoff. Recheck ownership immediately before each mutation. Leave
foreign/ambiguous objects untouched; do not sweep by unit prefix, PID, interface
name or cgroup path. Retire prior handles only after separate network-removal and
listener-closure read-back. Multiple discovered generations are a reconciliation
fault, not permission for overlap or G5 movement.

## 8. Reject-until-populated exact-pin manifest

Manifest identity: `waitron-a951-host-pinset-v1`, revision
`qualification-unpopulated-2026-11-02.1`. **No accepted runtime entries exist.**
Its successor populated qualification edition is a separately signed release
artifact. This document's fixed names are not generated byte digests.

Use a closed record with `schema`, `revision`, `hostProfile`, `artifactRefs`,
`sourcePins`, `host`, `executables`, `images`, `profiles`, `units`, `mounts`,
`trustRefs`, `evidenceRef`, `signoffs`. Each required component has exact identity,
version/build, architecture, SHA-256 of its measured bytes and provenance. Unknown
members, missing/null/empty pins, synthetic hashes, tags, wildcards and version
ranges refuse qualification. There is no accepted default or "latest" fallback.

| Mandatory pin group | Exact bytes and observed identities to collect |
| --- | --- |
| Contracts and consumers | This file/H/routing/empty-manifest digests; resulting G1 mapping edition/digest; full Waitron and Cloud consumer SHAs and build-source/dirty-tree status. |
| Host/kernel | Hardware/firmware identity, OS release and package snapshot; running kernel release/build ID, boot image, config, WireGuard/nft/BPF modules and security policy; cgroup topology/controllers, clock and sleep configuration. |
| Manager/runtime | systemd PID-1 binary/libraries and effective configuration; Docker daemon, containerd, runc and launch agent binaries/libraries/configuration; exact runtime IDs and security settings in the evidence. |
| Executable closures | Every native entry in section 3, Node, all JS bundles/native addons/loader libraries, ip/wg/nft and transitive executable/library dependencies; full filesystem content manifest, file capabilities and licence notices. |
| Images | Per-platform OCI manifest digest, config digest, all layer digests and installed executable-closure manifest for app/caller/verifier/helper/staff/public/probe images; no tag-only pin. |
| Profiles/guards | AppArmor loaded policy and source digest per role; seccomp filter bytes, capabilities, no-new-privileges, namespace/user mappings; BPF object/loader/maps/hook inventory plus exact nft rules and guard ownership. |
| Units/mounts | Unit and drop-in bytes, effective launch argv/environment allowlist, dependency/watchdog/kill policy; every private/read-only mount source, flags, ownership/modes and launch-observed mount/namespace handles. No secret values in evidence. |
| Policy and provenance | Root-provisioned origin/node/peer/caller bindings, accepted G1/G2 references, TLS identity public fingerprints and trust-policy digests; provisioning/rotation signoffs, not private keys. |

Every artifact/source reference is a pair of exact identity and digest/full commit,
never a branch. Every executable/profile/unit entry is the closed tuple
`[identity,absolutePath,versionBuild,architecture,sha256,provenanceRef]`;
`sha256` is H's D and `provenanceRef` names retained build/collection evidence.
Images additionally bind platform, OCI manifest/config/layers and filesystem
manifest digests. Host records bind exact release/build/config digests to the
measured boot; mount records bind source/target/flags to opened launch handles.
Each table row is mandatory, including transitive dependencies; empty collections
cannot assert a component absent. An explicitly disabled probe still needs its
built fixture image pin for the qualification matrix, and stays disabled at runtime.

Release engineering collects these from the built immutable candidate and the
actual isolated host, with remote admission disabled. Record commands, exit codes,
output digests and byte provenance; compare running file handles/loaded profiles
to the candidate, not just files at replaceable paths. Future collection includes
`uname -a`, `systemctl show`/`systemctl cat` for the fixed units, runtime image and
container inspection, namespace/cgroup handles, effective LSM/seccomp records and
`sha256sum` over the nonsecret executable/profile inventories. Use a collector
that excludes environment secrets, keys and customer state; retain public trust
fingerprints instead. These are collection instructions, not commands run here. Missing generated build
bytes are unavoidable before build; missing local lifetime decisions are not.
This revision makes those decisions without manufacturing the bytes.

E signs the Waitron build/host inventory and G signs its consumer/mapping scope;
the host qualification reviewer signs the exact matrix evidence and trusted-root
limits. Record signer identities and detached signatures under a bilaterally
pinned release-approval trust policy; absent signers, keys or policy block acceptance.
No new runtime credential is invented. Changes to kernel/runtime/image/binary/profile/unit/mount/
contract bytes invalidate the relevant receipts; rerun changed boundaries and
cross-boundary failures before accepting a successor pinset in both ledgers.

## 9. Qualification matrix and evidence disposition

Evidence identity: `waitron-a951-bench-evidence-v1` / `proposal-2026-11-02.1`.
T14's future isolated bench must retain host/pinset/contract/consumer references,
commands and exit statuses, fault-injection times, boot-elapsed observations,
complete network/socket/process inventories and outcomes. Use no credentials or
customer data. Run no bench or deployment from this documentation task.

Each row needs a valid positive, the negative, a failing deletion/bypass control in
an isolated candidate, and a restored positive. A refusal-only rig proves nothing
about legitimate service. Missing prerequisites, skipped experiments, failed
inspection or an unmeasured bound fail qualification. Keep maximum observed
latency and raw samples against H's exact bound, with measurement uncertainty;
never substitute averages. A bound not discriminated by the clock is unverified.

| Experiment / negative | Valid positive control | Measurements and failure oracle |
| --- | --- | --- |
| Same UID, wrong executable/cgroup/namespace; recycled PID/cgroup; old connection after restart | Registered native caller and verifier complete H's permitted operations | Requested effects remain zero for rejected callers; app activation refuses. Record kernel lifetime evidence, not PID equality. |
| Forked/inherited connected FD, SCM_RIGHTS export, ptrace/getfd/proc escape, exec after connect | Sandboxed native caller submits one complete frame/EOF | Attempts fail at confinement; borrowed connection cannot mutate. Test actual escape attempts and race connector death during parsing/commit. |
| Wrong socket owner/mount, symlink, bind replacement, old accepted IPC connection | Supervisor-created endpoint, pinned mount and fresh invocation | No endpoint adoption or admission; inspect both old and new server handles. |
| Wrong record bytes/modes, store rollback/loss, partial sync/rename, full disk | Complete saved state survives valid restart | No lower floor, stop loss or mixed-state activation; report uncertainty when effects began. |
| Observation/renewal/connection churn exhausts the shared journal; an old receipt stays referenced | Completed unreferenced receipts and verified closed sockets retire within the same budget | No live reference or safety floor is evicted; new acceptance/renewal stops at capacity; priority closure still meets H's bound with the registry full. |
| Listener/accept during withdrawal, stalled TLS/keep-alive/upgrade, worker retains FD | Exact assigned scope listener with verified TLS identity | Guard closure, listening-socket absence and actual broker/worker accepted-socket shutdown each meet H's closure bound; public/staff closures remain scoped. |
| Helper/verifier/supervisor crash and freeze, alone and together; wedged effect queue | Fresh independent sources and healthy safety loops | Priority stop bypasses ordinary work; manager action reaps all copies; record network and listener outcomes separately. |
| Expiry with no userspace progress; backward/forward clocks; suspend across deadline; pre-sleep veto | Live unchanged grant plus current time/authority/path/custody | Packet captures in both directions include established sessions and first resumed packet; no post-deadline allowance. Listener bound failure rejects host. |
| Stale ack, renewal during stop, reconnect race, delayed effect after supervisor restart | Same-content higher grant renews only permitted deadline | Stops/floors win; exact plan ack only; no CSR/content mutation or automatic stop clearing. Real G1 transitions need G's separately accepted mapping. |
| IPv6, spoofed source, foreign peer/address/route, wildcard bind race, other firewall rules | Exact H IPv4 tuple in each enabled fixture scope | Both-family/each-direction packet probes and full rules/routes/FD read-back; no LAN/default/foreign mutation. |
| Unknown/duplicate generations, partial cleanup, cgroup reuse, reboot with stale resources | H predecessor removal then exact next slot | Unknown stays closed; no make-before-break or name-based deletion; separate owned absence and socket closure receipts. |
| Missing/tampered pins, wrong image/addon/profile/manager binary | All actual loaded bytes match signed populated pinset | Unsupported host before requested effects; record effective profiles and loaded objects. |
| Remote failure with app/WAN absent; public/staff credential cross-use | Isolated legitimate staff/probe path, empty production manifests; independent `.local` control | No remote bypass, no public product route and no new Cloud dependency on local service. Keep fiscal execution with its separately authorised T14 rig. |

A fixture may use H's existing synthetic binding and separately injected accepted
routing availability control. It supplies no real G1/G2 or production identity;
no new location fixture is introduced. Gated scope rows stay UNVERIFIED until
their valid positive is admissible; deny-all is not a public-path positive.
H's resource/state caps still apply; a matrix cannot bless an oversized implementation.

Lane E's next A951 execution step is **BLOCKED on G7
real-host evidence: Docker/bench returns with the owner on 3 November 2026**.
That schedule is the watcher assignment, not evidence Docker ran or will qualify.
Lane G's distinct next contract item is G1/helper mapping against this exact digest
after D462. All real admission remains CLOSED until the applicable bilateral
acceptances, exact populated pins and host/device/path qualification are recorded.
