#!/usr/bin/env node
//
// Mutation harness: break the code on purpose, and prove the suite notices.
//
//   npm run sabotage                 # every case
//   npm run sabotage -- --only wall  # cases whose name contains "wall"
//   npm run sabotage -- --list       # names only, runs nothing
//
// A test that has never failed proves nothing. Each case below edits one source
// file to reintroduce a specific defect, runs the whole suite, and asserts that
// the SPECIFIC test written to guard that defect is the one that goes red.
//
// Four ways a case can lie, all of which are failures here rather than passes:
//
//   PATTERN-NOT-FOUND   the code moved and the sabotage never applied. A
//                       sabotage that did not apply looks exactly like a test
//                       that caught it, so this cannot be a skip.
//   SABOTAGE-NO-OP      the edit landed but changed nothing (checksummed).
//   NOT CAUGHT          the suite stayed green — the test is decoration.
//   WRONG DENOMINATOR   the suite ran a different NUMBER of tests, which is what
//                       a sabotage that breaks an import looks like: the file
//                       fails to load, its tests never run, and the remaining
//                       ones pass.
//
// The file's content is snapshotted IN MEMORY and restored from that, never with
// `git checkout` — the file under test routinely holds uncommitted work, and a
// checkout would discard all of it, not just the sabotage. The restore is
// verified by checksum and repeated from exit and signal hooks, so Ctrl-C or a
// thrown error cannot leave sabotaged code on disk. (SIGKILL cannot be caught by
// anyone; if that ever happens, the message names the file to `git checkout`.)
//
// The run loop is ASYNC for exactly that reason. Node cannot run a signal
// handler until the event loop turns, so a synchronous loop of blocking test
// runs ignores Ctrl-C completely — verified by killing this harness mid-case and
// watching it run happily to completion.
//
// A fresh vitest process per case is deliberate. Reusing one would be much
// faster and would also reuse its module cache, which means measuring the
// PREVIOUS case's code and drawing confident conclusions from it.
//
// Patterns are literal source text, so they rot: a rename or a reflow breaks
// them. That is why PATTERN-NOT-FOUND is loud. Re-run this after any change to
// the files it targets, and after the formatter rather than before.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

const CASES = [
  // --- src/city.js ---------------------------------------------------------
  {
    name: 'nearestFace: drop the roofline gate',
    file: 'src/city.js',
    find: '    if (y >= b.h) continue;\n\n    const dx = x - b.x;',
    repl: '\n    const dx = x - b.x;',
    expect: 'at or above the roofline',
  },
  {
    name: 'nearestFace: unsnapped (diagonal) corner normal',
    file: 'src/city.js',
    find: '      if (Math.abs(ox) >= Math.abs(oz)) nx = ox >= 0 ? 1 : -1;\n      else nz = oz >= 0 ? 1 : -1;',
    repl: '      nx = ox / dist;\n      nz = oz / dist;',
    expect: 'snaps a corner approach',
  },
  {
    name: 'groundHeightAt: exclusive footprint boundary',
    file: 'src/city.js',
    find: '      x >= b.x - b.hw &&\n      x <= b.x + b.hw &&',
    repl: '      x > b.x - b.hw &&\n      x < b.x + b.hw &&',
    expect: 'counts the boundary as inside',
  },
  {
    name: 'slideXZ: drop the roofline gate',
    file: 'src/city.js',
    find: '    if (y >= b.h) continue;\n\n    const dx = outX - b.x;',
    repl: '\n    const dx = outX - b.x;',
    expect: 'does not block above the roofline',
  },
  {
    name: 'slideXZ: move both axes instead of sliding',
    file: 'src/city.js',
    find: '      outX = b.x + cx + (ox / d) * radius;\n      outZ = b.z + cz + (oz / d) * radius;',
    repl: '      outX = b.x + cx + (ox / d) * radius * 1.5;\n      outZ = b.z + cz + (oz / d) * radius * 1.5;',
    expect: 'slides along the wall',
  },
  {
    name: 'viewClearance: return tMax (far side) instead of tMin',
    file: 'src/city.js',
    find: '    if (!miss && tMin < best) best = tMin;',
    repl: '    if (!miss && tMax < best) best = tMax;',
    expect: 'stops the camera in front of a wall',
  },
  {
    name: 'viewClearance: ignore the radius padding',
    file: 'src/city.js',
    find: '    const lo = [b.x - b.hw - radius, -radius, b.z - b.hd - radius];\n    const hi = [b.x + b.hw + radius, b.h + radius, b.z + b.hd + radius];',
    repl: '    const lo = [b.x - b.hw, 0, b.z - b.hd];\n    const hi = [b.x + b.hw, b.h, b.z + b.hd];',
    expect: 'grows the box by the radius',
  },
  {
    name: 'viewClearance: ignore building height',
    file: 'src/city.js',
    find: '      if (Math.abs(d[k]) < 1e-9) {',
    repl: '      if (k === 1) continue;\n      if (Math.abs(d[k]) < 1e-9) {',
    expect: 'ignores a building the sightline passes over',
  },
  {
    name: 'viewClearance: stop skipping the box the anchor is inside',
    file: 'src/city.js',
    find: '      continue;\n    }\n\n    let tMin = 0;',
    repl: '      // skipped\n    }\n\n    let tMin = 0;',
    expect: 'ignores the building the anchor is pressed against',
  },
  {
    name: 'buildCity: ignore the seed argument',
    file: 'src/city.js',
    find: '  const rng = mulberry32(seed);',
    repl: '  const rng = mulberry32(CITY_SEED);',
    expect: 'places a different world for a different seed',
  },
  {
    name: 'buildCity: skip the pickup keep-out',
    file: 'src/city.js',
    find: '      if (keepOut.some((k) => Math.hypot(k.x - x, k.z - z) < k.r + reach)) continue;',
    repl: '',
    expect: 'leaves every pickup reachable',
  },

  // --- src/vertical.js -----------------------------------------------------
  {
    name: 'vertical: mount without the key held',
    file: 'src/vertical.js',
    find: '    (i.jumpHeld || i.jumpPressed) &&\n    i.wallTop !== null &&',
    repl: '    i.wallTop !== null &&',
    expect: 'does NOT grab a wall while falling past it',
  },
  {
    name: 'vertical: drop the mount speed gate',
    file: 'src/vertical.js',
    find: '    i.groundSpeed > WALL_MIN_SPEED;',
    repl: '    true;',
    expect: 'will not mount below the minimum speed',
  },
  {
    name: 'vertical: report vy 0 while climbing',
    file: 'src/vertical.js',
    find: "    return { mode: 'wall', y, vy: WALL_CLIMB_SPEED, wallTop: s.wallTop, event: null };",
    repl: "    return { mode: 'wall', y, vy: 0, wallTop: s.wallTop, event: null };",
    expect: 'reports the climb speed as vy',
  },
  {
    name: 'vertical: crest against the live query instead of the stored roofline',
    file: 'src/vertical.js',
    find: '    if (y >= s.wallTop) {',
    repl: '    if (i.wallTop !== null && i.wallTop !== undefined && y >= i.wallTop) {',
    expect: 'crests even though the live query goes null at the top',
  },
  {
    name: 'vertical: ignore a surface dropping away',
    file: 'src/vertical.js',
    find: '  if (i.supportY < s.y - 1e-6) {',
    repl: '  if (false) {',
    expect: 'falls from rest when the surface drops away',
  },
  {
    name: 'vertical: advance the climb on real time instead of simDt',
    file: 'src/vertical.js',
    find: '    const y = s.y + WALL_CLIMB_SPEED * i.simDt;',
    repl: '    const y = s.y + WALL_CLIMB_SPEED * (1 / 60);',
    expect: 'is a fixed point at simDt = 0 in wall',
  },

  // --- src/game/logic.js ---------------------------------------------------
  {
    name: 'sweptCollect: drop the vertical reach bound',
    file: 'src/game/logic.js',
    find: '  if (dy > maxHeight) return hits;',
    repl: '',
    expect: 'does NOT collect from twenty units up the wall above it',
  },

  // --- src/scope/schedule.js -----------------------------------------------
  {
    name: 'schedule: drop wallrun from the cycle',
    file: 'src/scope/schedule.js',
    find: "    cfg.wallrun === false ? null : ['wallrun', d.wallrun],",
    repl: '',
    expect: 'carries every event kind by default',
  },
  {
    name: 'schedule: hold the jump key through the whole segment',
    file: 'src/scope/schedule.js',
    find: '      jump = sample.tNorm >= 0.15 && sample.tNorm < 0.5;',
    repl: '      jump = true;',
    expect: 'signals jump only inside a jump segment',
  },
  {
    name: 'schedule: leave the climb window open until the segment ends',
    file: 'src/scope/schedule.js',
    find: '      climb = sample.tNorm >= 0.22 && sample.tNorm < 0.55;',
    repl: '      climb = sample.tNorm >= 0.22;',
    expect: 'closes the climb window before the runner could land again',
  },
  {
    name: 'schedule: climb window too short to clear the wall',
    file: 'src/scope/schedule.js',
    find: '      climb = sample.tNorm >= 0.22 && sample.tNorm < 0.55;',
    repl: '      climb = sample.tNorm >= 0.22 && sample.tNorm < 0.28;',
    expect: 'gives the climb window enough time to clear the lane wall',
  },
  {
    name: 'schedule: constant speed through a jump (discontinuous joins)',
    file: 'src/scope/schedule.js',
    find: '      speed = walk + (sprint - walk) * 0.8 * Math.sin(sample.tNorm * Math.PI);',
    repl: '      speed = walk + (sprint - walk) * 0.8;',
    expect: 'is continuous across every segment boundary',
  },

  // --- src/afterimages/logic.js ---
  {
    name: 'afterimages: snapshot regardless of how far the runner moved',
    file: 'src/afterimages/logic.js',
    find: '  return dx * dx + dy * dy + dz * dz >= spacing * spacing;',
    repl: '  return true;',
    expect: 'does not fire while the runner has not moved far enough',
  },
  {
    name: 'afterimages: measure the snapshot gap on the ground plane only',
    file: 'src/afterimages/logic.js',
    find: '  return dx * dx + dy * dy + dz * dz >= spacing * spacing;',
    repl: '  return dx * dx + dz * dz >= spacing * spacing;',
    expect: 'measures distance in 3D so a wall climb still emits',
  },
  {
    name: 'afterimages: drop the sprint-glow gate',
    file: 'src/afterimages/logic.js',
    find: '  if (!(dissolve >= minDissolve)) return false;',
    repl: '',
    expect: 'requires the sprint glow',
  },
  {
    name: 'afterimages: let the ring grow past its cap',
    file: 'src/afterimages/logic.js',
    find: '  return list.length > cap ? list.shift() : null;',
    repl: '  return null;',
    expect: 'drops the oldest when full',
  },
  {
    name: 'afterimages: a fade that never quite reaches zero',
    file: 'src/afterimages/logic.js',
    find: '  if (age >= fadeSeconds) return 0;',
    repl: '  if (age >= fadeSeconds) return 0.02;',
    expect: 'is full at capture and zero at the end of the fade',
  },
  {
    name: 'afterimages: a fade that stops short of full dissolution',
    file: 'src/afterimages/logic.js',
    find: '  return GHOST_FRESH_EROSION + (FULL_EROSION - GHOST_FRESH_EROSION) * t * (2 - t);',
    repl: '  return GHOST_FRESH_EROSION + (1.2 - GHOST_FRESH_EROSION) * t * (2 - t);',
    expect: 'erodes past the noise ceiling at zero strength',
  },
  {
    name: 'afterimages: born at the live body cap (legless ghosts)',
    file: 'src/afterimages/logic.js',
    find: 'export const GHOST_FRESH_EROSION = 0.12;',
    repl: 'export const GHOST_FRESH_EROSION = 0.62;',
    expect: 'leaves the figure nearly whole at full strength',
  },
  {
    name: 'afterimages: flip the burst back to the tail of the trail',
    file: 'src/afterimages/logic.js',
    find: '  return GHOST_FRESH_EROSION + (FULL_EROSION - GHOST_FRESH_EROSION) * t * (2 - t);',
    repl: '  return GHOST_FRESH_EROSION + (FULL_EROSION - GHOST_FRESH_EROSION) * t * t;',
    expect: 'is already coming apart just behind the runner',
  },

  // --- src/particles/spawnComputation.js ---
  {
    name: 'spawn: keep the plume running in the afterimages mode',
    file: 'src/particles/spawnComputation.js',
    find: '  if (!plumeEnabled(params.sprintFx)) return 0;',
    repl: '',
    expect: 'stops the continuous plume in the afterimages mode',
  },

  // --- src/trail/Trail.js ---
  {
    name: 'trail: sample at the runner origin instead of chest height',
    file: 'src/trail/Trail.js',
    find: '      out.set(runner.position.x, runner.position.y + 1.0, runner.position.z);',
    repl: '      out.set(runner.position.x, runner.position.y, runner.position.z);',
    expect: 'samples at chest height',
  },
  {
    name: 'trail: measure the step on the ground plane only',
    file: 'src/trail/Trail.js',
    find: '      (p.x - last.x) ** 2 + (p.y - last.y) ** 2 + (p.z - last.z) ** 2 > MIN_STEP * MIN_STEP;',
    repl: '      (p.x - last.x) ** 2 + (p.z - last.z) ** 2 > MIN_STEP * MIN_STEP;',
    expect: 'measures the step in 3D',
  },
  {
    name: 'trail: emit regardless of the sprint glow',
    file: 'src/trail/Trail.js',
    find: '    if (moved && shouldEmit(runner)) {',
    repl: '    if (moved) {',
    expect: 'emits only while the runner is glowing',
  },
  {
    name: 'trail: ignore the width hook and always use trailWidth',
    file: 'src/trail/Trail.js',
    find: '    material.uniforms.uWidth.value = getWidth();',
    repl: '    material.uniforms.uWidth.value = params.trailWidth;',
    expect: 'is scaled off the trail width',
  },

  // --- src/trail/LimbStreaks.js ---
  {
    name: 'streaks: every ribbon follows the same limb',
    file: 'src/trail/LimbStreaks.js',
    find: '        const p = runner.streakPoints[i];',
    repl: '        const p = runner.streakPoints[0];',
    expect: 'samples the limb tips',
  },
  {
    name: 'streaks: emit in every sprint FX mode',
    file: 'src/trail/LimbStreaks.js',
    find: '        limbStreaksActive(params.sprintFx, params.limbStreaks) && runner.dissolve > 0.02,',
    repl: '        runner.dissolve > 0.02,',
    expect: 'emits only when the sprint FX mode wants ghosts',
  },
  {
    name: 'streaks: clear only the first ribbon',
    file: 'src/trail/LimbStreaks.js',
    find: '      for (const r of ribbons) r.clear();',
    repl: '      ribbons[0].clear();',
    expect: 'clears every ribbon',
  },
];

// --- crash safety ----------------------------------------------------------
// Whatever file is sabotaged right now, and the bytes to put back. Restoring
// from an exit hook as well as inline means a Ctrl-C, a thrown error or a killed
// terminal cannot leave broken code on disk for someone to commit later.
let inFlight = null;
let running = null; // the live vitest child, so a signal does not orphan it

function restoreInFlight() {
  if (!inFlight) return;
  try {
    writeFileSync(inFlight.path, inFlight.content);
    console.error(`\n[sabotage] restored ${inFlight.rel} after an early exit`);
  } catch (err) {
    console.error(`\n[sabotage] COULD NOT RESTORE ${inFlight.rel}: ${err.message}`);
    console.error(`[sabotage] recover it with: git checkout -- ${inFlight.rel}`);
  }
  inFlight = null;
}

process.on('exit', restoreInFlight);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (running) running.kill('SIGKILL');
    restoreInFlight();
    process.exit(130);
  });
}
process.on('uncaughtException', (err) => {
  restoreInFlight();
  console.error(err);
  process.exit(1);
});

// --- running the suite -----------------------------------------------------

/**
 * Run the whole suite and return vitest's JSON report plus its exit code.
 * A run that produces no parseable report is a HARNESS failure, not a caught
 * sabotage — otherwise a broken config would read as every test biting at once.
 */
function runSuite() {
  return new Promise((resolve) => {
    const child = spawn('npx', ['vitest', 'run', '--reporter=json'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    running = child;
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.on('close', (code) => {
      running = null;
      const start = stdout.indexOf('{');
      if (start === -1) return resolve({ code, report: null });
      try {
        resolve({ code, report: JSON.parse(stdout.slice(start)) });
      } catch {
        resolve({ code, report: null });
      }
    });
  });
}

// --- main ------------------------------------------------------------------

const args = process.argv.slice(2);
const onlyIdx = args.indexOf('--only');
const only = onlyIdx !== -1 ? args[onlyIdx + 1] : null;
const cases = only
  ? CASES.filter((c) => c.name.toLowerCase().includes(only.toLowerCase()))
  : CASES;

if (args.includes('--list')) {
  for (const c of cases) console.log(`${c.file.padEnd(22)} ${c.name}`);
  process.exit(0);
}

if (cases.length === 0) {
  console.error(`no cases match --only ${only}`);
  process.exit(1);
}

const t0 = Date.now();
const baseline = await runSuite();
if (!baseline.report || baseline.code !== 0) {
  console.error('The suite is not green before any sabotage — fix that first.');
  process.exit(1);
}
const baseTotal = baseline.report.numTotalTests;
console.log(`baseline: ${baseTotal} tests green\n`);

let bad = 0;
for (const c of cases) {
  const path = join(ROOT, c.file);
  const before = readFileSync(path, 'utf8');
  const beforeHash = sha(before);

  if (!before.includes(c.find)) {
    console.log(`PATTERN-NOT-FOUND  ${c.name}\n      ${c.file} no longer contains the target text`);
    bad++;
    continue;
  }

  writeFileSync(path, before.replace(c.find, c.repl));
  inFlight = { path, rel: c.file, content: before };

  if (sha(readFileSync(path, 'utf8')) === beforeHash) {
    console.log(`SABOTAGE-NO-OP     ${c.name}`);
    bad++;
    writeFileSync(path, before);
    inFlight = null;
    continue;
  }

  const { code, report } = await runSuite();

  writeFileSync(path, before);
  inFlight = null;
  if (sha(readFileSync(path, 'utf8')) !== beforeHash) {
    throw new Error(`RESTORE FAILED for ${c.file} — do not commit, check the file`);
  }

  let verdict;
  if (code === 0) {
    verdict = 'NOT CAUGHT — the test does not bite';
    bad++;
  } else if (!report) {
    verdict = `HARNESS ERROR — vitest exited ${code} with no report`;
    bad++;
  } else if (report.numTotalTests !== baseTotal) {
    verdict = `WRONG DENOMINATOR — ran ${report.numTotalTests} of ${baseTotal}; the sabotage probably broke an import`;
    bad++;
  } else {
    const failed = report.testResults
      .flatMap((f) => f.assertionResults)
      .filter((a) => a.status === 'failed')
      .map((a) => a.title);
    const hit = failed.find((t) => t.includes(c.expect));
    if (hit) {
      verdict = `caught by "${hit}"`;
    } else {
      verdict = `CAUGHT BY THE WRONG TEST — expected one matching "${c.expect}", got: ${failed.join(' | ') || '(none)'}`;
      bad++;
    }
  }

  console.log(`${verdict.startsWith('caught') ? 'OK  ' : 'FAIL'}  ${c.name}\n      ${verdict}`);
}

const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(
  `\n${cases.length} case(s) in ${secs}s — ${bad === 0 ? 'all sabotages caught' : `${bad} PROBLEM(S)`}`
);
process.exit(bad === 0 ? 0 : 1);
