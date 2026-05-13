import type { TreeSelectProps } from 'antd'
import type { FsListItem } from '@/types'
import { App, TreeSelect } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchFsList } from '@/request'

type DirNode = NonNullable<TreeSelectProps['treeData']>[number]

export interface FsDirTreeSelectProps {
  value?: string
  onChange?: (path: string) => void
  placeholder?: string
  style?: React.CSSProperties
  className?: string
  disabled?: boolean
  onPressEnter?: () => void
}

function toDirNodes(items: FsListItem[]): DirNode[] {
  return items
    .filter(i => i.is_dir)
    .map((i) => {
      const node: DirNode = {
        title: i.name,
        value: i.full_path,
        key: i.full_path,
        isLeaf: false,
      }
      return node
    })
}

function updateTreeChildren(tree: DirNode[], key: string, children: DirNode[]): DirNode[] {
  return tree.map((n) => {
    if (String(n.key) === key) {
      return { ...n, children }
    }
    if (n.children?.length) {
      return { ...n, children: updateTreeChildren(n.children as DirNode[], key, children) }
    }
    return n
  })
}

export function FsDirTreeSelect({
  value,
  onChange,
  placeholder,
  style,
  className,
  disabled,
  onPressEnter,
}: FsDirTreeSelectProps) {
  const { message } = App.useApp()

  const [treeData, setTreeData] = useState<DirNode[]>([])
  const [initialLoading, setInitialLoading] = useState(false)

  const loadingKeysRef = useRef<Set<string>>(new Set())
  const loadedKeysRef = useRef<Set<string>>(new Set())

  const safePlaceholder = useMemo(() => {
    return placeholder ?? '请选择后端可访问的文件夹（可展开加载子目录）'
  }, [placeholder])

  const loadChildren = useCallback(async (parentPath?: string) => {
    const res = await fetchFsList(parentPath ? { parent_path: parentPath } : {})
    return toDirNodes(res)
  }, [])

  useEffect(() => {
    let cancelled = false
    setInitialLoading(true)
    loadChildren(undefined)
      .then((nodes) => {
        if (cancelled)
          return
        setTreeData(nodes)
      })
      .catch((e) => {
        if (cancelled)
          return
        message.error((e as Error).message || '加载目录失败')
        setTreeData([])
      })
      .finally(() => {
        if (cancelled)
          return
        setInitialLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [loadChildren, message])

  const loadData = useCallback<NonNullable<TreeSelectProps['loadData']>>(async (node) => {
    const key = String(node.key ?? node.value ?? '')
    if (!key)
      return

    if (loadedKeysRef.current.has(key))
      return

    if (loadingKeysRef.current.has(key))
      return

    loadingKeysRef.current.add(key)
    try {
      const children = await loadChildren(key)
      setTreeData(prev => updateTreeChildren(prev, key, children))
      loadedKeysRef.current.add(key)
    }
    catch (e) {
      message.error((e as Error).message || '加载子目录失败')
    }
    finally {
      loadingKeysRef.current.delete(key)
    }
  }, [loadChildren, message])

  return (
    <TreeSelect
      className={className}
      style={style}
      value={value}
      treeData={treeData}
      placeholder={safePlaceholder}
      allowClear
      showSearch={{
        treeNodeFilterProp: 'title',
      }}
      disabled={disabled}
      loading={initialLoading}
      treeDataSimpleMode={false}
      listHeight={420}
      labelInValue
      onInputKeyDown={(e) => {
        if (e.key === 'Enter')
          onPressEnter?.()
      }}
      onChange={(v) => {
        const next = String(v ?? '').trim()
        onChange?.(next)
      }}
      loadData={loadData}
    />
  )
}
