# Dependency upgrades — detail

The open entries are listed in [the backlog](../backlog.md), under "Dependency upgrades". This file holds
their full text.

## Open Dependabot pull requests

- **Open Dependabot pull requests — low priority, not queued (owner, 2026-10-08: take them from here
  when a lane has room).** #1179 (Vitest 5) waits on Stryker (owner). The rest, each landed per
  workflow-guide → Dependabot pull requests:
  1. **sharp 0.35.5 (#1299 root, #1423 `apps/server`) and the compose group (#1178).** Land the two
     sharp PRs together. sharp is copied into the box image and left out of every bundle, so the
     image smoke's sharp step is the proof — and a PR that changed no image input builds no image
     (CLAUDE.md §2): say how the image was built for it (a `workflow_dispatch` on the head, with its
     `headSha`). For compose, check the dev stack still starts if a service image moved.
  2. **The npm minor-and-patch group (#1267, 13 updates).** Rebase first. Read every package's notes
     across its whole range; list anything that changes behaviour, a default or built output, and
     diff built artefacts for anything in a bundle. A bump that breaks is dropped from the group,
     with the reason recorded.
  3. **stripe 22.6.2 → 23.0.0 (#1181, a major).** Map each breaking change to
     `packages/payments-stripe` call sites; test through the real client as well as a fake (CLAUDE.md
     §4). Payments: full review path.
