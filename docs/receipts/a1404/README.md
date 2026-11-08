# A1404: key handoff and bucket setup

On 8 November 2026, the Lane K driver ran the pinned Litestream 0.5.18 release against an owned
local Versity 1.8.0 server through a request-recording proxy. The Darwin archive matched SHA-256
`6d3e0875e5416628ef3d274e8f7bb0ecc2a19cbbe76b9ba43efe9901d82a5c84` from
`scripts/setup-litestream.mjs`.

The command was `pnpm --filter @waitron/server exec tsx <lane receipts>/handoff/probe.mts`.
The local script and output remain in Lane K's `receipts/a1404-20261108/handoff/`.

| Experiment | Observed result |
| --- | --- |
| `litestream replicate -once -config <config>`, with an environment key decoding to 31 bytes | Exit 1, zero S3 requests; refused because the key was not 32 bytes |
| Same command with a 32-byte key | Exit 0; the uploaded LTX carried the matching AES256, key and MD5 headers |
| `litestream restore -config <config> -o <fresh output> <source database>` | Exit 0; the downloaded LTX carried matching headers, and the restored row equalled the original |

The configuration used `url:` and `sse-customer-key: '${WAITRON_STREAM_ENCRYPTION_KEY}'`.
The key travelled through the child environment, without a temporary key file. This tests handoff,
not confidentiality: Versity ignores these encryption keys, as the [A1324 experiment](../a1324/README.md)
showed. Real Amazon wrong-key, keyless and recovery-pack restore qualification remains the final
slice of the [plan](../../superpowers/plans/2026-11-08-a1404-bucket-encryption.md).

| Source at Litestream commit `057d39564c75ebd67ba042410a7ffa05ad4c242d` | Source's words | What was tested |
| --- | --- | --- |
| `cmd/litestream/main.go:608` | `os.Expand` | Environment substitution with a URL replica |
| `cmd/litestream/main.go:1703` | `client.SSECustomerKey = c.SSECustomerKey` | Direct config key reaches requests |
| `s3/replica_client.go:558` | `must be 256-bit (32 bytes)` | Invalid decoded length refuses before S3 |

Save's provider check uses a disposable key and object. Tests exercise the real S3 client against
controlled HTTP responses; they are not Amazon qualification. The actual stream is encrypted in
the next slice. A crash followed by changing the key while the box is down remains untested.
A later provider policy change appearing as a stream failure is also untested.
