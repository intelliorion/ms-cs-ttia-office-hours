/**
 * deck.pptx: the same slides as deck.html, drawn with pptxgenjs (16:9), with the photos embedded, the design diagram
 * drawn as PowerPoint shapes (so it stays editable), the fit table as a table, and each slide's script as its speaker
 * notes. A WebP photo is shown in the HTML deck only (PowerPoint gets the initials), since not every PowerPoint opens WebP.
 */
import PptxGenJS from 'pptxgenjs';
import { deckFit, layout, wrap } from '../../design/diagramLayout';
import type { DiagramSpec, NodeKind } from '../../design/diagram';
import { formatDate } from '../../clock';
import type { DeckSlide } from '../../ai/tasks';
import type { DeckModel, DeckPerson, FitMark } from '../deck';
import { DECK_TEXT, KIND_LABEL } from './html';

type Slide = ReturnType<PptxGenJS['addSlide']>;

const W = 13.333;
const H = 7.5;
const X0 = 1.0;
const CW = W - X0 - 0.75;
const hex = (c: string) => c.replace('#', '').slice(0, 6).toUpperCase();
const MUTED = '5B6475';
const LINE = 'DDE3EC';
const SOFT = 'F3F6FA';
const KIND_COLOUR: Record<NodeKind, string> = { input: '2563EB', store: '7C3AED', step: '', output: '059669', person: 'D97706', gap: 'DC2626' };
const FIT_COLOUR: Record<FitMark, string> = { yes: '059669', partly: 'D97706', no: 'DC2626', out: '64748B', outside: '64748B' };
const FIT_WORD: Record<FitMark, string> = { yes: '✓ Yes', partly: '½ Partly', no: '✗ No', out: '– Out of scope', outside: '↗ Outside the build' };
const dateText = (iso?: string) => { if (!iso) return ''; try { return formatDate(iso.slice(0, 10)); } catch { return iso; } };
/** The first family of a CSS font stack. */
const family = (stack: string) => stack.split(',')[0].replace(/["']/g, '').trim() || 'Segoe UI';
/** The script for the notes pane: plain paragraphs, the cues kept. */
const notesText = (s: DeckSlide) => `${s.notes}\n\n(about ${Math.round(s.minutes * 60)} seconds)`;

export function photoData(p: DeckPerson): string | undefined {
  if (!p.photo || p.photo.kind === 'webp') return undefined;
  return `${p.photo.mime};base64,${p.photo.base64}`;
}

function avatar(pptx: PptxGenJS, slide: Slide, p: DeckPerson, x: number, y: number, d: number, accent: string, font: string) {
  const data = photoData(p);
  if (data) {
    // Cropped to a circle: w and h carry the picture's own shape, the square box (sizing) crops it to cover.
    const ratio = p.photo?.w && p.photo?.h ? p.photo.w / p.photo.h : 1;
    const [iw, ih] = ratio >= 1 ? [d * ratio, d] : [d, d / ratio];
    slide.addImage({ data, x, y, w: iw, h: ih, rounding: true, sizing: { type: 'cover', w: d, h: d }, altText: p.name });
    slide.addShape(pptx.ShapeType.ellipse, { x, y, w: d, h: d, line: { color: accent, width: 2.5 }, fill: { type: 'none' } } as never);
    return;
  }
  slide.addText(p.initials, {
    shape: pptx.ShapeType.ellipse, x, y, w: d, h: d, fill: { color: accent }, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle',
    fontFace: font, fontSize: Math.round(d * 22),
  });
}

/**
 * The design diagram as shapes in `box`. `big` is the full-slide drawing, as deck.html draws it: the deckFit shape,
 * larger text, each part's kind shown by its colour bar only.
 */
function diagramShapes(pptx: PptxGenJS, slide: Slide, spec: DiagramSpec, box: { x: number; y: number; w: number; h: number }, accent: string, font: string, big = false) {
  const fit = big ? deckFit(spec, box.w, box.h) : undefined;
  const L = fit ? fit.layout : layout(spec);
  const k = Math.min(box.w / L.width, box.h / L.height);
  const ox = box.x + (box.w - L.width * k) / 2;
  const oy = box.y + (box.h - L.height * k) / 2;
  const X = (px: number) => ox + px * k;
  const Y = (px: number) => oy + px * k;
  const pt = (px: number) => Math.max(6, Math.round(px * k * 72));
  L.lanes.forEach((l, i) => {
    slide.addShape(pptx.ShapeType.roundRect, { x: X(6), y: Y(l.y), w: (L.width - 12) * k, h: l.h * k, fill: { color: i % 2 ? 'EEF1F6' : 'F5F7FA' }, line: { color: LINE, width: 0.75 }, rectRadius: 0.08 });
    slide.addText(l.label, { x: X(12), y: Y(l.y + 6), w: (fit ? fit.size.labelW - 24 : 112) * k, h: Math.min(l.h, big ? 90 : 60) * k, fontSize: pt(big ? DECK_TEXT.lane : 13), bold: true, color: accent, fontFace: font, valign: 'top', margin: 2 });
  });
  for (const e of L.edges) {
    const m = /^M([\d.-]+),([\d.-]+) C[\d.,\s-]+ ([\d.-]+),([\d.-]+)$/.exec(e.d);
    if (!m) continue;
    const [x1, y1, x2, y2] = m.slice(1).map(Number);
    slide.addShape(pptx.ShapeType.line, {
      x: X(Math.min(x1, x2)), y: Y(Math.min(y1, y2)), w: Math.max(0.01, Math.abs(x2 - x1) * k), h: Math.max(0.01, Math.abs(y2 - y1) * k),
      flipH: x2 < x1, flipV: y2 < y1, line: { color: '8A94A6', width: 1.25, endArrowType: 'triangle', ...(e.back ? { dashType: 'dash' } : {}) },
    } as never);
    const ew = big ? 140 : 100; const eh = big ? 24 : 18;
    if (e.label) slide.addText(e.label, { x: X(e.lx - ew / 2), y: Y(e.ly - eh / 2), w: ew * k, h: eh * k, fontSize: pt(big ? DECK_TEXT.edge : 11), color: MUTED, align: 'center', fontFace: font, fill: { color: 'FFFFFF' }, margin: 0 });
  }
  for (const n of L.nodes) {
    const c = KIND_COLOUR[n.kind] || hex(accent);
    slide.addShape(pptx.ShapeType.roundRect, { x: X(n.x), y: Y(n.y), w: n.w * k, h: n.h * k, fill: { color: 'FFFFFF' }, line: { color: c, width: 1.25 }, rectRadius: 0.06 });
    slide.addShape(pptx.ShapeType.rect, { x: X(n.x), y: Y(n.y + 10), w: 5 * k, h: (n.h - 20) * k, fill: { color: c }, line: { color: c, width: 0 } });
    if (fit) {
      slide.addText(wrap(n.label, fit.chars, fit.lines).join(' '), {
        x: X(n.x + 12), y: Y(n.y + 2), w: (n.w - 16) * k, h: (n.h - 4) * k, valign: 'middle', fontFace: font, margin: 2, fontSize: pt(DECK_TEXT.node), bold: true, color: '0F172A',
      });
      continue;
    }
    slide.addText([
      { text: n.kind.toUpperCase(), options: { fontSize: pt(10), bold: true, color: MUTED, breakLine: true } },
      { text: wrap(n.label, 22, 2).join(' '), options: { fontSize: pt(13.5), bold: true, color: '0F172A' } },
    ], { x: X(n.x + 12), y: Y(n.y + 4), w: (n.w - 18) * k, h: (n.h - 8) * k, valign: 'top', fontFace: font, margin: 2 });
  }
}

/** Draws deck.pptx from the model. */
export async function renderDeckPptx(m: DeckModel): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = m.title || m.ideaTitle;
  pptx.subject = `${m.id} · Creators' Café roadshow`;
  pptx.company = "Creators' Café";
  const accent = hex(m.theme.accent);
  const accent2 = hex(m.theme.accent2);
  const ink = hex(m.theme.ink);
  const head = family(m.theme.headFont);
  const body = family(m.theme.bodyFont);
  const n = m.slides.length;

  const bullets = (slide: Slide, points: string[], box: { x: number; y: number; w: number; h: number }, size = 22, ordered = false) => {
    if (!points.length) return;
    slide.addText(points.map((p) => ({ text: p, options: { bullet: ordered ? { type: 'number' as const } : { indent: 20 }, paraSpaceAfter: 10 } })), {
      ...box, fontSize: points.length > 4 ? size - 3 : size, color: ink, fontFace: body, valign: 'top', margin: 4,
    });
  };

  m.slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    slide.addNotes(notesText(s));
    if (s.kind === 'title' || s.kind === 'thanks') {
      slide.background = { color: accent };
      slide.addShape(pptx.ShapeType.rect, { x: W - 4.2, y: 0, w: 4.2, h: H, fill: { color: accent2, transparency: 75 }, line: { color: accent2, width: 0 } });
      const meta = [m.id, "Creators' Café · Launch and Learn", m.roundName, m.roadshowDate ? dateText(m.roadshowDate) : ''].filter(Boolean).join(' · ');
      slide.addText(meta.toUpperCase(), { x: 1.1, y: 1.2, w: 10.5, h: 0.5, fontSize: 14, bold: true, color: 'FFFFFF', fontFace: head, charSpacing: 2 });
      const big = s.kind === 'title' ? (m.title || s.title) : s.title;
      // A long title gets a smaller size, so it never runs into the subtitle (about 22 characters a line at 48 pt).
      const size = big.length > 60 ? 34 : big.length > 38 ? 40 : 48;
      slide.addText(big, { x: 1.1, y: 1.75, w: 10.5, h: 2.5, fontSize: size, bold: true, color: 'FFFFFF', fontFace: head, valign: 'top', margin: 0 });
      if (s.kind === 'title' && m.subtitle) slide.addText(m.subtitle, { x: 1.1, y: 4.35, w: 10, h: 1.0, fontSize: 20, color: 'FFFFFF', fontFace: body, valign: 'top', margin: 0 });
      if (s.kind === 'thanks') bullets(slide, s.points, { x: 1.1, y: 4.35, w: 10, h: 2.2 }, 22);
      if (s.kind === 'title') {
        m.team.filter((p) => m.presenters.includes(p.name)).forEach((p, k) => {
          avatar(pptx, slide, p, 1.1 + k * 3.4, 5.7, 0.62, accent2, head);
          slide.addText(p.name, { x: 1.85 + k * 3.4, y: 5.7, w: 2.6, h: 0.62, fontSize: 16, bold: true, color: 'FFFFFF', fontFace: head, valign: 'middle' });
        });
      }
      return;
    }
    slide.background = { color: 'FFFFFF' };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.13, h: H, fill: { color: accent }, line: { color: accent, width: 0 } });
    const label = KIND_LABEL[s.kind];
    if (label) slide.addText(label.toUpperCase(), { x: X0, y: 0.5, w: CW, h: 0.35, fontSize: 12, bold: true, color: accent, fontFace: head, charSpacing: 2, margin: 0 });
    slide.addText(`${m.ideaTitle} · Creators' Café`, { x: X0, y: H - 0.5, w: 8, h: 0.3, fontSize: 10, color: MUTED, fontFace: body, margin: 0 });
    slide.addText(`${i + 1} / ${n}`, { x: W - 2.0, y: H - 0.5, w: 1.3, h: 0.3, fontSize: 10, color: MUTED, align: 'right', fontFace: body, margin: 0 });
    if (s.kind === 'question') {
      slide.addText(`? ${s.title}`, { x: X0, y: 1.6, w: CW, h: 3.4, fontSize: 40, bold: true, color: ink, fontFace: head, valign: 'middle' });
      bullets(slide, s.points, { x: X0, y: 5.1, w: CW, h: 1.5 }, 18);
      return;
    }
    // The design diagram is drawn full bleed: a smaller title, then the diagram fills the slide under it.
    if (s.visual === 'diagram' && m.diagram) {
      slide.addText(s.title, { x: X0, y: 0.8, w: W - X0 - 0.4, h: 0.6, fontSize: 24, bold: true, color: ink, fontFace: head, valign: 'top', margin: 0, fit: 'shrink' });
      diagramShapes(pptx, slide, m.diagram, { x: 0.35, y: 1.5, w: W - 0.6, h: H - 1.5 - 0.6 }, accent, body, true);
      return;
    }
    slide.addText(s.title, { x: X0, y: 0.85, w: CW, h: 1.0, fontSize: 32, bold: true, color: ink, fontFace: head, valign: 'top', margin: 0 });
    const area = { x: X0, y: 2.0, w: CW, h: 4.6 };
    const quote = (box: { x: number; y: number; w: number; h: number }) => {
      if (s.quote) slide.addText(s.quote, { ...box, fontSize: 18, italic: true, color: MUTED, fontFace: body, valign: 'top' });
    };
    if (s.kind === 'demo') {
      slide.addText([
        { text: '▶  Live demo', options: { fontSize: 30, bold: true, breakLine: true } },
        { text: m.demoLink ?? 'On sample data', options: { fontSize: 14 } },
      ], { shape: pptx.ShapeType.roundRect, x: X0, y: 2.1, w: 5.4, h: 3.6, fill: { color: accent }, color: 'FFFFFF', align: 'center', valign: 'middle', fontFace: head, rectRadius: 0.2 } as never);
      bullets(slide, s.points, { x: X0 + 5.9, y: 2.1, w: CW - 5.9, h: 3.8 }, 20, true);
      quote({ x: X0 + 5.9, y: 5.9, w: CW - 5.9, h: 0.8 });
      return;
    }
    switch (s.visual) {
      case 'team': {
        const people = m.team.slice(0, 10);
        const per = Math.min(5, people.length || 1);
        const rows = Math.ceil(people.length / per);
        const d = rows > 1 ? 1.1 : people.length <= 3 ? 1.7 : 1.35;
        const cell = CW / per;
        people.forEach((p, k) => {
          const r = Math.floor(k / per); const c = k % per;
          const inRow = Math.min(per, people.length - r * per);
          const x = X0 + (CW - inRow * cell) / 2 + c * cell;
          const y = 2.0 + r * (d + 1.15);
          avatar(pptx, slide, p, x + (cell - d) / 2, y, d, accent, head);
          slide.addText([{ text: p.name, options: { bold: true, fontSize: 16, color: ink, breakLine: true } }, { text: p.roles, options: { fontSize: 12, color: MUTED } }],
            { x, y: y + d + 0.08, w: cell, h: 0.8, align: 'center', valign: 'top', fontFace: head, margin: 0 });
        });
        bullets(slide, s.points, { x: X0, y: 6.05, w: CW, h: 0.8 }, 14);
        return;
      }
      case 'diagram': {
        // With a diagram the slide was drawn full bleed above; without one, its points.
        bullets(slide, s.points, area);
        return;
      }
      case 'fit-table': {
        if (m.fit) {
          const rows = [
            [{ text: 'Feature', options: { bold: true, color: MUTED } }, { text: 'Fit', options: { bold: true, color: MUTED } }, { text: 'Note', options: { bold: true, color: MUTED } }],
            ...m.fit.rows.slice(0, 9).map((r) => [
              { text: r.feature, options: { bold: true, color: ink } }, { text: FIT_WORD[r.mark], options: { color: FIT_COLOUR[r.mark], bold: true } }, { text: r.note, options: { color: ink } },
            ]),
          ];
          slide.addText(`${m.fit.tool}${m.fit.pathway ? `  ·  ${m.fit.pathway}` : ''}`, { x: X0, y: 1.95, w: 7.3, h: 0.4, fontSize: 16, bold: true, color: ink, fontFace: head, margin: 0 });
          slide.addTable(rows as never, { x: X0, y: 2.4, w: 7.3, colW: [2.2, 1.6, 3.5], fontSize: 11, fontFace: body, border: { type: 'solid', color: LINE, pt: 0.75 }, fill: { color: 'FFFFFF' }, valign: 'top' } as never);
        }
        bullets(slide, s.points, { x: X0 + 7.7, y: 2.0, w: CW - 7.7, h: 3.8 }, 18);
        quote({ x: X0 + 7.7, y: 5.9, w: CW - 7.7, h: 0.8 });
        return;
      }
      case 'timeline': {
        const items = m.timeline.slice(0, 8);
        if (items.length) {
          const step = CW / items.length;
          slide.addShape(pptx.ShapeType.line, { x: X0 + step / 2, y: 2.35, w: step * (items.length - 1) || 0.01, h: 0, line: { color: accent, width: 3 } });
          items.forEach((d, k) => {
            const cx = X0 + step * k + step / 2;
            slide.addShape(pptx.ShapeType.ellipse, { x: cx - 0.17, y: 2.18, w: 0.34, h: 0.34, fill: { color: k === items.length - 1 ? accent2 : 'FFFFFF' }, line: { color: k === items.length - 1 ? accent2 : accent, width: 3 } });
            slide.addText([{ text: d.what, options: { bold: true, fontSize: 14, color: ink, breakLine: true } }, { text: dateText(d.date), options: { fontSize: 11, color: MUTED } }],
              { x: cx - step / 2, y: 2.65, w: step, h: 0.8, align: 'center', valign: 'top', fontFace: head, margin: 0 });
          });
        }
        bullets(slide, s.points, { x: X0, y: 3.8, w: CW, h: 2.4 }, 18);
        quote({ x: X0, y: 6.1, w: CW, h: 0.6 });
        return;
      }
      case 'data': {
        const d = m.data;
        if (d) {
          const colW = (CW - 2.4) / 2.6;
          const card = (f: { name: string; kind: string; what: string; columns: string[] }, x: number, y: number, h: number, fill: string) => {
            slide.addShape(pptx.ShapeType.roundRect, { x, y, w: colW, h, fill: { color: fill }, line: { color: LINE, width: 0.75 }, rectRadius: 0.12 });
            slide.addText([
              { text: f.kind.toUpperCase(), options: { fontSize: 9, bold: true, color: accent, breakLine: true } },
              { text: f.name, options: { fontSize: 15, bold: true, color: ink, breakLine: true } },
              ...(f.what ? [{ text: f.what, options: { fontSize: 10, color: MUTED, breakLine: true } }] : []),
              ...(f.columns.length ? [{ text: f.columns.join(' · '), options: { fontSize: 9, color: ink, fontFace: 'Consolas' } }] : []),
            ], { x: x + 0.15, y: y + 0.08, w: colW - 0.3, h: h - 0.16, valign: 'top', fontFace: body, margin: 0, fit: 'shrink' } as never);
          };
          const ins = [...d.inputs, ...d.rules];
          const h = Math.min(1.9, 4.2 / Math.max(1, ins.length) - 0.15);
          slide.addText('WHAT GOES IN', { x: X0, y: 1.95, w: colW, h: 0.3, fontSize: 11, bold: true, color: MUTED, fontFace: head, charSpacing: 2, margin: 0 });
          ins.forEach((f, k) => card(f, X0, 2.35 + k * (h + 0.15), h, SOFT));
          const midX = X0 + colW + 0.6;
          slide.addText('→', { x: X0 + colW, y: 3.4, w: 0.6, h: 0.6, fontSize: 28, color: accent, align: 'center', bold: true });
          slide.addText([{ text: d.tool ?? 'The proof of concept', options: { fontSize: 18, bold: true, breakLine: true } }, { text: 'on sample, masked data', options: { fontSize: 11 } }],
            { shape: pptx.ShapeType.roundRect, x: midX, y: 2.9, w: colW * 0.6, h: 1.6, fill: { color: accent }, color: 'FFFFFF', align: 'center', valign: 'middle', fontFace: head, rectRadius: 0.15 } as never);
          slide.addText('→', { x: midX + colW * 0.6, y: 3.4, w: 0.6, h: 0.6, fontSize: 28, color: accent, align: 'center', bold: true });
          const outX = midX + colW * 0.6 + 0.6;
          slide.addText('WHAT COMES OUT', { x: outX, y: 1.95, w: colW, h: 0.3, fontSize: 11, bold: true, color: MUTED, fontFace: head, charSpacing: 2, margin: 0 });
          if (d.output) card(d.output, outX, 2.35, 1.9, 'EEF4FF');
        }
        if (s.points.length) slide.addText(s.points.join('   ·   '), { x: X0, y: 6.3, w: CW, h: 0.5, fontSize: 14, color: MUTED, fontFace: body });
        return;
      }
      case 'before-after': {
        const before = s.before?.length ? s.before : m.before;
        const after = s.after?.length ? s.after : m.after;
        const colW = (CW - 0.8) / 2;
        const card = (x: number, title: string, lines: string[], fill: string, colour: string) => {
          slide.addShape(pptx.ShapeType.roundRect, { x, y: 2.0, w: colW, h: 3.6, fill: { color: fill }, line: { color: LINE, width: 0.75 }, rectRadius: 0.15 });
          slide.addText(title.toUpperCase(), { x: x + 0.3, y: 2.15, w: colW - 0.6, h: 0.4, fontSize: 12, bold: true, color: colour, fontFace: head, charSpacing: 2, margin: 0 });
          bullets(slide, lines.length ? lines : ['Not written down yet.'], { x: x + 0.25, y: 2.6, w: colW - 0.5, h: 2.9 }, 16);
        };
        card(X0, 'Today', before, SOFT, MUTED);
        slide.addText('→', { x: X0 + colW, y: 3.3, w: 0.8, h: 0.8, fontSize: 32, color: accent, align: 'center', bold: true });
        card(X0 + colW + 0.8, 'With the proof of concept', after, 'EEF4FF', accent);
        if (s.points.length) slide.addText(s.points.join('   ·   '), { x: X0, y: 5.8, w: CW, h: 0.7, fontSize: 14, color: MUTED, fontFace: body });
        return;
      }
      default:
        bullets(slide, s.points, s.quote ? { ...area, h: 3.4 } : area);
        quote({ x: X0, y: 5.6, w: CW, h: 1.0 });
    }
  });
  const out = await pptx.write({ outputType: 'nodebuffer' });
  return new Uint8Array(out as Buffer);
}
