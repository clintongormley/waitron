# A951 appliance v1 successor for D582 cross-review

**Artifact:** `waitron-a951-appliance-v1`

**Edition:** `proposal-2026-11-05.1`

**Proposed destination:** `docs/superpowers/specs/2026-11-05-a951-appliance-v1-successor.md`

**Status:** PROPOSED engineering requirements; new validation UNRUN. Full appliance acceptance, accepted executable consumers and qualified runtime pair: **NONE**. Admission: **CLOSED**.

This is the complete appliance successor, incorporating the immutable requirements below and explicitly replacing their unresolved local-approval premise. It is not merely an approval-channel amendment. Publication permits documentation cross-review; it supplies no runtime integration, deployment, provider operation, partial-foundation finishing, push, PR or landing authority.

Hash the entire UTF-8 publication file, including its final LF, outside this file. There is no self-hash or separate review-content boundary in this edition.

## 1. Complete inheritance and precedence

The following full-file digests identify immutable publications. The driver verified them with SHA-256 over the complete local files, including final LF. They identify documentary inputs, not executable consumer pins or runtime receipts.

| Ref | Immutable publication | Complete publication SHA-256 |
| --- | --- | --- |
| A | [Appliance](2026-10-23-a951-appliance-v1-proposal.md), `waitron-a951-appliance-v1` / `proposal-2026-10-23.1` | `f97dbc1864e37911ecb9d16dd87b436d729fd43bbef220633c3b09cae7c93fb0` |
| H | [Helper](2026-10-23-a951-local-helper-v1-proposal.md), `waitron-a951-helper-v1` / `proposal-2026-10-23.1` | `da433f66a7dcb835e99eeb4a7e5c6f01f2bc9c69db369c44a5131247a4ab008f` |
| X | [Host custody](2026-11-02-a951-host-custody-amendment.md), `waitron-a951-host-custody-v1` / `proposal-2026-11-02.1` | `50001abafc7c3edea270821e0a8570f8c722969d62132070a46d9cd3729956d2` |
| Y | [Debian successor](2026-11-05-a951-debian13-host-profile.md), `waitron-a951-host-custody-v1` / `proposal-2026-11-05.1` | `616725294c22f06abc86d340b7206609c528b39f3ef93e38c0c0486c551dde90` |
| M | [Cloud mapping](https://github.com/waitron-io/waitron-cloud/blob/b1a8d7cee1056a0aac14adba53e03f270ac4263c/docs/superpowers/specs/2026-11-02-a951-g1-host-custody-mapping.md), `cloud-a951-g1-host-custody-v1` / `proposal-2026-11-02.1` | `2f16bd7c01c12849897501fae3bccabb770f9db4006e917b9964573bf994a9cf` |
| R | [Routing revision 2](2026-10-23-a951-routing-v1-revision2.md), `waitron-a951-routing-v1` / `proposal-2026-10-23.2` | `974c4e98eb7d583d82ad1c573f9dcec01c63b2cc4f6630d38aeda22775d198d0` |

Incorporate A’s entire normative content: the bytes after the LF following `<!-- BEGIN waitron-a951-appliance-v1 proposal-2026-10-23.1 -->` and before the first `<` of its END marker, including the LF immediately before END. Its separate normative review-content digest is `fede39bb64077167f145c942cc63599526ab48fae0274e4cc0b8a4e6efcca728`. That value is **not** A’s full-file digest. A’s cover, provenance, acceptance checklist and publication-verification paragraph retain their historical evidential roles; they do not become new runtime proof.

Incorporate H completely, X §§1–9, Y completely, M §§1–9 and R completely. This includes **every row** of A’s tables and mutation matrix, H’s operation/network/vector/checklist tables, M §2’s complete G1 acceptance matrix and §§3–9’s representations, dependencies, vectors and task amendments, and X §9’s complete qualification matrix. No row is omitted by the summaries below.

Apply this precedence only where requirements conflict:

1. The owner decision and explicit changes in this successor.
2. Y’s Debian-target, pinset-metadata and scheduling changes.
3. M’s explicit appliance/helper safety, closure and intact-reboot mapping.
4. X’s custody refinements, H’s unchanged numerical/helper contract, A’s appliance contract and R’s separate routing contract.

Unchanged requirements apply together. Silence does not delete a predecessor requirement. Preserve all predecessor bytes.

The reviewed D582 engineering input is identified by SHA-256 `f9d16d701abd4aff36272232dd3bb20ab25719b535042074fde767a2191c12de`. Retain its five accepted E correlation amendments and exact encodings below. Replace only its protected permission-producer/owner-service premise with §2.

## 2. Owner-selected local trust boundary

The owner chose v1 option A: trust **Waitron server’s own current-permission check**. The 17:52 proposal moving store ownership, sign-in ingress and TLS/private identity authority behind a protected owner service is rejected. Do not reopen it.

The application retains normal existing database access. Existing server identity tables remain the source for local actor/session/current `system.manage` checks. No protected sole-store owner, new protected sign-in ingress, relocated TLS authority or application database restriction is introduced.

This is an explicit exception to X/M’s untrusted-application premise **for local approval evidence only**. A compromised server can lie about the local actor, session and current `system.manage`, and ask the constrained supervisor signer for that bound Decision and Consumed fact. Consequently, false local approval can cross the local half of establish, recover or reconnect for the **exact legitimately provisioned binding**, but only if the independent Cloud current-owner check and every other predicate also succeeds.

The signer does not authenticate a person. Its custody does not prove the server’s permission assertion true. Server compromise also exposes the database and secrets already accessible within the existing application boundary; this proposal adds no protection claim for them.

That exception cannot itself create a Cloud owner, provision a new binding or keys, clear safety floors/stops/history, obtain arbitrary signing, helper/network/command access, or confer writer, fiscal, customer-product, provider or deployment authority. H/M’s independent guards, protected participants and packet/socket custody remain required. There is no blanket expansion of application trust.

## 3. Retained appliance and helper contract

The following requirements remain executable obligations through §1’s complete incorporation.

| Boundary | Retained requirement |
| --- | --- |
| Encoding/types | A’s duplicate-aware canonical printable-ASCII `J`, exact member/array order, safe integers, closed enums, null unions and canonical unpadded base64url. `N=0..9007199254740991`, `U=1..9007199254740991`, `H=32` lowercase hex, `D=64` lowercase hex, `T=N` Unix milliseconds; UUID, I, B, F, S and W remain exactly A §1. |
| Actions/endpoints | Exactly POST `/api/installations/` plus `appliance-fetch`, `appliance-report`, `appliance-report-status`, `appliance-establish`, `appliance-recover`, `appliance-reconnect`, `appliance-trust`. Preserve every ordered Q field, successful R, refusal code and unavailable result in A §2. |
| Authentication/signatures | Preserve machine, response, grant and Trust signed arrays, request/content/report digest domains, independent purpose keys, configured exact HTTPS origin, proof/lease rules and current registration checks. No appliance action is silently added to staff-v1 or a gateway verifier. |
| Content/counters | Preserve exact C, names, manifest, certificates and fixed topology; independent installation revision, content revision and grant sequence; separate request/report/trust/epoch/helper/source floors. Equal revision with changed content conflicts; equal grants never extend deadlines. Exhaustion refuses. |
| Fetch/replay/report/status | Preserve eight request results, eight report results, permanent floors, one pending report and independent latest-fetch slot. Only exact latest-fetch supersession may replace unanswered fetch work. Preserve Report/O fields, digest, durable recorded result, fresh status correlation and unknown rather than absent after eviction. |
| Certificates | Preserve A §5’s exact purpose-specific projection, all intent-equality inputs and invalidation rows. Equal-content grant renewal preserves CSR/key/body/UUID/predecessor. Staff-v1 remains unchanged, opt-in and test-only; its `revision` remains installation configuration revision. G3 client policy and G4 public identity/exchange remain separate. |
| Establish/recover/reconnect | Preserve exact anchor, Permit, Q and response records, original expiry and durable one-use rules. Establish requires proven never-established state. HIGH WATER recovery preserves authenticated maxima/history and returns closed state. Reconnect alone may clear targeted operator latches through exact expected S/W and next-S comparison. |
| Trust | Preserve offline-root provisioning, purpose-separated issuers, complete 256-entry lifetime history, restrictive union, permanent retired/revoked tombstones and refusal when complete required history is lost. A reply cannot install a root or reconstruct omitted history. |
| Helper/custody | Preserve H’s five operations, caller restrictions, framing/EOF, schemas, owned resources, complete network matrix, generation handoff, independent guards and separate network/listener outcomes. X’s native caller, broker, accepted-socket handles, confinement, watchdog and retirement requirements remain proposed native obligations. |
| Limits/time | Preserve every A/H/M byte, count, rate, HTTP, retry, refresh, clock, expiry, observation, polling, effect, acknowledgement and closure bound. Count ceilings never promise that all maximum-sized records fit together. |

In particular, transport grants last at most 600,000 ms; Permit authorization at most 300,000 ms; wall uncertainty is at most 30,000 ms and is subtracted. Preserve first saved boot deadlines, suspend-aware elapsed time, backward-clock closure and all equality-at-expiry refusals. HTTP connect/TLS, full-response and server-read bounds remain 5,000/10,000/5,000 ms, without redirects, compression or automatic POST retries.

A/M automatic renewal and temporary revalidation remain distinct from independent operator-stop latches. Logout, idle expiry or role change **after completed establishment publication** creates no permanent login dependency and no operator-stop latch. Before publication, the original consume and final current-permission checks remain mandatory.

## 4. Exact approval-channel bytes

This proposed channel is separate from A’s closed Trust schema. It introduces no Trust purpose.

The box initiates HTTPS to the configured exact Cloud origin through a separate, initially unmounted approval adapter, outside the seven appliance POSTs and staff-v1. No browser cookie, bearer, local session secret or Cloud session secret crosses it.

Use dedicated Ed25519 Cloud-challenge and local-approval keys. A key ID is SHA-256 of canonical Ed25519 SPKI DER. `E={"payload":base64url,"signature":base64url}` retains A’s exact ordering and encoding; signatures cover decoded canonical payload bytes. Define `D(x)` here as SHA-256 of exact canonical bytes x, including any domain inside x.

The three signed payload arrays are exactly:

`["waitron-a951-approval-decision-v1",localKeyId,actorRef,sessionRef,contextDigest,issuedMs,expiresMs]`

`["waitron-a951-approval-challenge-v1",cloudKeyId,localApprovalRef,challengeNonce,permitDigest,qDigest,anchorDigest,pinsDigest,issuedMs,expiresMs]`

`["waitron-a951-approval-consumed-v1",localKeyId,localApprovalRef,challengeDigest,consumedMs]`

Digests, key IDs and actorRef/sessionRef are D; challengeNonce is fresh random H; times are T. actorRef/sessionRef are private per-decision random non-bearer references, resolved locally to the original person/session. They are neither credentials nor hashes of session tokens.

The exact 19-position context, including its domain, is:

`["waitron-a951-approval-context-v1",kind,B,expectedEpochOrdinal,resultEpochOrdinal,nextEstablishmentEpoch,expectedGeneration,operationId,requestSequence,nonce,minimumFloors,expectedStops,expectedWithdrawals,nextStops,issuedMs,expiresMs,permitId,boot,pinsDigest]`

Values retain their corresponding A types. The final three positions have types H, H, D. `expectedEpochOrdinal=Q.epochOrdinal`; `resultEpochOrdinal=Permit.epochOrdinal`; B contains the expected establishment epoch. Establish/reconnect preserve epoch/ordinal; recover requires a new epoch and strictly higher result ordinal.

The exact pin array is:

`["waitron-a951-approval-pins-v1",[applianceId,edition,digest],[mappingId,edition,digest],[hostId,edition,digest],[helperId,edition,digest],[routingId,edition,digest],cloudConsumerCommit,waitronConsumerCommit,approvalPolicyDigest]`

Rows are mandatory in that fixed order. Use exact published ASCII identities/editions and D digests of complete immutable publication files, including final LF. The host row names Y and its authenticated X/H inheritance. Appliance means this successor, mapping means the applicable accepted mapping, helper means H and routing means R. Consumer commits are full 40-lowercase-hex Git SHAs. `NONE`, inspection pins and missing-row sentinels cannot authorize. `approvalPolicyDigest` identifies the authenticated approval-only key/binding policy.

| Reference | Exact hashed bytes, without LF |
| --- | --- |
| contextDigest | J(complete context array) |
| localApprovalRef | J(complete Decision payload) |
| permitDigest | J(complete A Permit, including localApprovalRef) |
| qDigest | J(complete action-specific Q, including original Q.floors and localApprovalRef) |
| Non-null anchorDigest | J(exact authenticated establishment-anchor record) |
| pinsDigest | J(complete pin array) |
| challengeDigest | J(complete Challenge payload) |

No extra domain prefix/suffix is added to these hashes. Preserve A’s distinct `requestDigest=SHA256(ASCII("waitron-a951-request-body-v1") || LF || UTF8(J(Q)))`. Hash neither base64 text nor outer E; retain and verify exact signed envelopes separately.

Before Decision issuance, save all Q construction inputs, **including original Q.floors independently of Permit.minimumFloors**. Preallocate non-authorizing permitId; require `Permit.id=Q.permitId=permitId`. Bind original boot and pinsDigest at issue, consume and final publication. Context/Decision issue and expiry equal the original candidate Permit values, with `0 < expiresMs-issuedMs <= 300000`. Challenge expiry is no later and never refreshes them.

After Decision exists, complete Permit/Q/new establishment anchor with localApprovalRef; compare every completed field against saved inputs before consumption. This avoids a digest self-reference. A historical recover/reconnect anchor keeps its original correlations.

| Kind | AnchorDigest policy | Stop/epoch policy |
| --- | --- | --- |
| establish | Mandatory root-provisioned anchor; non-null digest and exact current correlations. Absence refuses; Cloud independently proves never established. | Permit nextStops=expectedStops; Q adds no stop fields. Epoch/ordinal unchanged. |
| recover | Hash surviving authenticated original anchor. Null only on an explicitly accepted authenticated surviving-evidence path proving identity, maxima and complete history without it. | Preserve known latches; strictly higher result ordinal/new epoch; no other binding change. Q adds no stop fields. |
| reconnect | Hash surviving original anchor. Null supplies no damage exception; absent an explicitly accepted anchor-independent path proving all required evidence, refuse. | All three stop arrays match Q/Permit; targeted next S=expected S+1, others unchanged; W preserved; epoch/ordinal unchanged; revoked identity refuses. |

Context stop arrays always come from Permit. Do not invent null stop members or infer floors from missing files. Changed original Permit/Q/boot/pins requires a fresh explicit decision, never mutation of spent evidence.

Each channel envelope is at most 4,096 UTF-8 bytes. Referenced records resolve only in bounded authenticated fixed registries, never arbitrary URLs/paths or attachments. Apply A’s closed parser and HTTP bounds. Maximum-size fit remains UNRUN.

## 5. Proposed provisioning and signer seat

REG/POL must authenticate exact binding, purpose, origin/environment, key ID and public SPKI, proof of possession and an **independent existing current Cloud owner**. Machine self-registration, public-key possession or root ownership alone cannot enroll approval authority.

For D disposition, E proposes this closed policy payload:

`["waitron-a951-approval-policy-v1",policyRevision,origin,channelBinding,previousPolicyDigest,keys]`

`policyRevision:U`; `previousPolicyDigest:D|null`, null only for authenticated initial enrollment. `channelBinding` is exactly `[originId,environment,cloudVenue,installation,localVenue,node,machineIdentity,target,placementEpoch]`, using A types. It fixes all non-recovery identity fields; the current establishment epoch/ordinal remains independently authenticated through A/M safety and authorized recovery.

`keys` contains exactly two rows, Cloud then local:

`[keyId,purpose,spkiBase64url,state]`

Purposes are respectively `cloud-challenge` and `local-approval`; state is `active|revoked|retired`. SPKI follows A’s Ed25519 DER encoding/bound. Policy digest is SHA-256 of J(payload). Authenticated provisioning must preserve the predecessor chain and permanent revoked/retired identities; missing history, changed equal revision or reintroduction refuses. Retention consumes the existing budget; capacity refuses further enrollment rather than discarding evidence.

Proposed possession proof payload:

`["waitron-a951-approval-provisioning-proof-v1",policyDigest,keyId,nonce,issuedMs,expiresMs]`

Sign with the corresponding dedicated key, nonce H, times T, lifetime at most 300,000 ms. Proof establishes possession only. REG/POL separately records authenticated local provisioning and Cloud owner authorization; exact approval-policy authentication/signoff machinery remains a D contract disposition, not an inference from this proof.

Proposed fixed adapter paths are `/api/a951-approval/challenge`, `/api/a951-approval/consumed` and `/api/a951-approval/status`, POST only. They carry/resolve the exact three channel envelopes and bounded candidate records; they add no generic command or fourth signed payload. Status recovers retained exact facts and cannot create authorization. Endpoint/method/status details require D agreement before mounting.

The native supervisor retains the independently generated local private key in its fixed root-private store. Its seat permits only these schema-validated approval/provisioning facts for the enrolled binding; no export, arbitrary bytes, caller-selected purpose, URL, path, shell or argv. Machine, lease, root, recovery, TLS, CA and WireGuard keys cannot substitute. No Cloud private key or new owner-held secret goes to the box.

Retain the key across intact reboot only with valid surviving custody/state. Exclude private material and endpoint-local approval state at archive collection **and** import. Restore/enrollment cannot invent lost maxima/history. Replacement remains G5-gated and refused; ordinary local restore/CA recovery stays independent.

## 6. Proposed local issue, consume and historical signing

Propose `apps/server/src/connection/local-approval.ts` with `issueLocalApplianceDecision`, `consumeLocalApplianceDecision` and `publishLocalApplianceDecision`. These are missing implementation consumers, not current functions.

Browser ingress retains existing management authentication and exact management Origin/CSRF boundary. Initial issue resolves the original authenticated cookie to internal person/session-row references. Background consume/publication uses only that saved private mapping through a proposed identity-internal row resolver. It must never expose row IDs as a public login method or call the existing token resolver with a row ID.

At issue and consume, the existing exclusive server database writer re-reads the original session: it still exists, is unended, joins the same active person, remains within existing idle rules and has current `system.manage`. Background checks do not touch lastSeenAt. Re-read exact singleton venue/node/installation/endpoint and all operation correlations after waits.

Save a bounded pending record containing original subject references, immutable context/pins/Q inputs, expiry and phase. No bearer, password, token hash, MFA material or credentials enters the approval journal or Cloud message.

`issueLocalApplianceDecision` creates pending evidence only. `consumeLocalApplianceDecision` rechecks current permission and all correlations in the **same short local write turn** that excludes session/permission revocation, then durably records spent identity, exact challengeDigest and consumedMs before releasing that turn. No network, signer, helper or participant wait occurs inside it.

Signing occurs afterwards over the saved exact historical fact. It is not a fresh permission check. Separate phases are unsigned durable pending/spent fact, signing outstanding, and exact signed envelope durably saved. Supervisor saves the exact signed envelope before replying; server saves it before onward use.

One decision accepts one challenge identity. Identical replay returns the original retained fact/envelope; changed challenge conflicts. Expired pending work cannot consume. Spent never returns to pending. Missing, corrupt, rolled-back or ambiguous evidence is unknown and closed.

The identity database, application approval journal and supervisor journal are separate durability domains. There is no two-file atomicity assumption. A crash can leave spent without a usable signed reply; preserve spent. Resume only the demonstrably identical saved historical fact, never new time, challenge, approval reference or authorization. Lost evidence cannot be recreated from a caller assertion. If implementation requires a new table to establish this durable relationship, **A1308/A760 holds that work**; this publication adds no table or migration.

Cloud waits for the exact authenticated Consumed fact outside its transaction. In its own consume transaction it independently rechecks the **original current owner session**, exact venue/installation ownership, machine nonrevocation, Permit/nonce/epoch/generation/floors/S/W and original expiry after waits. Only then may it durably create/consume the exact Permit and save result/signing metadata. Persist the exact recovery-purpose signed response before reply. Local spent evidence alone creates no Cloud success; Cloud success cannot repair local uncertainty.

## 7. Final local publication and race disposition

Local consumption is necessary but insufficient for final publication. Preserve M’s four-store prepare/commit, exact shared heads, retained completion receipts and independent final guard checks.

E proposes the following explicit completion boundary for D review:

1. Prepare participants and collect their exact receipts with guards closed, outside database/control locks. Complete M’s required durable commits/read-back and prepare the exact supervisor custody plan, still closed.
2. Immediately before final **server publication**, take a bounded pending-operation `inTurn` step, then the existing short database write turn. Re-read the original session/person/current permission, original expiry, actual current boot, usable original pins/policy, exact operation, all four shared heads/completion, generation, history, floors, stops, withdrawals and holds. No RPC runs here.
3. Save the exact final publication record, correlated to localApprovalRef, challengeDigest, Cloud result, transaction/heads, boot, pinsDigest and planRef, before releasing the turn. Call this winning point **L**. Failed/ambiguous persistence leaves publication unknown and closed.
4. After release, send that exact publication to the supervisor. Its acknowledgement names the same publication/transaction/plan and current invocation. It independently checks current protected heads, stops, trust, boot, pins/policy, custody and original deadline before allowing effects. A stale message or acknowledgement cannot arm another operation.
5. Save the exact acknowledgement. Lost replies recover only that publication’s retained status; they cannot mint another publication or extend expiry.

The pending record advances through prepared, publishable, published, acknowledged or cancelled/unknown states; it is bounded current operation state, not a new global permission database. Each `inTurn` step is released before IPC. No database, control, participant or pending-operation exclusion is held while waiting on another process.

**Proposed ordering:** local revocation committed before L wins and prevents publication. A local consume that won earlier stays historically spent. Revocation after L does not undo the completed establishment authorization or create a login-dependent transport latch. Independently learned stops, withdrawals, trust/key revocation, changed heads or expiry still block supervisor use. Cloud has its separate winning consume transaction; there is no simultaneous two-host commit.

L transfers the trusted server’s checked decision; the supervisor does not authenticate the person. This proposal deliberately distinguishes server publication from later physical opening and acknowledgement. It does **not** claim an unlocked RPC is atomic with permission changes.

**Outstanding engineering agreement:** D must disposition L as the completion boundary and the exact bounded publication/ack record grammar. If D requires permission revocation to win until supervisor acknowledgement or actual opening, this ordering does not prove that stronger exclusion. No protected permission service, unapproved native fence or timed permission snapshot is silently substituted. That stronger race remains unresolved and affected integration stays CLOSED until a concrete compatible ordering is agreed.

## 8. Independent safety, host and remaining gates

Retain M’s four independent application/helper/verifier/supervisor safety copies, complete history, restrictive union and root-protected nonapplication persistence. Each safety record, including staged copies, remains within 65,536 bytes. M’s 55,801-byte reservation is inherited design arithmetic, not this author’s serializer proof.

Preserve `Shared(State)` exactly: omit only callerFloors, observationSequence and custodySequence. Role-local progress merges without changing the committed shared head. PP never pre-consumes an H sequence. Prepare grants nothing; a newer stop in any store invalidates stale completion. No participant writes another’s safety directory.

There is **one aggregate 262,144-byte journal**, with its **16,384-byte emergency reserve inside it**; ordinary peak occupancy is at most 245,760. Count all pending/signed approval and provisioning records, provenance, phase/publication/ack bytes, indexes/framing, PP decisions, replay results, live metadata, unfinished retirements and old/new/temp peak writes. No extra allowance or maximum-size fit is claimed. Reserve complete growth before work; never evict referenced evidence or safety history. Storage failure closes immediately without claiming durable-stop success.

Target native x86_64 **Debian 13**, `a951-debian13-systemd-docker-v1`, with Y’s unpopulated pinset revision. Preserve X’s complete loaded-pin inventory, GUARD16, confinement, accepted-socket custody, sleep prevention, pre-sleep closure and separate packet/listener measurements. Later cleanup cannot prove elapsed listener closure during suspension.

The supplied 13:15 relay records G’s planning-only host agreement; it does not qualify a runtime or accept the full appliance. Preserve H’s isolated T3, R’s isolated T4 and M’s isolated-planning scopes. Historical pending notices remain unchanged.

G2 actual A947 authority/freshness/withdrawal remains independent. G3’s joint client numbers remain open. G4 independent upstream identity/issuer/trust/mTLS remains open. G5 moves/replacement is refused. G6 diagnostics and A980/D101 processing/access/destinations/retention, including staff metadata, remain open. G7 exact executable/host/image/DNS/issuer/device/origin qualification remains open. After takeover M2 handles AEAT; A951 supplies no filing authority.

Both production manifests retain exactly these **83 ASCII bytes, no final LF**:

`{"schema":"waitron-a951-routing-v1","revision":"proposal-2026-10-23.1","routes":[]}`

Digest: `271fefd892b2c0f10ffab42f8e4a832a163b244733285f08d5a0ea1dfab1b012`.

Keep `.local` independent. Add no location field, table, migration or fiscal change.

## 9. Inspection receipts, provenance and acceptance obligations

These local source references at Waitron inspection base
`00d72fda423562db56de485ab68f6c196223f093` are **inspection only**, not runtime
proof or accepted consumer pins. The driver compared the named source bytes
against that base; proposed functions and orchestration remain unimplemented:

| Source | Inspected boundary |
| --- | --- |
| `apps/server/src/cloud-api.ts:46`, `:115`, `:148` | Existing management-session/system.manage checks, exact POST Origin checks and current Cloud actions; these are not A951 Permit consumers. |
| `packages/server-kit/src/management-cookie.ts:30` | Cookie-shape screening; live identity resolution occurs elsewhere. |
| `packages/identity/src/manager-login.ts:162` | authorizeManager resolves current session/role, then checks permission. |
| `packages/identity/src/management-session.ts:47`, `:79`, `:108` | Token-based resolution, active-person/idle checks, optional no-touch behavior and session ending. Internal row-based A951 resolution is proposed. |
| `packages/db/src/tenancy.ts:30`; `packages/store/src/write-queue.ts:59` | Transaction wrapper and serialized begin-immediate/body/commit structure; no proof of DB/journal atomicity. |
| `packages/provisioning/src/attempt-turns.ts:10` | Existing inTurn primitive; the proposed A951 operation record/ordering is not implemented by this function. |

The dated [plan](../plans/2026-10-22-a951-connection.md), [intake](../../developers/cloud-connection.md#a951-build-intake), [A951 backlog](../../backlog/replication-cloud.md#a951-the-boxs-lasting-tunnel-and-public-certificate-client) and Cloud D132/D136/D560 dispositions supply historical scope. This successor proposes focused T1/T2/T3/T5 amendments for the channel, safety and publication ordering; T4 retains R; T14 retains every inherited qualification row.

| Provenance supplied for this cross-review | Exact source words | Consequence |
| --- | --- | --- |
| Owner direction, watcher relay 5 November 2026, about 18:10 | “for v1, trust the Waitron server's own current-permission check.” | §2’s narrow local-approval trust exception; no store/ingress/TLS relocation. |
| Same watcher relay | “no protected sole-store owner” | The rejected 17:52 architecture is not an implementation dependency. |
| Reviewed D582 channel proposal | “Root key custody alone does not authenticate a person” | Supervisor signatures authenticate constrained server assertions, not human identity. |
| Cloud D560 | “Cloud accepts this documented mapping for isolated engineering planning” | M acceptance supplies requirements, not executable/runtime acceptance. |

The driver verified documentary identities, source pins and the stated array/manifest
literals only. The behavioral, signature, size and native obligations below remain
**UNRUN**:

- Preserve verified complete publication identities and this file’s final-LF digest, every inherited matrix row and exact array position/domain. D owns the shared, fully expanded, purpose-separated signed corpus: machine/lease/Q, response/grant/Trust, Permit/result, Report/status, provisioning and all three approval envelopes. Synthetic fixtures remain labelled; no generated signatures are supplied here.
- For each guard, retain a legitimate positive, intended negative, independently failing deletion/bypass control and restored positive. Cover wrong actor/session/role/binding/origin/purpose/boot/pins, unknown/revoked/retired keys, changed Q.floors versus minimumFloors, Permit ID mismatch, anchor-null policy and changed challenge.
- Exercise original-session logout, suspension, deletion, idle expiry and permission loss before issue, consume, participant preparation, L and supervisor acknowledgement; exercise original Cloud owner loss independently. Prove the agreed winning ordering, strict original expiry and no post-completion permanent login dependency.
- Crash at every pending/spent/signing/publication/ack and DB/file-sync/rename/directory-sync boundary. Exercise lost replies, full disk, rollback, mixed stores and missing history. Unknown stays closed; no invented approval, second consume, deadline refresh or lowered floor.
- Verify A/H enclosing/escaped bounds, complete history and all peak journal/reserve accounting, including channel/provisioning evidence. Exhaustion must refuse ordinary work while priority closure still meets its independently measured bound.
- Run the complete A/H/M corpus and X/Y native matrix at exact executable/loaded host pins, including every-packet expiry, established/reverse/resumed traffic, accept-withdrawal races, descriptor escape, frozen workers, supervisor failure, all-store stop races, GUARD16, scoped socket closure and `.local` independence. Record maxima, uncertainty, commands and exit statuses; skipped prerequisites are missing proof.

D’s outstanding contract dispositions are: complete successor acceptance; exact provisioning policy/proof authentication and adapter semantics; constrained signer realization; original local/Cloud consume implementations; L and publication/ack grammar/race semantics; PP/REG/POL/PEER/KEY/GUARD16 consumers; complete signed corpus; and all remaining path gates. Any required table remains A1308/A760-held.

Record accepted artifact digests, allowed scope and both full executable consumer commits in both ledgers before affected integration; qualify that exact pair separately. Full appliance acceptance: **NONE**. Waitron consumer: **NONE**. Cloud consumer: **NONE**. Qualified runtime pair: **NONE**. Admission: **CLOSED**.
