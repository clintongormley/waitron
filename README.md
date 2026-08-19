# Waitron

Restaurant management for hospitality — point of sale, bookings, ordering, kitchen management and
payments, with Spanish VERI\*FACTU fiscal compliance built in.

Runs standalone and self-hosted on a single machine, or as a multi-tenant cloud service (the
licensor's hosted offering), from the same codebase.

> **Status: pre-release.** Not yet running in production anywhere. Interfaces change without
> notice.

## Licence

Waitron is **source-available**, not open source. It is licensed under the
[Elastic License 2.0](LICENSE), with [additional permissions](LICENSE-GRANTS.md).

In plain English:

**You may**, free of charge and at any scale —

- run Waitron for your own restaurant business, however many locations, on infrastructure you control;
- read, modify and redistribute the source, provided you pass these terms on with any copy you
  distribute and mark modified copies as modified;
- pay anyone you like to install, configure, host, administer or support it **on infrastructure
  you control, under your own accounts**;
- sell hardware with Waitron pre-installed, for the buyer to own and run.

**You may not** —

- provide Waitron to third parties as a hosted or managed service;
- circumvent licence-key functionality;
- remove or obscure licensing, copyright or other notices.

If the licensor publicly announces that Waitron is discontinued, or twelve months pass with no
release, the current version also becomes available under Apache 2.0 — see Grant 2. Your till
does not die if we do.

The authoritative terms are in [LICENSE](LICENSE) and [LICENSE-GRANTS.md](LICENSE-GRANTS.md);
this summary has no legal effect. Licensing questions: info@waitron.io

**Trademark.** No trademark rights are granted by the licence. The name "Waitron" and the Waitron
logo are reserved by the licensor and are not licensed with the software. You may state accurately
that your product is built on or derived from Waitron; you may not name or brand your distribution
"Waitron". Rebranding to comply with this is expressly permitted and is not "obscuring a notice"
under the licence — see Grant 3 and the trademark section in
[LICENSE-GRANTS.md](LICENSE-GRANTS.md), which are the operative text.

Copyright © 2026 Clinton Gormley.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions require a Developer Certificate of Origin
sign-off and grant the project the right to relicense.

## Running it locally

Run the whole app — the two browser front-ends and the API server — against a locally-provisioned
**preproduction** venue.

**Prerequisites:** [Docker](https://www.docker.com/) (for the dev Postgres), Node ≥ 24, and
dependencies installed (`pnpm install`; a worktree made with `worktree.py` already does this).

**First-time setup** (once per checkout):

```bash
pnpm dev:setup
```

This brings up a throwaway Postgres in Docker (`docker-compose.yml`), migrates it, provisions one
venue (tenant, location, till, fiscal series), seeds a small catalogue and a cashier, and writes the
ids to a gitignored `apps/server/.env`. It is idempotent: run it again and it reuses the same venue
rather than minting a new fiscal chain.

**Run it:**

```bash
pnpm dev
```

starts all three processes in parallel:

| Process   | URL                   |
| --------- | --------------------- |
| Till      | http://localhost:5190 |
| Dashboard | http://localhost:5191 |
| Server    | http://localhost:8080 |

Each front-end proxies its API to the server (the till's `/api`, the dashboard's `/management-api`).
Log in at the till with the **cashier PIN 5555**; the dashboard admin PIN is **1234**
(`pnpm dev:setup` prints both).

To start over from a clean database (throwaway preproduction data), `pnpm dev:reset` wipes the Docker
volume and re-provisions.
