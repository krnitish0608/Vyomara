export type ToolEffect = 'read' | 'write' | 'delete' | 'shell' | 'network';

export interface Tool<Input, Output> {
  readonly id: string;
  readonly effect: ToolEffect;
  readonly validateInput: (value: unknown) => value is Input;
  readonly validateOutput: (value: unknown) => value is Output;
  readonly run: (input: Input, signal: AbortSignal) => Promise<Output>;
}

export type RegisteredTool = Tool<unknown, unknown>;

export class ToolRegistry {
  readonly #tools = new Map<string, RegisteredTool>();

  register<Input, Output>(tool: Tool<Input, Output>): void {
    if (!/^[a-z][a-z0-9.-]{0,63}$/.test(tool.id)) {
      throw new Error('Tool ID must use lowercase letters, digits, dots, and hyphens.');
    }
    if (this.#tools.has(tool.id)) {
      throw new Error(`Tool ID is already registered: ${tool.id}`);
    }
    this.#tools.set(tool.id, tool as RegisteredTool);
  }

  get(id: string): RegisteredTool | undefined {
    return this.#tools.get(id);
  }
}
