# Pre-A261-2 configuration export

`pre-a261-2-configuration.enc` is the unmodified response body from
`POST /management-api/configuration-export` at commit
`d83e977dd9e526a3ab90b60daa3ec3d08e6d2ab0` (`c47122f55^`, before Departments and zones).
Its SHA-256 is `b97693ed468d52018dcb5549bb70c918a83830a5def76bf1df6b09c7ca0596f6`.
The passphrase is `a strong passphrase`; every identity is a disposable test identity.

The capture used that checkout's `configuration-export-api.test.ts` fixture:
`useVenueDb` applied all manifest migrations, `applyVenue` created Prepared Export SL,
and the existing fixture authenticated its administrator with `startManagementSession`.
A temporary test sent the same authenticated request as its encrypted-artifact test,
then saved the response bytes without rewriting them. The focused capture command was
`pnpm --filter @waitron/server exec vitest run src/configuration-export-api.test.ts -t 'captures the actual'`.
It reported one passing test on 2026-10-06. The checkout had its own frozen dependency install.

The decoded export has core version 99 and venue-service version 19. It contains neither
`department_sale_policies` nor `zone_sale_policies`. The current setup-route regression
uses these original encrypted bytes, checks the module refusal, compares every database
table's rows before and after, and checks that the staging directory remains empty.
