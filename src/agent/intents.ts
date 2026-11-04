import { normalizeApplicationId } from '../tools/application-tools.ts';
import type { ApplicationId } from '../tools/application-tools.ts';

export function isApplicationLaunchRequest(prompt: string): boolean {
  return /\b(?:open|launch|start)\b[\s\S]{0,40}\b(?:app(?:lication)?|calculator|calendar|finder|notes|safari|terminal|system settings|visual studio code|vs code|vscode)\b|\b(?:app(?:lication)?|calculator|calendar|finder|notes|safari|terminal|system settings|visual studio code|vs code|vscode)\b[\s\S]{0,32}\b(?:open|launch|start)\b|\b(?:open|launch|start)\s+(?:the\s+)?[^.!?\n]{1,48}\s+app(?:lication)?\b/i.test(prompt) ||
    /(?:कैलकुलेटर|सफारी|फ़ाइंडर|फाइंडर|नोट्स|कैलेंडर|टर्मिनल).{0,24}(?:खोलो|खोलिए|चलाओ)/iu.test(prompt);
}

export function requestedApplicationId(prompt: string): ApplicationId | undefined {
  if (!isApplicationLaunchRequest(prompt)) return undefined;
  const aliases = [
    'visual studio code',
    'system settings',
    'calculator',
    'calendar',
    'finder',
    'notes',
    'safari',
    'terminal',
    'vscode',
    'vs code',
    'settings',
    'calculator',
    'calc',
    'कैलकुलेटर',
    'सफारी',
    'फ़ाइंडर',
    'फाइंडर',
    'नोट्स',
    'कैलेंडर',
    'टर्मिनल',
  ];
  const normalizedPrompt = prompt.toLocaleLowerCase();
  for (const alias of aliases) {
    const matched = /[a-z]/i.test(alias)
      ? new RegExp(`(?:^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`, 'i')
        .test(prompt)
      : normalizedPrompt.includes(alias);
    if (matched) return normalizeApplicationId(alias);
  }
  return undefined;
}
