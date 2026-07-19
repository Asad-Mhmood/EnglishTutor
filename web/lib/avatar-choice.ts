/**
 * The avatar the learner picked on the pre-call screen.
 *
 * Client-safe: names and labels only, no secrets. The server-side counterpart is the
 * `avatar_mode` participant attribute minted by /api/token — this module is about what the
 * learner sees, that one is about what the agent can trust.
 */

export type AvatarChoice = 'boy' | 'girl' | 'photo';

export const DEFAULT_AVATAR_CHOICE: AvatarChoice = 'boy';

/** The tutor's name for a given choice, for page copy ("Sara will chat back…"). */
export function tutorNameFor(choice: AvatarChoice): string {
  switch (choice) {
    case 'girl':
      return 'Sara';
    case 'photo':
      // The photo's persona (name and voice) is decided by the agent after it looks at the
      // picture, so the copy stays neutral rather than guessing wrong.
      return 'your tutor';
    default:
      return 'Ahmad';
  }
}
