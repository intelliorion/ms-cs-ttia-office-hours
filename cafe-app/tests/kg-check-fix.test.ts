import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { tmpWorkspace, sampleIdea } from './helpers';
import { saveIdea } from '../src/ideas/store';
import { appendAiLink, readAiLinks, rebuildGraph } from '../src/graph/store';
import { appendEdit, readEdits } from '../src/graph/operator';
import { checkReport, checkWorkspace } from '../src/graph/check';
import { applyFix, fixLines, planFix } from '../src/graph/fix';
import { fixedClock } from '../src/clock';
import { writeFileAtomic } from '../src/workspace/files';
import { paths } from '../src/workspace/paths';
import { workspaceProblem } from '../src/workspace/init';
import type { AiLink } from '../src/graph/ontology';

const run = promisify(execFile);
const APP = path.resolve(__dirname, '..');
const cafe = (args: string[], cwd = APP, env: NodeJS.ProcessEnv = {}) =>
  run(process.execPath, [path.join(APP, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(APP, 'bin', 'cafe.ts'), ...args], { cwd, env: { ...process.env, CAFE_WORKSPACE: '', ...env } })
    .then((r) => ({ code: 0, out: r.stdout, err: r.stderr }), (e) => ({ code: e.code as number, out: e.stdout as string, err: e.stderr as string }));

const travel = sampleIdea({ id: 'CAFE-2026-006', slug: 'travel', title: 'Travel policy assistant', function: 'GSS', entity: 'CS', dedupe_key: 'f', people: { submitter: 'Lucía Fernández', team: [] }, features: ['Policy question answering'], tools: {} });
const faq = sampleIdea({ id: 'CAFE-2026-007', slug: 'faq', title: 'Procurement FAQ bot', function: 'GSS', entity: 'CS', dedupe_key: 'g', people: { submitter: 'Kwame Mensah', team: [] }, features: ['Policy question answering'], tools: {} });
const ai = (l: Partial<AiLink> & Pick<AiLink, 'from' | 'rel' | 'to'>): AiLink => ({ description: '', source: 'ai:fake:challenge', confidence: 0.9, status: 'confirmed', ...l });

/** The practice workspace's T&E story: the operator adds the policy, the AI reads 006 and finds it, op-9 has no idea. */
async function practice(): Promise<string> {
  const root = await tmpWorkspace();
  for (const i of [travel, faq]) await saveIdea(root, i);
  await appendEdit(root, { id: 'op-1', at: '2026-10-26', status: 'active', t: 'add', node: 'system:travel-expense-policy', type: 'System', label: 'Travel & Expense policy' });
  await appendAiLink(root, ai({ from: 'capability:document-text-extraction', rel: 'USES_DATA', to: 'system:travel-expense-policy', idea: 'CAFE-2026-006', newNodes: [{ id: 'capability:document-text-extraction', type: 'Capability', label: 'Document text extraction' }] }));
  await appendAiLink(root, ai({ from: 'capability:policy-question-answering', rel: 'USES_DATA', to: 'system:email', idea: 'CAFE-2026-007', confidence: 0.5, newNodes: [{ id: 'system:email', type: 'System', label: 'Email' }] }));
  await appendEdit(root, { id: 'op-9', at: '2026-10-26', status: 'active', t: 'link', from: 'capability:policy-question-answering', rel: 'USES_DATA', to: 'system:travel-expense-policy' });
  return root;
}
const deps = (g: { edges: { rel: string; from: string; to: string }[] }, to: string) => g.edges.filter((e) => e.rel === 'DEPENDS_ON' && e.to === to).map((e) => e.from).sort();

describe('an AI link to a star the operator added is kept (it was dropped, so 006\'s own read of the policy was lost)', () => {
  it('the link is in the graph, stated for 006', async () => {
    const g = await rebuildGraph(await practice());
    expect(g.edges.find((e) => e.id === 'capability:document-text-extraction|USES_DATA|system:travel-expense-policy')?.ideas).toEqual(['CAFE-2026-006']);
    // op-9 holds for 006, whose own read reaches the policy; not for 007.
    expect(deps(g, 'system:travel-expense-policy')).toEqual(['idea:CAFE-2026-006']);
  });
});

describe('cafe ontology check: unscoped facts, low-confidence AI links, refused relations and ids', () => {
  it('names op-9 as unscoped with the one-command fix, and the 0.5 AI link as confirmed below the threshold', async () => {
    const r = await checkWorkspace(await practice());
    expect(r.violations).toEqual([]);
    expect(r.unscoped).toEqual([expect.objectContaining({ where: 'operator.jsonl op-9', needers: ['CAFE-2026-006', 'CAFE-2026-007'], confirming: ['CAFE-2026-006'] })]);
    expect(r.lowConfidence).toEqual([{ line: 2, edge: 'capability:policy-question-answering|USES_DATA|system:email', confidence: 0.5, idea: 'CAFE-2026-007' }]);
    const rep = checkReport(r, false);
    expect(rep.lines).toContain('operator.jsonl op-9: unscoped: capability:policy-question-answering USES_DATA system:travel-expense-policy names no idea, so it only adds a way for CAFE-2026-006, whose own facts already say so. Fix: cafe ontology fix --apply (stamps CAFE-2026-006)');
    expect(rep.lines).toContain('ai-links.jsonl line 2: capability:policy-question-answering USES_DATA system:email at 0.5 (CAFE-2026-007)');
    expect(rep.code).toBe(0);
    expect(checkReport(r, true).code).toBe(1);
  });
  it('reports a hand-stored derived relation, AI links to unknown stars or with derived relations, and ids that lie about their kind', async () => {
    const root = await practice();
    await appendEdit(root, { id: 'op-10', at: '2026-10-27', status: 'active', t: 'link', from: 'idea:CAFE-2026-006', rel: 'DEPENDS_ON', to: 'system:email' });
    await appendEdit(root, { id: 'op-11', at: '2026-10-27', status: 'active', t: 'add', node: 'capability:sneaky', type: 'Person', label: 'Sneaky' });
    await appendEdit(root, { id: 'op-12', at: '2026-10-27', status: 'active', t: 'add', node: 'robot:r2', type: 'Robot' as any, label: 'R2' });
    await appendAiLink(root, ai({ from: 'idea:CAFE-2026-006', rel: 'DEPENDS_ON' as any, to: 'system:email', idea: 'CAFE-2026-006' }));
    await appendAiLink(root, ai({ from: 'idea:CAFE-2026-006', rel: 'NEEDS', to: 'capability:nowhere', idea: 'CAFE-2026-006' }));
    await appendAiLink(root, ai({ from: 'idea:CAFE-2026-006', rel: 'NEEDS', to: 'idea:FAKE-1', idea: 'CAFE-2026-006', newNodes: [{ id: 'idea:FAKE-1', type: 'Capability', label: 'Fake' }] }));
    const { violations } = await checkWorkspace(root);
    expect(violations).toEqual([
      'ai-links.jsonl line 3: DEPENDS_ON is derived by the rules, never stated by the AI (skipped by the build)',
      'ai-links.jsonl line 4: capability:nowhere is not in the graph or among the link\'s new stars (skipped by the build)',
      'ai-links.jsonl line 5: new star idea:FAKE-1 is a Capability but its id does not start with "capability:" (skipped by the build)',
      'operator.jsonl op-10: DEPENDS_ON is derived by the rules from what the graph holds, never stored by hand (refused by the build)',
      'operator.jsonl op-11: capability:sneaky is a Person but its id does not start with "person:" (refused by the build)',
      'operator.jsonl op-12: unknown node type "Robot" (refused by the build)',
    ]);
  });
  it('a broken inference.yaml is a violation, and a rule switched off with "no" is off', async () => {
    const root = await practice();
    await writeFileAtomic(paths(root).inference, 'rules: [a: {');
    expect((await checkWorkspace(root)).violations[0]).toMatch(/^inference\.yaml could not be read \(.+\): the built-in rules apply until it is fixed$/);
    await writeFileAtomic(paths(root).inference, 'rules:\n  - name: needs+uses_data\n    chain: [NEEDS, USES_DATA]\n    then: DEPENDS_ON\n    enabled: no\n');
    expect((await rebuildGraph(root)).edges.some((e) => e.rel === 'DEPENDS_ON')).toBe(false);
  });
});

describe('cafe ontology fix: dry run first, --apply writes, nothing guessed', () => {
  it('stamps op-9 for 006 (it confirms it), sends the 0.5 link back to waiting, writes the scopes out; the dry run writes nothing', async () => {
    const root = await practice();
    const before = { edits: await readFile(path.join(paths(root).graph, 'operator.jsonl'), 'utf8'), links: await readFile(path.join(paths(root).graph, 'ai-links.jsonl'), 'utf8'), rules: await readFile(paths(root).inference, 'utf8') };
    const plan = await planFix(root);
    expect(plan.stamps).toEqual([expect.objectContaining({ edit: 'op-9', ideas: ['CAFE-2026-006'] })]);
    expect(plan.unconfirm).toEqual([{ line: 2, edge: 'capability:policy-question-answering|USES_DATA|system:email', confidence: 0.5 }]);
    expect(plan.preview.waiting).toEqual(['idea:CAFE-2026-007|DEPENDS_ON|system:email']);
    expect(fixLines(plan)[0]).toBe('Would fix (2); nothing is written without --apply:');
    // init writes every rule with its scope already: nothing to write out there.
    expect(plan.rules).toEqual([]);
    expect(await readFile(path.join(paths(root).graph, 'operator.jsonl'), 'utf8')).toBe(before.edits);
    expect(await readFile(path.join(paths(root).graph, 'ai-links.jsonl'), 'utf8')).toBe(before.links);
    const done = await applyFix(root, plan, fixedClock('2026-10-30'));
    expect(done).toEqual(['operator.jsonl op-9: stamped CAFE-2026-006', 'ai-links.jsonl line 2: waiting for your Do it (0.5)']);
    expect((await readEdits(root)).find((e) => e.id === 'op-9')).toMatchObject({ idea: 'CAFE-2026-006', stamped: '2026-10-30', at: '2026-10-26', status: 'active' });
    expect((await readAiLinks(root)).links[1].status).toBe('pending');
    const after = await checkWorkspace(root);
    expect(after.unscoped).toEqual([]); expect(after.lowConfidence).toEqual([]);
    expect((await planFix(root)).stamps).toEqual([]);
    expect(await readFile(paths(root).inference, 'utf8')).toBe(before.rules);
  });
  it('two ideas need the capability and none confirms: left for the operator, then --stamp settles it; an unknown idea is refused', async () => {
    const root = await tmpWorkspace();
    for (const i of [travel, faq]) await saveIdea(root, i);
    await appendEdit(root, { id: 'op-1', at: '2026-10-26', status: 'active', t: 'add', node: 'system:policy-portal', type: 'System', label: 'Policy portal' });
    await appendEdit(root, { id: 'op-2', at: '2026-10-26', status: 'active', t: 'link', from: 'capability:policy-question-answering', rel: 'USES_DATA', to: 'system:policy-portal' });
    const plan = await planFix(root);
    expect(plan.stamps).toEqual([]);
    expect(plan.ambiguous).toEqual(['operator.jsonl op-2: capability:policy-question-answering USES_DATA system:policy-portal: CAFE-2026-006, CAFE-2026-007 need capability:policy-question-answering and none confirms it: say which with --stamp op-2=CAFE-2026-006,CAFE-2026-007 (or a part of that list); left as it is']);
    expect((await planFix(root, { 'op-2': ['CAFE-2026-099'] })).ambiguous[0]).toMatch(/CAFE-2026-099 is not an idea/);
    const both = await planFix(root, { 'op-2': ['CAFE-2026-007', 'CAFE-2026-006'] });
    expect(both.preview.added).toEqual(['idea:CAFE-2026-006|DEPENDS_ON|system:policy-portal', 'idea:CAFE-2026-007|DEPENDS_ON|system:policy-portal']);
    await applyFix(root, both, fixedClock('2026-10-30'));
    const edits = (await readEdits(root)).filter((e) => e.t === 'link');
    expect(edits.map((e) => [e.id, (e as any).idea])).toEqual([['op-2', 'CAFE-2026-006'], ['op-3', 'CAFE-2026-007']]);
    expect(deps(await rebuildGraph(root), 'system:policy-portal')).toEqual(['idea:CAFE-2026-006', 'idea:CAFE-2026-007']);
  });
  it('switches off a hand-stored derived relation and writes out the scope a rules file left out', async () => {
    const root = await practice();
    await appendEdit(root, { id: 'op-10', at: '2026-10-27', status: 'active', t: 'link', from: 'idea:CAFE-2026-006', rel: 'DEPENDS_ON', to: 'system:email' });
    await writeFileAtomic(paths(root).inference, YAML.stringify({ rules: [{ name: 'needs+built_with', chain: ['NEEDS', 'BUILT_WITH'], then: 'USES', enabled: true }, { name: 'member+submitted', chain: ['HAS_MEMBER', 'SUBMITTED'], then: 'OWNS', enabled: true }] }));
    const plan = await planFix(root);
    expect(plan.undo).toEqual([{ edit: 'op-10', what: 'idea:CAFE-2026-006 DEPENDS_ON system:email: DEPENDS_ON is derived by the rules, never stored by hand' }]);
    expect(plan.rules).toEqual(['inference.yaml: needs+built_with: scope: same-idea written out (the build already reads it so)', 'inference.yaml: member+submitted: scope: same-idea-first written out (the build already reads it so)']);
    await applyFix(root, plan, fixedClock('2026-10-30'));
    expect((await readEdits(root)).find((e) => e.id === 'op-10')?.status).toBe('undone');
    expect(YAML.parse(await readFile(paths(root).inference, 'utf8')).rules.map((r: any) => r.scope)).toEqual(['same-idea', 'same-idea-first']);
  });
});

describe('fault 15: every CLI command that reads a workspace stops with one plain message when there is none', () => {
  it('a missing folder, a folder that is not a workspace, a workspace', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'cafe-nows-'));
    expect(await workspaceProblem(path.join(tmp, 'gone'))).toMatch(/^There is no Café workspace at .*gone: the folder does not exist\. Name it with --workspace DIR or the CAFE_WORKSPACE variable/);
    await mkdir(path.join(tmp, 'data', 'graph'), { recursive: true });
    expect(await workspaceProblem(tmp)).toMatch(/is not a Café workspace \(it has no rules\/stages\.yaml, rules\/settings\.yaml or data\/ideas\)\. Name it with --workspace DIR or the CAFE_WORKSPACE variable/);
    expect(await workspaceProblem(await tmpWorkspace())).toBeUndefined();
  });
  it('cafe network central, ontology check, ontology fix, export and import from a folder with no workspace: one message, exit 1, nothing written', async () => {
    const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), 'cafe-cwd-')));
    for (const args of [['network', 'central'], ['ontology', 'check'], ['ontology', 'fix'], ['export'], ['import', 'x.csv']]) {
      const r = await cafe(args, cwd);
      expect(r.code).toBe(1);
      expect(r.out).toBe('');
      expect(r.err.trim()).toBe(`There is no Café workspace at ${path.join(cwd, 'cafe-workspace')}: the folder does not exist. Name it with --workspace DIR or the CAFE_WORKSPACE variable (cafe init --workspace DIR makes a new one).`);
    }
    // Nothing was made in the default place (it used to be: data/graph/nodes.jsonl and edges.jsonl).
    await expect(readFile(path.join(cwd, 'cafe-workspace', 'data', 'graph', 'edges.jsonl'), 'utf8')).rejects.toThrow();
    const r = await cafe(['ontology', 'check'], cwd, { CAFE_WORKSPACE: path.join(cwd, 'elsewhere') });
    expect(r.err).toMatch(/elsewhere: the folder does not exist/);
  }, 60000);
  it('cafe ontology fix on a real workspace: the dry run, then --apply', async () => {
    const root = await practice();
    const dry = await cafe(['ontology', 'fix', '--workspace', root]);
    expect(dry.code).toBe(0);
    expect(dry.out).toMatch(/^Would fix \(2\); nothing is written without --apply:\n  operator\.jsonl op-9: capability:policy-question-answering USES_DATA system:travel-expense-policy: stamp CAFE-2026-006/);
    const applied = await cafe(['ontology', 'fix', '--apply', '--workspace', root]);
    expect(applied.out).toMatch(/^Fixed \(2\):\n  operator\.jsonl op-9: stamped CAFE-2026-006\n  ai-links\.jsonl line 2: waiting for your Do it \(0\.5\)/);
    expect((await cafe(['ontology', 'fix', '--workspace', root])).out.trim()).toBe('Nothing to fix: the workspace is in line with the graph\'s reasoning.');
    await writeFile(path.join(root, 'x'), '');
  }, 60000);
});
