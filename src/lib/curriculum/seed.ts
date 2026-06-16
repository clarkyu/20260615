import type { ItemMeta } from './taxonomy'

// ─────────────────────────────────────────────────────────────────────────────
// First content batch (Phase 1 vertical slice): English · Speaking ·
// Pronunciation + Shadowing · Pre-A1 → A2 · with Chinese (zh) + Spanish (es) L1
// overlays. Hand-authored to set the quality bar + lock the typed format before
// scaling. Payloads are polymorphic by itemType; metadata is shared (ItemMeta).
// ─────────────────────────────────────────────────────────────────────────────

export type ModelAudio = 'tts-slow' | 'tts' | 'recorded'

// Localizable scaffolding (target English content stays L1-agnostic).
export interface Scaffold {
  // Short human title — used as the bank set name when imported as a starter pack.
  title: string
  instructions: { en: string; zh?: string; es?: string }
}

export interface PronunciationDrillItem extends ItemMeta, Scaffold {
  itemType: 'pronunciation-drill'
  payload: {
    targetFeature: string
    lines: { text: string; ipa?: string }[]
    minimalPairs?: [string, string][]
    modelAudio: ModelAudio
  }
}

export interface ShadowingItem extends ItemMeta, Scaffold {
  itemType: 'shadowing'
  payload: {
    lines: { text: string; gloss?: { zh?: string; es?: string } }[]
    modelAudio: ModelAudio
  }
}

export type SeedItem = PronunciationDrillItem | ShadowingItem

export const SEED_ITEMS: SeedItem[] = [
  // ── Pre-A1 ────────────────────────────────────────────────────────────────
  {
    id: 'en.spk.pron.prea1.letter-sounds-1',
    title: 'Pre-A1 发音 · 字母音 b / p / m / s / t',
    subject: 'english',
    strand: 'english.speaking.pronunciation',
    itemType: 'pronunciation-drill',
    cefr: 'pre-a1',
    domain: 'general',
    canDo: '能辨认并读出 5 个常见首辅音字母的音。',
    tags: ['letter-sound'],
    assessment: 'ai-speaking',
    source: 'original',
    status: 'draft',
    instructions: {
      en: 'Listen, then say each sound. Keep it short and clear.',
      zh: '先听范读，再逐个跟读，短而清楚。',
      es: 'Escucha y repite cada sonido, corto y claro.',
    },
    payload: {
      targetFeature: 'letter-sound',
      modelAudio: 'tts-slow',
      lines: [
        { text: 'b — ball', ipa: '/b/' },
        { text: 'p — pen', ipa: '/p/' },
        { text: 'm — map', ipa: '/m/' },
        { text: 's — sun', ipa: '/s/' },
        { text: 't — top', ipa: '/t/' },
      ],
    },
  },
  {
    id: 'en.spk.shadow.prea1.greetings',
    title: 'Pre-A1 跟读 · 问候 Greetings',
    subject: 'english',
    strand: 'english.speaking.shadowing',
    itemType: 'shadowing',
    cefr: 'pre-a1',
    domain: 'general',
    subTheme: '社交',
    canDo: '能用最基本的问候语打招呼。',
    tags: ['word-stress'],
    assessment: 'ai-speaking',
    source: 'original',
    status: 'draft',
    instructions: { en: 'Shadow each line right after the model.', zh: '紧跟范读逐句跟读。', es: 'Imita cada línea justo después del modelo.' },
    payload: {
      modelAudio: 'tts',
      lines: [
        { text: 'Hello.', gloss: { zh: '你好。', es: 'Hola.' } },
        { text: 'Good morning.', gloss: { zh: '早上好。', es: 'Buenos días.' } },
        { text: 'How are you?', gloss: { zh: '你好吗？', es: '¿Cómo estás?' } },
        { text: "I'm fine, thank you.", gloss: { zh: '我很好，谢谢。', es: 'Estoy bien, gracias.' } },
      ],
    },
  },

  // ── A1 ──────────────────────────────────────────────────────────────────────
  {
    id: 'en.spk.pron.a1.vowel-length-ship-sheep',
    title: 'A1 发音 · 短/长元音 /ɪ/–/iː/ (ship–sheep)',
    subject: 'english',
    strand: 'english.speaking.pronunciation',
    itemType: 'pronunciation-drill',
    cefr: 'a1',
    domain: 'general',
    canDo: '能区分并读出短元音 /ɪ/ 与长元音 /iː/。',
    tags: ['vowel-length'],
    l1Trouble: [
      { l1: 'zh', note: '汉语元音长短不区别意义，易把 /ɪ/ 读成 /iː/。' },
      { l1: 'es', note: '西语只有一个 /i/，易混 /ɪ/ 与 /iː/。' },
    ],
    assessment: 'ai-speaking',
    source: 'original',
    status: 'draft',
    instructions: { en: 'Feel the difference: /ɪ/ short, /iː/ long. Say each pair.', zh: '体会区别：/ɪ/ 短，/iː/ 长。逐对跟读。', es: 'Nota la diferencia: /ɪ/ corta, /iː/ larga.' },
    payload: {
      targetFeature: 'vowel-length',
      modelAudio: 'tts-slow',
      minimalPairs: [['ship', 'sheep'], ['it', 'eat'], ['sit', 'seat'], ['live', 'leave']],
      lines: [
        { text: "It's a big ship.", ipa: '/ɪ/' },
        { text: 'I can see three sheep.', ipa: '/iː/' },
        { text: 'Please sit on this seat.', ipa: '/ɪ … iː/' },
      ],
    },
  },
  {
    id: 'en.spk.shadow.a1.introductions',
    title: 'A1 跟读 · 自我介绍 Introductions',
    subject: 'english',
    strand: 'english.speaking.shadowing',
    itemType: 'shadowing',
    cefr: 'a1',
    domain: 'general',
    subTheme: '社交',
    canDo: '能进行最简单的自我介绍问答。',
    tags: ['sentence-stress'],
    assessment: 'ai-speaking',
    source: 'original',
    status: 'draft',
    instructions: { en: 'Shadow the conversation. Stress the underlined words.', zh: '跟读对话，重读关键词。', es: 'Imita la conversación; acentúa las palabras clave.' },
    payload: {
      modelAudio: 'tts',
      lines: [
        { text: "What's your name?", gloss: { zh: '你叫什么名字？', es: '¿Cómo te llamas?' } },
        { text: 'My name is Anna.', gloss: { zh: '我叫安娜。', es: 'Me llamo Anna.' } },
        { text: 'Where are you from?', gloss: { zh: '你来自哪里？', es: '¿De dónde eres?' } },
        { text: "I'm from Spain.", gloss: { zh: '我来自西班牙。', es: 'Soy de España.' } },
      ],
    },
  },

  // ── A2 ──────────────────────────────────────────────────────────────────────
  {
    id: 'en.spk.pron.a2.th-fricatives',
    title: 'A2 发音 · 齿间音 /θ/–/ð/ (think–this)',
    subject: 'english',
    strand: 'english.speaking.pronunciation',
    itemType: 'pronunciation-drill',
    cefr: 'a2',
    domain: 'general',
    canDo: '能正确发出齿间擦音 /θ/ 与 /ð/。',
    tags: ['th-fricatives'],
    l1Trouble: [
      { l1: 'zh', note: '汉语无齿间音，/θ/→/s/ 或 /f/，/ð/→/z/ 或 /d/。把舌尖轻触上齿。' },
      { l1: 'es', note: '拉美西语无 /θ/，常以 /s/ 代替（seseo）。' },
    ],
    assessment: 'ai-speaking',
    source: 'original',
    status: 'draft',
    instructions: { en: 'Put your tongue lightly between your teeth.', zh: '舌尖轻轻放在上下齿之间。', es: 'Pon la lengua entre los dientes.' },
    payload: {
      targetFeature: 'th-fricatives',
      modelAudio: 'tts-slow',
      minimalPairs: [['think', 'sink'], ['three', 'tree'], ['they', 'day']],
      lines: [
        { text: 'Thank you. I think so.', ipa: '/θ/' },
        { text: 'This is the third one.', ipa: '/ð … θ/' },
        { text: 'They go there on Thursday.', ipa: '/ð … θ/' },
      ],
    },
  },
  {
    id: 'en.spk.pron.a2.final-consonants',
    title: 'A2 发音 · 词尾辅音与辅音丛',
    subject: 'english',
    strand: 'english.speaking.pronunciation',
    itemType: 'pronunciation-drill',
    cefr: 'a2',
    domain: 'general',
    canDo: '能清晰发出词尾辅音与常见辅音丛。',
    tags: ['final-consonants', 'consonant-clusters'],
    l1Trouble: [
      { l1: 'zh', note: '汉语少有词尾辅音，易脱落或加元音（work→worker 音）。读全词尾。' },
      { l1: 'es', note: '西语 s-辅音丛前易加 /e/（speak→“espeak”）。直接起音。' },
    ],
    assessment: 'ai-speaking',
    source: 'original',
    status: 'draft',
    instructions: { en: 'Finish the final sounds fully; do not add a vowel.', zh: '把词尾辅音发全，别加元音。', es: 'Pronuncia el final completo; no añadas vocal.' },
    payload: {
      targetFeature: 'final-consonants',
      modelAudio: 'tts-slow',
      lines: [
        { text: 'I worked and helped last week.', ipa: '/kt/ /pt/ /st/' },
        { text: 'She speaks English at school.', ipa: '/sp/ /ks/' },
        { text: 'The students asked good questions.', ipa: '/ts/ /skt/' },
      ],
    },
  },
  {
    id: 'en.spk.shadow.a2.directions',
    title: 'A2 跟读 · 问路指路 Directions',
    subject: 'english',
    strand: 'english.speaking.shadowing',
    itemType: 'shadowing',
    cefr: 'a2',
    domain: 'occupational',
    subTheme: '出行',
    canDo: '能询问与指示简单路线。',
    tags: ['linking', 'sentence-stress', 'intonation-fall'],
    l1Trouble: [{ l1: 'zh', note: '注意连读 get_to、on_your，别逐词断开。' }],
    assessment: 'ai-speaking',
    source: 'original',
    status: 'draft',
    instructions: { en: 'Shadow naturally; link the marked words.', zh: '自然跟读，连读标注处。', es: 'Imita con naturalidad; enlaza las palabras marcadas.' },
    payload: {
      modelAudio: 'tts',
      lines: [
        { text: 'Excuse me, how do I get to the station?', gloss: { zh: '打扰一下，去车站怎么走？', es: 'Perdón, ¿cómo llego a la estación?' } },
        { text: 'Go straight, then turn left at the coffee shop.', gloss: { zh: '直走，在咖啡店左转。', es: 'Sigue recto y gira a la izquierda en la cafetería.' } },
        { text: "It's on your right.", gloss: { zh: '就在你右边。', es: 'Está a tu derecha.' } },
        { text: 'Thank you very much!', gloss: { zh: '非常感谢！', es: '¡Muchas gracias!' } },
      ],
    },
  },
]
