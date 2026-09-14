import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { MAX_INFLATED_BYTES, summarizeZip } from '@/lib/import/zip-check'

// 上传前的 zip 体检:读中央目录得到解压后总量与 document.xml 是否存在,不解压。

function makeZip(entries: Array<{ name: string; data: Buffer; fakeUncompressed?: number }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const comp = deflateRawSync(e.data)
    const name = Buffer.from(e.name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(e.fakeUncompressed ?? e.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const lb = Buffer.concat([local, name, comp])
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(comp.length, 20)
    central.writeUInt32LE(e.fakeUncompressed ?? e.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, name]))
    locals.push(lb)
    offset += lb.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

describe('summarizeZip', () => {
  it('真实 docx:有 word/document.xml,解压总量在限内', () => {
    const buf = readFileSync(join(process.cwd(), 'seed', 'raw', '001_2025年湖北专升本真题.docx'))
    const z = summarizeZip(buf)!
    expect(z.hasDocumentXml).toBe(true)
    expect(z.entries).toBeGreaterThan(3)
    expect(z.inflatedBytes).toBeGreaterThan(1000)
    expect(z.inflatedBytes).toBeLessThan(MAX_INFLATED_BYTES)
  })
  it('自造 zip:条目与解压总量正确;缺 document.xml 能识别', () => {
    const z = summarizeZip(makeZip([{ name: 'word/document.xml', data: Buffer.from('<w:p>hi</w:p>') }, { name: 'a.txt', data: Buffer.alloc(1000, 65) }]))!
    expect(z).toMatchObject({ entries: 2, hasDocumentXml: true, inflatedBytes: 13 + 1000 })
    expect(summarizeZip(makeZip([{ name: 'x.xml', data: Buffer.from('x') }]))!.hasDocumentXml).toBe(false)
  })
  it('zip bomb:中央目录声称的解压后大小超限即可拒绝,无需解压', () => {
    // 3.9 GB 的声明值(32 位字段上限内)与 zip64 哨兵 0xFFFFFFFF 都应判超限
    const z = summarizeZip(makeZip([{ name: 'word/document.xml', data: Buffer.alloc(100, 32), fakeUncompressed: 0xf0000000 }]))!
    expect(z.inflatedBytes).toBeGreaterThan(MAX_INFLATED_BYTES)
    const z64 = summarizeZip(makeZip([{ name: 'word/document.xml', data: Buffer.alloc(100, 32), fakeUncompressed: 0xffffffff }]))!
    expect(z64.inflatedBytes).toBeGreaterThan(MAX_INFLATED_BYTES)
  })
  it('不是 zip 返回 null', () => {
    expect(summarizeZip(Buffer.from('PK not really a zip file at all'))).toBeNull()
    expect(summarizeZip(Buffer.alloc(0))).toBeNull()
  })
})
