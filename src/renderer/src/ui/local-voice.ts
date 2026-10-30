export const localVoiceLanguages = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-IN', label: 'English (India)' },
  { code: 'hi-IN', label: 'Hindi (India)' },
] as const;

export type LocalVoiceLanguage = typeof localVoiceLanguages[number]['code'];
export type LocalSpeechAvailability = 'available' | 'unavailable';

export function isLocalVoiceLanguage(value: string): value is LocalVoiceLanguage {
  return localVoiceLanguages.some(language => language.code === value);
}
