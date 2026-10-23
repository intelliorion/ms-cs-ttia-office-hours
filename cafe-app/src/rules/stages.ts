import { readYaml } from '../workspace/files';
import { paths } from '../workspace/paths';

export type Owner = 'Team' | 'TTIA';
/** Review and Select is the first stage. There used to be a stage 1 (Submit Idea); it is gone, and an old 1 reads as 2. */
export type StageNo = 2 | 3 | 4;
export const STAGES: StageNo[] = [2, 3, 4];
export const FIRST_STAGE: StageNo = 2;
/** A stage number from a file or a page: the old stage 1 is Review and Select; anything else unknown is undefined. */
export function toStage(raw: unknown): StageNo | undefined {
  const n = Number(raw);
  if (n === 1) return FIRST_STAGE;
  return (STAGES as number[]).includes(n) ? (n as StageNo) : undefined;
}

export interface StepDef {
  id: string;
  stage: StageNo;
  owner: Owner;
  text: string;
  needed: boolean;
  /** Template that drafts this step's email, or 'decision' for E3, E4, E5 or E6. */
  email?: string;
}

export const STAGE_NAMES: Record<StageNo, string> = {
  2: 'Review and Select',
  3: 'Design series',
  4: 'Launch and Learn',
};

const step = (id: string, stage: StageNo, owner: Owner, text: string, needed: boolean, email?: string): StepDef =>
  email ? { id, stage, owner, text, needed, email } : { id, stage, owner, text, needed };

export const DEFAULT_STEPS: StepDef[] = [
  step('s1a', 2, 'Team', 'Idea and desired outcome written in their own words', true),
  step('s1b', 2, 'Team', 'No personal, client or third-party data in the form', true),
  step('s1c', 2, 'Team', 'Checked the Café use cases for something that already exists', false),
  step('s1d', 2, 'TTIA', 'Café ID given, duplicates checked', true),
  step('s1e', 2, 'TTIA', 'Acknowledgement sent', true, 'E1'),
  step('s2a', 2, 'TTIA', 'Feasibility assessed: Café proof of concept or CSIC', true),
  step('s2b', 2, 'TTIA', 'Theme tagged for a cohort', false),
  step('s2c', 2, 'TTIA', 'Questions sent to the team, if needed', false, 'E2'),
  step('s2d', 2, 'Team', 'Answers received', false),
  step('s2e', 2, 'Team', 'Builder named, can attend every session', true),
  step('s2f', 2, 'TTIA', 'Decision email sent', true, 'decision'),
  step('s3a', 3, 'Team', 'Attendance confirmed', false),
  step('s3b', 3, 'TTIA', 'Session invites sent', false, 'E7'),
  step('s3c', 3, 'Team', 'The one thing the proof of concept must show, written down', true),
  step('s3d', 3, 'Team', 'Smallest input picked, synthetic or aggregated data', true),
  step('s3e', 3, 'TTIA', 'Tool picked for each feature', true),
  step('s3f', 3, 'TTIA', 'design.md approved', true),
  step('s3g', 3, 'Team', 'Builder has access to the picked tools', false),
  step('s3h', 3, 'TTIA', 'Session follow-up sent', false, 'E8'),
  step('s3i', 3, 'TTIA', 'Route agreed and sent', true, 'E9'),
  step('s4a', 4, 'TTIA', 'Roadshow booked', true, 'E10'),
  step('s4b', 4, 'Team', 'Slides and demo link received', false),
  step('s4c', 4, 'Team', 'Demo given, and the room asked the four feedback questions', false),
  step('s4d', 4, 'Team', 'Reuse write-up received', false),
  step('s4e', 4, 'TTIA', 'Feedback and decision sent', true, 'E11'),
];

export function validateSteps(raw: unknown): StepDef[] {
  if (!Array.isArray(raw)) throw new Error('rules/stages.yaml: "steps" must be a list');
  const seen = new Set<string>();
  return raw.map((s, i) => {
    const st = s as Partial<StepDef>;
    const where = `rules/stages.yaml step ${i + 1}`;
    if (typeof st.id !== 'string' || !st.id) throw new Error(`${where}: missing id`);
    if (seen.has(st.id)) throw new Error(`rules/stages.yaml: duplicate step id ${st.id}`);
    seen.add(st.id);
    // Steps of the old Submit Idea stage (1) belong to Review and Select now.
    const stage = toStage(st.stage);
    if (!stage) throw new Error(`${where} (${st.id}): stage must be 2 (Review and Select), 3 (Design series) or 4 (Launch and Learn)`);
    if (st.owner !== 'Team' && st.owner !== 'TTIA') throw new Error(`${where} (${st.id}): owner must be Team or TTIA`);
    if (typeof st.text !== 'string' || !st.text) throw new Error(`${where} (${st.id}): missing text`);
    return step(st.id, stage, st.owner, st.text, st.needed === true, st.email);
  });
}

export async function loadSteps(root: string): Promise<StepDef[]> {
  const file = await readYaml<{ steps?: unknown }>(paths(root).stages);
  return validateSteps(file?.steps ?? DEFAULT_STEPS);
}
