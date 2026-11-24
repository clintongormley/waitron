# D621. Upload a Cloud backup through one signed address

The box can send a reserved backup straight to storage using an address signed for that one object. This removes the per-backup storage login on Cloud's new route. The first supported Cloud and box pair must publish and independently verify a fresh backup after the primary stops in Lane G's free rehearsal. Lane I owns the box change. Lane G owns the signer and rehearsal.

The watcher assigned the box work at 04:30 CET on 24 November. Cloud's D621 plan at `9d593e89072f32327ac123c2af9d52855b751ca4` defines the reply. Use the existing signed reservation, file checks, retry and publication. The rollout keeps the existing upload for older Cloud installations. The wire change adds neither state nor a dependency. Cloud retains publication and byte verification.

## Reservation

- In `apps/server/src/cloud-backup.ts`, sign `{"upload":"presigned-put-v1"}` for `backup-reserve`. Retry the same capture once with signed `{}` only after HTTP 400 with `{"error":"invalid_metadata"}`. Use the existing bounded response reader and reserve deadline for both requests together. Keep other failures as `cloud.unavailable` and keep the existing publish request and timeout.
- `CloudCaptureGrant` carries either the existing `credentials` or an `uploadUrl`. Keep the common grant checks. Parse the signed address and require HTTPS, the origin of the validated `location.endpoint`, exactly `/<bucket>/incoming/<captureId>` as the request path, and a query. Refuse URL user info and fragments. Retain the signed query for the PUT and keep the address out of errors, logs and saved state.
- Add `opts in and falls back once only when Cloud refuses the option` and `binds the signed address to the reserved object` in `apps/server/src/cloud-backup.test.ts`. Assert the signed request sequence, including no fallback for other refusals, and rejection of a mismatched scheme, origin or key. Update the two existing `{}` wire assertions in `uses current installation proof and renews the same capture without saving upload secrets` to pin the new signed request body, and check the signed query stays out of the saved connection.

## Upload and publication

- In `apps/server/src/cloud-backup-upload.ts`, use one `node:https` PUT for a signed address with the existing CA option, `rejectUnauthorized: true`, transfer deadline and caller cancellation. Send `Content-Length` and `If-None-Match: *`. Stream the already opened file, complete on 2xx or 412, and surface other statuses, including redirects, as `cloud.unavailable`. Settle and close the request and source on cancellation or an early response. Keep the S3 SDK path for credential grants. `uploadCloudCaptureFile` already opens a fresh stream per call, and `cloud-archive-target.ts` already renews reservations and publishes after an upload returns, including after a 412.
- Add `streams a signed PUT and reopens the file after a failed upload` in `apps/server/src/cloud-backup-upload.test.ts`. Use the existing local TLS fixture pattern to assert method, path and query, length, condition and full digest on a failed send followed by 412. Cover redirects without a second request, cancellation while a response waits and rejection with the wrong CA. Run the existing `cloud-archive-sweep.test.ts` and `cloud-archive-target.test.ts` for retry and publication.

Start each behavior with a focused failing case. Run `pnpm --filter @waitron/server exec vitest run src/cloud-backup.test.ts src/cloud-backup-upload.test.ts src/cloud-archive-sweep.test.ts src/cloud-archive-target.test.ts`, then use the normal branch review and CI. Update the Cloud qualification entry in `docs/backlog.md` and its detail in `docs/backlog/setup.md` to include signed reservation renewal in the paired run. Land after the Cloud PR. Give Lane G the exact Waitron candidate for the free rehearsal.

Estimate 90–140 production lines and 100–150 test lines.
