# Interface audit — widths, touch and a slow connection

The app was driven over the Chrome DevTools Protocol at a range of viewport
widths (1480, 1200, 1024, 900, 880, 700, 600), with touch emulation on and
with a link whose page answers after six seconds, standing in for a throttled
3G connection. Every screenshot below is the real app running against a
throwaway library.

## 1. The Settings rail collapsed and overlapped the pane title

`01-settings-rail-before-700px.png` → `01-settings-rail-after-700px.png`

The Settings dialog borrowed the app's `--sidebar` width. On a narrow window
that variable is zero, so the rail became one pixel wide and its search field
and icons spilled over the "Galleries" title. The dialog now keeps its own
width for the rail, so the nav is always where it belongs.

## 2. The details panel took a third of a narrow window

`02-details-column-before-700px.png` → `02-details-column-after-700px.png`
(`02-details-sheet-open-600px.png` shows the panel as a sheet)

Below 880px the File Details column left the gallery 360px, one card per
screen, and crushed the toolbar beside it. The panel now steps aside: the
gallery takes the whole width and the panel returns as a sheet over it, opened
with the same button or ⌘I. Wider windows are unchanged.

## 3. The search field shrank to a few characters

`03-toolbar-search-before-600px.png` → `03-toolbar-search-after-600px.png`

At 600px the search input was 23px wide and the view title was cut to "Lib…".
The field now keeps a usable width, the item count gives up its place first,
and on a touch screen the field is a finger-sized target rather than a
hairline.

## 4. A link on a slow connection showed a placeholder letter

`04-slow-link-before.png` → `04-slow-link-after.png`

While the page was still on the wire, the card showed a large flat letter and
the file name repeated the address underneath it. A link that has not answered
yet now keeps the website card's shape: the site's own mark in place of the
picture and the address below it.
