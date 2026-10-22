import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export type PdfText = { text: string; pages: number } | { error: 'protected' | 'broken' };

/**
 * The text layer of a PDF, read by code (no AI): every page's text, pages joined with a blank line.
 * Lines are kept as lines (pdf.js marks the ends), so a table still reads one row per line for the screen.
 * A password-protected PDF is { error: 'protected' }; anything that can't be opened is { error: 'broken' }.
 */
export async function readPdfText(bytes: Uint8Array): Promise<PdfText> {
  let doc: Awaited<ReturnType<typeof getDocument>['promise']> | undefined;
  try {
    // pdf.js takes ownership of the buffer it is given, so it gets a copy.
    doc = await getDocument({
      data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0,
    }).promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      pages.push(text.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim());
      page.cleanup();
    }
    return { text: pages.join('\n\n'), pages: doc.numPages };
  } catch (e) {
    // pdf.js 4 does not export PasswordException; its name is the stable signal.
    return (e as Error)?.name === 'PasswordException' ? { error: 'protected' } : { error: 'broken' };
  } finally {
    await doc?.destroy().catch(() => undefined);
  }
}
