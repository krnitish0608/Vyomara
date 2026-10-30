import type { DesktopAppAction } from './contracts.ts';

export function isCodeEditRequest(prompt: string): boolean {
  if (
    /\b(?:delete|remove|erase)\b[\s\S]{0,40}\b(?:file|folder|directory)\b|\b(?:file|folder|directory)\b[\s\S]{0,40}\b(?:delete|remove|erase)\b|(?:फ़ाइल|फाइल|फ़ोल्डर|फोल्डर).{0,32}(?:हटाओ|मिटाओ|डिलीट)/iu.test(prompt)
  ) return false;
  const requestsChange =
    /\b(?:fix|edit|modify|change|implement|refactor|debug|update|thik karo|sahi karo|badlo|banao|likho|chnage)\b|(?:ठीक करो|सुधारो|बदल(?:ो|ना)|लागू करो|बनाओ)/iu.test(prompt);
  const identifiesCode =
    /\b(?:code|codebase|project|repository|repo|bug|file|vs\s*code|vscode|visual studio code)\b|(?:कोड|प्रोजेक्ट|रिपॉज़िटरी|रिपोजिटरी|बग|फ़ाइल|फाइल)/iu.test(prompt);
  return requestsChange && identifiesCode;
}

export function requestsVSCode(prompt: string): boolean {
  return /\b(?:open|launch)\s+(?:the\s+)?(?:visual studio code|vs\s*code|vscode)\b|(?:vs\s*code|vscode).{0,24}(?:खोलो|खोलिए|open karo|khol(?:o|iye)?)/iu.test(prompt);
}

export function detectDesktopAppAction(prompt: string): DesktopAppAction | undefined {
  const value = prompt.trim();
  const vscode = '(?:visual studio code|vs\\s*code|vscode)';
  if (
    new RegExp(`^(?:please\\s+)?(?:(?:open|launch)\\s+${vscode}(?:\\s+app)?|${vscode}(?:\\s+ko)?\\s+(?:open\\s+karo|khol(?:o|iye)?|खोल(?:ो|िए)?|चला(?:ओ|ए)))\\s*[.!]?$`, 'iu').test(value)
  ) {
    return { type: 'open-vscode' };
  }
  const chrome = '(?:google\\s+chrome|chrome|google\\s+browser)';
  if (
    new RegExp(`^(?:please\\s+)?(?:(?:open|launch)\\s+${chrome}(?:\\s+browser)?|${chrome}(?:\\s+ko)?\\s+(?:open\\s+karo|khol(?:o|iye)?|खोल(?:ो|िए)?|चला(?:ओ|ए)))\\s*[.!]?$`, 'iu').test(value)
  ) {
    return { type: 'open-chrome' };
  }

  const searchPatterns = [
    /^(?:please\s+)?(?:(?:open|launch)\s+(?:google\s+)?chrome\s+and\s+search\s+for|search\s+(?:(?:google\s+)?chrome|google)\s+for)\s+(.+?)[.!?]?$/i,
    /^(?:google\s+chrome|chrome|google\s+browser)\s+(?:me|mein|par)\s+(.+?)\s+(?:search\s+karo|search|dhundo|khojo)[.!?]?$/iu,
    /^(?:google\s+chrome|chrome|google\s+browser)\s+(?:me|mein|par)\s+(?:search\s+karo|search|dhundo|khojo)\s+(.+?)[.!?]?$/iu,
    /^(?:google\s+chrome|chrome|google\s+browser)\s*(?:में|पर)\s*(.+?)\s*(?:सर्च करो|खोजो|ढूँढो)[.!?]?$/iu,
  ];
  const query = searchPatterns.map(pattern => value.match(pattern)?.[1]?.trim()).find(Boolean);
  if (query && query.length <= 256 && !/[\u0000-\u001f\u007f]/.test(query)) {
    return { type: 'search-chrome', query };
  }
  return undefined;
}
