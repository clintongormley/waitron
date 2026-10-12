# W41s-4: who records an offline recovery-key activation?

An offline recovery can use the node's recovery key when you cannot sign in. Fiscal activation
also records an operator ID in the signed outside consumption and the local audit. The approved
allocation contract requires administrator approval, but does not say which operator the recovery
key authenticates. Settle this before connecting that key to fiscal activation.

## The choice

**A, recommended: use the node recovery key with an explicitly selected active administrator.**
You select an administrator account from the restored venue and enter the node's recovery key.
The host verifies the key and checks that the selected account still exists, is active and has
the administrator permission. It issues authority for this one module, action, event, source and
target. The signed outside consumption must name that same account. Record the authentication
method as recovery-key use, without recording the key itself. The account's password and
authenticator are not required on this path.

This keeps the offline fallback. Possession of the node key authorises recovery under the selected
account; it does not prove that account's holder personally entered their password. You are
explicitly accepting that distinction in the audit attribution. An unknown, suspended or
non-administrator account, a wrong key or a changed scope must refuse activation. An old key
replaced while authentication waits must also refuse.

**B: require a fresh administrator sign-in before fiscal activation.** The node recovery key
alone remains insufficient for this fiscal operation. If you lost the sign-in credentials, use
the existing physical `waitron-break-glass` reset on the replacement, then sign in with the reset
account. This gives fiscal activation the ordinary account-based authentication, but adds a
console step to offline recovery. The reset procedure is a separate operation, not part of the
activation transaction.

For either choice, the recovery key is not allocation evidence. Current outside consumption,
old-machine isolation, no parallel recovery, complete series purposes and one atomic activation
still apply. No secret enters the allocation, approval, audit or log.

## What was run

At parent `357aa52b6d4f7beec9c63090951299d6f896885d`,
`apps/server/src/promote-api.ts:69` verifies a supplied recovery key and then passes only the
isolation attestation to its promotion callback. The password path at line 74 checks an account;
the recovery-key path does not. The current route has not been changed by this checkpoint.

An installed disposable candidate ran a database-backed probe through the real Hono route and
real `mintBreakGlassSecret`/`verifyBreakGlass` helpers:

```sh
pnpm --filter @waitron/server exec vitest run src/w41s4-break-glass-probe.test.ts
```

It passed four cases. A correct node key reached the callback with no person ID, a staff ID and
an unknown ID; the callback received only `{ oldNodeNeutralised: true }`, with no management
session. A wrong key returned `promotion.break_glass_invalid` and never entered the callback.
The callback was a recorder, so this measures route authentication, not real promotion.
The probe source and log are retained in Lane E's `receipts/w41s4-carrier-controls/`.

Initial setup now has its own internal carrier: authority is attributed to the account created
in that venue transaction, with host-chosen account/node IDs available before outside signing.
The generic restore hook can receive module-owned input and live scoped authority. A synthetic
initial-setup integration wrote a signed synthetic allocation and all three purposes, and refused
a substituted operator or missing current outside confirmation. Production setup, restore,
adoption and promotion entry points still await the coupled Task 4 transition.

## Approval boundary

The owner's 2026-10-11 instruction is: “for w41, stop if you think it is important.” This is a
choice about administrator authentication and permanent fiscal attribution. General finish/land
authorisation does not select A or B. Neither recovery-key adapter is implemented, and no existing
test assertion has changed in this checkpoint. Any existing fiscal assertion port beyond the
previous exact approvals still requires its own exact-line approval.

## Owner decision, 2026-10-12 22:55

The owner selected C: the current node recovery key authorises recovery by itself. You do not
select an account or enter its password. Record the authentication event, never a person:
`operatorId` is `{kind:"recovery-key",nodeId,eventId}` in both the signed outside consumption
and the permanent approval. Ordinary administrator operations keep their person ID. Neither
form carries a secret. The key grants no management session and resets no password.

The internal host helper verifies the key before taking the write lock, then rechecks the
stored verifier inside the operation's transaction. It issues authority only for restore,
re-registration or promotion on that same node. This replaces the A/B choice above. Existing
public promotion and cold-restore paths still await the coupled Task 4 transition.

The shared field now carries a person ID or a recovery-key event. Paper signing uses a parsed,
fixed-order event object, and verification compares values rather than object identity. The
Cloud handoff plan's proposed `ClaimBinding.operatorId:string` must carry the same union when
this branch rebases over that plan; its custody adapter must preserve which form was approved.
No Cloud login is inferred from a node key.
