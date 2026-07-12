import { describe, it, expect } from 'vitest'
import { sniffMediaContainer } from '../media-sniff'

const bytes = (...b: number[]) => new Uint8Array(b)
const asciiBytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))

describe('sniffMediaContainer', () => {
  it('recognises webm/mkv (EBML magic) — Chrome/Android MediaRecorder 的主产物', () => {
    expect(sniffMediaContainer(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81))).toBe('webm')
  })

  it('recognises the mp4/m4a family (ftyp at offset 4) — Safari/iOS 的主产物', () => {
    expect(sniffMediaContainer(asciiBytes('\0\0\0 ftypisom\0\0\x02\0'))).toBe('mp4')
    expect(sniffMediaContainer(asciiBytes('\0\0\0\x18ftyp3gp4'))).toBe('mp4')
  })

  it('recognises ogg / wav / mp3', () => {
    expect(sniffMediaContainer(asciiBytes('OggS\0\x02'))).toBe('ogg')
    expect(sniffMediaContainer(asciiBytes('RIFF\x24\x08\0\0WAVEfmt '))).toBe('wav')
    expect(sniffMediaContainer(asciiBytes('ID3\x03\0'))).toBe('mp3')
    expect(sniffMediaContainer(bytes(0xff, 0xfb, 0x90, 0x00))).toBe('mp3') // 裸帧同步
  })

  it('rejects all-zero, truncated, and garbage heads — 上传坏死的典型签名', () => {
    expect(sniffMediaContainer(new Uint8Array(16))).toBe('unknown') // 全零
    expect(sniffMediaContainer(bytes(0x1a, 0x45))).toBe('unknown') // 截断到魔数一半
    expect(sniffMediaContainer(asciiBytes('<html>oops</html>'))).toBe('unknown')
    expect(sniffMediaContainer(new Uint8Array(0))).toBe('unknown')
  })

  it('treats RIFF without WAVE as unknown — 只认 RIFF+WAVE 组合', () => {
    expect(sniffMediaContainer(asciiBytes('RIFF\x24\x08\0\0AVI LIST'))).toBe('unknown')
  })
})
