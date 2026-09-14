// docx 是 zip:在交给 mammoth 解压前,从中央目录读出各条目的「解压后大小」总和,超限即拒——
// 防 zip bomb 把进程撑爆(几 MB 的 docx 里塞几 GB 的 document.xml)。纯函数,只读字节,不解压。

export const MAX_INFLATED_BYTES = 64 * 1024 * 1024

export interface ZipSummary {
  entries: number
  inflatedBytes: number
  hasDocumentXml: boolean
}

/** 解析 EOCD + 中央目录;不是 zip 或目录损坏返回 null。 */
export function summarizeZip(buf: Buffer): ZipSummary | null {
  // End of central directory:签名 0x06054b50,最长 22 + 65535 字节注释,从尾部往前找。
  const minEocd = 22
  if (buf.length < minEocd) return null
  let eocd = -1
  for (let i = buf.length - minEocd; i >= Math.max(0, buf.length - minEocd - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null
  const entries = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (cdOffset + cdSize > buf.length) return null
  let p = cdOffset
  let inflated = 0
  let hasDocumentXml = false
  for (let i = 0; i < entries; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null
    const uncompressed = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (name === 'word/document.xml') hasDocumentXml = true
    // 0xFFFFFFFF 表示 zip64:按超限处理(试卷 docx 不会用到)
    inflated += uncompressed === 0xffffffff ? Number.MAX_SAFE_INTEGER / 4 : uncompressed
    p += 46 + nameLen + extraLen + commentLen
  }
  return { entries, inflatedBytes: inflated, hasDocumentXml }
}
