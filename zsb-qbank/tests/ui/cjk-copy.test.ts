import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// 硬约束 8:中文界面文案使用全角标点，中英文之间加空格。
//
// 这条以前从没被检查过。2026-09-17 第一次扫，UI 里有 18 处半角标点 —— 其中
// 「刚写的还没传上去,等网络好一点再对答案。」是我自己在 #486 加的。纯机械可检的东西
// 靠人眼盯不住，所以放进 CI。
//
// **管的是「界面」**，以下不算，扫描时排除：
//   · `src/lib/ai/**`、`src/lib/import/ai.ts` —— 发给 AI 的提示词，不是给人看的
//   · `console.*` 的日志行 —— 运维看的
//   · 注释 —— 不会渲染
//   · 配置默认值（如逗号分隔的组名列表）—— 不在 app/ components/ 下，自然排除

const SRC = join(process.cwd(), 'src')
const CJK_RE = /[一-鿿]/

function uiFiles(): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(p)) out.push(p)
    }
  }
  // 只有这两处是「界面」
  for (const d of ['app', 'components']) walk(join(SRC, d))
  return out
}

/** 注释不会渲染，先剥掉。 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

interface Hit {
  file: string
  line: number
  text: string
  why: string
}

function scan(): Hit[] {
  const hits: Hit[] = []
  for (const file of uiFiles()) {
    const rel = file.replace(SRC + '/', '')
    stripComments(readFileSync(file, 'utf8'))
      .split('\n')
      .forEach((line, i) => {
        if (line.includes('console.')) return // 日志不是界面文案
        const texts: string[] = []
        // 字符串字面量
        for (const m of line.matchAll(/'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g)) {
          const v = m[1] ?? m[2] ?? m[3] ?? ''
          if (CJK_RE.test(v)) texts.push(v)
        }
        // JSX 文本（>这里<）
        for (const m of line.matchAll(/>([^<>{}]*[一-鿿][^<>{}]*)</g)) texts.push(m[1]!)

        for (const text of texts) {
          const why: string[] = []
          // 半角标点贴着汉字
          for (const m of text.matchAll(/[一-鿿]([,;:!?])|([,;:!?])[一-鿿]/g)) {
            why.push(`半角标点「${m[1] ?? m[2]}」应为全角`)
          }
          // 包着中文的半角括号
          if (/[一-鿿]\(|\)[一-鿿]/.test(text)) why.push('半角括号应为全角')
          // 中英文之间要有空格（数字同理：「还有3题」应作「还有 3 题」）
          for (const m of text.matchAll(/[一-鿿][A-Za-z0-9]|[A-Za-z0-9][一-鿿]/g)) {
            why.push(`中英文之间缺空格「${m[0]}」`)
          }
          if (why.length) hits.push({ file: rel, line: i + 1, text: text.slice(0, 50), why: [...new Set(why)].join('、') })
        }
      })
  }
  return hits
}

describe('硬约束 8:中文界面文案', () => {
  it('扫得到东西（别让这条用例变成空转）', () => {
    // 没扫到任何中文文案 = 扫描器坏了或路径错了，那下面那条「零违规」就毫无意义。
    const files = uiFiles()
    expect(files.length, '界面文件应当不止几个').toBeGreaterThan(50)
    const anyChinese = files.some((f) => CJK_RE.test(stripComments(readFileSync(f, 'utf8'))))
    expect(anyChinese, '界面里应当有中文文案可扫').toBe(true)
  })

  it('全角标点、中英文之间留空格', () => {
    const hits = scan()
    const report = hits.map((h) => `${h.file}:${h.line}  ${JSON.stringify(h.text)}\n    → ${h.why}`).join('\n')
    expect(hits, `违反硬约束 8 的界面文案：\n${report}`).toEqual([])
  })
})
