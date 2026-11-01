#!/usr/bin/env -S npx tsx
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { initWorkspace, workspaceProblem } from '../src/workspace/init';
import { applyFix, fixLines, planFix } from '../src/graph/fix';
import { createApp } from '../src/server/server';
import { importExport } from '../src/import/importRows';
import { loadSteps } from '../src/rules/stages';
import { systemClock } from '../src/clock';
import { checkReport, checkWorkspace } from '../src/graph/check';
import { writeExportFiles } from '../src/graph/jsonld';
import { exportModel, importModel, modelStatus, sizeText, statusLines } from '../src/memory/model';
import { loadSettings } from '../src/round/store';
import { NETWORK_ANALYSES, networkCheck, networkFor, networkLines, writeNetworkxExport, type NetworkAnalysis } from '../src/graph/network';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
};
/** Flags that take no value: the word after them is a positional, not their value. */
const SWITCHES = ['--strict', '--json', '--with-derived', '--with-form-choices', '--apply'];
const positional = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1]?.startsWith('--') && !SWITCHES.includes(argv[i - 1])));
const has = (name: string) => argv.includes(`--${name}`);
const [command, ...rest] = positional;
/** Every value of a flag that may be given more than once (--stamp op-9=ID --stamp op-12=ID). */
const flags = (name: string): string[] => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] !== undefined ? [argv[i + 1]] : []));
const named = flag('workspace') ?? (process.env.CAFE_WORKSPACE?.trim() || undefined);
const root = path.resolve(named ?? 'cafe-workspace');
/** Stops with one plain message when the folder is missing or not a Café workspace; nothing is read or written. */
async function needWorkspace(): Promise<void> {
  const problem = await workspaceProblem(root);
  if (problem) { console.error(problem); process.exit(1); }
}
const clock = systemClock;

const USAGE = 'Usage: cafe <init | start | import <file> | ontology check [--strict] | ontology fix [--apply] [--stamp op-N=ID[,ID]] [--repoint op-N=STAR] [--retire op-N] [--confirm line-N] [--resign] | export [--idea ID] [--format networkx] | model <status | import <folder-or-zip> | export <zip>> | network <check | stats | central | clusters | path A B | isolated | suggest | cycles> [--with-derived] [--with-unconfirmed] [--with-form-choices] [--json]> [--workspace DIR] [--port N]';
const NETWORK_USAGE = `Usage: cafe network <check | ${NETWORK_ANALYSES.map((a) => (a === 'path' ? 'path "<from>" "<to>"' : a)).join(' | ')}> [--with-derived] [--with-unconfirmed] [--with-form-choices] [--json] [--top N] [--workspace DIR]`;
const MODEL_USAGE = 'Usage: cafe model status | cafe model import <folder-or-zip> | cafe model export <zip>  [--workspace DIR]';

async function main(): Promise<void> {
  switch (command) {
    case 'init': {
      const { created, moved, left } = await initWorkspace(root);
      if (moved.length) console.log(`Moved into data/: ${moved.join(', ')}`);
      if (left.length) console.log(`In both places, left as they are (move them into data/ by hand): ${left.join(', ')}`);
      console.log(created.length ? `Created in ${root}:\n  ${created.join('\n  ')}` : `${root} is already set up.`);
      return;
    }
    case 'start': {
      // A folder named on purpose is set up on first start; the default folder only when it is a workspace already.
      const problem = await workspaceProblem(root);
      const fresh = named !== undefined && (await readdir(root).then((x) => x.length === 0, () => true));
      if (problem && !fresh) { console.error(problem); process.exit(1); }
      const { moved, left } = await initWorkspace(root);
      if (moved.length) console.log(`Moved the Café's data into data/: ${moved.join(', ')}`);
      if (left.length) console.log(`These are both at the top and in data/, so they were left as they are: ${left.join(', ')}. Move what you need into data/ by hand.`);
      const port = Number(flag('port') ?? 4100);
      const server = createApp({ root, clock });
      server.on('error', (e: NodeJS.ErrnoException) => {
        console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the other Café or use --port N.` : e.message);
        process.exit(1);
      });
      server.listen(port, '127.0.0.1', () => {
        console.log(`Creators' Café is running at http://localhost:${port}\nWorkspace: ${root}\nStop with Ctrl+C.`);
      });
      return;
    }
    case 'import': {
      if (!rest[0]) throw new Error('Usage: cafe import <export.csv|export.xlsx>');
      await needWorkspace();
      const report = await importExport(root, path.resolve(rest[0]), { clock, steps: await loadSteps(root) });
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    case 'ontology': {
      if (rest[0] !== 'check' && rest[0] !== 'fix') throw new Error('Usage: cafe ontology check [--strict] | cafe ontology fix [--apply] [--stamp op-N=ID[,ID]] [--repoint op-N=STAR] [--retire op-N] [--confirm line-N] [--resign] [--workspace DIR]');
      await needWorkspace();
      if (rest[0] === 'fix') {
        // A dry run unless --apply: what it would change and how the derived links would change.
        const stamp: Record<string, string[]> = {};
        for (const s of flags('stamp')) {
          const m = /^([\w-]+)=(.+)$/.exec(s);
          if (!m) throw new Error(`--stamp ${s}: write it as op-9=CAFE-2026-006 (or several ideas with commas)`);
          stamp[m[1]] = m[2].split(',').map((x) => x.trim()).filter(Boolean);
        }
        // The operator's say on what fix never decides alone: a stale edit repointed or switched off, a confirmation recorded.
        const repoint: Record<string, string> = {};
        for (const s of flags('repoint')) {
          const m = /^(op-\d+)=(\S+)$/.exec(s);
          if (!m) throw new Error(`--repoint ${s}: write it as op-2=capability:document-text-extraction`);
          repoint[m[1]] = m[2];
        }
        const retire = flags('retire');
        const confirm = flags('confirm').map((x) => { const m = /^line-(\d+)$/.exec(x); if (!m) throw new Error(`--confirm ${x}: write it as line-12`); return Number(m[1]); });
        const plan = await planFix(root, stamp, { repoint, retire, confirm, resign: has('resign') });
        const applied = has('apply') ? await applyFix(root, plan, clock) : undefined;
        for (const l of fixLines(plan, applied)) console.log(l);
        return;
      }
      // --strict: a stale operator edit, an unscoped fact or a low-confidence AI link fails the check too.
      const { lines, code } = checkReport(await checkWorkspace(root), has('strict'));
      for (const l of lines) console.log(l);
      if (code) process.exit(code);
      return;
    }
    case 'export': {
      await needWorkspace();
      const format = flag('format');
      if (format && format !== 'networkx' && format !== 'jsonld') throw new Error('Usage: cafe export [--idea ID] [--format jsonld | networkx]');
      if (format === 'networkx') {
        // For analysts with their own notebook: node-link JSON that networkx.node_link_graph loads (docs/networkx-example.py).
        if (flag('idea')) throw new Error('The NetworkX export is the whole graph; leave out --idea.');
        console.log(`Written: ${await writeNetworkxExport(root, clock)}\nLoad it with docs/networkx-example.py, or networkx.node_link_graph(json.load(f), edges="edges").`);
        return;
      }
      const idea = flag('idea');
      const files = await writeExportFiles(root, idea ? { kind: 'idea', id: idea } : { kind: 'all' }, clock);
      console.log(`Written: ${files.data}\nIts schema: ${files.vocabulary} (RDFS vocabulary) and ${files.shapes} (SHACL shapes), at ${files.base}`);
      return;
    }
    case 'model': {
      // Deep read's model when the firm blocks the hub: where it is, a copy in by hand, a zip out for a colleague.
      // Nothing here contacts any host. The workspace settings are read for the mirror and the offline switch.
      const settings = async () => (await loadSettings(root).catch(() => ({} as { deepRead?: undefined }))).deepRead;
      switch (rest[0]) {
        case 'status': {
          for (const l of statusLines(await modelStatus(process.env, await settings()))) console.log(l);
          return;
        }
        case 'import': {
          if (!rest[1]) throw new Error(MODEL_USAGE);
          const r = await importModel(rest[1], process.env);
          console.log(`Imported ${r.files.length} files (${sizeText(r.bytes)}) from ${r.from} into ${r.folder}:\n  ${r.files.join('\n  ')}`);
          const s = await modelStatus(process.env, await settings());
          console.log(s.cached ? 'The model is on this machine: Deep read needs no download.' : `Still missing: ${s.missing.join(', ')}`);
          return;
        }
        case 'export': {
          if (!rest[1]) throw new Error(MODEL_USAGE);
          const r = await exportModel(rest[1], process.env);
          console.log(`Written: ${r.zip} (${sizeText(r.bytes)}, ${r.files.length} files). On the other machine: cafe model import ${path.basename(r.zip)}`);
          return;
        }
        default:
          throw new Error(MODEL_USAGE);
      }
    }
    case 'network': {
      // NetworkX analyses the graph the app built: read-only, confirmed stored facts unless --with-unconfirmed or --with-derived.
      const what = rest[0];
      if (what === 'check') {
        const { lines, ok } = await networkCheck();
        for (const l of lines) console.log(l);
        if (!ok) process.exit(1);
        return;
      }
      if (!what || !NETWORK_ANALYSES.includes(what as NetworkAnalysis)) throw new Error(NETWORK_USAGE);
      await needWorkspace();
      if (what === 'path' && (!rest[1] || !rest[2])) throw new Error(NETWORK_USAGE);
      const top = flag('top') ? Number(flag('top')) : undefined;
      const out = await networkFor(root, what as NetworkAnalysis, { ...(what === 'path' ? { a: rest[1], b: rest[2] } : {}), ...(top ? { top } : {}), ...(has('with-form-choices') ? { formChoices: true } : {}) }, { withDerived: has('with-derived'), withUnconfirmed: has('with-unconfirmed') });
      if (has('json')) console.log(JSON.stringify(out, null, 2));
      else for (const l of networkLines(out)) console.log(l);
      return;
    }
    case undefined:
      console.log(USAGE);
      return;
    default:
      console.error(`Unknown command "${command}".\n${USAGE}`);
      process.exit(1);
  }
}

main().catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
