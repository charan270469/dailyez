# DailyEz UI Redesign Spec — Light Theme, Calendly-Style Layout

## Purpose

Re-skin DailyEz's existing UI to adopt the visual language, layout structure, and
component style of the attached reference image (a Calendly-style scheduling app
screenshot), while keeping every existing tab, data structure, and piece of
functionality exactly as it is now. This is a **presentational change only** —
no backend, API, matching logic, or data model changes.

## Theme direction

- Switch from the current dark/near-black theme to a **light theme**: white and
  very light gray backgrounds, dark gray/near-black text, subtle borders and soft
  shadows on cards and panels instead of dark surfaces.
- **Keep DailyEz's existing indigo/purple as the accent color** (used in the "DE"
  logo mark, primary buttons, active nav state, confidence badges) — do NOT adopt
  the reference image's blue. The goal is Calendly's light, clean structural style
  applied to DailyEz's own brand color, not a copy of Calendly's palette.
- Cards, panels, and the sidebar should read as white/near-white surfaces with
  light gray borders (similar to `#e5e7eb`) rather than dark surfaces with
  borders, inverting the current dark-mode card treatment.

## Global layout structure

### Top bar
- Keep DailyEz's existing left-side branding (the "DE" mark + "DailyEz" wordmark)
  in its current position — do not replace it with a generic account-switcher
  pattern.
- Add a sidebar-collapse icon button next to the logo, adopted from the reference
  image (a simple bracket/chevron icon that toggles the sidebar between full and
  icon-only width).
- Keep the existing right-side icons (search, notification bell, settings gear,
  user avatar with dropdown) in their current position, restyled for the light
  theme.

### Left sidebar
- Adopt the reference image's sidebar style: white/light background, each nav
  item as icon + label, generous vertical spacing, and the **active item shown
  with a soft rounded highlight background** in the app's indigo accent (a light
  indigo-tinted background with darker indigo text/icon), matching the visual
  weight of the reference image's active-state treatment but in DailyEz's color.
- Keep DailyEz's existing nav items exactly as they are: Matched, All Inbox,
  Analytics, Archive, Priority (or whichever set is currently live) — do not add
  or remove nav items as part of this task.
- At the bottom of the sidebar, adopt the reference image's pattern: an outlined
  "Upgrade plan" button with an icon, then a Settings link below it, in the same
  relative position as the reference image's bottom-of-sidebar layout.

### Main content area (replaces the reference image's "Calendar" list)
- Page header: large bold title (e.g. "Matched", "All Inbox") with a lighter
  subtitle line beneath it, exactly as DailyEz already has — just restyled for
  light theme, no content change.
- Below the header, adopt the reference image's single-row filter/action bar
  layout: DailyEz's existing platform filter chips (All Platforms / Gmail /
  WhatsApp), the existing search/filter input, and existing toggles (Include
  spam, Keyword matched, etc.) should be arranged inline in one row, in the
  visual style of the reference image's dropdown + search + filter + action row
  (rounded inputs, subtle borders, consistent height).
- **Group the message/mail list by date**, the way the reference image groups
  meetings by day, with a bold date header per group and a small "Today" pill
  badge next to the current day's group, if it isn't already grouped this way.
- Each message/mail card should adopt the reference image's card style: white
  card, subtle border, **a colored left-edge accent bar** (4px), bold sender/
  subject line, muted gray secondary info line (platform, timestamp), and the
  existing confidence badge, matched-signal chip, and "Why this matched"
  expandable section preserved exactly as they currently work — just restyled.
- **Left-edge accent bar color mapping**: use the same colors already driving
  the confidence badges (high = green, medium = amber/orange, low = red/gray),
  applied to the card's left border instead of only the small badge, echoing the
  reference image's colored-accent card pattern.
- Keep the existing per-card notification bell icon and any other existing
  per-card actions in their current position, restyled for light theme.
- If a "View more" / pagination pattern doesn't already exist, adopt the
  reference image's centered "View more" button at the bottom of the list.

### Right panel (replaces the reference image's "Up next" meeting detail panel)
- **Default state**: show DailyEz's existing Watchlist / Matched Signals summary
  panel — signal name/context, platform scope, match count, the "Add New Signal"
  button — restyled to match the reference image's white sectioned panel style
  (clear section labels, dividers between sections, consistent padding).
- **Optional enhancement, not required for this pass**: when a user clicks into
  a specific message/mail card, the same right panel slot could swap to show
  that message's full detail (sender, full content, all matched signals, archive
  action) — effectively turning the existing `MessageDetailModal` into an inline
  panel instead of a popup modal, echoing how the reference image's panel shows
  contextual detail for a selected item. Flag this as a separate, optional step
  — implement the default Watchlist-summary panel first and get that working
  before attempting this swap behavior.
- Keep the floating voice assistant chat bubble in its current bottom-right
  position, restyled for light theme (the bubble itself can keep its indigo
  fill, that's a deliberate brand accent, not something to lighten).

## Explicit mapping table

| Reference image element | DailyEz equivalent |
|---|---|
| "Scheduling / Calendar / Contacts / Automations" sidebar | Existing DailyEz nav items (Matched, All Inbox, Analytics, Archive, Priority) |
| "Calendar" list of meetings, grouped by date | Message/mail feed for the active tab, grouped by date |
| Colored left-border accent per meeting | Colored left-border accent per confidence level |
| "Join meeting" button on active item | Existing per-card actions (bell/notification icon, etc.) |
| "Up next" meeting detail panel | Watchlist / Matched Signals summary panel (default state) |
| Invitees / Location / Hosts sections | Not applicable — omit, no equivalent needed |
| Bottom "Calendly curated by Mobbin" bar | Not applicable — omit entirely, this is just image attribution, not part of the app being referenced |

## What must NOT change

- No changes to any backend route, API call, data model, or matching/signal
  logic.
- No changes to which tabs/pages exist or what data each one shows.
- No changes to the floating voice assistant's actual functionality.
- No changes to Settings, Analytics, or Archive page *content* — only their
  visual theme, following the same light-theme direction as the rest of the app.

## Scope of this pass

Apply this restyle across every existing page (Matched, All Inbox, Analytics,
Archive, Settings, Watchlist/signal modal) consistently — this should feel like
one cohesive theme change across the whole app, not just the Matched page shown
in the reference screenshots.