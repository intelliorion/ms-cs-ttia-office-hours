import { useEffect, useRef, useState } from 'react';
import { post, roadshowUpload } from '../api';
import { NO_AI_TIP } from '../popouts/aiUi';
import { AI_WAIT } from './designHelpers';
import { TodoList } from './ReviewSelect';
import { openedText } from './outlook';
import { isOpenNeed, awaitsReevaluation } from '../../../src/review/needs';
import type { DesignCall } from './DesignSection';
import {
  deckFileUrl, mmss, PHOTO_HINT, PHOTO_PLACEHOLDER, roadshowNote, roadshowUrl, SLIDE_KIND, staleText, type RoadshowViewLike,
} from './roadshowHelpers';

/** Opens one of the deck's files in a new tab (the deck to present, the script, the print window for the PDF). */
const openTab = (url: string) => { window.open(url, '_blank', 'noopener'); };

/**
 * The deck's files, wherever the deck is shown (the Roadshow section, the design pack): Present opens deck.html in a new
 * tab (F for full screen there, S for the notes), the script and run of show open as text, Export PowerPoint downloads
 * deck.pptx, Export PDF opens the print window (choose Save as PDF).
 */
export function DeckLinks({ id, children }: { id: string; children?: React.ReactNode }) {
  return (
    <div className="rsh-out" data-testid="deck-links">
      <button className="btn primary" data-action="deck-present" title="Opens the deck in a new tab: press F for full screen, S for your notes" onClick={() => openTab(deckFileUrl(id, 'deck.html'))}>▶ Present</button>
      <button className="btn" data-action="deck-script" onClick={() => openTab(deckFileUrl(id, 'script.md'))}>Open script</button>
      <button className="btn" data-action="deck-run-of-show" onClick={() => openTab(deckFileUrl(id, 'run-of-show.md'))}>Run of show</button>
      <a className="btn" data-action="deck-pptx" href={deckFileUrl(id, 'deck.pptx', { download: true })} download>Export PowerPoint</a>
      <button className="btn" data-action="deck-pdf" title="Opens the print window: choose Save as PDF" onClick={() => openTab(deckFileUrl(id, 'deck.html', { print: true }))}>Export PDF</button>
      {children}
    </div>
  );
}

function PersonRow({ id, p, off, call }: { id: string; p: NonNullable<RoadshowViewLike['people']>[number]; off: boolean; call: DesignCall }) {
  const [path, setPath] = useState('');
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { setPath(''); }, [p.photo?.url]);
  const use = async () => {
    const r = await call(() => post(roadshowUrl(id, 'photo'), { person: p.key, path }), { ok: () => `Photo saved for ${p.name}: copied into the idea folder.` });
    if (r) setPath('');
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    await call(() => roadshowUpload(id, p.key, f), { ok: () => `Photo saved for ${p.name}: copied into the idea folder.` });
    if (file.current) file.current.value = '';
  };
  return (
    <li className="rsh-person" data-person={p.key}>
      {p.photo ? <img className="rsh-ph" src={p.photo.url} alt={`${p.name}'s photo`} /> : <span className="rsh-ph ini" aria-hidden="true">{p.initials}</span>}
      <div className="rsh-body">
        <div className="rsh-who"><b>{p.name}</b><span className="sec-n">{p.roles}</span></div>
        <div className="rsh-path">
          <input type="text" value={path} disabled={off} placeholder={p.photo ? 'A new path replaces the photo' : PHOTO_PLACEHOLDER}
            aria-label={`Photo path for ${p.name}`} onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && path.trim()) void use(); }} />
          <button className="btn sm" data-action="photo-use" disabled={off || !path.trim()} onClick={() => void use()}>Use</button>
          <label className={`btn sm${off ? ' disabled' : ''}`} title="Or choose the picture">
            Choose…<input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden disabled={off} data-action="photo-file"
              aria-label={`Choose a photo for ${p.name}`} onChange={(e) => void upload(e.target.files?.[0])} />
          </label>
          {p.photo && <button className="link-btn" data-action="photo-remove" disabled={off}
            onClick={() => void call(() => post(roadshowUrl(id, 'photo/remove'), { person: p.key }), { ok: () => `Photo taken off for ${p.name}: the team slide shows the initials.` })}>Remove</button>}
        </div>
      </div>
    </li>
  );
}

/**
 * Launch and Learn: the roadshow. 1. Photos: a picture path (or file) for each person, for the team slide; optional.
 * 2. What the story needs: the AI lists what the deck still needs from the team (headaches, lessons, the demo, the one
 * question), with Draft email and Re-evaluate, as the decision and the tool picker do; a pasted answer is saved on the
 * idea at once. 3. The deck: Build the deck (AI) writes the slides and the script; the app draws deck.html, script.md,
 * run-of-show.md and deck.pptx; Present, the script, PowerPoint and PDF from there. Out of date when the record or the
 * photos change after a build.
 */
export function RoadshowSection({ idea, view, busy, aiWorking, noAi, aiName, call }: {
  idea: any; view: RoadshowViewLike | null; busy: boolean; aiWorking: boolean; noAi: boolean; aiName: (p?: string) => string; call: DesignCall;
}) {
  const id = idea.id;
  const off = busy || aiWorking;
  const answers: any[] = idea.answers ?? [];
  const prep = view?.prep;
  const needs: any[] = prep?.needs ?? [];
  const open = needs.filter((n) => isOpenNeed(n, answers));
  const answered = needs.filter((n) => awaitsReevaluation(n, answers));
  const deck = view?.deck;
  const stale = staleText(view);
  const people = view?.people ?? [];

  const suggest = () => void call(() => post(roadshowUrl(id, 'suggest')), {
    ai: 'roadshow',
    ok: (r: any) => {
      const left = (r.prep?.needs ?? []).filter((n: any) => !n.met).length;
      return `${prep ? 'Re-evaluated' : 'Suggested'} by ${aiName(r.prep?.provider)}: ${left ? `${left} thing${left > 1 ? 's' : ''} to ask the team` : 'the story has what it needs; build the deck'}.`;
    },
  });
  const answer = async (need: string, text: string) => {
    await call(() => post(roadshowUrl(id, 'prep/answer'), { need, answer: text }), { ok: () => (text.trim() ? 'Answer saved on the idea.' : undefined) });
  };
  const build = () => void call(() => post(roadshowUrl(id, 'build')), {
    ai: 'roadshow',
    ok: (r: any) => `Deck ${deck ? 'rebuilt' : 'built'} by ${aiName(r.deck?.provider)}: ${r.deck?.slides?.length ?? 0} slides, about ${mmss(r.deck?.minutes ?? 0)}. Present it, or open the script.`,
  });
  const render = () => void call(() => post(roadshowUrl(id, 'render')), { ok: () => 'Files drawn again with the photos and the record as they are now.' });

  return (
    <section className="sec" data-testid="roadshow">
      <h3>Roadshow <span className="sec-n">{roadshowNote(view)}</span></h3>
      {!view ? <div className="hint">Loading…</div> : (
        <>
          <div className="tp-step" data-testid="rsh-photos">
            <div className="tp-step-h"><span className="tp-step-n">1</span>Photos <span className="sec-n">for the team slide; optional</span></div>
            {people.length === 0 ? <div className="hint">No one is named on this idea yet.</div> : (
              <ul className="rsh-people" aria-label="People on the idea">
                {people.map((p) => <PersonRow key={p.key} id={id} p={p} off={off} call={call} />)}
              </ul>
            )}
            <div className="hint">{PHOTO_HINT} No photo: the slide shows the initials. Photos never go to the AI.</div>
          </div>

          <div className="tp-step" data-testid="rsh-todo">
            <div className="tp-step-h"><span className="tp-step-n">2</span>What the story needs <span className="sec-n">the headaches, lessons, the demo, the one question</span></div>
            {!prep && <div className="hint lead">Let the AI read everything the idea holds and list what the deck still needs from the team. Only what the record does not hold is asked.</div>}
            {prep && (
              <>
                <TodoList needs={needs} answers={answers} disabled={off} onAnswer={answer} none="The record holds what the story needs." />
                <div className="rs-by">By {aiName(prep.provider)} on {prep.at}. Answers you paste are saved on the idea at once.</div>
              </>
            )}
            <div className="ai-row rs-acts">
              {!prep ? (
                <button className="btn" data-action="roadshow-suggest" disabled={noAi || off} title={noAi ? NO_AI_TIP : undefined} onClick={suggest}>
                  {aiWorking ? 'Working…' : 'Suggest'}</button>
              ) : (
                <>
                  <button className="btn" data-action="roadshow-draft-questions" disabled={off || !open.length}
                    title={open.length ? 'The open questions as one email, opened in Outlook' : 'Nothing open to ask'}
                    onClick={() => void call(() => post(roadshowUrl(id, 'prep/email')), { ok: (o: any) => openedText(o.email.template) })}>✉ Draft email</button>
                  <button className={`btn${answered.length ? ' primary' : ''}`} data-action="roadshow-reevaluate" disabled={noAi || off}
                    title={noAi ? NO_AI_TIP : 'Read everything again, with the answers'} onClick={suggest}>{aiWorking ? 'Working…' : 'Re-evaluate'}</button>
                </>
              )}
            </div>
            {prep && !open.length && answered.length > 0 && <div className="hint">Answers are in: Re-evaluate to check them.</div>}
          </div>

          <div className="tp-step" data-testid="rsh-deck">
            <div className="tp-step-h"><span className="tp-step-n">3</span>The deck <span className="sec-n">slides and the script to talk; HTML, PowerPoint and PDF</span></div>
            {!deck && <div className="hint lead">The AI writes about ten minutes of slides and what to say on each, from the whole record; the app draws them, with the team's photos, the design diagram and the tool's fit.</div>}
            {stale && (
              <div className="hint warn" data-testid="deck-stale">{stale.text}{' '}
                {stale.fix === 'render'
                  ? <button className="link-btn" data-action="deck-render" disabled={off} onClick={render}>Update the files</button>
                  : <button className="link-btn" data-action="deck-rebuild" disabled={noAi || off} title={noAi ? NO_AI_TIP : undefined} onClick={build}>Rebuild</button>}
              </div>
            )}
            <div className="ai-row rs-acts">
              <button className={`btn${deck ? '' : ' primary'}`} data-action="deck-build" disabled={noAi || off} title={noAi ? NO_AI_TIP : 'The AI writes the slides and the script from everything the idea holds'} onClick={build}>
                {aiWorking ? 'Working…' : deck ? 'Rebuild the deck' : 'Build the deck'}</button>
              {aiWorking && <span className="ai-busy" role="status">{AI_WAIT}</span>}
            </div>
            {deck && (
              <>
                <ol className="rsh-slides" aria-label="Slides" data-testid="deck-slides">
                  {deck.slides.map((s, i) => (
                    <li key={i} data-kind={s.kind}><span className="rsh-k">{SLIDE_KIND[s.kind] ?? s.kind}</span><span className="rsh-t">{s.title}</span><span className="rsh-m">{mmss(s.minutes)}</span></li>
                  ))}
                </ol>
                <div className="rs-by">Written by {aiName(deck.provider)} on {deck.at}{deck.renderedAt !== deck.at ? `, files drawn ${deck.renderedAt}` : ''}. In the idea folder's roadshow/.</div>
                <DeckLinks id={id}>
                  <button className="btn" data-action="open-idea-folder"
                    onClick={() => void call(() => post(`/api/ideas/${encodeURIComponent(id)}/open-folder`), { ok: (r: any) => `Opened ${r.folder}.` })}>Open the folder</button>
                </DeckLinks>
                {deck.template && <div className="hint" data-testid="deck-template">{deck.template.note}</div>}
                {deck.warnings.length > 0 && (
                  <details className="tp-ctx" data-testid="deck-warnings">
                    <summary>What the app changed in the AI's slides ({deck.warnings.length})</summary>
                    <ul>{deck.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </details>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** After Launch and Learn (or once closed): the deck, read-only, with its files. */
export function RoadshowCard({ id, view }: { id: string; view: RoadshowViewLike | null }) {
  const deck = view?.deck;
  return (
    <section className="sec sec-card" data-testid="roadshow-card">
      <h3>Roadshow <span className="sec-n">{roadshowNote(view)}</span></h3>
      {deck ? <><div className="card-main">{deck.title}</div><DeckLinks id={id} /></> : <div className="hint">No deck was built.</div>}
    </section>
  );
}
