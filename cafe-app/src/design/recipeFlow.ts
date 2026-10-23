/**
 * The Dataiku kit's recipe flow: datasets (boxes) → recipes (circles) → output datasets and a dashboard, as Dataiku
 * draws its Flow. The AI proposes the datasets and recipes; checkFlow keeps only what holds together. The layout is
 * worked out here (pure), so the design pack (ui) and kit/dataiku/flow-diagram.html draw the same picture.
 */
import { columns as flowColumns, pathOf, wrap } from './diagramLayout';
import type { DiagramSpec } from './diagram';
import type { KitDataiku } from '../ai/tasks';

export type FlowDatasetKind = 'input' | 'rules' | 'intermediate' | 'output';
export interface FlowDataset { id: string; name: string; kind: FlowDatasetKind; about: string; columns: { name: string; type: string }[] }
export interface FlowRecipe { id: string; name: string; kind: string; inputs: string[]; outputs: string[]; steps: string[]; feature?: string }
export interface FlowDashboard { id: string; name: string; shows: string[]; from: string[] }
/** flow.json: what the pack and flow-diagram.html draw. */
export interface RecipeFlow { project: string; datasets: FlowDataset[]; recipes: FlowRecipe[]; dashboard?: FlowDashboard }

export const FLOW_FILE = 'flow.json';
export const FLOW_DIAGRAM_FILE = 'flow-diagram.html';
const KINDS: FlowDatasetKind[] = ['input', 'rules', 'intermediate', 'output'];
const ID = /^[A-Za-z0-9_-]{1,30}$/;
const one = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const strs = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v : []).map((x) => one(x, max)).filter(Boolean).slice(0, n);

/**
 * The flow made safe: ids unique and plain, a recipe's inputs and outputs only datasets that exist (a recipe with
 * neither is dropped), a dataset made by a recipe is never an input, a dashboard only on datasets that exist. A
 * feature named that is not one of `features` is left off.
 */
export function checkFlow(raw: unknown, project: string, features: string[] = []): RecipeFlow | undefined {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<KitDataiku> & { dashboard?: Partial<FlowDashboard> };
  const ids = new Set<string>();
  const uniq = (id: unknown, fallback: string) => {
    let x = ID.test(String(id ?? '')) ? String(id) : fallback;
    while (ids.has(x)) x = `${x}_2`;
    ids.add(x);
    return x;
  };
  const feat = new Map(features.map((f) => [f.toLowerCase(), f]));
  const datasets: FlowDataset[] = (Array.isArray(r.datasets) ? r.datasets : []).slice(0, 12).flatMap((d, i) => {
    const name = one(d?.name, 60);
    if (!name) return [];
    const kind = KINDS.includes(d.kind as FlowDatasetKind) ? (d.kind as FlowDatasetKind) : 'intermediate';
    const columns = (Array.isArray(d.columns) ? d.columns : []).slice(0, 20).map((c) => ({ name: one(c?.name, 40), type: one(c?.type, 12) || 'string' })).filter((c) => c.name);
    return [{ id: uniq(d.id, `ds${i + 1}`), name, kind, about: one(d.about, 200), columns }];
  });
  // The AI's id → ours (a clash renamed it); when two datasets share an id, the first keeps it.
  const byGiven = new Map<string, string>();
  (Array.isArray(r.datasets) ? r.datasets : []).slice(0, 12).filter((d) => one(d?.name, 60)).forEach((d, i) => {
    const given = String(d.id ?? '');
    if (datasets[i] && !byGiven.has(given)) byGiven.set(given, datasets[i].id);
  });
  const known = (list: unknown) => strs(list, 4, 30).map((x) => byGiven.get(x)).filter((x): x is string => !!x);
  const made = new Set<string>();
  const recipes: FlowRecipe[] = [];
  for (const [i, x] of (Array.isArray(r.recipes) ? r.recipes : []).slice(0, 12).entries()) {
    const name = one(x?.name, 60);
    const outputs = [...new Set(known(x?.outputs))].filter((o) => !made.has(o));
    const inputs = [...new Set(known(x?.inputs))].filter((o) => !outputs.includes(o));
    if (!name || !inputs.length || !outputs.length) continue;
    outputs.forEach((o) => made.add(o));
    const f = feat.get(one(x.feature, 60).toLowerCase());
    recipes.push({ id: uniq(x.id, `r${i + 1}`), name, kind: one(x.kind, 12) || 'prepare', inputs, outputs, steps: strs(x.steps, 10, 240), ...(f ? { feature: f } : {}) });
  }
  if (!recipes.length) return undefined;
  // A dataset nothing reads and nothing makes is left out of the picture.
  const used = new Set(recipes.flatMap((x) => [...x.inputs, ...x.outputs]));
  const d = r.dashboard;
  const from = d ? [...new Set(known(d.from))].filter((x) => used.has(x)) : [];
  const dashboard = d && one(d.name, 60) && from.length ? { id: uniq('dashboard', 'dashboard'), name: one(d.name, 60), shows: strs(d.shows, 6, 160), from } : undefined;
  return { project: one(project, 80), datasets: datasets.filter((x) => used.has(x.id)), recipes, ...(dashboard ? { dashboard } : {}) };
}

/* ---------- layout ---------- */

export const DS_W = 156;
export const DS_H = 56;
export const RC_R = 27;
export const SLOT_H = 104;
export const COL_W = 196;
export const FLOW_PAD = 24;

export type FlowNodeType = 'dataset' | 'recipe' | 'dashboard';
export interface FlowNode {
  id: string; type: FlowNodeType; label: string; kind: string;
  /** The centre of the shape. */
  cx: number; cy: number; col: number;
}
export interface FlowEdge { from: string; to: string; d: string }
export interface FlowLayout { width: number; height: number; nodes: FlowNode[]; edges: FlowEdge[] }

/** Every arrow: dataset → recipe that reads it, recipe → dataset it makes, dataset → dashboard. */
export function flowEdges(flow: RecipeFlow): { from: string; to: string }[] {
  return [
    ...flow.recipes.flatMap((r) => [...r.inputs.map((i) => ({ from: i, to: r.id })), ...r.outputs.map((o) => ({ from: r.id, to: o }))]),
    ...(flow.dashboard ? flow.dashboard.from.map((f) => ({ from: f, to: flow.dashboard!.id })) : []),
  ];
}

/** A node's whole path: what flows into it and what it flows into (for hover). */
export const flowPathOf = (flow: RecipeFlow, id: string) => pathOf({ edges: flowEdges(flow) }, id);

/** Half the shape's width, so an arrow meets its edge. */
const half = (t: FlowNodeType) => (t === 'recipe' ? RC_R : DS_W / 2);

export function flowLayout(flow: RecipeFlow): FlowLayout {
  const raw = [
    ...flow.datasets.map((d) => ({ id: d.id, type: 'dataset' as const, label: d.name, kind: d.kind })),
    ...flow.recipes.map((r) => ({ id: r.id, type: 'recipe' as const, label: r.name, kind: r.kind })),
    ...(flow.dashboard ? [{ id: flow.dashboard.id, type: 'dashboard' as const, label: flow.dashboard.name, kind: 'dashboard' }] : []),
  ];
  const edges = flowEdges(flow);
  const col = flowColumns({ lanes: [], nodes: raw.map((n) => ({ id: n.id, lane: '', label: '', kind: 'step' })), edges } as DiagramSpec);
  const cols = Math.max(0, ...raw.map((n) => col.get(n.id) ?? 0)) + 1;
  const inCol = Array.from({ length: cols }, (_, c) => raw.filter((n) => (col.get(n.id) ?? 0) === c));
  const tallest = Math.max(1, ...inCol.map((c) => c.length));
  const height = FLOW_PAD * 2 + tallest * SLOT_H;
  const placed = new Map<string, FlowNode>();
  for (let c = 0; c < cols; c++) {
    // Order a column by where what flows into it sits, so arrows cross as little as they can.
    const ys = (id: string) => {
      const from = edges.filter((e) => e.to === id).map((e) => placed.get(e.from)?.cy).filter((y): y is number => y !== undefined);
      return from.length ? from.reduce((a, b) => a + b, 0) / from.length : 0;
    };
    const list = c === 0 ? inCol[c] : [...inCol[c]].sort((a, b) => ys(a.id) - ys(b.id));
    const top = FLOW_PAD + ((tallest - list.length) * SLOT_H) / 2;
    list.forEach((n, k) => placed.set(n.id, { ...n, col: c, cx: FLOW_PAD + DS_W / 2 + c * COL_W, cy: top + k * SLOT_H + SLOT_H / 2 - 8 }));
  }
  const nodes = raw.map((n) => placed.get(n.id)!);
  const out: FlowEdge[] = edges.map((e) => {
    const a = placed.get(e.from)!; const b = placed.get(e.to)!;
    const x1 = a.cx + half(a.type); const x2 = b.cx - half(b.type) - 2; const dx = Math.max(24, (x2 - x1) / 2);
    return { from: e.from, to: e.to, d: `M${x1},${a.cy} C${x1 + dx},${a.cy} ${x2 - dx},${b.cy} ${x2},${b.cy}` };
  });
  return { width: FLOW_PAD * 2 + DS_W + (cols - 1) * COL_W, height, nodes, edges: out };
}

/** A node's label lines, under a recipe or inside a dataset box. */
export const flowLabel = (n: Pick<FlowNode, 'type' | 'label'>) => wrap(n.label, n.type === 'recipe' ? 20 : 19, 2);

/** The word for a dataset's kind and a recipe's. */
export const FLOW_KIND_WORD: Record<string, string> = {
  input: 'Input dataset', rules: 'Rules sheet', intermediate: 'Dataset', output: 'Output dataset', dashboard: 'Dashboard',
  prepare: 'Prepare recipe', join: 'Join recipe', filter: 'Filter recipe', group: 'Group recipe', stack: 'Stack recipe', split: 'Split recipe',
  sort: 'Sort recipe', window: 'Window recipe', distinct: 'Distinct recipe', pivot: 'Pivot recipe', 'top-n': 'Top N recipe',
};
/** What a node's card says: the recipe's steps, the dataset's columns, the dashboard's charts. */
export function flowDetail(flow: RecipeFlow, id: string): { title: string; kind: string; lines: { label: string; items: string[] }[] } | undefined {
  const name = (x: string) => flow.datasets.find((d) => d.id === x)?.name ?? x;
  const r = flow.recipes.find((x) => x.id === id);
  if (r) {
    return {
      title: r.name, kind: FLOW_KIND_WORD[r.kind] ?? `${r.kind} recipe`,
      lines: [
        ...(r.feature ? [{ label: 'Feature', items: [r.feature] }] : []),
        { label: 'Reads', items: r.inputs.map(name) }, { label: 'Makes', items: r.outputs.map(name) },
        { label: 'Steps', items: r.steps.length ? r.steps : ['(not settled in the design)'] },
      ],
    };
  }
  const d = flow.datasets.find((x) => x.id === id);
  if (d) {
    return {
      title: d.name, kind: FLOW_KIND_WORD[d.kind] ?? 'Dataset',
      lines: [...(d.about ? [{ label: 'Holds', items: [d.about] }] : []), { label: 'Columns', items: d.columns.length ? d.columns.map((c) => `${c.name} (${c.type})`) : ['(not settled in the design)'] }],
    };
  }
  if (flow.dashboard?.id === id) {
    return { title: flow.dashboard.name, kind: 'Dashboard', lines: [{ label: 'Shows', items: flow.dashboard.shows }, { label: 'From', items: flow.dashboard.from.map(name) }] };
  }
  return undefined;
}

/* ---------- flow-diagram.html ---------- */

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** One node as SVG: a dataset box, a recipe circle with its label under it, or a dashboard tile. */
export function nodeSvg(n: FlowNode): string {
  const lines = flowLabel(n);
  if (n.type === 'recipe') {
    return `<g class="rf-node rf-recipe" data-node="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(FLOW_KIND_WORD[n.kind] ?? 'Recipe')}: ${esc(n.label)}">`
      + `<circle cx="${n.cx}" cy="${n.cy}" r="${RC_R}"/><text class="rf-ic" x="${n.cx}" y="${n.cy + 5}" text-anchor="middle">${esc((n.kind[0] ?? 'r').toUpperCase())}</text>`
      + lines.map((t, k) => `<text class="rf-t" x="${n.cx}" y="${n.cy + RC_R + 16 + k * 15}" text-anchor="middle">${esc(t)}</text>`).join('') + '</g>';
  }
  const x = n.cx - DS_W / 2; const y = n.cy - DS_H / 2;
  const word = n.type === 'dashboard' ? 'DASHBOARD' : (FLOW_KIND_WORD[n.kind] ?? 'Dataset').toUpperCase();
  return `<g class="rf-node rf-${n.type} rk-${esc(n.kind)}" data-node="${esc(n.id)}" tabindex="0" role="button" aria-label="${esc(word)}: ${esc(n.label)}">`
    + `<rect x="${x}" y="${y}" width="${DS_W}" height="${DS_H}" rx="${n.type === 'dashboard' ? 14 : 6}"/><rect class="rf-bar" x="${x}" y="${y}" width="${DS_W}" height="5" rx="2.5"/>`
    + `<text class="rf-k" x="${x + 10}" y="${y + 19}">${esc(word)}</text>`
    + lines.map((t, k) => `<text class="rf-t" x="${x + 10}" y="${y + 36 + k * 14}">${esc(t)}</text>`).join('') + '</g>';
}

/** The flow as one self-contained page: inline SVG, CSS and a little script (hover lights a path; click shows a card). */
export function renderFlowHtml(flow: RecipeFlow, title: string): string {
  const L = flowLayout(flow);
  const edges = L.edges.map((e) => `<path class="rf-edge" data-e="${esc(`${e.from}>${e.to}`)}" d="${e.d}" marker-end="url(#rfa)"/>`).join('');
  const cards = Object.fromEntries(L.nodes.map((n) => [n.id, flowDetail(flow, n.id)]));
  const paths = Object.fromEntries(L.nodes.map((n) => { const p = flowPathOf(flow, n.id); return [n.id, { n: [...p.nodes], e: [...p.edges] }]; }));
  // JSON inside a script: "<" escaped so no text can close the tag.
  const data = JSON.stringify({ cards, paths }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}: Dataiku recipe flow</title>
<style>
:root{--bg:#f5f8fb;--panel:#fff;--text:#1b2a3a;--muted:#5e7186;--line:70,100,130;--accent:31,111,92;--warm:184,134,43;--cream:150,112,52;--ok:62,128,78;--violet:109,72,206;--shadow:40,60,90}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d10;--panel:#141c1c;--text:#e9eef0;--muted:#9fb0ae;--line:160,190,185;--accent:125,211,207;--warm:245,179,107;--cream:231,216,177;--ok:134,214,153;--violet:139,92,246;--shadow:0,0,0}}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 "IBM Plex Sans","Segoe UI",system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:20px 16px}
h1{font-size:20px;margin:0 0 4px}p.sub{margin:0 0 14px;color:var(--muted)}
.wrap{position:relative}.box{overflow:auto;border:1px solid rgba(var(--line),.25);border-radius:12px;background:var(--panel)}
svg{display:block;font-family:inherit;user-select:none}
.rf-edge{fill:none;stroke:rgba(var(--line),.55);stroke-width:1.6;transition:opacity .15s}
.rf-edge.on{stroke:rgb(var(--accent));stroke-width:2.4}.rf-edge.dim{opacity:.2}
#rfa path{fill:rgba(var(--line),.75)}
.rf-node{cursor:pointer;outline:none;transition:opacity .15s;--k:var(--accent)}
.rf-node.dim{opacity:.28}
.rf-dataset{--k:var(--cream)}.rk-input{--k:var(--warm)}.rk-output{--k:var(--ok)}.rk-rules{--k:var(--cream)}.rf-dashboard{--k:var(--violet)}
.rf-node rect:first-child,.rf-node circle{fill:var(--panel);stroke:rgba(var(--k),.75);stroke-width:1.4;filter:drop-shadow(0 2px 5px rgba(var(--shadow),.18))}
.rf-recipe circle{fill:rgba(var(--k),.16);stroke:rgb(var(--k))}
.rf-node.on rect:first-child,.rf-node.on circle,.rf-node:focus-visible rect:first-child,.rf-node:focus-visible circle{stroke:rgb(var(--k));stroke-width:2.4}
.rf-bar{fill:rgb(var(--k))}.rf-k{font-size:9.5px;letter-spacing:.09em;font-weight:600;fill:rgb(var(--k))}
.rf-t{font-size:12.5px;fill:var(--text)}.rf-ic{font-size:15px;font-weight:700;fill:rgb(var(--k))}
.card{position:absolute;top:10px;right:10px;width:300px;max-height:calc(100% - 20px);overflow:auto;box-sizing:border-box;background:var(--panel);border:1px solid rgba(var(--line),.35);border-radius:12px;box-shadow:0 12px 32px rgba(var(--shadow),.3);padding:12px 14px;display:none}
.card.open{display:block}.card .k{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.card h2{font-size:16px;margin:2px 0 8px}.card h3{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:10px 0 2px}
.card ul{margin:0;padding-left:18px}.card button{float:right;border:0;background:none;color:var(--muted);font-size:18px;cursor:pointer}
.hint{color:var(--muted);font-size:12.5px;margin-top:8px}
@media (max-width:760px){.card{position:static;width:100%;max-height:none;margin-top:8px;box-shadow:none}}
</style></head>
<body><main>
<h1>${esc(title)}</h1>
<p class="sub">Dataiku recipe flow${flow.project ? ` for the project ${esc(flow.project)}` : ''}: datasets (boxes) go into recipes (circles), which make the output datasets${flow.dashboard ? ' and the dashboard' : ''}. Synthetic sample data only.</p>
<div class="wrap"><div class="box">
<svg width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}" role="img" aria-label="Recipe flow: ${flow.datasets.length} datasets, ${flow.recipes.length} recipes">
<defs><marker id="rfa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
${edges}${L.nodes.map(nodeSvg).join('')}
</svg></div>
<aside class="card" id="card" aria-live="polite"></aside></div>
<div class="hint">Hover a dataset or recipe to light its path; click it for its columns or its steps.</div>
</main>
<script>
(function(){var D=${data};var picked=null;
var nodes=[].slice.call(document.querySelectorAll('.rf-node')),edges=[].slice.call(document.querySelectorAll('.rf-edge')),card=document.getElementById('card');
function light(id){var p=id&&D.paths[id];nodes.forEach(function(n){var on=p&&p.n.indexOf(n.getAttribute('data-node'))>=0;n.classList.toggle('on',!!on);n.classList.toggle('dim',!!p&&!on);});
edges.forEach(function(e){var on=p&&p.e.indexOf(e.getAttribute('data-e'))>=0;e.classList.toggle('on',!!on);e.classList.toggle('dim',!!p&&!on);});}
function t(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function show(id){picked=id;var c=id&&D.cards[id];if(!c){card.className='card';card.innerHTML='';light(null);return;}
card.innerHTML='<button aria-label="Close">×</button><div class="k">'+t(c.kind)+'</div><h2>'+t(c.title)+'</h2>'+c.lines.map(function(l){return '<h3>'+t(l.label)+'</h3><ul>'+l.items.map(function(i){return '<li>'+t(i)+'</li>';}).join('')+'</ul>';}).join('');
card.className='card open';card.querySelector('button').onclick=function(){show(null);};light(id);}
nodes.forEach(function(n){var id=n.getAttribute('data-node');n.addEventListener('mouseenter',function(){light(id);});n.addEventListener('mouseleave',function(){light(picked);});
n.addEventListener('focus',function(){light(id);});n.addEventListener('blur',function(){light(picked);});
n.addEventListener('click',function(){show(picked===id?null:id);});n.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();show(picked===id?null:id);}});});
})();
</script>
</body></html>
`;
}
