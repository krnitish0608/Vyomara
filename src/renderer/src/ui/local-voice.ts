export const localVoiceLanguages = [
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-IN', label: 'English (India)' },
  { code: 'hi-IN', label: 'Hindi (India)' },
] as const;

export type LocalVoiceLanguage = typeof localVoiceLanguages[number]['code'];
export type LocalSpeechAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

export function isLocalVoiceLanguage(value: string): value is LocalVoiceLanguage {
  return localVoiceLanguages.some(language => language.code === value);
}

export interface LocalSpeechResultEvent extends Event {
  readonly results: ArrayLike<{
    readonly isFinal: boolean;
    readonly length: number;
    readonly [index: number]: { readonly transcript: string };
  }>;
  readonly resultIndex: number;
}

export interface LocalSpeechErrorEvent extends Event {
  readonly error: string;
}

export interface LocalSpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  processLocally: boolean;
  onresult: ((event: LocalSpeechResultEvent) => void) | null;
  onerror: ((event: LocalSpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface LocalSpeechRecognitionConstructor {
  new(): LocalSpeechRecognition;
  available(options: {
    readonly langs: readonly string[];
    readonly processLocally: true;
  }): Promise<LocalSpeechAvailability>;
  install(options: { readonly langs: readonly string[] }): Promise<boolean>;
}

type WindowWithLocalSpeechRecognition = Window & {
  SpeechRecognition?: LocalSpeechRecognitionConstructor;
  webkitSpeechRecognition?: LocalSpeechRecognitionConstructor;
};

export function getLocalSpeechRecognition(): LocalSpeechRecognitionConstructor | undefined {
  const speechWindow = window as WindowWithLocalSpeechRecognition;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}
