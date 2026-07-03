import { cn } from '@/lib/utils'

type Tone = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'muted'

const tones: Record<Tone, string> = {
  default: 'bg-secondary text-secondary-foreground',
  primary: 'bg-accent text-accent-foreground',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/12 text-destructive',
  muted: 'bg-muted text-muted-foreground',
}

export function Badge({
  tone = 'default',
  className,
  children,
}: {
  tone?: Tone
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function statusTone(status: string): Tone {
  switch (status) {
    case 'GRADED':
      return 'success'
    case 'UPLOADED':
      return 'primary'
    case 'PROCESSING':
      return 'warning'
    case 'FLAGGED':
      return 'warning'
    case 'FAILED':
      return 'danger'
    default:
      return 'muted'
  }
}
