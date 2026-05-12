import { ProLayout, ProProvider } from '@ant-design/pro-components'
import { createRootRoute, Link, Outlet, useRouterState } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { menu } from '@/config'

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
      rootClassName="h-100dvh"
      route={{
        name: 'root',
        children: menu,
      }}
      menuItemRender={(item, dom) =>
        item.path
          ? (
              <Link to={item.path}>
                {dom}
              </Link>
            )
          : dom}
      style={{ minHeight: '100vh' }}
    >
      <Outlet />
      {import.meta.env.DEV ? <TanStackRouterDevtools position="bottom-left" /> : null}
    </ProLayout>
  )
}
