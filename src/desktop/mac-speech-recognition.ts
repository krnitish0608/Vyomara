import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const speechLanguages = ['en-US', 'en-IN', 'hi-IN'] as const;
export type SpeechLanguage = typeof speechLanguages[number];

export type SpeechRecognitionEvent =
  | { readonly type: 'listening' }
  | { readonly type: 'partial' | 'final'; readonly transcript: string }
  | { readonly type: 'stopped' }
  | { readonly type: 'error'; readonly message: string };

export class MacSpeechRecognitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MacSpeechRecognitionError';
  }
}

type HelperMessage = SpeechRecognitionEvent | {
  readonly type: 'availability';
  readonly language: string;
  readonly available: boolean;
};

const helperPath = fileURLToPath(new URL('../native/VyomaraSpeech.app/Contents/MacOS/VyomaraSpeech', import.meta.url));

export function isSpeechLanguage(value: string): value is SpeechLanguage {
  return speechLanguages.some(language => language === value);
}

export class MacSpeechRecognitionRunner {
  private activeChild: ReturnType<typeof spawn> | undefined;

  async checkLanguage(language: string): Promise<boolean> {
    if (process.platform !== 'darwin') throw new MacSpeechRecognitionError('On-device voice input is available only on macOS.');
    if (!isSpeechLanguage(language)) throw new MacSpeechRecognitionError('Unsupported speech-recognition language.');
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(helperPath, ['--check', language], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      throw new MacSpeechRecognitionError(`Native speech helper could not start: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr) {
      child.kill('SIGTERM');
      throw new MacSpeechRecognitionError('Native speech availability helper did not provide output streams.');
    }
    let output = '';
    let errorOutput = '';
    return await new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new MacSpeechRecognitionError('On-device speech availability check timed out.'));
      }, 10_000);
      stdout.setEncoding('utf8');
      stdout.on('data', chunk => { output = (output + String(chunk)).slice(-4_096); });
      stderr.setEncoding('utf8');
      stderr.on('data', chunk => { errorOutput = (errorOutput + String(chunk)).slice(-4_096); });
      child.once('error', error => {
        clearTimeout(timeout);
        reject(new MacSpeechRecognitionError(`Native speech helper could not start: ${error.message}`));
      });
      child.once('close', code => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new MacSpeechRecognitionError(errorOutput.trim() || `Native speech availability check exited with code ${code ?? 'unknown'}.`));
          return;
        }
        try {
          const message = JSON.parse(output.trim()) as HelperMessage;
          if (message.type !== 'availability' || message.language !== language || typeof message.available !== 'boolean') {
            throw new Error('Native speech helper returned an invalid availability response.');
          }
          resolve(message.available);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  start(language: string, onEvent: (event: SpeechRecognitionEvent) => void): Promise<void> {
    if (process.platform !== 'darwin') return Promise.reject(new MacSpeechRecognitionError('On-device voice input is available only on macOS.'));
    if (!isSpeechLanguage(language)) return Promise.reject(new MacSpeechRecognitionError('Unsupported speech-recognition language.'));
    if (this.activeChild) return Promise.reject(new MacSpeechRecognitionError('Voice input is already active.'));
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(helperPath, [language], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      return Promise.reject(new MacSpeechRecognitionError(`Native speech helper could not start: ${error instanceof Error ? error.message : 'unknown error'}`));
    }
    this.activeChild = child;
    const stdout = child.stdout;
    if (!stdout) {
      this.activeChild = undefined;
      child.kill('SIGTERM');
      return Promise.reject(new MacSpeechRecognitionError('Native voice helper did not provide an output stream.'));
    }
    stdout.setEncoding('utf8');
    let buffer = '';
    let started = false;
    let stopped = false;
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new MacSpeechRecognitionError('Native voice input did not start in time. Check macOS microphone and speech-recognition permissions.'));
      }, 60_000);
      const cleanup = (): void => {
        clearTimeout(timeout);
        if (this.activeChild === child) this.activeChild = undefined;
      };
      stdout.on('data', chunk => {
        buffer += String(chunk);
        if (buffer.length > 16_384) {
          cleanup();
          child.kill('SIGTERM');
          const message = 'Native speech helper exceeded its output limit.';
          onEvent({ type: 'error', message });
          if (!started) reject(new MacSpeechRecognitionError(message));
          return;
        }
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
          if (!line) continue;
          try {
            const event = JSON.parse(line) as HelperMessage;
            if (event.type === 'availability') throw new Error('Unexpected availability response during voice capture.');
            if (event.type === 'stopped') stopped = true;
            if (event.type === 'error') {
              onEvent(event);
              cleanup();
              if (!started) reject(new MacSpeechRecognitionError(event.message));
              continue;
            }
            if (event.type === 'listening') {
              started = true;
              resolve();
            }
            onEvent(event);
          } catch (error) {
            cleanup();
            child.kill('SIGTERM');
            onEvent({ type: 'error', message: error instanceof Error ? error.message : 'Native speech helper returned invalid data.' });
            if (!started) reject(error instanceof MacSpeechRecognitionError
              ? error
              : new MacSpeechRecognitionError(error instanceof Error ? error.message : 'Native speech helper returned invalid data.'));
          }
        }
      });
      child.once('error', error => {
        cleanup();
        const message = `Native speech helper could not start: ${error.message}`;
        onEvent({ type: 'error', message });
        if (!started) reject(new MacSpeechRecognitionError(message));
      });
      child.once('close', code => {
        cleanup();
        if (!started) {
          reject(new MacSpeechRecognitionError(
            code === 0
              ? 'Native voice input stopped before listening started. Check macOS microphone and speech-recognition permissions.'
              : `Native voice input exited with code ${code ?? 'unknown'} before listening started.`,
          ));
        }
        if (!stopped) onEvent({ type: 'stopped' });
      });
    });
  }

  stop(): boolean {
    if (!this.activeChild) return false;
    const input = this.activeChild.stdin;
    if (!input || input.destroyed) return this.activeChild.kill('SIGTERM');
    input.write('stop\n');
    return true;
  }
}
