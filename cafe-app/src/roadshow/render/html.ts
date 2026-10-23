/**
 * deck.html: ONE self-contained file (inline CSS, script and photos; nothing from the network), 16:9 slides drawn by
 * the app from the deck model. ←/→ (or click) to move, S for the speaker notes, F for full screen, T for light or dark.
 * Printing gives one slide per page, so "Save as PDF" in the print window is the PDF export. Every text is escaped.
 */
import { deckFit, layout, wrap } from '../../design/diagramLayout';
import type { DiagramSpec, NodeKind } from '../../design/diagram';
import { formatDate } from '../../clock';
import type { DeckSlide } from '../../ai/tasks';
import type { DeckModel, DeckPerson, FitMark } from '../deck';

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The label over each kind of slide. */
export const KIND_LABEL: Record<DeckSlide['kind'], string> = {
  title: '', problem: 'The problem', today: 'How it works today', team: 'The team', solution: 'What we built', demo: 'Live demo',
  data: 'The data', diagram: 'The design', tool: 'The tool', headaches: 'What was hard', lessons: 'What we learned', reuse: 'To reuse it',
  next: 'What happens next', question: 'A question for you', thanks: '',
};

const FIT_WORD: Record<FitMark, string> = { yes: 'Yes', partly: 'Partly', no: 'No', out: 'Out of scope', outside: 'Outside the build' };
const FIT_SIGN: Record<FitMark, string> = { yes: '✓', partly: '½', no: '✗', out: '–', outside: '↗' };
const NODE_WORD: Record<NodeKind, string> = { input: 'Input', step: 'Step', output: 'Output', person: 'Person', store: 'Store', gap: 'Gap' };
const LANE_WORD: Record<string, string> = { tool: 'THE BUILD', outside: 'OUTSIDE', person: 'PEOPLE', data: 'DATA' };

const dateText = (iso?: string) => { if (!iso) return ''; try { return formatDate(iso.slice(0, 10)); } catch { return iso; } };
const mmss = (min: number) => { const s = Math.round(min * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** The script with its cues ("[click to the demo]") picked out. */
export function notesHtml(notes: string): string {
  return notes.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\[([^\]\n]{1,80})\]/g, '<span class="cue">$1</span>')}</p>`).join('');
}

/** Text sizes inside the deck's full-slide diagram (deckFit): read from the back of the room. */
export const DECK_TEXT = { node: 20, lane: 17, edge: 15 };
/** The area the full-bleed diagram has on a 1280 × 720 slide, under the kicker and the title. */
export const DECK_DIAGRAM_AREA = { w: 1176, h: 540 };
/** The design diagram's styles (the deck's diagram slide and the standalone design-diagram.html share them). */
export const DIAGRAM_CSS = `.diagram{width:100%;height:100%}
.diagram .ln rect{fill:color-mix(in srgb,var(--text) 3%,transparent);stroke:var(--line)}.diagram .ln.alt rect{fill:color-mix(in srgb,var(--text) 5%,transparent)}
.diagram .ln .tab{fill:color-mix(in srgb,var(--accent) 10%,transparent);stroke:none}
.diagram .lk{font:700 11px var(--head);letter-spacing:.12em;fill:var(--accent)}.diagram .lt{font:600 13px var(--body);fill:var(--text)}
.diagram .ed path{fill:none;stroke:var(--muted);stroke-width:1.8}.diagram .ed.back path{stroke-dasharray:5 5}
.diagram marker path{fill:var(--muted)}
.diagram .ed rect{fill:var(--slide);stroke:var(--line)}.diagram .ed text{font:600 11px var(--body);fill:var(--muted)}
.diagram .nd>rect:first-child{fill:var(--card);stroke:var(--line);stroke-width:1.5}
.diagram .nd .bar{fill:var(--k-step)}.diagram .nd .nk{font:700 10px var(--head);letter-spacing:.1em;fill:var(--muted)}.diagram .nd .nt{font:600 13.5px var(--body);fill:var(--text)}
.diagram.big .nd .nt{font-size:${DECK_TEXT.node}px}.diagram.big .lk{font-size:14px}.diagram.big .lt{font-size:${DECK_TEXT.lane}px}.diagram.big .ed text{font-size:${DECK_TEXT.edge}px}.diagram.big .ed path{stroke-width:2.2}
${(['input', 'store', 'step', 'output', 'person', 'gap'] as const).map((k) => `.diagram .k-${k} .bar{fill:var(--k-${k})}.diagram .k-${k}>rect:first-child{stroke:color-mix(in srgb,var(--k-${k}) 45%,var(--line))}`).join('')}`;


/**
 * The design diagram as SVG, laid out as the design pack lays it out. `big` is the deck's full-slide drawing: the
 * deckFit shape that draws it largest and larger text, each part's kind shown by its colour bar only (its word would
 * cost a line).
 */
export function diagramSvg(spec: DiagramSpec, big = false): string {
  const fit = big ? deckFit(spec, DECK_DIAGRAM_AREA.w, DECK_DIAGRAM_AREA.h) : undefined;
  const L = fit ? fit.layout : layout(spec);
  const tabW = fit ? fit.size.labelW - 12 : 120;
  const lanes = L.lanes.map((l, i) => `<g class="ln lk-${l.kind}${i % 2 ? ' alt' : ''}"><rect x="6" y="${l.y}" width="${L.width - 12}" height="${l.h}" rx="12"/>`
    + `<rect class="tab" x="6" y="${l.y}" width="${tabW}" height="${l.h}" rx="12"/><text class="lk" x="18" y="${l.y + (big ? 26 : 22)}">${esc(LANE_WORD[l.kind] ?? '')}</text>`
    + (fit ? wrap(l.label, fit.laneChars, 3).map((t, k) => `<text class="lt" x="18" y="${l.y + 50 + k * 20}">${esc(t)}</text>`)
      : wrap(l.label, 15, 3).map((t, k) => `<text class="lt" x="18" y="${l.y + 42 + k * 16}">${esc(t)}</text>`)).join('') + '</g>').join('');
  const [cw, eh] = big ? [DECK_TEXT.edge * 0.6, 26] : [6.6, 20];
  const edges = L.edges.map((e) => `<g class="ed${e.back ? ' back' : ''}"><path d="${e.d}" marker-end="url(#arr)"/>`
    + (e.label ? `<g transform="translate(${e.lx},${e.ly})"><rect x="${-(e.label.length * cw / 2 + 8)}" y="${-eh / 2}" width="${e.label.length * cw + 16}" height="${eh}" rx="${eh / 2}"/><text text-anchor="middle" y="${big ? 5 : 4}">${esc(e.label)}</text></g>` : '')
    + '</g>').join('');
  const nodeText = (n: (typeof L.nodes)[number]) => {
    if (!fit) return `<text class="nk" x="16" y="18">${esc(NODE_WORD[n.kind].toUpperCase())}</text>` + wrap(n.label).map((t, k) => `<text class="nt" x="16" y="${36 + k * 16}">${esc(t)}</text>`).join('');
    const lines = wrap(n.label, fit.chars, fit.lines);
    const top = n.h / 2 + 7 - (lines.length - 1) * 12;
    return `<title>${esc(NODE_WORD[n.kind])}: ${esc(n.label)}</title>` + lines.map((t, k) => `<text class="nt" x="18" y="${top + k * 24}">${esc(t)}</text>`).join('');
  };
  const nodes = L.nodes.map((n) => `<g class="nd k-${n.kind}" transform="translate(${n.x},${n.y})"><rect width="${n.w}" height="${n.h}" rx="14"/>`
    + `<rect class="bar" width="${big ? 6 : 5}" height="${n.h - 20}" x="0" y="10" rx="2.5"/>${nodeText(n)}</g>`).join('');
  return `<svg class="diagram${big ? ' big' : ''}" viewBox="0 0 ${L.width} ${L.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="The design: ${spec.nodes.length} parts in ${spec.lanes.length} lanes">`
    + '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>'
    + lanes + edges + nodes + '</svg>';
}

const avatar = (p: DeckPerson) => (p.photo
  ? `<img class="ph" alt="${esc(p.name)}" src="data:${p.photo.mime};base64,${p.photo.base64}">`
  : `<span class="ph ini" aria-hidden="true">${esc(p.initials)}</span>`);

function teamHtml(team: DeckPerson[]): string {
  const size = team.length <= 3 ? 'lg' : team.length <= 6 ? 'md' : 'sm';
  return `<ul class="team t-${size}">${team.map((p) => `<li>${avatar(p)}<b>${esc(p.name)}</b><span class="rl">${esc(p.roles)}</span></li>`).join('')}</ul>`;
}

function fitHtml(m: DeckModel): string {
  if (!m.fit) return '';
  const shown = m.fit.rows.slice(0, 9);
  const rows = shown.map((r) => `<tr class="f-${r.mark}"><td>${esc(r.feature)}</td><td><span class="mk">${FIT_SIGN[r.mark]}</span>${esc(FIT_WORD[r.mark])}</td><td><div class="nt">${esc(r.note)}</div></td></tr>`).join('');
  // A long list gets tighter rows (one line of note each), so the table stays on the slide.
  return `<div class="fit${shown.length > 6 ? ' many' : ''}"><div class="fit-h"><b>${esc(m.fit.tool)}</b>${m.fit.pathway ? `<span>${esc(m.fit.pathway)}</span>` : ''}</div>`
    + `<table><thead><tr><th>Feature</th><th>Fit</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** The data slide: what goes in (and the rules it is checked against), the build, what comes out. */
export function dataHtml(m: DeckModel): string {
  const d = m.data;
  if (!d) return '';
  // Two or more files going in share the column: fewer column names each, so the slide never spills over.
  const many = d.inputs.length + d.rules.length > 1;
  const chips = (cols: string[]) => {
    const max = many ? 4 : 8;
    const shown = cols.slice(0, max).map((c) => `<span>${esc(c)}</span>`).join('');
    return `${shown}${cols.length > max ? `<span class="more">+${cols.length - max} more</span>` : ''}`;
  };
  const card = (f: { name: string; kind: string; what: string; columns: string[] }, cls = '') => `<div class="dt-f${cls}"><div class="dt-k">${esc(f.kind)}</div><b>${esc(f.name)}</b>`
    + `${f.what ? `<p>${esc(f.what)}</p>` : ''}${f.columns.length ? `<div class="dt-cols">${chips(f.columns)}</div>` : ''}</div>`;
  const ins = [...d.inputs.map((f) => card(f)), ...d.rules.map((f) => card(f, ' rules'))].join('');
  return `<div class="dt${many ? ' many' : ''}"><div class="dt-col"><div class="dt-h">What goes in</div>${ins || '<p class="muted">Not given.</p>'}</div><div class="dt-arrow" aria-hidden="true">→</div>`
    + `<div class="dt-mid"><b>${esc(d.tool ?? 'The proof of concept')}</b><span>on sample, masked data</span></div><div class="dt-arrow" aria-hidden="true">→</div>`
    + `<div class="dt-col"><div class="dt-h">What comes out</div>${d.output ? card(d.output, ' out') : '<p class="muted">Not given.</p>'}</div></div>`;
}

function timelineHtml(m: DeckModel): string {
  const items = m.timeline.slice(0, 8);
  if (!items.length) return '';
  return `<ol class="timeline" style="--n:${items.length}">${items.map((d) => `<li><i></i><b>${esc(d.what)}</b><span>${esc(dateText(d.date))}</span></li>`).join('')}</ol>`;
}

function beforeAfterHtml(s: DeckSlide, m: DeckModel): string {
  const before = s.before?.length ? s.before : m.before;
  const after = s.after?.length ? s.after : m.after;
  const list = (xs: string[]) => (xs.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">Not written down yet.</p>');
  // Long lists get a smaller type, so the two boxes hold what they say.
  const long = (xs: string[]) => xs.length > 3 || xs.join('').length > 200;
  return `<div class="ba${long(before) || long(after) ? ' many' : ''}"><div class="ba-c before"><div class="ba-h">Today</div>${list(before)}</div><div class="ba-arrow" aria-hidden="true">→</div>`
    + `<div class="ba-c after"><div class="ba-h">With the proof of concept</div>${list(after)}</div></div>`;
}

const pointsHtml = (s: DeckSlide, ordered = false) => (s.points.length
  ? `<${ordered ? 'ol' : 'ul'} class="pts${s.points.length > 4 ? ' many' : ''}">${s.points.map((p) => `<li>${esc(p)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>` : '');
const quoteHtml = (s: DeckSlide) => (s.quote ? `<blockquote>${esc(s.quote)}</blockquote>` : '');

function slideBody(s: DeckSlide, m: DeckModel): string {
  if (s.kind === 'title' || s.kind === 'thanks') {
    const meta = [m.id, "Creators' Café · Launch and Learn", m.roundName, m.roadshowDate ? dateText(m.roadshowDate) : ''].filter(Boolean).map(esc).join(' · ');
    const who = s.kind === 'title' && m.presenters.length ? `<div class="who">${m.team.filter((p) => m.presenters.includes(p.name)).map((p) => `<span>${avatar(p)}${esc(p.name)}</span>`).join('')}</div>` : '';
    return `<div class="hero"><div class="eyebrow">${meta}</div><h1>${esc(s.kind === 'title' ? (m.title || s.title) : s.title)}</h1>`
      + `${s.kind === 'title' && m.subtitle ? `<p class="sub">${esc(m.subtitle)}</p>` : ''}${s.kind === 'thanks' ? pointsHtml(s) : ''}${who}</div>`;
  }
  if (s.kind === 'question') {
    // The title is the question; the points, when any, say what kind of answer helps.
    return `<div class="ask"><div class="ask-q${s.title.length > 90 ? ' long' : ''}">${esc(s.title)}</div>${pointsHtml(s)}</div>`;
  }
  const head = `<h2>${esc(s.title)}</h2>`;
  if (s.kind === 'demo') {
    return `${head}<div class="split"><div class="demo"><div class="play" aria-hidden="true">▶</div><div class="demo-t">Live demo</div>`
      + `${m.demoLink ? `<div class="demo-l">${esc(m.demoLink)}</div>` : '<div class="demo-l">On sample data</div>'}</div>`
      + `<div class="col">${pointsHtml(s, true)}${quoteHtml(s)}</div></div>`;
  }
  switch (s.visual) {
    case 'team': return `${head}${teamHtml(m.team)}${s.points.length ? `<div class="foot-pts">${pointsHtml(s)}</div>` : ''}`;
    case 'diagram': {
      if (!m.diagram) return `${head}<div class="body">${pointsHtml(s)}</div>`;
      // Full bleed: the diagram fills the slide under the title, with no points beside it (deckModel moves them into the notes).
      return `${head}<div class="dia full">${diagramSvg(m.diagram, true)}</div>`;
    }
    case 'fit-table': return `${head}<div class="split wide-l"><div>${fitHtml(m)}</div><div class="col">${pointsHtml(s)}${quoteHtml(s)}</div></div>`;
    case 'timeline': return `${head}${timelineHtml(m)}<div class="foot-pts">${pointsHtml(s)}${quoteHtml(s)}</div>`;
    // The drawing says most of it: at most two points under it.
    // With no confirmed data to draw, the points are the slide.
    case 'data': return m.data ? `${head}${dataHtml(m)}${s.points.length ? `<div class="foot-pts">${pointsHtml({ ...s, points: s.points.slice(0, 2) })}</div>` : ''}` : `${head}${pointsHtml(s)}`;
    case 'before-after': return `${head}${beforeAfterHtml(s, m)}${s.points.length ? `<div class="foot-pts">${pointsHtml({ ...s, points: s.points.slice(0, 2) })}</div>` : ''}`;
    default: return `${head}<div class="body">${pointsHtml(s)}${quoteHtml(s)}</div>`;
  }
}

function slideHtml(s: DeckSlide, i: number, m: DeckModel, starts: number[]): string {
  const n = m.slides.length;
  const label = KIND_LABEL[s.kind];
  const plain = s.kind === 'title' || s.kind === 'thanks';
  const bleed = s.visual === 'diagram' && Boolean(m.diagram);
  return `<section class="slide k-${s.kind}${s.visual ? ` v-${s.visual}` : ''}${plain ? ' hero-slide' : ''}${bleed ? ' bleed' : ''}" data-n="${i + 1}" aria-roledescription="slide" aria-label="Slide ${i + 1} of ${n}: ${esc(s.title)}"${i ? ' hidden' : ''}>`
    + `<div class="accent" aria-hidden="true"></div>`
    + (label && label.toLowerCase() !== s.title.toLowerCase() ? `<div class="kicker">${esc(label)}</div>` : '')
    + `<div class="content">${slideBody(s, m)}</div>`
    + (plain ? '' : `<footer><span>${esc(m.ideaTitle)} · Creators' Café</span><span>${i + 1} / ${n}</span></footer>`)
    + `<div class="sn" hidden data-min="${s.minutes}" data-at="${starts[i]}">${notesHtml(s.notes)}</div>`
    + '</section>';
}

const CSS = (m: DeckModel) => `
:root{--accent:${m.theme.accent};--accent2:${m.theme.accent2};--ink:${m.theme.ink};--head:${m.theme.headFont};--body:${m.theme.bodyFont};
--bg:#e9edf3;--slide:#ffffff;--text:var(--ink);--muted:#5b6475;--line:#dde3ec;--soft:#f3f6fa;--card:#ffffff;--shadow:0 30px 80px rgba(15,23,42,.18);
--k-input:#2563eb;--k-store:#7c3aed;--k-step:var(--accent);--k-output:#059669;--k-person:#d97706;--k-gap:#dc2626;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#05070c;--slide:#0f1522;--text:#e8edf6;--muted:#9aa6ba;--line:#26314a;--soft:#162036;--card:#141d2f;--shadow:0 30px 80px rgba(0,0,0,.6);color-scheme:dark}}
:root[data-theme=dark]{--bg:#05070c;--slide:#0f1522;--text:#e8edf6;--muted:#9aa6ba;--line:#26314a;--soft:#162036;--card:#141d2f;--shadow:0 30px 80px rgba(0,0,0,.6);color-scheme:dark}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);font-family:var(--body);color:var(--text);overflow:hidden}
.stage{position:fixed;inset:0 0 48px 0;display:grid;place-items:center}
body.notes-on .stage{bottom:34vh}
.frame{width:1280px;height:720px;position:relative;transform-origin:center center;flex:none}
.slide{position:absolute;inset:0;background:var(--slide);border-radius:18px;box-shadow:var(--shadow);overflow:hidden;padding:64px 88px 70px 96px;display:flex;flex-direction:column}
.slide[hidden]{display:none}
.accent{position:absolute;left:0;top:0;bottom:0;width:12px;background:linear-gradient(180deg,var(--accent),var(--accent2))}
.kicker{font:700 15px/1 var(--head);letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:14px}
.content{flex:1;display:flex;flex-direction:column;min-height:0}.content>*{zoom:var(--z,1)}
h1,h2{font-family:var(--head);margin:0;letter-spacing:-.02em}
h2{font-size:46px;line-height:1.1;font-weight:750;margin-bottom:30px;max-width:1040px}
footer{position:absolute;left:96px;right:64px;bottom:26px;display:flex;justify-content:space-between;font-size:14px;color:var(--muted)}
.pts{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:18px;font-size:28px;line-height:1.3;max-width:1000px}
.pts.many{font-size:24px;gap:13px}
.pts li{position:relative;padding-left:34px}
ul.pts li::before{content:"";position:absolute;left:2px;top:.45em;width:12px;height:12px;border-radius:4px;background:var(--accent);transform:rotate(45deg)}
ol.pts{counter-reset:p}ol.pts li{counter-increment:p;padding-left:52px}
ol.pts li::before{content:counter(p);position:absolute;left:0;top:.05em;width:34px;height:34px;border-radius:50%;background:var(--accent);color:#fff;font:700 18px/34px var(--head);text-align:center}
blockquote{margin:28px 0 0;padding:16px 0 16px 28px;border-left:5px solid var(--accent2);font-size:26px;font-style:italic;color:var(--muted);max-width:960px}
.body{display:flex;flex-direction:column}
.split{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:start;flex:1;min-height:0}
.split.wide-l{grid-template-columns:1.45fr 1fr}
.split .pts{font-size:24px;gap:14px}
.foot-pts{margin-top:auto}.foot-pts .pts{font-size:22px;gap:10px}
.hero-slide{padding:0;background:radial-gradient(1200px 600px at 85% 15%,color-mix(in srgb,var(--accent2) 55%,transparent),transparent 60%),linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 55%,#020617));color:#fff}
.hero-slide .accent{display:none}
.hero{padding:96px 110px;display:flex;flex-direction:column;justify-content:center;height:100%}
.hero .eyebrow{font:600 18px/1.4 var(--head);letter-spacing:.08em;text-transform:uppercase;opacity:.85;margin-bottom:26px}
.hero h1{font-size:72px;line-height:1.04;font-weight:800;max-width:1000px}
.hero .sub{font-size:28px;line-height:1.35;opacity:.9;margin:26px 0 0;max-width:900px}
.hero .pts{color:#fff;margin-top:30px}.hero ul.pts li::before{background:#fff}
.who{display:flex;gap:26px;margin-top:auto;flex-wrap:wrap}
.who span{display:flex;align-items:center;gap:12px;font:600 20px var(--head)}
.who .ph{width:52px;height:52px;border:2px solid rgba(255,255,255,.8);font-size:18px}
.ph{width:150px;height:150px;border-radius:50%;object-fit:cover;display:grid;place-items:center;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;font:800 46px var(--head);flex:none}
.team{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:30px 40px;justify-content:center;align-content:center;flex:1}
.team li{display:flex;flex-direction:column;align-items:center;text-align:center;width:220px;gap:8px}
.team li b{font:700 24px/1.2 var(--head);margin-top:10px}.team .rl{font-size:18px;color:var(--muted)}
.team.t-md .ph{width:120px;height:120px;font-size:38px}.team.t-sm .ph{width:92px;height:92px;font-size:30px}.team.t-sm li{width:170px}
.team img.ph{box-shadow:0 0 0 4px var(--slide),0 0 0 7px var(--accent)}
.dia{flex:1;min-height:0;background:var(--soft);border-radius:16px;padding:10px;display:flex}
.slide.bleed{padding:40px 40px 50px 52px}.bleed .kicker{margin-bottom:8px}.bleed h2{font-size:30px;line-height:1.15;margin-bottom:12px;max-width:none}
.dia.full{padding:6px;border-radius:14px}
${DIAGRAM_CSS}
.fit{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--card)}
.fit.many td{padding:5px 12px}.fit.many .nt{-webkit-line-clamp:1}.fit.many table{font-size:14px}.fit-h{display:flex;gap:14px;align-items:baseline;padding:12px 18px;background:var(--soft);font-size:22px}.fit-h span{color:var(--muted);font-size:17px}
.fit table{width:100%;border-collapse:collapse;font-size:15px;line-height:1.3}.fit th{text-align:left;color:var(--muted);font-weight:600;font-size:13px;letter-spacing:.08em;text-transform:uppercase;padding:10px 16px}
.fit td{padding:7px 14px;border-top:1px solid var(--line);vertical-align:top}.fit .nt{font-size:13.5px;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.fit td:nth-child(2){white-space:nowrap}.fit td:first-child{font-weight:650}
.fit .mk{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;margin-right:8px;font-size:14px;font-weight:800;color:#fff;background:#059669}
.fit .f-partly .mk{background:#d97706}.fit .f-no .mk{background:#dc2626}.fit .f-out .mk,.fit .f-outside .mk{background:#64748b}
.timeline{list-style:none;margin:20px 0 34px;padding:0;display:grid;grid-template-columns:repeat(var(--n),1fr);position:relative}
.timeline::before{content:"";position:absolute;left:4%;right:4%;top:15px;height:4px;border-radius:2px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.timeline li{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;padding:0 6px}
.timeline i{width:34px;height:34px;border-radius:50%;background:var(--slide);border:5px solid var(--accent);z-index:1}
.timeline li:last-child i{background:var(--accent2);border-color:var(--accent2)}
.timeline b{font:700 19px/1.2 var(--head);margin-top:8px}.timeline span{color:var(--muted);font-size:16px}
.ba{display:grid;grid-template-columns:1fr 70px 1fr;align-items:stretch;gap:0;min-height:240px;max-height:430px}
.ba-c{border-radius:18px;padding:26px 30px;background:var(--soft);border:1px solid var(--line);overflow:hidden}
.ba-c.after{background:color-mix(in srgb,var(--accent) 9%,var(--slide));border-color:color-mix(in srgb,var(--accent) 35%,var(--line))}
.ba-h{font:700 15px var(--head);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:16px}.after .ba-h{color:var(--accent)}
.ba ul{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:12px;font-size:22px;line-height:1.3}.ba.many ul{font-size:18px;gap:8px}.ba.many .ba-c{padding:20px 24px}
.ba-arrow{display:grid;place-items:center;font-size:44px;color:var(--accent)}
.dt{display:grid;grid-template-columns:1.2fr 54px .8fr 54px 1.2fr;align-items:center;gap:0}
.dt-col{display:flex;flex-direction:column;gap:12px;min-width:0}.dt-h{font:700 15px var(--head);letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.dt-f{border-radius:16px;padding:14px 18px;background:var(--soft);border:1px solid var(--line);overflow:hidden}.dt-f b{font:700 21px/1.2 var(--head);word-break:break-word}
.dt-f.rules{border-style:dashed}.dt-f.out{background:color-mix(in srgb,var(--accent) 9%,var(--slide));border-color:color-mix(in srgb,var(--accent) 35%,var(--line))}
.dt-f p{margin:6px 0 0;font-size:15px;color:var(--muted);line-height:1.3;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.dt.many .dt-f{padding:10px 16px}.dt.many .dt-f p{-webkit-line-clamp:2}.dt.many .dt-cols{margin-top:6px}.dt-cols span.more{background:none;border-style:dashed;color:var(--muted)}.dt-k{font:700 12px var(--head);letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:4px}
.dt-cols{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.dt-cols span{font:600 13px ui-monospace,Menlo,monospace;padding:3px 8px;border-radius:6px;background:var(--card);border:1px solid var(--line)}
.dt-mid{border-radius:18px;padding:22px 16px;text-align:center;background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 55%,#020617));color:#fff;display:flex;flex-direction:column;gap:6px}.dt-mid b{font:800 24px var(--head)}.dt-mid span{font-size:14px;opacity:.85}
.dt-arrow{display:grid;place-items:center;font-size:40px;color:var(--accent)}
.demo{border-radius:20px;background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 50%,#020617));color:#fff;min-height:360px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:30px;text-align:center}
.play{width:96px;height:96px;border-radius:50%;background:rgba(255,255,255,.18);display:grid;place-items:center;font-size:40px;padding-left:8px}
.demo-t{font:800 34px var(--head)}.demo-l{font-size:18px;opacity:.85;word-break:break-all}
.ask{flex:1;display:flex;flex-direction:column;justify-content:center;gap:30px}
.ask-q{font:750 54px/1.15 var(--head);letter-spacing:-.02em;max-width:1050px;position:relative;padding-left:56px}
.ask-q.long{font-size:44px}
.ask-q::before{content:"?";position:absolute;left:0;top:-6px;font-size:64px;color:var(--accent)}
.muted{color:var(--muted)}
.deckbar{position:fixed;left:0;right:0;bottom:0;height:48px;display:flex;align-items:center;gap:8px;padding:0 14px;background:color-mix(in srgb,var(--slide) 92%,transparent);border-top:1px solid var(--line);font-size:14px;z-index:5}
.deckbar button{font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer}
.deckbar button:hover{border-color:var(--accent)}.deckbar .count{min-width:72px;text-align:center;font-variant-numeric:tabular-nums}.deckbar .grow{flex:1}.deckbar .hint{color:var(--muted)}
.progress{position:fixed;left:0;right:0;bottom:48px;height:3px;background:transparent;z-index:5}.progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:width .25s}
.notes{position:fixed;left:0;right:0;bottom:48px;height:calc(34vh - 48px);overflow:auto;background:var(--slide);border-top:1px solid var(--line);padding:16px 28px;font-size:19px;line-height:1.5;z-index:4}
.notes[hidden]{display:none}.notes .nh{display:flex;gap:18px;color:var(--muted);font-size:14px;margin-bottom:6px;flex-wrap:wrap}.notes .nh b{color:var(--text)}
.notes p{margin:.4em 0;max-width:1100px}.cue{background:color-mix(in srgb,var(--accent2) 18%,transparent);color:var(--text);border-radius:6px;padding:1px 7px;font-size:.88em;font-weight:650}
.print-help{position:fixed;top:12px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;padding:10px 18px;border-radius:10px;font-size:15px;z-index:9}
.print-help[hidden]{display:none}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@page{size:1280px 720px;margin:0}
@media print{html,body{overflow:visible;height:auto;background:#fff}:root{--slide:#fff;--text:var(--ink);--muted:#5b6475;--line:#dde3ec;--soft:#f3f6fa;--card:#fff;color-scheme:light}
.deckbar,.notes,.progress,.print-help,.sr{display:none!important}.stage{position:static;display:block}.frame{transform:none!important;width:auto;height:auto}
.slide,.slide[hidden]{display:flex!important;position:relative;width:1280px;height:720px;border-radius:0;box-shadow:none;break-after:page;page-break-after:always;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.slide:last-of-type{break-after:auto;page-break-after:auto}}
`;

const SCRIPT = `(()=>{const slides=[...document.querySelectorAll('.slide')];const N=slides.length;const frame=document.getElementById('frame');const stage=document.getElementById('stage');
const notes=document.getElementById('notes');const count=document.getElementById('count');const bar=document.querySelector('.progress i');const live=document.getElementById('live');
let i=Math.min(N-1,Math.max(0,(parseInt(location.hash.slice(1),10)||1)-1));let t0=null;
// A slide whose content runs past its space (a long title, many rows, two files going in) is drawn smaller, step by
// step, until it fits: nothing spills over the footer or is cut off.
const shrink=()=>slides.forEach(s=>{const h=s.hidden;s.hidden=false;const c=s.querySelector('.content');if(c){let z=1;c.style.removeProperty('--z');while(c.scrollHeight>c.clientHeight+1&&z>0.6){z=Math.round((z-0.04)*100)/100;c.style.setProperty('--z',z);}}s.hidden=h;});
shrink();if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{shrink();show(i);});
const fit=()=>{const r=stage.getBoundingClientRect();const k=Math.min(r.width/1280,r.height/720)*0.96;frame.style.transform='scale('+k+')';};
const total=${'${TOTAL}'};const clock=s=>{s=Math.round(s);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
const show=n=>{i=Math.min(N-1,Math.max(0,n));slides.forEach((s,k)=>{s.hidden=k!==i;s.setAttribute('aria-hidden',k!==i);});count.textContent=(i+1)+' / '+N;
bar.style.width=((i+1)/N*100)+'%';history.replaceState(null,'','#'+(i+1));live.textContent=slides[i].getAttribute('aria-label');
const sn=slides[i].querySelector('.sn');const next=slides[i+1];const at=parseFloat(sn.dataset.at)*60;const min=parseFloat(sn.dataset.min);
notes.innerHTML='<div class="nh"><b>Slide '+(i+1)+' of '+N+'</b><span>about '+clock(min*60)+'</span><span>from '+clock(at)+' of '+clock(total*60)+'</span>'+(t0?'<span>elapsed <b id="el"></b></span>':'')+(next?'<span>next: '+next.getAttribute('aria-label').replace(/^Slide \\d+ of \\d+: /,'')+'</span>':'')+'</div>'+sn.innerHTML;tick();};
const tick=()=>{const el=document.getElementById('el');if(el&&t0)el.textContent=clock((Date.now()-t0)/1000);};setInterval(tick,1000);
const go=d=>{if(!t0&&d){t0=Date.now();}show(i+d);};
const toggleNotes=()=>{notes.hidden=!notes.hidden;document.body.classList.toggle('notes-on',!notes.hidden);fit();};
const full=()=>{if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen().catch(()=>{});};
const theme=()=>{const r=document.documentElement;const dark=r.dataset.theme?r.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;r.dataset.theme=dark?'light':'dark';};
addEventListener('keydown',e=>{if(e.metaKey||e.ctrlKey||e.altKey)return;const k=e.key;
if(['ArrowRight','PageDown',' ','Enter','ArrowDown'].includes(k)){e.preventDefault();go(1);}else if(['ArrowLeft','PageUp','Backspace','ArrowUp'].includes(k)){e.preventDefault();go(-1);}
else if(k==='Home')show(0);else if(k==='End')show(N-1);else if(k==='s'||k==='S')toggleNotes();else if(k==='f'||k==='F')full();else if(k==='t'||k==='T')theme();});
stage.addEventListener('click',e=>{if(e.target.closest('a,button'))return;const r=stage.getBoundingClientRect();go(e.clientX-r.left<r.width*0.3?-1:1);});
let tx=null;stage.addEventListener('touchstart',e=>{tx=e.touches[0].clientX;},{passive:true});stage.addEventListener('touchend',e=>{if(tx===null)return;const dx=e.changedTouches[0].clientX-tx;if(Math.abs(dx)>40)go(dx<0?1:-1);tx=null;});
document.getElementById('prev').onclick=()=>go(-1);document.getElementById('next').onclick=()=>go(1);document.getElementById('bn').onclick=toggleNotes;document.getElementById('bf').onclick=full;document.getElementById('bt').onclick=theme;
addEventListener('resize',fit);addEventListener('hashchange',()=>{const n=(parseInt(location.hash.slice(1),10)||1)-1;if(n!==i)show(n);});fit();show(i);
const q=new URLSearchParams(location.search);if(q.has('notes'))toggleNotes();if(q.has('print')){const h=document.getElementById('printHelp');h.hidden=false;setTimeout(()=>{print();h.hidden=true;},600);}})();`;

/** The whole deck as one HTML file. */
export function renderDeckHtml(m: DeckModel): string {
  const starts: number[] = [];
  let at = 0;
  for (const s of m.slides) { starts.push(Math.round(at * 100) / 100); at += s.minutes; }
  const total = Math.round(at * 100) / 100;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="generator" content="Creators' Café operator app">
<title>${esc(m.title || m.ideaTitle)} · Roadshow</title>
<style>${CSS(m)}</style>
</head>
<body>
<div class="print-help" id="printHelp" hidden>In the print window, choose <b>Save as PDF</b> as the printer (Destination), then Save.</div>
<main class="stage" id="stage" aria-label="Slides (${mmss(total)} in all)">
<div class="frame" id="frame">
${m.slides.map((s, i) => slideHtml(s, i, m, starts)).join('\n')}
</div>
</main>
<div class="progress" aria-hidden="true"><i></i></div>
<aside class="notes" id="notes" aria-label="Speaker notes" hidden></aside>
<nav class="deckbar" aria-label="Deck">
<button id="prev" aria-label="Previous slide">←</button><span class="count" id="count">1 / ${m.slides.length}</span><button id="next" aria-label="Next slide">→</button>
<span class="grow"></span><span class="hint">←/→ or click to move · S notes · F full screen · T light/dark · ${esc(mmss(total))} in all</span>
<button id="bn">Notes (S)</button><button id="bf">Full screen (F)</button><button id="bt" aria-label="Light or dark">◐</button>
</nav>
<div class="sr" id="live" aria-live="polite"></div>
<script>${SCRIPT.replace('${TOTAL}', String(total))}</script>
</body>
</html>
`;
}
