// 媒体探针(一次性诊断,期末考核复盘):
//
// 评阅队列里 400+ 个任务以「无法获取视频(404)」失败,但抽样的视频在浏览器里能播。
// 两种可能:①部分对象根本没落到 R2(上传中断,键空挂)——失败集中在长视频(平均
// ~2 分钟 vs 已评 ~40-60 秒)支持这个方向;②Worker 取件路径有 bug(对象在,Worker
// fetch 却 404)。本模块在 Worker 环境里(与评阅同款 presign+fetch 路径)逐个探测
// 待评行的视频对象,按「存在/缺失/其它」计数并按环节、时长分桶——一锤定音。
//
// 只读:对 R2 只发 Range: bytes=0-0 的 GET(等价 HEAD,签名兼容),不写任何库表。
// 报告不带对象键与学生信息,只有提交 id 与聚合数。

import type { PrismaClient } from '@prisma/client'
import * as submissions from '@/lib/repo/submissions'
import { presignDownload, storageConfigured } from '@/lib/storage'

// 探测一个对象,返回 HTTP 状态码;网络级失败(超时/断连)返回 0。
export type MediaProber = (key: string) => Promise<number>

const defaultProber: MediaProber = async (key) => {
  try {
    const url = await presignDownload(key)
    // GET+Range 而非 HEAD:presign 按 GET 签名,HEAD 会签名不匹配;bytes=0-0 只取 1 字节。
    const resp = await fetch(url, { headers: { range: 'bytes=0-0' }, signal: AbortSignal.timeout(10_000) })
    // 读掉/取消响应体,不让连接挂着。
    try { await resp.body?.cancel() } catch { /* 已消费/已关闭 */ }
    return resp.status
  } catch {
    return 0
  }
}

interface Tally { exists: number; missing: number }
const tally = (): Tally => ({ exists: 0, missing: 0 })

export interface MediaProbeSample { submissionId: number; phaseOrder: number; durationSec: number; status: string; httpStatus: number }

export type MediaProbeReport =
  | {
      ok: true
      scanned: number
      exists: number // 2xx(200/206)——对象在,能取到
      missing: number // 404——键空挂,对象不在
      other: Record<string, number> // 其它状态码(403 签名/权限、5xx、0=网络失败)
      byPhaseOrder: Record<string, Tally>
      byDuration: Record<'lt60' | 's60to120' | 'gt120', Tally>
      // 各 ≤5 条样本(仅提交 id 与聚合属性,无键无学生信息),供逐条追查
      samples: { missing: MediaProbeSample[]; unexpected: MediaProbeSample[] }
      // 还有更多目标时的续查游标(把它作为下一次调用的 afterId);null = 扫完
      nextAfterId: number | null
    }
  | { ok: false; error: string }

export async function probeSubmissionMedia(
  prisma: PrismaClient,
  schoolId: number,
  title: string,
  opts: { afterId?: number; limit?: number; probe?: MediaProber } = {},
): Promise<MediaProbeReport> {
  if (!opts.probe && !storageConfigured()) return { ok: false, error: 'storage is not configured' }
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 40) // Workers 免费档 ≤50 子请求/请求,探测一批封顶 40
  const probe = opts.probe ?? defaultProber

  const rows = await submissions.listMediaProbeTargets(prisma, schoolId, title, opts.afterId ?? 0, limit)
  if (rows.length === 0) return { ok: false, error: 'no probe targets for this school+title (from this cursor)' }

  let exists = 0
  let missing = 0
  const other: Record<string, number> = {}
  const byPhaseOrder: Record<string, Tally> = {}
  const byDuration: Record<'lt60' | 's60to120' | 'gt120', Tally> = { lt60: tally(), s60to120: tally(), gt120: tally() }
  const samples = { missing: [] as MediaProbeSample[], unexpected: [] as MediaProbeSample[] }

  for (const r of rows) {
    const httpStatus = await probe(r.videoKey as string)
    const sec = r.durationSec ?? 0
    const bucket = sec < 60 ? 'lt60' : sec <= 120 ? 's60to120' : 'gt120'
    const order = String(r.phase?.order ?? 0)
    byPhaseOrder[order] = byPhaseOrder[order] ?? tally()
    const sample: MediaProbeSample = { submissionId: r.id, phaseOrder: r.phase?.order ?? 0, durationSec: sec, status: r.status, httpStatus }
    if (httpStatus === 200 || httpStatus === 206) {
      exists++
      byPhaseOrder[order].exists++
      byDuration[bucket].exists++
    } else if (httpStatus === 404) {
      missing++
      byPhaseOrder[order].missing++
      byDuration[bucket].missing++
      if (samples.missing.length < 5) samples.missing.push(sample)
    } else {
      other[String(httpStatus)] = (other[String(httpStatus)] ?? 0) + 1
      if (samples.unexpected.length < 5) samples.unexpected.push(sample)
    }
  }

  return {
    ok: true,
    scanned: rows.length,
    exists,
    missing,
    other,
    byPhaseOrder,
    byDuration,
    samples,
    nextAfterId: rows.length === limit ? rows[rows.length - 1].id : null,
  }
}
