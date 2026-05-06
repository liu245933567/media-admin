import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { RootLayout } from './layouts/RootLayout'
import { SubtitlePage } from './pages/SubtitlePage'

const rootRoute = createRootRoute({
  component: RootLayout,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: SubtitlePage,
})

const routeTree = rootRoute.addChildren([indexRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
