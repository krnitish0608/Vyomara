import { useId } from 'react';
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

/**
 * The Vyomara mark with moving parts: the core's wave bars and two
 * satellites travelling the orbits in opposite directions. Speed comes from
 * CSS (--orbit-speed), so the same mark idles slowly in the header and races
 * while thinking; the reduced-motion setting stops it.
 */
function OrbitMarkParts({ coreFill }: { readonly coreFill: string }) {
  return (
    <>
      <g transform="rotate(-27 32 32)">
        <ellipse cx="32" cy="32" rx="27" ry="11" fill="none" stroke="#27d9ff" strokeWidth="1.6" opacity=".6" />
        <g transform="translate(32 32) scale(1 .407)">
          <g className="orbit-satellite">
            <circle cx="27" cy="0" r="3.4" fill="#9ff8ff" />
          </g>
        </g>
      </g>
      <g transform="rotate(33 32 32)">
        <ellipse cx="32" cy="32" rx="24" ry="9" fill="none" stroke="#a368ff" strokeWidth="1.3" opacity=".5" strokeDasharray="30 8" />
        <g transform="translate(32 32) scale(1 .375)">
          <g className="orbit-satellite orbit-satellite-reverse">
            <circle cx="24" cy="0" r="3" fill="#dcb4ff" />
          </g>
        </g>
      </g>
      <circle className="orbit-core" cx="32" cy="32" r="15" fill={`url(#${coreFill})`} stroke="#7b6dff" strokeWidth="1.2" />
      <rect className="mark-wave-bar mark-wave-bar-1" x="23" y="29.5" width="2.6" height="5" rx="1.3" fill="#e9f4ff" />
      <rect className="mark-wave-bar mark-wave-bar-2" x="27.3" y="25.5" width="2.6" height="13" rx="1.3" fill="#e9f4ff" />
      <rect className="mark-wave-bar mark-wave-bar-3" x="31.6" y="22.5" width="2.6" height="19" rx="1.3" fill="#e9f4ff" />
      <rect className="mark-wave-bar mark-wave-bar-4" x="35.9" y="26.5" width="2.6" height="11" rx="1.3" fill="#e9f4ff" />
      <rect className="mark-wave-bar mark-wave-bar-5" x="40.2" y="29" width="2.6" height="6" rx="1.3" fill="#e9f4ff" />
    </>
  );
}

function CoreGradient({ id }: { readonly id: string }) {
  return (
    <radialGradient id={id} cx="40%" cy="35%" r="70%">
      <stop offset="0%" stopColor="#5a63ff" />
      <stop offset="70%" stopColor="#2426a8" />
      <stop offset="100%" stopColor="#171a6e" />
    </radialGradient>
  );
}

/** Shown while the assistant thinks. */
export function ThinkingMark() {
  const id = useId().replace(/:/gu, '');
  return (
    <svg className="orbit-mark thinking-mark" viewBox="0 0 64 64" aria-hidden="true">
      <defs><CoreGradient id={`core-${id}`} /></defs>
      <OrbitMarkParts coreFill={`core-${id}`} />
    </svg>
  );
}

/**
 * The header logo: the orbit mark in its tile, idling slowly. `active`
 * (working or listening) speeds the satellites up, so the logo shows the
 * assistant is busy.
 */
export function BrandMark({ active = false }: { readonly active?: boolean }) {
  const id = useId().replace(/:/gu, '');
  return (
    <svg className={`orbit-mark brand-live${active ? ' brand-live-active' : ''}`} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <CoreGradient id={`core-${id}`} />
        <linearGradient id={`edge-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#27d9ff" />
          <stop offset="55%" stopColor="#4d5cff" />
          <stop offset="100%" stopColor="#b25cff" />
        </linearGradient>
        <radialGradient id={`tile-${id}`} cx="35%" cy="25%" r="85%">
          <stop offset="0%" stopColor="#1b2a78" />
          <stop offset="100%" stopColor="#0a0f33" />
        </radialGradient>
      </defs>
      <rect className="brand-live-tile" x="3" y="3" width="58" height="58" rx="18" fill={`url(#tile-${id})`} stroke={`url(#edge-${id})`} strokeWidth="1.8" />
      <g transform="translate(32 32) scale(.97) translate(-32 -32)">
        <OrbitMarkParts coreFill={`core-${id}`} />
      </g>
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
  mini = false,
  onActivate,
}: {
  readonly listening: boolean;
  readonly pressed: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly title: string;
  readonly compact?: boolean;
  /** The small orb used in the mini controller window. */
  readonly mini?: boolean;
  readonly onActivate: () => void;
}) {
  return (
    <div className={`voice-orbit${listening ? ' voice-orbit-listening' : ''}${compact ? ' voice-orbit-compact' : ''}${mini ? ' voice-orbit-mini' : ''}`} aria-label="Offline voice input">
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
