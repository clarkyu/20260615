// 「未归票作答」工作台的纯函数与行类型(评分页服务端组装、客户端渲染共用契约)。

// 一条未归票作答:最新一次提交(可归票)+ 历史提交(只读:各写了什么/当前归在哪)。
// text 是服务端截断后的展示文本(载荷上限,复查 R11);textLen 是原文长度,
// 与 text 合成聚组键——截断后相同、原文不同的长文不会误并成「相同作答」。
export interface UnmatchedRow {
  submissionId: number
  studentName: string
  studentNo: string
  text: string
  textLen: number
  history: { attempt: number; option: string | null; text: string }[]
}

// 相同作答聚组(按人数降序)——18 个「自我介绍」一组一次归完,不再逐条点。
// 组键 = 原文长度 + 截断文本:等长且前 400 字相同才算「相同作答」。key 一并返回,
// 供 React 作组卡 key(复查 R14:组的身份是「作答文本」,不是恰好排第一的那条提交)。
export function groupUnmatched(rows: UnmatchedRow[]): { key: string; text: string; rows: UnmatchedRow[] }[] {
  const m = new Map<string, UnmatchedRow[]>()
  for (const r of rows) {
    const key = `${r.textLen}:${r.text}`
    const a = m.get(key) ?? []
    a.push(r)
    m.set(key, a)
  }
  return [...m.entries()].map(([key, rs]) => ({ key, text: rs[0].text, rows: rs })).sort((a, b) => b.rows.length - a.rows.length)
}
