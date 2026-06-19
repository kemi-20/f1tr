export type LanguageMode = 'zh' | 'en' | 'mixed'

export interface VoiceOption {
  id: string // exact casing as required by MiMo API
  name: string // friendly label
}

export const VOICE_CATALOG: Record<'zh' | 'en', VoiceOption[]> = {
  zh: [
    { id: '冰糖', name: '冰糖 · Bingtang (女)' },
    { id: '茉莉', name: '茉莉 · Jasmine (女)' },
    { id: '苏打', name: '苏打 · Soda (男)' },
    { id: '白桦', name: '白桦 · Birch (男)' },
    { id: 'mimo_default', name: 'MiMo 默认 (多语)' }
  ],
  en: [
    { id: 'Mia', name: 'Mia (女)' },
    { id: 'Chloe', name: 'Chloe (女)' },
    { id: 'Milo', name: 'Milo (男)' },
    { id: 'Dean', name: 'Dean (男)' },
    { id: 'mimo_default', name: 'MiMo Default (multilingual)' }
  ]
}

export interface LanguageProfile {
  promptLang: string
  speak: string
  defaultVoice: string
  voices: VoiceOption[]
  direction: string
}

export const LANGUAGE_PROFILE: Record<LanguageMode, LanguageProfile> = {
  zh: {
    promptLang: 'zh-CN',
    speak: 'zh',
    defaultVoice: '冰糖',
    voices: VOICE_CATALOG.zh,
    direction: '冷静果断的 F1 赛车工程师语气'
  },
  en: {
    promptLang: 'en',
    speak: 'en',
    defaultVoice: 'Mia',
    voices: VOICE_CATALOG.en,
    direction: 'calm, decisive F1 race engineer'
  },
  mixed: {
    promptLang: 'zh-CN', // Chinese body, English F1 terms + callsigns
    speak: 'zh with English terms (DRS, ERS, box, box box, push, out lap)',
    defaultVoice: 'mimo_default',
    voices: [...VOICE_CATALOG.zh, ...VOICE_CATALOG.en],
    direction: '冷静果断，遇到技术术语保留英文原词'
  }
}

export function resolveVoice(mode: LanguageMode, voice?: string): string {
  if (voice) return voice
  return LANGUAGE_PROFILE[mode].defaultVoice
}
