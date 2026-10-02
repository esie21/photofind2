# Portfolio: data model, API and migration note

The portfolio lets any provider - photographers, caterers, cleaners, makeup artists, repair
technicians, tutors - show their work as **projects** (one per job) made of photos and
videos. This note describes what is stored, what the API accepts, and why portfolios saved
before these changes keep working without anyone filling in the new fields.

## Where it is stored

Four columns on `users`. Nothing lives in a separate table.

| Column | Type | Holds |
|---|---|---|
| `portfolio_images` | `TEXT[]` | Stored paths of every item, in order. The source of truth for what exists (max 24). |
| `portfolio_meta` | `JSONB` | Per item, keyed by stored path. |
| `portfolio_albums` | `JSONB` | Per project, keyed by project name. |
| `portfolio_cover` | `TEXT` (new, nullable) | The profile cover the provider chose. `NULL` = automatic. |

Items with no `album` are "Other work". A project's name is its identity: it is the key in
`portfolio_albums` and the `album` value on each of its items.

### Per item (`portfolio_meta[path]`)

| Field | Set by | Rules |
|---|---|---|
| `caption` | provider | <= 140 chars |
| `album` | provider | project name, <= 60 chars; absent = Other work |
| `alt` (new) | provider | <= 200 chars; falls back to `caption` when empty |
| `tags` (new) | provider | up to 8, <= 30 chars each; trimmed, de-duplicated ignoring case |
| `before` (new) | provider | stored path of this item's "before" photo - see pairing rules |
| `poster`, `thumb`, `duration`, `width`, `height` | server only | written by the preview upload; a profile save cannot set or drop them |

### Per project (`portfolio_albums[name]`)

| Field | Rules |
|---|---|
| `description` | the brief. <= 600 chars accepted; the editor suggests 200 and cards show 3 lines |
| `location` | <= 120 chars |
| `done_on` | `YYYY-MM-DD`, a real date, not in the future (one day of slack for time zones) |
| `date_end` (new) | same rules; needs `done_on`; not before it; dropped when equal to it |
| `services` (new) | up to 10, <= 40 chars each |
| `tags` (new) | up to 10, <= 30 chars each - used for the public filter chips |
| `client_type`, `duration`, `price_range` (new) | free text, <= 60 chars each |
| `outcome` (new) | <= 300 chars, shown as "Results" |
| `before_after` (new) | `true` to show the project's pairs as comparison sliders |
| `cover` | stored path of one of the project's own items |
| `order` | position on the public grid |
| `category` | **legacy** - still accepted (must be one of `CATEGORY_OPTIONS`) and shown as the project's first tag. New saves from the editor write tags instead. |

Validation lives in `backend/src/utils/portfolioSchema.ts`.

### Pairing rules (before/after)

A pair is stored on the "after" item (`before: <path>`). On every save the server keeps a
pair only if both items exist, are in the same project, the "before" is not itself an
"after" (no chains), and no earlier item already claimed that "before". Anything else is
dropped silently - moving an item to another project, for example, unpairs it.

## API changes

All additive. Nothing that was accepted before is now refused, except the two genuine bugs
noted below.

- `PUT /api/users/:id` - accepts the new item and project fields above, and
  `portfolio_cover` (a path in the portfolio, or `null` for automatic). Projects with no
  items are **kept** (they used to be deleted on save), so a project can be created first and
  filled afterwards. Removing an item clears `portfolio_cover` if it pointed at it.
- `DELETE /api/users/:id/portfolio/*` - also clears any pairing, project cover and profile
  cover that pointed at the deleted item.
- `POST /api/users/:id/upload/portfolio` - the response also includes `added`: the stored
  path(s) this request appended, in order. The editor now uploads one file per request.
- `GET /api/auth/me`, `POST /api/auth/accept-terms`, `GET /api/providers/:id` - now return
  `portfolio_albums` (the auth routes did not) and `portfolio_cover`.

### Bugs fixed along the way

- `/auth/me` did not return `portfolio_albums`. After a reload or an upload the editor had
  no project details, and its next save stored an empty set - **erasing every project's
  description, location, date, cover and order**.
- Project dates like `2026-02-30` were accepted (JavaScript rolls them into March). They are
  now rejected.

## Migration note

**No data migration is needed, and no provider has to fill anything in.**

- **Schema.** The only new column, `users.portfolio_cover`, is added by the server's startup
  routine (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) and defaults to `NULL`. Every other
  new field is an optional key inside the existing JSONB columns.
- **Rendering.** Every new field is optional and every reader falls back:
  - No `tags` -> the legacy `category` is shown as the project's tag and filter chip; no
    category either -> the card simply has no tag.
  - No `portfolio_cover` -> the leading project's cover, then the first item - exactly what
    the profile header showed before.
  - No `alt` -> the caption, then a generated "Project, item 3 of 9".
  - No `before_after` -> no sliders; items show as before.
  - Long descriptions (up to 600 chars) are kept as they are; cards show the first three lines.
  - A portfolio with nothing grouped still shows as one set of photos, as before.
- **Editing an old project** folds its legacy `category` into its tags, so the category is
  never lost; saving then stores it as a tag.
- **What existing providers will notice:** "Album" is now called "Project"; the project-name
  badge on every tile is gone (the section heading says it once); the category dropdown is
  replaced by free tags with suggestions; new uploads land in "Other work" and are dragged
  into a project.

### Deploying

1. **Backend first.** The new backend accepts everything the old frontend sends.
2. **Then the frontend.** Shipping the new frontend against the old backend would lose data
   quietly: the old backend keeps only `caption` and `album` per item, so alt text, tags and
   pairs would be dropped on save, and `portfolio_cover` would be ignored.
3. **Roll back together.** The old frontend deletes empty projects before saving and does not
   send the new item fields, so a frontend-only rollback would erase alt text, tags and pairs
   the next time a provider saved.

### After deploying, check

- [ ] Reload the provider dashboard: project descriptions, dates and covers are still there
      (the `/auth/me` fix).
- [ ] An old portfolio with a `category` shows it as a tag on the public profile.
- [ ] Create a project, drag a photo into it, save, reload - it stayed.
- [ ] Upload a 10MB+ phone photo - it is compressed and added.
- [ ] On a phone: drag a tile by its handle; swipe in the public lightbox.
