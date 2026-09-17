'use client'

// 框架文本渲染(SPEC §4.3):{{n}} 占位符 → 空位芯片;段落按空行分隔,其余按纯文本。
// 芯片显示题号 + 已填词,当前空高亮;点击切换当前空。

export function BlankChip({
  label,
  value,
  active,
  status,
  onClick,
}: {
  label: string
  value: string
  active: boolean
  status?: 'correct' | 'wrong' | null
  onClick?: () => void
}) {
  const tone =
    status === 'correct'
      ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
      : status === 'wrong'
        ? 'border-red-500 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
        : active
          ? 'border-blue-600 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
          : 'border-neutral-300 bg-neutral-50 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'
  // 空位芯片嵌在短文的行文里,视觉上不能长到 44px —— 那会把整段的行距撑散。
  // 所以用一层看不见的 ::after 只把**触控区**上下各撑 6px(34 → 46px):
  // 满足硬约束 5「可点击元素不小于 44px」,版面一点不动。
  return (
    <button
      type="button"
      data-blank={label}
      onClick={onClick}
      className={`relative mx-0.5 inline-flex min-h-8 min-w-14 items-baseline gap-1 rounded-lg border px-2 align-baseline after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] ${tone}`}
    >
      <span className="text-xs opacity-70">{label}</span>
      <span className="font-medium">{value || '____'}</span>
    </button>
  )
}

export function FrameText({
  frame,
  values,
  activeBlank,
  statusOf,
  onBlankClick,
}: {
  frame: string
  values: Record<string, string>
  activeBlank: string | null
  statusOf?: (blank: string) => 'correct' | 'wrong' | null
  onBlankClick: (blank: string) => void
}) {
  const paragraphs = frame.split(/\n\s*\n/)
  return (
    <div className="space-y-3 text-[17px] leading-relaxed">
      {paragraphs.map((para, pi) => {
        const parts = para.split(/(\{\{\w+\}\})/g)
        return (
          <p key={pi}>
            {parts.map((part, i) => {
              const m = /^\{\{(\w+)\}\}$/.exec(part)
              if (!m) return <span key={i}>{part}</span>
              const blank = m[1] ?? ''
              return (
                <BlankChip
                  key={i}
                  label={blank}
                  value={values[blank] ?? ''}
                  active={activeBlank === blank}
                  status={statusOf?.(blank) ?? null}
                  onClick={() => onBlankClick(blank)}
                />
              )
            })}
          </p>
        )
      })}
    </div>
  )
}
