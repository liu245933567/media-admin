import {
  FileSearchOutlined,
  HomeOutlined,
  PlaySquareOutlined,
  SettingOutlined,
  UnorderedListOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'

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
    name: '任务管理',
    path: '/tasks',
    icon: <UnorderedListOutlined />,
  },
  {
    name: '视频查询',
    path: '/video-folder-scan',
    icon: <VideoCameraOutlined />,
  },
  {
    name: 'Stash 库',
    path: '/stash-scenes',
    icon: <PlaySquareOutlined />,
  },
  {
    name: '设置',
    path: '/setting',
    icon: <SettingOutlined />,
  },
]
