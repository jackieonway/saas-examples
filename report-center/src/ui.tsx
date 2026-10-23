import type { ComponentProps } from 'react'

export const cn = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ')

export function Badge({ className, variant = 'default', ...props }: ComponentProps<'span'> & { variant?: 'default' | 'secondary' | 'outline' }) {
  return <span {...props} className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
    variant === 'default' && 'border-transparent bg-primary text-primary-foreground',
    variant === 'secondary' && 'border-transparent bg-muted text-foreground', className)} />
}

export function Button({ className, variant = 'default', size = 'default', ...props }: ComponentProps<'button'> & {
  variant?: 'default' | 'outline' | 'ghost'; size?: 'default' | 'sm'
}) {
  return <button type="button" {...props} className={cn('inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50',
    size === 'sm' && 'h-8 text-xs',
    variant === 'default' && 'border-transparent bg-primary text-primary-foreground hover:opacity-90',
    variant === 'outline' && 'bg-background text-foreground hover:bg-muted',
    variant === 'ghost' && 'border-transparent hover:bg-muted', className)} />
}

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('rounded-md bg-muted opacity-60', className)} />
}
