# Contributing to Waitron

Thanks for your interest. Waitron is source-available under the
[Elastic License 2.0](LICENSE) with [additional permissions](LICENSE-GRANTS.md). Please read
both before contributing.

## Inbound licensing

**By submitting a contribution — a pull request, a patch, or any other change — you grant
Clinton Gormley and his successors and assigns a perpetual, irrevocable, worldwide,
royalty-free, transferable, sublicensable licence to use, reproduce, modify, prepare derivative
works of, publicly display, distribute, and relicense your contribution, in whole or in part,
under any terms, including commercial terms.**

You retain copyright in your contribution. This grant does not take it from you; it lets the
project ship your work under its current licence and under any future licence, including the
commercial terms under which Waitron itself is operated.

You confirm that you are legally entitled to grant this — that the work is yours, or that you
have permission from whoever owns it, such as an employer.

## Developer Certificate of Origin

Every commit must be signed off, certifying the
[Developer Certificate of Origin 1.1](https://developercertificate.org/):

```
git commit -s -m "your message"
```

This appends a `Signed-off-by: Your Name <your@email>` trailer. Commits without it are rejected
by CI. Use your real name and a real email address.

## Before you open a pull request

- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm format:check` all pass.
- New behaviour has tests.
- Commits are signed off.
