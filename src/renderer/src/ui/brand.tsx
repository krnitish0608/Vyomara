/** Vyomara brand mark and the voice orb used on the welcome screen and header. */

export function VyomaraMark({ tile = true }: { readonly tile?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      {tile && <rect x="4" y="4" width="56" height="56" rx="18" fill="#101746" stroke="#315cff" strokeWidth="1.5" />}
      <ellipse cx="32" cy="32" rx="25" ry="10" transform="rotate(-27 32 32)" fill="none" stroke="#27d9ff" strokeWidth="2.5" />
      <ellipse cx="32" cy="32" rx="24" ry="9" transform="rotate(-27 32 32)" fill="none" stroke="#9c50ff" strokeWidth="1.5" strokeDasharray="28 100" />
      <circle cx="32" cy="32" r="17" fill="#2426a8" stroke="#695bff" strokeWidth="1.5" />
      <rect className="mark-wave-bar mark-wave-bar-1" x="21" y="29" width="3" height="6" rx="1.5" fill="#e9f4ff" />
      <rect className="mark-wave-bar mark-wave-bar-2" x="26" y="24" width="3" height="16" rx="1.5" fill="#e9f4ff" />
      <rect className="mark-wave-bar mark-wave-bar-3" x="31" y="20" width="3" height="24" rx="1.5" fill="#e9f4ff" />
      <rect className="mark-wave-bar mark-wave-bar-4" x="36" y="25" width="3" height="14" rx="1.5" fill="#e9f4ff" />
      <rect className="mark-wave-bar mark-wave-bar-5" x="41" y="28" width="3" height="8" rx="1.5" fill="#e9f4ff" />
    </svg>
  );
}

function VoiceWave({ side }: { readonly side: 'left' | 'right' }) {
  return (
    <span className={`voice-waveform voice-waveform-${side}`} aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
    </span>
  );
}

export function VoiceOrb({
  listening,
  pressed,
  disabled,
  label,
  title,
  compact = false,
  onActivate,
}: {
  readonly listening: boolean;
  readonly pressed: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly title: string;
  readonly compact?: boolean;
  readonly onActivate: () => void;
}) {
  return (
    <div className={`voice-orbit${listening ? ' voice-orbit-listening' : ''}${compact ? ' voice-orbit-compact' : ''}`} aria-label="Offline voice input">
      <VoiceWave side="left" />
      <button
        className="voice-orb-button"
        type="button"
        onClick={onActivate}
        disabled={disabled}
        aria-label={label}
        aria-pressed={pressed}
        title={title}
      >
        <span className="voice-orb-current" aria-hidden="true" />
        <span className="voice-orb-meteor" aria-hidden="true" />
        <span className="voice-orb-meteor voice-orb-meteor--two" aria-hidden="true" />
        <span className="voice-orb-meteor voice-orb-meteor--three" aria-hidden="true" />
        <span className="voice-orb-mark" aria-hidden="true">
          <VyomaraMark tile={false} />
        </span>
      </button>
      <VoiceWave side="right" />
    </div>
  );
}
