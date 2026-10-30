import { expect, test, type Page } from "@playwright/test"
import { expectPath, sessionHref } from "../utils/app"
import { mockWorkspace } from "../utils/workspace"

const a = { id: "ses_rail_a", title: "Rail A session" }

const b = { id: "ses_rail_b", title: "Rail B session" }

const row = (page: Page, id: string) => page.locator(`[data-slot="workspace-session-row"][data-session-id="${id}"]`)

test.use({ serviceWorkers: "block" })

test("the workspaces rail is the only session switcher in the default layout", async ({ page }) => {
  await mockWorkspace(page, {
    name: "Rail",
    sessions: [a, b],
    seed: { settings: { appearance: { tabLayout: "horizontal" } } },
  })
  await page.goto(sessionHref(a.id))

  await expect(page.locator('[data-slot="titlebar-tabs"]')).toHaveCount(0)
  await expect(row(page, a.id)).toHaveCount(1)
  await expect(row(page, b.id)).toHaveCount(1)
  await expect(row(page, a.id).getByRole("button", { name: a.title, exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  )

  await row(page, b.id).getByRole("button", { name: b.title, exact: true }).click()
  await expectPath(page, sessionHref(b.id))
  await expect(row(page, b.id).getByRole("button", { name: b.title, exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  )
})

test("closing a rail row's tab leaves the session listed and reopenable", async ({ page }) => {
  await mockWorkspace(page, {
    name: "Rail",
    sessions: [a, b],
    seed: { settings: { appearance: { tabLayout: "horizontal" } } },
  })
  await page.goto(sessionHref(a.id))

  const background = row(page, b.id)
  const close = background.getByRole("button", { name: "Close tab", exact: true })
  await expect(close).toHaveCSS("opacity", "0")

  await background.hover()
  await expect(close).toHaveCSS("opacity", "1")
  await close.click()
  await expectPath(page, sessionHref(a.id))

  // The rail lists sessions, not tabs, so the row stays and opens a fresh tab for it.
  await expect(background).toHaveCount(1)
  await background.getByRole("button", { name: b.title, exact: true }).click()
  await expectPath(page, sessionHref(b.id))
})

test("a rail row renames its session in place", async ({ page }) => {
  await mockWorkspace(page, {
    name: "Rail",
    sessions: [a, b],
    seed: { settings: { appearance: { tabLayout: "horizontal" } } },
  })
  await page.goto(sessionHref(a.id))

  const title = row(page, b.id).getByRole("button", { name: b.title, exact: true })
  await title.dblclick()
  const editor = page.locator('[data-slot="workspace-session-title"][contenteditable="plaintext-only"]')
  await expect(editor).toBeFocused()
  await editor.fill("Renamed in the rail")
  await editor.press("Enter")

  await expect(row(page, b.id).getByRole("button", { name: "Renamed in the rail", exact: true })).toHaveCount(1)
})

test("a rail row names the rename in its context menu and marks a session waiting on approval", async ({ page }) => {
  await mockWorkspace(page, {
    name: "Rail",
    sessions: [a, b],
    seed: { settings: { appearance: { tabLayout: "horizontal" } } },
    sessionPermissions: {
      [b.id]: [
        {
          id: "permission-rail-b",
          sessionID: b.id,
          action: "shell",
          resources: ["git status"],
          metadata: {},
          save: [],
        },
      ],
    },
  })
  await page.goto(sessionHref(a.id))

  await expect(row(page, b.id).locator('[data-slot="workspace-session-unread"]')).toBeVisible()

  await row(page, b.id).click({ button: "right" })
  await expect(page.getByRole("menuitem", { name: "Rename", exact: true })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Delete session…", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")

  const remove = page.waitForRequest(
    (request) => request.method() === "DELETE" && request.url().endsWith(`/api/session/${b.id}`),
  )

  await row(page, b.id).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Delete session…", exact: true }).click()

  const dialog = page.getByRole("dialog")
  await dialog.getByRole("button", { name: "Delete session", exact: true }).click()
  await remove
  await expect(row(page, b.id)).toHaveCount(0)
  await expectPath(page, sessionHref(a.id))
})

test("the tab shortcuts cycle sessions while only the rail is on screen", async ({ page }) => {
  await mockWorkspace(page, {
    name: "Rail",
    sessions: [a, b],
    seed: { settings: { appearance: { tabLayout: "horizontal" } } },
  })
  await page.goto(sessionHref(a.id))
  // The shortcuts answer once the rail's tabs have resolved their records; pressing earlier would be a no-op.
  await expect(row(page, b.id)).toBeVisible()

  await page.keyboard.press("Control+Alt+ArrowRight")
  await expectPath(page, sessionHref(b.id))
  await page.keyboard.press("Control+Alt+ArrowLeft")
  await expectPath(page, sessionHref(a.id))
})
