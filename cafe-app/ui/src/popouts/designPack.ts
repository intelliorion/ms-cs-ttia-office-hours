/** The design pack's words: what each file is, and how to use it. A leaf module, so it can be tested on its own. */
import { BASE_TAGS, BUILD_HINTS, BUILD_TAGS, NOT_ANSWERED, pointOf, POINT_LABELS, type DesignTag } from '../../../src/design/points';

/** What each starter-kit file is and how to use it, by its name. */
const KIT_FILES: Record<string, string> = {
  'README.md': 'Start here: what the kit holds, what it must show, the files in the order of work, who does what, and the links to the design, the approach and the plan.',
  'sample-data.csv': "The synthetic sample, made from the design's input fields, with the seeded test rows marked T1, T2 … in test_case. Build and test on it only; never swap in real data.",
  'test-checklist.md': 'Each "done when" and each feature as a tick-box test with the result to expect. Run it on the sample with the builder before the demo.',
  'prompts.md': 'The prompts to paste into Microsoft Copilot with the sample attached, each with the answer to check against.',
  'instructions.md': "The agent's instructions: paste them into the Instructions box in Copilot Studio and name the agent as it says.",
  'skills.md': 'One topic per feature: its trigger phrases, inputs, steps, the answer and the action or connector it needs. Build them one by one.',
  'knowledge.md': 'The knowledge to add to the agent (the sample first), what never to add, and test questions with their answers.',
  'data-model.md': 'The SharePoint lists (or tables) and their columns with types. Make them first, and fill the input list from the sample.',
  'screens.md': "Each screen's controls and the key Power Fx formulas, sketched. Build them once the lists are there.",
  'flows.md': 'The Power Automate flows for what the app cannot do on its own, each with its trigger and steps.',
  'flow.md': "Each Dataiku recipe's actual steps, in flow order, from uploading the sample to the dashboard.",
  'datasets.md': 'The input and output datasets and their schemas: set the types when you upload.',
  'rules.csv': 'The rules sheet template: fill it in and upload it as its own dataset.',
  'flow-diagram.html': 'The recipe flow as Dataiku draws it: datasets, recipes, outputs. It opens in any browser; Read it shows it here.',
  'flow.json': 'The recipe flow as data: what the diagram is drawn from.',
  'BUILD-WITH-AGENT.md': 'The instruction to paste into Claude Code or GitHub Copilot: the agent builds the proof of concept inside this folder, on the sample.',
};
/** A kit for a tool the design uses outside the build. */
const OUTSIDE_README = 'A short kit for a tool the design uses for its gaps, outside the main build: what it covers, what to set up and how to test it.';
/** The kit's files in the order of work. */
const KIT_ORDER = ['README.md', 'sample-data.csv', 'instructions.md', 'knowledge.md', 'skills.md', 'prompts.md', 'data-model.md', 'screens.md', 'flows.md',
  'datasets.md', 'rules.csv', 'flow.md', 'flow-diagram.html', 'flow.json', 'BUILD-WITH-AGENT.md', 'test-checklist.md'];

/** The kit folder for a tool, as the server names it ("Power Apps" → "power-apps"). */
export const kitSlug = (tool: string | undefined) => (tool ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** What a file in the pack is and how to use it, by its path in the idea folder. `main` is the picked tool's kit folder. */
export function fileNote(path: string, main?: string): { title: string; use: string } {
  if (path === 'design.md') return { title: 'The design', use: 'The proof of concept on one page: what it shows, with what input, for whom, built by whom, and how to build it. Share it with the team before the first session.' };
  if (path === 'approach.md') return { title: 'The tool and why', use: 'The tool picked, with its pros and cons and the facts it rests on. The builder starts here.' };
  if (path === 'plan.md') return { title: 'The build plan', use: 'The build tasks in order, each with its tool and when it is done, plus the risks. Work through it in the design sessions.' };
  const m = /^kit\/([^/]+)\/(.+)$/.exec(path);
  if (m) {
    const tool = m[1].replace(/-/g, ' ');
    const outside = main && m[1] !== main;
    return {
      title: `${outside ? 'Outside the build' : 'Starter kit'}: ${tool} · ${m[2]}`,
      use: outside && m[2] === 'README.md' ? OUTSIDE_README : KIT_FILES[m[2]] ?? 'A file in the starter kit folder.',
    };
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

/**
 * The pack's files in reading order: the design, the tool, the plan, then the picked tool's kit (README first, then
 * the files in the order of work, the checklist last), then each outside tool's kit.
 */
export function packFiles(planFiles: string[], hasApproach: boolean, main?: string): string[] {
  const parts = (f: string) => { const [, folder = '', ...rest] = f.split('/'); return { folder, name: rest.join('/') }; };
  const rank = (name: string) => { const i = KIT_ORDER.indexOf(name); return i < 0 ? KIT_ORDER.length - 1.5 : i; };
  const kit = planFiles.filter((f) => f.startsWith('kit/')).sort((a, b) => {
    const x = parts(a); const y = parts(b);
    if (x.folder !== y.folder) return x.folder === main ? -1 : y.folder === main ? 1 : x.folder.localeCompare(y.folder);
    return rank(x.name) - rank(y.name) || x.name.localeCompare(y.name);
  });
  return ['design.md', ...(hasApproach ? ['approach.md'] : []), ...(planFiles.includes('plan.md') ? ['plan.md'] : []), ...kit];
}

/** Where the Dataiku kit keeps its recipe flow (drawn in the pack). */
export const FLOW_JSON = 'kit/dataiku/flow.json';
export const FLOW_HTML = 'kit/dataiku/flow-diagram.html';
