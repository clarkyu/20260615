import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// 运维脚本的两道门。这两条都不是理论上的隐患,是 2026-09-17 在本机实测出来的:
//
//   · `./scripts/restore.sh <dump>` 少给目标库 = 拿旧备份覆盖生产(pg_restore 带 --clean),
//     实测 6 行作答 → 恢复后 3 行,备份之后的全没,无确认(D81)。
//   · `.env` 会盖掉调用方传进来的环境变量,于是 `verify-restore.sh` 引不动 `BACKUP_DIR`,
//     整条恢复演练在**有 .env 的机器上**必然失败 —— 而 CI 没有 .env,所以一直全绿(D82)。
//
// 这里不连数据库:两道门都在碰库之前就该拦住,拦不住才是缺陷。

const ROOT = resolve(__dirname, '..', '..')

function run(script: string, args: string[], env: Record<string, string>) {
  try {
    const stdout = execFileSync(join(ROOT, 'scripts', script), args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, stdout, stderr: '' }
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

describe('restore.sh:不许一不小心盖掉生产库(D81)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zsb-restore-'))
  const dump = join(dir, 'fake.dump')
  writeFileSync(dump, 'not a real dump')
  const LIVE = 'postgres://zsb:pw@127.0.0.1:5432/zsb_qbank'

  // 点名这一句而不是泛泛的「拒绝执行」:把默认值(TARGET 回落 DATABASE_URL)加回去之后,
  // 第二道门照样会拦住,数据仍然安全 —— 但那时拦它的理由变成了「目标库就是生产」。
  // 只断言「被拒了」的用例分辨不出这两种情形,等于没在验第一道门(D72)。
  it('不给目标库 → 被第一道门以「没有给目标库」拒掉', () => {
    const r = run('restore.sh', [dump], { DATABASE_URL: LIVE })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('没有给目标库')
  })

  it('目标库就是 DATABASE_URL 那个、又没加 --force → 拒绝', () => {
    const r = run('restore.sh', [dump, LIVE], { DATABASE_URL: LIVE })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('同一个库')
  })

  it('目标是另一个库 → 放行(否则这两道门就是把正常恢复也堵死了)', () => {
    const r = run('restore.sh', [dump, 'postgres://zsb:pw@127.0.0.1:5432/zsb_restore_test'], { DATABASE_URL: LIVE })
    // 放行之后会死在 pg_restore(这份 dump 是假的)——那不重要,重要的是没被门拦下
    expect(r.stderr).not.toContain('拒绝执行')
    expect(r.stdout + r.stderr).toContain('[restore] 从')
  })

  it('连备份文件都不存在时,报的是找不到文件,不是别的', () => {
    const r = run('restore.sh', [join(dir, '没有这个.dump'), LIVE], { DATABASE_URL: LIVE })
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('找不到备份文件')
  })

  // 清理放 afterAll:写在 describe 体里会在收集阶段就执行,用例还没跑文件就没了
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
})

describe('.env 只当默认值,调用方传的环境变量优先(D82)', () => {
  /** 在一个带 .env 的临时目录里 source 加载器,看最后的取值。 */
  function load(callerEnv: Record<string, string>): Record<string, string> {
    const dir = mkdtempSync(join(tmpdir(), 'zsb-env-'))
    writeFileSync(join(dir, '.env'), 'DATABASE_URL=来自env\nBACKUP_DIR=./backups\nKEEP_DAYS=14\n')
    try {
      const out = execFileSync(
        'bash',
        ['-c', `. ${JSON.stringify(join(ROOT, 'scripts', '_env.sh'))}; echo "$DATABASE_URL|$BACKUP_DIR|$KEEP_DAYS"`],
        { cwd: dir, env: { ...process.env, DATABASE_URL: '', BACKUP_DIR: '', KEEP_DAYS: '', ...callerEnv }, encoding: 'utf-8' },
      )
      const [db, bak, keep] = out.trim().split('|')
      return { DATABASE_URL: db!, BACKUP_DIR: bak!, KEEP_DAYS: keep! }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('没传就回落到 .env', () => {
    expect(load({})).toEqual({ DATABASE_URL: '来自env', BACKUP_DIR: './backups', KEEP_DAYS: '14' })
  })

  it('传了就用传的 —— verify-restore.sh 把备份引到临时目录靠的就是这条', () => {
    const got = load({ BACKUP_DIR: '/tmp/演练用', DATABASE_URL: '来自调用方' })
    expect(got.BACKUP_DIR).toBe('/tmp/演练用')
    expect(got.DATABASE_URL).toBe('来自调用方')
    expect(got.KEEP_DAYS).toBe('14') // 没传的仍回落 .env
  })
})
