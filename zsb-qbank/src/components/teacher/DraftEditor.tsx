'use client'

import { useMemo, useState } from 'react'
import { ITEM_TYPE_LABEL } from '@/lib/teacher/item-preview'

// 导入向导校对页(SPEC §8):左侧原文 Markdown,右侧按大题 / 题组 / 小题展开的表单;
// 规则引擎与 AI 拿不准的地方(issues)按路径标红。编辑走通用路径读写,类型化字段由描述表决定。

export interface Issue {
  path: string
  message: string
  source: 'rule' | 'schema' | 'ai'
}
type Json = Record<string, unknown>

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, k) => (cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined), obj)
}
function setPath(obj: Json, path: string, value: unknown): Json {
  const keys = path.split('.')
  const next: Json = structuredClone(obj)
  let cur: Record<string, unknown> = next
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!
    const v = cur[k]
    if (!v || typeof v !== 'object') cur[k] = /^\d+$/.test(keys[i + 1]!) ? [] : {}
    cur = cur[k] as Record<string, unknown>
  }
  cur[keys[keys.length - 1]!] = value
  return next
}

type Kind = 'text' | 'textarea' | 'number' | 'list' | 'json'
interface Field {
  path: string // 相对小题
  label: string
  kind: Kind
}
const COMMON: Field[] = [
  { path: 'explanation', label: '解析', kind: 'textarea' },
  { path: 'knowledgeTags', label: '知识点（每行一个）', kind: 'list' },
  { path: 'difficulty', label: '难度 1–3', kind: 'number' },
]
const FIELDS: Record<string, Field[]> = {
  fill: [
    { path: 'content.hint', label: '提示词', kind: 'text' },
    { path: 'content.maxWords', label: '最多词数', kind: 'number' },
    { path: 'answer.accepted', label: '参考答案（每行一个可接受写法）', kind: 'list' },
    { path: 'contextSnippet', label: '所在句（训练模式用）', kind: 'textarea' },
  ],
  reorder: [
    { path: 'content.chunks', label: '词块（每行一个）', kind: 'list' },
    { path: 'answer.accepted', label: '参考答案句（每行一个）', kind: 'list' },
  ],
  short_answer: [
    { path: 'content.question', label: '问题', kind: 'textarea' },
    { path: 'answer.reference', label: '参考答案', kind: 'textarea' },
    { path: 'answer.keyPoints', label: '要点（每行一个）', kind: 'list' },
    { path: 'answer.rubric', label: '评分细则', kind: 'textarea' },
  ],
  translate_e2c: [
    { path: 'content.source', label: '英文原句', kind: 'textarea' },
    { path: 'answer.reference', label: '参考译文', kind: 'textarea' },
    { path: 'answer.keyPoints', label: '意群要点（每行一个）', kind: 'list' },
    { path: 'answer.rubric', label: '评分细则', kind: 'textarea' },
  ],
  translate_c2e_fill: [
    { path: 'content.zh', label: '中文', kind: 'textarea' },
    { path: 'content.frame', label: '英文框架（{{blank}} 为空位）', kind: 'textarea' },
    { path: 'content.hint', label: '提示词', kind: 'text' },
    { path: 'content.maxWords', label: '最多词数', kind: 'number' },
    { path: 'answer.accepted', label: '参考答案（每行一个可接受写法）', kind: 'list' },
  ],
  writing: [
    { path: 'content.genre', label: '体裁（email / letter / essay…）', kind: 'text' },
    { path: 'content.persona', label: '身份', kind: 'text' },
    { path: 'content.prompt', label: '题目', kind: 'textarea' },
    { path: 'content.requirements', label: '要点（每行一个）', kind: 'list' },
    { path: 'content.minWords', label: '最少词数', kind: 'number' },
    { path: 'answer.sample', label: '范文', kind: 'textarea' },
    { path: 'answer.rubric', label: '评分维度 JSON（[{name,maxScore,desc}]）', kind: 'json' },
  ],
}
const TYPES = ['fill', 'reorder', 'short_answer', 'translate_e2c', 'translate_c2e_fill', 'writing'] as const

// 「每行一个」列表:编辑期间保留原始文本(否则回车 / 首尾空格会被即时吞掉),失焦时才整理成数组。
function ListInput({ value, onChange, cls }: { value: unknown; onChange: (v: unknown) => void; cls: string }) {
  const joined = Array.isArray(value) ? value.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') : ''
  const [text, setText] = useState(joined)
  const [editing, setEditing] = useState(false)
  const shown = editing ? text : joined
  return (
    <textarea
      className={cls}
      rows={Math.min(8, Math.max(2, shown.split('\n').length + (editing ? 1 : 0)))}
      value={shown}
      onFocus={() => {
        setText(joined)
        setEditing(true)
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setEditing(false)
        onChange(text.split('\n').map((s) => s.trim()).filter(Boolean))
      }}
    />
  )
}
// JSON 字段:解析失败不吞掉,标红提示直到改对。
function JsonInput({ value, onChange, cls }: { value: unknown; onChange: (v: unknown) => void; cls: string }) {
  const [text, setText] = useState(JSON.stringify(value ?? [], null, 0))
  const [bad, setBad] = useState(false)
  return (
    <>
      <textarea
        className={`${cls} ${bad ? 'border-red-500' : ''}`}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          try {
            onChange(JSON.parse(text))
            setBad(false)
          } catch {
            setBad(true)
          }
        }}
      />
      {bad ? <span className="text-xs text-red-600">JSON 格式不对（键名要加引号），未保存这处修改</span> : null}
    </>
  )
}
// 数字输入:清空时存 undefined(而不是 0),由 zod 在保存时报缺失。
function NumberInput({ value, onChange, cls }: { value: unknown; onChange: (v: unknown) => void; cls: string }) {
  const [text, setText] = useState(typeof value === 'number' ? String(value) : '')
  return (
    <input
      type="text"
      inputMode="decimal"
      className={cls}
      value={text}
      onChange={(e) => {
        const t = e.target.value
        setText(t)
        if (t.trim() === '') onChange(undefined)
        else if (/^-?\d*\.?\d*$/.test(t) && !Number.isNaN(Number(t)) && t !== '.' && t !== '-') onChange(Number(t))
      }}
    />
  )
}

function FieldInput({ value, kind, onChange, bad }: { value: unknown; kind: Kind; onChange: (v: unknown) => void; bad: boolean }) {
  const cls = `mt-0.5 w-full rounded-lg border px-2 py-1 text-sm dark:bg-neutral-900 ${bad ? 'border-red-500 bg-red-50 dark:bg-red-950/30' : 'border-neutral-300 dark:border-neutral-700'}`
  if (kind === 'number') return <NumberInput value={value} onChange={onChange} cls={cls} />
  if (kind === 'text') return <input className={cls} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)} />
  if (kind === 'list') return <ListInput value={value} onChange={onChange} cls={cls} />
  if (kind === 'json') return <JsonInput value={value} onChange={onChange} cls={cls} />
  const t = typeof value === 'string' ? value : ''
  return <textarea className={cls} rows={Math.min(10, Math.max(2, Math.ceil(t.length / 90) + t.split('\n').length - 1))} value={t} onChange={(e) => onChange(e.target.value)} />
}

export function DraftEditor({ draft, issues, onChange }: { draft: Json; issues: Issue[]; onChange: (d: Json) => void }) {
  const issueByPath = useMemo(() => {
    const m = new Map<string, Issue[]>()
    for (const i of issues) m.set(i.path, [...(m.get(i.path) ?? []), i])
    return m
  }, [issues])
  const hasIssueUnder = (prefix: string) => issues.some((i) => i.path === prefix || i.path.startsWith(prefix + '.'))
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const sections = (draft.sections as Json[] | undefined) ?? []
  const set = (path: string, v: unknown) => onChange(setPath(draft, path, v))
  const metaCls = 'mt-0.5 w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900'

  const topIssues = issues.filter((i) => !/^sections\.\d+/.test(i.path))
  return (
    <div className="flex flex-col gap-4 text-sm">
      {topIssues.length ? (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-3 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {topIssues.map((i, k) => (
            <p key={k}>
              ⚠ {i.path ? `${i.path}：` : ''}
              {i.message}
            </p>
          ))}
        </div>
      ) : null}
      <div className="grid gap-2 rounded-2xl border border-neutral-200 bg-white p-3 md:grid-cols-3 dark:border-neutral-800 dark:bg-neutral-900">
        {(
          [
            ['id', '试卷 id（英文短横线，保存后不可改）', 'text'],
            ['title', '标题', 'text'],
            ['year', '年份', 'number'],
            ['region', '地区', 'text'],
            ['durationMinutes', '考试时长（分钟）', 'number'],
            ['status', '状态（draft / published）', 'text'],
          ] as const
        ).map(([k, label, kind]) => (
          <label key={k}>
            <span className="text-neutral-500">{label}</span>
            {kind === 'number' ? (
              <NumberInput value={draft[k]} onChange={(v) => set(k, v)} cls={`${metaCls} ${issueByPath.has(k) ? 'border-red-500' : ''}`} />
            ) : (
              <input className={`${metaCls} ${issueByPath.has(k) ? 'border-red-500' : ''}`} value={String(draft[k] ?? '')} onChange={(e) => set(k, e.target.value)} />
            )}
          </label>
        ))}
        <p className="text-neutral-500 md:col-span-3">
          总分 {sections.reduce((n, s) => n + ((s.groups as Json[] | undefined) ?? []).reduce((m, g) => m + ((g.items as Json[] | undefined) ?? []).reduce((k, it) => k + (Number(it.score) || 0), 0), 0), 0)} 分（由各小题分值自动求和）
        </p>
      </div>

      {sections.map((sec, si) => {
        const sp = `sections.${si}`
        const groups = (sec.groups as Json[] | undefined) ?? []
        const nItems = groups.reduce((n, g) => n + ((g.items as Json[] | undefined) ?? []).length, 0)
        const bad = hasIssueUnder(sp)
        const isOpen = open[sp] ?? bad
        return (
          <section key={sp} className={`rounded-2xl border bg-white dark:bg-neutral-900 ${bad ? 'border-red-400' : 'border-neutral-200 dark:border-neutral-800'}`}>
            <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left" onClick={() => setOpen({ ...open, [sp]: !isOpen })}>
              <span className="font-medium">
                {String(sec.code)} {String(sec.title)} <span className="text-neutral-400">· {ITEM_TYPE_LABEL[String(sec.itemType)] ?? String(sec.itemType)} · {nItems} 题 · 每题 {String(sec.scorePerItem)} 分</span>
              </span>
              <span className="text-neutral-400">{bad ? <span className="mr-2 text-red-600">有待确认</span> : null}{isOpen ? '收起' : '展开'}</span>
            </button>
            {isOpen ? (
              <div className="border-t border-neutral-100 px-3 pb-3 dark:border-neutral-800">
                {(issueByPath.get(sp) ?? []).map((i, k) => (
                  <p key={k} className="mt-2 text-red-600">
                    ⚠ {i.message}
                  </p>
                ))}
                <div className="mt-2 grid gap-2 md:grid-cols-4">
                  <label>
                    <span className="text-neutral-500">标题</span>
                    <input className={metaCls} value={String(sec.title ?? '')} onChange={(e) => set(`${sp}.title`, e.target.value)} />
                  </label>
                  <label>
                    <span className="text-neutral-500">题型</span>
                    <select className={metaCls} value={String(sec.itemType ?? '')} onChange={(e) => set(`${sp}.itemType`, e.target.value)}>
                      {TYPES.map((t) => (
                        <option key={t} value={t}>
                          {ITEM_TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="text-neutral-500">每题分值</span>
                    <NumberInput value={sec.scorePerItem} onChange={(v) => set(`${sp}.scorePerItem`, v)} cls={metaCls} />
                  </label>
                  <label className="md:col-span-4">
                    <span className="text-neutral-500">作答说明</span>
                    <textarea className={metaCls} rows={2} value={String(sec.instructions ?? '')} onChange={(e) => set(`${sp}.instructions`, e.target.value)} />
                  </label>
                </div>
                {groups.map((g, gi) => {
                  const gp = `${sp}.groups.${gi}`
                  const itemsList = (g.items as Json[] | undefined) ?? []
                  const stim = g.stimulus as Json | undefined
                  return (
                    <div key={gp} className={`mt-3 rounded-xl border p-2 ${hasIssueUnder(gp) ? 'border-red-300' : 'border-neutral-100 dark:border-neutral-800'}`}>
                      <p className="text-neutral-500">
                        题组 {String(g.order)} · {String(g.kind)}
                      </p>
                      {(issueByPath.get(gp) ?? []).map((i, k) => (
                        <p key={k} className="text-red-600">
                          ⚠ {i.message}
                        </p>
                      ))}
                      {stim ? (
                        <div className="mt-1 grid gap-2 md:grid-cols-4">
                          <label>
                            <span className="text-neutral-500">材料标题</span>
                            <input className={metaCls} value={String(stim.title ?? '')} onChange={(e) => set(`${gp}.stimulus.title`, e.target.value || undefined)} />
                          </label>
                          <label className="md:col-span-3">
                            <span className="text-neutral-500">材料正文</span>
                            <textarea className={metaCls} rows={4} value={String(stim.body ?? '')} onChange={(e) => set(`${gp}.stimulus.body`, e.target.value)} />
                          </label>
                        </div>
                      ) : null}
                      {typeof g.frame === 'string' ? (
                        <label className="mt-1 block">
                          <span className="text-neutral-500">框架（{'{{n}}'} 为第 n 题空位）</span>
                          <textarea className={metaCls} rows={4} value={g.frame} onChange={(e) => set(`${gp}.frame`, e.target.value)} />
                        </label>
                      ) : null}
                      {itemsList.map((it, ii) => {
                        const ip = `${gp}.items.${ii}`
                        const type = String(it.type)
                        const itemBad = hasIssueUnder(ip)
                        const fields = [...(FIELDS[type] ?? []), ...COMMON]
                        return (
                          <div key={ip} className={`mt-2 rounded-lg border p-2 ${itemBad ? 'border-red-400 bg-red-50/40 dark:bg-red-950/20' : 'border-neutral-200 dark:border-neutral-700'}`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="flex items-center gap-1">
                                题号
                                <NumberInput value={it.number} onChange={(v) => set(`${ip}.number`, v)} cls={`w-16 rounded-lg border px-2 py-0.5 dark:bg-neutral-900 ${issueByPath.has(`${ip}.number`) ? 'border-red-500' : 'border-neutral-300 dark:border-neutral-700'}`} />
                              </label>
                              <label className="flex items-center gap-1">
                                题型
                                <select className="rounded-lg border border-neutral-300 px-2 py-0.5 dark:border-neutral-700 dark:bg-neutral-900" value={type} onChange={(e) => set(`${ip}.type`, e.target.value)}>
                                  {TYPES.map((t) => (
                                    <option key={t} value={t}>
                                      {ITEM_TYPE_LABEL[t]}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="flex items-center gap-1">
                                分值
                                <NumberInput value={it.score} onChange={(v) => set(`${ip}.score`, v)} cls="w-16 rounded-lg border border-neutral-300 px-2 py-0.5 dark:border-neutral-700 dark:bg-neutral-900" />
                              </label>
                            </div>
                            {issues
                              .filter((i) => i.path === ip || i.path.startsWith(ip + '.'))
                              .map((i, k) => (
                                <p key={k} className="mt-1 text-red-600">
                                  ⚠ {i.path.slice(ip.length + 1) || '本题'}：{i.message}
                                </p>
                              ))}
                            <div className="mt-1 grid gap-2 md:grid-cols-2">
                              {fields.map((f) => (
                                <label key={f.path} className={f.kind === 'textarea' || f.kind === 'list' || f.kind === 'json' ? 'md:col-span-2' : ''}>
                                  <span className="text-neutral-500">{f.label}</span>
                                  <FieldInput kind={f.kind} value={getPath(it, f.path)} bad={issues.some((i) => i.path === `${ip}.${f.path}` || i.path.startsWith(`${ip}.${f.path}.`))} onChange={(v) => set(`${ip}.${f.path}`, v)} />
                                </label>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
