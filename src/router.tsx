import { RouterProvider } from '@tanstack/react-router'
import { router } from './routeTree'

export function AppRouter() {
  return <RouterProvider router={router} />
}
