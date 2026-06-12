import { Button, Modal, useOverlayState } from '@heroui/react'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'

interface ConfirmOptions {
  title: React.ReactNode
  description?: React.ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => Promise<unknown> | unknown
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
  pending: boolean
}

const ConfirmContext = createContext<((options: ConfirmOptions) => void) | null>(null)

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null)
  const overlayState = useOverlayState({
    isOpen: Boolean(state?.open),
    onOpenChange: open => !open && setState(null),
  })

  const confirm = useCallback((options: ConfirmOptions) => {
    setState({ ...options, open: true, pending: false })
  }, [])

  const value = useMemo(() => confirm, [confirm])

  async function handleConfirm() {
    if (!state)
      return
    setState(prev => prev ? { ...prev, pending: true } : prev)
    try {
      await state.onConfirm()
      setState(null)
    }
    finally {
      setState(prev => prev ? { ...prev, pending: false } : prev)
    }
  }

  return (
    <ConfirmContext value={value}>
      {children}
      {state
        ? (
            <Modal state={overlayState}>
              <Modal.Backdrop>
                <Modal.Container size="sm">
                  <Modal.Dialog>
                    <Modal.Header>
                      <Modal.Heading>{state.title}</Modal.Heading>
                    </Modal.Header>
                    {state.description
                      ? (
                          <Modal.Body>
                            <div className="text-sm text-muted">{state.description}</div>
                          </Modal.Body>
                        )
                      : null}
                    <Modal.Footer>
                      <Button variant="tertiary" onPress={overlayState.close}>
                        {state.cancelText ?? '取消'}
                      </Button>
                      <Button
                        isPending={state.pending}
                        variant={state.danger ? 'danger' : 'primary'}
                        onPress={() => {
                          void handleConfirm()
                        }}
                      >
                        {state.confirmText ?? '确定'}
                      </Button>
                    </Modal.Footer>
                  </Modal.Dialog>
                </Modal.Container>
              </Modal.Backdrop>
            </Modal>
          )
        : null}
    </ConfirmContext>
  )
}

export function useConfirmDialog() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) {
    throw new Error('useConfirmDialog must be used inside ConfirmDialogProvider')
  }
  return confirm
}
