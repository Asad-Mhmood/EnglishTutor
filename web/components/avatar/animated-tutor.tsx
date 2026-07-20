'use client';

import { useId } from 'react';
import { motion } from 'motion/react';
import { useTrackVolume, useVoiceAssistant } from '@livekit/components-react';
import { cn } from '@/lib/shadcn/utils';

/**
 * The free animated tutor faces — Ahmad and Sara, drawn as South Asian bust portraits.
 *
 * Rendered entirely in the browser and driven by the agent's live audio level, so it costs
 * nothing per minute, unlike the bitHuman photo avatar it stands in for. The mouth opens
 * with the voice's volume (with a hint of teeth at full openness), the eyes blink on a
 * timer, brows and gaze lift while the agent thinks, and the whole head bobs gently while
 * speaking. It is a stylized illustration, deliberately: a drawn face that *reacts* reads
 * as alive, where a realistic face that almost-moves reads as broken.
 *
 * Both characters share one face geometry; hair, clothing, jewellery and palette differ.
 * Skin, hair and clothes are fixed colors — they are the characters' identity, not the
 * app's theme — so the only theme-aware part is the backdrop circle behind them.
 */

interface AnimatedTutorProps {
  character: 'boy' | 'girl';
  className?: string;
}

const BLINK_KEYFRAMES = {
  scaleY: [1, 1, 0.06, 1],
};

const EYE_STYLE: React.CSSProperties = {
  transformBox: 'fill-box',
  transformOrigin: 'center',
};

export function AnimatedTutor({ character, className }: AnimatedTutorProps) {
  const { state, audioTrack } = useVoiceAssistant();
  const rawVolume = useTrackVolume(audioTrack);
  // useId can contain colons, which break url(#...) references in some SVG engines.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  const speaking = state === 'speaking';
  const thinking = state === 'thinking';

  // The analyser reports conversational speech around 0.1–0.4; stretch that into a full
  // mouth range and clamp. While not speaking the mouth stays shut regardless of stray
  // room noise on the track.
  const openness = speaking ? Math.min(1, rawVolume * 2.8) : 0;
  const mouthRy = 1.5 + openness * 10.5;
  const mouthRx = 10 + openness * 4;
  const isGirl = character === 'girl';

  const hair = isGirl ? '#2b1a10' : '#211711';
  const brow = '#241812';
  const iris = '#3a2417';
  const lip = isGirl ? '#a34f4b' : '#8e5243';
  const mouthCavity = '#5d2620';
  const skinShadow = '#a97147';
  const gold = '#d9a441';

  const skinGradId = `${uid}-skin`;
  const mouthClipId = `${uid}-mouth`;

  return (
    <div
      role="img"
      aria-label={`${isGirl ? 'Sara' : 'Ahmad'}, your tutor, ${speaking ? 'speaking' : thinking ? 'thinking' : 'listening'}`}
      className={cn(
        'bg-muted relative flex aspect-square items-end justify-center overflow-hidden rounded-full',
        className
      )}
    >
      <motion.svg
        viewBox="0 0 200 200"
        className="h-full w-full"
        animate={speaking ? { y: [0, -2, 0] } : { y: 0 }}
        transition={
          speaking ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }
        }
      >
        <defs>
          <radialGradient id={skinGradId} cx="0.42" cy="0.32" r="0.85">
            <stop offset="0" stopColor={isGirl ? '#d8a273' : '#d09a6b'} />
            <stop offset="0.68" stopColor={isGirl ? '#c88f5f' : '#c08757'} />
            <stop offset="1" stopColor={skinShadow} />
          </radialGradient>
          <clipPath id={mouthClipId}>
            <ellipse cx="100" cy="132" rx={mouthRx} ry={mouthRy} />
          </clipPath>
        </defs>

        {/* Sara: hair falls behind the head and shoulders. */}
        {isGirl && (
          <path
            d="M100 26 C54 26 38 62 40 100 C41 132 36 158 30 172 C46 184 66 182 76 172
               L76 96 L124 96 L124 172 C134 182 154 184 170 172 C164 158 159 132 160 100
               C162 62 146 26 100 26 Z"
            fill={hair}
          />
        )}

        {/* Neck */}
        <rect x="87" y="126" width="26" height="34" rx="10" fill={skinShadow} />

        {/* Clothing */}
        {isGirl ? (
          <g>
            {/* Kameez-style top with a gold-trimmed neckline */}
            <path d="M30 200 C32 172 56 154 100 154 C144 154 168 172 170 200 Z" fill="#2a6b60" />
            <path
              d="M83 156 C91 165 109 165 117 156"
              stroke={gold}
              strokeWidth="3"
              strokeLinecap="round"
              fill="none"
            />
          </g>
        ) : (
          <g>
            {/* Collared shirt with an open V */}
            <path d="M30 200 C32 172 56 154 100 154 C144 154 168 172 170 200 Z" fill="#33526e" />
            <path d="M84 155 L100 173 L116 155 L100 161 Z" fill="#24405a" />
          </g>
        )}

        {/* Ears */}
        <ellipse cx="46" cy="100" rx="8" ry="11" fill={skinShadow} />
        <ellipse cx="154" cy="100" rx="8" ry="11" fill={skinShadow} />

        {/* Head */}
        <ellipse cx="100" cy="94" rx="50" ry="56" fill={`url(#${skinGradId})`} />

        {/* Sara's earrings sit in front of the head's edge */}
        {isGirl && (
          <g>
            <circle cx="45" cy="112" r="2.6" fill={gold} />
            <circle cx="155" cy="112" r="2.6" fill={gold} />
          </g>
        )}

        {/* Ahmad: a hint of stubble along the jaw */}
        {!isGirl && (
          <path
            d="M58 112 C62 138 78 152 100 152 C122 152 138 138 142 112
               C138 134 122 146 100 146 C78 146 62 134 58 112 Z"
            fill="#241812"
            opacity="0.16"
          />
        )}

        {/* Blush */}
        <ellipse cx="66" cy="112" rx="8" ry="4.5" fill="#d97b62" opacity={isGirl ? 0.28 : 0.14} />
        <ellipse cx="134" cy="112" rx="8" ry="4.5" fill="#d97b62" opacity={isGirl ? 0.28 : 0.14} />

        {/* Nose */}
        <path
          d="M100 98 Q97 110 95 114 Q99 118 105 116"
          stroke={skinShadow}
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* Hair, front */}
        {isGirl ? (
          // Centre-parted curtain framing the face
          <path
            d="M100 32 C62 32 48 58 46 88 C50 96 54 98 56 96 C62 72 78 60 100 58
               C122 60 138 72 144 96 C146 98 150 96 154 88 C152 58 138 32 100 32 Z"
            fill={hair}
          />
        ) : (
          // Short, neatly combed crop with a clean hairline
          <path
            d="M100 30 C60 30 45 60 45 92 C45 97 49 98 51 94 C56 70 68 58 100 56
               C132 58 144 70 149 94 C151 98 155 97 155 92 C155 60 140 30 100 30 Z"
            fill={hair}
          />
        )}

        {/* Brows — lift when thinking. */}
        <motion.g animate={{ y: thinking ? -4.5 : 0 }} transition={{ duration: 0.25 }}>
          <path
            d="M62 80 Q74 73 86 79"
            stroke={brow}
            strokeWidth="5"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M114 79 Q126 73 138 80"
            stroke={brow}
            strokeWidth="5"
            strokeLinecap="round"
            fill="none"
          />
        </motion.g>

        {/* Eyes — almond whites, dark brown irises; gaze drifts up while thinking; lids
            blink on a loop, on different periods per character so side-by-side previews
            don't look mechanical. */}
        <motion.g animate={{ y: thinking ? -2 : 0 }} transition={{ duration: 0.25 }}>
          <motion.g
            style={EYE_STYLE}
            animate={BLINK_KEYFRAMES}
            transition={{
              duration: isGirl ? 5.1 : 4.3,
              times: [0, 0.94, 0.97, 1],
              repeat: Infinity,
            }}
          >
            <path d="M62 92 Q74 84 86 92 Q74 99 62 92 Z" fill="#fdf6ee" />
            <circle cx="74" cy="91.5" r="5" fill={iris} />
            <circle cx="74" cy="91.5" r="2.2" fill="#17100b" />
            <circle cx="75.6" cy="90" r="1.4" fill="#ffffff" opacity="0.9" />
            <path
              d="M62 92 Q74 83.5 86 92"
              stroke={brow}
              strokeWidth="1.8"
              strokeLinecap="round"
              fill="none"
              opacity={isGirl ? 0.9 : 0.5}
            />
          </motion.g>
          <motion.g
            style={EYE_STYLE}
            animate={BLINK_KEYFRAMES}
            transition={{
              duration: isGirl ? 5.1 : 4.3,
              times: [0, 0.94, 0.97, 1],
              repeat: Infinity,
            }}
          >
            <path d="M114 92 Q126 84 138 92 Q126 99 114 92 Z" fill="#fdf6ee" />
            <circle cx="126" cy="91.5" r="5" fill={iris} />
            <circle cx="126" cy="91.5" r="2.2" fill="#17100b" />
            <circle cx="127.6" cy="90" r="1.4" fill="#ffffff" opacity="0.9" />
            <path
              d="M114 92 Q126 83.5 138 92"
              stroke={brow}
              strokeWidth="1.8"
              strokeLinecap="round"
              fill="none"
              opacity={isGirl ? 0.9 : 0.5}
            />
          </motion.g>
        </motion.g>

        {/* Mouth: the dark opening follows the voice, with a hint of teeth as it widens;
            the resting lips fade out as the mouth opens. */}
        <ellipse cx="100" cy="132" rx={mouthRx} ry={mouthRy} fill={mouthCavity} />
        <rect
          x="90"
          y="124"
          width="20"
          height="6"
          rx="3"
          fill="#f5efe8"
          opacity={Math.min(0.9, openness * 1.4)}
          clipPath={`url(#${mouthClipId})`}
        />
        <path
          d="M84 131 Q92 126.5 100 129.5 Q108 126.5 116 131 Q108 138.5 100 138.5 Q92 138.5 84 131 Z"
          fill={lip}
          opacity={Math.max(0, 1 - openness * 2.5)}
        />
      </motion.svg>
    </div>
  );
}
