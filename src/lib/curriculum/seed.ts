import type { ItemMeta } from './taxonomy'

// ─────────────────────────────────────────────────────────────────────────────
// Content batch: English · Speaking · Pronunciation + Shadowing · Pre-A1 → C1 ·
// with Chinese (zh) + Spanish (es) L1 overlays. Hand-authored to set the quality
// bar + lock the typed format before scaling. Payloads are polymorphic by
// itemType; metadata is shared (ItemMeta). Higher bands (B1+) shift from segmental
// drills to suprasegmentals (stress, rhythm, intonation, connected speech) and to
// occupational / academic shadowing — the register a vocational college needs.
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

  // ── B1 ──────────────────────────────────────────────────────────────────────
  {
    id: 'en.spk.pron.b1.word-stress',
    title: 'B1 发音 · 词重音 Word stress',
    subject: 'english',
    strand: 'english.speaking.pronunciation',
    itemType: 'pronunciation-drill',
    cefr: 'b1',
    domain: 'general',
    canDo: '能在多音节词中正确放置重音，并掌握名/动重音转移。',
    tags: ['word-stress'],
    l1Trouble: [
      { l1: 'zh', note: '汉语逐字等重，英语词重音常被读平；重读音节要更长、更响、更清。' },
      { l1: 'es', note: '西语重音规则不同，易把英语重音放错音节。' },
    ],
    assessment: 'ai-speaking',
    source: 'original',
    status: 'draft',
    instructions: { en: 'Stress the CAPITAL syllable — longer and louder.', zh: '重读大写音节，更长更响。', es: 'Acentúa la sílaba en MAYÚSCULAS: más larga y fuerte.' },
    payload: {
      targetFeature: 'word-stress',
      modelAudio: 'tts-slow',
      minimalPairs: [['PREsent (n.)', 'preSENT (v.)'], ['REcord (n.)', 'reCORD (v.)']],
      lines: [
        { text: 'comPUter · baNAna · toMORRow', ipa: 'stress on -PU- / -NA- / -MO-' },
        { text: 'Please preSENT your PREsent now.', ipa: 'verb vs noun' },
        { text: 'PHOto · phoTOGrapher · photoGRAPHic', ipa: 'stress shift' },
      ],
    },
  },
  {
    id: 'en.spk.pron.b1.weak-forms',
    title: 'B1 发音 · 句重音与弱读 Stress & weak forms',
    subject: 'english',
    strand: 'english.speaking.pronunciation',
    itemType: 'pronunciation-drill',
    cefr: 'b1',
    domain: 'general',
    canDo: '能重读实词、弱读功能词，形成英语句子节奏。',
    tags: ['sentence-stress', 'weak-forms'],
    l1Trouble: [{ l1: 'zh', note: '汉语每字清晰等重；英语 to/of/and/for 要弱读成 /ə/。' }],
    assessment: 'ai-speaking',
    source: 'original',
    status: 'draft',
    instructions: { en: 'Punch the content words; weaken the small words (to, of, and → /ə/).', zh: '重读实词，弱读 to/of/and 等小词。', es: 'Marca las palabras de contenido; debilita to, of, and → /ə/.' },
    payload: {
      targetFeature: 'weak-forms',
      modelAudio: 'tts',
      lines: [
        { text: 'I want to go to the shops.', ipa: 'to → /tə/' },
        { text: 'A cup of tea and a piece of cake.', ipa: 'of → /əv/, and → /ən/' },
        { text: "We're going to call you at four.", ipa: 'going to → /gənə/' },
      ],
    },
  },
  {
    id: 'en.spk.shadow.b1.workplace-phone',
    title: 'B1 跟读 · 职场电话 On the phone',
    subject: 'english',
    strand: 'english.speaking.shadowing',
    itemType: 'shadowing',
    cefr: 'b1',
    domain: 'occupational',
    subTheme: '电话',
    canDo: '能在简单工作电话中接听、转接与确认信息。',
    tags: ['linking', 'intonation-rise'],
    l1Trouble: [{ l1: 'zh', note: '连读 put you through、take a message；是非问句尾音上扬。' }],
    assessment: 'ai-speaking',
    source: 'original',
    status: 'draft',
    instructions: { en: 'Shadow the call; link the words and let yes/no questions rise.', zh: '跟读电话，连读并让是非问句尾音上扬。', es: 'Imita la llamada; enlaza y sube la entonación en preguntas de sí/no.' },
    payload: {
      modelAudio: 'tts',
      lines: [
        { text: 'Good morning, Sunrise Trading. How can I help you?', gloss: { zh: '早上好，旭日贸易。有什么可以帮您？', es: 'Buenos días, Sunrise Trading. ¿En qué puedo ayudarle?' } },
        { text: 'Could I speak to Ms. Lee, please?', gloss: { zh: '请问能和李女士通话吗？', es: '¿Podría hablar con la Sra. Lee, por favor?' } },
        { text: "Hold on, please. I'll put you through.", gloss: { zh: '请稍等，我帮您转接。', es: 'Un momento, le paso con ella.' } },
        { text: 'Could you take a message?', gloss: { zh: '能帮我留个口信吗？', es: '¿Podría tomar un mensaje?' } },
      ],
    },
  },

  // ── B2 ──────────────────────────────────────────────────────────────────────
  {
    id: 'en.spk.pron.b2.intonation',
    title: 'B2 发音 · 语调 Intonation',
    subject: 'english',
    strand: 'english.speaking.pronunciation',
    itemType: 'pronunciation-drill',
    cefr: 'b2',
    domain: 'general',
    canDo: '能用降调表陈述与特殊疑问、升调表是非问与列举，并以语调传达态度。',
    tags: ['intonation-fall', 'intonation-rise'],
    l1Trouble: [{ l1: 'zh', note: '汉语声调在字，英语语调在句：陈述句尾下降，是非问上扬。' }],
    assessment: 'ai-speaking',
    source: 'original',
    status: 'draft',
    instructions: { en: 'Fall on statements & wh-questions; rise on yes/no questions and list items.', zh: '陈述句与特殊疑问句降调；是非问与列举升调。', es: 'Baja en afirmaciones y preguntas-wh; sube en preguntas de sí/no y enumeraciones.' },
    payload: {
      targetFeature: 'intonation',
      modelAudio: 'tts-slow',
      lines: [
        { text: 'I work in Wuhan.', ipa: '↘ fall' },
        { text: 'Where do you work?', ipa: '↘ fall' },
        { text: 'Are you ready?', ipa: '↗ rise' },
        { text: 'We need pens, paper, and folders.', ipa: '↗ ↗ ↘ list' },
        { text: "Really? That's great news!", ipa: '↗ surprise' },
      ],
    },
  },
  {
    id: 'en.spk.shadow.b2.opinions',
    title: 'B2 跟读 · 表达观点 Giving opinions',
    subject: 'english',
    strand: 'english.speaking.shadowing',
    itemType: 'shadowing',
    cefr: 'b2',
    domain: 'general',
    subTheme: '社交',
    canDo: '能礼貌地表达、回应与缓和不同观点。',
    tags: ['sentence-stress', 'rhythm'],
    assessment: 'ai-speaking',
    source: 'original',
    status: 'draft',
    instructions: { en: 'Shadow with natural rhythm; stress the opinion words.', zh: '自然节奏跟读，重读表态词。', es: 'Imita con ritmo natural; acentúa las palabras de opinión.' },
    payload: {
      modelAudio: 'tts',
      lines: [
        { text: 'Personally, I think remote work saves a lot of time.', gloss: { zh: '我个人认为远程办公省了很多时间。', es: 'Personalmente, creo que el teletrabajo ahorra mucho tiempo.' } },
        { text: "That's a fair point, but I'm not sure it suits everyone.", gloss: { zh: '有道理，但我不确定适合所有人。', es: 'Es razonable, pero no sé si le conviene a todos.' } },
        { text: "It depends on the job, doesn't it?", gloss: { zh: '这要看工作类型，对吧？', es: 'Depende del trabajo, ¿no?' } },
        { text: "I see what you mean, though I'd say balance is the key.", gloss: { zh: '我懂你的意思，不过我认为平衡才是关键。', es: 'Entiendo tu punto, aunque diría que el equilibrio es la clave.' } },
      ],
    },
  },
  {
    id: 'en.spk.shadow.b2.job-interview',
    title: 'B2 跟读 · 求职面试 Job interview',
    subject: 'english',
    strand: 'english.speaking.shadowing',
    itemType: 'shadowing',
    cefr: 'b2',
    domain: 'occupational',
    subTheme: '求职',
    canDo: '能在面试中介绍优势并得体应答。',
    tags: ['emphatic-stress', 'linking'],
    assessment: 'ai-speaking',
    source: 'original',
    status: 'draft',
    instructions: { en: 'Shadow confidently; emphasise your strengths.', zh: '自信跟读，强调优势词。', es: 'Imita con seguridad; enfatiza tus fortalezas.' },
    payload: {
      modelAudio: 'tts',
      lines: [
        { text: "Thanks for having me. I'm really keen on this role.", gloss: { zh: '谢谢给我机会。我非常想得到这个职位。', es: 'Gracias por recibirme. Me interesa mucho este puesto.' } },
        { text: 'My biggest strength is staying calm under pressure.', gloss: { zh: '我最大的优势是高压下保持冷静。', es: 'Mi mayor fortaleza es mantener la calma bajo presión.' } },
        { text: 'In my last job, I led a team of five.', gloss: { zh: '上一份工作我带了五人团队。', es: 'En mi último trabajo dirigí un equipo de cinco.' } },
        { text: "I'm a fast learner, and I'm happy to take on new challenges.", gloss: { zh: '我学得快，乐于接受新挑战。', es: 'Aprendo rápido y me gusta asumir nuevos retos.' } },
      ],
    },
  },

  // ── C1 ──────────────────────────────────────────────────────────────────────
  {
    id: 'en.spk.pron.c1.connected-speech',
    title: 'C1 发音 · 连读与省音 Connected speech',
    subject: 'english',
    strand: 'english.speaking.pronunciation',
    itemType: 'pronunciation-drill',
    cefr: 'c1',
    domain: 'general',
    canDo: '能在自然语流中连读、省音与同化，听感更地道。',
    tags: ['linking', 'elision'],
    l1Trouble: [{ l1: 'zh', note: '逐词清晰显生硬；学连读 an_apple、省音 nex(t) day、同化 did you→didja。' }],
    assessment: 'ai-speaking',
    source: 'original',
    status: 'draft',
    instructions: { en: 'Blend words: link consonant→vowel, drop weak /t/ /d/, soften did you → "didja".', zh: '词词相连：辅音接元音连读，弱读 /t//d/ 省音。', es: 'Une las palabras: enlaza, omite /t/ /d/ débiles y suaviza did you → "didja".' },
    payload: {
      targetFeature: 'linking',
      modelAudio: 'tts',
      lines: [
        { text: "What are you going to do? (whatcha gonna do)", ipa: 'gonna' },
        { text: "I'd like an apple and an orange. (an‿apple, an‿orange)", ipa: 'linking' },
        { text: 'We left the next day. (nex(t) day)', ipa: 'elision /t/' },
        { text: 'Did you eat yet? (didja eat yet)', ipa: 'assimilation' },
      ],
    },
  },
  {
    id: 'en.spk.pron.c1.contrastive-stress',
    title: 'C1 发音 · 对比重音 Contrastive stress',
    subject: 'english',
    strand: 'english.speaking.pronunciation',
    itemType: 'pronunciation-drill',
    cefr: 'c1',
    domain: 'general',
    canDo: '能通过移动重音改变句意重点，表达对比与强调。',
    tags: ['emphatic-stress'],
    assessment: 'ai-speaking',
    source: 'original',
    status: 'draft',
    instructions: { en: 'Move the stress to change the meaning — punch the key word.', zh: '移动重音改变重点，强调关键词。', es: 'Mueve el acento para cambiar el sentido: marca la palabra clave.' },
    payload: {
      targetFeature: 'emphatic-stress',
      modelAudio: 'tts-slow',
      lines: [
        { text: "I didn't say SHE took it.", ipa: '→ someone else did' },
        { text: "I didn't say she TOOK it.", ipa: '→ maybe she borrowed it' },
        { text: "It's not what you say, it's HOW you say it.", ipa: 'contrast' },
      ],
    },
  },
  {
    id: 'en.spk.shadow.c1.presentation',
    title: 'C1 跟读 · 演示陈述 Presentation',
    subject: 'english',
    strand: 'english.speaking.shadowing',
    itemType: 'shadowing',
    cefr: 'c1',
    domain: 'academic',
    canDo: '能在学术/职场演示中清晰引导、衔接与收束。',
    tags: ['sentence-stress', 'intonation-fall'],
    assessment: 'ai-speaking',
    source: 'original',
    status: 'draft',
    instructions: { en: 'Shadow at a measured pace; signpost clearly.', zh: '稳速跟读，清晰使用过渡语。', es: 'Imita a un ritmo pausado; señaliza con claridad.' },
    payload: {
      modelAudio: 'tts',
      lines: [
        { text: "Today I'll outline three key findings from our research.", gloss: { zh: '今天我将概述研究中的三个关键发现。', es: 'Hoy expondré tres hallazgos clave de nuestra investigación.' } },
        { text: "First, let's look at the overall trend.", gloss: { zh: '首先，我们来看总体趋势。', es: 'Primero, veamos la tendencia general.' } },
        { text: 'This brings me to my second point.', gloss: { zh: '这就引出我的第二点。', es: 'Esto me lleva a mi segundo punto.' } },
        { text: 'To sum up, the data clearly supports our approach.', gloss: { zh: '总而言之，数据明确支持我们的方案。', es: 'En resumen, los datos respaldan claramente nuestro enfoque.' } },
      ],
    },
  },
]
