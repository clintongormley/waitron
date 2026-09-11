# Implementation plan

1. Add browser tests for tab selection, panel visibility, retained drafts, keyboard navigation,
   narrow layouts, theme tokens and accessibility; observe failure, implement and rerun.
2. Extract the existing hamburger action menu into shared UI, keeping its behavioral assertions.
3. Add scoped department, menu and route editing APIs with failing tests first.
4. Convert Venue operations into five URL-backed tabs, tables and modal editors. Adapt existing
   behavioral tests to open tabs and menus, and add history, cancellation and failure coverage.
5. Document the component contract and workbench examples. Run package coverage and the repository
   gate; report readiness for finish-branch.
