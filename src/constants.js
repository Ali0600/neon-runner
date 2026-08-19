// Motion constants shared by the runner and the scope scheduler.
//
// These live here rather than in runner.js so that the pure scope modules stay
// genuinely dependency-free: importing them from runner.js would drag three and
// every .glsl file in behind them, and a "pure" module that cannot be loaded by
// plain node is not pure.

export const WALK_SPEED = 4.5;
export const SPRINT_SPEED = 17.0;

// --- vertical motion -------------------------------------------------------
// Tuned against the figure, which stands ~1.8 units tall.

export const GRAVITY = 26.0; // u/s^2 — heavier than earth, so the arc reads snappy
export const JUMP_VELOCITY = 11.0; // ~2.3 u apex, ~0.85 s hang time
// Faster than SPRINT_SPEED on purpose: mounting a wall should feel like the
// runner gains something, not like it costs them. In Second Son the Light Speed
// run does not slow down when it turns vertical.
export const WALL_CLIMB_SPEED = 20.0;
export const WALL_REACH = 1.4; // how close a face must be to grab it
export const WALL_MIN_SPEED = 8.0; // you have to be running, not strolling
export const CREST_BOOST = 6.0; // upward pop on clearing the lip
// How far past the lip the crest carries the runner. It is climbing at
// BODY_RADIUS outside the face, so clearing the roof needs at least that much
// inward travel or it tops out and drops straight back down the wall.
export const CREST_INSET = 0.9;

// --- glide -----------------------------------------------------------------
// Hold the jump key while falling and the descent caps at a slow sink, so a
// jump off a roof turns into a drift rather than a drop. Horizontal speed is
// untouched — the glide trades fall speed for airtime, not for distance.

// A seventh of GRAVITY's per-second pull, which is slow enough to read as
// hovering while still visibly descending.
export const GLIDE_SINK_SPEED = 3.5;
// You must already be falling this fast to deploy. Without it the apex of a
// jump — where vy passes through zero — would flicker in and out of the glide
// on consecutive frames, which reads as the jump stuttering rather than as a
// mode change.
export const GLIDE_MIN_FALL_SPEED = 1.0;

// Roofline of the synthetic wall SCOPE puts in the lane. Low enough that the
// climb, the crest and the fall back down all fit inside one scheduled segment,
// which is what makes the whole move inspectable in a single pass.
export const SCOPE_WALL_TOP = 22.0;

// --- wall steering ---------------------------------------------------------
// How fast the runner can slide ALONG a face while climbing it. Half the climb
// speed, so holding a strafe key traces roughly a 27-degree diagonal up the
// building rather than a vertical line.
//
// The climb used to pin horizontal velocity to zero outright, which read as
// stiff: the velocity lerp restarts from zero every frame, so a held key only
// ever got one frame of ACCEL easing (~14%) through before being wiped.
export const WALL_LATERAL_SPEED = 10.0;
