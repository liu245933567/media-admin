import { ProLayout } from '@ant-design/pro-components'
import { createRootRoute, Link, Outlet, useRouterState } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const pathname = useRouterState({ select: s => s.location.pathname })

  return (
    <>
      <ProLayout
        title="Media Admin"
        logo={false}
        location={{ pathname }}
        menu={{
          request: async () => [
            {
              name: '首页',
              path: '/',
            },
            {
              name: '文件选择',
              path: '/file-select',
            },
          ],
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
      </ProLayout>
      {import.meta.env.DEV ? <TanStackRouterDevtools position="bottom-right" /> : null}
    </>
  )
}
