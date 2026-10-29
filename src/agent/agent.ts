import type { AppConfig } from '../config/config.ts';
import type { Logger } from '../types.ts';
import type { ModelProvider, ProviderResponse } from '../providers/provider.ts';
import { OperationStoppedError, runBounded } from '../shared/bounded.ts';
import { Session } from '../session/session.ts';
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

function unsupportedCapability(prompt: string): string | undefined {
  if (
    /\b(?:run|execute|launch)\b[\s\S]{0,48}\b(?:shell|terminal|command|script)\b|\b(?:shell|terminal)\s+command\b|\b(?:run|execute)\s+(?:the\s+)?(?:command\s+)?[`"']?echo\b|\b(?:command|terminal|shell)\b[\s\S]{0,40}\b(?:chala|chalao|chalana|chalakar|run|execute)\b|(?:कमांड|टर्मिनल|शेल).{0,40}(?:चलाओ|चलाना|चलाकर|चलाया|execute|run)/iu.test(prompt)
  ) {
    return 'I cannot run shell or terminal commands. No command was executed.';
  }
  if (
    /\b(?:web search|search the web|search (?:the )?internet|browse the internet|visit the website|open https?:\/\/|current weather|search online)\b|\b(?:internet|online)\b[\s\S]{0,48}\b(?:search|dhund|dhundo|khoj)\b|\b(?:search|dhund|dhundo|khoj)\b[\s\S]{0,48}\b(?:internet|online)\b|(?:इंटरनेट|ऑनलाइन).{0,48}(?:खोज|ढूंढ|ढूँढ|सर्च)/iu.test(prompt)
  ) {
    return 'Web browsing and web search are not available. No search was performed.';
  }
  if (
    /\b(?:create|write|edit|modify|change|delete|remove)\b[\s\S]{0,48}\b(?:file|folder|directory)\b|\b(?:file|folder|directory)\b[\s\S]{0,40}\b(?:bana|banao|banana|likh|likho|edit|modify|badal|badlo|hata|hatao|mita|mitao|delete)\b|(?:फ़ाइल|फाइल|फ़ोल्डर|फोल्डर|डायरेक्टरी).{0,40}(?:बनाओ|बनाना|लिखो|बदलो|हटाओ|मिटाओ)/iu.test(prompt)
  ) {
    return 'File creation, editing, and deletion are not available. No filesystem change was made.';
  }
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
  return undefined;
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
    /\b(?:I|we)\s+(?:have\s+)?(?:created|deleted|wrote|modified|updated)\s+(?:the\s+)?(?:file|folder|directory)\b/i,
    /\b(?:the\s+)?(?:file|folder|directory)\s+(?:was|has been)\s+(?:created|deleted|written|modified|updated)\b/i,
    /\b(?:I|we)\s+(?:have\s+)?(?:installed|uninstalled|updated|upgraded)\b.{0,60}\b(?:package|application|app|software|dependency)\b/i,
    /\b(?:I|we)\s+(?:have\s+)?(?:opened|accessed|controlled|restarted|shut down)\b.{0,60}\b(?:camera|microphone|system settings|bluetooth|wi-?fi|mac)\b/i,
    /\b(?:maine|mainee)\b[\s\S]{0,48}\b(?:command|terminal|shell)\b[\s\S]{0,32}\b(?:chala(?:ya|o)?|chalaya|execute|run)\b/i,
    /\b(?:command|terminal|shell)\b[\s\S]{0,32}\b(?:chala diya|chalaya|run ho gaya|execute ho gaya)\b/i,
    /(?:मैंने|मैने).{0,48}(?:कमांड|टर्मिनल|शेल).{0,32}(?:चलाया|चला दिया|चलाया है)/u,
  ];
  return claims.some(pattern => pattern.test(text));
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
  const hasListing = successfulToolIds.has('filesystem.list-directory') ||
    successfulToolIds.has('filesystem.directory-tree');
  return (!hasListing && claimsListing.some(pattern => pattern.test(text))) ||
    (!successfulToolIds.has('filesystem.directory-tree') &&
      claimsTree.some(pattern => pattern.test(text)));
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
}

export async function runAgent(
  prompt: string,
  signal: AbortSignal,
  options: AgentOptions,
): Promise<string> {
  if (!prompt.trim() || prompt.length > options.config.maxInputChars) {
    throw new AgentError('Request is empty or exceeds the configured input limit.', 'invalid-request');
  }
  if (signal.aborted) throw new AgentError('Operation cancelled.', 'cancelled');
  options.session.add({ role: 'user', content: prompt });
  const start = Date.now();
  const unsupportedResponse = unsupportedCapability(prompt);
  if (unsupportedResponse) {
    options.session.add({ role: 'assistant', content: unsupportedResponse });
    options.logger.emit({
      event: 'request.completed',
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
  const filesystemToolResults: string[] = [];

  for (let iteration = 1; iteration <= options.config.maxAgentIterations; iteration++) {
    let rawResponse: unknown;
    try {
      rawResponse = await runBounded(
        providerSignal => options.provider.complete(
          options.session.messages(),
          providerSignal,
          toolCalls < options.config.maxToolCalls ? options.tools.modelTools() : [],
        ),
        options.config.requestTimeoutMs,
        signal,
      );
    } catch (error) {
      if (error instanceof OperationStoppedError) {
        throw new AgentError(error.message, error.reason);
      }
      throw error;
    }
    const response = parseProviderResponse(
      rawResponse,
      options.config.maxResponseChars,
      options.config.maxToolOutputChars,
    );
    if (response.kind === 'final') {
      if (recoverableToolFailure) throw recoverableToolFailure;
      if (claimsUnsupportedExecution(response.text)) {
        const safeResponse =
          'I cannot verify that action because no registered tool result confirms it. No shell command, web search, or file mutation was performed.';
        options.session.add({ role: 'assistant', content: safeResponse });
        options.logger.emit({
          event: 'request.completed',
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
          durationMs: Date.now() - start,
          iterations: iteration,
        });
        return safeResponse;
      }
      if (filesystemToolResults.length > 0) {
        const verifiedResponse = `Verified filesystem tool result(s):\n${filesystemToolResults.join('\n')}`;
        const finalResponse = verifiedResponse.length <= options.config.maxResponseChars
          ? verifiedResponse
          : 'The filesystem tool completed, but its verified result exceeds the configured response limit and cannot be shown.';
        options.session.add({ role: 'assistant', content: finalResponse });
        options.logger.emit({
          event: 'request.completed',
          durationMs: Date.now() - start,
          iterations: iteration,
        });
        return finalResponse;
      }
      options.session.add({ role: 'assistant', content: response.text });
      options.logger.emit({
        event: 'request.completed',
        durationMs: Date.now() - start,
        iterations: iteration,
      });
      return response.text;
    }

    if (response.calls.length > options.config.maxToolCalls - toolCalls) {
      throw new AgentError('Tool call limit reached.', 'tool-limit');
    }
    if (iteration === options.config.maxAgentIterations) {
      throw new AgentError('Agent iteration limit reached without a final response.', 'iteration-limit');
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
    for (const call of response.calls) {
      toolCalls++;
      try {
        const result = await options.tools.execute(call.toolId, call.arguments, signal);
        const serialized = JSON.stringify(result);
        if (serialized === undefined || serialized.length > options.config.maxToolOutputChars) {
          throw new ToolExecutionError(
            'Tool result exceeded the configured safety limit; success cannot be confirmed.',
            'output-too-large',
          );
        }
        options.session.add({ role: 'tool', toolId: call.toolId, content: serialized });
        successfulToolIds.add(call.toolId);
        if (call.toolId.startsWith('filesystem.')) {
          filesystemToolResults.push(`${call.toolId}: ${serialized}`);
        }
        if (failedToolId === call.toolId) {
          recoverableToolFailure = undefined;
          failedToolId = undefined;
        }
      } catch (error) {
        if (error instanceof ToolExecutionError && error.code === 'policy-denied') {
          throw new AgentError('Requested tool was denied by policy.', 'policy-denied');
        }
        if (
          error instanceof ToolExecutionError &&
          ['invalid-input', 'input-too-large', 'unknown-tool'].includes(error.code)
        ) {
          if (correctionAttempts >= 1) {
            throw new ToolExecutionError(
              'Tool arguments remained invalid after one correction attempt; no operation was performed.',
              error.code,
            );
          }
          correctionAttempts++;
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
        if (error instanceof AgentError || error instanceof ToolExecutionError) throw error;
        throw new ToolExecutionError(
          'The requested operation failed; no success is implied.',
          'tool-failed',
        );
      }
    }
  }

  throw new AgentError('Agent iteration limit reached without a final response.', 'iteration-limit');
}
