declare module 'chonky2' {
  import type { ComponentType, ReactNode } from 'react'

  export type FileData = {
    id: string
    name: string
    isDir?: boolean
    size?: number
    modDate?: Date | string
    openable?: boolean
    [k: string]: unknown
  }

  export type FileArray<FT extends FileData = FileData> = Array<FT | null>

  export type FileAction = {
    id: string
    payload: any
  }

  export type FileActionHandler = (action: FileAction) => void

  export const FileBrowser: ComponentType<{
    files: FileArray
    folderChain?: FileArray
    fileActions?: any[]
    onFileAction?: FileActionHandler
    children?: ReactNode
  }>

  export const FileNavbar: ComponentType<Record<string, never>>
  export const FileToolbar: ComponentType<Record<string, never>>
  export const FileList: ComponentType<Record<string, never>>

  export const ChonkyActions: {
    OpenFiles: { id: string }
    OpenParentFolder: { id: string }
    ChangeSelection: { id: string }
    OpenSelection: { id: string }
    [k: string]: { id: string }
  }
}

