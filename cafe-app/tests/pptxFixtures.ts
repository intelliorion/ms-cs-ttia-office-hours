/**
 * Small PowerPoint decks built in the tests: a hand-written one (minimal OOXML zipped with fflate) for the cases a
 * writer library does not make (merged header cells, a layout-placed body, a group, SmartArt, a percentage series,
 * slides out of file order, footers), and one written by pptxgenjs, the way a real tool writes a deck. Made-up data only.
 */
import { strToU8, zipSync } from 'fflate';
import PptxGenJS from 'pptxgenjs';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = (items: [string, string, string][]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
const off = (x: number, y: number) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="8000000" cy="500000"/></a:xfrm>`;
const p = (text: string, pPr = '') => `<a:p>${pPr}<a:r><a:rPr lang="en-GB"/><a:t>${text}</a:t></a:r></a:p>`;
const sp = (id: number, body: string, { ph, pos }: { ph?: string; pos?: [number, number] } = {}) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr>${ph ?? ''}</p:nvPr></p:nvSpPr><p:spPr>${pos ? off(pos[0], pos[1]) : ''}</p:spPr><p:txBody><a:bodyPr/>${body}</p:txBody></p:sp>`;
export const slideXml = (shapes: string, hidden = false) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}${hidden ? ' show="0"' : ''}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld></p:sld>`;
const tc = (text: string, attrs = '') => `<a:tc${attrs}><a:txBody><a:bodyPr/>${text ? p(text) : '<a:p/>'}</a:txBody></a:tc>`;
const frame = (id: number, y: number, data: string, uri: string) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Frame ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="500000" y="${y}"/><a:ext cx="8000000" cy="3000000"/></p:xfrm><a:graphic><a:graphicData uri="${uri}">${data}</a:graphicData></a:graphic></p:graphicFrame>`;

/** The merged-cell table: Team spans two header rows, Q1 spans two columns over Actual and Plan; Ops spans two body rows. */
const MERGED_TABLE = `<a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid><a:gridCol w="2000000"/><a:gridCol w="2000000"/><a:gridCol w="2000000"/></a:tblGrid>
<a:tr h="300000">${tc('Team', ' rowSpan="2"')}${tc('Q1', ' gridSpan="2"')}${tc('', ' hMerge="1"')}</a:tr>
<a:tr h="300000">${tc('', ' vMerge="1"')}${tc('Actual')}${tc('Plan')}</a:tr>
<a:tr h="300000">${tc('Ops', ' rowSpan="2"')}${tc('120')}${tc('100')}</a:tr>
<a:tr h="300000">${tc('', ' vMerge="1"')}${tc('130')}${tc('110')}</a:tr>
<a:tr h="300000">${tc('Finance')}${tc('90')}${tc('95')}</a:tr></a:tbl>`;

const num = (vals: (number | string)[], fmt = 'General') => `<c:numCache><c:formatCode>${fmt}</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache>`;
const str = (vals: string[]) => `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:strCache>`;
const ser = (i: number, name: string, cats: string[], vals: (number | string)[], fmt?: string) =>
  `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>Sheet1!$${'BC'[i]}$1</c:f>${str([name])}</c:strRef></c:tx><c:cat><c:strRef><c:f>Sheet1!$A$2:$A$4</c:f>${str(cats)}</c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$${'BC'[i]}$2:$${'BC'[i]}$4</c:f>${num(vals, fmt)}</c:numRef></c:val></c:ser>`;
const CHART = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}">
<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Claims &amp; refunds by month</a:t></a:r></a:p></c:rich></c:tx></c:title><c:autoTitleDeleted val="0"/><c:plotArea>
<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${ser(0, 'Claims', ['Jan', 'Feb', 'Mar'], [40, 52, 47])}</c:barChart>
<c:lineChart><c:grouping val="standard"/>${ser(1, 'Refund rate', ['Jan', 'Feb', 'Mar'], [0.25, 0.1, 0.125], '0%')}</c:lineChart>
<c:catAx><c:axId val="1"/><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Month</a:t></a:r></a:p></c:rich></c:tx></c:title></c:catAx><c:valAx><c:axId val="2"/></c:valAx>
</c:plotArea></c:chart></c:chartSpace>`;

const SMARTART = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst>
<dgm:pt modelId="0" type="doc"><dgm:t><a:bodyPr/><a:p><a:endParaRPr/></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="2"><dgm:t><a:bodyPr/><a:p><a:r><a:t>Check the cap</a:t></a:r></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="1"><dgm:t><a:bodyPr/><a:p><a:r><a:t>Export the claims</a:t></a:r></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="3"><dgm:t><a:bodyPr/><a:p><a:r><a:t>Weekly, on Monday</a:t></a:r></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="9" type="parTrans"/><dgm:pt modelId="10" type="sibTrans"/>
</dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="20" srcId="0" destId="2" srcOrd="1" destOrd="0"/><dgm:cxn modelId="21" srcId="0" destId="1" srcOrd="0" destOrd="0"/><dgm:cxn modelId="22" srcId="1" destId="3" srcOrd="0" destOrd="0"/><dgm:cxn modelId="23" type="presOf" srcId="2" destId="99" srcOrd="0" destOrd="0"/></dgm:cxnLst></dgm:dataModel>`;

const LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${NS}><p:cSld><p:spTree>
${sp(2, '', { ph: '<p:ph type="title"/>', pos: [500000, 300000] })}${sp(3, '', { ph: '<p:ph idx="1"/>', pos: [500000, 1500000] })}${sp(4, '<a:p><a:r><a:t>Layout footer text</a:t></a:r></a:p>', { ph: '<p:ph type="ftr" idx="11"/>', pos: [500000, 6300000] })}
</p:spTree></p:cSld></p:sldLayout>`;

const FIRST = slideXml([
  sp(5, p('Source: the October export'), { pos: [500000, 6000000] }),
  sp(2, p('Expense review today'), { ph: '<p:ph type="title"/>' }),
  sp(3, [p('R&amp;D &lt;team&gt; claims'), '<a:p><a:pPr lvl="1"/><a:r><a:t>Checked by hand</a:t></a:r><a:br/><a:r><a:t>every Monday</a:t></a:r></a:p>',
    p('Export the claims', '<a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr>'), p('Compare with the caps', '<a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr>'),
    p('No bullet here', '<a:pPr><a:buNone/></a:pPr>'), '<a:p><a:fld id="{1}" type="slidenum"><a:t>7</a:t></a:fld></a:p>'].join(''), { ph: '<p:ph idx="1"/>' }),
  sp(6, p('Confidential'), { ph: '<p:ph type="ftr" sz="quarter" idx="11"/>' }),
  sp(7, p('1'), { ph: '<p:ph type="sldNum" sz="quarter" idx="12"/>' }),
  sp(8, '<a:p/>', { ph: '<p:ph type="body" idx="2"/>' }),
  `<p:pic><p:nvPicPr><p:cNvPr id="9" name="Picture 9" descr="Photo of the claims tracker"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId9"/></p:blipFill><p:spPr>${off(500000, 4000000)}</p:spPr></p:pic>`,
  `<p:pic><p:nvPicPr><p:cNvPr id="10" name="Logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId9"/></p:blipFill><p:spPr>${off(9000000, 100000)}</p:spPr></p:pic>`,
  `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="11" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="500000" y="4500000"/><a:ext cx="4000000" cy="1000000"/><a:chOff x="0" y="0"/><a:chExt cx="4000000" cy="1000000"/></a:xfrm></p:grpSpPr>${sp(13, p('Group right'), { pos: [2500000, 0] })}${sp(12, p('Group left'), { pos: [0, 0] })}</p:grpSp>`,
].join(''));

/**
 * The hand-written deck: four slides, listed in presentation.xml in the order slide3, slide1, slide2, slide4.
 *   1 (slide3.xml): title and body placed by the layout (no positions of their own), a source line written first in
 *     the XML but placed at the foot, a footer and a slide number (boilerplate), entities, a line break, numbering,
 *     a picture's alt text, a group of two text boxes, speaker notes.
 *   2 (slide1.xml): "Costs by team" with the merged-cell table.
 *   3 (slide2.xml): a text box as its title (no title placeholder), the combination chart and SmartArt.
 *   4 (slide4.xml): hidden.
 * `first` replaces slide 1's XML (a broken slide).
 */
export function handDeck(opts: { first?: string; presentation?: string } = {}): Uint8Array {
  const second = slideXml([sp(2, p('Costs by team'), { ph: '<p:ph type="title"/>', pos: [500000, 300000] }), frame(3, 1500000, MERGED_TABLE, 'http://schemas.openxmlformats.org/drawingml/2006/table')].join(''));
  const third = slideXml([
    sp(2, p('How claims flow'), { pos: [500000, 200000] }),
    frame(3, 1500000, '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/>', 'http://schemas.openxmlformats.org/drawingml/2006/chart'),
    frame(4, 4800000, '<dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId3" r:lo="rId4" r:qs="rId5" r:cs="rId6"/>', 'http://schemas.openxmlformats.org/drawingml/2006/diagram'),
  ].join(''));
  const hidden = slideXml(sp(2, p('Draft numbers, not for the team'), { pos: [500000, 300000] }), true);
  const notes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes ${NS}><p:cSld><p:spTree>${sp(2, '', { ph: '<p:ph type="sldImg"/>' })}${sp(3, [p('Say the caps changed in May.'), p('Ask who owns the export.')].join(''), { ph: '<p:ph type="body" idx="1"/>' })}${sp(4, p('3'), { ph: '<p:ph type="sldNum" idx="5"/>' })}</p:spTree></p:cSld></p:notes>`;
  const layoutRel: [string, string, string] = ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'];
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    '_rels/.rels': strToU8(rels([['rId1', 'officeDocument', 'ppt/presentation.xml']])),
    'docProps/core.xml': strToU8('<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Expense check deck</dc:title></cp:coreProperties>'),
    'ppt/presentation.xml': strToU8(opts.presentation ?? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId13"/><p:sldId id="257" r:id="rId11"/><p:sldId id="258" r:id="rId12"/><p:sldId id="259" r:id="rId14"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`),
    'ppt/_rels/presentation.xml.rels': strToU8(rels([['rId11', 'slide', 'slides/slide1.xml'], ['rId12', 'slide', 'slides/slide2.xml'], ['rId13', 'slide', '/ppt/slides/slide3.xml'], ['rId14', 'slide', 'slides/slide4.xml']])),
    'ppt/slideLayouts/slideLayout1.xml': strToU8(LAYOUT),
    'ppt/slides/slide3.xml': strToU8(opts.first ?? FIRST),
    'ppt/slides/_rels/slide3.xml.rels': strToU8(rels([layoutRel, ['rId2', 'notesSlide', '../notesSlides/notesSlide1.xml'], ['rId9', 'image', '../media/image1.png']])),
    'ppt/notesSlides/notesSlide1.xml': strToU8(notes),
    'ppt/slides/slide1.xml': strToU8(second),
    'ppt/slides/_rels/slide1.xml.rels': strToU8(rels([layoutRel])),
    'ppt/slides/slide2.xml': strToU8(third),
    'ppt/slides/_rels/slide2.xml.rels': strToU8(rels([layoutRel, ['rId2', 'chart', '../charts/chart7.xml'], ['rId3', 'diagramData', '../diagrams/data1.xml']])),
    'ppt/charts/chart7.xml': strToU8(CHART),
    'ppt/diagrams/data1.xml': strToU8(SMARTART),
    'ppt/slides/slide4.xml': strToU8(hidden),
    'ppt/slides/_rels/slide4.xml.rels': strToU8(rels([layoutRel])),
    'ppt/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  };
  return zipSync(files);
}

/** A deck as pptxgenjs writes it: a bulleted slide with notes, a table, a column chart, and a hidden slide. */
export async function libDeck(notes = 'Say the caps changed in May.'): Promise<Uint8Array> {
  const pres = new (PptxGenJS as unknown as new () => any)();
  let s = pres.addSlide();
  s.addText('Expense review', { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28 });
  s.addText([{ text: 'Claims are checked by hand', options: { bullet: true } }, { text: 'Each Monday', options: { bullet: true, indentLevel: 1 } }], { x: 0.5, y: 1.5, w: 8, h: 2 });
  s.addNotes(notes);
  s = pres.addSlide();
  s.addText('Caps by policy', { x: 0.5, y: 0.3, w: 9, h: 0.8 });
  s.addTable([['Policy', 'Cap', 'Receipt over'], ['T', '150', '25'], ['M', '40', '10']], { x: 0.5, y: 1.5, w: 8 });
  s = pres.addSlide();
  s.addChart(pres.ChartType.bar, [{ name: '2025', labels: ['Jan', 'Feb', 'Mar'], values: [10, 12, 9] }, { name: '2026', labels: ['Jan', 'Feb', 'Mar'], values: [11, 14, 8] }],
    { x: 1, y: 1, w: 8, h: 4, showTitle: true, title: 'Claims by month' });
  s = pres.addSlide();
  s.hidden = true;
  s.addText('Draft numbers', { x: 1, y: 1, w: 5, h: 1 });
  return new Uint8Array(await pres.write({ outputType: 'uint8array' }) as ArrayBuffer);
}

/** An old binary Office file's first bytes (an OLE container) with the stream name that says what it is, in UTF-16. */
export function oleFile(stream: string): Uint8Array {
  const head = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const name = [...stream].flatMap((c) => [c.charCodeAt(0), 0]);
  return new Uint8Array([...head, ...new Array(504).fill(0), ...name, ...new Array(64).fill(0)]);
}
