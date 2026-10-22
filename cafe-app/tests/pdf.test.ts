import { describe, it, expect } from 'vitest';
import { readPdfText } from '../src/inbox/pdf';
import { textPdf, imagePdf, protectedPdf, MEMO_LINES } from './helpers';

describe('readPdfText', () => {
  it('reads the text of a text PDF, one page', async () => {
    const r = await readPdfText(textPdf(MEMO_LINES));
    if ('error' in r) throw new Error(r.error);
    expect(r.pages).toBe(1);
    expect(r.text).toContain('The finance team wants a weekly digest.');
    expect(r.text).toContain('CAFE-2026-004');
  });
  it('finds (almost) no text in a PDF that holds only an image', async () => {
    const r = await readPdfText(imagePdf());
    if ('error' in r) throw new Error(r.error);
    expect(r.pages).toBe(1);
    expect(r.text.trim().length).toBeLessThan(40);
  });
  it('a password-protected PDF is protected', async () => {
    expect(await readPdfText(protectedPdf())).toEqual({ error: 'protected' });
  });
  it('a broken PDF is an error, not a throw', async () => {
    expect(await readPdfText(new TextEncoder().encode('%PDF-1.4 not really'))).toEqual({ error: 'broken' });
  });
});
