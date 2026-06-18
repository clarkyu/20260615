import { cn } from '@/lib/utils'

// A tiny, dependency-free bar sparkline of the student's recent test scores
// (chronological, oldest → newest). Heights are scaled to the data's own range
// so small gains still read as movement; the latest bar is highlighted.
export function ScoreTrend({ scores }: { scores: number[] }) {
  const lo = Math.min(...scores)
  const hi = Math.max(...scores)
  const span = hi - lo || 1
  return (
    <div className="flex h-14 items-end gap-1" role="img" aria-label={scores.join(', ')}>
      {scores.map((s, i) => {
        const pct = 28 + ((s - lo) / span) * 72 // floor at 28% so low scores stay visible
        const last = i === scores.length - 1
        return (
          <div
            key={i}
            className={cn('flex-1 rounded-t-sm', last ? 'bg-primary' : 'bg-primary/25')}
            style={{ height: `${pct}%` }}
            title={String(s)}
          />
        )
      })}
    </div>
  )
}
