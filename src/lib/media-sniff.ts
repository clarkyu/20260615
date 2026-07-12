// 媒体容器魔数嗅探(坏媒体即时拒收):对象在、有字节,不代表内容可评——上传中断/字节
// 错乱的文件到评阅时才被 Gemini 报「corrupt」,几天后被归档成缺交,学生蒙在鼓里。
// 提交定稿时读对象头部几十字节验容器魔数,当场识别「肯定不是媒体文件」的坏内容。
//
// 只认得录音/录像会真实产生的容器(MediaRecorder: webm/Chrome·Android、mp4/Safari·iOS;
// 兼容少数机型的 ogg/wav/mp3)。嗅探是**保守的一票否决**:魔数命中任何一种 → 放行;
// 全都不认识才判坏。判不了内容深层损坏(那仍靠评阅侧 permanent 分类兜底),但拦得住
// 全零/截断/垃圾字节这类最常见的上传坏死。纯函数,注入字节即可测。

export type MediaContainer = 'webm' | 'mp4' | 'ogg' | 'wav' | 'mp3' | 'unknown'

// 嗅探需要的最少头部字节数(WAVE 标记在 8–11,mp4 ftyp 在 4–7;取 16 留余量)。
export const SNIFF_BYTES = 16

const ascii = (bytes: Uint8Array, start: number, text: string): boolean => {
  if (bytes.length < start + text.length) return false
  for (let i = 0; i < text.length; i++) if (bytes[start + i] !== text.charCodeAt(i)) return false
  return true
}

export function sniffMediaContainer(bytes: Uint8Array): MediaContainer {
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm' // EBML(webm/mkv)
  if (ascii(bytes, 4, 'ftyp')) return 'mp4' // mp4/m4a/mov/3gp 家族
  if (ascii(bytes, 0, 'OggS')) return 'ogg'
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WAVE')) return 'wav'
  if (ascii(bytes, 0, 'ID3')) return 'mp3'
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3' // 无 ID3 的裸帧同步
  return 'unknown'
}
