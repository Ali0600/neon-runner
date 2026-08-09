// Motion constants shared by the runner and the scope scheduler.
//
// These live here rather than in runner.js so that the pure scope modules stay
// genuinely dependency-free: importing them from runner.js would drag three and
// every .glsl file in behind them, and a "pure" module that cannot be loaded by
// plain node is not pure.

export const WALK_SPEED = 4.5;
export const SPRINT_SPEED = 17.0;
