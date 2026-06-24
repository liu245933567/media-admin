import { Sidebar } from '@heroui-pro/react/sidebar'
import { Icon } from '@iconify/react'
import { createFileRoute, Navigate, Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import { menu } from '@/config'

export const Route = createFileRoute('/setting')({
  component: SettingLayout,
})

function isActiveSettingItem(pathname: string, itemPath: string) {
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`)
}

function SettingSidebarContent() {
  const pathname = useRouterState({ select: state => state.location.pathname })
  const settingMenu = menu.find(item => item.path === '/setting')
  const settingItems = settingMenu?.children ?? []

  return (
    <>
      <Sidebar.Header>
        <div className="flex min-w-0 items-center gap-2 px-1 py-1">
          <Icon icon={settingMenu?.icon ?? 'lucide:settings'} className="size-5 shrink-0 text-muted" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">设置</div>
            <div className="truncate text-xs text-muted">应用配置</div>
          </div>
        </div>
      </Sidebar.Header>
      <Sidebar.Content>
        <Sidebar.Group>
          <Sidebar.GroupLabel>配置项</Sidebar.GroupLabel>
          <Sidebar.Menu aria-label="设置导航" showGuideLines={false}>
            {settingItems.map(item => (
              <Sidebar.MenuItem
                key={item.path}
                href={item.path}
                isCurrent={isActiveSettingItem(pathname, item.path)}
                textValue={item.name}
                tooltip={item.name}
              >
                <Sidebar.MenuIcon>
                  <Icon icon={item.icon} className="size-5" />
                </Sidebar.MenuIcon>
                <Sidebar.MenuLabel>{item.name}</Sidebar.MenuLabel>
              </Sidebar.MenuItem>
            ))}
          </Sidebar.Menu>
        </Sidebar.Group>
      </Sidebar.Content>
    </>
  )
}

function SettingLayout() {
  const router = useRouter()
  const pathname = useRouterState({ select: state => state.location.pathname })

  if (pathname === '/setting') {
    return <Navigate to="/setting/defaults" replace />
  }

  return (
    <Sidebar.Provider
      collapsible="none"
      navigate={href => void router.navigate({ to: href })}
      toggleShortcut={false}
    >
      <div className="flex min-h-0 flex-1 gap-6">
        <aside className="hidden w-64 shrink-0 md:block">
          <Sidebar className="sticky top-4 h-[calc(100dvh-var(--navbar-height)-2rem)]">
            <SettingSidebarContent />
          </Sidebar>
        </aside>
        <Sidebar.Mobile>
          <SettingSidebarContent />
        </Sidebar.Mobile>
        <div className="min-w-0 flex-1">
          <div className="mb-4 flex items-center gap-2 md:hidden">
            <Sidebar.Trigger aria-label="打开设置导航">
              <Icon icon="lucide:panel-left-open" className="size-4" />
            </Sidebar.Trigger>
            <span className="text-sm font-medium text-foreground">设置导航</span>
          </div>
          <Outlet />
        </div>
      </div>
    </Sidebar.Provider>
  )
}
