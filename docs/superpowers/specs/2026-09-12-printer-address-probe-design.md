# A3: check a printer address

Add a known printer on a routed network from the dashboard's Add printer dialog. Enter an IP address
and port (9100 by default), then Check address. Keep automatic discovery and the existing Add / Add
again actions. A successful TCP connection establishes reachability, not printer identity or paper
output; do not send printer commands or open the cash drawer.

The dashboard asks the server to queue one short-lived target under printer.manage. The server
passes active targets in authenticated print-agent job replies; agents perform bounded, byte-free
TCP checks and report successful addresses in the existing scanned inventory. The server itself
never dials the printer, preserving the same flow for a cloud primary and an on-prem print agent.

Accept literal IPv4/IPv6 addresses and ports 1–65535. Reject URLs, hostnames, multicast/unspecified
addresses, IPv4-mapped/scoped IPv6 and malformed input. Hold at most eight concurrent targets in memory for 30 seconds,
deduplicate host/port, and prune expired entries; no database migration or persistent configuration.
Keep probes independent of ordinary discovery failures. Stop passing them at expiry. Limit each
connection to 500 ms and send no bytes. A server restart discards pending requests; retry is explicit.

The form uses semantic names, required markers, field errors and the localized form summary. Show
Waiting, Address reachable, or No agent reported a response, with network/power advice. Match a fresh
report for this host/port rather than stale inventory. Closing/reopening the dialog must discard late
responses and release old polling gates. Automatic reads are passive session activity. Both English
and Spanish are required. Reuse normal registered/disabled matching and registration behavior.

Test the missing request first, then protocol/expiry/authorization, real TCP acceptance/refusal and
zero bytes, scan-failure isolation, UI validation/polling/stale results, disabled re-add, and light/dark
accessibility. Run affected coverage and the complete repository gate near completion. Physical
routing and paper output on the venue's hardware remain distinct from loopback transport tests.
