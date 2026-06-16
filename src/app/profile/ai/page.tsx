import Link from 'next/link'
import { ChevronLeft, Eye, Scale } from 'lucide-react'
import { requireStaff } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getT } from '@/lib/i18n-server'
import { MODELS, PROVIDER_LABELS, MODEL_PRICING, CREDENTIAL_SLOTS } from '@/lib/ai/registry'
import type { Provider, Capability } from '@/lib/ai/types'
import * as aiKeyRepo from '@/lib/repo/ai-keys'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AiKeySlot } from './ai-key-slot'

const CAP_LABEL: Record<Capability, { zh: string; en: string }> = {
  perception: { zh: '感知·看视频/听音频', en: 'Perceive' },
  judge: { zh: '评分·按标准打分', en: 'Judge' },
}
const MODALITY: Record<'text' | 'image' | 'audio' | 'video', { zh: string; en: string }> = {
  text: { zh: '文本', en: 'Text' },
  image: { zh: '图形', en: 'Image' },
  audio: { zh: '音频', en: 'Audio' },
  video: { zh: '视频', en: 'Video' },
}
// Provider display order: multimodal (grading) first, text/transcribe after.
const ORDER: Provider[] = ['gemini', 'qwen', 'openai', 'claude', 'deepseek', 'minimax', 'whisper']

export default async function AiModelsPage() {
  const user = await requireStaff()
  const prisma = await getDb()
  const { locale, t } = await getT()
  const zh = locale === 'zh'

  const configured = new Map((await aiKeyRepo.listForUser(prisma, user.userId)).map((k) => [k.provider, k.last4]))
  const providers = ORDER.filter((p) => MODELS.some((m) => m.provider === p))

  return (
    <div className="space-y-4 py-2">
      <Link href="/profile" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" />{zh ? '账户' : 'Account'}
      </Link>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{zh ? 'AI 模型目录' : 'AI Models'}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {zh
            ? '各家各模型的使用范围、支持的模态与价格。填入你自己的密钥即可各用各的、各付各账。'
            : 'Each provider’s models — scope, modalities and price. Add your own keys to use them on your own account.'}
        </p>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <p className="font-semibold">{t('ai.keysTitle')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('ai.keysHint')}</p>
          </div>
          <div className="space-y-2.5">
            {CREDENTIAL_SLOTS.map((s) => (
              <AiKeySlot key={s.id} id={s.id} label={s.label} help={s.help} last4={configured.get(s.id) ?? null} />
            ))}
          </div>
        </CardContent>
      </Card>

      {providers.map((provider) => {
        const models = MODELS.filter((m) => m.provider === provider)
        return (
          <Card key={provider}>
            <CardContent className="space-y-3 p-4">
              <p className="font-semibold">{PROVIDER_LABELS[provider]}</p>
              <div className="space-y-2.5">
                {models.map((m) => (
                  <div key={m.id} className="rounded-xl border border-border/60 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium leading-snug">{m.label}</span>
                      {m.capabilities.map((c) => (
                        <Badge key={c} tone="primary" className="gap-1">
                          {c === 'perception' ? <Eye className="h-3 w-3" /> : <Scale className="h-3 w-3" />}
                          {zh ? CAP_LABEL[c].zh : CAP_LABEL[c].en}
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {m.modalities.map((mod) => (
                        <span key={mod} className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                          {zh ? MODALITY[mod].zh : MODALITY[mod].en}
                        </span>
                      ))}
                    </div>
                    <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">{m.id}</p>
                    {MODEL_PRICING[m.id] ? <p className="mt-1 text-xs text-foreground/80">💰 {MODEL_PRICING[m.id]}</p> : null}
                    {m.note ? <p className="mt-1 text-xs text-muted-foreground">{m.note}</p> : null}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )
      })}

      <p className="px-1 text-xs text-muted-foreground">
        {zh
          ? '说明：「感知」= 看录像/听录音/转写；「评分」= 按评分标准打分。价格随时变动，以各家官网为准（汇率参考 1 USD≈¥6.76）。'
          : 'Prices change — verify on each provider’s site.'}
      </p>
    </div>
  )
}
