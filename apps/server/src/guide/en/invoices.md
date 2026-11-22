# Invoices

When the tax office asks to see the venue's invoices, show them from **Invoices** in
**Reporting**.

## Show invoices yourself {#show-invoices}

Open **Invoices** on your own sign-in. You need an access role that includes
**See invoices for the tax office**. At the venue it works without the internet.

The list opens on this month. To find an invoice, change **Issued from** and **Issued to**, or
narrow the list by:

- **Search**: the invoice number, the customer's name or their tax ID
- **Amount**: an invoice's total, base or VAT
- **VAT rate (%)**
- **Kind**
- **Operation from** and **Operation to**

Choose an invoice's number to see it as a PDF, then print or save it from there. A cancelled
invoice stays in the list, marked with the day it was cancelled. If the list ends with
**Show more invoices**, choose it to see the rest.

To hand over a whole month, choose **Download** beside the dates: the server prepares one file
holding a copy of every invoice issued in the month that **Issued from** falls in, and a
spreadsheet of those invoices. You can leave the page while it does; a notice says when to choose
**Save the file**, and a file not saved stays on the server for an hour.

## Give an inspector their own sign-in {#inspector-sign-in}

An inspector can have their own sign-in when the box's email is set up
([Email](email.md#set-up)), because their first password arrives by email.

- In **Access roles**, create a role that holds only **See invoices for the tax office**. With
  only that role, the inspector sees **Invoices** and their own **Account settings**, and
  nothing else.
- In **Users**, add the inspector with their email and that role. Waitron emails them an
  invitation; see [Account access](staff.md#account-access).
- They sign in at the venue or, with [remote access](servers.md#remote-access) on, through
  Waitron Cloud.
- They can choose **Download** beside the dates to prepare a month's invoices, each as a copy,
  with a spreadsheet of them, then **Save the file** when the notice says it is ready.
- When the visit ends, disable their account in **Users**.

## VAT return and corrections {#vat-return}

**VAT return (modelo 303)** in **Reporting** prepares the file you upload to AEAT for a month or a
quarter. Choose **Year**, **Period** and **Declaration type**, then **Download file**. Nothing is
sent to AEAT from here.

The file's sales side counts the VAT that belongs to the period and was recorded by its last day,
so a correction, a cancellation or a late ticket recorded after the period ended never changes its
sales figures. It appears instead in the corrections of the period it was recorded in.

Before you file, also choose **Download corrections (XLSX)** for the same period and give both to
your adviser. Its first two sheets list what was recorded in the period for earlier periods:

- **Summary**: base and VAT for each earlier period, VAT rate, and whether it is a reduction or an
  addition.
- **Corrections**: one line per invoice, kind and VAT rate, with the day it was made, its kind
  (**Corrective**, **Void**, **Date moved out**, **Date moved in** or
  **Issued after its sale's period**), its invoice number, the invoice it corrects and the period
  it belongs to.

Its **Given free** sheet lists each comp and each discount to zero on the bills opened in the
period, one row per dish or for a whole bill on each bill its dishes are on, with its
**Invoice number**, **Menu price (EUR)** and **Estimated cost (EUR)**. A row counts only what is
still on a bill, so a dish taken off the bill is not listed. The estimated cost is the menu price
without VAT less the department's estimated margin, and stays blank when the department has none.

Set a department's margin in **Departments and zones**: open the department and fill in
**Estimated margin (%)** on its **Details** tab. The workbook uses the margins saved when you
download it, so changing one also changes the estimates for earlier periods.
