import { describe, it, expect } from 'vitest';
import { mkdir, readdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpWorkspace, sampleIdea } from './helpers';
import { initWorkspace } from '../src/workspace/init';
import { slugify, nextId, saveIdea, loadIdea, listIdeas } from '../src/ideas/store';
import { loadSettings, saveSettings } from '../src/round/store';

describe('workspace', () => {
  it('creates the layout, rules and templates, and no round', async () => {
    const root = await tmpWorkspace();
    // The setup at the top; everything the Café makes under data/, which can be deleted.
    expect((await readdir(root)).sort()).toEqual(['README.txt', 'data', 'rules', 'templates']);
    expect((await readdir(path.join(root, 'data'))).sort()).toEqual(['chat', 'cohorts', 'exports', 'graph', 'ideas', 'inbox', 'memory', 'roadshows', 'rounds']);
    expect(await readdir(path.join(root, 'templates'))).toHaveLength(17);
    expect(await readdir(path.join(root, 'data', 'rounds'))).toEqual([]);
  });

  it('is safe to run twice and keeps edits', async () => {
    const root = await tmpWorkspace();
    await saveSettings(root, { operatorName: 'Café operator' });
    expect((await initWorkspace(root)).created).toEqual([]);
    expect((await loadSettings(root)).operatorName).toBe('Café operator');
  });

  it('the email signature keeps its lines; other settings stay on one line', async () => {
    const root = await tmpWorkspace();
    await saveSettings(root, { operatorName: '  Café operator  \r\nTTIA lead   \r\n\r\n', formLink: '  https://form.example  ' });
    expect(await loadSettings(root)).toMatchObject({ operatorName: 'Café operator\nTTIA lead', formLink: 'https://form.example' });
  });
});

describe('ideas', () => {
  it('makes slugs and the next ID', () => {
    expect(slugify('RFx CoE Intelligent Intake & Ticketing Agent')).toBe('rfx-coe-intelligent-intake-ticketing-agent');
    expect(nextId(['CAFE-2026-002', 'CAFE-2026-001', 'CAFE-2025-009'], 2026)).toBe('CAFE-2026-003');
    expect(nextId([], 2026)).toBe('CAFE-2026-001');
  });

  it('saves and loads an idea in its own folder', async () => {
    const root = await tmpWorkspace();
    const dir = await saveIdea(root, sampleIdea());
    expect(path.basename(dir)).toBe('CAFE-2026-001-email-scheduler');
    expect((await loadIdea(root, 'CAFE-2026-001')).title).toBe('Email scheduler');
  });

  it('refuses an ID that is not a Café ID', async () => {
    const root = await tmpWorkspace();
    await expect(loadIdea(root, '../../etc')).rejects.toThrow('Not a Café ID');
  });

  it('lists good ideas and reports a broken one', async () => {
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea());
    const broken = path.join(root, 'data', 'ideas', 'CAFE-2026-002-broken');
    await mkdir(broken, { recursive: true });
    await writeFile(path.join(broken, 'idea.yaml'), 'title: [unclosed\n');
    const { ideas, problems } = await listIdeas(root);
    expect(ideas.map((i) => i.id)).toEqual(['CAFE-2026-001']);
    expect(problems.map((p) => p.folder)).toEqual(['CAFE-2026-002-broken']);
  });
});

describe('settings', () => {
  it('merges settings; old capacity limits are ignored and dropped at the next save', async () => {
    const root = await tmpWorkspace();
    await writeFile(path.join(root, 'rules', 'settings.yaml'), 'capacity:\n  ideasPerRound: 3\n  sessionsPerWeek: 2\noperatorName: Café operator\n');
    expect(await loadSettings(root)).toEqual({ operatorName: 'Café operator' });
    await saveSettings(root, { csicLink: 'https://csic.example/intake', capacity: { ideasPerRound: 4 } });
    const file = await readFile(path.join(root, 'rules', 'settings.yaml'), 'utf8');
    expect(file).toContain('csic.example');
    expect(file).not.toContain('capacity');
  });
});

describe('start-up never overwrites rules', () => {
  it('an existing settings.yaml or stages.yaml, even an empty one, is left as it is', async () => {
    const { initWorkspace } = await import('../src/workspace/init');
    const root = await tmpWorkspace();
    await writeFile(path.join(root, 'rules', 'settings.yaml'), '');
    await writeFile(path.join(root, 'rules', 'stages.yaml'), '');
    const { created } = await initWorkspace(root);
    expect(created).not.toContain('rules/settings.yaml');
    expect(created).not.toContain('rules/stages.yaml');
    expect(await readFile(path.join(root, 'rules', 'settings.yaml'), 'utf8')).toBe('');
  });
});

describe('the data folder', () => {
  it("an older workspace's data moves into data/ once, with its references still working; a folder in both places is left alone", async () => {
    const { initWorkspace } = await import('../src/workspace/init');
    const { listOutbox } = await import('../src/comms/outbox');
    const { listIdeas } = await import('../src/ideas/store');
    const { mkdtemp, rename: mv } = await import('node:fs/promises');
    const os = await import('node:os');
    // Build a workspace the new way, then put it back into the old layout (data folders at the top).
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea());
    const { draftEmail } = await import('../src/comms/outbox');
    await saveSettings(root, { operatorName: 'Café operator' });
    const rec = await draftEmail(root, { template: 'E2', ideaId: 'CAFE-2026-001' }, () => '2026-10-22');
    for (const name of ['ideas', 'rounds', 'inbox', 'graph']) await mv(path.join(root, 'data', name), path.join(root, name));
    await writeFile(path.join(root, 'data', 'chat', 'keep.txt'), 'x');
    await mkdir(path.join(root, 'chat'), { recursive: true });
    const r = await initWorkspace(root);
    expect(r.moved.sort()).toEqual(['graph', 'ideas', 'inbox', 'rounds']);
    expect(r.left).toEqual(['chat']);
    expect((await listIdeas(root)).ideas.map((i) => i.id)).toEqual(['CAFE-2026-001']);
    expect((await listOutbox(root)).map((m) => m.key)).toEqual([rec.key]);
    expect(rec.key.startsWith('ideas/')).toBe(true);
    void mkdtemp; void os;
  });

  it('deleting data/ while the app runs leaves an empty Café that works', async () => {
    const { rm } = await import('node:fs/promises');
    const { listIdeas } = await import('../src/ideas/store');
    const root = await tmpWorkspace();
    await saveIdea(root, sampleIdea());
    await rm(path.join(root, 'data'), { recursive: true, force: true });
    expect((await listIdeas(root)).ideas).toEqual([]);
    await saveIdea(root, sampleIdea());
    expect((await listIdeas(root)).ideas).toHaveLength(1);
    expect(await loadSettings(root)).toBeTruthy();
  });
});
