import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LANGUAGES, type Language } from 'cortico/core/language.ts';
import type { DesktopPetWorld, PetDialog, PetDialogAnswer } from 'cortico-world-desktop-pet';
import { runGuide } from '../core/guide.ts';
import { coreText } from '../core/i18n/index.ts';

/** A pet that answers each bubble from `answers` (then closes), the app language the config API sets, and the statistics sent. */
function setup(start: Language, answers: PetDialogAnswer[], done = false) {
  const dir = mkdtempSync(join(tmpdir(), 'guide-language-'));
  const dressed: unknown[] = [];
  const posted: string[] = [];
  const doneFile = join(dir, 'guide.json');
  if (done) writeFileSync(doneFile, '{}');
  let language = start;
  const shown: PetDialog[] = [];
  const saved: unknown[] = [];
  const tracked: Array<[string, Record<string, unknown>]> = [];
  const pet = {
    petState: () => ({ connected: true }),
    dress: (skin: unknown) => { dressed.push(skin); },
    dialog: (d: PetDialog) => {
      shown.push(d);
      return { answer: Promise.resolve(answers.shift() ?? { closed: true }), close() {}, update() {} };
    },
  } as unknown as DesktopPetWorld;
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') {
      posted.push(new URL(url).pathname);
      const body = JSON.parse(init.body ?? '{}') as { group: string; values: Record<string, unknown> };
      saved.push(body);
      if (body.group === 'companion' && typeof body.values.language === 'string') language = body.values.language as Language;
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const run = runGuide({ pet: () => pet, console: 'http://127.0.0.1:1', doneFile, openDress() {}, language: () => language,
    track: (type, fields) => { tracked.push([type, fields]); } });
  return { run, shown, saved, dressed, posted, tracked };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('the introduction asks for the language first', () => {
  it('asks with the language in force picked, then speaks the language picked', async () => {
    const { run, shown, saved } = setup('ja', [{ index: LANGUAGES.indexOf('zh') }]);
    await run;
    const first = shown[0]!;
    expect(first.step).toEqual([1, 7]);
    expect(first.input?.kind).toBe('choices');
    expect(first.input?.kind === 'choices' && first.input.value).toBe(LANGUAGES.indexOf('ja'));
    // each card says hello over its language's name, without a region in it
    const options = first.input?.kind === 'choices' ? first.input.options : [];
    expect(options[LANGUAGES.indexOf('es-419')]).toEqual({ label: '¡Hola!', note: 'Español' });
    expect(options[LANGUAGES.indexOf('pt-BR')]).toEqual({ label: 'Olá!', note: 'Português' });
    expect(options[LANGUAGES.indexOf('en')]).toEqual({ label: 'Hello!', note: 'English' });
    expect(saved).toContainEqual({ group: 'companion', values: { language: 'zh' } });
    // the next line, the hello, is in the language picked, and the dots moved on by one
    expect(shown[1]!.text).toBe(coreText('zh').guide.hello);
    expect(shown[1]!.step).toEqual([2, 7]);
  }, 10_000);

  it('keeps the language when the page is closed', async () => {
    const { run, shown, saved } = setup('zh', [{ closed: true }]);
    await run;
    expect(saved.filter((b) => (b as { group: string }).group === 'companion')).toEqual([]);
    expect(shown.at(-1)!.text).toBe(coreText('zh').guide.closed);
  }, 10_000);

  it('saves nothing when the language in force is kept', async () => {
    const { run, shown, saved } = setup('de', [{ index: LANGUAGES.indexOf('de') }], true);
    await run;
    expect(saved.filter((b) => (b as { group: string }).group === 'companion')).toEqual([]);
    expect(shown[1]!.text).toBe(coreText('de').guide.hello);
  }, 10_000);
});

describe('the introduction goes back a step', () => {
  it('shows the step answered before as it was answered, and keeps and counts what is answered last', async () => {
    const S = coreText('zh').guide;
    const { run, shown, tracked } = setup('zh', [
      { index: LANGUAGES.indexOf('zh') }, { index: 0 }, { text: '小明' }, { done: true }, { index: 0 }, { done: true },
      // back from how lively to the source, past the line after it; another source, then running about
      { back: true }, { index: 5 }, { done: true }, { index: 2 }, { done: true },
      // back from the response mode to how lively
      { back: true },
    ]);
    await run;
    expect(shown[0]!.back).toBeUndefined();
    const sources = shown.filter((d) => d.text === S.askSource);
    expect(sources).toHaveLength(2);
    expect(sources[1]!.back).toBe(S.back);
    expect(sources[1]!.input?.kind === 'buttons' && sources[1]!.input.options.map((o) => !!o.primary)).toEqual(S.sources.map((_, i) => i === 0));
    const roams = shown.filter((d) => d.text === S.askRoam);
    expect(roams).toHaveLength(3);
    expect(roams[2]!.input?.kind === 'choices' && roams[2]!.input.value).toBe(2);
    expect(tracked.filter(([type]) => type === 'source')).toEqual([['source', { answer: S.sources[5]![1] }]]);
  }, 10_000);
});
