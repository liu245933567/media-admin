import { Button } from '@heroui/react'
import { Icon } from '@iconify/react'
import { createRootRoute, Link, Outlet, useRouterState } from '@tanstack/react-router'
// import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { DesktopWindowControls } from '@/components/desktop-window-controls'
import { menu } from '@/config'
import { isTauri } from '@/utils/is-tauri'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const pathname = useRouterState({ select: s => s.location.pathname })
  const immersivePlay = pathname === '/video-play'

  if (immersivePlay) {
    return (
      <div className="min-h-dvh bg-background text-foreground">
        <Outlet />
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2 pr-2 no-underline">
            <img src="/favicon.ico" alt="" className="size-6" />
            <span className="font-semibold text-foreground">Media Admin</span>
          </Link>
          <nav className="flex min-w-0 flex-1 items-center gap-1">
            {menu.map(item => (
              <Link key={item.path} to={item.path} className="no-underline">
                <Button
                  size="sm"
                  variant={pathname === item.path ? 'secondary' : 'ghost'}
                  className="gap-2"
                >
                  <Icon icon={item.icon} className="size-4" />
                  {item.name}
                </Button>
              </Link>
            ))}
            {isTauri()
              ? (
                  <div
                    aria-hidden
                    className="min-h-10 min-w-0 flex-1 select-none"
                    data-tauri-drag-region
                  />
                )
              : <div className="min-w-0 flex-1" />}
          </nav>
          <DesktopWindowControls />
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
      {/* {import.meta.env.DEV ? <TanStackRouterDevtools position="bottom-left" /> : null} */}
    </div>
  )
}
