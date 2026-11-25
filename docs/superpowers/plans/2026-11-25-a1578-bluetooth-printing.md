# A1578 — Bluetooth slips and receipts

A second print to the same Bluetooth printer should skip channel discovery after a successful first print. Within about a minute, it should also skip opening a new connection when the first is still usable. Deliver this in two pull requests. The first addresses the measured lookup delay on its own. The second needs a physical check of how the printer handles reused connections and their closure.

## 1. Remember a working channel

- In `apps/print-agent/src/rfcomm.test.ts`, make the existing lookup stub return channel 7 after 3.3 seconds. Assert that a default lookup uses channel 7 and the next print uses it without another lookup. Keep a case where lookup times out, channel 1 prints successfully, the next print skips lookup, and a failed send makes the following job discover a new channel. Assert one helper call per job. Observe the new expectations fail before changing the transport.
- In `apps/print-agent/src/rfcomm.ts`, give the existing lookup five seconds. Remember the selected channel for that address after the helper reports success, including channel 1 after a lookup error. A failed send still clears the entry. Run `pnpm --filter @waitron/print-agent-app exec vitest run src/rfcomm.test.ts` red and green. Estimate 10 product lines and 40 test lines added.

## 2. Reuse a working connection for 60 seconds

- Keep the existing Bluetooth transport, Python helper and socket. Add a streaming mode to `apps/print-agent/src/rfcomm-send.py` that reads a length followed by the job's bytes and returns one result per job. Use it from `apps/print-agent/src/rfcomm.ts` with one helper per active printer address, one request at a time per helper, and the existing bounded connect and send waits. Close its input after 60 seconds without a job, on failure, or when the parent exits. The helper closes the socket on input end. Keep the existing one-shot entry for image smoke.
- Count the bytes accepted by the socket for this job. On a reused connection that fails before accepting any, close it and try one fresh connection. A failure after any bytes are accepted, or a helper that dies before returning its result, goes through the existing failure path. A successful result still means the kernel accepted the bytes. Keep the fallback inside the helper so it has the byte count.
- Extend the real-helper cases in `apps/print-agent/src/rfcomm.test.ts` using its fake socket. Check two distinct binary jobs in order on one connection, a new connection after expiry, one copy after a stale connection refuses the first write, and no second send after a partial write. The transport test also bounds a helper that never answers. Run the suite red and green, then run the app build and existing image guards. Estimate 200 product and 135 test lines added.

## Check on the spare

Use the Bluetooth printer through the existing waitron-b4 session and its shipped print-agent profile, with the current venue kept intact. For the first change, compare consecutive jobs with the 25 November measurements. For the second, compare cold, warm and post-expiry jobs. Record time to visible paper, complete output and copy count, as well as time to the agent's result. Use a longer receipt for the closure comparison. Review the AppArmor log. Update the printer backlog and its A140 note with observed results. Preconnecting during discovery or payment, the dashboard and changes to print-job handling are outside this item.
