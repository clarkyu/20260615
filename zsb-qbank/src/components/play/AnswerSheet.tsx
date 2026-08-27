'use client'

// 答题卡(SPEC §7.4):底部抽屉,按大题分区显示小题状态,点击跳转。
export interface SheetSection {
  title: string
  items: { itemId: string; number: number; answered: boolean; groupIndex: number }[]
}

export function AnswerSheet({
  open,
  sections,
  onJump,
  onClose,
}: {
  open: boolean
  sections: SheetSection[]
  onJump: (groupIndex: number, itemId: string) => void
  onClose: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="max-h-[70dvh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] dark:bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto max-w-xl">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-bold">答题卡</h2>
            <button type="button" onClick={onClose} className="min-h-11 min-w-11 text-neutral-500">
              关闭
            </button>
          </div>
          {sections.map((s) => (
            <div key={s.title} className="mb-3">
              <p className="mb-1.5 text-sm text-neutral-500">{s.title}</p>
              <div className="flex flex-wrap gap-2">
                {s.items.map((it) => (
                  <button
                    key={it.itemId}
                    type="button"
                    onClick={() => {
                      onJump(it.groupIndex, it.itemId)
                      onClose()
                    }}
                    className={`min-h-11 min-w-11 rounded-xl border text-sm font-medium ${
                      it.answered
                        ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200'
                        : 'border-neutral-300 text-neutral-500 dark:border-neutral-700'
                    }`}
                  >
                    {it.number}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
