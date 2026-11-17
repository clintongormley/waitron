# A1188: shared synthetic TOTP input examples

These examples accompany the [proposed key handoff](2026-11-17-a1188-locked-totp-purpose-keys.md). They contain only synthetic keys and the sample secret `JBSWY3DPEHPK3PXP`. Cloud has not agreed the new input. The proposed reader and startup parser are not implemented.

## Selected source and launcher input

The selected backup's `secrets.env` holds a 32-byte key filled with byte `01`, version 3. Its `trading.env` overrides the current key with 32 bytes of `02`, version 7. Its `backup.env` supplies the previous key (32 bytes of `01`), version 3. Read those files through `loadKeyRing(resolveBackupKeyInputs(...))`, then derive purpose `totp` once for each entry.

Pass this JSON as `WAITRON_LOCKED_TOTP_KEYS`, with no source vault keys in the child's environment:

```json
{
  "current": {
    "version": 7,
    "key": "2wAWoesyxECCunZGLQpoc/3XYkD4m9Lo0l99P0IJRzc="
  },
  "previous": {
    "version": 3,
    "key": "R5pIGENWaMGj8/MK1yBII+9sXLwTKLysydRfMV7hYDY="
  }
}
```

| Stored text | Expected opening |
| --- | --- |
| `v2.7.gXWBJDSAdhLuvxpE.qmjCaN1x9i11ugMxhMTEBA.AjdnlO7_9cei9FScYL_ngA` | `JBSWY3DPEHPK3PXP`, current version 7 |
| `v2.3.qwQzN_pSqIwkrqBP.ZJNoHtoL-FVvloeoEe3jvg.nTUvwNhi4m3XuILtrU2Qyg` | `JBSWY3DPEHPK3PXP`, previous version 3 |

Opening the previous row with only the current entry returns `null`. Opening the current row with the wrong key or purpose `account-action-code` returns `null`. Replacing its version with `99` returns `null`. Keep these refusals generic at sign-in.

## Absent current version

With only the 32-byte `01` key in `secrets.env`, empty `trading.env` and no `backup.env`, the current version defaults to 1. An explicitly empty current-version variable also defaults to 1. The proposed payload is `{"current":{"version":1,"key":"R5pIGENWaMGj8/MK1yBII+9sXLwTKLysydRfMV7hYDY="},"previous":null}`. This row opens as the same sample secret at version 1:

`v2.1.i5AiyWwbKPxP1T9s.nkXQF6k35i853zbrXbPj9w.qDLPH9WDL9XbHO5G7SPjwQ`

## What was exercised

On 17 November 2026, at Waitron source tree `89caf7e0c8`, a documentation probe bundled and called the existing `purposeKey`, `sealText`, `openText`, `loadKeyRing`, `resolveBackupKeyInputs`, `aadFor` and `open` functions. It checked source precedence, original versions 7/3, both round trips, direct opening with the derived bytes and associated data, wrong key/purpose/version, a missing previous key, and absent/empty version 1. All assertions passed. The frozen values above are that run's output; no new reader or parser was exercised.

The future startup integration must also check an absent payload and `{"current":{"version":7,"key":"AA=="},"previous":null}`: both refuse before the venue lock or placement, leaving the pre-entry folder snapshot untouched. These two proposed parser cases remain unverified until it is built. Shared examples do not qualify Cloud hosting or emergency activation.


**2026-11-17 agreement/build update:** Cloud #1276 published acceptance at
`42b58657453af6f802c89580925090fe97ac9a28`; Lane J `questions.md`, WATCHER 18:30,
released the already reviewed 3a reader/API scope under the 17:16 and 18:03 clearances.
The [developer entry/API](../../developers/cloud-connection.md#locked-emergency-copy-api)
implements that cut. The original text above records the proposal and its gates at publication;
Cloud's launcher, 3b's page, part 4 activation and year-sized timing remain unqualified.
The watcher cleared the build; no owner approval of the key amendment is claimed.
