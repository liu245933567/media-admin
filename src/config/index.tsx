import { FileOutlined, FileSearchOutlined, HomeOutlined, PlaySquareOutlined, SettingOutlined } from '@ant-design/icons'

export const menu = [
  {
    name: '首页',
    path: '/',
    icon: <HomeOutlined />,
  },
  {
    name: '字幕查询',
    path: '/subtitle-web',
    icon: <FileSearchOutlined />,
  },
  {
    name: '字幕生成任务',
    path: '/subtitle-job',
    icon: <FileSearchOutlined />,
  },
  {
    name: '文件系统',
    path: '/file-system',
    icon: <FileOutlined />,
  },
  {
    name: 'Stash 场景',
    path: '/stash-scenes',
    icon: <PlaySquareOutlined />,
  },
  {
    name: '设置',
    path: '/setting',
    icon: <SettingOutlined />,
  },
]
