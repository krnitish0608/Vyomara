export type VoiceTranscriptAction =
  | { readonly type: 'preview'; readonly transcript: string }
  | { readonly type: 'draft'; readonly transcript: string }
  | { readonly type: 'submit'; readonly transcript: string };

export function resolveVoiceTranscriptAction(
  eventType: 'partial' | 'command',
  composerDictation: boolean,
  transcript: string,
): VoiceTranscriptAction {
  if (composerDictation) return { type: 'draft', transcript };
  if (eventType === 'command') return { type: 'submit', transcript };
  return { type: 'preview', transcript };
}

export function appendVoiceDraft(base: string, transcript: string): string {
  return `${base}${base && transcript ? ' ' : ''}${transcript}`;
}
