// Ridge Runner's entrypoint (Node 22, standard library only). The game itself
// lives in game/ as plain static files a desktop browser loads offline, and
// this program hands it in: it copies game/ and screenshots/ into the output
// directory and writes dossier.json, the summary the judge reads, using the
// vendored make.fun library. It does nothing else — no network, no randomness,
// no clock — so two runs on the same tree produce the same bytes.
//
// Run it outside the grader with MAKEFUN_OUTPUT_DIR standing in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Serve the game locally with `node serve.ts`, then open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const root = fileURLToPath(new URL('./', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The caps the scorer's gate applies: only text_max_bytes shapes the dossier
// bytes; the rest refuse an entry the scorer would refuse (more than 4
// screenshots, one over 256 KiB, game/ past 993 files or 48 MiB in all, or a
// game path over 1000 bytes).
const caps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

mkdirSync(outDir, { recursive: true });
cpSync(join(root, 'game'), join(outDir, 'game'), { recursive: true });
const shots = join(root, 'screenshots');
if (existsSync(shots)) {
  cpSync(shots, join(outDir, 'screenshots'), { recursive: true });
} else {
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });
}
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, caps));
// A one-line receipt on stdout, so a local run shows what it handed in.
const dossierBytes = statSync(join(outDir, 'dossier.json')).size;
console.log(`Ridge Runner: wrote ${join(outDir, 'dossier.json')} (${dossierBytes} bytes)`);
