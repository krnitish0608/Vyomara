import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

export type LocalWhisperEvent =
  | { readonly type: 'listening' }
  | { readonly type: 'wake-detected'; readonly hasCommand: boolean }
  | { readonly type: 'partial'; readonly transcript: string }
  | { readonly type: 'command'; readonly transcript: string }
  | { readonly type: 'stopped' }
  | { readonly type: 'model-progress'; readonly received: number; readonly total: number }
  | { readonly type: 'model-ready' }
  | { readonly type: 'error'; readonly message: string };

export interface LocalWhisperOptions {
  readonly modelDirectory: string;
  readonly binaryPath?: string;
  readonly spawnProcess?: typeof spawn;
}

export class LocalSpeechError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalSpeechError';
  }
}

const modelName = 'ggml-base.bin';
const modelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';
const modelSha1 = '465707469ff3a37a2b9b8d8f89f2f99de7299dac';
const maximumModelBytes = 180 * 1024 * 1024;
const defaultWhisperBinaries = ['/opt/homebrew/bin/whisper-stream', '/usr/local/bin/whisper-stream'];

export function extractWhisperTranscriptions(output: string): string[] {
  const transcripts: string[] = [];
  const blocks = output.matchAll(/### Transcription \d+ START[^\n]*\n([\s\S]*?)### Transcription \d+ END/g);
  for (const [, body] of blocks) {
    if (!body) continue;
    const text = body.split('\n')
      .map(line => line.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\[[^\]]+ --> [^\]]+\]\s*/, '').trim())
      .filter(Boolean)
      .join(' ')
      .trim();
    if (text) transcripts.push(text);
  }
  return transcripts;
}

export function matchWakePhrase(transcript: string): { readonly detected: boolean; readonly remainder: string } {
  const match = /^(?:hey|hi|hello|हेलो|हाय|नमस्ते)\s+(?:vyomara|vyom|व्योमारा|व्योम)(?=$|[\s,!.?;:-])[\s,!.?;:-]*/iu.exec(transcript.trim());
  if (!match) return { detected: false, remainder: transcript };
  return { detected: true, remainder: transcript.trim().slice(match[0].length).trim() };
}

async function fileSha1(path: string): Promise<string> {
  const hash = createHash('sha1');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export class LocalWhisperRunner {
  readonly modelPath: string;
  readonly #modelDirectory: string;
  readonly #binaryPath?: string;
  readonly #spawnProcess: typeof spawn;
  #child: ReturnType<typeof spawn> | undefined;
  #awake = false;
  #speaking = false;
  #stdoutBuffer = '';
  #inTranscription = false;
  #transcriptionLines: string[] = [];
  #onEvent: ((event: LocalWhisperEvent) => void) | undefined;

  constructor(options: LocalWhisperOptions) {
    this.#modelDirectory = options.modelDirectory;
    this.modelPath = join(options.modelDirectory, modelName);
    this.#binaryPath = options.binaryPath;
    this.#spawnProcess = options.spawnProcess ?? spawn;
  }

  async modelAvailable(): Promise<boolean> {
    try {
      const metadata = await stat(this.modelPath);
      return metadata.isFile() && metadata.size > 0 && metadata.size <= maximumModelBytes &&
        await fileSha1(this.modelPath) === modelSha1;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async downloadModel(onEvent: (event: LocalWhisperEvent) => void): Promise<void> {
    await mkdir(this.#modelDirectory, { recursive: true, mode: 0o700 });
    const temporaryPath = join(this.#modelDirectory, `${modelName}.download`);
    const response = await fetch(modelUrl, { redirect: 'follow' });
    if (!response.ok || !response.body) {
      throw new LocalSpeechError(`Local speech model download failed (HTTP ${response.status}).`);
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maximumModelBytes) {
      throw new LocalSpeechError('The speech model download exceeded the 180 MiB size limit.');
    }
    const total = Number.isFinite(declaredLength) ? declaredLength : 0;
    let received = 0;
    const hash = createHash('sha1');
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > maximumModelBytes) {
          callback(new LocalSpeechError('The speech model download exceeded the 180 MiB size limit.'));
          return;
        }
        hash.update(chunk);
        onEvent({ type: 'model-progress', received, total });
        callback(null, chunk);
      },
    });
    try {
      await pipeline(response.body, meter, createWriteStream(temporaryPath, { flags: 'w', mode: 0o600 }));
      if (hash.digest('hex') !== modelSha1) throw new LocalSpeechError('The downloaded speech model failed its integrity check.');
      await rename(temporaryPath, this.modelPath);
      onEvent({ type: 'model-ready' });
    } catch (error) {
      await rm(temporaryPath, { force: true });
      if (error instanceof LocalSpeechError) throw error;
      throw new LocalSpeechError(error instanceof Error ? error.message : 'The local speech model could not be downloaded.');
    }
  }

  start(onEvent: (event: LocalWhisperEvent) => void): void {
    if (this.#child) throw new Error('Local voice listening is already active.');
    if (!this.#binaryPath) throw new LocalSpeechError('Local speech engine not found. Install whisper.cpp with `brew install whisper.cpp`, then restart Vyomara.');
    this.#awake = false;
    this.#speaking = false;
    this.#stdoutBuffer = '';
    this.#inTranscription = false;
    this.#transcriptionLines = [];
    this.#onEvent = onEvent;
    let child: ReturnType<typeof spawn>;
    try {
      child = this.#spawnProcess(this.#binaryPath, [
        '--step', '0',
        '--length', '8000',
        '--vad-thold', '0.6',
        '--language', 'auto',
        '--threads', '4',
        '--model', this.modelPath,
      ], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      this.#onEvent = undefined;
      throw new LocalSpeechError(`Local speech engine could not start: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    this.#child = child;
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (!stdout || !stderr) {
      child.kill('SIGTERM');
      this.#finish();
      throw new LocalSpeechError('Local speech engine did not provide its audio-stream controls.');
    }
    stdout.setEncoding('utf8');
    stderr.setEncoding('utf8');
    stdout.on('data', chunk => this.#handleOutput(String(chunk)));
    let errorOutput = '';
    stderr.on('data', chunk => { errorOutput = (errorOutput + String(chunk)).slice(-4_096); });
    child.once('error', error => {
      this.#finish();
      onEvent({ type: 'error', message: `Local speech engine could not start: ${error.message}` });
    });
    child.once('close', (code, signal) => {
      const unexpected = this.#child === child;
      this.#finish();
      if (unexpected && code !== 0) {
        onEvent({
          type: 'error',
          message: errorOutput.trim() || `Local speech engine stopped unexpectedly (${signal ?? code ?? 'unknown'}).`,
        });
      } else {
        onEvent({ type: 'stopped' });
      }
    });
  }

  setSpeaking(speaking: boolean): void {
    this.#speaking = speaking;
  }

  stop(): Promise<boolean> {
    const child = this.#child;
    if (!child) return Promise.resolve(false);
    return new Promise(resolve => {
      let forceKillTimer: NodeJS.Timeout | undefined;
      child.once('close', () => {
        if (forceKillTimer) clearTimeout(forceKillTimer);
        resolve(true);
      });
      if (!child.kill('SIGTERM')) {
        if (this.#child !== child) {
          resolve(true);
          return;
        }
        resolve(false);
        return;
      }
      forceKillTimer = setTimeout(() => {
        if (this.#child === child) child.kill('SIGKILL');
      }, 1_500);
    });
  }

  #finish(): void {
    this.#child = undefined;
    this.#stdoutBuffer = '';
    this.#inTranscription = false;
    this.#transcriptionLines = [];
  }

  #handleOutput(chunk: string): void {
    this.#stdoutBuffer += chunk;
    if (this.#stdoutBuffer.length > 32_768) {
      const child = this.#child;
      this.#finish();
      this.#onEvent?.({ type: 'error', message: 'Local speech engine exceeded its output limit.' });
      child?.kill('SIGTERM');
      return;
    }
    let newline = this.#stdoutBuffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.#stdoutBuffer.slice(0, newline).replace(/\x1b\[[0-9;]*m/g, '').trim();
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
      newline = this.#stdoutBuffer.indexOf('\n');
      if (line.includes('[Start speaking]')) this.#onEvent?.({ type: 'listening' });
      if (line.startsWith('### Transcription ') && line.includes(' START')) {
        this.#inTranscription = true;
        this.#transcriptionLines = [];
      } else if (line.startsWith('### Transcription ') && line.includes(' END')) {
        const transcript = extractWhisperTranscriptions([
          '### Transcription 0 START',
          ...this.#transcriptionLines,
          '### Transcription 0 END',
        ].join('\n'))[0];
        this.#inTranscription = false;
        this.#transcriptionLines = [];
        if (transcript) this.#handleTranscript(transcript);
      } else if (this.#inTranscription && line) {
        this.#transcriptionLines.push(line);
      }
    }
  }

  #handleTranscript(transcript: string): void {
    if (this.#speaking) return;
    this.#onEvent?.({ type: 'partial', transcript });
    if (!this.#awake) {
      const wake = matchWakePhrase(transcript);
      if (!wake.detected) return;
      this.#awake = true;
      this.#onEvent?.({ type: 'wake-detected', hasCommand: Boolean(wake.remainder) });
      if (wake.remainder) this.#onEvent?.({ type: 'command', transcript: wake.remainder });
      return;
    }
    this.#onEvent?.({ type: 'command', transcript });
  }
}

export function resolveWhisperBinary(pathCandidates = defaultWhisperBinaries): string | undefined {
  return pathCandidates.find(path => existsSync(path));
}
