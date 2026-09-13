import { SEEDABLE_TEMPLATES_2025 } from './exam-hubei-2025'
import { SEEDABLE_TEMPLATES_2026 } from './exam-hubei-2026'
import type { SeedableTemplateEntry } from './exam-template-base'

// 全站可种子化模板注册表(seed-template 端点按 key 查找;key=all 全量种)。
// 各年份试卷在各自文件里维护条目,这里只做汇总;新试卷加一行 spread 即可。
// key 全站唯一(测试守卫),同校同名幂等更新——题目勘误后重跑 seed 即生效。
export const SEEDABLE_TEMPLATES: Record<string, SeedableTemplateEntry> = {
  ...SEEDABLE_TEMPLATES_2025,
  ...SEEDABLE_TEMPLATES_2026,
}
