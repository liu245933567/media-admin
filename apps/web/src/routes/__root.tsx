import { createRootRoute, Outlet } from '@tanstack/react-router'
// import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { AppShell } from '@/components/app-shell'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <AppShell>
      <Outlet />
      {/* {import.meta.env.DEV ? <TanStackRouterDevtools position="bottom-left" /> : null} */}
    </AppShell>
  )
}
