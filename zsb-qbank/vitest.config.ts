import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // 集成用例共用同一个真库与同一张 ai_jobs 队列:并行跑不同文件时,一个文件的 processAiJobs
    // 会把另一个文件刚入队的任务领走(FOR UPDATE SKIP LOCKED 本就不区分来源),断言随机失败。
    // 文件级串行(单文件内仍并发)即可消除;整套只跑几秒,代价可以忽略。
    fileParallelism: false,
  },
})
