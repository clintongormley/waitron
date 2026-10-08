# Fiscal records, invoices and the asesor — detail

The open entries are listed in [the backlog](../backlog.md), under "Fiscal records, invoices and the asesor". This file holds
their full text.

## No sale over €3,010 can be made at all

- **No sale over €3,010 can be made at all**: Waitron issues only simplified invoices and no screen
  accepts a customer's tax ID, so a full invoice is not offered. Spain's legal ceiling for a
  simplified invoice in hospitality is €3,000 (RD 1619/2012 art. 4.2, quoted in
  [verifactu-findings.md](../compliance/verifactu-findings.md) and the
  [full-invoices design](../superpowers/specs/2026-10-03-full-invoices-at-till-design.md)); the
  branch refuses over €3,010, the limit `@waitron/verifactu`'s validator applies (3,000 plus its
  10.00 tolerance), as the owner asked.
