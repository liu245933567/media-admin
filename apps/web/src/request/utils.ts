import { create } from 'axios'

const axiosIns = create({
  baseURL: '/api',
})

axiosIns.interceptors.response.use(
  res => res,
  (error) => {
    const status = error?.response?.status
    const message
      = error?.response?.data?.error
        ?? error?.response?.data?.message
        ?? error?.message
        ?? '出错了'
    return Promise.reject(new Error(status ? `[${status}] ${message}` : message))
  },
)

export async function post<Res = unknown, Req = unknown>(url: string, data: Req) {
  const res = await axiosIns.post<Res>(url, data)
  return res.data
}

export async function put<Res = unknown, Req = unknown>(url: string, data: Req) {
  const res = await axiosIns.put<Res>(url, data)
  return res.data
}

export async function get<Res = unknown, Req extends object = Record<string, unknown>>(url: string, params?: Req) {
  const res = await axiosIns.get<Res>(url, { params })
  return res.data
}
