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
    expect((await readdir(root)).sort()).toEqual(
      ['cohorts', 'exports', 'graph', 'ideas', 'inbox', 'roadshows', 'rounds', 'rules', 'skills', 'templates'],
    );
    expect(await readdir(path.join(root, 'templates'))).toHaveLength(17);
    expect(await readdir(path.join(root, 'rounds'))).toEqual([]);
  });

  it('is safe to run twice and keeps edits', async () => {
    const root = await tmpWorkspace();
    await saveSettings(root, { operatorName: 'Café operator' });
    expect((await initWorkspace(root)).created).toEqual([]);
    expect((await loadSettings(root)).operatorName).toBe('Café operator');
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
    const broken = path.join(root, 'ideas', 'CAFE-2026-002-broken');
    await mkdir(broken, { recursive: true });
    await writeFile(path.join(broken, 'idea.yaml'), 'title: [unclosed\n');
    const { ideas, problems } = await listIdeas(root);
    expect(ideas.map((i) => i.id)).toEqual(['CAFE-2026-001']);
    expect(problems.map((p) => p.folder)).toEqual(['CAFE-2026-002-broken']);
  });
});

describe('settings', () => {
  it('merges settings and checks capacity', async () => {
    const root = await tmpWorkspace();
    await saveSettings(root, { csicLink: 'https://csic.example/intake', capacity: { ideasPerRound: 4 } });
    const s = await loadSettings(root);
    expect(s.capacity).toEqual({ ideasPerRound: 4, sessionsPerWeek: 2 });
    await expect(saveSettings(root, { capacity: { sessionsPerWeek: 0 } })).rejects.toThrow('Sessions per week');
    expect(await readFile(path.join(root, 'rules', 'settings.yaml'), 'utf8')).toContain('csic.example');
  });
});
