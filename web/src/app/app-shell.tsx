import { Bookmark } from "lucide-react"
import { Link, NavLink, Outlet } from "react-router-dom"

import { ThemeToggle } from "@/app/theme-toggle"
import { cn } from "@/lib/utils"

/**
 * Persistent application shell.
 *
 * A single hairline separates the quiet top bar from the archive. There is no
 * card around the page and no gradient behind it: the covers and the posts are
 * the only colour, and the chrome stays out of their way.
 */
export function AppShell() {
  return (
    <div className="flex min-h-svh flex-col">
        <header className="border-b border-border/80">
          <nav
            aria-label="Primary"
            className="mx-auto flex h-16 w-full max-w-[1440px] items-center gap-5 px-4 sm:gap-8 sm:px-8 lg:px-12"
          >
            <Link
              to="/"
              aria-label="Twitter Bookmarker"
              className="flex min-w-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-ink text-surface"
              >
                <Bookmark className="size-4" fill="currentColor" />
              </span>
              <span
                data-testid="app-wordmark"
                className="hidden truncate text-[14px] leading-[1.4] font-semibold tracking-[-0.015em] text-ink sm:inline"
              >
                Twitter Bookmarker
              </span>
            </Link>

            <div className="flex items-center gap-6 text-[12.5px] leading-[1.4]">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  cn(
                    "rounded-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                    isActive
                      ? "font-semibold text-ink"
                      : "font-medium text-muted hover:text-ink"
                  )
                }
              >
                Home
              </NavLink>
              {/* Design spec §3.1: `Home` and `Collections` both resolve to `/` */}
              <Link
                to="/"
                className="rounded-sm font-medium text-muted transition-colors outline-none hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/30"
              >
                Collections
              </Link>
            </div>

            <div className="ml-auto flex items-center gap-3">
              <span className="hidden items-center gap-1.5 sm:flex">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-ink/35" />
                <span className="micro">Local</span>
              </span>
              <ThemeToggle />
            </div>
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-8 sm:px-8 sm:py-12 lg:px-12">
          <div className="mx-auto w-full max-w-[1312px]">
            <Outlet />
          </div>
      </main>
    </div>
  )
}
