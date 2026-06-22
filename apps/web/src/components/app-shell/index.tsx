import type { ReactNode } from 'react'
import { AppLayout } from '@heroui-pro/react/app-layout'
import { Navbar } from '@heroui-pro/react/navbar'
import { Icon } from '@iconify/react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { DesktopWindowControls } from '@/components/desktop-window-controls'
import { menu } from '@/config'
import { isTauri } from '@/utils/is-tauri'

export interface AppShellProps {
  children: ReactNode
}

function isActiveMenuItem(pathname: string, itemPath: string) {
  if (itemPath === '/')
    return pathname === '/'

  return pathname === itemPath || pathname.startsWith(`${itemPath}/`)
}

function currentMenuLabel(pathname: string) {
  for (const item of menu) {
    const child = item.children?.find(child => isActiveMenuItem(pathname, child.path))
    if (child)
      return child.name

    if (isActiveMenuItem(pathname, item.path))
      return item.name
  }

  return 'Media Admin'
}

function AppNavbar() {
  const router = useRouter()
  const pathname = useRouterState({ select: s => s.location.pathname })

  return (
    <Navbar
      maxWidth="full"
      navigate={href => void router.navigate({ to: href })}
      shouldBlockScroll={false}
    >
      <Navbar.Header>
        <Navbar.MenuToggle className="lg:hidden" srLabel="打开导航菜单" />
        <Navbar.Brand className="min-w-0 shrink-0">
          <img src="/favicon.ico" alt="" className="size-7 shrink-0" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">
              Media Admin
            </div>
            <div className="hidden truncate text-xs text-muted sm:block">
              {currentMenuLabel(pathname)}
            </div>
          </div>
        </Navbar.Brand>
        <Navbar.Content className="hidden min-w-0 gap-1 lg:flex">
          {menu.map((item) => {
            const itemPath = item.children?.[0]?.path ?? item.path

            return (
              <Navbar.Item
                key={item.path}
                href={itemPath}
                isCurrent={isActiveMenuItem(pathname, item.path)}
                className="gap-2"
              >
                <Icon icon={item.icon} data-slot="icon" className="size-4" />
                {item.name}
              </Navbar.Item>
            )
          })}
        </Navbar.Content>
        {isTauri()
          ? (
              <div
                aria-hidden
                className="min-h-10 min-w-0 flex-1 select-none"
                data-tauri-drag-region
              />
            )
          : <Navbar.Spacer />}
        <Navbar.Content>
          <DesktopWindowControls />
        </Navbar.Content>
      </Navbar.Header>
      <Navbar.Menu>
        {menu.map((item) => {
          const itemPath = item.children?.[0]?.path ?? item.path

          return (
            <Navbar.MenuItem
              key={item.path}
              href={itemPath}
              isCurrent={isActiveMenuItem(pathname, item.path)}
              className="gap-2"
            >
              <Icon icon={item.icon} data-slot="icon" className="size-5" />
              {item.name}
            </Navbar.MenuItem>
          )
        })}
      </Navbar.Menu>
    </Navbar>
  )
}

export function AppShell({ children }: AppShellProps) {
  const pathname = useRouterState({ select: s => s.location.pathname })
  const immersivePlay = pathname === '/video-play' || pathname === '/emby-play'

  if (immersivePlay) {
    return (
      <div className="min-h-dvh bg-background text-foreground">
        {children}
      </div>
    )
  }

  return (
    <AppLayout
      scrollMode="content"
      navbar={<AppNavbar />}
    >
      <div className="mx-auto flex h-full min-h-0 w-full flex-col gap-6 px-4">
        {children}
      </div>
    </AppLayout>
  )
}
