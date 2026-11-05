import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isApplicationLaunchRequest, requestedApplicationId } from './intents.ts';
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

function unsupportedCapability(
  prompt: string,
  canProposeEdits: boolean,
  canOpenApplications: boolean,
): string | undefined {
  const fileIntentPrompt = prompt
    .replace(/(["'`])\/[^\r\n]*?\1/g, ' ')
    .replace(/\/[^\s"'`]+/g, ' ');
  if (!canProposeEdits && /\b(?:fix|edit|modify|change|implement|refactor|debug|update)\b[\s\S]{0,80}\b(?:code|codebase|project|repository|repo|bug|file|vs\s*code|vscode|visual studio code)\b|\b(?:code|codebase|project|repository|repo|bug|file|vs\s*code|vscode|visual studio code)\b[\s\S]{0,80}\b(?:fix|edit|modify|change|implement|refactor|debug|update)\b/i.test(fileIntentPrompt)) {
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
    /\b(?:create|write|edit|modify|change|delete|remove)\b[\s\S]{0,48}\b(?:file|folder|directory)\b|\b(?:file|folder|directory)\b[\s\S]{0,40}\b(?:bana|banao|banana|likh|likho|edit|modify|badal|badlo|hata|hatao|mita|mitao|delete)\b|(?:फ़ाइल|फाइल|फ़ोल्डर|फोल्डर|डायरेक्टरी).{0,40}(?:बनाओ|बनाना|लिखो|बदल(?:ो| दो)|हटा(?:ओ| दो)|मिटा(?:ओ| दो)|डिलीट)/iu.test(fileIntentPrompt)
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
  if (isApplicationLaunchRequest(prompt) && !canOpenApplications) {
    return 'Opening applications is not available to Vyomara. No application was opened.';
  }
  if (isApplicationLaunchRequest(prompt) && !requestedApplicationId(prompt)) {
    return 'Which supported application would you like me to open?';
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
    /\b(?:it|that|there|them|those|under that|again|once more)\b/i.test(prompt) &&
    (filesystemSubjectPattern.test(recentUserContext) || hasRecentSearchResult);
  const hasFilesystemSubject =
    filesystemSubjectPattern.test(prompt) ||
    (hasRecentSearchResult && /\b(?:repository|repo|project|folder|directory|files?|folders?)\b/i.test(prompt)) ||
    refersToRecentSubject;
  const asksForNameSearch =
    /\b(?:find|search|serch|locate|look\s+for|where|whre|whrere|where's|where\s+is|where\s+can\s+i\s+find|open)\b|\bcheck\b[\s\S]{0,24}\b(?:again|once\s+more)\b|(?:ढूंढ|ढूँढ|खोज|कहाँ|कहां)/iu.test(intentPrompt);
  const asksForFilesystemAction =
    /\b(?:find|search|serch|locate|look\s+for|where|whre|whrere|where's|where\s+is|where\s+can\s+i\s+find|list(?:ing)?|show|read|open|create|make|fix|implement|refactor|debug|edit|modify|change|replace|update|delete|remove|inspect|deep\s*dive|analy[sz]e|anly[sz]e|analysis|review|understand|use|see|check|count|many|inside|under|contain|contents?)\b|(?:ढूंढ|ढूँढ|खोज|कहाँ|कहां|दिखाओ|पढ़ो|बनाओ|बदल|हटाओ|मिटाओ)/iu.test(intentPrompt);
  const asksForRecursiveListing =
    /\b(?:tree|recursive(?:ly)?|all\s+descendants|subfolders?|nested\s+folders?)\b/i.test(intentPrompt) ||
    /\binside\b[\s\S]{0,40}\b(?:their|its|the)\s+subfolders?\b/i.test(intentPrompt);
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
  if (asksForMarkdownRead(prompt, recentUserContext)) {
    return tools.filter(tool =>
      !tool.id.startsWith('filesystem.') ||
      tool.id === 'filesystem.directory-tree' ||
      tool.id === 'filesystem.read-file');
  }
  if (asksForProjectAnalysis(intentPrompt)) {
    return tools.filter(tool =>
      !tool.id.startsWith('filesystem.') ||
      ['filesystem.directory-tree', 'filesystem.read-file'].includes(tool.id) ||
      (asksForFileMutation(intentPrompt) && tool.id.startsWith('filesystem.propose-')));
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
    /\b(?:maine|mainee)\b[\s\S]{0,48}\b(?:command|terminal|shell)\b[\s\S]{0,32}\b(?:chala(?:ya|o)?|chalaya|execute|run)\b/i,
    /\b(?:command|terminal|shell)\b[\s\S]{0,32}\b(?:chala diya|chalaya|run ho gaya|execute ho gaya)\b/i,
    /(?:मैंने|मैने).{0,48}(?:कमांड|टर्मिनल|शेल).{0,32}(?:चलाया|चला दिया|चलाया है)/u,
    /["'](?:name|toolId)["']\s*:\s*["'](?:shell\.[a-z0-9.-]+|assistant\.(?:open|search|browse)[a-z0-9.-]*|filesystem\.(?:create|write|delete)[a-z0-9.-]*)["']/i,
  ];
  return claims.some(pattern => pattern.test(text));
}

function claimsUnverifiedApplicationLaunch(
  text: string,
  applicationLaunchCompleted: boolean,
): boolean {
  const claims =
    /\b(?:I|we)\s+(?:have\s+)?(?:opened|launched|started)\b.{0,60}\b(?:application|app|calculator|safari|finder|terminal|textedit|notes|calendar|mail|messages|settings|visual studio code)\b/i;
  return claims.test(text) && !applicationLaunchCompleted;
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
      tools: ['filesystem.propose-edit', 'filesystem.propose-replace-text'],
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
  prompt: string,
  followupFailed = false,
  markdownReadRequest = asksForMarkdownRead(prompt),
): string {
  const includeNames =
    /\b(?:check|list|show|which|what\s+are)\b[\s\S]{0,40}\b(?:files?|folders?|contents?|names?)\b/i.test(prompt) ||
    /\b(?:tree|recursive(?:ly)?|subfolders?|nested\s+folders?)\b/i.test(prompt) ||
    /\binside\b[\s\S]{0,40}\b(?:their|its|the)\s+subfolders?\b/i.test(prompt);
  const formattedResults = results.map(result => {
    const toolResult = /^filesystem\.([a-z-]+)(?: \((.*)\))?: ([\s\S]+)$/.exec(result);
    if (!toolResult) return result;
    const [, toolName, path, serialized] = toolResult;
    if (!toolName || serialized === undefined) return result;
    try {
      const value: unknown = JSON.parse(serialized);
      if (!isRecord(value)) return result;
      if (toolName === 'search' && Array.isArray(value.matches)) {
        let matches = value.matches.filter(match =>
          isRecord(match) && typeof match.path === 'string' &&
          (match.type === 'file' || match.type === 'directory'));
        const projectSearch = /\b(?:project|repo|repository|codebase)\b/i.test(prompt);
        const matchingDirectories = matches.filter(match => match.type === 'directory');
        if (projectSearch && matchingDirectories.length > 0) {
          matches = matchingDirectories;
        }
        const locations = matches.map(match =>
          `- \`${match.path}\` (${match.type === 'directory' ? 'folder' : 'file'})`);
        const summary = locations.length === 0
          ? 'I couldn’t find a matching file or folder in the locations I could inspect.'
          : locations.length === 1
            ? projectSearch && matches[0]?.type === 'directory'
              ? `Your project folder is here: \`${matches[0].path}\`.`
              : `I found a matching ${matches[0]?.type === 'directory' ? 'folder' : 'file'} here:\n${locations[0]?.replace(/^- /, '')}`
            : projectSearch
              ? `I found these project folders:\n${locations.join('\n')}`
            : `I found these matching locations:\n${locations.join('\n')}`;
        if (typeof value.skippedDirectories === 'number' && value.skippedDirectories > 0) {
          return `${summary}\nI couldn’t inspect every directory, so there may be other matches.`;
        }
        return value.truncated === true
          ? `${summary}\nI couldn’t check every possible location, so there may be other matches.`
          : summary;
      }
      if ((toolName === 'list-directory' || toolName === 'directory-tree') &&
          Array.isArray(value.entries)) {
        const folders = value.entries.filter(entry =>
          isRecord(entry) && entry.type === 'directory');
        const files = value.entries.filter(entry =>
          isRecord(entry) && entry.type === 'file');
        const truncated = value.truncated === true;
        const total = folders.length + files.length;
        const location = typeof path === 'string' ? ` \`${path}\`` : '';
        const scope = toolName === 'list-directory' ? ' directly inside' : ' in the tree under';
        const counts = `${folders.length} ${folders.length === 1 ? 'folder' : 'folders'} and ${files.length} ${files.length === 1 ? 'file' : 'files'}`;
        const summary = truncated
          ? `I found ${total} entries${scope}${location}, including ${counts}. The listing was cut short, so there may be more.`
          : `I found ${counts}${scope}${location} (${total} ${total === 1 ? 'item' : 'items'} total).`;
        if (!includeNames) return summary;
        const entryNames = (entries: readonly unknown[]): string[] =>
          entries.flatMap(entry => {
            if (!isRecord(entry)) return [];
            const name = toolName === 'directory-tree' ? entry.path : entry.name;
            return typeof name === 'string' ? [name] : [];
          });
        const names = [
          `Folders: ${entryNames(folders).join(', ') || 'none'}`,
          `Files: ${entryNames(files).join(', ') || 'none'}`,
        ].join('\n');
        return `${summary}\n${names}`;
      }
      if (toolName === 'read-file' && typeof value.content === 'string') {
        if (markdownReadRequest && typeof path === 'string' && /\.(?:md|markdown)$/i.test(path)) {
          return `Read Markdown file \`${path}\` (${typeof value.bytes === 'number' ? value.bytes : 'unknown'} bytes).`;
        }
        return typeof path === 'string'
          ? `Here’s the content of \`${path}\`:\n${value.content}`
          : value.content;
      }
      return result;
    } catch {
      return result;
    }
  });
  const response = [
    ...formattedResults,
    ...(followupFailed ? ['I couldn’t complete the rest of the check, but the information above is verified.'] : []),
  ].join('\n\n');
  return response.length <= maxResponseChars
    ? response
    : 'The filesystem tool completed, but its verified result exceeds the configured response limit and cannot be shown.';
}

function filesystemPartialResultResponse(
  results: readonly string[],
  failureCode: string,
  failureMessage: string,
  maxResponseChars: number,
  prompt: string,
  markdownReadRequest = asksForMarkdownRead(prompt),
): string {
  const summary = filesystemResultResponse(
    results,
    maxResponseChars,
    prompt,
    false,
    markdownReadRequest,
  );
  const failureNote = failureCode === 'response-too-large' && markdownReadRequest
    ? 'I read the Markdown files listed above, but the model response exceeded its configured limit, so I couldn’t summarize their contents.'
    : failureCode === 'not-found' || /not found/i.test(failureMessage)
      ? 'I couldn’t find the location needed to finish the check.'
      : 'A later filesystem step failed, so the results above may be incomplete.';
  const response = `${summary}\n\n${failureNote}`;
  return response.length <= maxResponseChars
    ? response
    : 'A filesystem operation failed after a verified result; the partial result exceeds the configured response limit and cannot be shown.';
}

function asksForFileAnalysis(prompt: string): boolean {
  return /\b(?:explain|deep\s*dive|analy[sz]e|anly[sz]e|summari[sz]e|review)\b|\bwhat\s+(?:does|do|is)\b[\s\S]{0,80}\b(?:do|mean|work|purpose|project)\b|\bhow\s+(?:does|do)\b[\s\S]{0,80}\bwork\b/i.test(prompt);
}

function asksForProjectAnalysis(prompt: string): boolean {
  return /\b(?:project|repo|repository|codebase)\b/i.test(prompt) &&
    (/\b(?:deep\s*dive|analy[sz]e|anly[sz]e|analysis|review|understand|assess|audit)\b/i.test(prompt) ||
      asksForFileMutation(prompt));
}

function asksForMarkdownRead(prompt: string, recentUserContext = ''): boolean {
  const markdownMention = /\bmarkdown\b|\bmd\s+files?\b|\.md(?:\b|$)/i;
  const readIntent = /\b(?:read|open|inspect|review|summari[sz]e|understand)\b/i;
  return (readIntent.test(prompt) && markdownMention.test(prompt)) ||
    (markdownMention.test(recentUserContext) &&
      /\b(?:read|open|inspect|review|summari[sz]e|understand)\s+(?:those|them|these)\b/i.test(prompt));
}

function verifiedMarkdownFiles(
  trees: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const files = [...trees.values()].flatMap(paths =>
    [...paths].filter(path => /\.(?:md|markdown)$/i.test(path)));
  const priority = (path: string): number => {
    const name = path.split(/[\\/]/).at(-1)?.toLowerCase();
    if (name === 'readme.md' || name === 'readme.markdown') return 0;
    if (name === 'agents.md' || name === 'claude.md') return 1;
    if (name === 'contributing.md') return 2;
    return 3;
  };
  return [...new Set(files)].sort((left, right) =>
    priority(left) - priority(right) || left.localeCompare(right));
}

function asksForTestAnalysis(prompt: string): boolean {
  return /\btests?\b/i.test(prompt);
}

function hasRequiredProjectAnalysisReads(
  prompt: string,
  readFilePaths: ReadonlySet<string>,
): boolean {
  if (readFilePaths.size === 0) return false;
  return !asksForTestAnalysis(prompt) ||
    [...readFilePaths].some(path => /(?:^|[/_.-])(?:tests?|__tests__|spec)(?:[/_.-]|$)/i.test(path));
}

function asksForFileMutation(prompt: string): boolean {
  const action = /\b(?:create|write|fix|implement|refactor|edit|modify|change|replace|update|delete|remove)\b/i;
  const subject = /\b(?:file|folder|directory|code|codebase|project|repo|repository)\b|(?:^|\s)\/[^\s"'`]+/i;
  return action.test(prompt) && subject.test(prompt);
}

function dropsExistingComments(original: string, proposed: string, path: string): boolean {
  const extension = extname(path).toLowerCase();
  const supportsHashComments = new Set([
    '.py', '.sh', '.bash', '.zsh', '.yml', '.yaml', '.toml', '.rb', '.pl', '.r', '.ini', '.conf',
  ]).has(extension);
  const supportsSlashComments = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.java', '.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.css', '.swift',
  ]).has(extension);
  const supportsHtmlComments = new Set(['.html', '.htm', '.xml', '.md', '.markdown']).has(extension);
  let inBlockComment = false;
  const originalComments: string[] = [];
  for (const line of original.split(/\r?\n/u)) {
    const trimmed = line.trimStart();
    const lineComment = (supportsSlashComments && trimmed.startsWith('//')) ||
      (supportsHashComments && trimmed.startsWith('#') && !trimmed.startsWith('#!')) ||
      (supportsHtmlComments && (trimmed.startsWith('<!--') || trimmed.startsWith('-->')));
    if (lineComment || inBlockComment || (supportsSlashComments && trimmed.startsWith('/*'))) {
      originalComments.push(line);
    }
    if (supportsSlashComments && trimmed.startsWith('/*')) inBlockComment = true;
    if (inBlockComment && trimmed.includes('*/')) inBlockComment = false;
  }
  if (originalComments.length === 0) return false;
  const proposedLines = new Set(proposed.split(/\r?\n/u));
  return originalComments.some(line => !proposedLines.has(line));
}

const COMMENT_PRESERVATION_ERROR =
  'The proposed full-file edit removes existing comments. Preserve unrelated comments or use a localized text replacement.';

function explicitlyRequestsCommentChange(prompt: string): boolean {
  return /\b(?:remove|delete|drop|change|update|rewrite)\s+(?:(?:all|the|existing|this)\s+)*(?:comments?|documentation)\b/i.test(prompt);
}

function exactTextReplacement(prompt: string): { readonly oldText: string; readonly newText: string } | undefined {
  const match = /\breplace\s+(?:the\s+)?(?:exact\s+)?(?:text\s+)?(["'`])([^"'`]{1,4096})\1\s+with\s+(["'`])([^"'`]{0,4096})\3/i.exec(prompt);
  if (!match || match[1] !== match[3] || match[2] === undefined || match[4] === undefined) {
    return undefined;
  }
  return { oldText: match[2], newText: match[4] };
}

function completeUpdatedFileFromResponse(text: string): string | undefined {
  if (!/\b(?:complete|full)\s+(?:updated|replacement)\s+file\b/i.test(text)) return undefined;
  const codeBlocks = [...text.matchAll(/```[^\r\n]*\r?\n([\s\S]*?)```/g)];
  return codeBlocks.length === 1 ? codeBlocks[0]?.[1] : undefined;
}

function proposalFromFinalResponse(
  prompt: string,
  text: string,
  path: string,
): { readonly toolId: string; readonly arguments: Readonly<Record<string, unknown>> } | undefined {
  const replacement = exactTextReplacement(prompt);
  if (replacement) {
    return {
      toolId: 'filesystem.propose-replace-text',
      arguments: { path, oldText: replacement.oldText, newText: replacement.newText },
    };
  }
  const content = completeUpdatedFileFromResponse(text);
  return content === undefined
    ? undefined
    : { toolId: 'filesystem.propose-edit', arguments: { path, content } };
}

function verifiedFileOperationResponse(results: readonly string[]): string | undefined {
  const outcomes = results.flatMap(result => {
    let value: unknown;
    try {
      value = JSON.parse(result);
    } catch {
      return [];
    }
    if (!isRecord(value) || (value.status !== 'applied' && value.status !== 'rejected')) return [];
    const operation = value.operation === 'edit-file'
      ? 'edit'
      : value.operation === 'create-file'
        ? 'file creation'
        : value.operation === 'create-directory'
          ? 'folder creation'
          : value.operation === 'delete'
            ? 'deletion'
            : undefined;
    if (!operation) return [];
    return [value.status === 'applied'
      ? `The approved ${operation} was applied.`
      : `The proposed ${operation} was rejected. No changes were made.`];
  });
  return outcomes.length > 0 ? outcomes.join('\n') : undefined;
}

function latestVerifiedSearchDirectory(messages: ReturnType<Session['messages']>): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'tool' || message.toolId !== 'filesystem.search') continue;
    let value: unknown;
    try {
      value = JSON.parse(message.content);
    } catch {
      return undefined;
    }
    if (!isRecord(value) || !Array.isArray(value.matches)) return undefined;
    const match = value.matches.find(candidate =>
      isRecord(candidate) &&
      candidate.type === 'directory' &&
      typeof candidate.path === 'string' &&
      candidate.path.startsWith('/') &&
      !candidate.path.split('/').includes('..'));
    if (
      isRecord(match) &&
      typeof match.path === 'string'
    ) {
      return match.path;
    }
    return undefined;
  }
  return undefined;
}

function exactQuotedAbsolutePath(prompt: string): string | undefined {
  const matches = [...prompt.matchAll(/(["'`])(\/[^\r\n]{1,4096}?)\1/g)];
  return matches.length === 1 ? matches[0]?.[2] : undefined;
}

function pathWithinConfiguredRoots(
  path: string,
  roots: readonly string[],
): boolean {
  if (!isAbsolute(path)) return false;
  const resolvedPath = resolve(path);
  return roots.some(root => {
    const fromRoot = relative(resolve(root), resolvedPath);
    return fromRoot === '' ||
      (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`));
  });
}

function explicitProjectRoot(
  prompt: string,
  allowedRoots: readonly string[],
): string | undefined {
  const match = /\b(?:project|repo(?:sitory)?|codebase)(?:\s+(?:path|directory|folder))?\s*(?::|\bat\b|\bis\b)\s*["'`]?(\/[^\s"'`]+)/i.exec(prompt);
  const candidate = match?.[1]?.replace(/[.,;!?)}\]]+$/u, '');
  return candidate && pathWithinConfiguredRoots(candidate, allowedRoots)
    ? resolve(candidate)
    : undefined;
}

function requestedProjectFilePath(prompt: string): string | undefined {
  const match = /(?:^|[\s"'`])((?:[A-Za-z0-9_@.+-]+[/\\])+[A-Za-z0-9_@.+-]+\.(?:tsx?|jsx?|mjs|cjs|json|py|go|rs|java|swift|css|html))(?=$|[\s"'`.,!?;:)])/i.exec(prompt);
  const candidate = match?.[1]?.replaceAll('\\', '/').replace(/^\.\//u, '');
  return candidate && !candidate.split('/').includes('..') ? candidate : undefined;
}

function verifiedProjectFile(
  trees: ReadonlyMap<string, ReadonlySet<string>>,
  relativePath: string,
): string | undefined {
  if (relativePath.split(/[\\/]/).includes('..')) return undefined;
  if (isAbsolute(relativePath)) {
    const candidate = resolve(relativePath);
    return [...trees.values()].some(files => files.has(candidate)) ? candidate : undefined;
  }
  for (const [root, files] of trees) {
    const candidate = resolve(root, relativePath.replaceAll('\\', sep));
    if (files.has(candidate)) return candidate;
  }
  return undefined;
}

function executionArguments(
  prompt: string,
  toolId: string,
  arguments_: Readonly<Record<string, unknown>>,
  batchSize: number,
  recentSearchDirectory?: string,
  tools: ReturnType<ToolExecutor['modelTools']> = [],
  allowedRoots: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  const tool = tools.find(candidate => candidate.id === toolId);
  const normalizedArguments = { ...arguments_ };
  if (tool) {
    const required = new Set(tool.parameters.required ?? []);
    for (const [name, property] of Object.entries(tool.parameters.properties)) {
      if (property.type !== 'integer' || required.has(name) ||
          !Object.hasOwn(normalizedArguments, name)) continue;
      const value = normalizedArguments[name];
      if (typeof value === 'number' && Number.isSafeInteger(value) &&
          (property.minimum === undefined || value >= property.minimum) &&
          (property.maximum === undefined || value <= property.maximum)) {
        continue;
      }
      if (typeof value === 'string' && /^-?\d+$/.test(value)) {
        const parsed = Number(value);
        if (
          Number.isSafeInteger(parsed) &&
          (property.minimum === undefined || parsed >= property.minimum) &&
          (property.maximum === undefined || parsed <= property.maximum)
        ) {
          normalizedArguments[name] = parsed;
          continue;
        }
      }
      delete normalizedArguments[name];
    }
  }
  if (
    ['filesystem.list-directory', 'filesystem.directory-tree'].includes(toolId) &&
    recentSearchDirectory &&
    !prompt.includes('/') &&
    /\b(?:repository|repo|project|folder|directory|files?|folders?|it|that|there|under|subfolders?)\b/i.test(prompt)
  ) {
    return { ...normalizedArguments, path: recentSearchDirectory };
  }
  if (toolId === 'filesystem.search') {
    const searchArguments = normalizedArguments;
    if (
      typeof searchArguments.path === 'string' &&
      isAbsolute(searchArguments.path) &&
      !pathWithinConfiguredRoots(searchArguments.path, allowedRoots) &&
      !/(?:^|\s)(?:\/|[A-Za-z]:[\\/])(?:[^\s"'`]+)?/.test(prompt)
    ) {
      delete searchArguments.path;
    }
    const genericProjectFollowup =
      /\b(?:project|repo|repository|codebase)\b/i.test(prompt) &&
      !/\b[a-z0-9_-]{3,}\b/i.test(prompt.replace(
        /\b(?:where|is|my|the|this|that|project|repo|repository|codebase|in|on|laptop|system|directory|folder|again|once|more|check|search|find|look|for|locate|it)\b/giu,
        ' ',
      ));
    const repeatedSearch =
      /\b(?:check|search|look)\b[\s\S]{0,24}\b(?:again|once\s+more)\b/i.test(prompt);
    if (recentSearchDirectory && (genericProjectFollowup || repeatedSearch)) {
      searchArguments.query = recentSearchDirectory.split('/').at(-1) ?? searchArguments.query;
      searchArguments.path =
        recentSearchDirectory.slice(0, recentSearchDirectory.lastIndexOf('/')) || '/';
    }
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
    return normalizedArguments;
  }
  const exactPath = exactQuotedAbsolutePath(prompt);
  if (!exactPath || normalizedArguments.path === exactPath) return normalizedArguments;
  return { ...normalizedArguments, path: exactPath };
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
  const canOpenApplications = options.tools.modelTools().some(tool => tool.id === 'application.open');
  const unsupportedResponse = unsupportedCapability(
    prompt,
    canProposeEdits,
    canOpenApplications,
  );
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
  let applicationLaunchCompleted = false;
  const fileOperationResults: string[] = [];
  const readFilePaths = new Set<string>();
  const verifiedFileContents = new Map<string, string>();
  const verifiedTreeFilesByRoot = new Map<string, Set<string>>();
  let markdownTreeTruncated = false;
  const filesystemToolResults: string[] = [];
  let editToolRepairInstruction: string | undefined;
  let editToolRepairAttempts = 0;
  let projectAnalysisRepairAttempts = 0;
  let projectAnalysisRepairInstruction: string | undefined;
  let markdownReadRepairAttempts = 0;
  let markdownReadRepairInstruction: string | undefined;
  let markdownPartialSummaryRequested = false;
  const toolAttempts = new Map<string, number>();
  const recentUserContext = options.session.messages()
    .slice(0, -1)
    .filter(message => message.role === 'user')
    .slice(-3)
    .map(message => message.content)
    .join('\n');
  const markdownReadRequest = asksForMarkdownRead(prompt, recentUserContext);
  const recentSearchDirectory = latestVerifiedSearchDirectory(options.session.messages());
  const currentTurnMessages = () => {
    const messages = options.session.messages();
    if (!markdownReadRequest) return [...messages];
    let currentUserIndex = messages.length - 1;
    while (currentUserIndex > 0 && messages[currentUserIndex]?.role !== 'user') {
      currentUserIndex--;
    }
    return messages.slice(currentUserIndex);
  };
  const promptTools = filesystemToolsForPrompt(
    prompt,
    recentUserContext,
    recentSearchDirectory !== undefined,
    options.tools.modelTools(),
  );
  const availableTools = requestedApplicationId(prompt) !== undefined
    ? promptTools
    : promptTools.filter(tool => tool.id !== 'application.open');
  const returnPartialFilesystemResult = (
    error: { readonly code: string; readonly message: string },
    iteration: number,
  ): string => {
    const response = filesystemPartialResultResponse(
      filesystemToolResults,
      error.code,
      error.message,
      options.config.maxResponseChars,
      prompt,
      markdownReadRequest,
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
    const markdownFiles = verifiedMarkdownFiles(verifiedTreeFilesByRoot);
    const unreadMarkdownFiles = markdownFiles.filter(path => !readFilePaths.has(path));
    const analysisRepairTools = markdownReadRequest
      ? availableTools.filter(tool =>
        tool.id === (
          successfulToolIds.has('filesystem.directory-tree')
            ? unreadMarkdownFiles.length > 0 ? 'filesystem.read-file' : ''
            : 'filesystem.directory-tree'
        ))
      : !asksForProjectAnalysis(prompt)
        ? availableTools
        : hasRequiredProjectAnalysisReads(prompt, readFilePaths)
          ? asksForFileMutation(prompt)
            ? availableTools.filter(tool => tool.id.startsWith('filesystem.propose-'))
            : []
          : availableTools.filter(tool =>
            tool.id === (
              successfulToolIds.has('filesystem.directory-tree')
                ? 'filesystem.read-file'
                : 'filesystem.directory-tree'
            ));
    const iterationTools =
      toolCalls < options.config.maxToolCalls ? analysisRepairTools : [];
    let rawResponse: unknown;
    try {
      rawResponse = await runBounded(
        providerSignal => options.provider.complete(
          editToolRepairInstruction || markdownReadRepairInstruction || projectAnalysisRepairInstruction
            ? [
              ...currentTurnMessages(),
              {
                role: 'user',
                content: editToolRepairInstruction ??
                  markdownReadRepairInstruction ??
                  projectAnalysisRepairInstruction ??
                  '',
              },
            ]
            : currentTurnMessages(),
          providerSignal,
            iterationTools,
          options.onText,
        ),
        options.config.requestTimeoutMs,
        signal,
      );
    } catch (error) {
      if (
        markdownReadRequest &&
        error instanceof ProviderError &&
        error.code === 'response-too-large' &&
        filesystemToolResults.length === 0
      ) {
        if (markdownReadRepairAttempts === 0 && toolCalls < options.config.maxToolCalls) {
          markdownReadRepairAttempts++;
          markdownReadRepairInstruction =
            'Retry with one concise filesystem.directory-tree call for the requested project. Do not output file contents or explanations in this step.';
          continue;
        }
        const safeResponse =
          'Ollama exceeded its response limit before I could verify the project files. No Markdown contents were read.';
        options.session.add({ role: 'assistant', content: safeResponse });
        task.needsAttention();
        options.logger.emit({
          event: 'request.completed',
          taskId: task.taskId,
          runId: task.runId,
          durationMs: Date.now() - start,
          iterations: iteration,
        });
        return safeResponse;
      }
      if (
        filesystemToolResults.length > 0 &&
        ((error instanceof OperationStoppedError && error.reason === 'timeout') ||
          (error instanceof ProviderError && error.code !== 'cancelled'))
      ) {
        const partialResponse = markdownReadRequest &&
            error instanceof ProviderError &&
            error.code === 'response-too-large'
          ? filesystemPartialResultResponse(
            filesystemToolResults,
            error.code,
            error.message,
            options.config.maxResponseChars,
            prompt,
            true,
          )
          : filesystemResultResponse(
            filesystemToolResults,
            options.config.maxResponseChars,
            prompt,
            true,
            markdownReadRequest,
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
      if (markdownReadRequest && successfulToolIds.has('filesystem.directory-tree')) {
        const markdownFiles = verifiedMarkdownFiles(verifiedTreeFilesByRoot);
        const unreadMarkdownFiles = markdownFiles.filter(path => !readFilePaths.has(path));
        if (markdownFiles.length === 0) {
          const safeResponse = 'I checked the verified project tree and found no Markdown files to read.';
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
        if (
          unreadMarkdownFiles.length > 0 &&
          toolCalls < options.config.maxToolCalls &&
          markdownReadRepairAttempts < 3
        ) {
          markdownReadRepairAttempts++;
          markdownReadRepairInstruction =
            `Read the next unread Markdown file from the verified tree, using this exact path: ${unreadMarkdownFiles[0]}. After reading the available files, summarize what the project is in a few sentences. Do not reproduce document text.`;
          continue;
        }
        if (readFilePaths.size === 0) {
          const safeResponse = 'I found Markdown files in the project, but I couldn’t verify their contents, so I can’t describe what they say.';
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
        const markdownReadIsPartial = unreadMarkdownFiles.length > 0 || markdownTreeTruncated;
        if (markdownReadIsPartial && !markdownPartialSummaryRequested) {
          markdownPartialSummaryRequested = true;
          markdownReadRepairAttempts++;
          markdownReadRepairInstruction =
            `Summarize only the Markdown files actually read. State that the read was partial${unreadMarkdownFiles.length > 0 ? `; ${unreadMarkdownFiles.length} Markdown file(s) in the verified tree remain unread` : ''}${markdownTreeTruncated ? '; the Markdown file listing was truncated' : ''}. Keep the answer to a few sentences and do not reproduce document text.`;
          continue;
        }
        markdownReadRepairInstruction = markdownReadIsPartial
          ? `Summarize only the Markdown files actually read. State that the read was partial${unreadMarkdownFiles.length > 0 ? `; ${unreadMarkdownFiles.length} Markdown file(s) in the verified tree remain unread` : ''}${markdownTreeTruncated ? '; the Markdown file listing was truncated' : ''}. Keep the answer to a few sentences and do not reproduce document text.`
          : 'Summarize what the project is in a few sentences using only the Markdown files actually read. Do not reproduce document text or claim to have read any other files.';
        if (markdownPartialSummaryRequested && markdownReadIsPartial) {
          response = {
            kind: 'final',
            text: `${response.text}\n\nNote: I could read only part of the Markdown documentation; some files may be unread.`,
          };
        }
      }
      if (
        asksForProjectAnalysis(prompt) &&
        filesystemToolResults.length > 0 &&
        !hasRequiredProjectAnalysisReads(prompt, readFilePaths)
      ) {
        if (projectAnalysisRepairAttempts < 3 && toolCalls < options.config.maxToolCalls) {
          projectAnalysisRepairAttempts++;
          projectAnalysisRepairInstruction = readFilePaths.size > 0
            ? 'The user asked about tests, but no test file has been read yet. Use filesystem.read-file on a relevant test file using its exact path from the verified tree. Do not draw conclusions about the tests until you have read one.'
            : successfulToolIds.has('filesystem.directory-tree')
              ? 'You have verified only file names, not source contents. Call filesystem.read-file on the relevant source files and any test files the user asked about, using exact paths from the verified tree. Then base conclusions only on those contents.'
              : 'You have not read any source contents. A filename search is not enough for project analysis. Use filesystem.directory-tree on the exact project directory from the user request or verified search result. Do not search for phrases like “entry point”.';
          continue;
        }
        const safeResponse = readFilePaths.size > 0 && asksForTestAnalysis(prompt)
          ? 'I inspected some project files, but I couldn’t verify the requested test because I wasn’t able to read a test file.'
          : 'I mapped the project structure, but I haven’t read its source files yet, so I can’t give a verified code analysis.';
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
      const readPath = readFilePaths.size === 1 ? [...readFilePaths][0] : undefined;
      const fallbackProposal = readPath === undefined || fileOperationResults.length > 0
        ? undefined
        : proposalFromFinalResponse(prompt, response.text, readPath);
      if (
        fallbackProposal?.toolId === 'filesystem.propose-edit' &&
        typeof fallbackProposal.arguments.path === 'string' &&
        typeof fallbackProposal.arguments.content === 'string' &&
        !explicitlyRequestsCommentChange(prompt) &&
        dropsExistingComments(
          verifiedFileContents.get(resolve(fallbackProposal.arguments.path)) ?? '',
          fallbackProposal.arguments.content,
          fallbackProposal.arguments.path,
        )
      ) {
        if (editToolRepairAttempts === 0 && toolCalls < options.config.maxToolCalls) {
          editToolRepairAttempts++;
          editToolRepairInstruction =
            'Correction: this complete file edit removes an existing comment. Preserve all unrelated comments and make only the requested change. For a localized change, use filesystem.propose-replace-text with the exact source snippet.';
          continue;
        }
        const safeResponse = 'I couldn’t prepare a safe edit without removing existing comments, so no files were changed.';
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
      if (fallbackProposal && toolCalls < options.config.maxToolCalls) {
        const proposalContext = task.context(randomUUID(), 1);
        options.logger.emit({
          event: 'tool.requested',
          ...proposalContext,
          toolId: fallbackProposal.toolId,
          argumentKeys: Object.keys(fallbackProposal.arguments).sort(),
        });
        options.session.add({
          role: 'assistant',
          kind: 'tool-call',
          content: response.text,
          toolCalls: [{
            toolId: fallbackProposal.toolId,
            arguments: fallbackProposal.arguments,
          }],
        });
        options.logger.emit({
          event: 'tool.invoked',
          ...proposalContext,
          toolId: fallbackProposal.toolId,
        });
        const result = await options.tools.execute(
          fallbackProposal.toolId,
          fallbackProposal.arguments,
          signal,
          proposalContext,
        );
        const serialized = JSON.stringify(result);
        if (serialized === undefined || serialized.length > options.config.maxToolOutputChars) {
          throw new ToolExecutionError(
            'Tool result exceeded the configured safety limit; success cannot be confirmed.',
            'output-too-large',
          );
        }
        toolCalls++;
        options.session.add({
          role: 'tool',
          toolId: fallbackProposal.toolId,
          content: serialized,
        });
        successfulToolIds.add(fallbackProposal.toolId);
        fileOperationResults.push(serialized);
        if (
          typeof result === 'object' &&
          result !== null &&
          'status' in result &&
          result.status === 'applied'
        ) {
          appliedFileOperationToolIds.add(fallbackProposal.toolId);
        }
        const operationResponse = verifiedFileOperationResponse(fileOperationResults);
        if (operationResponse) {
          options.session.add({ role: 'assistant', content: operationResponse });
          options.logger.emit({
            event: 'request.completed',
            taskId: task.taskId,
            runId: task.runId,
            durationMs: Date.now() - start,
            iterations: iteration,
          });
          return operationResponse;
        }
      }
      if (
        fileOperationResults.length === 0 &&
        readFilePaths.size > 0 &&
        asksForFileMutation(prompt)
      ) {
        if (editToolRepairAttempts === 0 && toolCalls < options.config.maxToolCalls) {
          editToolRepairAttempts++;
          editToolRepairInstruction =
            'Correction: no file-change proposal has been submitted. Use the available file tool now: for a localized change, call filesystem.propose-replace-text with the exact existing snippet and replacement; for a broader change, call filesystem.propose-edit with the complete updated file. Do not ask the user to provide the file contents, and do not claim a proposal exists unless the tool call succeeds.';
          continue;
        }
        const safeResponse = 'I couldn’t prepare a reviewed file-change proposal, so no files were changed.';
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
      const verifiedFileOperation = verifiedFileOperationResponse(fileOperationResults);
      if (verifiedFileOperation) {
        options.session.add({ role: 'assistant', content: verifiedFileOperation });
        options.logger.emit({
          event: 'request.completed',
          taskId: task.taskId,
          runId: task.runId,
          durationMs: Date.now() - start,
          iterations: iteration,
        });
        return verifiedFileOperation;
      }
      if (claimsUnverifiedApplicationLaunch(response.text, applicationLaunchCompleted)) {
        const safeResponse =
          'I cannot confirm the application opened because no successful application-launch result was recorded.';
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
          'I haven’t read a file in this conversation, so I can’t confirm its contents.';
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
          'I haven’t listed a folder yet, so I can’t confirm what’s inside it.';
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
        !readOnlyProjectContext &&
        !(successfulToolIds.has('filesystem.read-file') &&
          (asksForFileAnalysis(prompt) || markdownReadRequest))
      ) {
        const finalResponse = filesystemResultResponse(
          filesystemToolResults,
          options.config.maxResponseChars,
          prompt,
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

    const allowedToolIds = new Set(iterationTools.map(tool => tool.id));
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
    const readFilePathsBeforeBatch = new Set(readFilePaths);
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
    for (const [callIndex, { call, attempt, toolCallId, context }] of proposedCalls.entries()) {
      toolCalls++;
      if (task.state === 'planning') task.transition('running');
      options.logger.emit({
        event: 'tool.invoked',
        ...context,
        toolId: call.toolId,
      });
      try {
        let args = executionArguments(
          prompt,
          call.toolId,
          call.arguments,
          response.calls.length,
          recentSearchDirectory,
          availableTools,
          options.config.filesystemAllowedRoots,
        );
        if (
          call.toolId === 'filesystem.directory-tree' &&
          (asksForProjectAnalysis(prompt) || markdownReadRequest)
        ) {
          const projectRoot =
            explicitProjectRoot(prompt, options.config.filesystemAllowedRoots) ??
            (markdownReadRequest ? recentSearchDirectory : undefined);
          args = {
            ...args,
            ...(projectRoot === undefined ? {} : { path: projectRoot }),
            maxDepth: options.config.maxTreeDepth,
            maxEntries: options.config.maxDirectoryEntries,
          };
        }
        if (
          call.toolId === 'filesystem.read-file' &&
          asksForProjectAnalysis(prompt) &&
          verifiedTreeFilesByRoot.size > 0
        ) {
          const requestedPath = requestedProjectFilePath(prompt);
          const requestedFile = requestedPath === undefined
            ? undefined
            : verifiedProjectFile(verifiedTreeFilesByRoot, requestedPath);
          const hasReadRequestedFile = requestedFile !== undefined && readFilePaths.has(requestedFile);
          const hasReadTestFile = [...readFilePaths].some(path =>
            /(?:^|[/_.-])(?:tests?|__tests__|spec)(?:[/_.-]|$)/i.test(path));
          const testFile = [...verifiedTreeFilesByRoot.values()].flatMap(files =>
            [...files].filter(path =>
              /(?:^|[/_.-])(?:tests?|__tests__|spec)(?:[/_.-]|$)/i.test(path) ||
              /\.(?:test|spec)\.[^.]+$/i.test(path))
              .sort((left, right) => left.localeCompare(right)),
          )[0];
          if (requestedFile && !hasReadRequestedFile) {
            args = { ...args, path: requestedFile };
          } else if (
            asksForTestAnalysis(prompt) &&
            !hasReadTestFile &&
            testFile &&
            readFilePaths.size > 0
          ) {
            args = { ...args, path: testFile };
          }
        }
        if (
          ['filesystem.propose-edit', 'filesystem.propose-replace-text'].includes(call.toolId) &&
          asksForProjectAnalysis(prompt) &&
          verifiedTreeFilesByRoot.size > 0
        ) {
          const requestedPath = requestedProjectFilePath(prompt);
          const requestedFile = requestedPath === undefined
            ? undefined
            : verifiedProjectFile(verifiedTreeFilesByRoot, requestedPath);
          const modelPath = typeof args.path === 'string'
            ? verifiedProjectFile(verifiedTreeFilesByRoot, args.path)
            : undefined;
          if (requestedFile ?? modelPath) {
            args = { ...args, path: requestedFile ?? modelPath };
          }
        }
        if (
          call.toolId === 'filesystem.read-file' &&
          typeof args.path === 'string' &&
          !args.path.split(/[\\/]/).includes('..')
        ) {
          const requestedPath = args.path;
          for (const [treeRoot, treeFiles] of verifiedTreeFilesByRoot) {
            const exactPath = resolve(requestedPath);
            const suffixMatches = isAbsolute(requestedPath)
              ? [...treeFiles].filter(file =>
                requestedPath.endsWith(relative(treeRoot, file)))
              : [];
            const verifiedPath = isAbsolute(requestedPath)
              ? treeFiles.has(exactPath)
                ? exactPath
                : suffixMatches.length === 1 ? suffixMatches[0] : undefined
              : resolve(treeRoot, requestedPath);
            if (verifiedPath && treeFiles.has(verifiedPath)) {
              args = { ...args, path: verifiedPath };
              break;
            }
          }
        }
        if (
          call.toolId === 'filesystem.read-file' &&
          markdownReadRequest &&
          verifiedTreeFilesByRoot.size > 0
        ) {
          const nextMarkdownFile = verifiedMarkdownFiles(verifiedTreeFilesByRoot)
            .find(path => !readFilePaths.has(path));
          if (nextMarkdownFile) args = { ...args, path: nextMarkdownFile };
        }
        let executionToolId = call.toolId;
        let executionToolArguments = args;
        const explicitReplacement = call.toolId === 'filesystem.propose-edit'
          ? exactTextReplacement(prompt)
          : undefined;
        if (explicitReplacement) {
          executionToolId = 'filesystem.propose-replace-text';
          executionToolArguments = {
            path: args.path,
            oldText: explicitReplacement.oldText,
            newText: explicitReplacement.newText,
          };
        }
        if (['filesystem.propose-edit', 'filesystem.propose-replace-text'].includes(call.toolId)) {
          if (typeof args.path !== 'string') {
            throw new ToolExecutionError('An exact target path is required for an edit.', 'invalid-input');
          }
          const editPath = resolve(args.path);
          if (!readFilePathsBeforeBatch.has(editPath)) {
            if (!readFilePaths.has(editPath)) {
              const remainingCalls = proposedCalls.length - callIndex - 1;
              if (toolCalls + 1 + remainingCalls > options.config.maxToolCalls) {
                throw new AgentError('Tool call limit reached before the target file could be reviewed.', 'tool-limit');
              }
              const readContext = task.context(randomUUID(), 1);
              options.logger.emit({
                event: 'tool.invoked',
                ...readContext,
                toolId: 'filesystem.read-file',
              });
              const readResult = await options.tools.execute(
                'filesystem.read-file',
                { path: args.path },
                signal,
                readContext,
              );
              const serializedReadResult = JSON.stringify(readResult);
              if (
                serializedReadResult === undefined ||
                serializedReadResult.length > options.config.maxToolOutputChars
              ) {
                throw new ToolExecutionError(
                  'The target file could not be reviewed within the configured output limit.',
                  'output-too-large',
                );
              }
              options.session.add({
                role: 'tool',
                toolId: 'filesystem.read-file',
                content: serializedReadResult,
              });
              successfulToolIds.add('filesystem.read-file');
              readFilePaths.add(editPath);
              if (isRecord(readResult) && typeof readResult.content === 'string') {
                verifiedFileContents.set(editPath, readResult.content);
              }
              filesystemToolResults.push(
                `filesystem.read-file (${args.path}): ${serializedReadResult}`,
              );
              toolCalls++;
            }
            if (executionToolId !== 'filesystem.propose-replace-text') {
              options.session.add({
                role: 'tool',
                toolId: call.toolId,
                content: JSON.stringify({
                  ok: false,
                  error: 'Edit proposal not created. Review the file contents, then propose a complete updated file.',
                }),
              });
              options.logger.emit({
                event: 'tool.failed',
                ...context,
                toolId: call.toolId,
                code: 'invalid-input',
              });
              continue;
            }
          }
        }
        if (
          executionToolId === 'filesystem.propose-edit' &&
          typeof executionToolArguments.path === 'string' &&
          typeof executionToolArguments.content === 'string' &&
          !explicitlyRequestsCommentChange(prompt) &&
          dropsExistingComments(
            verifiedFileContents.get(resolve(executionToolArguments.path)) ?? '',
            executionToolArguments.content,
            executionToolArguments.path,
          )
        ) {
          throw new ToolExecutionError(
            COMMENT_PRESERVATION_ERROR,
            'invalid-input',
          );
        }
        const result = await options.tools.execute(executionToolId, executionToolArguments, signal, context);
        const serialized = JSON.stringify(result);
        if (serialized === undefined || serialized.length > options.config.maxToolOutputChars) {
          throw new ToolExecutionError(
            'Tool result exceeded the configured safety limit; success cannot be confirmed.',
            'output-too-large',
          );
        }
        if (
          call.toolId === 'filesystem.directory-tree' &&
          typeof args.path === 'string' &&
          isAbsolute(args.path) &&
          isRecord(result) &&
          Array.isArray(result.entries)
        ) {
          const treeRoot = resolve(args.path);
          if (markdownReadRequest && result.truncated === true) {
            markdownTreeTruncated = true;
          }
          const treeFiles = new Set<string>();
          for (const entry of result.entries) {
            if (
              !isRecord(entry) ||
              entry.type !== 'file' ||
              typeof entry.path !== 'string' ||
              isAbsolute(entry.path) ||
              entry.path.split(/[\\/]/).includes('..')
            ) continue;
            treeFiles.add(resolve(treeRoot, entry.path));
          }
          verifiedTreeFilesByRoot.set(treeRoot, treeFiles);
        }
        options.session.add({ role: 'tool', toolId: call.toolId, content: serialized });
        successfulToolIds.add(call.toolId);
        if (
          call.toolId === 'application.open' &&
          isRecord(result) &&
          result.status === 'opened' &&
          result.application === requestedApplicationId(prompt)
        ) {
          applicationLaunchCompleted = true;
        }
        if (
          call.toolId === 'filesystem.directory-tree' &&
          asksForProjectAnalysis(prompt)
        ) {
          projectAnalysisRepairAttempts = Math.max(projectAnalysisRepairAttempts, 1);
          projectAnalysisRepairInstruction =
            'You have verified the project file names. Read at most one relevant entry-point/source file and, if the user asked about tests, one relevant test file, using exact paths from the tree. Call filesystem.read-file for these files (preferably together) and do not spend calls rereading the tree, README, or package metadata unless directly relevant. Then base conclusions only on those contents.';
        }
        if (call.toolId === 'filesystem.directory-tree' && markdownReadRequest) {
          const markdownFiles = verifiedMarkdownFiles(verifiedTreeFilesByRoot);
          markdownReadRepairInstruction = markdownFiles.length > 0
            ? `Read the Markdown files from the verified tree, starting with this exact path: ${markdownFiles[0]}. After the files have been read, summarize what the project is in a few sentences.${markdownTreeTruncated ? ' The tree was truncated, so clearly state that this is a partial read.' : ''} Do not reproduce document text.`
            : 'The verified project tree contains no Markdown files. Report that clearly without guessing about the project.';
        }
        if (call.toolId.startsWith('filesystem.propose-')) {
          fileOperationResults.push(serialized);
        }
        if (
          call.toolId.startsWith('filesystem.propose-') &&
          typeof result === 'object' &&
          result !== null &&
          'status' in result &&
          result.status === 'applied'
        ) {
          appliedFileOperationToolIds.add(call.toolId);
        }
        if (call.toolId === 'filesystem.read-file' && typeof args.path === 'string') {
          const readPath = resolve(args.path);
          readFilePaths.add(readPath);
          if (isRecord(result) && typeof result.content === 'string') {
            verifiedFileContents.set(readPath, result.content);
          }
          if (markdownReadRequest) {
            const unreadMarkdownFiles = verifiedMarkdownFiles(verifiedTreeFilesByRoot)
              .filter(path => !readFilePaths.has(path));
            markdownReadRepairInstruction = unreadMarkdownFiles.length > 0
              ? `Continue reading the next Markdown file from the verified tree, starting with this exact path: ${unreadMarkdownFiles[0]}. Once the available Markdown files have been read, summarize the project in a few sentences using only that content.${markdownTreeTruncated ? ' The tree was truncated, so clearly state that this is a partial read.' : ''} Do not reproduce document text.`
              : markdownTreeTruncated
                ? 'Summarize what the project is in a few sentences using only the Markdown files actually read. Clearly state that the tree was truncated and the read is partial. Do not reproduce document text.'
                : 'All selected Markdown files have been read. Summarize what the project is in a few sentences using only those files; do not reproduce document text or claim to have read other files.';
          }
          if (asksForProjectAnalysis(prompt) && projectAnalysisRepairAttempts > 0) {
            projectAnalysisRepairInstruction = hasRequiredProjectAnalysisReads(prompt, readFilePaths)
                ? asksForFileMutation(prompt)
                  ? 'You now have the required verified project and test contents. Make the requested code change using only the available filesystem.propose-* tools. Read the target before editing if needed, submit a complete reviewed proposal, and do not claim changes were applied before user approval.'
                  : 'You now have the required verified file contents. Do not call more tools or ask the user to provide files; answer the requested project analysis using only those contents and clearly qualify anything the files do not establish.'
              : 'The user asked about tests, but no test file has been read yet. Use filesystem.read-file on a relevant test file using its exact path from the verified tree. Do not draw conclusions about the tests until you have read one.';
          }
        }
        if (
          call.toolId.startsWith('filesystem.') &&
          !call.toolId.startsWith('filesystem.propose-')
        ) {
          const listingPath =
            ['filesystem.list-directory', 'filesystem.directory-tree', 'filesystem.read-file'].includes(call.toolId) &&
            typeof args.path === 'string'
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
          error.code === 'invalid-input' &&
          error.message === COMMENT_PRESERVATION_ERROR &&
          editToolRepairAttempts === 0 &&
          toolCalls < options.config.maxToolCalls
        ) {
          editToolRepairAttempts++;
          editToolRepairInstruction =
            'Correction: the previous complete-file proposal was rejected because it omitted existing comments. Retry the requested change with a minimal localized filesystem.propose-replace-text call using the exact source snippet, or include every existing comment in a complete-file proposal. Do not claim the edit was applied.';
          options.logger.emit({
            event: 'tool.retry-scheduled',
            taskId: task.taskId,
            runId: task.runId,
            toolCallId,
            toolId: call.toolId,
            nextAttempt: attempt + 1,
            reasonCode: error.code,
          });
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
    const completedFileOperation = verifiedFileOperationResponse(fileOperationResults);
    if (completedFileOperation) {
      options.session.add({ role: 'assistant', content: completedFileOperation });
      options.logger.emit({
        event: 'request.completed',
        taskId: task.taskId,
        runId: task.runId,
        durationMs: Date.now() - start,
        iterations: iteration,
      });
      return completedFileOperation;
    }
    if (applicationLaunchCompleted) {
      const application = requestedApplicationId(prompt);
      const applicationName = application?.split('-')
        .map(part => part[0]?.toUpperCase() + part.slice(1))
        .join(' ');
      const response = application
        ? `Opened ${applicationName}.`
        : 'The requested application was opened.';
      options.session.add({ role: 'assistant', content: response });
      options.logger.emit({
        event: 'request.completed',
        taskId: task.taskId,
        runId: task.runId,
        durationMs: Date.now() - start,
        iterations: iteration,
      });
      return response;
    }
    if (task.state === 'running') task.transition('planning');
  }

  throw new AgentError('Agent iteration limit reached without a final response.', 'iteration-limit');
}
