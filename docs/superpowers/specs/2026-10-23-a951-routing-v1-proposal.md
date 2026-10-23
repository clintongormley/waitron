# A951 routing v1: proposal for bilateral G6/T4 review

**PROPOSAL ONLY.** Artifact: `waitron-a951-routing-v1`; edition: `proposal-2026-10-23.1`.
Owners: Lane E, Waitron intake/client; Lane G, Cloud canonical contract/gateway consumer.

This returns the routing portion of the existing approved A951 plan/build.
Every concrete identifier, schema, algorithm, vector and numerical bound below is an **UNACCEPTED proposed engineering choice**.
A publication digest identifies review material; it supplies no acceptance or runtime qualification.
This document supplies no implementation, tests, deployment, provider action or new owner design question.

## Scope and provenance

You get an exact empty production manifest and a shared customer-request boundary.
A separate injected availability fixture provides a positive routing control without granting product permission.
Read the [approved plan](https://github.com/clintongormley/waitron/blob/fc54735435bc88b5fe7ba376c074fe8010c63401/docs/superpowers/plans/2026-10-22-a951-connection.md), particularly G6/T4.
Apply the [design's CURRENT REVISION and section 8](https://github.com/clintongormley/waitron/blob/fc54735435bc88b5fe7ba376c074fe8010c63401/docs/superpowers/specs/2026-10-22-a951-box-public-access-design.md) and [A951 intake](https://github.com/clintongormley/waitron/blob/fc54735435bc88b5fe7ba376c074fe8010c63401/docs/developers/cloud-connection.md#a951-build-intake).
The proposal follows [writing-claims.md](https://github.com/clintongormley/waitron/blob/fc54735435bc88b5fe7ba376c074fe8010c63401/docs/developers/writing-claims.md); specified outcomes below are expectations, not observations.

Cloud source scope is **A951 Cut A contract review, including its scoped-agreement table, only**.
Source pin: `ca5d2a996b93d16c55ccb79b8c3d2228792b5090`.
Full source-document SHA-256: `57df8883fb8dc50f5e0d93c63779ddb1c4831c16243e0df338a1cd6458522f4a`.
The supplied local snapshot matched that digest under `shasum -a 256`.

| Pinned source                                                                                                                                                                          | Source wording                                                     | Consequence                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [Cut A review](https://github.com/waitron-io/waitron-cloud/blob/ca5d2a996b93d16c55ccb79b8c3d2228792b5090/docs/waitron-integration-contract.md#a951-cut-a-contract-review-2026-10-23)   | “No A951 wire/helper/parser artifact is accepted by this review.”  | This proposal returns review material and opens no parser or admission gate. |
| [G6/T4 request](https://github.com/waitron-io/waitron-cloud/blob/ca5d2a996b93d16c55ccb79b8c3d2228792b5090/docs/waitron-integration-contract.md#what-each-scoped-agreement-still-needs) | “A fixture availability route is not a production customer route.” | Keep the positive fixture separate from both empty production manifests.     |

## Empty production manifest and closed extension boundary

The production schema is a closed JSON object with precisely these members, in this order:

| Member     | Exact value                      |
| ---------- | -------------------------------- |
| `schema`   | String `waitron-a951-routing-v1` |
| `revision` | String `proposal-2026-10-23.1`   |
| `routes`   | Empty array `[]`                 |

Its canonical bytes are the following **83 ASCII bytes**, without a BOM, spaces or final newline:

```text
{"schema":"waitron-a951-routing-v1","revision":"proposal-2026-10-23.1","routes":[]}
```

Proposed manifest SHA-256: `271fefd892b2c0f10ffab42f8e4a832a163b244733285f08d5a0ea1dfab1b012`.
Receipt: `printf '%s' '{"schema":"waitron-a951-routing-v1","revision":"proposal-2026-10-23.1","routes":[]}' | shasum -a 256`.
The corresponding `wc -c` command returned `83`; this verifies these literal bytes only.
Both consumers compare the supplied bytes with this literal and hash those bytes, without JSON reserialization.
Different member order, whitespace, duplicate/unknown members, escapes, trailing bytes or another revision fail manifest admission.
Any nonempty `routes`, including `[{}]`, fails. There is no row grammar, optional extension object or permissive compatibility mode in this revision.
Digest disagreement, absent manifest or unsupported version closes customer admission at both consumers.

A future nonempty manifest requires a jointly accepted version amendment before its parser or affected adapter.
That amendment must define a closed row schema, canonical encoding, ordering, uniqueness and overlap rejection.
It must enumerate exact methods, paths/templates, variable constraints, query keys/values and individual asset dependencies.
It must settle content types, body/decoded-response limits, deadlines, response/status semantics and caching.
It must also settle customer authentication/session, credentials, Origin/CSRF, operation fingerprints, reconciliation and replay semantics.
No placeholder row inherits permission from a product name, directory, hostname or fixture.

## Proposed raw-request boundary

Both consumers inspect original decrypted HTTP/1 request octets before a framework, URL API or header map changes them.
Normalization here means validation plus an identity-preserving method/target tuple; it performs no decoding or path repair.
Keep raw header occurrences until duplicate checks finish. A map that has already merged them is insufficient evidence.
The public gateway and box repeat the same grammar checks independently, with their distinct authority/header profiles.
Missing raw evidence closes admission. These choices assert no behavior of an existing HTTP library.

Proposed ingress v1 supports HTTP/1.1 only. Disable HTTP/2 negotiation and reject an HTTP/2 preface or upgrade.
No HTTP/2 downgrade is admitted until a separate accepted extension proves raw authority/header uniqueness before conversion.
There is no merge of `Host` and `:authority`, no cleartext public ingress and no PROXY-protocol interpretation.

| Bound                                                           | Proposed exact limit                                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| TLS handshake                                                   | 5,000 ms from socket acceptance                                      |
| Complete request headers                                        | 5,000 ms from completed TLS handshake; no reset on activity          |
| Socket lifetime                                                 | 11,000 ms from acceptance, shortened by any binding/trust expiry     |
| Request line, including CRLF                                    | 2,048 bytes                                                          |
| Raw request target                                              | 1,024 bytes                                                          |
| Each header line, including CRLF                                | 1,024 bytes                                                          |
| Complete header block, including request line and terminal CRLF | 8,192 bytes                                                          |
| Header occurrences                                              | 32                                                                   |
| Request/body/reuse                                              | One header-only request per connection; no body consumption or reuse |
| Query                                                           | At most 4 pairs; keys 1–32 bytes; values 1–64 bytes                  |

Exceeding a bound refuses the request and closes the connection; no partially checked request reaches a handler.
The framed input ends at the first terminal CRLF. Apply header bounds and grammar to that prefix only.
Discard every following byte, whether delivered in the same read or later; never parse, forward or count it as a body or second request.
Stop request reads and close after the single response. Construct a fresh upstream request from the admitted tuple and closed header profile, never by copying the input stream.
This deliberately gives `P || "x"` the same first-request verdict at every read boundary. A future body-bearing protocol needs a version amendment.
Never retry, redirect or forward a refused request through another app.
These bounds need bilateral acceptance and later executable qualification; they are not runtime defaults.

## Deterministic parsing and refusal precedence

For complete, within-bound requests, apply the following stages in order; the first failing stage determines the verdict.
Within a stage, use the listed suborder. Verdict names are local review labels, not a diagnostic-export schema.
A bound/deadline event interrupts parsing immediately; simultaneous observed events prefer byte/count bounds over deadlines.
TLS/protocol failure closes without HTTP. Other refusals use an empty HTTP/1.1 `400 Bad Request`, `Content-Length: 0` and `Connection: close`, without input echoes.

1. **`BYTES` / `GRAMMAR`:** reject bytes above `0x7e`, DEL and controls other than framing CR/LF.
   Require CRLF line endings and a terminal empty line; reject bare CR/LF and obsolete folded headers.
   Require exactly `METHOD SP TARGET SP HTTP/1.1 CRLF`, with no extra spaces.
   `METHOD` is 1–16 uppercase ASCII letters; syntax acceptance supplies no method permission.
   Header names match `[A-Za-z][A-Za-z0-9-]{0,63}`; require colon followed by exactly one SP and a nonempty value.
   Values contain printable ASCII only, with no leading/trailing SP; do not trim or unfold.
2. **`DUPLICATE_HEADER`:** lowercase names for comparison only; reject every repeated name, including identical values.
   This applies before stripping, including duplicate `Host`, framing, credential and forwarding fields.
3. **`FRAMING`, then `OVERRIDE`, then `TRANSPORT`:** reject any `Content-Length`, `Transfer-Encoding`, `Trailer` or `Expect`.
   Reject `X-HTTP-Method`, `X-HTTP-Method-Override`, `X-Method-Override`, `X-Original-URL` and `X-Rewrite-URL`.
   Reject any `Upgrade`; if `Connection` exists, its value must be exactly `close`.
4. **`AUTHORITY`:** require exactly one `Host`; apply the exact TLS SNI/Host mapping below.
   Refuse missing SNI, uppercase/trailing-dot aliases, IP literals, user information and all explicit port spellings.
5. **`CREDENTIAL`, then `HEADER_POLICY`:** reject any `Authorization`, `Proxy-Authorization`, `Cookie` or `X-API-Key`.
   At the public gateway, discard client `Forwarded`, every `X-Forwarded-*` and every `X-Waitron*` field after stages 1–4.
   Rebuild outbound headers from the closed allowlist below; no client authentication/routing assertion survives.
   Any remaining unknown header fails. At the box, discard nothing: unknown or surplus forwarding fields fail.
6. **`TARGET`:** apply path checks, then query checks below, retaining the original method/target bytes.
7. **`CONTEXT`:** independently verify the side-specific current connection/binding/context checks below.
8. **`ROUTE_DENIED`:** require an exact manifest or injected-fixture tuple match; absence denies.
   `GET` never implies `HEAD`; no wildcard, fallback proxy, SPA/static escape or method/path/query rewriting exists.

Path grammar is `/`, or `/segment` followed by zero or more `/segment` components.
Each segment contains one or more bytes from `[a-z0-9_-]`; no other path bytes are admitted.
Reject every `%`, including valid escapes, so malformed, encoded separator and double-encoding cases cannot acquire another meaning.
Dots, backslashes, repeated slashes and trailing slashes other than `/` fail; absolute-form and authority-form targets fail.
No Unicode, UTF-8 decoding, case folding, dot removal, slash collapse or filesystem resolution occurs.
A product needing dots, encoded names or a wider alphabet must obtain an accepted version change first.

The query is absent, or exactly `?key=value` followed by zero or more `&key=value` pairs.
Keys and values use `[a-z0-9_-]` only; empty components, `%`, `+`, semicolons, fragments and extra `=` fail.
Keys must be unique and strictly increasing by ASCII byte order; never sort incoming keys.
No query parameter changes the HTTP method. Syntactically valid extra keys still require exact route permission.

## HTTPS authority, forwarding and independently verified context

Every enabled binding must contain an exact accepted mapping of public host, upstream SNI and upstream Host.
This proposal provides synthetic mapping values only; it supplies no real hostname allocation or accepted mapping.

| Boundary                          | Required TLS SNI         | Required raw `Host` value |
| --------------------------------- | ------------------------ | ------------------------- |
| Injected public customer ingress  | `customers.example.test` | `customers.example.test`  |
| Injected customer upstream at box | `upstream.example.test`  | `upstream.example.test`   |

At the gateway, public SNI equals public Host and the current binding's public host.
At the box, TLS SNI and Host equal their respective upstream mapping entries.
The forwarded public host equals the independently verified context's public host, not the upstream hostname.
Different public and upstream names are permitted only by that exact accepted mapping, never a suffix or wildcard.
`staff.example.test` cannot select the customer app; a customer name cannot select the staff app.
Staff TLS remains end-to-end to the box and never passes through this customer HTTP parser.
`.local` stays independent; these proposed failures create no local Cloud/DNS/certificate dependency.

Public input permits `Host`, optional `Accept: application/json`, optional `Connection: close` and optional `User-Agent`.
`User-Agent` is 1–256 printable ASCII bytes under stage 1; consume it locally and do not forward it.
The gateway emits only `Host`, `Connection: close`, the two forwarding fields below and optional unchanged `Accept`.
It preserves the exact admitted method and target; replacing Host uses only the accepted upstream mapping.
All other client headers disappear from outbound construction; an unknown non-stripped input header already causes refusal.

| Forwarded header    | Exact proposed value and rule                          |
| ------------------- | ------------------------------------------------------ |
| `X-Forwarded-Proto` | Exactly `https`, minted from verified public TLS, once |
| `X-Forwarded-Host`  | Exact bound public hostname, once                      |

No `Forwarded`, `X-Forwarded-For`, `X-Forwarded-Port`, `X-Waitron*` or other forwarding field is emitted.
The box requires both listed fields, `Host` and `Connection: close`; optional `Accept` is its only additional field.
It rejects duplicates, missing fields, wrong values and surplus headers before framework handling.
Header presence, a source IP or a WireGuard address alone never authenticates a gateway.
No client credential becomes customer authority; this revision admits no customer credentials or challenge-cookie route.

The box consumes `VerifiedGatewayContext`; the gateway consumes the distinct `VerifiedPublicIngressContext`.
Both are immutable **local values** produced by their verified transport/binding adapters for one request.
It is neither a signed-wire token nor a header object, and callers cannot deserialize or supply it.
Their closed field sets share the following binding and lifetime fields; connection evidence differs as specified immediately below:

| Common fields                                                                     | Exact local type / provenance                                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `originId`, `cloudOrigin`                                                         | Provisioned origin ID and its exact HTTPS origin from the current authenticated registry   |
| `environment`                                                                     | `fixture`, `test` or `production`, matching the local helper proposal's binding vocabulary |
| `cloudVenueId`, `installationId`, `localVenueId`, `machineIdentity`, `endpointId` | IDs from the current authenticated G1 binding and local identity                           |
| `nodeId`                                                                          | Exactly 32 lowercase hexadecimal characters, matching helper `node`                        |
| `establishmentEpoch`, `placementEpoch`                                            | Current G1 epoch IDs, strings; neither is an appliance revision or grant sequence          |
| `configDigest`                                                                    | Lowercase 64-hex digest of G1's accepted authenticated configuration bytes                 |
| `manifestDigest`                                                                  | Lowercase 64-hex digest of the exact admitted manifest bytes                               |
| `publicHost`, `upstreamSni`, `upstreamHost`                                       | Exact entries from the authenticated, currently accepted name mapping                      |
| `bindingGeneration`                                                               | Local positive safe integer changed whenever relevant binding/admission state changes      |
| `verifiedAtMonoMs`, `expiresAtMonoMs`                                             | Local nonnegative safe-integer monotonic times; expiry strictly exceeds verification       |
| `requestOrdinal`                                                                  | Literal integer `1`; each public and upstream connection carries one request               |

| Connection field        | Box `VerifiedGatewayContext`                                                        | Gateway `VerifiedPublicIngressContext`                                                     |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `gatewayId`             | Gateway identity authenticated through the allowed upstream mutual-TLS peer mapping | Own provisioned gateway identity, checked against the current binding                      |
| `transportPeerId`       | Authenticated gateway transport peer                                                | Authenticated box transport peer                                                           |
| `peerSpkiSha256`        | Verified gateway peer public-key digest, lowercase 64-hex                           | Verified box peer public-key digest, lowercase 64-hex                                      |
| `tlsConnectionId`       | Live inbound mutual-TLS connection                                                  | Live outbound mutual-TLS connection to the mapped box                                      |
| `listenerId`            | Own intended customer-upstream listener                                             | Own public customer listener                                                               |
| `publicTlsConnectionId` | Absent; unknown fields are refused                                                  | Own live public TLS connection to the customer; no customer client certificate is required |

The gateway checks both connection lifetimes and the mapping joining them. It authenticates the box independently; the customer's TLS connection never supplies the box peer identity.
It emits one request on a fresh authenticated upstream connection. The box independently checks its inbound peer and local listener; local connection IDs are not sent as claims or expected to match across hosts.

IDs match `[a-z0-9][a-z0-9-]{0,63}` unless a field has a narrower type above; unknown fields fail local construction.
Safe integers are at most `9007199254740991`; no numeric coercion or string-to-number conversion occurs.
These local binding names map to helper Binding B: `cloudVenueId` to `cloudVenue`, `installationId` to `installation`, `localVenueId` to `localVenue`, `nodeId` to `node`, and `endpointId` to `target`.
`originId`, `environment`, `machineIdentity`, `establishmentEpoch` and `placementEpoch` retain the helper's exact types and meanings. `cloudOrigin` is the origin registry's URL, not an alternate epoch or identity.
This aligns two unaccepted local proposals; it accepts no external G1 mapping and derives no environment from `WAITRON_ENV` by spelling.
The verifier checks the peer against the **current** allowlist and all identity/digest/name bindings against current local state.
Require `verifiedAtMonoMs <= now < expiresAtMonoMs` and the same live side-specific connections, listener and generation at dispatch.
Expiry is bounded by the earliest accepted grant, authority-freshness, certificate, trust and peer-allowance deadline.
Missing deadlines or untrusted post-boot time close admission; this proposal invents no lifetime for those dependencies.
Stop, withdrawal, expiry, peer removal or binding change invalidates contexts and closes affected established sockets.
A context cannot be cached across connections, requests, moves, replacement, reload or generation changes.

**G4/G1 dependency:** exact wire encoding, TLS peer-to-claims mapping, trust issuance/distribution and authenticated mapping delivery remain unaccepted.
Forwarding fields cannot fill those gaps, and this document defines no issuance protocol.
Until accepted artifacts exist, use injected local contexts only in isolated fixtures; real admission stays closed.

## Literal vectors and separate positive fixture

Notation: `\r`, `\n`, `\xHH` and `\\` represent CR, LF, one hexadecimal byte and one backslash respectively.
All other characters, especially `%`, are literal bytes; never run these strings through a URL API.
`P` is the exact public request below, with synthetic TLS SNI `customers.example.test` and current injected binding:

```text
GET /_fixture/availability?day=2026-10-23&party=2 HTTP/1.1\r\nHost: customers.example.test\r\n\r\n
```

The isolated fixture permits only `GET`, path `/_fixture/availability`, and query `day=2026-10-23&party=2`.
It has no body, credentials or mutable business state; its handler records the received tuple/context and answers once.
Its proposed response deadline is 1,000 ms; its exact response is:

```text
HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 18\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{"available":true}
```

This response is synthetic availability, not a statement about venue inventory or booking permission.
`P` passes syntax and reaches that injected handler once; with the production manifest it yields `ROUTE_DENIED` and zero handler calls.
Fixture construction is a separate injected policy and cannot be selected by configuration, environment variable or request in production.
There is no production `/public/availability`, Cloud challenge endpoint or fixture route.

Each following target is literal replacement of P's sole request target; every other byte and fixture prerequisite stays unchanged.

| Raw target bytes                                               | Expected first verdict                              |
| -------------------------------------------------------------- | --------------------------------------------------- |
| `/_fixture/availability?day=2026-10-23&party=2`                | Syntax accepted; fixture allowed; production denied |
| `/_fixture/availability?day=2026-10-23&party=3`                | Syntax accepted; route denied                       |
| `/_fixture/availability`                                       | Syntax accepted; route denied                       |
| `/`                                                            | Syntax accepted; route denied                       |
| `/public/availability`                                         | Syntax accepted; route denied                       |
| `/api/login`                                                   | Syntax accepted; route denied                       |
| `/_fixture/availability/`                                      | `TARGET`                                            |
| `//_fixture/availability`                                      | `TARGET`                                            |
| `/_fixture/./availability`                                     | `TARGET`                                            |
| `/_fixture/../availability`                                    | `TARGET`                                            |
| `/_fixture\\availability`                                      | `TARGET`                                            |
| `/_fixture%2favailability`                                     | `TARGET`                                            |
| `/_fixture%2Favailability`                                     | `TARGET`                                            |
| `/_fixture%5cavailability`                                     | `TARGET`                                            |
| `/_fixture/%2e%2e/availability`                                | `TARGET`                                            |
| `/_fixture%252favailability`                                   | `TARGET`                                            |
| `/_fixture/%`                                                  | `TARGET`                                            |
| `/_fixture/%2`                                                 | `TARGET`                                            |
| `/_fixture/%gg`                                                | `TARGET`                                            |
| `https://customers.example.test/_fixture/availability`         | `TARGET`                                            |
| `customers.example.test:443`                                   | `TARGET`                                            |
| `/_fixture/availability?`                                      | `TARGET`                                            |
| `/_fixture/availability?day=2026-10-23&day=2026-10-24&party=2` | `TARGET`                                            |
| `/_fixture/availability?party=2&day=2026-10-23`                | `TARGET`                                            |
| `/_fixture/availability?day=2026-10-23&party=2&`               | `TARGET`                                            |
| `/_fixture/availability?day=2026-10-23;party=2`                | `TARGET`                                            |
| `/_fixture/availability?day=2026-10-23&party=+2`               | `TARGET`                                            |
| `/_fixture/availability?day=2026-10-23&party=%32`              | `TARGET`                                            |
| `/_fixture/availability?day=2026-10-23&party=2#staff`          | `TARGET`                                            |
| `/_fixture/availability?day=2026-10-23&party=2=3`              | `TARGET`                                            |
| `/_fixture/\xC3\xA9`                                           | `BYTES`, valid UTF-8 still outside ASCII policy     |
| `/_fixture/\xC0\xAF`                                           | `BYTES`, invalid UTF-8 bytes                        |
| `/_fixture/\x00`                                               | `BYTES`                                             |
| `/_fixture/\x7F`                                               | `BYTES`                                             |

For compact header vectors, `T` means exactly `/_fixture/availability?day=2026-10-23&party=2`.
Expand only the literal token `{T}` below; escapes and all remaining bytes are unchanged.

| Raw request representation                                                                                              | Expected first verdict                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `HEAD {T} HTTP/1.1\r\nHost: customers.example.test\r\n\r\n`                                                             | Syntax accepted; route denied                                                                                 |
| `get {T} HTTP/1.1\r\nHost: customers.example.test\r\n\r\n`                                                              | `GRAMMAR`                                                                                                     |
| `GET {T} HTTP/1.1\nHost: customers.example.test\n\n`                                                                    | `GRAMMAR`                                                                                                     |
| `GET {T} HTTP/1.1\r\nHost: customers.example.test\r\nhost: customers.example.test\r\n\r\n`                              | `DUPLICATE_HEADER`                                                                                            |
| `GET {T} HTTP/1.1\r\nHost: customers.example.test\r\nHost: staff.example.test\r\n\r\n`                                  | `DUPLICATE_HEADER`                                                                                            |
| `GET {T} HTTP/1.1\r\n:authority: customers.example.test\r\n\r\n`                                                        | `GRAMMAR`                                                                                                     |
| `GET {T} HTTP/1.1\r\nHost: customers.example.test:443\r\n\r\n`                                                          | `AUTHORITY`                                                                                                   |
| `GET {T} HTTP/1.1\r\nHost: customers.example.test:0443\r\n\r\n`                                                         | `AUTHORITY`                                                                                                   |
| `GET {T} HTTP/1.1\r\nHost: customers.example.test:+443\r\n\r\n`                                                         | `AUTHORITY`                                                                                                   |
| `GET {T} HTTP/1.1\r\nHost: customers.example.test.\r\n\r\n`                                                             | `AUTHORITY`                                                                                                   |
| `GET {T} HTTP/1.1\r\nHost: Customers.example.test\r\n\r\n`                                                              | `AUTHORITY`                                                                                                   |
| `GET {T} HTTP/1.1\r\nHost: staff.example.test\r\n\r\n`                                                                  | `AUTHORITY`                                                                                                   |
| `GET {T} HTTP/1.1\r\nHost: customers.example.test\r\nContent-Length: 0\r\n\r\n`                                         | `FRAMING`                                                                                                     |
| `GET {T} HTTP/1.1\r\nHost: customers.example.test\r\nContent-Length: 0\r\nContent-Length: 1\r\n\r\n`                    | `DUPLICATE_HEADER`                                                                                            |
| `GET {T} HTTP/1.1\r\nHost: customers.example.test\r\nTransfer-Encoding: chunked\r\nTransfer-Encoding: identity\r\n\r\n` | `DUPLICATE_HEADER`                                                                                            |
| `GET {T} HTTP/1.1\r\nHost: customers.example.test\r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\n\r\n`           | `FRAMING`                                                                                                     |
| `GET {T} HTTP/1.1\r\nHost: customers.example.test\r\n User-Agent: injected\r\n\r\n`                                     | `GRAMMAR`, folded/indented line                                                                               |
| `GET {T} HTTP/1.1\r\nHost: customers.example.test\r\nUpgrade: websocket\r\n\r\n`                                        | `TRANSPORT`                                                                                                   |
| `GET {T} HTTP/1.1\r\nHost: customers.example.test\r\nX-HTTP-Method-Override: POST\r\n\r\n`                              | `OVERRIDE`                                                                                                    |
| `GET {T} HTTP/1.1\r\nHost: customers.example.test\r\nCookie: staff=secret\r\n\r\n`                                      | `CREDENTIAL`                                                                                                  |
| `GET {T} HTTP/1.1\r\nHost: customers.example.test\r\nX-Forwarded-Host: staff.example.test\r\n\r\n`                      | Public syntax accepted; discard assertion; fixture may route only with independently injected current context |

The exact positive box-side request is:

```text
GET /_fixture/availability?day=2026-10-23&party=2 HTTP/1.1\r\nHost: upstream.example.test\r\nConnection: close\r\nX-Forwarded-Proto: https\r\nX-Forwarded-Host: customers.example.test\r\n\r\n
```

Its synthetic TLS SNI is `upstream.example.test`; forwarding headers alone still yield `CONTEXT` without injected verified evidence.
For the positive fixture, use the following exact common injected binding on both sides; these are synthetic expectations, not authentic external claims.

| Field                                                                        | Injected value                                                             |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `originId`, `cloudOrigin`, `environment`                                     | `origin-fixture`, `https://control.example.test`, `fixture`                |
| `cloudVenueId`, `installationId`, `localVenueId`                             | `venue-fixture`, `installation-fixture`, `local-venue-fixture`             |
| `machineIdentity`, `endpointId`                                              | `machine-fixture`, `endpoint-fixture`                                      |
| `nodeId`                                                                     | `11111111111111111111111111111111`                                         |
| `establishmentEpoch`, `placementEpoch`                                       | `fixture-establishment`, `fixture-placement`                               |
| `configDigest`                                                               | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`         |
| `manifestDigest`                                                             | `271fefd892b2c0f10ffab42f8e4a832a163b244733285f08d5a0ea1dfab1b012`         |
| `publicHost`, `upstreamSni`, `upstreamHost`                                  | `customers.example.test`, `upstream.example.test`, `upstream.example.test` |
| `bindingGeneration`, `verifiedAtMonoMs`, `expiresAtMonoMs`, `requestOrdinal` | `7`, `1000`, `2000`, `1`                                                   |

The box context adds `gatewayId=gateway-fixture`, `transportPeerId=gateway-peer`, `tlsConnectionId=box-inbound`, `listenerId=box-customer` and a `peerSpkiSha256` of exactly 64 lowercase `b` characters.
The gateway context adds `gatewayId=gateway-fixture`, `transportPeerId=box-peer`, `tlsConnectionId=gateway-upstream`, `listenerId=gateway-public`, `publicTlsConnectionId=public-inbound` and a peer digest of exactly 64 lowercase `c` characters.
The fixture's injected peer registry supplies those separate expected digests and connection ownership. Changing either to the other side's digest fails `CONTEXT`.
The empty manifest digest still binds this fixture; only its isolated, non-configurable test policy permits the one tuple. That policy is absent in production.

| Injected variation                                                                           | Expected result with the positive fixture |
| -------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Same live connection/listener, all bindings equal, current allowed peer, `now=1500`          | Fixture handler once                      |
| Observed `installationId=installation-other`; expected `installationId=installation-fixture` | `CONTEXT`; zero handler calls             |
| All bindings equal, `now=2000`                                                               | `CONTEXT`; zero handler calls             |

Read-boundary controls use an otherwise valid `P` and the current side-specific injected context:

| Delivered reads before the one response                  | Fixture expectation                               | Production expectation             |
| -------------------------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| One read containing `P                                   |                                                   | "x"`                               | One handler call for P; suffix discarded           | Zero handler calls, `ROUTE_DENIED` |
| First read P, second read `"x"` before or after dispatch | Same one call and same tuple; suffix never parsed | Zero handler calls, `ROUTE_DENIED` |
| One read `P                                              |                                                   | P`, or two reads P then P          | First P only; no second request or upstream suffix | Zero handler calls, `ROUTE_DENIED` |

These are required future behavioral assertions, not executed parser results. Byte accumulation retains at most the 8,192-byte header prefix; suffix discard must not allocate or retain an unbounded input chunk.

## Acceptance and amendment checklist

- [ ] Lane E and Lane G accept or amend these exact bytes, bounds, precedence, vectors, forwarding profile and closed extension rule.
- [ ] Record the resulting artifact edition, exact artifact SHA-256, manifest digest, **both full consumer pins** and allowed scope in Cloud's canonical contract and Waitron's A951 intake before affected code.
- [ ] Keep G6/T13 diagnostics as a separate exact artifact request; this proposal defines no diagnostic schema or export permission.
- [ ] Obtain flow-scoped A980/D101 acceptance before real traffic or metadata processing, including staff metadata.
- [ ] Keep G1 appliance/helper, G2/A947 authority, G4 upstream, G5 moves and G7 host/executable qualification unresolved until their own accepted artifacts and receipts exist.
- [ ] Preserve empty production routes, `.local` independence and staff end-to-end TLS; grant no publication, pause, service, cookie, customer-authentication, payment, mutation, writer, fiscal or recovery authority.
- [ ] Publish through the authorised documentation path only; preserve other proposal/spec bytes and make no Cloud checkout mutation.
