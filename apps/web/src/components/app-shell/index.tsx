import type { ReactNode } from 'react'
import { AppLayout } from '@heroui-pro/react/app-layout'
import { Navbar } from '@heroui-pro/react/navbar'
import { Sidebar } from '@heroui-pro/react/sidebar'
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

function AppSidebarContent() {
  const pathname = useRouterState({ select: s => s.location.pathname })

  return (
    <>
      <Sidebar.Header>
        <div className="flex items-center gap-2 px-1 py-1">
          <img src="/favicon.ico" alt="" className="size-7" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">Media Admin</div>
            <div className="truncate text-xs text-muted">媒体管理控制台</div>
          </div>
        </div>
      </Sidebar.Header>
      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.GroupLabel>导航</Sidebar.GroupLabel>
          <Sidebar.Menu aria-label="主导航" showGuideLines={false}>
            {menu.map((item) => {
              const itemPath = item.children?.[0]?.path ?? item.path
              const isCurrent = isActiveMenuItem(pathname, item.path)

              return (
                <Sidebar.MenuItem
                  key={item.path}
                  href={itemPath}
                  isCurrent={isCurrent}
                  textValue={item.name}
                  tooltip={item.name}
                >
                  <Sidebar.MenuIcon>
                    <Icon icon={item.icon} className="size-5" />
                  </Sidebar.MenuIcon>
                  <Sidebar.MenuLabel>
                    {item.name}
                    {item.children?.length
                      ? (
                          <Sidebar.MenuTrigger aria-label={`展开${item.name}`}>
                            <Sidebar.MenuIndicator />
                          </Sidebar.MenuTrigger>
                        )
                      : null}
                  </Sidebar.MenuLabel>
                  {item.children?.length
                    ? (
                        <Sidebar.Submenu>
                          {item.children.map(child => (
                            <Sidebar.MenuItem
                              key={child.path}
                              href={child.path}
                              isCurrent={isActiveMenuItem(pathname, child.path)}
                              textValue={child.name}
                              tooltip={child.name}
                            >
                              <Sidebar.MenuIcon>
                                <Icon icon={child.icon} className="size-5" />
                              </Sidebar.MenuIcon>
                              <Sidebar.MenuLabel>{child.name}</Sidebar.MenuLabel>
                            </Sidebar.MenuItem>
                          ))}
                        </Sidebar.Submenu>
                      )
                    : null}
                </Sidebar.MenuItem>
              )
            })}
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
      {/* <Sidebar.Footer>
        <div className="rounded-lg bg-surface-secondary px-3 py-2 text-xs text-muted">
          本地媒体、字幕与任务队列
        </div>
      </Sidebar.Footer> */}
    </>
  )
}

function AppNavbar() {
  const pathname = useRouterState({ select: s => s.location.pathname })

  return (
    <Navbar maxWidth="full">
      <Navbar.Header>
        <AppLayoutMenuButton />
        <Sidebar.Trigger aria-label="折叠侧边栏" />
        <Navbar.Brand className="min-w-0">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">
              {currentMenuLabel(pathname)}
            </div>
            <div className="hidden truncate text-xs text-muted sm:block">
              Media Admin
            </div>
          </div>
        </Navbar.Brand>
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
    </Navbar>
  )
}

function AppLayoutMenuButton() {
  return (
    <AppLayout.MenuToggle
      aria-label="打开导航菜单"
      tooltip="打开导航"
      tooltipProps={{ delay: 0 }}
    />
  )
}

export function AppShell({ children }: AppShellProps) {
  const router = useRouter()
  const pathname = useRouterState({ select: s => s.location.pathname })
  const immersivePlay = pathname === '/video-play'

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
      sidebarCollapsible="icon"
      sidebarVariant="sidebar"
      navigate={href => void router.navigate({ to: href })}
      navbar={<AppNavbar />}
      sidebar={(
        <>
          <Sidebar>
            <AppSidebarContent />
            <Sidebar.Rail aria-label="切换侧边栏" />
          </Sidebar>
          <Sidebar.Mobile>
            <AppSidebarContent />
          </Sidebar.Mobile>
        </>
      )}
    >
      <div className="mx-auto flex h-full min-h-0 w-full flex-col gap-6 px-4">
        {children}
      </div>
    </AppLayout>
  )
}
