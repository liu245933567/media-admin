import type { ThemeMode } from '@/stores/theme-store'
import { CompressOutlined, DesktopOutlined, ExpandOutlined, MoonOutlined, PoweroffOutlined, SunOutlined } from '@ant-design/icons'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Button, Dropdown, Tooltip } from 'antd'
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
    = theme === 'dark' ? <MoonOutlined /> : theme === 'light' ? <SunOutlined /> : <DesktopOutlined />

  return (
    <div className="flex gap-2 pr-4">
      <Dropdown
        key="theme"
        menu={{
          items: [
            { key: 'light', icon: <SunOutlined />, label: '浅色' },
            { key: 'dark', icon: <MoonOutlined />, label: '深色' },
            { key: 'system', icon: <DesktopOutlined />, label: '系统' },
          ],
          selectedKeys: [theme],
          onClick: ({ key }) => setTheme(key as ThemeMode),
        }}
      >
        <Button type="text" icon={themeTriggerIcon} shape="circle" />
      </Dropdown>

      {isTauri()
        ? (
            <Tooltip title={maximized ? '还原' : '最大化'} key="s">
              <Button
                type="text"
                shape="circle"
                aria-label={maximized ? '还原窗口' : '最大化窗口'}
                icon={maximized ? <CompressOutlined /> : <ExpandOutlined />}
                onClick={() => void win?.toggleMaximize()}
              />
            </Tooltip>
          )
        : null}

      {isTauri()
        ? (
            <Tooltip title="关闭" key="c">
              <Button
                type="text"
                shape="circle"
                danger
                aria-label="关闭窗口"
                icon={<PoweroffOutlined />}
                onClick={() => void win?.close()}
              />
            </Tooltip>
          )
        : null}
    </div>
  )
}
