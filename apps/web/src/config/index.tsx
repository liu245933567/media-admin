import { DatabaseOutlined, FileOutlined, FileSearchOutlined, HomeOutlined, PlaySquareOutlined, SettingOutlined, VideoCameraOutlined } from '@ant-design/icons'

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
    name: '字幕生成',
    path: '/subtitle-task',
    icon: <DatabaseOutlined />,
  },
  {
    name: '视频查询',
    path: '/video-folder-scan',
    icon: <VideoCameraOutlined />,
  },
  {
    name: '文件系统',
    path: '/file-system',
    icon: <FileOutlined />,
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
