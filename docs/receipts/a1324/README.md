# A1324: a customer-supplied key on the bucket copy

Run on 6 November 2026 against Amazon S3 in `eu-north-1`, with Litestream 0.5.17 and made-up data, by
[run.sh](run.sh):

```
AWS_SHARED_CREDENTIALS_FILE=... AWS_CONFIG_FILE=... AWS_PROFILE=waitron-rehearsal AWS_REGION=eu-north-1 ./run.sh
```

The question: can someone holding only the bucket login read the copy? The failing case would print
`READABLE` at step 5.

| Step | Result |
| --- | --- |
| Upload with a customer key to a new bucket | Refused, `AccessDenied`. The bucket's settings listed `BlockedEncryptionTypes: SSE-C` |
| Unblock it with `put-bucket-encryption` | Accepted |
| Litestream replicates 300 rows over 75 seconds | No warnings or errors, three compactions, 20 objects |
| **Read an object with the bucket login alone** | **Refused**, `InvalidRequest`: "The object was stored using a form of Server Side Encryption" |
| Read it with a wrong key | Refused, `AccessDenied` |
| Read it with the right key | Worked |
| Restore with the key | 300 of 300 rows |
| Restore without the key | Failed, exit 1 |

The same script on the local test server (versitygw 1.8.0) printed `READABLE`: that server accepts
these keys and ignores them, so it can show nothing about protection.

**What this does not show.** It is one short run with a test key, not Waitron's own stream code, a
long-running copy or a real restore through a recovery pack. It covers Amazon only. Whoever holds the
box still has the key, so it does nothing against someone who reaches the box.

The run's time limit stopped the script during clean-up, so the bucket was removed by hand; a check
then found no buckets left in the account.
