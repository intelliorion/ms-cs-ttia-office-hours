import { ALLOWED, DERIVED_RELATIONS, IDEA_SCOPED, NODE_DESCRIPTIONS, NODE_LABELS, NODE_TYPES, RELATION_MEANINGS, type Relation } from './ontology';
import { namespaces } from './jsonld';

/**
 * The schema the export's data is written in, from the ontology as it stands (rules/ontology.yaml's declarations
 * included), at the export's base IRI:
 * - vocabularyTurtle: an RDFS vocabulary (with the OWL kinds a reasoner expects): a class per kind of star, a property
 *   per relation with its rdfs:domain and rdfs:range, labels, and comments from the ontology's meanings; the derived
 *   relations say so; KIND_OF is transitive; the Link, Rule, Export, Derivation and Analysis classes and their properties.
 * - shapesTurtle: SHACL shapes the data must meet: each kind's label, each relation's subject and object kinds, each
 *   Link's ends, relation, source, confidence (0 to 1) and confirmed, each derived link's rule, the export's scope and time.
 * Both are plain Turtle text, written beside every export.
 */
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL = 'http://www.w3.org/2002/07/owl#';
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const PROV = 'http://www.w3.org/ns/prov#';
const SH = 'http://www.w3.org/ns/shacl#';

/** A Turtle string literal. */
const lit = (s: string) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
const words = (r: string) => r.toLowerCase().replace(/_/g, ' ');
const relations = () => Object.keys(ALLOWED) as Relation[];
const prefixes = (vocab: string, data: string, extra = '') => [
  `@prefix rdf: <${RDF}> .`, `@prefix rdfs: <${RDFS}> .`, `@prefix owl: <${OWL}> .`, `@prefix xsd: <${XSD}> .`, `@prefix prov: <${PROV}> .`,
  `@prefix cafe: <${vocab}> .`, `@prefix star: <${data}> .`, ...(extra ? [extra] : []), '',
].join('\n');

/** The ontology's IRI: the vocabulary namespace without its "#". */
export const ontologyIri = (base?: string) => namespaces(base).vocab.replace(/#$/, '');

export function vocabularyTurtle(base?: string): string {
  const { vocab, data } = namespaces(base);
  const onto = `<${ontologyIri(base)}>`;
  const out: string[] = [prefixes(vocab, data)];
  out.push(`${onto} a owl:Ontology ;\n  rdfs:label ${lit("Creators' Café knowledge graph ontology")}@en ;\n  rdfs:comment ${lit('The kinds of star and the relations of the Creators\' Café knowledge graph, from rules/ontology.yaml. Derived relations are produced by the rules in rules/inference.yaml from stated facts and are never stored. A capability-level fact holds for the ideas it is stated for: as a plain triple only where it holds for every idea that needs the capability; per idea, a cafe:Link with cafe:statedFor, and its consequence for the idea is the derived plain triple (cafe:DEPENDS_ON, cafe:USES).')}@en .`);
  out.push(`cafe:derived a owl:AnnotationProperty ;\n  rdfs:label ${lit('derived')}@en ;\n  rdfs:comment ${lit('True on a relation the rules derive from stated facts; such a fact is never stored by hand or by the AI.')}@en ;\n  rdfs:isDefinedBy ${onto} .`);
  for (const t of NODE_TYPES) {
    out.push(`cafe:${t} a rdfs:Class, owl:Class ;\n  rdfs:label ${lit(NODE_LABELS[t] ?? t)}@en ;\n  rdfs:comment ${lit(NODE_DESCRIPTIONS[t] || NODE_LABELS[t] || t)}@en ;\n  rdfs:isDefinedBy ${onto} .`);
  }
  for (const r of relations()) {
    const [from, to] = ALLOWED[r];
    const derived = DERIVED_RELATIONS.includes(r);
    const kinds = ['rdf:Property', 'owl:ObjectProperty', ...(r === 'KIND_OF' ? ['owl:TransitiveProperty'] : [])].join(', ');
    const note = derived ? ' Derived by the rules from stated facts, never stored.'
      : IDEA_SCOPED.includes(r) ? ' Stated for the ideas it holds for: a plain triple only where it holds for every idea that needs the capability; per idea, a cafe:Link with cafe:statedFor.' : '';
    out.push(`cafe:${r} a ${kinds} ;\n  rdfs:label ${lit(words(r))}@en ;\n  rdfs:comment ${lit(`${RELATION_MEANINGS[r]?.meaning ?? words(r)}.${note}`)}@en ;\n  rdfs:domain cafe:${from} ;\n  rdfs:range cafe:${to} ;\n  cafe:derived ${derived} ;\n  rdfs:isDefinedBy ${onto} .`);
  }
  const cls = (name: string, comment: string, sub?: string) => `cafe:${name} a rdfs:Class, owl:Class ;${sub ? `\n  rdfs:subClassOf ${sub} ;` : ''}\n  rdfs:label ${lit(name)}@en ;\n  rdfs:comment ${lit(comment)}@en ;\n  rdfs:isDefinedBy ${onto} .`;
  out.push(cls('Link', 'One link of the graph as a resource: its ends, its relation, where it came from, how sure, whether confirmed, the ideas it is stated for and, when derived, how (PROV-O).'));
  out.push(cls('Rule', 'An inference rule of rules/inference.yaml, the activity that generated a derived link.', 'prov:Activity'));
  out.push(cls('Derivation', 'Another way the same derived link is derived: the links it rests on.'));
  out.push(cls('Export', 'This export: its scope and when it was made.'));
  out.push(cls('Analysis', 'An analysis held beside the facts (NetworkX\'s, in a CSIC hand-off): never a fact about the stars.'));
  const prop = (name: string, kind: 'owl:ObjectProperty' | 'owl:DatatypeProperty', domain: string, range: string, comment: string) =>
    `cafe:${name} a rdf:Property, ${kind} ;\n  rdfs:label ${lit(name)}@en ;\n  rdfs:comment ${lit(comment)}@en ;\n  rdfs:domain ${domain} ;\n  rdfs:range ${range} ;\n  rdfs:isDefinedBy ${onto} .`;
  out.push(prop('from', 'owl:ObjectProperty', 'cafe:Link', 'rdfs:Resource', 'The star a link starts at.'));
  out.push(prop('to', 'owl:ObjectProperty', 'cafe:Link', 'rdfs:Resource', 'The star a link ends at.'));
  out.push(prop('rel', 'owl:ObjectProperty', 'cafe:Link', 'rdf:Property', 'The relation of a link.'));
  out.push(prop('source', 'owl:DatatypeProperty', 'cafe:Link', 'xsd:string', 'Where a link came from: form:<Café ID>:<column>, ai:<provider>:<where>, operator:<edit>@<date> or rule:<name>.'));
  out.push(prop('description', 'owl:DatatypeProperty', 'cafe:Link', 'xsd:string', 'The words a link came with.'));
  out.push(prop('confidence', 'owl:DatatypeProperty', 'cafe:Link', 'xsd:double', 'How sure the source was, 0 to 1 (the lowest of a derived link\'s inputs).'));
  out.push(prop('confirmed', 'owl:DatatypeProperty', 'cafe:Link', 'xsd:boolean', 'Whether the link is confirmed: from the form, by the operator, or an AI link at or above the threshold; a derived link when every input is.'));
  out.push(prop('statedFor', 'owl:ObjectProperty', 'cafe:Link', 'cafe:Idea', 'An idea the fact is stated for; the rules read a capability-level fact for these ideas only.'));
  out.push(prop('alternative', 'owl:ObjectProperty', 'cafe:Link', 'cafe:Derivation', 'Another way a derived link is derived.'));
  out.push(prop('exportScope', 'owl:DatatypeProperty', 'cafe:Export', 'xsd:string', '"all", or the Café ID of the idea exported with what it touches.'));
  out.push(prop('attrs', 'owl:ObjectProperty', 'rdfs:Resource', 'rdfs:Resource', 'A star\'s attributes (an idea\'s stage, function, region and Café ID).'));
  out.push(prop('content', 'owl:DatatypeProperty', 'cafe:Analysis', 'rdf:JSON', 'An analysis, as one JSON literal.'));
  return `${out.join('\n\n')}\n`;
}

export function shapesTurtle(base?: string): string {
  const { vocab, data } = namespaces(base);
  const out: string[] = [prefixes(vocab, data, `@prefix sh: <${SH}> .`)];
  const label = `sh:property [ sh:path rdfs:label ; sh:minCount 1 ; sh:maxCount 1 ; sh:datatype xsd:string ; sh:minLength 1 ]`;
  for (const t of NODE_TYPES) {
    const props = relations().filter((r) => ALLOWED[r][0] === t)
      .map((r) => `sh:property [ sh:path cafe:${r} ; sh:nodeKind sh:IRI ; sh:class cafe:${ALLOWED[r][1]} ; sh:message ${lit(`${r} goes ${t} → ${ALLOWED[r][1]}`)} ]`);
    out.push(`cafe:${t}Shape a sh:NodeShape ;\n  sh:targetClass cafe:${t} ;\n  ${[label, ...props].join(' ;\n  ')} .`);
  }
  // Whatever has a relation as a property is of the relation's kind (its rdfs:domain), whatever it is typed as.
  for (const r of relations()) {
    out.push(`cafe:${r}SubjectShape a sh:NodeShape ;\n  sh:targetSubjectsOf cafe:${r} ;\n  sh:class cafe:${ALLOWED[r][0]} ;\n  sh:message ${lit(`only a ${ALLOWED[r][0]} has ${r}`)} .`);
  }
  const rels = relations().map((r) => `cafe:${r}`).join(' ');
  out.push([
    'cafe:LinkShape a sh:NodeShape ;', '  sh:targetClass cafe:Link ;',
    '  sh:property [ sh:path cafe:from ; sh:minCount 1 ; sh:maxCount 1 ; sh:nodeKind sh:IRI ] ;',
    '  sh:property [ sh:path cafe:to ; sh:minCount 1 ; sh:maxCount 1 ; sh:nodeKind sh:IRI ] ;',
    `  sh:property [ sh:path cafe:rel ; sh:minCount 1 ; sh:maxCount 1 ; sh:in ( ${rels} ) ] ;`,
    '  sh:property [ sh:path cafe:source ; sh:minCount 1 ; sh:maxCount 1 ; sh:datatype xsd:string ; sh:pattern "^(form:|ai:[^:]+|operator(:|$)|rule:)" ] ;',
    '  sh:property [ sh:path cafe:confidence ; sh:minCount 1 ; sh:maxCount 1 ; sh:datatype xsd:double ; sh:minInclusive 0 ; sh:maxInclusive 1 ] ;',
    '  sh:property [ sh:path cafe:confirmed ; sh:minCount 1 ; sh:maxCount 1 ; sh:datatype xsd:boolean ] ;',
    `  sh:property [ sh:path cafe:statedFor ; sh:nodeKind sh:IRI ; sh:pattern ${lit(`^${data.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}idea:`)} ] ;`,
    '  sh:property [ sh:path prov:wasGeneratedBy ; sh:maxCount 1 ; sh:class cafe:Rule ] ;',
    '  sh:property [ sh:path prov:wasDerivedFrom ; sh:nodeKind sh:IRI ] .',
  ].join('\n'));
  out.push([
    // What rests on other links is another way (a Derivation) or a derived link, which names its rule.
    'cafe:DerivedLinkShape a sh:NodeShape ;', '  sh:targetSubjectsOf prov:wasDerivedFrom ;',
    '  sh:or ( [ sh:class cafe:Derivation ] [ sh:class cafe:Link ; sh:property [ sh:path prov:wasGeneratedBy ; sh:minCount 1 ] ] ) ;',
    '  sh:message "a derived link names the rule that derived it" .',
  ].join('\n'));
  out.push([
    'cafe:ExportShape a sh:NodeShape ;', '  sh:targetClass cafe:Export ;',
    '  sh:property [ sh:path cafe:exportScope ; sh:minCount 1 ; sh:maxCount 1 ; sh:datatype xsd:string ] ;',
    '  sh:property [ sh:path prov:generatedAtTime ; sh:minCount 1 ; sh:maxCount 1 ; sh:datatype xsd:dateTime ] .',
  ].join('\n'));
  return `${out.join('\n\n')}\n`;
}
