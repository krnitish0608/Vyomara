/**
 * The two assistants: Vyom (male) and Vyomara (female). They share the same
 * tools and safety rules; the persona sets the name, the grammatical gender
 * used in Hindi/Hinglish replies, and the speaking voice.
 */
export type PersonaId = 'vyom' | 'vyomara';

export interface Persona {
  readonly id: PersonaId;
  readonly name: string;
  readonly gender: 'male' | 'female';
  /** Hindi verb ending the assistant uses for itself ("kar raha hoon" / "kar rahi hoon"). */
  readonly selfVerb: 'raha' | 'rahi';
}

export const PERSONAS: Readonly<Record<PersonaId, Persona>> = {
  vyom: { id: 'vyom', name: 'Vyom', gender: 'male', selfVerb: 'raha' },
  vyomara: { id: 'vyomara', name: 'Vyomara', gender: 'female', selfVerb: 'rahi' },
};

export const DEFAULT_PERSONA: PersonaId = 'vyom';

export function isPersonaId(value: unknown): value is PersonaId {
  return value === 'vyom' || value === 'vyomara';
}

export function personaFor(id: PersonaId | undefined): Persona {
  return PERSONAS[id ?? DEFAULT_PERSONA];
}
