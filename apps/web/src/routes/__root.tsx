import { ProLayout } from '@ant-design/pro-components'
import { createRootRoute, Link, Outlet, useRouterState } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { DesktopWindowControls } from '@/components/desktop-window-controls'
import { menu } from '@/config'
import { isTauri } from '@/utils/is-tauri'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const pathname = useRouterState({ select: s => s.location.pathname })

  return (
    <ProLayout
      title="Media Admin"
      logo="/favicon.svg"
      layout="top"
      location={{ pathname }}
      route={{
        name: 'root',
        children: menu,
      }}
      headerContentRender={
        isTauri()
          ? (_props, defaultDom) => (
              <div className="flex h-full w-full min-w-0 items-stretch">
                <div className="shrink-0">{defaultDom}</div>
                <div
                  aria-hidden
                  className="min-h-10 min-w-0 flex-1 select-none"
                  data-tauri-drag-region
                />
              </div>
            )
          : undefined
      }
      menuItemRender={(item, dom) =>
        item.path
          ? (
              <Link to={item.path}>
                {dom}
              </Link>
            )
          : dom}
      actionsRender={() => {
        return <DesktopWindowControls />
      }}
    >
      <Outlet />
      {import.meta.env.DEV ? <TanStackRouterDevtools position="bottom-left" /> : null}
    </ProLayout>
  )
}
