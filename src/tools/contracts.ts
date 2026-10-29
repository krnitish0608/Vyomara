export type ToolEffect = 'read' | 'write' | 'delete' | 'shell' | 'network';

export type ToolFailureCode =
  | 'not-found'
  | 'invalid-path'
  | 'outside-root'
  | 'permission-denied'
  | 'unsupported-operation'
  | 'tool-failed';

export class ToolFailure extends Error {
  readonly code: ToolFailureCode;

  constructor(message: string, code: ToolFailureCode) {
    super(message);
    this.name = 'ToolFailure';
    this.code = code;
  }
}

export interface ToolArgumentProperty {
  readonly type: 'string' | 'integer';
  readonly description?: string;
  readonly nullable?: true;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly pattern?: string;
}

export interface ToolArgumentSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, ToolArgumentProperty>>;
  readonly required?: readonly string[];
  readonly additionalProperties: false;
}

export interface ModelToolDefinition {
  readonly id: string;
  readonly description: string;
  readonly parameters: ToolArgumentSchema;
}

export interface Tool<Input, Output> {
  readonly id: string;
  readonly effect: ToolEffect;
  readonly description: string;
  readonly parameters: ToolArgumentSchema;
  readonly validateInput: (value: unknown) => value is Input;
  readonly validateOutput: (value: unknown) => value is Output;
  readonly run: (input: Input, signal: AbortSignal) => Promise<Output>;
}

export type RegisteredTool = Tool<unknown, unknown>;

function validToolArgumentSchema(schema: ToolArgumentSchema): boolean {
  if (
    typeof schema !== 'object' ||
    schema === null ||
    schema.type !== 'object' ||
    schema.additionalProperties !== false ||
    typeof schema.properties !== 'object' ||
    schema.properties === null ||
    Array.isArray(schema.properties) ||
    Object.keys(schema.properties).length > 32 ||
    Object.keys(schema).some(key =>
      key !== 'type' && key !== 'properties' && key !== 'required' && key !== 'additionalProperties')
  ) {
    return false;
  }
  for (const [name, property] of Object.entries(schema.properties)) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name) ||
      typeof property !== 'object' ||
      property === null ||
      Object.keys(property).some(key =>
        !['type', 'description', 'nullable', 'maxLength', 'minimum', 'maximum', 'pattern'].includes(key)) ||
      (property.type !== 'string' && property.type !== 'integer') ||
      (property.nullable !== undefined && property.nullable !== true) ||
      (property.nullable === true && (schema.required ?? []).includes(name)) ||
      (property.description !== undefined &&
        (typeof property.description !== 'string' || property.description.length > 256)) ||
      (property.maxLength !== undefined &&
        (!Number.isSafeInteger(property.maxLength) || property.maxLength < 1 || property.maxLength > 4096)) ||
      (property.minimum !== undefined && !Number.isSafeInteger(property.minimum)) ||
      (property.maximum !== undefined && !Number.isSafeInteger(property.maximum)) ||
      (property.minimum !== undefined && property.maximum !== undefined &&
        property.minimum > property.maximum) ||
      (property.pattern !== undefined &&
        (typeof property.pattern !== 'string' || property.pattern.length > 128))
    ) {
      return false;
    }
  }
  return schema.required === undefined ||
    (Array.isArray(schema.required) &&
      schema.required.length <= 32 &&
      new Set(schema.required).size === schema.required.length &&
      schema.required.every(key =>
        typeof key === 'string' && Object.hasOwn(schema.properties, key)));
}

export class ToolRegistry {
  readonly #tools = new Map<string, RegisteredTool>();

  register<Input, Output>(tool: Tool<Input, Output>): void {
    if (!/^[a-z][a-z0-9.-]{0,63}$/.test(tool.id)) {
      throw new Error('Tool ID must use lowercase letters, digits, dots, and hyphens.');
    }
    if (
      typeof tool.description !== 'string' ||
      tool.description.trim() === '' ||
      tool.description.length > 512
    ) {
      throw new Error('Tool description must contain between 1 and 512 characters.');
    }
    if (!validToolArgumentSchema(tool.parameters)) {
      throw new Error('Tool argument schema is invalid.');
    }
    if (this.#tools.has(tool.id)) {
      throw new Error(`Tool ID is already registered: ${tool.id}`);
    }
    this.#tools.set(tool.id, tool as RegisteredTool);
  }

  get(id: string): RegisteredTool | undefined {
    return this.#tools.get(id);
  }

  modelTools(): readonly ModelToolDefinition[] {
    return [...this.#tools.values()]
      .filter(tool => tool.effect === 'read')
      .map(({ id, description, parameters }) => ({
        id,
        description,
        parameters: structuredClone(parameters),
      }));
  }
}
