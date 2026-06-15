import { toast, ToastProvider } from '@heroui/react'

export function AppToastProvider() {
  return <ToastProvider placement="top end" />
}

export function useAppToast() {
  return {
    success: (message: React.ReactNode) => toast.success(message),
    error: (message: React.ReactNode) => toast.danger(message),
    warning: (message: React.ReactNode) => toast.warning(message),
    info: (message: React.ReactNode) => toast.info(message),
  }
}
