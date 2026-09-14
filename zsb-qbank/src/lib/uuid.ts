// 路径 / 入参里的 id 先验形状再查库:Postgres 对畸形 uuid 抛 22P02(→ 500),这里提前挡成 404 / 400。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}
