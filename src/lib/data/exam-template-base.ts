import type { TemplatePayload, TemplatePhase } from '@/lib/assignment-template'

// 真题模板的公共基底:各年份试卷(exam-hubei-2025 / 2026 …)共用同一份环节默认值、
// 系列名与「题型分卷」构造器,保证同系列试卷在题库页/发布流程里口径一致。

export const EXAM_SERIES = '专升本英语'

// 环节默认值(主观环节直接展开;fillBlank 环节在此基础上覆写)。
export const PHASE_BASE = {
  category: '',
  useBankSet: false,
  sentences: '',
  requireEyesClosed: false,
  requireText: false,
  requireAudio: false,
  requireVideo: false,
  requireHandwriting: false,
  requireChoice: false,
  choicesJson: null,
  correctChoice: null,
  multiChoice: false,
  correctChoices: null,
  selectionMode: null,
  branchTopicsJson: null,
  fillBlank: false,
  blanksJson: null,
  requireFreeText: false,
  rubric: null,
  rubricPoints: [] as { name: string; points: number }[],
  perceptionModel: null,
  judgeModel: null,
  graded: true,
  maxAttempts: 1,
  weight: 1,
  isFormalTest: false,
  freePractice: false,
}

// 题型分卷(训练用):单题型成卷,可重做 3 次;题面/答案键与整卷同源。
export const drill = (title: string, phases: TemplatePhase[]): TemplatePayload => ({
  title,
  monthLabel: '',
  chunkSetId: null,
  phases: phases.map((p) => ({ ...p, maxAttempts: 3 })),
})

export type SeedableTemplateEntry = { name: string; series: string | null; payload: TemplatePayload }
