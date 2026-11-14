// What of the sound department is switched on in this build. Today's version (11.11) carries checkpoint A only: the
// loudness meter, its targets and «Bring to target». The mixer, «Balance the mix» and «Sync by waveform» are written
// but not yet proven on a build: they stay out of sight — no button, no menu item, no ⌘K entry — until their own
// checkpoints (B, C, D) are proven. Their code stays in the tree and is never loaded while its switch is off.
export const SOUND_MIXER = false;
export const SOUND_BALANCE = false;
export const SOUND_SYNC = false;
