import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from '../src/lib/db/client'
import { upsertPaper } from '../src/lib/db/import-paper'
import { paperSchema } from '../src/lib/schema/paper'

// 幂等导入种子试卷(SPEC M1):zod 校验(唯一事实来源)→ upsertPaper(事务内 upsert 试卷 +
// 整树重建子表)→ 断言结构计数。重复执行不产生重复记录;种子字段被删改时 zod 报出准确错误。

async function main() {
  const file = process.argv[2] ?? join(import.meta.dirname, '..', 'seed', 'paper-2025-hubei-english.json')
  const raw = JSON.parse(readFileSync(file, 'utf-8'))
  const parsed = paperSchema.safeParse(raw)
  if (!parsed.success) {
    console.error('种子文件未通过 schema 校验:')
    console.error(parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'))
    process.exit(1)
  }
  const paper = parsed.data
  const got = await upsertPaper(getDb(), paper)
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
