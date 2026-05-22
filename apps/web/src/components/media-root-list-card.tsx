import type { ProColumns } from '@ant-design/pro-components'
import type { MediaRootRow } from '@/types'
import { ProTable } from '@ant-design/pro-components'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Form, Input, Modal, Popconfirm, Typography } from 'antd'
import dayjs from 'dayjs'
import { useMemo, useState } from 'react'
import {
  createMediaRoot,
  deleteMediaRoot,
  enqueueMediaRootScan,
  fetchMediaRoots,
  mediaRootsQueryKey,
} from '@/request'

export interface MediaRootListCardProps {
  onChanged?: () => void
  showCreate?: boolean
}

export function MediaRootListCard({ onChanged, showCreate = true }: MediaRootListCardProps) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [form] = Form.useForm<{ path: string, name?: string }>()
  const [createOpen, setCreateOpen] = useState(false)

  const rootsQuery = useQuery({
    queryKey: mediaRootsQueryKey,
    queryFn: fetchMediaRoots,
  })

  const createRootMutation = useMutation({
    mutationFn: createMediaRoot,
    onSuccess: async () => {
      message.success('媒体资源路径已添加')
      setCreateOpen(false)
      form.resetFields()
      await queryClient.invalidateQueries({ queryKey: mediaRootsQueryKey })
      onChanged?.()
    },
    onError: error => message.error(error.message ?? '添加失败'),
  })

  const deleteRootMutation = useMutation({
    mutationFn: deleteMediaRoot,
    onSuccess: async () => {
      message.success('媒体资源路径已删除')
      await queryClient.invalidateQueries({ queryKey: mediaRootsQueryKey })
      onChanged?.()
    },
    onError: error => message.error(error.message ?? '删除失败'),
  })

  const scanRootMutation = useMutation({
    mutationFn: enqueueMediaRootScan,
    onSuccess: () => message.success('扫描任务已提交，可在任务管理查看进度'),
    onError: error => message.error(error.message ?? '提交失败'),
  })

  const columns = useMemo<ProColumns<MediaRootRow>[]>(() => [
    {
      title: '名称',
      dataIndex: 'name',
      width: 180,
      ellipsis: true,
    },
    {
      title: '路径',
      dataIndex: 'path',
      ellipsis: true,
      copyable: true,
    },
    {
      title: '上次扫描',
      dataIndex: 'last_scanned_at',
      width: 180,
      render: (_, row) => row.last_scanned_at
        ? dayjs(row.last_scanned_at).format('YYYY-MM-DD HH:mm:ss')
        : <Typography.Text type="secondary">未扫描</Typography.Text>,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 180,
      render: (_, row) => [
        <Button
          key="scan"
          type="link"
          className="m-0! p-0!"
          loading={scanRootMutation.isPending}
          onClick={() => scanRootMutation.mutate(Number(row.id))}
        >
          扫描
        </Button>,
        <Popconfirm
          key="delete"
          title="删除媒体资源路径"
          description="会同时删除该路径下已扫描入库的文件记录。"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => deleteRootMutation.mutate(Number(row.id))}
        >
          <Button type="link" danger className="m-0! p-0!">
            删除
          </Button>
        </Popconfirm>,
      ],
    },
  ], [deleteRootMutation, scanRootMutation])

  return (
    <Card title="媒体资源路径" variant="borderless" className="shadow-sm">
      <Modal
        title="添加媒体资源路径"
        open={createOpen}
        confirmLoading={createRootMutation.isPending}
        okText="添加"
        cancelText="取消"
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        afterOpenChange={(nextOpen) => {
          if (!nextOpen) {
            form.resetFields()
          }
        }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={values => createRootMutation.mutate(values)}
        >
          <Form.Item
            name="path"
            label="路径"
            rules={[{ required: true, message: '请输入绝对路径' }]}
          >
            <Input placeholder="例如 D:\Media" />
          </Form.Item>
          <Form.Item name="name" label="名称">
            <Input placeholder="留空时使用文件夹名称" />
          </Form.Item>
        </Form>
      </Modal>
      <ProTable<MediaRootRow>
        rowKey="id"
        search={false}
        columns={columns}
        loading={rootsQuery.isFetching}
        dataSource={rootsQuery.data ?? []}
        pagination={false}
        options={{ reload: () => rootsQuery.refetch(), density: false, setting: false }}
        toolBarRender={() => showCreate
          ? [
              <Button key="create" type="primary" onClick={() => setCreateOpen(true)}>
                添加媒体资源路径
              </Button>,
            ]
          : []}
      />
    </Card>
  )
}
