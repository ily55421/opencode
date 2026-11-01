# Rail navigation, sizing, and the Indigo theme

Situation: the desktop workspaces rail was compared against the Qoder CN desktop app, and then against a written
palette proposal for OpenCode. Both comparisons produced concrete numbers rather than taste, so the record below is
about which alternatives were rejected and why. The current behaviour of the rail as a session switcher is owned by
`doc/session-switching.md`; the right-hand column is owned by `doc/session-rail.md`.

Landed in `9495bce0c4`, `bea9663a45`, `3558c4c6e9`, `82efecf1ce`.

## What changed

- `WorkspaceSidebar` grew a bottom navigation (`NAV_PAGES` through `SidebarNavItem`) opening the host-owned Settings
  pages `usage`, `extensions` and `servers`, with `MORE_PAGES` behind a `更多` menu. Rows mark themselves active from
  `useSettingsSurface().view()`.
- `SidebarAction` and the new rows were merged into one `SidebarNavItem` behind a single `NAV_ROW` class, so top and
  bottom navigation cannot drift apart.
- The tab's close control stopped using the shared `hover-reveal` utility.
- `SESSION_RAIL_WIDTH` moved 264 → 296, the rail's own width 276 → 252 with an `border-e` separator, and the
  `tabsWidth` default followed so all three interface modes agree.
- Session, draft and workspace-group rows went 12px → 12.5px and `rounded-md` → `rounded-lg`.
- Added `themes/indigo.json`, and `indigo` to the display-name fallback in `context.tsx`.
- A quick theme switch sits in the rail footer between `oc-2` and `indigo`.

## Decisions

### Bottom navigation shares the top navigation's row style

The tempting shape was a visually secondary footer: smaller type, `text-faint`, a lighter hover. The reference puts
`站点 / 自动化 / 扩展 / 更多` in the same class as `新的任务 / 搜索`, and that is the better rule: a destination is a
destination. The first cut of this change shipped the faint-footer version and was corrected against the reference.

`focus-visible:outline-none` was dropped at the same time. It appeared on every hand-rolled row in the rail and title
bar, and the design system restores focus rings only through `data-component="button-v2"` and
`data-component="icon-button-v2"`, so a plain button with that class has no visible keyboard focus at all.

### The close control no longer rides on `hover-reveal`

`hover-reveal` forces `opacity: 1` under `@media (hover: none)`, because a control that only appears on hover is
unreachable without hover. On a touch display that turns every open tab's close button permanently visible — measured
as 24 controls at resting opacity `1` in one window.

The tempting fix was to change the utility. It has more than a dozen other users, including the Home session and
project rows, which still behave that way. Instead the rail row carries its own rule: the selected row always shows the
control, the others reveal it on hover and are `pointer-events-none` while hidden so an invisible control cannot be
tapped. Closing an unselected tab stays available from its context menu.

What would prove this wrong: a report that touch users cannot discover how to close a background tab. The fix then is
a visible control on every row, accepting the clutter, not a hover affordance.

### Widths moved together with the assertions they derive

`tabs.spec.ts` asserts the vertical sidebar's default width and then two widths reached by dragging relative to that
default, so changing the `tabsWidth` default moves three expectations at once. The second drag's offset was shortened
rather than its expectation lowered: from the new default the original offset would have landed under the 136px floor
and clamped, silently turning a "drag twice" test into a second "hit the floor" test.

`SESSION_RAIL_WIDTH` needed no document change because `doc/session-rail.md` names the symbol rather than the number.

### The theme ships a dark variant it was never drawn with

The proposal specified light values only, and the theme schema requires both variants, so a dark companion in the same
design language had to be invented rather than omitted.

Two places deliberately depart from the proposal:

- **Project avatar colours are not in the theme.** The proposal carries five workspace colours, but the avatar tokens in
  `styles/tokens/theme.css` are marked theme-independent on purpose. Putting them in a theme would silently reverse that
  decision.
- **The indigo send button is pinned through `bg-icon-button-contrast`, not `bg-accent`.** `submit.css` paints from the
  contrast token, and `bg-accent` is used elsewhere only as a dot fill. The contrast token is used by `submit.css`
  alone, so pinning it reaches exactly the submit control. In dark mode the proposal's white-on-accent pairing measured
  4.36:1, so the dark variant uses a lighter accent surface under the near-black inverse glyph instead, at 6.32:1.

### The session header stayed at 48px

The reference bar is 46px. `--session-header-height` is read by the timeline virtualizer with two `|| 48` fallbacks and
is never actually set anywhere, so a two-pixel gain would have required touching scroll measurement and the sticky
offset. Rejected as a bad trade.

### The quick switch names its two ends

A one-button switch has exactly two states, so it toggles `oc-2` ↔ `indigo` and leaves the full catalogue to the
Settings dropdown. Any theme the person picked there is treated as the default's counterpart, which keeps the button
from appearing dead.

`indigo` was also added to the display-name map in `context.tsx`. `loadThemes()` runs only when Settings mounts, so
before that `name()` falls through to that map and the tooltip would otherwise read as the raw id.

## Post-mortem: a diagnosis that was not a bug

Running `packages/app` e2e immediately after editing `packages/ui/src/theme/context.tsx` produced a convincing fake
failure: the lazy theme request never settled, `load()`'s continuation never ran, and `setTheme` appeared to update the
store without applying CSS. It was reported as a dev-server defect affecting all themes.

It was neither. Re-running the same spec against a settled server passed in dev mode, in the production build, and in
the installed app over CDP. The lesson recorded here is procedural: reproduce a suspected defect once more, unchanged,
before naming it — especially directly after editing a file Vite is still re-transforming.
