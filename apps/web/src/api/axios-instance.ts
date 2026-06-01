import type { AxiosError, AxiosRequestConfig } from 'axios'
import { create, isAxiosError } from 'axios'

export const AXIOS_INSTANCE = create({
  // baseURL: '/api',
})

AXIOS_INSTANCE.interceptors.response.use(
  res => res,
  (error) => {
    if (!isAxiosError(error)) {
      return Promise.reject(error)
    }

    const status = error.response?.status
    const data = error.response?.data
    const message
      = (typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error: unknown }).error)
        : undefined)
      ?? (typeof data === 'object' && data !== null && 'message' in data
        ? String((data as { message: unknown }).message)
        : undefined)
      ?? (typeof data === 'string' && data.length > 0 ? data : undefined)
      ?? error.message
      ?? '出错了'

    return Promise.reject(new Error(status ? `[${status}] ${message}` : message))
  },
)

export function axiosInstance<T>(
  config: AxiosRequestConfig,
  options?: AxiosRequestConfig,
): Promise<T> {
  return AXIOS_INSTANCE({
    ...config,
    ...options,
  }).then(({ data }) => data)
}

export type ErrorType<Error> = AxiosError<Error>

export type BodyType<BodyData> = BodyData
