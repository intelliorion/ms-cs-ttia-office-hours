/** The design pack's words: what each file is, and how to use it. A leaf module, so it can be tested on its own. */
import { BASE_TAGS, BUILD_HINTS, BUILD_TAGS, NOT_ANSWERED, pointOf, POINT_LABELS, type DesignTag } from '../../../src/design/points';

const KIT_FILES: Record<string, string> = {
  'README.md': 'Start here: what the starter kit holds and the order to use it in.',
  'topics.md': 'The topics the Copilot Studio agent answers, to build one by one.',
  'screens.md': 'The Power Apps screens to make, and what each shows.',
  'flow.md': 'The steps of the Power Automate flow.',
  'process.md': 'The UiPath process, step by step.',
  'prompts.md': 'Prompts to try in Microsoft Copilot on the sample data.',
};

/** What a file in the pack is and how to use it, by its path in the idea folder. */
export function fileNote(path: string): { title: string; use: string } {
  if (path === 'design.md') return { title: 'The design', use: 'The proof of concept on one page: what it shows, with what input, for whom, built by whom, and how to build it. Share it with the team before the first session.' };
  if (path === 'approach.md') return { title: 'The tool and why', use: 'The tool picked, with its pros and cons and the facts it rests on. The builder starts here.' };
  if (path === 'plan.md') return { title: 'The build plan', use: 'The build tasks in order, each with its tool and when it is done, plus the risks. Work through it in the design sessions.' };
  if (path === 'roadshow/script.md') return { title: 'The roadshow script', use: 'What to say on each slide of the roadshow deck, with timings and cues. Read it aloud once before the day.' };
  if (path === 'roadshow/run-of-show.md') return { title: 'The roadshow run of show', use: 'Who does what, when: the demo cue, the one question for the room and the four feedback questions.' };
  const m = /^kit\/([^/]+)\/(.+)$/.exec(path);
  if (m) {
    const tool = m[1].replace(/-/g, ' ');
    return { title: `Starter kit: ${tool} · ${m[2]}`, use: KIT_FILES[m[2]] ?? 'A template from the starter kit: copy it and fill it in. No code is written for you.' };
  }
  return { title: path, use: '' };
}

/** The design questions the summary rests on, by what they settle. */
export const SETTLES: [DesignTag, string][] = BASE_TAGS.map((t) => [t, POINT_LABELS[t]]);
/** The build points, each its own row in the pack. */
export const BUILD_POINTS: [DesignTag, string][] = BUILD_TAGS.map((t) => [t, POINT_LABELS[t]]);

/** One row of the pack's points: what settles it (the tagged answer, or what the done reply said), or "(not yet answered)". */
export interface PointRow { tag: DesignTag; label: string; text: string; open: boolean; hint?: string }
export function pointRows(state: { steps?: any[]; settled?: Record<string, string> } | null | undefined, which: 'base' | 'build'): PointRow[] {
  const src = { steps: state?.steps ?? [], settled: state?.settled };
  return (which === 'base' ? SETTLES : BUILD_POINTS).map(([tag, label]) => {
    const text = pointOf(src, tag);
    return { tag, label, text: text ?? NOT_ANSWERED, open: !text, ...(which === 'build' ? { hint: BUILD_HINTS[tag as keyof typeof BUILD_HINTS] } : {}) };
  });
}

/** The roadshow's files the pack can show (the deck itself opens with Present). */
export const ROADSHOW_PACK_FILES = ['roadshow/script.md', 'roadshow/run-of-show.md'];

/** The pack's files in reading order: the design, the tool, the plan, then the kit. */
export function packFiles(planFiles: string[], hasApproach: boolean): string[] {
  const kit = planFiles.filter((f) => f.startsWith('kit/')).sort((a, b) => (a.endsWith('/README.md') ? -1 : b.endsWith('/README.md') ? 1 : a.localeCompare(b)));
  return ['design.md', ...(hasApproach ? ['approach.md'] : []), ...(planFiles.includes('plan.md') ? ['plan.md'] : []), ...kit];
}
