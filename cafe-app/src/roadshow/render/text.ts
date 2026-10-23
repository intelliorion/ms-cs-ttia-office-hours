/**
 * script.md (the whole talk track, slide by slide, with timings and cues) and run-of-show.md (who does what, when: the
 * demo cue, the one question, the four feedback questions). Plain Markdown drawn from the deck model.
 */
import { formatDate } from '../../clock';
import { mdLine } from '../../design/store';
import type { DeckModel } from '../deck';
import { KIND_LABEL } from './html';

/** The four questions the room is asked after the demo (s4c), the ones the feedback email (E11) reports. */
export const FEEDBACK_QUESTIONS = [
  'Who else has this same problem? (teams, desks or functions)',
  'What would stop you using it tomorrow?',
  'What would you ask for next? (asked for, not promised)',
  'Any concerns about the data it uses?',
] as const;

const mmss = (min: number) => { const s = Math.round(min * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const dateText = (iso?: string) => { if (!iso) return ''; try { return formatDate(iso.slice(0, 10)); } catch { return iso; } };
/** A paragraph of the script, one line, with its cues in bold. */
const para = (p: string) => mdLine(p).replace(/\[([^\]\n]{1,80})\]/g, '**[$1]**');

function starts(m: DeckModel): number[] {
  const out: number[] = [];
  let at = 0;
  for (const s of m.slides) { out.push(at); at += s.minutes; }
  return out;
}
const totalOf = (m: DeckModel) => m.slides.reduce((t, s) => t + s.minutes, 0);

export function renderScriptMd(m: DeckModel): string {
  const at = starts(m);
  const out = [
    `# Roadshow script — ${mdLine(m.title || m.ideaTitle)}`, '',
    `${m.id} · Creators' Café · Launch and Learn${m.roundName ? ` · ${mdLine(m.roundName)}` : ''}${m.roadshowDate ? ` · ${dateText(m.roadshowDate)}` : ''}`, '',
    `About ${mmss(totalOf(m))} in all, ${m.slides.length} slides. Presented by ${m.presenters.length ? m.presenters.map(mdLine).join(' and ') : 'the team'}.`,
    'Read it aloud once before the day; the words are a guide, not a script to read from the slide. Cues in **[brackets]** are actions.', '',
  ];
  m.slides.forEach((s, i) => {
    const label = KIND_LABEL[s.kind];
    out.push(`## ${i + 1}. ${mdLine(s.title)}`, '', `*${label ? `${label} · ` : ''}${mmss(at[i])}–${mmss(at[i] + s.minutes)} (about ${mmss(s.minutes)})*`, '');
    if (s.points.length) out.push('On the slide:', '', ...s.points.map((p) => `- ${mdLine(p)}`), '');
    if (s.kind === 'demo') out.push(`**[Switch to the demo${m.demoLink ? `: ${mdLine(m.demoLink)}` : ''}]**`, '');
    out.push(...s.notes.split(/\n{2,}/).map(para).filter(Boolean).flatMap((p) => [p, '']));
    if (s.kind === 'demo') out.push('**[Back to the slides]**', '');
    // The next slide's cue, unless the script already ends on one of its own.
    if (i < m.slides.length - 1 && !/\]\s*$/.test(s.notes)) out.push(`**[Click: ${mdLine(m.slides[i + 1].title)}]**`, '');
  });
  out.push('## After the talk', '', 'Ask the room the four feedback questions (see run-of-show.md) and write the answers down: they go in the feedback email (E11).', '');
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

export function renderRunOfShowMd(m: DeckModel): string {
  const at = starts(m);
  const total = totalOf(m);
  const lead = m.presenters[0] ?? 'The lead';
  const builder = m.builder ?? lead;
  const demo = m.slides.findIndex((s) => s.kind === 'demo');
  const question = m.slides.find((s) => s.kind === 'question');
  const who = (k: string) => (k === 'demo' ? builder : lead);
  const out = [
    `# Run of show — ${mdLine(m.title || m.ideaTitle)}`, '',
    `${m.id}${m.roundName ? ` · ${mdLine(m.roundName)}` : ''}${m.roadshowDate ? ` · ${dateText(m.roadshowDate)}` : ''} · about ${mmss(total)} of talk, then the room's questions.`, '',
    '## Before', '',
    `- Open deck.html in the browser on the presenting laptop; press F for full screen and S for the speaker notes on a second screen.`,
    `- ${demo >= 0 ? `Have the demo open in another window${m.demoLink ? ` (${mdLine(m.demoLink)})` : ''}, on the sample data only.` : 'There is no demo slide: show the result on the sample data if there is time.'}`,
    '- Someone from TTIA keeps time and writes down the answers to the four feedback questions.',
    '- Check nothing on screen shows personal, client or third-party data.', '',
    '## Who does what, when', '',
    '| Time | Slide | Who | What |', '| --- | --- | --- | --- |',
    ...m.slides.map((s, i) => `| ${mmss(at[i])} | ${i + 1}. ${mdLine(s.title).replace(/\|/g, '\\|')} | ${mdLine(who(s.kind)).replace(/\|/g, '\\|')} | ${s.kind === 'demo' ? '**Demo cue:** switch to the demo' : s.kind === 'question' ? '**The one question** to the room' : KIND_LABEL[s.kind] || (s.kind === 'title' ? 'Welcome' : 'Close')} (${mmss(s.minutes)}) |`),
    `| ${mmss(total)} | — | TTIA | The four feedback questions (about 5 minutes) |`, '',
  ];
  if (demo >= 0) out.push('## The demo cue', '', `At about ${mmss(at[demo])}, on slide ${demo + 1}, ${mdLine(builder)} switches to the demo${m.demoLink ? ` (${mdLine(m.demoLink)})` : ''} and walks through it on the sample data, then comes back to the slides.`, '');
  if (question) out.push('## The one question', '', `"${mdLine(question.title)}"`, '', 'Let the room answer before the feedback questions; write down what they say.', '');
  out.push('## The four feedback questions', '', 'Asked by TTIA after the talk (step "Demo given, and the room asked the four feedback questions"). Write the answers down for the feedback email (E11).', '',
    ...FEEDBACK_QUESTIONS.map((q, i) => `${i + 1}. ${q}`), '',
    '## After', '', '- Ask the team for the slides and the demo link if they changed them, and for the reuse write-up.', '- Send the feedback and decision email (E11) from the idea\'s ✉ Emails menu.', '');
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
