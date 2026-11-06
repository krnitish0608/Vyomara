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
  /**
   * Spoken when the app opens on the welcome screen and when this assistant
   * is chosen: the welcome text, in the assistant's own words.
   */
  readonly greeting: string;
}

function greetingFor(name: string): string {
  return `Hi, I'm ${name}, your personal AI assistant. Tell me what you need. `
    + 'Ask a question, plan your next move, or get help with a task, by voice or text. '
    + 'I keep you in control and show my work. AI Twins. One Orbit. Your Control.';
}

export const PERSONAS: Readonly<Record<PersonaId, Persona>> = {
  vyom: {
    id: 'vyom',
    name: 'Vyom',
    gender: 'male',
    selfVerb: 'raha',
    greeting: greetingFor('Vyom'),
  },
  vyomara: {
    id: 'vyomara',
    name: 'Vyomara',
    gender: 'female',
    selfVerb: 'rahi',
    greeting: greetingFor('Vyomara'),
  },
};

export const DEFAULT_PERSONA: PersonaId = 'vyom';

export function isPersonaId(value: unknown): value is PersonaId {
  return value === 'vyom' || value === 'vyomara';
}

export function personaFor(id: PersonaId | undefined): Persona {
  return PERSONAS[id ?? DEFAULT_PERSONA];
}
