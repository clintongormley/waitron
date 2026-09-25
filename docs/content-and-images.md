# Languages and photographs for your menu

You can add French text to a Spanish menu without changing the language of the dashboard
or your receipts. Start by choosing the languages your content supports, then add translations as
you need them. The image library uses the same choices as your products, sections and
[modifiers](modifiers.md). An options list, each of its labels, and an extras list all participate
in the default-language translation check. An entry on an extras list does not: it has no name of
its own, and takes the product's.

## Choose your content languages

A new venue starts with its content languages already chosen. A venue in Spain starts with Spanish
as the default and Catalan and English alongside; a venue anywhere else starts with one language,
worked out from where it is. To add another, open **Products**, then **Content languages**, keep
your default, choose the language and select **Add**. Save the settings to make its translation
fields available throughout your content editors.

For example, with Spanish as the default and English alongside, a product whose customer-facing name
reads **Pan de verano** in Spanish can leave its English one empty while you prepare the translation.
Where English content is requested, it displays **Pan de verano** until you enter **Summer bread**.
This fallback uses the Spanish text without copying it into the English field, so later Spanish edits
remain visible where the translation is still missing.

Required fields need text in the default language. Other translations can wait. To change the
default to English, first complete the required English translations and image names.
If the change is refused, check your products, modifiers, sections and image metadata for
missing translations. Sections are edited in **Products and recipes**, **Sections**.

A product's and a variant's customer-facing name is the exception, because it is optional: leave it
empty in every language and Waitron falls back to the staff name, so it never blocks the change. Fill
it in for Spanish and leave English blank, though, and that *is* a missing translation — you clearly
meant to translate it — so it does hold the change up until you finish it or clear it. A reusable
section's customer names work the same way: none at all never blocks the change, but a section with
some names and none in the new default language does. Edit a reusable section's customer names in
**Products and recipes**, **Sections**.

Removing an additional language hides its ordinary translation fields but keeps the saved text.
Add the language again to resume using those translations. You cannot remove the default language
until you choose a replacement.

Your receipt-language settings remain independent. Adding English content does not add an English
receipt, and changing the content default does not rewrite issued receipts. Kitchen displays,
orders you retrieve and sales reports keep their recorded names, even if you later remove that
language from your content settings. The language of Waitron's buttons and screens remains your
separate interface preference. These content settings
also provide the language choices for future online content; they do not create an online ordering
site.

## Add a photograph once

Open **Image library**, choose **Upload photo**, and select a JPEG, PNG or WebP file. Give it a short
name that helps you find it and, if you can, alt text that describes the photograph for someone who
cannot see it. Only the name is required, in your default content language; alt text is optional but
recommended for accessibility.

Waitron keeps a smaller copy of each photograph rather than the file you chose. A phone photo is
often several megabytes, and a library of thousands of them would make every backup and every
restore slow, so Waitron resizes each upload to at most 1600 pixels on its longer side, keeps its
shape, and saves it in the WebP format. A photo that is already smaller is never enlarged. Waitron
also removes the hidden details cameras add, such as where and when the photo was taken, because
anyone who has a photo's address can open it. Files up to 20 MB are accepted. If a photo is refused
as too large, has too many pixels or cannot be read, export a smaller copy from your photo app and
upload that instead.

For the bread photograph, you might enter **Pan de verano** as the name and **Rebanadas de pan con
tomate sobre un plato blanco** as the Spanish alt text. Leave the English fields blank until you
have a translation. Choose **Save** to add the photo to the library; cancelling before Save leaves
it out of the library.

Enter labels separated by commas, such as **Food, Summer menu**. You can assign several labels and
reuse them on other photographs. A new label appears when you save its first image. When you remove
its last assignment, it disappears from the label filter. Capitalization variants share one label.

## Find and reuse an image

Search the names, alt text and labels, and narrow the results with **Filter by label**. Choose
**Relevance** to prioritize search matches, **Date** to browse uploads or **Name** to scan names.
Date starts with the newest uploads; switch to **Oldest first** when you need the earliest ones.
Name starts with **A–Z** and also offers **Z–A**. Use the page controls when more photographs match
than fit on the current page.

In a product editor, select **Choose image** to open the same library, then select **Use image** on
the photograph you want. Save the product to keep the association. You can reuse one photograph on
several products. Uploading the same file again finds the existing image and keeps its existing
names, alt text and labels, as long as Waitron's image library has not been upgraded in between: a
newer version may make a slightly different copy, which is then stored as a new image. A notice
identifies the reused image and lets you open it for editing.

Choose **Edit image** in the library to add translations or change its labels. Editing this shared
record changes the metadata wherever that photograph is reused.

## Remove a use before deleting the photograph

**Remove image** in a product editor clears that product's association when you save the product.
The photograph stays in the library for your other products.

To remove the photograph itself, choose **Delete** in the library and confirm. If any product,
product variant, category or section still uses it, deletion is blocked. You see links to those
products, including inactive products, to those categories, and to those sections, a section
shown by its internal name. Remove the photograph from each of them before trying deletion again. A
section's link opens its editor in **Products and recipes**, **Sections**, where **Remove image**
clears it when you save the section.
