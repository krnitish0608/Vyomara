export type SessionMessage = {
  readonly role: 'user' | 'assistant' | 'tool';
  readonly content: string;
};

export class Session {
  readonly #messages: SessionMessage[] = [];

  add(message: SessionMessage): void {
    this.#messages.push({ ...message });
  }

  messages(): readonly SessionMessage[] {
    return this.#messages.map(message => ({ ...message }));
  }
}
