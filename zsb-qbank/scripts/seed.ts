import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from '../src/lib/db/client'
import { PaperHasResponsesError, responseCountOf, upsertPaper } from '../src/lib/db/import-paper'
import { paperSchema } from '../src/lib/schema/paper'

// 幂等导入种子试卷(SPEC M1):zod 校验(唯一事实来源)→ upsertPaper(事务内 upsert 试卷 +
// 整树重建子表)→ 断言结构计数。重复执行不产生重复记录;种子字段被删改时 zod 报出准确错误。
//
// 「幂等」只对**空库 / 无人作答**成立:整树重建会级联删掉这份试卷的全部学生作答。
// 所以库里已有作答时本脚本直接拒绝(D79),要强行重建得显式 --force。

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const file = args.find((a) => !a.startsWith('--')) ?? join(import.meta.dirname, '..', 'seed', 'paper-2025-hubei-english.json')
  const raw = JSON.parse(readFileSync(file, 'utf-8'))
  const parsed = paperSchema.safeParse(raw)
  if (!parsed.success) {
    console.error('种子文件未通过 schema 校验:')
    console.error(parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'))
    process.exit(1)
  }
  const paper = parsed.data
  const db = getDb()

  if (force) {
    const n = await responseCountOf(db, paper.id)
    if (n > 0) console.warn(`[seed] --force:即将整卷重建 ${paper.id},会删掉已有的 ${n} 条学生作答。`)
  }

  let got
  try {
    got = await upsertPaper(db, paper, { allowDestroyingResponses: force })
  } catch (e) {
    if (e instanceof PaperHasResponsesError) {
      console.error(`拒绝导入:${e.message}。`)
      console.error('  · 只是要改题干 / 答案:用教师端「题库 → 小题编辑」,小题 id 不变,作答与任务都不受影响。')
      console.error('  · 真要整卷重建:先 `pnpm backup`,再 `pnpm seed --force`(作答会被删除,不可撤销)。')
      console.error('  · 想并存两版:把种子文件里的 id 改成新的,另存一份试卷。')
      process.exit(1)
    }
    throw e
  }
  console.log('导入完成:', JSON.stringify({ paper: paper.id, sections: got.sections, groups: got.groups, items: got.items, scoreSum: got.scoreSum }))

  // 断言:1 份试卷、6 个大题、8 个题组、43 个小题、总分 100(SPEC M1 验收;仅样本卷,D6)。
  if (paper.id === 'hubei-zsb-english-2025') {
    const expect = { sections: 6, groups: 8, items: 43, scoreSum: 100 } as const
    for (const [k, v] of Object.entries(expect)) {
      if (got[k as keyof typeof expect] !== v) {
        console.error(`断言失败:${k} 期望 ${v},实际 ${got[k as keyof typeof expect]}`)
        process.exit(1)
      }
    }
    console.log('断言通过:1 份试卷、6 个大题、8 个题组、43 个小题、总分 100。')
  }
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
