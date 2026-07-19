'use client';

import { motion } from 'motion/react';
import { useTrackVolume, useVoiceAssistant } from '@livekit/components-react';
import { cn } from '@/lib/shadcn/utils';

/**
 * The free animated tutor faces — Ahmad (boy) and Sara (girl).
 *
 * Rendered entirely in the browser and driven by the agent's live audio level, so it costs
 * nothing per minute, unlike the bitHuman photo avatar it stands in for. The mouth opens
 * with the voice's volume, the eyes blink on a timer, the brows lift while the agent thinks,
 * and the whole head bobs gently while speaking. It is a cartoon, deliberately: a stylized
 * face that *reacts* reads as alive, where a realistic face that almost-moves reads as
 * broken.
 *
 * Both characters share one face geometry; hair, lashes and palette differ. Skin and hair
 * are fixed colors (they are the character's identity, not the app's theme), so the only
 * theme-aware part is the backdrop circle, which uses --muted like every other surface.
 */

interface AnimatedTutorProps {
  character: 'boy' | 'girl';
  className?: string;
}

const BLINK_KEYFRAMES = {
  scaleY: [1, 1, 0.08, 1],
};

const EYE_STYLE: React.CSSProperties = {
  transformBox: 'fill-box',
  transformOrigin: 'center',
};

export function AnimatedTutor({ character, className }: AnimatedTutorProps) {
  const { state, audioTrack } = useVoiceAssistant();
  const rawVolume = useTrackVolume(audioTrack);

  const speaking = state === 'speaking';
  const thinking = state === 'thinking';

  // The analyser reports conversational speech around 0.1–0.4; stretch that into a full
  // mouth range and clamp. While not speaking the mouth stays shut regardless of stray
  // room noise on the track.
  const openness = speaking ? Math.min(1, rawVolume * 2.8) : 0;
  const mouthRy = 1.5 + openness * 11;
  const isGirl = character === 'girl';

  const skin = '#efc39b';
  const skinShadow = '#dca877';
  const hair = isGirl ? '#5b3a21' : '#332722';
  const mouth = '#8c4a41';

  return (
    <div
      role="img"
      aria-label={`${isGirl ? 'Sara' : 'Ahmad'}, your tutor, ${speaking ? 'speaking' : thinking ? 'thinking' : 'listening'}`}
      className={cn(
        'bg-muted relative flex aspect-square items-center justify-center overflow-hidden rounded-full',
        className
      )}
    >
      <motion.svg
        viewBox="0 0 200 200"
        className="h-[86%] w-[86%]"
        animate={speaking ? { y: [0, -2.5, 0] } : { y: 0 }}
        transition={
          speaking ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }
        }
      >
        {/* Girl: hair falls behind the head, down past the jaw. */}
        {isGirl && (
          <path
            d="M100 26 C52 26 38 62 40 98 C41 130 34 152 30 166 C50 176 66 174 74 168
               L74 108 L126 108 L126 168 C134 174 150 176 170 166 C166 152 159 130 160 98
               C162 62 148 26 100 26 Z"
            fill={hair}
          />
        )}

        {/* Ears */}
        <circle cx="37" cy="108" r="9" fill={skin} />
        <circle cx="163" cy="108" r="9" fill={skin} />

        {/* Head */}
        <ellipse cx="100" cy="106" rx="63" ry="68" fill={skin} />
        {/* Jaw shading — one soft ellipse so the face isn't a flat disc. */}
        <ellipse cx="100" cy="150" rx="34" ry="14" fill={skinShadow} opacity="0.18" />

        {/* Hair */}
        {isGirl ? (
          // Fringe sweeping across the forehead, parted to her left.
          <path
            d="M100 34 C60 34 44 62 42 88 C52 70 62 66 74 68 C64 58 82 46 100 50
               C112 42 140 48 148 66 C156 74 158 82 158 88 C156 60 140 34 100 34 Z"
            fill={hair}
          />
        ) : (
          // Short crop with a slightly uneven edge.
          <path
            d="M100 32 C58 32 40 64 41 92 C48 78 54 74 60 76 C56 64 68 54 78 58
               C76 48 94 42 104 48 C112 40 132 46 134 56 C146 54 152 66 150 76
               C156 74 158 82 159 92 C160 64 142 32 100 32 Z"
            fill={hair}
          />
        )}

        {/* Brows — lift when thinking. */}
        <motion.g animate={{ y: thinking ? -5 : 0 }} transition={{ duration: 0.25 }}>
          <path
            d="M64 88 Q76 82 88 87"
            stroke={hair}
            strokeWidth="4.5"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M112 87 Q124 82 136 88"
            stroke={hair}
            strokeWidth="4.5"
            strokeLinecap="round"
            fill="none"
          />
        </motion.g>

        {/* Eyes — pupils drift up while thinking; lids blink on a loop. The two characters
            blink on different periods so side-by-side previews don't look mechanical. */}
        <motion.g animate={{ y: thinking ? -2.5 : 0 }} transition={{ duration: 0.25 }}>
          <motion.g
            style={EYE_STYLE}
            animate={BLINK_KEYFRAMES}
            transition={{
              duration: isGirl ? 5.1 : 4.3,
              times: [0, 0.94, 0.97, 1],
              repeat: Infinity,
            }}
          >
            <circle cx="76" cy="102" r="6.5" fill="#2a211d" />
            <circle cx="78" cy="100" r="2" fill="#ffffff" opacity="0.85" />
            {isGirl && (
              <path
                d="M67 95 Q75 90 85 93"
                stroke="#2a211d"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
            )}
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
            <circle cx="124" cy="102" r="6.5" fill="#2a211d" />
            <circle cx="126" cy="100" r="2" fill="#ffffff" opacity="0.85" />
            {isGirl && (
              <path
                d="M115 93 Q125 90 133 95"
                stroke="#2a211d"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
            )}
          </motion.g>
        </motion.g>

        {/* Blush */}
        <ellipse cx="66" cy="122" rx="9" ry="5" fill="#e88b7d" opacity={isGirl ? 0.35 : 0.18} />
        <ellipse cx="134" cy="122" rx="9" ry="5" fill="#e88b7d" opacity={isGirl ? 0.35 : 0.18} />

        {/* Nose */}
        <path
          d="M97 112 Q95 122 100 124"
          stroke={skinShadow}
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />

        {/* Mouth: an ellipse whose height follows the voice, under a resting smile that
            fades out as the mouth opens. */}
        <ellipse cx="100" cy="141" rx={10 + openness * 5} ry={mouthRy} fill={mouth} />
        <path
          d="M86 139 Q100 149 114 139"
          stroke={mouth}
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
          opacity={Math.max(0, 1 - openness * 3)}
        />
      </motion.svg>
    </div>
  );
}
