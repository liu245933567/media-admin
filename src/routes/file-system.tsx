import type { FileActionHandler, FileData } from 'chonky2'
import type { FsListItem } from '@/types'
import { PageContainer, ProCard } from '@ant-design/pro-components'
import { createFileRoute } from '@tanstack/react-router'
import { App, Button, Flex, Input, Space, Typography } from 'antd'
import { ChonkyActions, FileBrowser, FileList, FileNavbar, FileToolbar } from 'chonky2'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchFsList } from '@/request'

export const Route = createFileRoute('/file-system')({
  component: RouteComponent,
})

function RouteComponent() {
  const { message } = App.useApp()

  const [root, setRoot] = useState('')
  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined)
  const [items, setItems] = useState<FsListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([])

  const load = useCallback(async (path?: string) => {
    setLoading(true)
    try {
      const res = await fetchFsList(path ? { parent_path: path } : root.trim() ? { parent_path: root.trim() } : {})
      setItems(res)
    }
    catch (e) {
      message.error((e as Error).message || '加载文件列表失败')
      setItems([])
    }
    finally {
      setLoading(false)
    }
  }, [message, root])

  useEffect(() => {
    void load(currentPath)
  }, [currentPath, load])

  const files = useMemo<FileData[]>(() => {
    return items.map((i) => {
      const file: FileData = {
        id: i.full_path,
        name: i.name,
        isDir: i.is_dir,
        size: i.size,
        modDate: i.last_modified,
        openable: true,
      }
      return file
    })
  }, [items])

  const folderChain = useMemo<FileData[] | undefined>(() => {
    const active = currentPath ?? root.trim()
    if (!active)
      return undefined

    const parts = splitPath(active)
    if (!parts.length)
      return undefined

    const chain: FileData[] = []
    for (const p of parts) {
      chain.push({
        id: p.full,
        name: p.name,
        isDir: true,
        openable: true,
      })
    }
    return chain
  }, [currentPath, root])

  const onFileAction = useMemo<FileActionHandler>(() => {
    return (action) => {
      if (action.id === ChonkyActions.OpenFiles.id) {
        const file = action.payload.targetFile as FileData | undefined
        if (!file)
          return
        if (file.isDir) {
          setCurrentPath(String(file.id))
          setSelectedFilePaths([])
        }
        else {
          setSelectedFilePaths([String(file.id)])
        }
      }
      else if (action.id === ChonkyActions.OpenParentFolder.id) {
        const active = currentPath ?? root.trim()
        if (!active) {
          setCurrentPath(undefined)
          return
        }

        const parent = parentPath(active)
        setCurrentPath(parent ?? undefined)
        setSelectedFilePaths([])
      }
      else if (action.id === ChonkyActions.ChangeSelection.id) {
        const selection = action.payload.selection as Set<string> | undefined
        if (selection)
          setSelectedFilePaths([...selection])
      }
    }
  }, [currentPath, root])

  return (
    <PageContainer>
      <ProCard direction="column" gutter={12} style={{ padding: 12 }}>
        <ProCard>
          <Flex vertical gap={8} style={{ width: '100%' }}>
            <Space wrap>
              <Typography.Text>Root：</Typography.Text>
              <Input
                style={{ width: 360 }}
                value={root}
                placeholder="可选：例如 D:\\video 或 /mnt/video；留空则列出盘符/根目录"
                onChange={e => setRoot(e.target.value)}
              />
              <Button
                type="primary"
                loading={loading}
                onClick={async () => {
                  setCurrentPath(undefined)
                  setSelectedFilePaths([])
                  await load(undefined)
                }}
              >
                加载
              </Button>
              <Button
                disabled={!currentPath && !root.trim()}
                onClick={() => {
                  setCurrentPath(undefined)
                  setSelectedFilePaths([])
                }}
              >
                回到根
              </Button>
            </Space>

            <Typography.Text type="secondary">
              当前目录：
              {(currentPath ?? root.trim()) || '(根目录/盘符列表)'}
            </Typography.Text>
            <Typography.Text type="secondary">
              已选文件：
              {selectedFilePaths.length ? selectedFilePaths.join(', ') : '无'}
            </Typography.Text>
          </Flex>
        </ProCard>

        <ProCard>
          <div style={{ height: '70vh', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, overflow: 'hidden' }}>
            <FileBrowser
              files={loading ? [null, null, null] : files}
              folderChain={folderChain}
              fileActions={[
                ChonkyActions.OpenParentFolder,
                ChonkyActions.OpenSelection,
              ]}
              onFileAction={onFileAction}
            >
              <FileNavbar />
              <FileToolbar />
              <FileList />
            </FileBrowser>
          </div>
        </ProCard>
      </ProCard>
    </PageContainer>
  )
}

function splitPath(path: string): Array<{ name: string, full: string }> {
  const p = path.trim()
  if (!p)
    return []

  // Normalize separators for parsing, but keep original in returned `full`.
  const norm = p.replaceAll('\\', '/')

  // Windows drive root like "D:/foo/bar" or "D:"
  const drive = /^([a-z]:)(\/.*)?$/i.exec(norm)
  if (drive) {
    const driveRoot = `${drive[1]}\\`
    const rest = (drive[2] ?? '').replace(/^\/+/, '')
    const segs = rest ? rest.split('/').filter(Boolean) : []
    const out: Array<{ name: string, full: string }> = [{ name: driveRoot, full: driveRoot }]
    let acc = driveRoot.replaceAll('/', '\\')
    for (const s of segs) {
      acc = `${acc}${acc.endsWith('\\') ? '' : '\\'}${s}`
      out.push({ name: s, full: acc })
    }
    return out
  }

  // POSIX path like "/mnt/video/a"
  const isAbs = norm.startsWith('/')
  const segs = norm.split('/').filter(Boolean)
  if (!segs.length)
    return isAbs ? [{ name: '/', full: '/' }] : []

  const out: Array<{ name: string, full: string }> = []
  let acc = isAbs ? '/' : ''
  out.push({ name: isAbs ? '/' : segs[0]!, full: isAbs ? '/' : segs[0]! })
  if (!isAbs) {
    acc = segs[0]!
    segs.shift()
  }
  for (const s of segs) {
    acc = `${acc}${acc.endsWith('/') ? '' : '/'}${s}`
    out.push({ name: s, full: acc })
  }
  return out
}

function parentPath(path: string): string | null {
  const p = path.trim()
  if (!p)
    return null

  const norm = p.replaceAll('\\', '/').replace(/\/+$/, '')
  const drive = /^([a-z]:)(\/.*)?$/i.exec(norm)
  if (drive) {
    const rest = (drive[2] ?? '').replace(/^\/+/, '')
    if (!rest)
      return null
    const segs = rest.split('/').filter(Boolean)
    segs.pop()
    const parent = segs.length ? `${drive[1]}\\${segs.join('\\')}` : `${drive[1]}\\`
    return parent
  }

  const isAbs = norm.startsWith('/')
  const segs = norm.split('/').filter(Boolean)
  if (!segs.length)
    return null
  segs.pop()
  if (!segs.length)
    return isAbs ? '/' : null
  return `${isAbs ? '/' : ''}${segs.join('/')}`
}
