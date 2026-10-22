# Appearance

Your dashboard and tills can carry your venue's own colours instead of Waitron's blue. The
**Appearance** page under **Settings** shows the look in use, and lets a manager change it and
see the result before anyone else does.

## See the look in use {#look}

Open **Settings**, then **Appearance**. The **Look** card shows the **Theme in use** and the
choices it is made of:

- **Brand colour**: the colour of the main buttons and of selected items. **Waitron's** means the
  theme keeps Waitron's own colour. A colour that is not one of the swatches shows as **Custom**
  with its code. Where a readable shade was taken in place of the colour, the row names it too.
- **Background**: **Neutral** keeps Waitron's greys, and **Tinted** gives the page, field fills
  and borders a faint cast of the brand colour.
- **Corners**: **Square**, **Standard** or **Round**, for buttons, fields and cards.
- **Colours set by hand**: any of the theme's colours that were given a value of their own rather
  than worked out from the brand colour, or **None**. This page cannot set a colour by hand, but
  its fixes can replace one that is hard to read with a readable shade, and **Use Waitron's look**
  removes them all.

The note at the bottom of the card explains that one look covers the dashboard and every till.
Each theme has a light version and a dark version, and each screen shows one of them, as its own
**Theme** setting says: Light, Dark or Follow device. The **Themes** card under it lists the
venue's themes.

Anyone whose role is **Supervisor** or above can open this page and read the card. Only a
**Manager** or an **Admin** can change the look.

## Edit a theme {#edit}

The Look card shows **Edit** to a **Manager** or an **Admin**, whichever theme is in use. It opens
the theme in use. To edit one of the venue's other themes, or to start a new one, use the
**Themes** card below it.

While Waitron's theme is in use, Edit opens on Waitron's choices. Waitron's own theme never
changes, so when you save, Save asks for a name and stores your choices as a new theme. That is
how a venue makes its first theme.

A line at the top of the editor says what saving does. Editing the theme in use, it reads "Theme
in use:" with the theme's name, and "Saving changes every screen." Editing any other theme, it
reads "Not in use. Saving changes no screen until you use it.", and the card's heading names the
theme, or reads **Add theme**.

The editor opens the theme's three choices in place:

- **Brand colour**: pick **Waitron's**, one of the swatches, or **Custom** to choose any colour.
  You can also type a code such as `#1e5b3a` into the box beside **Custom**. A code must be `#`
  followed by six digits or letters a to f, or Save tells you so under the field.
- **Background**: **Neutral** or **Tinted**.
- **Corners**: **Square**, **Standard** or **Round**.

Beside or below the choices, the **Preview** paints a small sample of the dashboard in the look you
are building: a **Light version** and a **Dark version**, each with a selected menu item, a field,
Save and Cancel buttons, a switch, a link and a Light and Dark choice. It is a picture, so its
buttons do nothing. The editor arranges itself by the width of the card rather than of the window.
On a wide card the preview sits beside the choices, and on a narrow one below them. When the
preview has room, the two versions sit side by side; otherwise the light version sits above the
dark one.

Nothing else on the page, and no other screen, changes until you save. **Use Waitron's look** sets
every choice back to Waitron's: Waitron's brand colour, Neutral, Standard corners, and no colours
set by hand. It saves nothing by itself, and it is greyed out while the choices already are
Waitron's look. **Cancel** closes the editor without saving. If you have changed something, Cancel,
leaving the page, and opening another theme from the Themes card ask you first.

## When a colour is hard to read {#hard-to-read}

Some brand colours make buttons hard to see. A sunny yellow such as `#f2c94c`, for example, barely
stands out on a light screen. When that happens, a warning appears under the brand colour: "Buttons
in this colour are hard to see on light screens."

When a shade of your colour would read well, the warning comes with a button that offers it. For
that yellow on a Neutral background, the button reads **Use #a78612 on light screens**. Press it and
light screens use the shade, while dark screens keep your colour. The line then reads "Buttons on light screens:" with the shade, and
**Undo** puts your colour back.

A shade you take belongs to its colour. Picking another brand colour drops it, and returning to the
theme's saved colour brings its saved shade back. Changing the background or the corners keeps it.

When two or more of the warnings each offer a fix, a line under the editor counts the colours that
are hard to read and offers **Fix all**, which takes every fix at once.

Waitron never refuses a colour. A warning is advice: you can save the colour you chose and live
with it.

## Save a theme {#save}

**Save** is greyed out until you change something. What it does next depends on the theme you are
editing.

Editing one of the venue's own themes, Save stores your changes to it and closes the editor.

Editing Waitron's theme, or a theme you started with **Add theme**, Save opens the **Name this
theme** dialog, after the **Hard to read** dialog when that appears, because your choices are about
to become a theme of their own. Its **Use it on every screen now** switch starts on when you are
editing Waitron's theme in use, and off for a new theme. **Save** in the dialog stores the new theme
and closes the editor. **Back** leaves you in the editor with nothing saved, asking first if you
typed a name. The rules for a name are under "Name a theme" below.

When something is still hard to read, Save first opens the **Hard to read** dialog, with one line
for each colour that is. It offers three choices:

- **Back** returns you to the editor with nothing saved.
- **Save anyway** saves the colours as you chose them.
- **Fix and save** takes every fix, then saves. The dialog offers it only when fixing everything
  would leave no warning at all.

Where Save asks for a name, **Save anyway** and **Fix and save** open the name dialog rather than
saving at once. While its switch is on, the name dialog lists the colours that are still hard to
read, so you see them before the theme goes on every screen.

When the theme you saved is the one in use, the dashboard you are using changes to the new look at
once. Other dashboards open at the same time follow on their own, and a signed-in till follows the
next time it checks its menu for changes. A handheld phone or tablet, and a cash register set up
for counter service, check every 15 seconds. Any other cash register checks every 15 seconds while
a table's order is open on it, and otherwise follows when it next opens one, or when it restarts.
Saving a theme that is not in use changes no screen until you put it in use.

If you saved anyway, the Look card keeps a warning line for each colour that is still hard to read,
so the next person who opens the page sees it too.

While you edit one of the venue's own themes, the editor also offers **Save as new theme…**. It
opens the name dialog with the theme's name followed by "(copy)", stores your choices under the name
you give, leaves the theme you were editing as it was last saved, and closes the editor. Its **Use
it on every screen now** switch starts on when the theme you are editing is in use. When a colour is
still hard to read, the **Hard to read** dialog comes first, as it does for Save. Like Save, it
tells you under the field when a colour code you typed is not valid, and saves nothing until you fix
it.

## The venue's themes {#themes}

The **Themes** card lists every theme the venue has, Waitron's first. Each row shows the theme's
**Name**, its **Colours** and its **Status**. The colours are three dots: the brand colour, then
the page colour of the light version and of the dark version. When the card is narrow, as on a
phone or beside the side menu on a small screen, it leaves the colours out, and on a phone the
status tags sit after the theme's name instead of in a column of their own. The status tags say
which theme is **In use** and how many of a theme's colours are hard to read, such as "2 hard to
read". Waitron's theme carries the tag **built in**.

A **Manager** or an **Admin** sees **Add theme** on the card, which opens the editor on Waitron's
choices for a theme that is not yet stored, and a menu on each row:

- **Edit** opens that theme in the Look card's editor. A theme that is not in use opens with the
  line "Not in use. Saving changes no screen until you use it."
- **Rename** gives the theme a new name.
- **Make a copy** stores a copy of the theme under a new name. The name dialog proposes the theme's
  name followed by "(copy)". The copy is not in use unless you turn on **Use it on every screen
  now** before you save.
- **Use on every screen** puts the theme in use. The row of the theme in use does not offer it.
- **Delete** removes the theme. The row of the theme open in the editor does not offer it.

Waitron's row offers only **Make a copy**, and **Use on every screen** while another theme is in
use, because Waitron's theme cannot be edited, renamed or deleted. A **Supervisor** sees the list,
without Add theme and without the menus.

## Name a theme {#names}

The **Name this theme** dialog asks for a name whenever a theme is stored under a new one: the first
save of Waitron's theme or of a new theme, Save as new theme…, Make a copy, and Rename. A name is 1
to 60 characters long, and spaces at either end are dropped. Two themes cannot share a name,
whatever their capitals: while a theme called "Terrace" exists, naming another one "terrace" is
refused with "A theme with this name already exists." No theme may be called "Waitron", in any
capitals, because that is the built-in theme's name.

Every way in but Rename shows the **Use it on every screen now** switch. Rename has no switch, and
renaming a theme changes no screen's look.

## Put a theme in use {#switch}

**Use on every screen** asks first, with a question such as "Use Terrace on every screen?" When
the theme has colours that are hard to read, the question lists them under "Hard to read:".
**Use it** puts the theme in use, and **Back** changes nothing.

Once a theme is in use, the dashboard you are using changes to it at once and other dashboards
open at the same time follow on their own. Signed-in tills follow as they do when you save the
theme in use, as "Save a theme" above describes. Waitron never refuses a theme for being hard to
read: the list is there so that you choose knowing it.

## Delete a theme {#delete}

**Delete** asks first, naming the theme and saying the delete cannot be undone. When the theme is
the one in use, the dialog says so under "What changes": deleting it puts Waitron's theme on every
screen, and the screens change as they do when you put a theme in use.
