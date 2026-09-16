# Game library generator

The profile's game library is generated from `.github/data/games.json`, using
local artwork in `Images/` and `Images/heroes/`. Hero source URLs are recorded
with the data; builds never fetch those URLs.

From the repository root:

```sh
cd .github/scripts/game-library
npm ci
npm run build
npm run check
```

To add or edit a game, update the data and provide its icon. An optional `hero`
selects an entry from the `heroes` map. Omit `hero` to use the icon's
alpha-weighted mean RGB color with a dark overlay. `narrowEventLines` may set
line breaks, but must contain exactly the same text as `event`. Similarly,
`mobileNameLines` may set mobile title line breaks without changing `name`.

The generator preserves all bilingual fields without truncation and writes
three card sizes to `profile/games/`. README uses `<picture>` to select the
layout. Each card uses one native HTML table cell to frame both the artwork
and its individually clickable platform, event, and announcement text links.
The SVG has no outer border of its own, so the shared frame includes the link
footer. Links stay in HTML because hyperlinks inside an image cannot be clicked
individually. This layout does not rely on custom CSS stripped by GitHub.
Only the `games` marker block is updated.

The **Update Game Library** workflow runs on data, generator, or image changes,
and can be dispatched manually. PR runs build and check without publishing.
The workflow shares a concurrency group with **Update Profile Components**
because both workflows update different sections of README.
