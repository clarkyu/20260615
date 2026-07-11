// R2 multipart 的 XML 解析纯函数:UploadId 提取、ListParts 的 PartNumber/ETag 配对与排序。
import { describe, expect, it } from 'vitest'
import { parseUploadId, parseListedParts } from '../storage'

describe('parseUploadId', () => {
  it('取 InitiateMultipartUploadResult 里的 UploadId;缺失回 null', () => {
    expect(parseUploadId('<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><UploadId>abc-123</UploadId></InitiateMultipartUploadResult>')).toBe('abc-123')
    expect(parseUploadId('<Error><Code>NoSuchBucket</Code></Error>')).toBeNull()
  })
})

describe('parseListedParts', () => {
  it('配对 PartNumber/ETag,按 part 升序;实体引号还原;坏行剔除', () => {
    const xml =
      '<ListPartsResult>' +
      '<Part><PartNumber>2</PartNumber><ETag>&quot;e2&quot;</ETag><Size>8388608</Size></Part>' +
      '<Part><PartNumber>1</PartNumber><ETag>"e1"</ETag><Size>8388608</Size></Part>' +
      '</ListPartsResult>'
    expect(parseListedParts(xml)).toEqual([
      { partNumber: 1, etag: '"e1"' },
      { partNumber: 2, etag: '"e2"' },
    ])
    expect(parseListedParts('<ListPartsResult></ListPartsResult>')).toEqual([])
  })
})
