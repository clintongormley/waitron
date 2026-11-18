# Fill the CI server's available slots

The Lane I queue asks to finish qualifying CI server routing and action setup, with the remaining evidence in [the routing bundle](../../backlog/ci.md#bundle-qualify-cis-server-routing-and-action-setup). The initial plan at `6a18376e42` had a completed Claude review. On 18 November 2026 at 10:11 CET the watcher recorded the owner's choice, “Split, CI change only (Recommended),” and cleared the work with that scope. Simultaneous planners may choose the same slots.

- Use the existing capacity variable, health checks and label rules. After licence and sign-off pass, fill the reported free slots after subtracting running and waiting server work. Prefer typecheck, root guards, lint and ascending server shards, then take the remaining enabled legs in workflow order. Run the rest on GitHub. Keep the existing placement for the planner, image, dependent merges and reruns. A failed planner leaves lint and root guards on GitHub.
- In `ci.yml`, share the ordered job-family list between planning and the watchdog. The watchdog checks the actual first-attempt labels against the planned selection, including the stream job. A partial rerun may include completed hosted legs from the mixed first attempt.
- In `ci-server-health.mjs` reuse the current routing result and its capacity and inventory reads. The Cloud controller, credentials and runner labels stay as they are. Tests cover occupied and queued slots, exact mixed labels, missing inputs, the existing rerun route and the watchdog's mixed inventory and partial rerun.
- Qualify a real mixed CI run from the same workflow and module commit by retaining the planned selection, each runner assignment, and the final checks. Use ordinary traffic. Update the CI guide and keep the other live evidence requirements visible in the backlog.

Expected size is under 130 added workflow and script lines, and under 140 added test lines, including relocated workflow rows.
