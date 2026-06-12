import type { ThemeMode } from '@/stores/theme-store'
import { Button, Dropdown, Tooltip } from '@heroui/react'
import { Icon } from '@iconify/react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'
import { useTheme } from '@/stores/theme-store'
import { isTauri } from '@/utils/is-tauri'

export function DesktopWindowControls() {
  const [maximized, setMaximized] = useState(false)

  const { theme, setTheme } = useTheme()

  useEffect(() => {
    if (!isTauri())
      return
    const win = getCurrentWindow()
    let unlisten: (() => void) | undefined

    void win.isMaximized().then(setMaximized)

    void win.onResized(() => {
      void win.isMaximized().then(setMaximized)
    }).then((fn) => {
      unlisten = fn
    })

    return () => {
      unlisten?.()
    }
  }, [])

  const win = isTauri() ? getCurrentWindow() : undefined

  const themeTriggerIcon
    = theme === 'dark' ? 'lucide:moon' : theme === 'light' ? 'lucide:sun' : 'lucide:monitor'

  return (
    <div className="flex gap-2">
      <Dropdown>
        <Dropdown.Trigger>
          <Button isIconOnly aria-label="切换主题" variant="ghost">
            <Icon icon={themeTriggerIcon} className="size-4" />
          </Button>
        </Dropdown.Trigger>
        <Dropdown.Popover>
          <Dropdown.Menu
            selectedKeys={[theme]}
            selectionMode="single"
            onAction={key => setTheme(String(key) as ThemeMode)}
          >
            <Dropdown.Item id="light" textValue="浅色">
              <Icon icon="lucide:sun" className="size-4" />
              浅色
              <Dropdown.ItemIndicator />
            </Dropdown.Item>
            <Dropdown.Item id="dark" textValue="深色">
              <Icon icon="lucide:moon" className="size-4" />
              深色
              <Dropdown.ItemIndicator />
            </Dropdown.Item>
            <Dropdown.Item id="system" textValue="系统">
              <Icon icon="lucide:monitor" className="size-4" />
              系统
              <Dropdown.ItemIndicator />
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      {isTauri()
        ? (
            <Tooltip delay={0} key="s">
              <Button
                isIconOnly
                aria-label={maximized ? '还原窗口' : '最大化窗口'}
                variant="ghost"
                onPress={() => void win?.toggleMaximize()}
              >
                <Icon icon={maximized ? 'lucide:minimize-2' : 'lucide:maximize-2'} className="size-4" />
              </Button>
              <Tooltip.Content>{maximized ? '还原' : '最大化'}</Tooltip.Content>
            </Tooltip>
          )
        : null}

      {isTauri()
        ? (
            <Tooltip delay={0} key="c">
              <Button
                isIconOnly
                aria-label="关闭窗口"
                variant="danger-soft"
                onPress={() => void win?.close()}
              >
                <Icon icon="lucide:power" className="size-4" />
              </Button>
              <Tooltip.Content>关闭</Tooltip.Content>
            </Tooltip>
          )
        : null}
    </div>
  )
}
