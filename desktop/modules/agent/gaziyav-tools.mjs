/**
 * What a fork brings beside upstream's own, as the built app finds it. Reads no Electron module.
 *
 *   toolsEnvironment   the programs Gaziyav's services run (scripts/release.mjs → resources/runtime/tools: yt-dlp for
 *                      a piece of a video by its link, uv for a local model's Python environment), named to what runs
 *                      them: the services read GAZIYAV_YTDLP and GAZIYAV_UV (packages/gaziyav-providers), the bloggers'
 *                      engine GZ_FRAME_TOOL (its Vision tool, compiled at build time). Nothing in a
 *                      build without them: the services then look on the person's PATH.
 *   installOwnCommands the commands of the fork's own packages (`gz-motion`, `gz`…), beside `openfilm` on the agents'
 *                      PATH, each run as `openfilm` is: this app's copy, on the app's own Node.
 *   profileEnvironment what a throwaway profile's Studio is given from the launcher's environment (a test's stand-in
 *                      services, OPENFILM_<NAME>_URL, and GAZIYAV_* settings): never in the person's own app.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandScript } from './openfilm-command.mjs';
import { nodeBinary } from './node-runtime.mjs';

const require = createRequire(import.meta.url);

/** @param {string | null} runtime the app's `runtime` folder @returns {Record<string, string>} */
export function toolsEnvironment(runtime) {
  if (!runtime) return {};
  const found = { GAZIYAV_YTDLP: join(runtime, 'tools', 'yt-dlp', 'yt-dlp_macos'), GAZIYAV_UV: join(runtime, 'tools', 'bin', 'uv'), GZ_FRAME_TOOL: join(runtime, 'tools', 'bin', 'gz-frame'), GZ_LOOK_TOOL: join(runtime, 'tools', 'bin', 'gz-look-tool') };
  return Object.fromEntries(Object.entries(found).filter(([, path]) => existsSync(path)));
}

/** The fork's own packages this app was built with: the staged app's list, else the checkout's workspace dependencies. */
export function ownPackages(manifest = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')) {
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    if (Array.isArray(pkg.gaziyavPackages)) return pkg.gaziyavPackages.filter((n) => typeof n === 'string');
    return Object.entries(pkg.dependencies ?? {}).filter(([name, spec]) => name !== 'openfilm' && String(spec).startsWith('workspace:')).map(([name]) => name);
  } catch { return []; }
}

/**
 * Where a package of the app's is, or null. In a built app our packages also lie under their repository folder's name
 * (`gaziyav-crew` for `@gaziyav/crew`, scripts/release.mjs), beside `openfilm` as they are in `packages/`: they reach
 * upstream's files by that place, so that copy is the one run. From a checkout the link leads to `packages/` itself.
 */
export function packageDir(name) {
  const folder = name.replace(/^@gaziyav\//, 'gaziyav-');
  for (const base of require.resolve.paths(name) ?? []) {
    for (const at of new Set([folder, name])) if (existsSync(join(base, at, 'package.json'))) return realpathSync(join(base, at));
  }
  return null;
}

/**
 * Each command of the fork's own packages written into `bin` (the folder `openfilm` is in), as `openfilm` is written
 * there (openfilm-command.mjs). → the names written.
 * @param {string} bin @param {{ node?: string, ffmpeg?: string | null, env?: Record<string, string>, packages?: string[], platform?: string }} [o]
 */
export function installOwnCommands(bin, { node = nodeBinary(), ffmpeg = null, env = {}, packages = ownPackages(), platform = process.platform } = {}) {
  if (platform === 'win32') return [];
  const written = [];
  mkdirSync(bin, { recursive: true });
  for (const name of packages) {
    const dir = packageDir(name);
    if (!dir) continue;
    let commands = {};
    try { commands = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).bin ?? {}; } catch { continue; }
    for (const [command, file] of Object.entries(typeof commands === 'string' ? { [name.split('/').pop()]: commands } : commands)) {
      if (!/^[\w.-]+$/.test(command) || command === 'openfilm' || !existsSync(join(dir, String(file)))) continue;
      writeFileSync(join(bin, command), commandScript(node, join(dir, String(file)), { ffmpeg, env }));
      chmodSync(join(bin, command), 0o755);
      written.push(command);
    }
  }
  return written;
}

/** @param {Record<string, string | undefined>} [source] @returns {Record<string, string>} */
export function profileEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => typeof value === 'string'
    && (/^OPENFILM_[A-Z0-9_]+_URL$/.test(key) || (/^GAZIYAV_[A-Z0-9_]+$/.test(key) && !key.startsWith('GAZIYAV_PROFILE_')))));
}

/** The folders of skills the fork's own packages bring (each package's `skills/`), as OPENFILM_PRODUCT_SKILLS takes them; '' for none. */
export function productSkills(packages = ownPackages()) {
  const dirs = packages.map((name) => packageDir(name)).filter(Boolean).map((dir) => join(dir, 'skills')).filter((dir) => existsSync(dir));
  return [...new Set(dirs)].join(delimiter);
}
