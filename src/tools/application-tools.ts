import type { Tool, ToolRegistry } from './contracts.ts';

export const applicationIds = [
  'calculator',
  'calendar',
  'finder',
  'notes',
  'safari',
  'system-settings',
  'terminal',
  'visual-studio-code',
] as const;

export type ApplicationId = typeof applicationIds[number];

const applicationAliases: Readonly<Record<string, ApplicationId>> = {
  calc: 'calculator',
  calculator: 'calculator',
  calendar: 'calendar',
  finder: 'finder',
  notes: 'notes',
  safari: 'safari',
  terminal: 'terminal',
  settings: 'system-settings',
  'system settings': 'system-settings',
  'visual studio code': 'visual-studio-code',
  'vs code': 'visual-studio-code',
  vscode: 'visual-studio-code',
  कैलकुलेटर: 'calculator',
  सफारी: 'safari',
  फ़ाइंडर: 'finder',
  फाइंडर: 'finder',
  नोट्स: 'notes',
  कैलेंडर: 'calendar',
  टर्मिनल: 'terminal',
};

export interface ApplicationLauncherPort {
  launch(application: ApplicationId, signal: AbortSignal): Promise<void>;
}

export interface ApplicationLaunchApprovalPort {
  request(application: ApplicationId, signal: AbortSignal): Promise<boolean>;
}

interface ApplicationInput {
  readonly application: string;
}

interface ApplicationOutput {
  readonly application: ApplicationId;
  readonly status: 'opened' | 'rejected';
}

function isApplicationId(value: unknown): value is ApplicationId {
  return typeof value === 'string' &&
    applicationIds.some(application => application === value);
}

export function normalizeApplicationId(value: unknown): ApplicationId | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLocaleLowerCase().replace(/[_-]+/g, ' ');
  return applicationAliases[normalized];
}

function isApplicationOutput(value: unknown): value is ApplicationOutput {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    'application' in value &&
    isApplicationId(value.application) &&
    'status' in value &&
    (value.status === 'opened' || value.status === 'rejected');
}

export function registerApplicationTools(
  registry: ToolRegistry,
  launcher: ApplicationLauncherPort,
  approval: ApplicationLaunchApprovalPort,
): void {
  const tool: Tool<ApplicationInput, ApplicationOutput> = {
    id: 'application.open',
    effect: 'launch',
    description:
      `Request user confirmation, then open one supported macOS application by ID or name when the user explicitly asks. Never proceed if the user rejects or cancels. Supported IDs: ${applicationIds.join(', ')}. This cannot run commands or open arbitrary paths.`,
    parameters: {
      type: 'object',
      properties: {
        application: {
          type: 'string',
          description: 'A supported macOS application name or ID.',
          maxLength: 48,
        },
      },
      required: ['application'],
      additionalProperties: false,
    },
    validateInput(value): value is ApplicationInput {
      return typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.keys(value).length === 1 &&
        'application' in value &&
        normalizeApplicationId(value.application) !== undefined;
    },
    inputError() {
      return `Choose one supported application: ${applicationIds.join(', ')}.`;
    },
    validateOutput: isApplicationOutput,
    async run(input, signal) {
      const application = normalizeApplicationId(input.application);
      if (!application) throw new Error('Unsupported application name.');
      if (!await approval.request(application, signal)) {
        return { application, status: 'rejected' };
      }
      await launcher.launch(application, signal);
      return { application, status: 'opened' };
    },
  };
  registry.register(tool);
}
