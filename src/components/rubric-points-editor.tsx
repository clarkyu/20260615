'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useT } from '@/components/i18n-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { RubricPoint } from '@/lib/domain/rubric'

// 「分值」编辑器：各维度名 + 分值，与「标准」纯文字分开设（评分时代码把两者拼成判分 prompt、
// 满分取各分值之和）。留空 = 不设分值，评分回退平台默认满分（100）。纯受控组件——序列化 /
// 落库交给调用方（作业编辑器 & 评分页配置面板共用），本身不碰存储格式。
export function RubricPointsEditor({ value, onChange }: { value: RubricPoint[]; onChange: (v: RubricPoint[]) => void }) {
  const t = useT()
  const total = value.reduce((s, p) => s + (Number.isFinite(p.points) ? p.points : 0), 0)
  const setRow = (i: number, patch: Partial<RubricPoint>) => onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const addRow = () => onChange([...value, { name: '', points: 0 }])
  const removeRow = (i: number) => onChange(value.filter((_, j) => j !== i))
  return (
    <div className="space-y-1.5">
      <Label>{t('grade.points')}</Label>
      {value.length > 0 ? (
        <div className="space-y-2">
          {value.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={p.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder={t('grade.pointsDim')} aria-label={t('grade.pointsDim')} className="flex-1" />
              <Input
                type="number"
                min={0}
                value={Number.isFinite(p.points) ? p.points : 0}
                onChange={(e) => setRow(i, { points: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
                aria-label={t('grade.pointsValue')}
                className="w-20"
              />
              <Button type="button" size="icon" variant="ghost" onClick={() => removeRow(i)} aria-label={t('grade.pointsRemove')}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" size="sm" variant="outline" onClick={addRow}>
          <Plus className="h-4 w-4" />{t('grade.pointsAdd')}
        </Button>
        <span className="text-xs text-muted-foreground">{value.length === 0 ? t('grade.pointsEmpty') : t('grade.pointsTotal', { n: total })}</span>
      </div>
      <p className="text-xs text-muted-foreground">{t('grade.pointsHint')}</p>
    </div>
  )
}
