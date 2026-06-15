import { createFileRoute, Navigate, Outlet, useRouterState } from '@tanstack/react-router'

export const Route = createFileRoute('/setting')({
  component: SettingLayout,
})

function SettingLayout() {
  const pathname = useRouterState({ select: state => state.location.pathname })

  if (pathname === '/setting') {
    return <Navigate to="/setting/defaults" replace />
  }

  return (
    <div className="min-w-0">
      <Outlet />
    </div>
  )
}
