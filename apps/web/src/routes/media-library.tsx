import type { ActionType, ProColumns } from '@ant-design/pro-components'
import type { MediaFileRow } from '@/types'
import { PageContainer, ProTable } from '@ant-design/pro-components'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Space, Tag } from 'antd'
import dayjs from 'dayjs'
import { useMemo, useRef, useState } from 'react'
import {
  fetchMediaFiles,
  fetchMediaRoots,
  mediaRootsQueryKey,
} from '@/request'
import { MediaFileType } from '@/types'
import { formatBytes } from '@/utils'

export const Route = createFileRoute('/media-library')({
  component: PageComponent,
})

function PageComponent() {
  const filesActionRef = useRef<ActionType>(null)
  const [fileKeyword, setFileKeyword] = useState('')

  const rootsQuery = useQuery({
    queryKey: mediaRootsQueryKey,
    queryFn: fetchMediaRoots,
  })

  const rootOptions = useMemo(() => {
    return (rootsQuery.data ?? []).map(root => ({
      label: root.name,
      value: Number(root.id),
    }))
  }, [rootsQuery.data])

  const fileColumns = useMemo<ProColumns<MediaFileRow>[]>(() => [
    {
      title: '文件名',
      dataIndex: 'file_name',
      ellipsis: true,
      copyable: true,
    },
    {
      title: '类型',
      dataIndex: 'file_type',
      width: 100,
      valueType: 'select',
      fieldProps: {
        options: [
          { label: '视频', value: MediaFileType.Video },
          { label: '字幕', value: MediaFileType.Subtitle },
        ],
      },
      render: (_, row) => row.file_type === MediaFileType.Video
        ? <Tag color="blue">视频</Tag>
        : <Tag color="green">字幕</Tag>,
    },
    {
      title: '资源路径',
      dataIndex: 'root_id',
      width: 180,
      valueType: 'select',
      fieldProps: {
        options: rootOptions,
        showSearch: true,
        optionFilterProp: 'label',
      },
      render: (_, row) => {
        const root = (rootsQuery.data ?? []).find(item => Number(item.id) === Number(row.root_id))
        return root?.name ?? row.root_id
      },
    },
    {
      title: '大小',
      dataIndex: 'file_size',
      width: 120,
      search: false,
      render: (_, row) => formatBytes(Number(row.file_size)),
    },
    {
      title: '修改时间',
      dataIndex: 'modified_at',
      width: 180,
      search: false,
      render: (_, row) => dayjs(row.modified_at).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '完整路径',
      dataIndex: 'file_path',
      ellipsis: true,
      copyable: true,
      search: false,
    },
  ], [rootOptions, rootsQuery.data])

  return (
    <PageContainer title={false}>
      <Space direction="vertical" size={16} className="w-full">
        <ProTable<MediaFileRow>
          rowKey="id"
          actionRef={filesActionRef}
          columns={fileColumns}
          request={async (params) => {
            const res = await fetchMediaFiles({
              root_id: params.root_id ? Number(params.root_id) : undefined,
              file_type: params.file_type as MediaFileType | undefined,
              q: fileKeyword,
              current: params.current,
              page_size: params.pageSize,
            })
            return {
              data: res.data,
              total: Number(res.total),
              success: true,
            }
          }}
          search={{ labelWidth: 88 }}
          options={{ density: false, setting: false }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          toolbar={{
            search: {
              placeholder: '搜索文件名或路径',
              onSearch: (value) => {
                setFileKeyword(value.trim())
                filesActionRef.current?.reload()
              },
            },
          }}
        />
      </Space>
    </PageContainer>
  )
}
