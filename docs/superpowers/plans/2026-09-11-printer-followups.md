# Printer follow-ups implementation

1. Add failing browser tests for delete confirmation and named switches. Preserve routing
   writes, rejected-write restoration, reactivation and modal accessibility assertions.
2. Move cell styles to shadow parts and rerun portrait/landscape bounds checks. Reproduce
   timestamp parsing under non-default PostgreSQL date display settings and fix the aggregate.
3. Add failing parser tests for ordered text, feed, cut, raster and native QR blocks, plus
   malformed and oversized data. Implement bounded decoding and browser paper rendering.
4. Verify bitmap pixels, receipt order, paper-width changes, escaped content, both themes and
   keyboard scrolling in browser tests. Check available hardware without resetting the box.
5. Run affected package coverage and `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`.
   Update the backlog with completed work and the exact limits of hardware validation.
