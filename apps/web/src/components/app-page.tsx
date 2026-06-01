import type { ReactNode } from 'react'

export interface AppPageProps {
  title?: ReactNode
  description?: ReactNode
  extra?: ReactNode
  children: ReactNode
  fullBleed?: boolean
}

export function AppPage({ title, description, extra, children, fullBleed }: AppPageProps) {
  return (
    <section className={fullBleed ? 'min-h-full' : 'mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8'}>
      {(title || description || extra) && (
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {title ? <h1 className="text-2xl font-semibold tracking-normal text-foreground">{title}</h1> : null}
            {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
          </div>
          {extra ? <div className="flex shrink-0 flex-wrap items-center gap-2">{extra}</div> : null}
        </header>
      )}
      {children}
    </section>
  )
}
