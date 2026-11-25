# Check what stays visible after an availability save

When a pointer save sends a dish partly covered by the sticky heading to the bottom of the
Available sort, the next visible dish should stay in place. The watcher put the investigation
ahead of bulk availability at 17:49 in Lane H's questions.md on 25 November 2026.

The first diagnosis treated the change in the table's scroll offset as a visible jump. Claude's
build review questioned that measurement. In macOS Chromium, a real click followed by a successful
refresh on 3514422237 changed the offset from 153 to 99 px. The next dish moved from 304 to 303.5 px.
The proposed product change fixed the offset at 153 px and moved the next dish to 249.5 px, behind
the heading at 277 px. Both focus cases gave the same figures. In seven runs on one Mac, the old
test reached different starting scroll positions with the same fonts. It failed only when the
clicked row was partly under the heading. The geometry of the old passing CI run is unverified.

The watcher cleared the revised scope at 19:05 in Lane H's questions.md. Keep the product's current
scroll anchoring. In the existing Products screen test, use a real click, put part of the clicked
dish behind the heading before the save finishes, and complete a successful refresh. Check that
the saved dish moves to the end and that the next dish stays visible within one pixel of its
starting position relative to the heading.

The revised test must catch the discarded product change and pass on the existing product code.
Run it alone and run the full Products screen file, with the existing keyboard and refusal checks.
