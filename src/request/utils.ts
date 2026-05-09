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
