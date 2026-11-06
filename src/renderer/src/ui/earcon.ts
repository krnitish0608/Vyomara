/**
 * Short, quiet tones that make spoken conversation feel live without words:
 * Vyom started listening, got your request, or stopped listening.
 */
export type Earcon = 'start' | 'sent' | 'end';

const NOTES: Record<Earcon, readonly number[]> = {
  start: [587, 880],
  sent: [988],
  end: [880, 587],
};

let context: AudioContext | undefined;

/** Plays the tone and resolves when it has finished (~0.2 s). */
export function playEarcon(kind: Earcon): Promise<void> {
  try {
    context ??= new AudioContext();
    const audio = context;
    void audio.resume().catch(() => undefined);
    const notes = NOTES[kind];
    const step = 0.085;
    const start = audio.currentTime + 0.01;
    notes.forEach((frequency, index) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const at = start + index * step;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.07, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0005, at + step + 0.05);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(at);
      oscillator.stop(at + step + 0.06);
    });
    const duration = (notes.length * step + 0.08) * 1000;
    return new Promise(resolve => setTimeout(resolve, duration));
  } catch {
    return Promise.resolve();
  }
}
