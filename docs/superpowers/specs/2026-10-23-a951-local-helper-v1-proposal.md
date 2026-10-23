# A951 local helper v1 proposal

**Artifact:** `waitron-a951-helper-v1`, revision `proposal-2026-10-23.1`

**Status:** PROPOSAL ONLY for bilateral Lane E / Lane G review of G1/T3. No accepted helper artifact exists.

You need a local boundary that limits network changes and withdraws remote access without depending on the application staying alive. This proposal defines that boundary. **Every concrete interface, identifier, topology and numerical value below is an unaccepted engineering choice**, offered for acceptance or amendment.

The current plan’s 2026-10-23 build authority supersedes its older planning-only wording. This document introduces no owner approval question. Lane E owns the helper; Lane G owns the Cloud response; Lane D retains deployment and D88.

This is a documentation proposal. Document/vector checks do not qualify an implementation, kernel operation or runtime.

## Authority and provenance

Read this proposal with the pinned [complete plan](https://github.com/clintongormley/waitron/blob/55a62b62d11b0b8d038497d564dea8fbc4e99092/docs/superpowers/plans/2026-10-22-a951-connection.md), [current design revision and retained technical requirements](https://github.com/clintongormley/waitron/blob/55a62b62d11b0b8d038497d564dea8fbc4e99092/docs/superpowers/specs/2026-10-22-a951-box-public-access-design.md), [build intake](https://github.com/clintongormley/waitron/blob/55a62b62d11b0b8d038497d564dea8fbc4e99092/docs/developers/cloud-connection.md#a951-build-intake), and [writing-claims rules](https://github.com/clintongormley/waitron/blob/55a62b62d11b0b8d038497d564dea8fbc4e99092/docs/developers/writing-claims.md).

Only the dated Cloud review section was read from the saved Cloud response. Its canonical source pin is `ca5d2a996b93d16c55ccb79b8c3d2228792b5090`. The intake records full-document SHA-256 `57df8883fb8dc50f5e0d93c63779ddb1c4831c16243e0df338a1cd6458522f4a`; this is a source-document pin, not an accepted artifact digest.

| Internal Cloud source                                                                                                                                        | Source wording                                                    | Consequence                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| [Review disposition](https://github.com/waitron-io/waitron-cloud/blob/ca5d2a996b93d16c55ccb79b8c3d2228792b5090/docs/waitron-integration-contract.md#L278)    | “No A951 wire/helper/parser artifact is accepted by this review.” | This document remains a proposal.                               |
| [G1/T3 amendment](https://github.com/waitron-io/waitron-cloud/blob/ca5d2a996b93d16c55ccb79b8c3d2228792b5090/docs/waitron-integration-contract.md#L294)       | “Lane E owns the local process boundary.”                         | E proposes the local contract; G reviews its joint assumptions. |
| [Architecture boundary](https://github.com/waitron-io/waitron-cloud/blob/ca5d2a996b93d16c55ccb79b8c3d2228792b5090/docs/waitron-integration-contract.md#L284) | “Keep `.local` independent.”                                      | Shared remote withdrawal must preserve local access.            |

Everything below states proposed requirements, not existing host behavior or external Linux guarantees.

## Scope and unresolved dependencies

Preserve staff TLS passthrough to the box, independent public-upstream TLS after Cloud termination, default `.local`, and an empty production customer manifest. The helper supplies no publication controls, customer routes, writer activation, fiscal action or recovery permission.

| Dependency              | Required input; present disposition                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 appliance            | Accepted signed bytes/actions, response trust and rotation, identity bindings, three counters, establishment/recovery epochs and replay/report semantics. Unresolved; this document does not choose them. |
| G2 / A947               | Actual pinned current endpoint/authority interface, freshness and withdrawal results, reconciled with revised A1018 and D88. Unresolved; installation status and role booleans are insufficient.          |
| G3 staff                | Accepted staff client policy and actual path readiness. Staff v1 remains unchanged and test-only.                                                                                                         |
| G4 public upstream      | Independent identity, trust, renewal, revocation and connection-closure agreement. Unresolved; reserving a public port grants no admission.                                                               |
| G5 movement/replacement | Predecessor, conditional commit, retirement and recovery agreement. Closed in helper v1; one candidate only, with no overlapping placement.                                                               |
| G6 routing/privacy      | Accepted empty-manifest digest, parser/context contract and flow-scoped metadata acceptance. Unresolved; helper receipts are local and confer no diagnostic export permission.                            |
| G7 runtime              | Exact kernel, container runtime, binaries, images, rules, supervision, DNS and device receipts. Entirely unqualified by this document.                                                                    |

Before any affected adapter starts, record the joint artifact version and digest, both full consumer pins, named acceptances and permitted scope in Cloud’s canonical contract and Waitron’s intake. Local fixture identifiers below do not supply missing external proofs.

## Proposed process and ownership boundary

Use a default-off helper container in the host network namespace. Keep the main application unprivileged. Add an independently supervised verifier so application failure cannot prevent withdrawal observations or manufacture authority.

| Process                       | Proposed host identity and access                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main application              | UID 991, no capabilities; read-only socket-directory mount. May prepare, stage, inspect and request removal. Cannot activate.                                                       |
| Authority verifier            | UID 992, no capabilities; separate process/container and restart policy from the application. Checks accepted G1/G2 inputs and path readiness, then requests activation or removal. |
| Helper                        | Host UID 0, supplementary group 9512; only `CAP_NET_ADMIN`, host network namespace, separate PID/mount namespaces, read-only image, private temporary filesystem.                   |
| Staff/public listener workers | Separate UIDs 993/994, no capabilities, same host network namespace. Bind only their assigned tunnel address and port; independent lifetimes from the local listener.               |
| Host supervisor               | Root-owned installation component. Owns socket creation and process custody; independently observes deadlines and stops only the remote workers it started.                         |

The additional verifier and supervisor roles refine T3’s sketched helper entry. Before code starts, incorporate any bilaterally agreed topology in a focused T3 plan amendment; this proposal does not supply that agreement.

No user-namespace UID remapping is proposed for this version. G7 must verify the actual host IDs and reject a mismatched deployment.

`CAP_NET_ADMIN` in the host network namespace is broad network authority. It does not supply a safe sandbox. The helper remains trusted network code. G7 must accept the concrete mount, syscall, executable and confinement profiles; capability reduction alone is insufficient.

Proposed fixed host locations:

| Location                                | Owner and mount rule                                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/run/waitron-a951/helper.sock`         | Root supervisor creates/listens; passes the descriptor to the helper. Socket `root:9510`, mode `0660`; parent `root:9510`, mode `0750`. UIDs 991/992 belong to group 9510. |
| `/var/lib/waitron/connection/helper/`   | Helper-owned `0700`; files `0600`. Contains safety, journal and locally generated WireGuard private material.                                                              |
| `/var/lib/waitron/connection/verifier/` | `992:9512`, directory `0750`, immutable records `0640`; helper mounts read-only.                                                                                           |
| Fixed identity/policy mounts            | Root-provisioned, read-only; contain node binding, accepted artifact pins, peer registry and caller identities.                                                            |

The application cannot replace the socket or write either state directory. Mount no venue database, recovery material, machine/TLS private keys, host root filesystem or container-management socket into the helper. Exclude helper/verifier state from transfers and recovery archives.

Authenticate each connection with host peer credentials and supervisor-recorded process identity, including its lifetime handle and expected service membership. A UID or PID alone is insufficient. Reject credential, namespace or service mismatches before parsing an operation.

Root socket ownership authenticates the local endpoint; it does **not** authenticate Cloud intent. The verifier checks Cloud authority under the eventual G1 agreement and endpoint authority under G2. The helper trusts that verifier boundary, then independently checks local binding, scope, counters, stop state, deadlines and observed resources. Root-host compromise is outside this boundary.

## Framed IPC and closed schema

Use Unix `SOCK_STREAM`, one request and one response per connection. No descriptor passing, ancillary credentials supplied by the caller, compression or multiplexing.

A frame is exactly `U32BE(N) || payload`: four unsigned big-endian length bytes followed by exactly `N` UTF-8 bytes. `N` excludes the prefix. There is no newline, NUL terminator or second frame. The caller must half-close its write side after the frame. The helper must observe EOF within the request deadline before any requested effect; extra bytes or missing EOF refuse the request. The helper writes its single response then closes. This makes trailing-byte rejection testable before effects.

| Bound                        | Proposed choice                                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request / response payload   | 1–16,384 / 1–8,192 bytes                                                                                                                                       |
| Header plus complete request | 1,000 ms from accept; no progress-based extension                                                                                                              |
| Effect/read-back attempt     | 2,000 ms; expiry/removal work has priority                                                                                                                     |
| Response write               | 500 ms                                                                                                                                                         |
| Concurrent requests          | Two ordinary slots plus one reserved removal slot; one serialized effect turn                                                                                  |
| Ordinary rate                | Ten requests/second per authenticated caller, burst ten; removal bypasses this queue                                                                           |
| JSON structure               | Depth at most six; 64 members total; arrays at most 16 items; strings at most 1,024 bytes, further restricted below                                            |
| State                        | One candidate, one peer, one interface, at most 16 recorded network objects; eight cached replay results; 256 KiB journal and 64 KiB independent safety record |

Reject invalid UTF-8, BOM, duplicate keys, unknown keys, trailing bytes, non-object roots, invalid types and non-finite numbers. Integers use unsigned decimal notation without fractions, exponents or negative zero. Do not coerce strings, numbers, nulls or absent fields.

`H` means exactly 32 lowercase hexadecimal characters; `D` exactly 64. `U` means an integer from 1 through `9007199254740991`. `I` means 1–64 ASCII characters matching `[a-z0-9][a-z0-9-]*`. Timestamps are nonnegative safe integers in milliseconds. An IPv4 address is canonical dotted decimal, without leading zeroes; tunnel addresses include exactly `/32`.

The request has exactly these fields:

| Field        | Type                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `v`          | Integer `1`                                                                                            |
| `id`         | `H`, caller-generated correlation identity                                                             |
| `sequence`   | Zero for `inspect`; otherwise `U`, strictly increasing within the authenticated caller/node/generation |
| `op`         | `prepare-peer`, `scoped-rules`, `inspect`, `activate` or `remove`                                      |
| `node`       | `H`, equal to the provisioned local node                                                               |
| `generation` | `U`, equal to the registered local resource generation                                                 |
| `body`       | Exact operation-specific object below                                                                  |

| Operation      | Exact body; permitted caller; effect                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepare-peer` | `{"intentRef":D}`; application/verifier. Validate registered intent, install closed baseline first, then prepare the locally keyed peer with admission closed.                                                                                                                        |
| `scoped-rules` | `{"intentRef":D}`; application/verifier. Stage only the fixed matrix; no live permission.                                                                                                                                                                                             |
| `inspect`      | `{}`; application/verifier/supervisor. Read actual state without repairing it.                                                                                                                                                                                                        |
| `activate`     | `{"intentRef":D,"evidenceRef":D}`; verifier only. Atomically open or renew the permitted timed scopes after final checks.                                                                                                                                                             |
| `remove`       | `{"scope":"staff" \| "public-upstream" \| "probe" \| "both","stopGeneration":U,"reason":"disconnect" \| "withdrawn" \| "expired" \| "fault"}`; application/verifier/supervisor. Persist the scope stop and close it before cleanup. `both` means every remote scope, including probe. |

No operation accepts commands, hooks, includes, executable names, arbitrary arguments, paths, PIDs, interface names, route tables or key bytes. Cloud supplies no helper key material or trust anchors. Resolve `peerRef` through the locally provisioned public-peer registry; its provenance and update procedure remain G1 dependencies. Generate and retain private WireGuard material locally, separate from every other key purpose.

## Local records for unresolved external inputs

References identify immutable verifier records by SHA-256 of their exact saved bytes. They are local representations, not proposed Cloud signed schemas. The helper reads only its fixed registry; a digest never becomes a caller-selected path.

| Record      | Exact local fields                                                                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binding `B` | `originId:I`, `environment:"fixture" \| "test" \| "production"`, `cloudVenue:I`, `installation:I`, `localVenue:I`, `node:H`, `machineIdentity:I`, `target:I`, `establishmentEpoch:I`, `placementEpoch:I`                                                                              |
| Intent      | `v:1`, `binding:B`, `generation:U`, `installationRevision:U`, `contentRevision:U`, `contentDigest:D`, `peerRef:D`, `box4:IPv4/32`, `gateway4:IPv4/32`, `endpoint4:IPv4`, `services`: unique ordered subset of `["staff","public-upstream","probe"]`                                   |
| Evidence    | `v:1`, `node:H`, `generation:U`, `boot:H`, `intentRef:D`, `grantSequence:U`, `grantIssuedMs:timestamp`, `grantExpiresMs:timestamp`, `observationSequence:U`, `observedBootMs:timestamp`, `authorityUntilBootMs:timestamp`, `authorityState:"current"`, `paths`: array of path records |
| Path        | `scope:"staff" \| "public-upstream" \| "probe"`, `stopGeneration:U`, `withdrawalGeneration:U`, `untilBootMs:timestamp`, `listenerReceipt:D`                                                                                                                                           |

The verifier may publish evidence only after checking all bindings, accepted artifact pins and external proofs. `current` is its checked local result, never a Cloud field trusted by spelling. Each listener receipt must bind node, generation, boot, purpose, loaded identity, socket registry and supervisor custody. Its concrete producer and proof format require acceptance before production use.

A new observation sequence requires a new authority/readiness observation. Re-reading cached proof or receiving an application heartbeat cannot refresh it. The helper rejects evidence for unavailable gates, even when the referenced record is well formed. Keep independent stop and withdrawal floors for staff, public-upstream and probe. A scoped removal advances only that scope’s floor; `both` advances all three atomically. Compare evidence only against the relevant scope floors. Closed scopes omitted from evidence stay closed; omission never withdraws an independently authorised scope implicitly.

Non-production fixture values for every unresolved input are defined here; none asserts an authentic external proof:

| Input                     | Fixture vector                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Binding                   | `originId=fixture-origin`, `environment=fixture`, `cloudVenue=fixture-cloud-venue`, `installation=fixture-installation`, `localVenue=fixture-local-venue`, `node=11111111111111111111111111111111`, `machineIdentity=fixture-machine`, `target=fixture-target`, `establishmentEpoch=fixture-establishment`, `placementEpoch=fixture-placement` |
| Intent                    | `v=1`, the binding above, `generation=1`, `installationRevision=3`, `contentRevision=7`, `contentDigest=` 64 `c` characters, `peerRef=` 64 `b` characters, `box4=10.254.19.2/32`, `gateway4=10.254.19.1/32`, `endpoint4=192.0.2.44`, `services=["staff","probe"]`                                                                              |
| Intent registry reference | 64 `a` characters, explicitly injected as a fixture reference; it is not a claimed computed digest                                                                                                                                                                                                                                             |
| Evidence                  | `v=1`, fixture node/generation/intent reference, `boot=22222222222222222222222222222222`, `grantSequence=11`, `grantIssuedMs=990000`, `grantExpiresMs=1590000`, `observationSequence=21`, `observedBootMs=100000`, `authorityUntilBootMs=105000`, `authorityState=current`                                                                     |
| Paths                     | Staff and probe each have `stopGeneration=2`, `withdrawalGeneration=4`, `untilBootMs=105000` and a fixture listener reference of 64 `d` characters                                                                                                                                                                                             |
| Fixture clock             | Trusted wall `1000000`, boot-elapsed `100000`; fixture evidence reference is 64 `e` characters                                                                                                                                                                                                                                                 |

The fixture constructor must be separate from production construction and require injected policy. The public scope is absent. A production request using these fixture records is rejected before effects.

## Fixed resource ownership

Reserve one slot: interface `wg-a9510`, helper nftables table `inet wt_a951_v1`, supervisor guard table `inet wt_a951_guard_v1`, routing table `51851`, and policy-rule priority `31851`. Route protocol `242` is proposed for owned routes. None is presumed available.

Persist a random 128-bit ownership nonce before creating resources. Bind every object to that nonce, node, establishment epoch, local generation and network-namespace identity. Record link identity and alias, peer identity, nftables metadata/handles, and complete route/rule tuples. A predictable name is never ownership evidence.

If a reserved name, priority, table or route conflicts with foreign state, reject without replacing or deleting it. Recheck ownership before each mutation. If ownership cannot be established, leave the ambiguous object untouched and report `ownership_conflict` or unknown state. Never flush a host table or remove an object merely because its name matches. Before installing any port guard or address, enumerate both-family listeners and address/UDP bindings. An unrelated specific or wildcard listener intersecting ports 9443–9445, an occupied UDP51821 bind, a foreign assigned address or an overlapping route is an ownership conflict. Refuse before adding a guard that would disrupt it. G7 must prove exclusion of concurrent foreign binds/address changes or detection plus safe shutdown; a preflight snapshot alone cannot establish that exclusion.

V1 permits one staged or active candidate, with grant renewals for that same candidate. A changed candidate requires verified retirement of the previous generation before preparation. There is no make-before-break move, predecessor overlap or replacement adapter pending G5.

## Local generation and custody handoff

The root supervisor publishes a private, synced `slot.json` through the fixed policy mount. Its exact record is `{v:1,node:H,boot:H,generation:U,previousGeneration:U|null,previousRemoval:D|null,namespace:I}`. First installation is an explicit root-provisioned generation 1 with null predecessor fields, never an inference from missing safety state. Later slots must advance by exactly one and name the helper’s complete previous removal receipt digest. The helper accepts a slot only after fresh owned-resource absence and its saved predecessor agree. Missing, conflicting or unreadable established state requires the separately accepted recovery decision. Neither caller nor Cloud may register a generation through request fields.

Before opening a scope, the helper durably publishes `custody-plan.json`: `{v:1,node:H,boot:H,generation:U,sequence:U,intentRef:D,ownerRef:D,scopes:[{scope,stopGeneration:U,withdrawalGeneration:U,deadlineBootMs:timestamp,listenerReceipt:D}]}`. Scope names are the three existing enum values in fixed order, with only requested scopes present. `ownerRef` hashes the bound ownership record. The supervisor independently validates the referenced evidence, worker lifetime custody and current floors, arms its own deadline enforcement, then publishes `custody-ack.json`: `{v:1,planRef:D,state:"armed"|"closed"|"unknown",closedScopes:[scope]}`. These are fixed singleton files in separate helper/supervisor private directories; the helper can only read the supervisor’s records. Use durable temporary-file, rename and directory sync with no symlink/path substitution. The supervisor observes plans within 100 ms; the helper waits at most 500 ms for the exact digest’s `armed` acknowledgement before activation. An old acknowledgement cannot authorise a new plan.

Supervisor permission is a separate required guard, never part of an ordinary helper rules transaction. It must remain closed until the exact plan is armed. Every remote packet requires both helper permission and the independent supervisor guard. Closing either denies it. After each ordinary effect, re-read the current custody acknowledgement and scope floors; a concurrent stop leaves the resulting state blocked, never successfully active. Unknown custody leaves admission closed. The helper’s broad capability makes these trusted implementation constraints, not protection from a malicious privileged helper; G7 must qualify the composed boundary.

## Complete network allowance

Let `B4` and `G4` be the address parts of the assigned box and sole gateway `/32` prefixes, `E4` the pinned outer endpoint, and `H4` the locally selected host egress address. `H4` and the physical egress interface come from root-provisioned host policy, never Cloud input.

All rows require matching node/generation, live deadlines and owned resources.

| Plane and direction         | Source                                   | Destination               | Protocol and ports                                            |
| --------------------------- | ---------------------------------------- | ------------------------- | ------------------------------------------------------------- |
| Outer tunnel outbound       | `H4:51821`                               | `E4:51820`                | UDP only                                                      |
| Outer tunnel inbound        | `E4:51820`                               | `H4:51821`                | UDP only; endpoint roaming is not permitted                   |
| Staff request               | `G4:1024–65535`                          | `B4:9443`                 | TCP; staff scope only                                         |
| Public-upstream request     | `G4:1024–65535`                          | `B4:9444`                 | TCP; public scope only, unavailable pending G4/G6/G7          |
| Isolated probe request      | `G4:1024–65535`                          | `B4:9445`                 | TCP; separately enabled non-business fixture only             |
| Service response            | Respective `B4:9443`, `:9444` or `:9445` | Original `G4` client port | TCP; exact tracked reverse tuple and corresponding live scope |
| Anything else on the tunnel | Any                                      | Any                       | Denied, including forwarding and box-initiated sessions       |

The peer’s allowed inner source is exactly `G4/32`; its destination is exactly `B4/32`. The owned policy rule selects only traffic from `B4` to `G4`; its routing table holds only the gateway host route. No default, LAN, cross-venue, multicast or peer-to-peer route is accepted. Do not change global forwarding, NAT, host defaults or unrelated rules.

Reserve remote service ports against physical-interface ingress, in both IP families, and bind listeners only to `B4`. Do not expose them on wildcard, LAN or WAN addresses. Raw printing, drawer, payment-terminal, SSH and administration ports have no allowance.

V1 supports IPv4 tunnel and endpoint addresses only. Reject IPv6 addresses, prefixes, mapped forms, alternative families and IPv6 endpoint fallback. The owned gate must deny IPv6 on the tunnel and IPv6 access to remote service ports without changing unrelated host IPv6 or `.local`.

Propose tunnel MTU 1280 and refusal of inner fragments and unlisted protocols, including ICMP. G7 must establish actual path usability and containment; this document makes no fragmentation or kernel-support claim.

Every packet, including an established connection’s packets, must pass the exact source, destination, service and live deadline checks in both directions. No generic `established` exception may bypass them. Propose dedicated input/output/forward hooks at priority `-150`, with explicit drops for disallowed owned traffic. G7 must prove the complete installed ruleset enforces this despite other firewall rules.

## Time, withdrawal and independent enforcement

Propose a maximum transport-grant lifetime of 600,000 ms and maximum trusted wall-clock uncertainty of 30,000 ms. Subtract that uncertainty from remote expiry; never add grace. These are new choices, not accepted historical defaults.

Use a boot-scoped elapsed clock that includes suspension. On first receipt of a grant sequence, persist its absolute expiry and elapsed deadline. Replays, retries and repeated observations retain those deadlines. Only a higher authenticated grant sequence for unchanged content may replace transport expiry.

Verifier authority/path observations last at most 5,000 ms from their recorded boot-elapsed observation. Poll independent sources at most 1,000 ms apart. Polling a stale result cannot renew freshness.

For each scope, the effective deadline is the earliest transport, authority, path, stop or withdrawal deadline. Install kernel timed permission at least 1,000 ms earlier to reserve closure time. Refuse activation if that leaves no positive interval. Kernel permission must expire without application, helper or verifier userspace progress.

The helper independently checks deadlines, durable stops and ownership every 100 ms. The supervisor independently watches process health and deadlines. A helper/verifier crash or stall must therefore leave only the already bounded kernel permission, while the supervisor closes remote worker processes. The proposed 5,000 ms observation bound also limits stale authority if the independent verifier cannot refresh.

A learned withdrawal advances its scope’s durable floor and removes permission immediately. The proposed 1,000 ms closure bound starts when the helper or supervisor accepts a complete authenticated stop/withdrawal observation, rather than at an unknowable remote event. Safety closure uses an independent supervisor path and guard, bypassing the ordinary 2,000 ms effect turn and its queue. The supervisor closes its guard and remote workers within that bound; an in-flight helper transaction cannot recreate supervisor permission. Timer/guard and custody failures report uncertainty and block enablement until G7 proves this bound. A partition provides no instantaneous Cloud revocation receipt; the existing observation/grant deadlines bound access.

Detect backward wall-clock movement exceeding 1,000 ms against elapsed progress; close remote scopes within 1,000 ms rather than recomputing longer deadlines. Forward jumps shorten access. Unknown clock trust closes access. None of these rules changes fiscal time.

On helper restart, block first, inspect owned state and require fresh boot-bound evidence. On host reboot, never reactivate from cached remaining duration. Keep saved absolute expiry, counters and stop floors; require authenticated current recovery and clock establishment. Missing or unreadable established safety state is closed, not a first installation.

## Stage, retry and read-back

Validate the complete request, caller, records, gates, identity, generation, scope and deadlines before any requested effect. An independently due safety closure may still proceed while a request is rejected.

Persist intent and high-water marks before effects. Install the closed baseline before making the peer reachable; stage resources, inspect exact state, then activate timed permissions in one proposed atomic rules transaction. Recheck stop and authority immediately before activation.

Preserve installation revision, content revision and grant sequence separately. Same content revision with changed digest is a conflict. An equal grant replay never extends time. A grant-only renewal neither rebuilds the peer nor changes certificate intent. A persisted local disconnect stop is cleared only through a separately accepted authenticated reconnect/recovery decision with a higher stop generation; ordinary activation or a fresh grant cannot clear it. Until that G1 decision and the mapping for expired/withdrawn/fault scope floors are defined, a stopped scope stays closed. A new remove command must carry a stop generation strictly above every targeted scope’s floor; equal-generation replay is served only through its saved operation sequence.

For every mutating operation, bind replay identity to authenticated caller, node, generation, sequence, ID, operation and exact request-byte digest. Persist the caller’s sequence high-water mark and operation intent before effects. At a cached sequence, identical bytes recover the saved result and changed bytes or ID produce `replay_conflict`. An uncached sequence at or below the floor produces `stale_counter`, regardless of ID; only a higher sequence starts new work. Cache eight complete results but retain each of the three fixed caller roles’ high-water marks independently. ID reuse at a higher sequence is a new operation, not historical replay recovery; no unbounded ID ledger is promised. Inspect uses sequence zero, no replay cache and no floor write. While an effect remains unresolved, refuse ordinary new mutations as busy; inspection may reconcile it, and safety removal still bypasses it. Admission cannot depend on cache eviction.

A crash or timeout after an effect begins yields `may_have_applied` until inspection resolves it. Retry the same operation identity; do not allocate another generation to escape uncertainty. If state persistence, read-back or activation is partial, keep admission closed and reconcile only confirmed owned resources.

Application acknowledgement loss changes no helper deadline. Application/Cloud reporting must retain its own accepted report identity and bytes; a helper response does not define the unresolved Cloud acknowledgement protocol.

Removal persists the relevant scope stop and immediately closes the independent guard before waiting for ordinary cleanup; persistence cannot delay emergency blocking. A persistence failure yields uncertainty, never a durable-stop success receipt, and requires explicit recovery after restart. Cleanup clears all matching timed permissions, then removes owned peer/routes/rules as appropriate. A single-scope removal preserves independently authorised scopes; `both` also removes the peer and owned routing. Keep the closed guard until cleanup has been read back.

Verify removal by fresh enumeration of the owned interface/peer, addresses, routes, policy rule, timed permissions and rules. Separate:

- `observed_blocked`: permission is observed closed, but resources remain.
- `verified_removed`: the complete recorded resource set is observed absent, with no unresolved ownership.
- `unknown`: inspection failed, timed out or could not identify an object.
- `may_have_applied`: an operation crossed the effect boundary without a conclusive result.

A closed IPC socket, lost response, process exit or successful command return is not a network-removal receipt.

Network blocking also does not prove application listener closure. The independent supervisor must attest closure of the purpose’s listener and accepted sockets, using custody bound to process lifetime rather than a reusable PID. **That custody implementation remains outstanding.** Until accepted and qualified, listener state is `unknown`; no complete active-connection-closure claim or real admission is permitted.

Staff/public certificate withdrawal closes only its own path. Shared transport expiry closes both remote paths and probe. `.local`, its TLS identity and unrelated LAN/default routing remain outside these effects. Previously accepted business work still needs application reconciliation; closure never reverses or repeats a payment.

## Response schema and literal vectors

Responses contain exactly `v:1`, `id:H`, `sequence`, `status`, `effects`, and the fields permitted here. `status` is `ok`, `replayed`, `rejected` or `uncertain`; `effects` is `none`, `observed` or `may_have_applied`.

`ok`/`replayed` require `result`; `rejected` requires `code` and `effects=none`; `uncertain` requires `code`, `result` and `effects=may_have_applied`. A result has exactly `node:H`, `generation:U`, `intentRef:D|null`, `contentDigest:D|null`, `phase`, `ownership`, `boot`, `observation`, `atBootMs`, `scopes`, `resources`. `scopes` contains all three scopes in staff/public-upstream/probe order, each exactly `{scope,phase,network,listeners,stopGeneration:U,withdrawalGeneration:U,deadlineBootMs:timestamp|null}`. Overall phase is active when any scope is active, partial when unresolved effects exist, otherwise staged/blocked/absent as applicable. It never asserts all scopes share a state.

Response sequence echoes the request; only a mutating operation can report `may_have_applied`. A read-back failure during inspect returns rejected/readback_failed with no requested effects.

Enums are: phase `absent|staged|active|blocked|partial`; network `observed_active|observed_blocked|verified_removed|unknown`; listeners `ready_verified|closed_verified|pending|unknown`; ownership `owned|foreign|absent|unknown`. `boot:H`, `observation:U`, timestamps as above; deadline alone may be null. Resources contain at most 16 `{kind,id,state}` entries with fixed kind `link|peer|address|route|rule|firewall`, registry-derived ASCII ID at most 128 bytes, and state `present|absent|unknown`.

Closed rejection codes are `invalid_schema`, `unsupported_version`, `unauthenticated`, `unaccepted_dependency`, `stale_generation`, `stale_counter`, `replay_conflict`, `scope_denied`, `ownership_conflict`, `stopped`, `expired`, `busy`, `deadline`, `readback_failed`, `unsupported_host`, `unknown_state`. Never echo rejected input or raw errors. Invalid framing closes the connection without effects or a response.

Below, `F(s)` means the exact four-byte length prefix followed by the exact displayed UTF-8 JSON, without a trailing newline. Internal displayed newlines are payload bytes. Every example is a proposed fixture oracle, not an executed receipt.

Positive inspection request: prefix **`00 00 00 ab`**, followed by these 171 bytes:

```json
{
  "v": 1,
  "id": "00000000000000000000000000000001",
  "sequence": 0,
  "op": "inspect",
  "node": "11111111111111111111111111111111",
  "generation": 1,
  "body": {}
}
```

With established fixture safety, synthetic closed listener-custody receipts and a successfully enumerated empty resource set, response `F(s)`:

```json
{
  "v": 1,
  "id": "00000000000000000000000000000001",
  "sequence": 0,
  "status": "ok",
  "effects": "observed",
  "result": {
    "node": "11111111111111111111111111111111",
    "generation": 1,
    "intentRef": null,
    "contentDigest": null,
    "phase": "absent",
    "ownership": "absent",
    "boot": "22222222222222222222222222222222",
    "observation": 1,
    "atBootMs": 100000,
    "scopes": [
      {
        "scope": "staff",
        "phase": "absent",
        "network": "verified_removed",
        "listeners": "closed_verified",
        "stopGeneration": 2,
        "withdrawalGeneration": 4,
        "deadlineBootMs": null
      },
      {
        "scope": "public-upstream",
        "phase": "absent",
        "network": "verified_removed",
        "listeners": "closed_verified",
        "stopGeneration": 2,
        "withdrawalGeneration": 4,
        "deadlineBootMs": null
      },
      {
        "scope": "probe",
        "phase": "absent",
        "network": "verified_removed",
        "listeners": "closed_verified",
        "stopGeneration": 2,
        "withdrawalGeneration": 4,
        "deadlineBootMs": null
      }
    ],
    "resources": []
  }
}
```

After fixture preparation and staging, the authenticated fixture verifier may send `F(s)`:

```json
{
  "v": 1,
  "id": "00000000000000000000000000000002",
  "sequence": 1,
  "op": "activate",
  "node": "11111111111111111111111111111111",
  "generation": 1,
  "body": {
    "intentRef": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "evidenceRef": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  }
}
```

If the injected fixture proves scope readiness and read-back, the response is `F(s)` below. The resource list enumerates the complete seven-object fixture inventory. Both active scopes have synthetic verified readiness/custody; public remains absent. This is a composed synthetic oracle, not kernel or production evidence.

```json
{
  "v": 1,
  "id": "00000000000000000000000000000002",
  "sequence": 1,
  "status": "ok",
  "effects": "observed",
  "result": {
    "node": "11111111111111111111111111111111",
    "generation": 1,
    "intentRef": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "contentDigest": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "phase": "active",
    "ownership": "owned",
    "boot": "22222222222222222222222222222222",
    "observation": 2,
    "atBootMs": 100000,
    "scopes": [
      {
        "scope": "staff",
        "phase": "active",
        "network": "observed_active",
        "listeners": "ready_verified",
        "stopGeneration": 2,
        "withdrawalGeneration": 4,
        "deadlineBootMs": 104000
      },
      {
        "scope": "public-upstream",
        "phase": "absent",
        "network": "verified_removed",
        "listeners": "closed_verified",
        "stopGeneration": 2,
        "withdrawalGeneration": 4,
        "deadlineBootMs": null
      },
      {
        "scope": "probe",
        "phase": "active",
        "network": "observed_active",
        "listeners": "ready_verified",
        "stopGeneration": 2,
        "withdrawalGeneration": 4,
        "deadlineBootMs": 104000
      }
    ],
    "resources": [
      { "kind": "link", "id": "wg-a9510", "state": "present" },
      { "kind": "peer", "id": "fixture-peer", "state": "present" },
      { "kind": "address", "id": "fixture-box-address", "state": "present" },
      { "kind": "route", "id": "fixture-gateway-route", "state": "present" },
      { "kind": "rule", "id": "fixture-policy-rule", "state": "present" },
      { "kind": "firewall", "id": "wt_a951_v1", "state": "present" },
      { "kind": "firewall", "id": "wt_a951_guard_v1", "state": "present" }
    ]
  }
}
```

The same activation from application UID 991 is rejected before effects:

```json
{
  "v": 1,
  "id": "00000000000000000000000000000002",
  "sequence": 1,
  "status": "rejected",
  "effects": "none",
  "code": "unauthenticated"
}
```

The same fixture request through production construction is rejected before effects:

```json
{
  "v": 1,
  "id": "00000000000000000000000000000002",
  "sequence": 1,
  "status": "rejected",
  "effects": "none",
  "code": "unaccepted_dependency"
}
```

Additional literal rejection inputs and required outcomes:

| Input or fixture change                                           | Required outcome before requested effects                                        |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Prefix `00 00 40 01`                                              | Oversize frame; close without reading an allocated payload or applying anything  |
| Payload `{"v":1,"v":1}`                                           | Duplicate key; `invalid_schema` if a reliable request ID exists, otherwise close |
| Valid inspection with `"op":"exec"`                               | `invalid_schema`                                                                 |
| Valid preparation body with additional `"path":"/tmp/a951"`       | `invalid_schema`                                                                 |
| Intent `box4="0.0.0.0/0"` or `gateway4="::1/128"`                 | `invalid_schema`                                                                 |
| Intent `gateway4="10.254.19.3/32"` against the fixture assignment | `scope_denied`                                                                   |
| Request `generation=2` against registered generation 1            | `stale_generation`                                                               |
| Reuse activation sequence 1 with another `evidenceRef`            | `replay_conflict`                                                                |
| Mutation sequence 1 after result eviction and floor 9             | `stale_counter`; no requested effect                                             |
| Foreign wildcard listener on TCP9444 or occupied UDP51821         | `ownership_conflict`; install no traffic guard                                   |
| Evidence `grantSequence=10` after floor 11                        | `stale_counter`                                                                  |
| Evidence `authorityUntilBootMs=100000` at boot-elapsed 100000     | `expired`                                                                        |
| Existing `wg-a9510` with another ownership nonce                  | `ownership_conflict`; leave it untouched                                         |
| Request public scope without accepted G4/G6 evidence              | `unaccepted_dependency`                                                          |

## Lane G acceptance/amendment checklist

- [ ] Accept or amend the independent verifier/supervisor topology, host identities, mounts and local caller trust boundary.
- [ ] Accept or amend framing, closed schemas, literal vectors, byte/count/time bounds and all proposed numerical policy.
- [ ] Map local intent/evidence references to the eventual G1/G2 proofs, counters, stop/withdrawal floors and authenticated establishment/recovery without treating fixture records as proof.
- [ ] Accept or amend the owned namespace, collision handling, IPv4-only matrix, IPv6 denial and every-packet expiry enforcement.
- [ ] Agree the separate network-removal and listener-custody receipts, crash/partial-apply outcomes and required G7 fault evidence.
- [ ] Record the accepted joint artifact digest, both consumer pins and precise scope in both ledgers before affected adapters start; retain G4/G6 admission, G5 movement and G7 runtime qualification as unresolved gates.
