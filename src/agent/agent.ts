import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '../config/config.ts';
import type { Logger } from '../types.ts';
import { ProviderError } from '../providers/provider.ts';
import type { ModelProvider, ProviderResponse } from '../providers/provider.ts';
import { OperationStoppedError, runBounded } from '../shared/bounded.ts';
import { Session } from '../session/session.ts';
import { TaskRun } from '../tasks/task-run.ts';
import { ToolExecutionError, ToolExecutor } from '../tools/executor.ts';

export class AgentError extends Error {
  readonly code: 'invalid-request' | 'timeout' | 'cancelled' | 'iteration-limit' | 'tool-limit' | 'policy-denied' | 'tool-failed' | 'invalid-provider-response';

  constructor(
    message: string,
    code: AgentError['code'],
  ) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unsupportedCapability(prompt: string, canProposeEdits: boolean): string | undefined {
  if (!canProposeEdits && /\b(?:fix|edit|modify|change|implement|refactor|debug|update)\b[\s\S]{0,80}\b(?:code|codebase|project|repository|repo|bug|file|vs\s*code|vscode|visual studio code)\b|\b(?:code|codebase|project|repository|repo|bug|file|vs\s*code|vscode|visual studio code)\b[\s\S]{0,80}\b(?:fix|edit|modify|change|implement|refactor|debug|update)\b/i.test(prompt)) {
    return 'File creation, editing, and deletion are not available in this session. No files were changed.';
  }
  if (!canProposeEdits && (
    /\b(?:open|launch)\s+(?:vs\s*code|vscode|visual studio code)\b[\s\S]{0,96}\b(?:fix|edit|modify|change|implement|refactor|debug)\b|\b(?:fix|edit|modify|change|implement|refactor|debug)\b[\s\S]{0,96}\b(?:in|using|through)\s+(?:vs\s*code|vscode|visual studio code)\b/i.test(prompt)
  )) return 'File editing is not available in this session. No files were changed.';
  if (
    /\b(?:run|execute|launch)\b[\s\S]{0,48}\b(?:shell|terminal|command|script)\b|\b(?:shell|terminal)\s+command\b|\b(?:run|execute)\s+(?:the\s+)?(?:command\s+)?[`"']?(?:echo|pwd|ls|cat|grep|find|cd|whoami|uname|curl|wget|git|pnpm|npm|ollama)\b|\b(?:command|terminal|shell)\b[\s\S]{0,40}\b(?:chala|chalao|chalana|chalakar|run|execute)\b|(?:कमांड|टर्मिनल|शेल).{0,40}(?:चलाओ|चलाना|चलाकर|चलाया|execute|run)/iu.test(prompt)
  ) {
    return 'I cannot run shell or terminal commands. No command was executed.';
  }
  if (
    /\b(?:web search|search the web|search (?:the )?internet|browse the internet|visit the website|open https?:\/\/|current weather|search online)\b|\b(?:internet|online)\b[\s\S]{0,48}\b(?:search|dhund|dhundo|khoj|check|verify|dekh)\b|\b(?:search|dhund|dhundo|khoj)\b[\s\S]{0,48}\b(?:internet|online)\b|\bonline\s+(?:check|verify)\b|(?:इंटरनेट|ऑनलाइन).{0,48}(?:खोज|ढूंढ|ढूँढ|सर्च|जाँच|जांच)/iu.test(prompt)
  ) {
    return 'Web browsing and web search are not available. No search was performed.';
  }
  if (!canProposeEdits && (
    /\b(?:create|write|edit|modify|change|delete|remove)\b[\s\S]{0,48}\b(?:file|folder|directory)\b|\b(?:file|folder|directory)\b[\s\S]{0,40}\b(?:bana|banao|banana|likh|likho|edit|modify|badal|badlo|hata|hatao|mita|mitao|delete)\b|(?:फ़ाइल|फाइल|फ़ोल्डर|फोल्डर|डायरेक्टरी).{0,40}(?:बनाओ|बनाना|लिखो|बदल(?:ो| दो)|हटा(?:ओ| दो)|मिटा(?:ओ| दो)|डिलीट)/iu.test(prompt)
  )) return 'File creation, editing, and deletion are not available without an approved project-edit proposal. No filesystem change was made.';
  if (
    /\b(?:install|uninstall|update|upgrade)\b[\s\S]{0,48}\b(?:package|application|app|software|dependency|pnpm|npm|ollama)\b|\b(?:package|application|app|software|dependency|pnpm|npm|ollama)\b[\s\S]{0,40}\b(?:install|uninstall|update|upgrade)\b|(?:पैकेज|ऐप|एप्लिकेशन|सॉफ़्टवेयर).{0,40}(?:इंस्टॉल|अपडेट|हटाओ)/iu.test(prompt)
  ) {
    return 'Installing or changing packages and applications is not available. No installation was performed.';
  }
  if (
    /\b(?:open|launch|access|control|turn on|turn off|restart|shutdown|take)\b[\s\S]{0,48}\b(?:system settings|camera|microphone|mic|bluetooth|wi-?fi|notifications|screenshot|screen recording|mac)\b|(?:कैमरा|माइक्रोफ़ोन|माइक्रोफोन|ब्लूटूथ|वाई-?फ़ाई|स्क्रीनशॉट).{0,40}(?:खोलो|चालू|बंद|लेना|लो|पहुँच)/iu.test(prompt)
  ) {
    return 'That system feature is not available to Vyomara. No system action was performed.';
  }
  if (
    /\b(?:open|launch|start)\s+(?:(?:the|an?)\s+)?(?:application|app|calculator|safari|finder|terminal|textedit|notes|calendar|mail|messages|settings|system preferences)\b|\b(?:application|app)\b[\s\S]{0,32}\b(?:open|launch|start)\b|(?:कैलकुलेटर|सफारी|फ़ाइंडर|फाइंडर|टर्मिनल|नोट्स|कैलेंडर).{0,24}(?:खोलो|खोलिए|चलाओ)/iu.test(prompt)
  ) {
    return 'Opening applications is not available to Vyomara. No application was opened.';
  }
  return undefined;
}

function filesystemToolsForPrompt(
  prompt: string,
  recentUserContext: string,
  hasRecentSearchResult: boolean,
  tools: ReturnType<ToolExecutor['modelTools']>,
): ReturnType<ToolExecutor['modelTools']> {
  const filesystemTools = tools.filter(tool => tool.id.startsWith('filesystem.'));
  if (filesystemTools.length === 0) return tools;
  const intentPrompt = prompt
    .replace(/(["'`])\/[^\r\n]*?\1/g, ' ')
    .replace(/\/[^\s"'`]+/g, ' ');
  const filesystemSubjectPattern =
    /\b(?:files?|folders?|director(?:y|ies)|projects?|repos?|repositories|codebases?|documents?|notes?|filenames?|paths?|filesystem)\b|\/[^\s"'`]+|(?:फ़ाइल|फाइल|फ़ोल्डर|फोल्डर|डायरेक्टरी|प्रोजेक्ट|रेपो)/iu;
  const refersToRecentSubject =
    /\b(?:it|that|there|them|those|under that)\b/i.test(prompt) &&
    (filesystemSubjectPattern.test(recentUserContext) || hasRecentSearchResult);
  const hasFilesystemSubject =
    filesystemSubjectPattern.test(prompt) ||
    (hasRecentSearchResult && /\b(?:repository|repo|project|folder|directory|files?|folders?)\b/i.test(prompt)) ||
    refersToRecentSubject;
  const asksForNameSearch =
    /\b(?:find|search|serch|locate|look\s+for|where|whre|whrere|where's|where\s+is|where\s+can\s+i\s+find|open)\b|(?:ढूंढ|ढूँढ|खोज|कहाँ|कहां)/iu.test(intentPrompt);
  const asksForFilesystemAction =
    /\b(?:find|search|serch|locate|look\s+for|where|whre|whrere|where's|where\s+is|where\s+can\s+i\s+find|list(?:ing)?|show|read|open|create|make|edit|modify|update|delete|remove|inspect|use|see|check|count|many|inside|under|contain|contents?)\b|(?:ढूंढ|ढूँढ|खोज|कहाँ|कहां|दिखाओ|पढ़ो|बनाओ|बदल|हटाओ|मिटाओ)/iu.test(intentPrompt);
  const asksForRecursiveListing = /\b(?:tree|recursive(?:ly)?|all\s+descendants)\b/i.test(intentPrompt);
  const asksToReadFile =
    /\b(?:read|display)\s+(?:(?:the|exact)\s+)?(?:contents?\s+of\s+)?(?:exact\s+)?files?\b/i.test(intentPrompt) ||
    /\bfilesystem\.read-file\b/i.test(intentPrompt);
  const asksForDirectoryListing =
    /\b(?:how\s+many|count|folders?|subfolders?|contents?|inside|under|contain)\b/i.test(intentPrompt) ||
    /\bcheck\s+(?:(?:the|all)\s+)?(?:files?|folders?|contents?)\b/i.test(intentPrompt) ||
    /\blist\s+(?:(?:the|all|direct)\s+)?(?:children|files|folders|contents|directory|folder)\b/i.test(intentPrompt) ||
    /\b(?:filesystem\.(?:list-directory|directory-tree|read-file|search))\b/i.test(intentPrompt);

  if (!hasFilesystemSubject || !asksForFilesystemAction) {
    return tools.filter(tool => !tool.id.startsWith('filesystem.'));
  }
  if (asksToReadFile) {
    return tools.filter(tool =>
      !tool.id.startsWith('filesystem.') || tool.id === 'filesystem.read-file');
  }
  if (asksForNameSearch) {
    return tools.filter(tool =>
      !tool.id.startsWith('filesystem.') || tool.id === 'filesystem.search');
  }
  if (asksForRecursiveListing && asksForDirectoryListing) {
    return tools.filter(tool =>
      !tool.id.startsWith('filesystem.') || tool.id === 'filesystem.directory-tree');
  }
  if (asksForDirectoryListing) {
    return tools.filter(tool =>
      !tool.id.startsWith('filesystem.') || tool.id === 'filesystem.list-directory');
  }
  return tools;
}

function claimsUnsupportedExecution(
  text: string,
): boolean {
  const claims = [
    /\b(?:I|we)\s+(?:have\s+)?(?:run|executed|launched)\b.{0,60}\b(?:command|script|shell)\b/i,
    /\b(?:the\s+)?(?:command|script)\s+(?:was|has been|is)\s+(?:run|executed|launched|completed)\b/i,
    /\b(?:running|executing|launched)\s+(?:the\s+)?(?:shell\s+)?(?:command|script)\b/i,
    /\b(?:I|we)\s+(?:have\s+)?(?:searched|browsed)\s+(?:the\s+)?(?:web|internet)\b/i,
    /\b(?:the\s+)?(?:web search|search)\s+(?:is|was|has been)\s+(?:complete|completed|successful)\b/i,
    /\b(?:I|we)\s+(?:have\s+)?(?:installed|uninstalled|updated|upgraded)\b.{0,60}\b(?:package|application|app|software|dependency)\b/i,
    /\b(?:I|we)\s+(?:have\s+)?(?:opened|accessed|controlled|restarted|shut down)\b.{0,60}\b(?:camera|microphone|system settings|bluetooth|wi-?fi|mac)\b/i,
    /\b(?:I|we)\s+(?:have\s+)?(?:opened|launched|started)\b.{0,60}\b(?:application|app|calculator|safari|finder|terminal|textedit|notes|calendar|mail|messages|settings)\b/i,
    /\b(?:maine|mainee)\b[\s\S]{0,48}\b(?:command|terminal|shell)\b[\s\S]{0,32}\b(?:chala(?:ya|o)?|chalaya|execute|run)\b/i,
    /\b(?:command|terminal|shell)\b[\s\S]{0,32}\b(?:chala diya|chalaya|run ho gaya|execute ho gaya)\b/i,
    /(?:मैंने|मैने).{0,48}(?:कमांड|टर्मिनल|शेल).{0,32}(?:चलाया|चला दिया|चलाया है)/u,
    /["'](?:name|toolId)["']\s*:\s*["'](?:shell\.[a-z0-9.-]+|assistant\.(?:open|search|browse)[a-z0-9.-]*|filesystem\.(?:create|write|delete)[a-z0-9.-]*)["']/i,
  ];
  return claims.some(pattern => pattern.test(text));
}

function claimsUnverifiedFileMutation(
  text: string,
  appliedToolIds: ReadonlySet<string>,
): boolean {
  const claims = [
    {
      pattern: /\b(?:I|we)\s+(?:have\s+)?(?:created|made)\s+(?:the\s+)?(?:file|folder|directory)\b|\b(?:file|folder|directory)\s+(?:was|has been)\s+created\b/i,
      tools: ['filesystem.propose-create-file', 'filesystem.propose-create-directory'],
    },
    {
      pattern: /\b(?:I|we)\s+(?:have\s+)?(?:wrote|modified|updated|edited)\s+(?:the\s+)?(?:file|document)\b|\b(?:file|document)\s+(?:was|has been)\s+(?:written|modified|updated|edited)\b/i,
      tools: ['filesystem.propose-edit'],
    },
    {
      pattern: /\b(?:I|we)\s+(?:have\s+)?(?:deleted|removed)\s+(?:the\s+)?(?:file|folder|directory)\b|\b(?:file|folder|directory)\s+(?:was|has been)\s+(?:deleted|removed)\b/i,
      tools: ['filesystem.propose-delete'],
    },
  ];
  return claims.some(claim =>
    claim.pattern.test(text) && !claim.tools.some(toolId => appliedToolIds.has(toolId)));
}

function claimsUnverifiedFileRead(
  text: string,
  successfulToolIds: ReadonlySet<string>,
): boolean {
  const fileReadClaims = [
    /\b(?:I|we)\s+(?:have\s+)?(?:read|opened|checked)\s+(?:the\s+)?(?:file|document)\b/i,
    /\b(?:the\s+)?file\s+(?:contains|says|states)\b/i,
    /\b(?:maine|mainee)\b[\s\S]{0,40}\b(?:file|document)\b[\s\S]{0,32}\b(?:padha|dekha|read)\b/i,
    /(?:मैंने|मैने).{0,40}(?:फ़ाइल|फाइल|दस्तावेज़).{0,32}(?:पढ़ी|देखी|पढ़ा)/u,
  ];
  return !successfulToolIds.has('filesystem.read-file') &&
    fileReadClaims.some(pattern => pattern.test(text));
}

function claimsUnverifiedDirectoryRead(
  text: string,
  successfulToolIds: ReadonlySet<string>,
): boolean {
  const claimsListing = [
    /\b(?:I|we)\s+(?:have\s+)?(?:listed|scanned|enumerated)\s+(?:the\s+)?(?:directory|folder)\b/i,
    /\b(?:the\s+)?(?:directory|folder)\s+(?:contains|has)\b/i,
    /\bhere\s+(?:are|is)\s+(?:the\s+)?(?:files|entries)\s+(?:in|of)\s+(?:the\s+)?(?:directory|folder)\b/i,
    /\b(?:maine|mainee)\b[\s\S]{0,40}\b(?:folder|directory)\b[\s\S]{0,32}\b(?:list|files|entries)\b/i,
    /(?:फ़ोल्डर|फोल्डर|डायरेक्टरी).{0,40}(?:में ये फ़ाइलें|में ये फाइलें|की सूची|में मौजूद)/u,
  ];
  const claimsTree = [
    /\b(?:I|we)\s+(?:have\s+)?(?:shown|generated|built)\s+(?:the\s+)?(?:directory|folder)\s+tree\b/i,
    /\b(?:directory|folder)\s+tree\s+(?:shows|contains|is)\b/i,
  ];
  const claimsCounts = [
    /\b(?:there\s+(?:are|is)|contains?|has)\b[\s\S]{0,40}\b\d+\s+(?:files?|folders?|subfolders?)\b/i,
    /\b(?:there\s+(?:are|is)|contains?|has)\b[\s\S]{0,40}\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:files?|folders?|subfolders?)\b/i,
    /\bno\s+(?:sub)?folders?\b|\bno\s+files?\b/i,
  ];
  const hasListing = successfulToolIds.has('filesystem.list-directory') ||
    successfulToolIds.has('filesystem.directory-tree');
  return (!hasListing && (
    claimsListing.some(pattern => pattern.test(text)) ||
    claimsCounts.some(pattern => pattern.test(text))
  )) ||
    (!successfulToolIds.has('filesystem.directory-tree') &&
      claimsTree.some(pattern => pattern.test(text)));
}

function filesystemResultResponse(
  results: readonly string[],
  maxResponseChars: number,
  followupFailed = false,
): string {
  const heading = followupFailed
    ? 'Verified filesystem tool result(s); Ollama could not complete its follow-up, so no summary was generated:'
    : 'Verified filesystem tool result(s):';
  const formattedResults = results.map(result => {
    const listing = /^filesystem\.list-directory \((.*)\): (.+)$/s.exec(result);
    if (!listing) return result;
    const path = listing[1];
    const serialized = listing[2];
    if (path === undefined || serialized === undefined) return result;
    try {
      const value: unknown = JSON.parse(serialized);
      if (!isRecord(value) || !Array.isArray(value.entries)) return result;
      const folders = value.entries.filter(entry =>
        isRecord(entry) && entry.type === 'directory');
      const files = value.entries.filter(entry =>
        isRecord(entry) && entry.type === 'file');
      const truncated = value.truncated === true ? ' The listing was truncated.' : '';
      const folderNames = folders.flatMap(entry =>
        isRecord(entry) && typeof entry.name === 'string' ? [entry.name] : []);
      const fileNames = files.flatMap(entry =>
        isRecord(entry) && typeof entry.name === 'string' ? [entry.name] : []);
      const details = [
        `Folders (${folders.length}): ${folderNames.length ? folderNames.join(', ') : 'none'}`,
        `Files (${files.length}): ${fileNames.length ? fileNames.join(', ') : 'none'}`,
      ].join('\n');
      return `Directory listing for ${path} (direct children): ${folders.length} folders and ${files.length} files.${truncated}\n${details}`;
    } catch {
      return result;
    }
  });
  const response = `${heading}\n${formattedResults.join('\n')}`;
  return response.length <= maxResponseChars
    ? response
    : 'The filesystem tool completed, but its verified result exceeds the configured response limit and cannot be shown.';
}

function filesystemPartialResultResponse(
  results: readonly string[],
  failureCode: string,
  failureMessage: string,
  maxResponseChars: number,
): string {
  const response =
    `Verified filesystem tool result(s), partial; a later operation failed (${failureCode}): ${failureMessage}\n${results.join('\n')}`;
  return response.length <= maxResponseChars
    ? response
    : 'A filesystem operation failed after a verified result; the partial result exceeds the configured response limit and cannot be shown.';
}

function latestVerifiedSearchDirectory(messages: ReturnType<Session['messages']>): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'tool' || message.toolId !== 'filesystem.search') continue;
    let value: unknown;
    try {
      value = JSON.parse(message.content);
    } catch {
      continue;
    }
    if (!isRecord(value) || !Array.isArray(value.matches)) continue;
    for (const match of value.matches) {
      if (
        isRecord(match) &&
        match.type === 'directory' &&
        typeof match.path === 'string' &&
        match.path.startsWith('/') &&
        !match.path.split('/').includes('..')
      ) {
        return match.path;
      }
    }
  }
  return undefined;
}

function exactQuotedAbsolutePath(prompt: string): string | undefined {
  const matches = [...prompt.matchAll(/(["'`])(\/[^\r\n]{1,4096}?)\1/g)];
  return matches.length === 1 ? matches[0]?.[2] : undefined;
}

function executionArguments(
  prompt: string,
  toolId: string,
  arguments_: Readonly<Record<string, unknown>>,
  batchSize: number,
  recentSearchDirectory?: string,
): Readonly<Record<string, unknown>> {
  if (
    toolId === 'filesystem.list-directory' &&
    recentSearchDirectory &&
    !prompt.includes('/') &&
    /\b(?:repository|repo|project|folder|directory|files?|folders?|it|that|there|under)\b/i.test(prompt)
  ) {
    return { ...arguments_, path: recentSearchDirectory };
  }
  if (toolId === 'filesystem.search') {
    const searchArguments = { ...arguments_ };
    if (typeof searchArguments.query === 'string') {
      const specificQuery = searchArguments.query
        .replace(/\b(?:project|projects|folder|folders|directory|directories|repo|repository|repositories|file|files|document|documents)\b/giu, ' ')
        .trim();
      if (specificQuery !== '') searchArguments.query = specificQuery;
    }
    if (searchArguments.path === '') {
      delete searchArguments.path;
    } else if (
      typeof searchArguments.path === 'string' &&
      (searchArguments.path === '~' || searchArguments.path.startsWith('~/'))
    ) {
      const relativePath = searchArguments.path === '~' ? '' : searchArguments.path.slice(2);
      if (!relativePath.split('/').includes('..')) {
        searchArguments.path = join(homedir(), relativePath);
      }
    }
    return searchArguments;
  }
  if (
    batchSize !== 1 ||
    !['filesystem.list-directory', 'filesystem.read-file', 'filesystem.directory-tree'].includes(toolId)
  ) {
    return arguments_;
  }
  const exactPath = exactQuotedAbsolutePath(prompt);
  if (!exactPath || arguments_.path === exactPath) return arguments_;
  return { ...arguments_, path: exactPath };
}

function parseProviderResponse(
  value: unknown,
  maxTextChars: number,
  maxToolInputChars: number,
): ProviderResponse {
  if (typeof value !== 'object' || value === null) {
    throw new AgentError('Provider returned an invalid response.', 'invalid-provider-response');
  }
  const response = value as Record<string, unknown>;
  if (
    Object.hasOwn(response, 'kind') &&
    response.kind === 'final' &&
    Object.keys(response).every(key => key === 'kind' || key === 'text') &&
    Object.hasOwn(response, 'text') &&
    typeof response.text === 'string' &&
    response.text.trim() !== '' &&
    response.text.length <= maxTextChars
  ) {
    return { kind: 'final', text: response.text };
  }
  if (
    Object.hasOwn(response, 'kind') &&
    response.kind === 'tool-calls' &&
    Object.keys(response).every(key => key === 'kind' || key === 'calls' || key === 'content') &&
    Object.hasOwn(response, 'calls') &&
    Array.isArray(response.calls) &&
    response.calls.length > 0 &&
    response.calls.length <= 10 &&
    (response.content === undefined ||
      (typeof response.content === 'string' && response.content.length <= maxTextChars))
  ) {
    const calls = response.calls.map(call => {
      if (typeof call !== 'object' || call === null || Array.isArray(call)) {
        throw new AgentError('Provider returned an invalid tool call.', 'invalid-provider-response');
      }
      const candidate = call as Record<string, unknown>;
      if (
        !Object.hasOwn(candidate, 'toolId') ||
        !Object.hasOwn(candidate, 'arguments') ||
        Object.keys(candidate).some(key => key !== 'toolId' && key !== 'arguments') ||
        typeof candidate.toolId !== 'string' ||
        !/^[a-z][a-z0-9.-]{0,63}$/.test(candidate.toolId) ||
        typeof candidate.arguments !== 'object' ||
        candidate.arguments === null ||
        Array.isArray(candidate.arguments)
      ) {
        throw new AgentError('Provider returned an invalid tool call.', 'invalid-provider-response');
      }
      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(candidate.arguments);
      } catch {
        throw new AgentError('Provider returned invalid tool arguments.', 'invalid-provider-response');
      }
      if (serialized === undefined || serialized.length > maxToolInputChars) {
        throw new AgentError('Provider returned oversized tool arguments.', 'invalid-provider-response');
      }
      let normalized: unknown;
      try {
        normalized = JSON.parse(serialized);
      } catch {
        throw new AgentError('Provider returned invalid tool arguments.', 'invalid-provider-response');
      }
      if (typeof normalized !== 'object' || normalized === null || Array.isArray(normalized)) {
        throw new AgentError('Provider returned invalid tool arguments.', 'invalid-provider-response');
      }
      return {
        toolId: candidate.toolId,
        arguments: normalized as Readonly<Record<string, unknown>>,
      };
    });
    return {
      kind: 'tool-calls',
      content: response.content ?? '',
      calls,
    };
  }
  throw new AgentError('Provider returned an invalid response.', 'invalid-provider-response');
}

export interface AgentOptions {
  readonly provider: ModelProvider;
  readonly tools: ToolExecutor;
  readonly config: AppConfig;
  readonly session: Session;
  readonly logger: Logger;
  readonly onText?: (text: string) => void;
}

function safeErrorCode(error: unknown, fallback = 'internal-error'): string {
  if (error instanceof AgentError || error instanceof ToolExecutionError || error instanceof ProviderError) {
    return error.code;
  }
  if (error instanceof OperationStoppedError) return error.reason;
  return fallback;
}

export async function runAgent(
  prompt: string,
  signal: AbortSignal,
  options: AgentOptions,
): Promise<string> {
  const task = new TaskRun(options.logger);
  try {
    const response = await runAgentTask(prompt, signal, options, task);
    if (task.state !== 'needs_attention') task.transition('completed');
    return response;
  } catch (error) {
    task.fail(safeErrorCode(error));
    throw error;
  }
}

async function runAgentTask(
  prompt: string,
  signal: AbortSignal,
  options: AgentOptions,
  task: TaskRun,
): Promise<string> {
  if (!prompt.trim() || prompt.length > options.config.maxInputChars) {
    throw new AgentError('Request is empty or exceeds the configured input limit.', 'invalid-request');
  }
  if (signal.aborted) throw new AgentError('Operation cancelled.', 'cancelled');
  options.session.add({ role: 'user', content: prompt });
  const start = Date.now();
  task.transition('planning');
  const canProposeEdits = options.tools.modelTools().some(tool => tool.id.startsWith('filesystem.propose-'));
  const unsupportedResponse = unsupportedCapability(prompt, canProposeEdits);
  if (unsupportedResponse) {
    options.session.add({ role: 'assistant', content: unsupportedResponse });
    options.logger.emit({
      event: 'request.completed',
      taskId: task.taskId,
      runId: task.runId,
      durationMs: Date.now() - start,
      iterations: 0,
    });
    return unsupportedResponse;
  }
  let toolCalls = 0;
  let recoverableToolFailure: ToolExecutionError | undefined;
  let failedToolId: string | undefined;
  let correctionAttempts = 0;
  const successfulToolIds = new Set<string>();
  const appliedFileOperationToolIds = new Set<string>();
  const filesystemToolResults: string[] = [];
  const toolAttempts = new Map<string, number>();
  const recentUserContext = options.session.messages()
    .slice(0, -1)
    .filter(message => message.role === 'user')
    .slice(-3)
    .map(message => message.content)
    .join('\n');
  const recentSearchDirectory = latestVerifiedSearchDirectory(options.session.messages());
  const availableTools = filesystemToolsForPrompt(
    prompt,
    recentUserContext,
    recentSearchDirectory !== undefined,
    options.tools.modelTools(),
  );
  const returnPartialFilesystemResult = (
    error: { readonly code: string; readonly message: string },
    iteration: number,
  ): string => {
    const response = filesystemPartialResultResponse(
      filesystemToolResults,
      error.code,
      error.message,
      options.config.maxResponseChars,
    );
    options.session.add({ role: 'assistant', content: response });
    task.needsAttention();
    options.logger.emit({
      event: 'request.completed',
      taskId: task.taskId,
      runId: task.runId,
      durationMs: Date.now() - start,
      iterations: iteration,
    });
    return response;
  };

  for (let iteration = 1; iteration <= options.config.maxAgentIterations; iteration++) {
    let rawResponse: unknown;
    try {
      rawResponse = await runBounded(
        providerSignal => options.provider.complete(
          options.session.messages(),
          providerSignal,
          toolCalls < options.config.maxToolCalls ? availableTools : [],
          options.onText,
        ),
        options.config.requestTimeoutMs,
        signal,
      );
    } catch (error) {
      if (
        filesystemToolResults.length > 0 &&
        ((error instanceof OperationStoppedError && error.reason === 'timeout') ||
          (error instanceof ProviderError && error.code !== 'cancelled'))
      ) {
        const partialResponse = filesystemResultResponse(
          filesystemToolResults,
          options.config.maxResponseChars,
          true,
        );
        options.session.add({ role: 'assistant', content: partialResponse });
        task.needsAttention();
        options.logger.emit({
          event: 'request.completed',
          taskId: task.taskId,
          runId: task.runId,
          durationMs: Date.now() - start,
          iterations: iteration,
        });
        return partialResponse;
      }
      if (error instanceof OperationStoppedError) {
        throw new AgentError(error.message, error.reason);
      }
      throw error;
    }
    let response: ProviderResponse;
    try {
      response = parseProviderResponse(
        rawResponse,
        options.config.maxResponseChars,
        options.config.maxToolOutputChars,
      );
    } catch (error) {
      if (error instanceof AgentError && filesystemToolResults.length > 0) {
        return returnPartialFilesystemResult(error, iteration);
      }
      throw error;
    }
    if (response.kind === 'final') {
      if (recoverableToolFailure) {
        if (filesystemToolResults.length > 0) {
          return returnPartialFilesystemResult(recoverableToolFailure, iteration);
        }
        throw recoverableToolFailure;
      }
      if (claimsUnsupportedExecution(response.text)) {
        const safeResponse =
          'I cannot verify that action because no registered tool result confirms it. No shell command, web search, or file mutation was performed.';
        options.session.add({ role: 'assistant', content: safeResponse });
        options.logger.emit({
          event: 'request.completed',
          taskId: task.taskId,
          runId: task.runId,
          durationMs: Date.now() - start,
          iterations: iteration,
        });
        return safeResponse;
      }
      if (claimsUnverifiedFileMutation(response.text, appliedFileOperationToolIds)) {
        const safeResponse =
          'I cannot claim a file change because no matching user-approved operation completed successfully.';
        options.session.add({ role: 'assistant', content: safeResponse });
        options.logger.emit({
          event: 'request.completed',
          taskId: task.taskId,
          runId: task.runId,
          durationMs: Date.now() - start,
          iterations: iteration,
        });
        return safeResponse;
      }
      if (claimsUnverifiedFileRead(response.text, successfulToolIds)) {
        const safeResponse =
          'I cannot report file contents because no registered filesystem read completed successfully.';
        options.session.add({ role: 'assistant', content: safeResponse });
        options.logger.emit({
          event: 'request.completed',
          taskId: task.taskId,
          runId: task.runId,
          durationMs: Date.now() - start,
          iterations: iteration,
        });
        return safeResponse;
      }
      if (claimsUnverifiedDirectoryRead(response.text, successfulToolIds)) {
        const safeResponse =
          'I cannot report directory contents because no registered directory listing or tree tool completed successfully.';
        options.session.add({ role: 'assistant', content: safeResponse });
        options.logger.emit({
          event: 'request.completed',
          taskId: task.taskId,
          runId: task.runId,
          durationMs: Date.now() - start,
          iterations: iteration,
        });
        return safeResponse;
      }
      const readOnlyProjectContext =
        successfulToolIds.has('assistant.project-root') &&
        !options.tools.modelTools().some(tool => tool.id === 'filesystem.propose-edit');
      const completedFileOperation = [...successfulToolIds].some(toolId =>
        toolId.startsWith('filesystem.propose-'));
      if (
        filesystemToolResults.length > 0 &&
        !completedFileOperation &&
        !readOnlyProjectContext
      ) {
        const finalResponse = filesystemResultResponse(
          filesystemToolResults,
          options.config.maxResponseChars,
        );
        options.session.add({ role: 'assistant', content: finalResponse });
        options.logger.emit({
          event: 'request.completed',
          taskId: task.taskId,
          runId: task.runId,
          durationMs: Date.now() - start,
          iterations: iteration,
        });
        return finalResponse;
      }
      options.session.add({ role: 'assistant', content: response.text });
      options.logger.emit({
        event: 'request.completed',
        taskId: task.taskId,
        runId: task.runId,
        durationMs: Date.now() - start,
        iterations: iteration,
      });
      return response.text;
    }

    const allowedToolIds = new Set(
      toolCalls < options.config.maxToolCalls ? availableTools.map(tool => tool.id) : [],
    );
    if (response.calls.some(call =>
      call.toolId.startsWith('filesystem.') && !allowedToolIds.has(call.toolId))) {
      options.session.add({
        role: 'assistant',
        kind: 'tool-call',
        content: response.content ?? '',
        toolCalls: response.calls.map(call => ({
          toolId: call.toolId,
          arguments: call.arguments,
        })),
      });
      for (const call of response.calls) {
        options.session.add({
          role: 'tool',
          toolId: call.toolId,
          content: JSON.stringify({
            ok: false,
            error: 'No action was taken. This tool is not available for the current request; answer the user directly or choose an available tool.',
          }),
        });
      }
      continue;
    }

    const proposedCalls = response.calls.map(call => {
      const attempt = (toolAttempts.get(call.toolId) ?? 0) + 1;
      toolAttempts.set(call.toolId, attempt);
      const toolCallId = randomUUID();
      const context = task.context(toolCallId, attempt);
      options.logger.emit({
        event: 'tool.requested',
        ...context,
        toolId: call.toolId,
        argumentKeys: Object.keys(call.arguments).sort(),
      });
      return { call, attempt, toolCallId, context };
    });
    if (response.calls.length > options.config.maxToolCalls - toolCalls) {
      const error = new AgentError('Tool call limit reached.', 'tool-limit');
      if (filesystemToolResults.length > 0) {
        return returnPartialFilesystemResult(error, iteration);
      }
      throw error;
    }
    if (iteration === options.config.maxAgentIterations) {
      const error = new AgentError('Agent iteration limit reached without a final response.', 'iteration-limit');
      if (filesystemToolResults.length > 0) {
        return returnPartialFilesystemResult(error, iteration);
      }
      throw error;
    }
    options.session.add({
      role: 'assistant',
      kind: 'tool-call',
      content: response.content ?? '',
      toolCalls: response.calls.map(call => ({
        toolId: call.toolId,
        arguments: call.arguments,
      })),
    });
    for (const { call, attempt, toolCallId, context } of proposedCalls) {
      toolCalls++;
      if (task.state === 'planning') task.transition('running');
      options.logger.emit({
        event: 'tool.invoked',
        ...context,
        toolId: call.toolId,
      });
      try {
        const args = executionArguments(
          prompt,
          call.toolId,
          call.arguments,
          response.calls.length,
          recentSearchDirectory,
        );
        const result = await options.tools.execute(call.toolId, args, signal, context);
        const serialized = JSON.stringify(result);
        if (serialized === undefined || serialized.length > options.config.maxToolOutputChars) {
          throw new ToolExecutionError(
            'Tool result exceeded the configured safety limit; success cannot be confirmed.',
            'output-too-large',
          );
        }
        options.session.add({ role: 'tool', toolId: call.toolId, content: serialized });
        successfulToolIds.add(call.toolId);
        if (
          call.toolId.startsWith('filesystem.propose-') &&
          typeof result === 'object' &&
          result !== null &&
          'status' in result &&
          result.status === 'applied'
        ) {
          appliedFileOperationToolIds.add(call.toolId);
        }
        if (
          call.toolId.startsWith('filesystem.') &&
          !['filesystem.propose-edit', 'filesystem.propose-create'].includes(call.toolId)
        ) {
          const listingPath =
            call.toolId === 'filesystem.list-directory' && typeof args.path === 'string'
              ? ` (${args.path})`
              : '';
          filesystemToolResults.push(`${call.toolId}${listingPath}: ${serialized}`);
        }
        if (failedToolId === call.toolId) {
          recoverableToolFailure = undefined;
          failedToolId = undefined;
        }
      } catch (error) {
        const code = safeErrorCode(error, 'tool-failed');
        options.logger.emit({
          event: 'tool.failed',
          ...context,
          toolId: call.toolId,
          code,
        });
        if (error instanceof ToolExecutionError && error.code === 'policy-denied') {
          if (filesystemToolResults.length > 0) {
            return returnPartialFilesystemResult(error, iteration);
          }
          throw new AgentError('Requested tool was denied by policy.', 'policy-denied');
        }
        if (
          error instanceof ToolExecutionError &&
          ['invalid-input', 'input-too-large', 'unknown-tool'].includes(error.code)
        ) {
          if (correctionAttempts >= 1) {
            const finalError = new ToolExecutionError(
              'Tool arguments remained invalid after one correction attempt; no operation was performed.',
              error.code,
            );
            if (filesystemToolResults.length > 0) {
              return returnPartialFilesystemResult(finalError, iteration);
            }
            throw finalError;
          }
          correctionAttempts++;
          options.logger.emit({
            event: 'tool.retry-scheduled',
            taskId: task.taskId,
            runId: task.runId,
            toolCallId,
            toolId: call.toolId,
            nextAttempt: attempt + 1,
            reasonCode: error.code,
          });
          recoverableToolFailure = error;
          failedToolId = call.toolId;
          options.session.add({
            role: 'tool',
            toolId: call.toolId,
            content: JSON.stringify({
              ok: false,
              error: {
                code: error.code,
                message: error.message,
              },
            }),
          });
          continue;
        }
        if (error instanceof AgentError || error instanceof ToolExecutionError) {
          if (
            error instanceof ToolExecutionError &&
            error.code !== 'cancelled' &&
            filesystemToolResults.length > 0
          ) {
            return returnPartialFilesystemResult(error, iteration);
          }
          throw error;
        }
        const wrappedError = new ToolExecutionError(
          'The requested operation failed; no success is implied.',
          'tool-failed',
        );
        if (filesystemToolResults.length > 0) {
          return returnPartialFilesystemResult(wrappedError, iteration);
        }
        throw wrappedError;
      }
    }
    if (task.state === 'running') task.transition('planning');
  }

  throw new AgentError('Agent iteration limit reached without a final response.', 'iteration-limit');
}
