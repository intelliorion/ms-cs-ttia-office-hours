import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ideaDir } from '../ideas/store';
import { writeFileAtomic } from '../workspace/files';
import { DIAGRAM_CSS, diagramSvg, esc } from '../roadshow/render/html';
import { readDesign } from './store';
import type { DiagramSpec } from './diagram';
import { FileReply } from '../server/fileReply';
import { KIT_DIR } from './kits';
import { FLOW_DIAGRAM_FILE } from './recipeFlow';

/** The design diagram as a file beside design.md and approach.md, to open in a browser or share. */
export const DIAGRAM_FILE = 'design-diagram.html';

const LANE_WORD: Record<string, string> = { tool: 'The build', person: 'People', data: 'Data', outside: 'Outside the build' };
const KIND_WORD: Record<string, string> = { input: 'Input', store: 'Store', step: 'Step', output: 'Output', person: 'Person', gap: 'Gap' };

/** One self-contained page: the diagram, then every part with what it is, lane by lane (light and dark, prints well). */
export function renderDiagramHtml(spec: DiagramSpec, title: string, drawn: string): string {
  const parts = spec.lanes.map((l) => {
    const mine = spec.nodes.filter((n) => n.lane === l.id);
    if (!mine.length) return '';
    return `<section><h2>${esc(LANE_WORD[l.kind] ?? l.kind)}: ${esc(l.label)}</h2><ul>${mine.map((n) => `<li class="k-${esc(n.kind)}"><b>${esc(n.label)}</b> <span class="kw">${esc(KIND_WORD[n.kind] ?? n.kind)}</span>${n.detail ? `<div>${esc(n.detail)}</div>` : ''}</li>`).join('')}</ul></section>`;
  }).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}: the design diagram</title>
<style>
:root{--accent:#1f6f5c;--head:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;--body:var(--head);--bg:#f5f8fb;--slide:#fff;--text:#1b2a3a;--muted:#5e7186;--line:#dde3ec;--soft:#f3f6fa;--card:#fff;
--k-input:#2563eb;--k-store:#7c3aed;--k-step:var(--accent);--k-output:#059669;--k-person:#d97706;--k-gap:#dc2626;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--accent:#7dd3cf;--bg:#0b0d10;--slide:#141c1c;--text:#e9eef0;--muted:#9fb0ae;--line:#26314a;--soft:#162036;--card:#141d2f;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 var(--body)}
main{max-width:1240px;margin:0 auto;padding:24px 18px}
h1{font:700 22px var(--head);margin:0 0 2px}.sub{color:var(--muted);margin:0 0 16px}
.box{background:var(--slide);border:1px solid var(--line);border-radius:14px;padding:8px;overflow:auto}
${DIAGRAM_CSS}
.diagram{height:auto;width:max(100%,1500px)}
section{margin-top:18px}h2{font:700 14px var(--head);letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin:0 0 6px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
li{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--k-step);border-radius:10px;padding:8px 12px}
${['input', 'store', 'step', 'output', 'person', 'gap'].map((k) => `li.k-${k}{border-left-color:var(--k-${k})}`).join('')}
li .kw{font-size:12px;color:var(--muted);margin-left:6px}li div{color:var(--text);opacity:.88;margin-top:2px}
@media print{body{background:#fff}.box{border:none}}
</style></head><body><main>
<h1>${esc(title)}: the design</h1><p class="sub">Drawn ${esc(drawn)}. Each part is described below the picture.</p>
<div class="box">${diagramSvg(spec)}</div>
${parts}
</main></body></html>
`;
}

/** Writes design-diagram.html from the design's diagram (when there is one). */
export async function writeDiagramFile(root: string, id: string, title: string): Promise<boolean> {
  const state = await readDesign(root, id);
  if (!state.diagram) return false;
  await writeFileAtomic(path.join(await ideaDir(root, id), DIAGRAM_FILE), renderDiagramHtml(state.diagram.spec, title, state.diagram.at));
  return true;
}

/** The two diagrams, to open in a browser tab from the design pack: the design's and the Dataiku recipe flow. */
export async function diagramReply(root: string, id: string, name: string, title: string): Promise<FileReply> {
  const dir = await ideaDir(root, id);
  if (name === DIAGRAM_FILE) {
    // Drawn before there was a file: write it now from the design.
    if (!(await fs.stat(path.join(dir, DIAGRAM_FILE)).catch(() => null)) && !(await writeDiagramFile(root, id, title))) throw new Error('The design has no diagram yet');
    return new FileReply(await fs.readFile(path.join(dir, DIAGRAM_FILE)), 'text/html; charset=utf-8');
  }
  if (name === FLOW_DIAGRAM_FILE) {
    const body = await fs.readFile(path.join(dir, KIT_DIR, 'dataiku', FLOW_DIAGRAM_FILE)).catch(() => null);
    if (!body) throw new Error('The recipe flow is not written yet: write the plan and kits first');
    return new FileReply(body, 'text/html; charset=utf-8');
  }
  throw new Error('Not a diagram');
}
