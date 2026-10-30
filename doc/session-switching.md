# Session switching

Which surface a person uses to move between sessions in each interface mode, and who keeps an open tab's data alive
while nobody is looking at it. Read this before touching `packages/app/src/shell/shell.tsx`,
`packages/app/src/shell/workspace-sidebar.tsx`, `packages/app/src/shell/titlebar/`, or
`packages/app/src/shell/tabs/`.

## The three modes

`settings.appearance.tabLayout` is the switch, and every mode puts its switcher on the left:

| Value | Switcher | Tab strip mounted? |
| --- | --- | --- |
| `horizontal` (default) | The workspaces rail: sessions grouped by project directory | No |
| `vertical` | Side tab strip, one row per open tab | Yes, in the sidebar portal |
| `inbox` | `SidebarInbox`, sessions sorted by what needs attention | No |

On mobile the rail and the side strip are both replaced by the drawer's vertical strip, opened from the title bar.

The rail replaced the top bar's strip rather than sitting next to it: two switchers listing the same sessions in one
window was the state this repo shipped briefly, and it made every session appear twice with independent selection
state. The title bar keeps the new-tab and recently-closed controls, the app menu, and the plugin items.

## Who owns a tab's upkeep

An open session tab needs work no surface can skip: resolving its record, syncing a background tab's metadata,
inbox, permissions and forms so a switch lands loaded, remembering its title and draft, and carrying its unread and
attention state.

- **A tab strip owns this for itself.** `SessionTabEntry` in `packages/app/src/shell/titlebar/tab-strip.tsx` computes
  it per row and reports visibility and unread back to the strip. That is also where the strip's own row lifecycle
  keeps each row attached to the right tab.
- **Where no strip is mounted, `TabActivityHost` does it.** It renders only beside the rail (`!mobile() &&
  !verticalTabs()` in `shell.tsx`) and iterates the same tab list with a `<For>`, so Solid owns the per-tab lifetime.
- **Never both.** The headless host is not mounted while a strip is on screen.

`registerTabCommands` in `packages/app/src/shell/tabs/commands.ts` is the single source for `tab.prev`, `tab.next`,
`session.previous`, `session.next`, the unseen variants and `cmd+1..9`. The strip calls it with its own visible list,
unread map and element refs; the host calls it with its registry. Both register under the palette keys `tab-cycle`
and `tab-numbers`, which is safe only because exactly one of them is mounted at a time.

### Decisions

- **A shared state layer under every layout was tried and reverted.** Hoisting the per-row state out of the strip so
  the host served all three modes reproduced as duplicated and missing rows in the side layout, wrong cycling, and a
  lost composer caret. Reading tab identity back out of the positional store proxies, rather than keeping the row's
  own state, is what broke: a store item's contents move when the list is written. The strip's per-row computation is
  what made that path correct, so it stayed, and the host exists only for the layout that has no strip.
- **Hiding the strip instead of unmounting it** (zero height, `aria-hidden`) was rejected: it leaves a second,
  invisible switcher whose drag handles, hover intent and row measurements all still run.
- **The rail rows took over the tab controls rather than losing them.** A row closes its tab (`hover-reveal` ×),
  renames in place, and deletes the session through the same confirmation the strip used, via `renameSessionTitle`
  and `DeleteSessionDialog` in `packages/app/src/shell/tabs/activity.tsx`. `EditableTitle` in
  `packages/app/src/shell/editable-title.tsx` is the shared in-place editor: it seeds the editor only on the rising
  edge of `editing`, because rewriting the text when the title store changes collapses the selection an in-flight
  rename made and pastes the new title in front of the old one.

## Focus after a switch

`packages/app/src/session/composer/controller.ts` gives the composer focus when a session becomes ready, unless some
other control already holds it. Elements the person used to *arrive* are exempt: `[data-titlebar-tab-link]` and
`[data-session-switch]` (the rail row). Adding another switcher means adding it to that list, or the caret stays on
the row that was clicked.

## Tests

`e2e/utils/app.ts` seeds `appearance.tabLayout: "vertical"` by default, because the app's own default layout has no
tab strip for specs to drive. A spec that wants the rail seeds `horizontal` explicitly and targets
`[data-slot="workspace-session-row"][data-session-id="<id>"]`. Specs that assert the top bar holds no strip keep
pointing at `[data-slot="titlebar-tabs"]` with `toHaveCount(0)`.

`GET /api/session/:sessionID/diff` is mocked with an empty list: the session rail reads it whenever a session opens,
and the mock server fails a test on any unmocked route.
