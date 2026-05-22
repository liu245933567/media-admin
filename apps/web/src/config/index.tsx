import {
  HomeOutlined,
  PlaySquareOutlined,
  FolderOpenOutlined,
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
    name: '本地视频',
    path: '/video-folder-scan',
    icon: <VideoCameraOutlined />,
  },
  {
    name: '媒体库',
    path: '/media-library',
    icon: <FolderOpenOutlined />,
  },
  {
    name: 'Stash 库',
    path: '/stash-scenes',
    icon: <PlaySquareOutlined />,
  },
  {
    name: '任务管理',
    path: '/tasks',
    icon: <UnorderedListOutlined />,
  },
  {
    name: '设置',
    path: '/setting',
    icon: <SettingOutlined />,
  },
]
