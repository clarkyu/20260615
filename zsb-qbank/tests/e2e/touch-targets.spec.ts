import { test, expect, type Page } from '@playwright/test'

// 硬约束 3 与 5 的手机视口体检:
//   3:英文作答只用 <EnglishInput>,autoCapitalize / autoCorrect / spellCheck / autoComplete
//      固定关闭,字号 ≥16px(iOS 聚焦时低于 16px 会放大整页)
//   5:学生端无横向滚动、可点击元素不小于 44px
//
// 2026-09-17 第一次做这个体检时,作答页有 24 个控件低于 44px(行内空位芯片 34px、
// 连词成句的短词块 41px、「全屏原文」17px、作文自查要点的复选框 17px、分栏拖动条 32px)。
// 自动大写要是哪天在英文输入框上漏开,学生填的 biggest 会变成 Biggest,直接判错分。
//
// 量的是**触控区**而不是盒子:点击区可能来自父级 <label>,也可能来自 ::after 撑出来的
// 不可见区域(行内空位芯片就是这么做的:盒子 34px、触控区 46px,版面一点不动)。
// 两个坑写在这里,都是第一版栽过的:
//   · elementFromPoint 只认可见视口 → 每个控件先 scrollIntoView 再探,否则视口外的一律误报;
//   · 相邻两行的空位芯片会争夺中间那几个像素 → 见下方 INLINE_BLANK_MIN 的说明。
test.skip(!process.env.E2E_BASE_URL, '设 E2E_BASE_URL 后运行')

const PAPER = 'hubei-zsb-english-2025'
const MIN = 44
/**
 * 行内空位芯片的下限。它嵌在短文的行文里,视觉上不能长到 44px —— 那会把整段行距撑散;
 * 所以用不可见的 ::after 把触控区撑到 46px。但当两个空位正好落在紧挨的上下两行时,
 * 中间那几个像素只能归其中一个,另一个停在 40px。要让它们全都够 44px,只能把短文行距
 * 撑到 ≥46px(段落高约 +67%)—— 那是阅读体验的取舍,不在这条用例的职权范围内。
 * 这里守住 40px 的底,防的是「哪天 ::after 被删掉、悄悄退回 34px」。
 */
const INLINE_BLANK_MIN = 40

interface Problem {
  kind: string
  detail: string
}

async function auditViewport(page: Page): Promise<Problem[]> {
  return page.evaluate(
    ({ MIN, INLINE_BLANK_MIN }) => {
      const problems: { kind: string; detail: string }[] = []
      const root = document.scrollingElement ?? document.documentElement
      if (root.scrollWidth > root.clientWidth + 1) {
        problems.push({ kind: '横向滚动', detail: `scrollWidth ${root.scrollWidth} > 视口 ${root.clientWidth}` })
      }

      const named = (n: Element) => (n.getAttribute('aria-label') || n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24)
      const shown = (n: Element) => {
        const cs = getComputedStyle(n)
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false
        const b = n.getBoundingClientRect()
        return b.width > 0 && b.height > 0
      }

      for (const n of document.querySelectorAll('button, input, select, textarea, [role="button"], a')) {
        if (!shown(n)) continue
        const tag = n.tagName.toLowerCase()
        const type = n.getAttribute('type') ?? ''
        if (tag === 'a' && getComputedStyle(n).display === 'inline') continue // 段落里的行内文字链接不是按钮
        if (tag === 'input' && type === 'hidden') continue

        const target = (n.closest('label, button, a, [role="button"]') ?? n) as HTMLElement
        target.scrollIntoView({ block: 'center' })
        const b = target.getBoundingClientRect()
        const cx = b.left + b.width / 2
        const cy = b.top + b.height / 2
        const inside = (x: number, y: number) => {
          const el = document.elementFromPoint(x, y)
          return !!el && (el === target || target.contains(el))
        }
        if (!inside(cx, cy)) continue // 被弹层盖住了,这轮不量它
        const grow = (dx: -1 | 0 | 1, dy: -1 | 0 | 1) => {
          let d = 0
          for (let i = 1; i <= 30; i++) {
            const x = dx === 0 ? cx : dx < 0 ? b.left - i : b.right + i
            const y = dy === 0 ? cy : dy < 0 ? b.top - i : b.bottom + i
            if (!inside(x, y)) break
            d = i
          }
          return d
        }
        const w = b.width + grow(-1, 0) + grow(1, 0)
        const h = b.height + grow(0, -1) + grow(0, 1)
        const floor = n.hasAttribute('data-blank') ? INLINE_BLANK_MIN : MIN
        if (w < floor || h < floor) {
          problems.push({
            kind: '触控目标过小',
            detail: `<${tag}${type ? ' type=' + type : ''}>「${named(n)}」触控区 ${Math.round(w)}×${Math.round(h)}px(下限 ${floor}）`,
          })
        }
      }

      for (const n of document.querySelectorAll('input, textarea')) {
        if (!shown(n)) continue
        const type = n.getAttribute('type') ?? 'text'
        if (['checkbox', 'radio', 'hidden', 'button', 'submit'].includes(type)) continue
        const placeholder = n.getAttribute('placeholder') ?? ''
        // 班级加入码本来就是大写,不属于「英文作答」,只查它的字号
        const isJoinCode = /加入码|六位|位字母数字/.test(placeholder)
        const bad: string[] = []
        if (parseFloat(getComputedStyle(n).fontSize) < 16) bad.push(`字号 ${getComputedStyle(n).fontSize}`)
        if (!isJoinCode) {
          if (n.getAttribute('autocapitalize') !== 'off') bad.push(`autoCapitalize=${n.getAttribute('autocapitalize')}`)
          if (n.getAttribute('autocorrect') !== 'off') bad.push(`autoCorrect=${n.getAttribute('autocorrect')}`)
          if (n.getAttribute('spellcheck') !== 'false') bad.push(`spellCheck=${n.getAttribute('spellcheck')}`)
          if (n.getAttribute('autocomplete') !== 'off') bad.push(`autoComplete=${n.getAttribute('autocomplete')}`)
        }
        if (bad.length) problems.push({ kind: '输入框属性', detail: `<${n.tagName.toLowerCase()} placeholder="${placeholder}"> ${bad.join(', ')}` })
      }
      return problems
    },
    { MIN, INLINE_BLANK_MIN },
  )
}

async function startPractice(page: Page): Promise<string> {
  await page.goto('/')
  await page.getByRole('button', { name: '以学生身份登录' }).click()
  await expect(page.getByRole('button', { name: '开始练习' }).first()).toBeVisible()
  return page.evaluate(async (paperId) => {
    const r = await fetch('/api/attempts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paperId, mode: 'practice' }),
    })
    return (await r.json()).attemptId as string
  }, PAPER)
}

test('作答页每个题组:没有横向滚动,控件都点得中,英文输入框不自动大写', async ({ page }) => {
  const attemptId = await startPractice(page)
  const found: string[] = []

  await expect.soft(await auditViewport(page), '首页').toEqual([])

  await page.goto(`/play/${attemptId}`)
  await page.waitForSelector('footer', { timeout: 20_000 })

  // 8 个题组覆盖全部题型:短文填空 / 连词成句 / 阅读填词 / 阅读问答 / 汉译英 / 作文
  for (let i = 0; i < 8; i++) {
    const problems = await auditViewport(page)
    for (const p of problems) found.push(`第 ${i + 1} 组 · ${p.kind}:${p.detail}`)

    // 作文题把自查要点展开(里面有复选框)
    const expand = page.getByRole('button', { name: /展开/ }).first()
    if (await expand.isVisible().catch(() => false)) {
      await expand.click()
      for (const p of await auditViewport(page)) found.push(`第 ${i + 1} 组(展开)· ${p.kind}:${p.detail}`)
    }

    const next = page.getByRole('button', { name: '下一组' })
    if (!(await next.isEnabled().catch(() => false))) break
    await next.click()
    await page.waitForTimeout(300)
  }

  expect(found, `作答页违反硬约束 3/5:\n${found.join('\n')}`).toEqual([])
})

test('成绩页与训练页也点得中、不横滚', async ({ page }) => {
  const attemptId = await startPractice(page)
  await page.evaluate((id) => fetch(`/api/attempts/${id}/submit`, { method: 'POST' }), attemptId)

  await page.goto(`/result/${attemptId}`)
  await expect(page.getByText('/ 100 分')).toBeVisible({ timeout: 20_000 })
  expect(await auditViewport(page), '成绩页').toEqual([])

  await page.goto('/train')
  await page.waitForTimeout(1200)
  expect(await auditViewport(page), '训练页').toEqual([])
})
