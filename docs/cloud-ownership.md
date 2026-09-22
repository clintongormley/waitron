# Waitron and Waitron Cloud documentation

Waitron Cloud is the commercial, closed-source product for cloud add-on services and
hosted Waitron. Its [product discussion](https://github.com/waitron-io/waitron-cloud/blob/main/docs/product-and-platform.md)
and [backlog](https://github.com/waitron-io/waitron-cloud/blob/main/docs/backlog.md)
own the service catalogue, customer accounts, subscriptions, country placement,
mini-zones, provider integration and cloud operations.

Waitron owns the node application and its side of the cloud integration. Keep local
trading, user management, signup UI, box credentials, backup/restore behaviour,
SQLite and Litestream, promotion/rejoin, hardware and core fiscal work here. Cloud
hosting runs that application; it does not create a second implementation of it.

## Moved on 2026-09-22

The original paths below now forward to the full documents in Waitron Cloud:

- [Cloud services inventory](superpowers/specs/2026-08-29-cloud-services-inventory.md).
- [Cloud gateway handoff](superpowers/specs/2026-09-21-cloud-ingress-wireguard-gateway-design.md).
- [Historical cloud storage model](superpowers/specs/2026-07-31-cloud-storage-model-design.md).
- [Relay decision](superpowers/specs/2026-09-05-relay-decision.md).

The move preserves historical text and provenance. It does not reconcile the older
per-venue endpoint decision with the newer shared gateway proposal. Current country,
provider and deployment-group decisions belong to the Cloud discussion.

Cloud-specific backlog entries now live in the Cloud backlog. This repository keeps
its integration and core work, with links for shared requirements. In particular,
production object-store validation and the promoted cloud generation still need
proof; moving their tracking does not complete them.

The [SQLite topology](superpowers/specs/2026-09-16-sqlite-litestream-topology-design.md),
backup/restore designs, old cloud-mirror implementation plans and
[box maintenance discussion](superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md)
remain here because they govern Waitron code or local operation. The full
[ownership map](https://github.com/waitron-io/waitron-cloud/blob/main/docs/documentation-ownership.md)
explains that split.
