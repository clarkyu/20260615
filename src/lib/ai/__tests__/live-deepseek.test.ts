import { describe, it, expect } from 'vitest'
import { deepseekJudge } from '@/lib/ai/providers/openai-compat'

// Real DeepSeek grading call. Runs only when DEEPSEEK_API_KEY is set:
//   DEEPSEEK_API_KEY=xxx npm test
const KEY = process.env.DEEPSEEK_API_KEY

describe.skipIf(!KEY)('DeepSeek judge — live', () => {
  it('grades a sample recitation and returns a numeric score + Chinese feedback', async () => {
    const result = await deepseekJudge.judge(
      {
        perception: {
          transcript: 'The early bird catches the worm. Actions speak louder than words.',
          perSentence: [
            { order: 1, spokenText: 'The early bird catches the worm.', completeness: 1, accuracy: 1 },
            { order: 2, spokenText: 'Actions speak louder than words.', completeness: 1, accuracy: 0.95 },
          ],
          pronunciationImpression: '发音清晰，流利度尚可',
          observations: { eyesClosed: true, readingSuspected: false, facePresent: true, continuousTake: true },
        },
        referenceSentences: [
          { order: 1, text: 'The early bird catches the worm.' },
          { order: 2, text: 'Actions speak louder than words.' },
        ],
        rubric: '完整度 50 分、准确度 30 分、发音 20 分。',
        maxScore: 100,
      },
      'deepseek-v4-flash',
    )
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.feedback.length).toBeGreaterThan(0)
    // eslint-disable-next-line no-console
    console.log('[DeepSeek live] score =', result.score, '| feedback =', result.feedback)
  }, 60000)
})
