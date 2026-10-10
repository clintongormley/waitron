# Languages and photographs for your menu

You can add French text to a Spanish menu without changing the language of the dashboard
or your receipts. Start by choosing the languages your content supports, then add translations as
you need them. The image library uses the same choices as your products, sections and
[modifiers](modifiers.md). An options list, each of its options, and an extras list all participate
in the default-language translation check. An entry on an extras list does not: it has no name of
its own, and takes the product's.

## Choose your content languages

A new venue starts with its content languages already chosen: the languages Waitron keeps enabled
for its region, plus English. In Spain Waitron keeps Spanish enabled in every region where a venue
can be set up today, and Catalan as well in Catalonia, the Valencian Community and the Balearic
Islands, and Galician in Galicia; there that regional language is the default. Elsewhere in Spain
Spanish is the default. A venue in another country starts with its country's language and English.
To add another, open **Settings**, then **Content languages**, which shows your languages and
their missing-name counts in a table, with the default first. Select **Add language**, then choose
the language to add it. The choices show your country's official languages first, under
**Official languages**, while any of them is not yet added. The added language's translation fields are then available throughout your content editors.
To change the default, open that language's ⋮ menu and select **Make default**.

A language Waitron keeps enabled for your region is marked **Required** and has no **Delete**, and
if it is ever missing, your next save on this page adds it back. Where the region also asks for
foreign languages, the page shows a notice while you have fewer than it asks for.

For example, with Spanish as the default and English alongside, a product whose customer-facing name
reads **Pan de verano** in Spanish can leave its English one empty while you prepare the translation.
Where English content is requested, it displays **Pan de verano** until you enter **Summer bread**.
This fallback uses the Spanish text without copying it into the English field, so later Spanish edits
remain visible where the translation is still missing.

Required fields need text in the default language. Other translations can wait. To change the
default to English, first complete the required English translations and image names.
If the change is refused, select **Edit translations** in English's ⋮ menu to open the report: the
names marked **Partly translated** under English hold it up, and each has an **Open** link to the
screen where it is edited. Image names are checked too but are not listed there, so check them in
the **Image library**. Something you have deleted or switched off can also hold the change up
without appearing in the list.

A product's and a variant's customer-facing name is the exception, because it is optional: leave it
empty in every language and Waitron falls back to the staff name, so it never blocks the change.
Fill it in for Spanish and leave English blank, though, and that *is* a missing translation — you
clearly meant to translate it — so it does hold the change up until you finish it or clear it. A
section's customer-facing names work the same way: none at all never blocks the change, but a
section with some names and none in the new default language does. Edit a section's customer-facing
names on its menu's **Structure** tab, in **Products and menus**, **Menus**. A menu's own
customer-facing names are edited through **Rename** on the menu's row in that list, not on its
**Structure** tab, although the **Missing translations** link for a menu's own name opens that tab.
A menu included in another menu can give its folder customer-facing names of its own: choose
**Edit** in that include's ⋮ on the including menu's **Structure** tab. When such a folder's names,
its own together with the ones it takes from the included menu, are filled in for some languages but
not the new default, it holds the change up too, and **Missing translations** lists it as
**Included menu folder**. This holds while the include shows its sections directly too; turn
**Show as a folder** on to see the names.

**Edit translations** opens a dialog containing **Missing translations** for your content
languages. The language you chose opens; languages marked **Required** come first and have a note
saying how many names still need translating into them. The report keeps its Kind and Why filters
and links to each existing editor; direct text entry in this dialog is planned separately. A name
filled in for some languages but not this one is marked **Partly translated**. Something with no customer-facing
name at all is listed under your other languages as **No customer-facing name**, because there its
staff name is shown instead; an extras list is the exception, because its own name never reaches a
receipt. Archived products, disabled lists and switched-off menus are not listed.

Selecting **Delete** in an additional language's ⋮ menu hides its ordinary translation fields
but keeps the saved text.
Add the language again to resume using those translations. The default language's row has no
**Delete**: choose another default first. A required language's row has none either.

Your receipt-language settings remain independent. A receipt prints in one language, chosen for
each location on the **Receipts** tab of **Venue settings**, which fixes it to Catalan in
Catalonia. In Spain, a copy
reprinted on the till can be printed in Spanish, Catalan, Galician or Basque, and the till asks which; product
names on the copy stay as they were issued. Adding English content does not add an English receipt,
and changing the content default does not rewrite issued
receipts. If the receipt language is not one of your content languages, this page and the Receipts
tab of Venue settings show a note: product names on receipts then print in your default language.
Kitchen displays,
orders you retrieve and sales reports keep their recorded names, even if you later remove that
language from your content settings. The language of Waitron's buttons and screens remains your
separate interface preference. These content settings
also provide the language choices for future online content; they do not create an online ordering
site.

## Add a photograph once

Open **Image library**, choose **Upload photo**, and select a JPEG, PNG or WebP file. Give it a short
name that helps you find it. The name is required in your default content language; names in your
other content languages are optional.

Waitron keeps a smaller copy of each photograph rather than the file you chose. A phone photo is
often several megabytes, and a library of thousands of them would make every backup and every
restore slow, so Waitron resizes each upload to at most 1600 pixels on its longer side, keeps its
shape, and saves it in the WebP format. A photo that is already smaller is never enlarged. Waitron
also removes the hidden details cameras add, such as where and when the photo was taken, because
anyone who has a photo's address can open it. Files up to 20 MB are accepted. If a photo is refused
as too large, has too many pixels or cannot be read, export a smaller copy from your photo app and
upload that instead.

For the bread photograph, you might enter **Pan de verano** as the Spanish name. Leave the English
name blank until you have a translation. Choose **Save** to add the photo to the library; cancelling
before Save leaves it out of the library.

## Find and reuse an image

**Search images** finds photographs by the words in their names, in any order, and searches as you
type: the word you are still typing can be any part of a word, so **read** finds **Summer bread**.
Once you type a space after a word, it matches only that whole word. Accents and capitals make no
difference, so **cafe** finds **Café con leche**. Every word has to be in the name in one
language. Choose **Relevance** to list the closest matches first, **Date** to browse uploads or
**Name** to scan names. Date starts with the newest uploads; switch to **Oldest first** when you
need the earliest ones. Name starts with **A–Z** and also offers **Z–A**. Use the page controls when more photographs match than fit on the current page.

On a product's or a variant's own page, select the photo beside the name to open the same library.
With no photo it is an empty square; on a variant's page with no photo of its own, it shows the main
product's photo with a dashed border. In a variant's small window or a section's editor, select
**Choose image**. Then select **Use image** on the photograph you want, and save to keep the
association. You can reuse one photograph on several products. Uploading the same file again finds the existing image and keeps its existing
names, as long as Waitron's image library has not been upgraded in between: a newer version may make
a slightly different copy, which is then stored as a new image. A notice identifies the reused image
and lets you open it for editing.

Choose **Edit** on the photograph's card in the library to add translations or change its name.
Editing this shared record changes the metadata wherever that photograph is reused.

## Remove a use before deleting the photograph

**Remove image** clears the association when you save. On a product's or a variant's own page it is
at the bottom of the library window the photo opens, shown when there is a photo of its own; in a
variant's small window it sits beside **Choose image** whenever a photo is shown, and is greyed out while that photo is the main product's, because the variant has no photo of its own to remove. The photograph
stays in the library for your other products.

To remove the photograph itself, choose **Delete** in the library and confirm. If any product,
product variant or section still uses it, deletion is blocked. You see links to those products,
including archived products, and to those sections, a section shown by its internal name. Remove
the photograph from each editable record before trying deletion again. An archived product opens
read-only details and cannot have its picture removed through the product editor, so a picture
that it still uses remains blocked from deletion. A section's link opens its menu's
**Structure** tab, in **Products and menus**, **Menus**, where **Remove image** in the section's
editor clears it when you save the section. A menu's own photograph is removed the same way
through **Rename** on the menu's row in **Products and menus**, **Menus**. A menu included in
another one can hold a photograph of its own for its folder. The library lists that use as
**<included menu> folder in <including menu>**, and its link opens the including menu's
**Structure** tab: choose **Edit** in that include's ⋮, then **Remove image**, and save. The
photograph still blocks deletion while the include shows its sections directly; turn **Show as a
folder** on to see the photo field.

A published menu also holds every photograph its last publish included, even after you remove the
photograph from a product or section. The library lists that menu by name, followed by
**(Published menu)**, and its link opens the menu. Publish the menu again without the photograph
to release it.

A saved receipt logo also keeps a photograph in use. Follow its link to **Venue settings**,
**Receipts**; a department logo link selects that department, including a switched-off one.
Clear the saved logo before deleting the photograph.
