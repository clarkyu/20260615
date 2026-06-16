import { cn } from '@/lib/utils'

// Shimmer placeholder for content that is loading (media, lists).
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton rounded-2xl', className)} />
}
