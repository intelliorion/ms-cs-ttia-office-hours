# Changelog

## 2026-10-31 (Café app, round 5: a fact confirmed per idea, Do-it records signed, the build says what it drops, NetworkX on confirmed links)

A fourth adversarial retest scored the graph 7.5/10. Each fault it logged is pinned by a test first
(`tests/kg-round5.test.ts`: 30 of its 31 tests fail on the round-4 code; the one that passes is the control), and the
tests it extends.

- **Confirmed per (fact, idea).** Each stored link keeps every statement of it (`sources`): its source, idea,
  confidence, status, who confirmed it (`confirmedBy`: form, threshold, operator with the date, edit), and an AI
  read's quote and time. A fact is confirmed for an idea only by that idea's own statement: round 4's 0.2 read for
  001 that duplicated 003's confirmed fact made 001's dependency "confirmed"; it is now waiting. Do it confirms for the
  idea it is read for (`POST /api/graph/confirm` takes `idea`); the export writes each statement as a
  `cafe:Statement`; the assistant's `links` step gives who confirmed a fact and each idea's own status.
- **Do-it records signed.** `graph/confirmations.jsonl` lines carry an HMAC-SHA256 chained signature with a key outside
  the workspace (`~/.cafe-ai/keys/<workspace id>`); editing both files (A2) is refused and named, a removed line is
  said where the chain breaks, older lines count as waiting until `cafe ontology fix --apply` signs them
  (`--resign` for a workspace moved without its key). The limit is said plainly: code running as your account can
  read the key.
- **The build refuses and says**: a KIND_OF loop a merge closes (A9b; `cycles` no longer claims a refusal that did not
  happen); a tool renamed to an unapproved one or to another tool (A21, also in chat); near spellings of unapproved
  tools ("UI Path", "UiPath RPA", "Chat GPT", "Power-Automate", "Zapier.com": A11a/b/c); an `entities.yaml` Tool entry
  that is not an approved tool; an unlink of a fact the form states, or of a derived link (U1, also in chat); a second
  folder with one Café ID (F1: not read, never merged); a quote the text never held and a readAt that is no time (A7);
  an AI link to a missing star or between the wrong kinds; an `ontology.yaml` that re-pairs a built-in relation (O1:
  one loud line with the counts); a `confirmAt` below 0.5 (S1: 0.7 used). `cafe ontology check` no longer calls an AI
  link a merge moved "skipped". The built-in rules a file leaves out still run, and are named.
- **NetworkX on confirmed links by default**: stats, centrality, clusters, paths, isolated, suggestions and cycles
  leave out links waiting for Do it (`--with-unconfirmed`, `?unconfirmed=1`, the pop-out's Waiting links switch); the
  nx1 "Hub thing" no longer tops centrality; every output says which facts it read and what it left out; a path hop
  along a capability fact says which ideas it holds for. Centrality matches an independent NetworkX 3.7 exactly.
- **The assistant**: a person typed without accents is found (Q22); a walk names each link it did not follow and the
  idea's own need (Q24, S24); a fact stated for no idea says so (Q36, Q45); a link with no time gives the idea's last AI
  read (Q46); an idea's capability-level facts are in its links (008); derived links are counted with `links source:
  rule` (S22); stars of a declared kind are proposed through chat; conversation ids never collide.
- **The 92 questions of the retest**, re-asked on fresh copies as is and after `fix --apply`: round 4 had 84 right, 5
  partly and 3 wrong (Q22, Q24, S24); round 5 has 91 right and 1 partly as is (Q54 gives the path without saying
  Request handling uses Email for Expense anomaly finder only), and 90 right and 2 partly after fix (Q54, and Q48,
  which stopped at the 40-link cap of one listing). Median 9.1 s, max 30.8 s as is and 48.4 s after fix (Q48).
  pyshacl (with and without RDFS inference) and rdf-validate-shacl: conforms; `docs/sparql-examples.rq` gives the
  round-4 answers on the fixed copy. The practice workspace's graph is unchanged on restart and after fix.
- **Not done, said plainly:** the tool registry's resolver is still one per process; a hand-set confidence of 0.9
  still counts as confirmed at the threshold (said as `confirmedBy: threshold`); code running as the operator's account
  can sign a Do-it record; the UI's Confirm button confirms a fact for every idea it is read for (the API takes one
  idea); there is no OWL reasoner or SPARQL endpoint, only the export.

## 2026-10-31 (Café app, round 4: the build gates itself, one ontology per build, "not confirmed" everywhere, NetworkX that says what it cannot find, verifiable provenance)

A third adversarial retest scored the graph 7/10. Each fault it logged is now pinned by a test (`tests/kg-round4.test.ts`,
`tests/sparql-examples.test.ts`, and the ones they extend).

- **The build gates itself, whatever wrote the file.** It refuses, drops from the graph, names in `cafe ontology check`
  and shows in the banner: a `confirmedBy: operator` with no Do it recorded (the Do it now writes
  `graph/confirmations.jsonl`, and only it does), a confidence outside 0 to 1, a pending link counted as confirmed, an
  AI-made BUILT_WITH or Tool star, an operator remove of an idea, team or person and a rename of an idea or person, a
  KIND_OF self-loop or loop, an `entities.yaml` id whose prefix lies about its section, and an alias that makes a
  not-approved tool a name of an approved one. Someone who edits two files by hand can still forge a confirmation.
- **One ontology per build.** `rules/ontology.yaml` is compiled into a frozen value per build and passed to the rules,
  the check, the assistant's queries, the export and the actions; no shared table changes, so 120 concurrent builds of
  two workspaces each keep their own declarations (the round-3 race lost the Vendor kind in 10 of 120). Declared kinds
  code as `[Y1]` (never "undefined1"); a deadline's partial reply shows names; a broken settings file is said as itself.
- **"Not confirmed" everywhere.** A plain `follow` and a `rank` say which stated links they crossed or counted that wait
  for Do it; a dependency that holds for another idea only is said not to hold, per idea; the decision AI is sent
  `confirmed: false`; NetworkX suggests from confirmed links only; the export writes plain triples for confirmed facts
  only. The Request handling question now names Travel policy assistant's link as not confirmed.
- **NetworkX, honestly.** Clusters are read from shared capabilities and pain points (form choices, people and teams
  left out) with a modularity verdict (below 0.3: "no clear groups", said in the pop-out, the assistant and the stages;
  the practice workspace scores 0.20); cycles run only along relations the ontology lets loop (none in the built-in one,
  said so); paths keep off form-choice hubs; a system counts the ideas that depend on it. Both round-3 suggestions
  rested on unconfirmed links: there are none now. Centrality matches an independent NetworkX 3.7 on all 50 rows.
- **RDF and provenance.** SIMILAR_TO is `owl:SymmetricProperty` and written both ways; aliases are `skos:altLabel`; an AI
  link carries its quoted passage (checked against the idea's text, the source field moved to where the passage is) and
  when it was read; `docs/sparql-examples.rq` has the newcomer's queries with the app's answers; the assistant's new
  `links` step answers "which links did the operator add" and "where did this link come from". The registry wins over
  containment (Copilot is Microsoft Copilot, not Copilot Studio). pyshacl and rdf-validate-shacl: conforms, as is and
  after fix.
- **`cafe ontology fix`** corrects source fields (14 in the practice workspace), lists stale edits with the stars they
  could point to and changes them only with `--repoint op-N=STAR` or `--retire op-N`, and records a confirmation only
  with `--confirm line-N`. A capability fact proposed with the idea that needs it is stamped for that idea.
- **The 66 questions of the retest**, re-asked on fresh copies as is and after `fix --apply`: round 3 had 52 right, 7
  partly and 6 wrong of 65 answered; round 4 has 65 right and 1 partly as is, and 66 right after fix (one,
  q17, after the path trace fix). Median 10.1 s, max 34.5 s.
- **Not done, said plainly:** the tool registry's resolver (`canonicalTool`) is still one per process (one workspace
  per server is fine; a test that mixes workspaces must load each registry); clusters read unconfirmed links too (only
  suggestions are confirmed-only); the files are plain files, so two coordinated hand edits can still forge a
  confirmation; there is no OWL reasoner or SPARQL endpoint, only the export.

## 2026-10-31 (Café app: every route gated by the ontology, an open schema, RDF with its schema)

A second adversarial retest scored the graph 6/10. Each fault it logged is now pinned by a test
(`tests/kg-round3.test.ts`, `rdf-schema.test.ts`, and the ones they extend).

- **Every route is gated by the ontology, in the build.** A link "suggested by NetworkX" must be among NetworkX's
  current suggestions (NEEDS or USES_DATA only) and passes the same checks as the assistant's (`linkProposals`); its
  reason is NetworkX's own. Do it checks every card again. The build refuses, and `cafe ontology check` names: an
  operator `add` of an idea, round, person or tool; an operator SUBMITTED, LEADS, SPONSORS, BUILDS, RELATED, IN_ROUND
  or BUILT_WITH link; a merge of two kinds; an AI link whose source is empty or not an AI read. `/api/graph` lists each
  refusal; a banner over the universe shows them and any `ontology.yaml` or `inference.yaml` problem.
- **One threshold.** Answers (review updates) and the inbox plan AI links with `graph: confirmAt`, as reads do; the
  build counts a link below it as confirmed only when the operator's Do it confirmed it (`confirmedBy`).
- **One name, one star.** The id and the lookup key are one normal form (`nameKey`): entities decoded, "&", "+" and
  "and" alike, T&E, T/E, TandE and "Travel & Expenses" are Travel & Expense, e-mail is email, G.S.S. is GSS, a system's
  plural last word singular; people by exact name, accents kept. Older ids are read in the normal form; `cafe ontology
  fix` writes them so. The C6 name table is a test. "MS Copilot" and "Power App" are tool aliases.
- **Rules:** the main derivation is the same-idea one; SIMILAR_TO is confirmed when two shared stars are confirmed for
  both ideas. **Design:** two features of one pick that look alike are flagged. **Check:** an alias naming a
  not-approved tool, two stars with one name.
- **The assistant:** a `follow` over several hops keeps to the ideas each capability-level link is stated for. One
  deadline per answer (`assistant: { deadlineSeconds: 90 }`), with a clear message and the trace so far; an answer
  runs outside the server's write lock. The fifteen-minute answers were the Mac's idle "Maintenance Sleep" freezing
  the process (`pmset -g log` matches each one); every AI call now holds `caffeinate -i` while it runs. The 28
  questions of the retest answer in 7 to 22 s, the T&E one in 9.4 s.
- **Open schema.** `ontology.yaml` may declare a new kind (`Vendor`) and relation (from, to, meaning, derived); the
  rules may chain them; the check validates the declarations. `KIND_OF` (System → System): a mailbox that is a kind of
  Email counts as Email in the rules and in `follow`.
- **RDF with its schema.** `cafe export` writes an RDFS vocabulary and SHACL shapes beside the JSON-LD, at
  `export: { base }` (default `https://example.invalid/creators-cafe/`; vocabulary `…/ontology#`, stars `…/id/`).
  pyshacl and rdf-validate-shacl (new dev dependency, with n3) find zero violations in the practice workspace's export.
  A capability-level fact is a plain triple only where it holds for every idea; the per-idea `DEPENDS_ON` is plain, so
  a one-hop SPARQL query gives the app's answer and the two-hop path never reads a fact for an idea it is not true of.
- **NetworkX:** centrality and link prediction leave the form choices out by default (`--with-form-choices`); link
  prediction compares ideas by capabilities and pain points and capabilities by systems, two shared stars per peer and
  two peers per suggestion ("Key term extraction uses Team onboarding checklists" is gone).
- README, the X-ray page and x-ray.md say so.

## 2026-10-30 (Café app: the knowledge graph reasons per idea)

An adversarial test of the graph's reasoning found eleven faults; each is now pinned by a test that failed before
(`tests/kg-reasoning.test.ts`, `kg-check-fix.test.ts`, `kg-assistant.test.ts`, `jsonld-rdf.test.ts`).

- **Every fact knows which ideas it is stated for** (`ideas` on each stored link) and the rules scope by it.
  `needs+built_with` is same-idea: a tool picked in one idea's design is that idea's (Power Apps was "used by 6
  ideas", 5 false; Copilot Studio no longer leaks to the Procurement FAQ bot). `member+submitted` is same-idea-first:
  a team owns the ideas its record names (one submitter in GSS and BSI no longer makes both teams own both ideas).
  A capability-level link stated for no idea applies only to the ideas whose own facts confirm it.
- **Rules:** chains of any length; every way a link is derived is kept; `enabled: no/off/false/0` all switch a rule
  off; a broken `inference.yaml` is an error in the check and in `/api/graph`, never a silent fall-back.
- **Refused at build, named by `cafe ontology check`:** a derived relation stored by hand, an id whose prefix is not
  its type's, a kind the ontology does not know, AI links to unknown stars. AI links to a star the operator added are
  no longer dropped. The check also lists unscoped facts and AI links confirmed below the threshold.
- **`cafe ontology fix`** (dry run; `--apply`; `--stamp op-N=ID`) stamps unscoped edits with the ideas that confirm
  them, sends low-confidence auto-confirmed AI links back to waiting, switches off hand-stored derived relations and
  writes the rules' scopes out, previewing the derived links that come, go or wait.
- **AI links** below `graph: confirmAt` (default 0.7) wait for Do it; their source names the form field read;
  operator links are sourced `operator:<edit>@<date>`. An answer resting on an unconfirmed link says so.
- **The assistant** stamps every Capability → System link with its idea (one card per idea that needs the
  capability), refuses to "unlink" a derived link and offers the stored fact behind it instead, and never aliases a
  tool to another product (UiPath, Power Automate). Accepted NetworkX suggestions carry the idea they were suggested
  for. The decision suggestion reads the idea's own systems only.
- **Identity:** C++, C# and C are three stars; "&" and "and" resolve alike; categories and outcomes take aliases.
- **JSON-LD as RDF:** the default graph (a plain SPARQL query finds it), links as resources with node IRIs, PROV-O
  (`prov:wasDerivedFrom`, `prov:wasGeneratedBy`, `prov:generatedAtTime`); validated with jsonld and oxigraph.
- **CLI:** every command that reads a workspace stops with one line naming `--workspace` and `CAFE_WORKSPACE` when the
  folder is missing or not a workspace (`cafe network central` used to print "top 0").
- **Tests:** the intermittent `memory-assistant` failure was a race with automatic upkeep reading the seeded ideas;
  removed at its cause, five consecutive full runs green.
- README (*Knowledge graph*), the X-ray page and x-ray.md say so.

## 2026-10-30 (Café app: NetworkX analyses the graph, end to end)

- **The app builds the graph, NetworkX analyses it.** `cafe-app/py/network.py` reads the graph as node-link JSON and
  answers stats, central (betweenness and degree, per type), clusters (Louvain over the ideas joined by shared stars,
  with the binding stars), path (shortest paths with the link on each hop), isolated (components), suggest (link
  prediction with Adamic-Adar and Jaccard: a link most of an idea's closest peers have and it lacks, with the peers
  and shared stars) and cycles. Deterministic: fixed seeds, sorted output.
- **Vendored, no download.** The official wheels (NetworkX 3.7 for Python 3.12+, 3.2.1 for 3.9 to 3.11) ship in
  `cafe-app/vendor/networkx/` with `MANIFEST.json` (SHA-256, size, BSD-3-Clause) and `LICENCE-NOTICE.md`, imported
  from the zip and run with `python -I -S`: nothing installed is used, no numpy, no scipy.
- **Stored facts by default**, derived links with `--with-derived`, said in every output; NetworkX never writes the
  graph, and suggested links are proposals done only with Do it.
- **Everywhere:** `cafe network check|stats|central|clusters|path A B|isolated|suggest|cycles`, `GET /api/network`,
  `POST /api/network/propose`, the assistant's network step, the Network pop-out, the decision suggestion's network
  block and basis, the design duplicate check across ideas, the CSIC hand-off's `networkAnalysis` block, and
  `cafe export --format networkx` with `docs/networkx-example.py`.
- **Without Python 3.9+** each of these says so in one line and the rest of the app is unchanged.
- README (*Network analysis with NetworkX*), the X-ray page and x-ray.md (section 8 now "NetworkX for analysis, our
  own engine for building and reasoning", the packages table) say so.

## 2026-10-29 (Café app: Deep read's model ships with the repo)

- **No download, no import step.** `cafe-app/models/Xenova/all-MiniLM-L6-v2/` holds the four files Deep read's
  quantised load reads (`config.json`, `tokenizer.json`, `tokenizer_config.json`, `onnx/model_quantized.onnx`, about
  23 MB), with their SHA-256 and the download date in `cafe-app/models/MANIFEST.json` and the Apache-2.0 attribution
  in `LICENCE-NOTICE.md`. A fresh clone runs Deep read at once, and upkeep is armed from start-up.
- **Where the app looks, in order** (`src/memory/model.ts`, `placeModel`): `CAFE_MODEL_DIR` when set; `~/.cafe-ai/models`
  when it holds the four files; the folder shipped with the app when it does (found from the module's own path, so
  `npm run cafe` and the server find it from any workspace); otherwise `~/.cafe-ai/models` as the download target.
  The bundled folder is only ever read (a test loads the real model from it offline and checks the folder is
  unchanged); downloads and `cafe model import` go to `~/.cafe-ai/models` or `CAFE_MODEL_DIR`, never into the repo.
- **`cafe model status`** says `Folder: … (shipped with the app)`, `Source: bundled (<path>, <date>)` and whether the
  four files match the manifest (a corrupt clone is named); the pop-out footer says "on this machine (shipped with
  the app)". A test hashes the four files against `MANIFEST.json`, so a corrupt clone fails loudly.
- **The message** when the model is not here and cannot be downloaded now opens with "The model shipped with the app
  was not found at <path>" (or, with `CAFE_MODEL_DIR` set to a folder without it, that the shipped copy is not used
  while it is set), then the three ways in as before. Mirror, import, export and offline are unchanged.
- README (*Deep read*, *Behind a firm proxy*), the X-ray page (sections 1, 5 and 9) and x-ray.md say the model ships
  in the repo and the hub is used only when someone deletes it or sets a custom folder.

## 2026-10-28 (Café app: Deep read's model when the firm blocks the Hugging Face hub)

- **The hub has one job, and three stand-ins.** Deep read contacts `huggingface.co` only for the one-time download of
  the four model files (`config.json`, `tokenizer.json`, `tokenizer_config.json`, `onnx/model_quantized.onnx`) on the
  first Run. When the firm blocks it: `CAFE_MODEL_MIRROR` (or `deepRead.modelMirror` in `rules/settings.yaml`) points
  the download at an internal store that serves `<mirror>/Xenova/all-MiniLM-L6-v2/<file>`, with
  `CAFE_MODEL_MIRROR_TOKEN` as a bearer header on the mirror only, and never at the hub; `cafe model import
  <folder-or-zip>` copies a model folder or a zip of one into the model folder and checks the four files;
  `cafe model export <zip>` zips the cached folder for a colleague. `cafe model status` says where the folder is,
  whether the model is cached, its size, and its source (hub, mirror or import, recorded in `source.json`).
- **`CAFE_MODEL_OFFLINE=1`** (or `deepRead.offline`) never contacts any host: without the model a Run fails at once.
  The default stays as it was (a download is allowed).
- **One message the operator can act on.** When the model is not on this machine and cannot be downloaded (offline, the
  mirror or the hub unreachable, the download failing), the pop-out and the CLI show one message naming the three ways
  in, with the exact import command, the mirror setting, the four files and the folder; no stack trace. The pop-out's
  footer says whether the model came from an import or the mirror.
- README (*Behind a firm proxy*), the X-ray page and x-ray.md say the same.

## 2026-10-27 (Café app: what the 7.6/10 re-test found, fixed)

- **The reply is words from the steps, never the planner's note.** An answer with no reply is asked once more for the
  reply alone (no new steps); still empty, the app writes a plain reply from what the steps found, "From the graph:"
  in front. The step budget is said exactly ("This is step 2 of 5. After it you have 3 more steps"), and an answer
  that claims a step limit with steps left is sent back once. A reply naming a team no step returned is sent back once
  to follow OWNS. Steps not run (malformed, repeated, sent back) are in the trace with their words.
- **Queries.** `rank` counts distinct linked stars (of `type` when given) and keeps every star tied at the cut-off,
  so "who is on the most ideas" counts ideas, not links. An exact label or registry alias wins: "travel policy" starts
  from Travel & Expense policy only. `search … last: true` keeps to the ideas of the previous answer (past the global
  top), and for current process, challenge or impact reads each of those ideas' records, so every submitter is quoted
  (Deep read on or off). An intersect un-lights what it dropped. A derived link the reply names at both ends is never
  hidden behind "and N more".
- **Already there.** "Add a system T&E policy to Procurement FAQ bot" says "Already there: … depends on Travel &
  Expense policy (known as "T&E policy") through Policy question answering" when a capability of the idea already
  uses it.
- **Stale operator edits.** `cafe ontology check` lists edits pointing at stars the graph no longer holds under their
  own heading (exit 1 only with `--strict`), `/api/graph` lists them in `problems`; nothing is deleted. An edit made at
  a merged star's id follows the merge to the star kept.
- **Small.** An upkeep read shows as the last run in `/api/memory`; the operator's message shows as it was sent (only
  @-picked stars are chips), and a quoted name in a reply is not chipped.

## 2026-10-27 (Café app: Deep read arms itself; every chat edit shows in the universe)

- **Deep read arms itself.** Upkeep no longer waits for a first manual Run: once the model is on this machine (or the
  embedder is the fake one) and the switch is on, a changed idea is read even with no index yet, and at start-up,
  once the server is listening, the ideas not read yet are read in the background, just those ("read 2026-001 and
  2026-002 at start-up · 14 passages"); with every idea read start-up does nothing and writes nothing. Still never a
  download on the app's own initiative (the pop-out says "press Run once to download the model"), never a resumed
  pause, never another model's index. The switch is on by default and always shown.
- **Every chat edit shows in the universe.** Do it and Undo return `changed` (the stars and threads that are new,
  changed or gone, by comparing the graph before and after, derived links left out) with a line such as "Updated: Alex
  Wang → Lead on Procurement FAQ bot". The UI fetches the graph again, then pulses those stars and threads for about two
  seconds, as a selection's, with no change of selection and no camera move, and shows the line. The cause of "it does
  not update unless I reselect": the data was fresh at once, but a role added between two stars already linked drew a
  new thread exactly over the old one, in the same colour. Roles now have their own threads: lead gold and thicker,
  builder blue, sponsor rose, member dotted (per theme, static in Lite), with a legend row in the Show menu.

## 2026-10-27 (Café app: the assistant keeps both halves of a message, and follows a shared capability home)

- **A two-part message.** "Add X to [I1], then tell me which ideas depend on [S1]": the agent searches the question
  first and proposes with the answer in its own field (`answer`), kept apart from what it says about the change. When
  the change becomes a problem the reply is the answer first, then the problem lines, so nothing computed is thrown
  away and the card never contradicts the sentence above it; with a proposal the reply is the request, the answer,
  then the resolver's notes. A search identical to one already run for the message is not run again: the agent is
  told its result is in the steps, and the trace holds it once.
- **Shared capabilities.** `follow` gains `group: true`: the result lists, for each star of the set, the stars it
  reached, and the trace shows one line per group ("Policy Q&A: Travel policy assistant, Onboarding checklist
  helper"). The guide plans "a capability shared by GSS and BSI ideas, and which ideas" as one query (each side's
  ideas, NEEDS to capabilities, intersect, then NEEDS back to ideas grouped per capability) and answers per
  capability; `search` gains `last: true`, which keeps it to the ideas the previous answer found, for "what did each
  submitter say the current process is" once Deep read has run (one line that it has not read them yet, otherwise).
  The fake provider plans both the same way.

## 2026-10-26 (Café app: the graph becomes a knowledge graph)

- **The registry.** `rules/entities.yaml` (written by `init`, seeded with the approved tools and their aliases) gives
  stars a stable identity with aliases and an optional reference; every place a star is born resolves its label there
  first (form stars, extraction, the assistant's add and rename, the Import), ignoring case, spacing and accents. A
  merge records the merged label as an alias of the star kept, so the twin cannot return; the assistant gains
  `alias X as Y`; star details show "Also known as" and "Reference". With no file the graph is exactly as before.
- **Inference.** `rules/inference.yaml` (four rules, each switchable) runs as the last layer of every build and derives
  DEPENDS_ON, USES, OWNS and SIMILAR_TO, marked derived (dashed violet, `source: rule:<name>`, inputs named, the lowest
  confidence, confirmed only when every input is, left out of counts). `needs+uses_data` is scoped to the idea the data
  link was extracted for, the bug the simulation caught. Demand gains beams by system and by tool; the idea's
  Connections gain Similar ideas and a "changed since the AI last read it" line with Read again; the assistant follows
  and ranks over derived relations and its trace says what derived each link.
- **Incremental.** One bundle per idea cached by the record's hash and the registry's version, dropped on a Deep read
  touch; the operator log folded by appended lines; incremental equals full after every kind of change.
- **Ontology as data.** `rules/ontology.yaml` (types with label, colour and description; relations with from, to,
  meaning, inverse and derived) applied over the built-in ontology for the panels, the universe and the extraction
  prompt. `cafe ontology check` validates the files and the graph and prints violations, fixing nothing. JSON-LD
  export (`cafe export`, the assistant's "export graph [idea]") and `csic-handoff.jsonld` beside the hand-off. Spec:
  `docs/superpowers/specs/2026-10-26-cafe-knowledge-graph-design.md`.

## 2026-10-26 (Café app: Deep read keeps itself current)

- **Deep read upkeep.** After the first Run the index keeps itself current, piece by piece and deliberately: every
  change (an Import, a save, a design, an email, the roadshow, the hand-off, a history line) goes through one pure
  `decide()` whose reason is kept and shown ("Last: read 2026-003 after Import · 3 passages", "Last: skipped, nothing
  changed"). Never before the first Run, never while paused, queued behind a running read, only the changed passages
  of the touched ideas, bursts coalesced (5 s quiet, 30 s cap), never in the operator's way, a failure deferred once,
  another model's index left alone, a renamed or merged star refreshes labels only. A per-workspace switch
  (`rules/settings.yaml` → `deepRead.upkeep`) in the pop-out; no new approval step.
- **The pop-out is a dashboard:** Read · Changed since · Not yet tiles with shares, "passages to go: N (NN %)", bars
  by kind, a table of every idea (status, passages, kinds still to read, last read; not yet first) with filter chips
  and a search, a row opening the idea; a dot on the title-bar pill when anything is changed since or not yet.
- **The assistant** is told where Deep read stands (on, % read, ideas changed since, last read), searches what people
  wrote only for questions about what they wrote, and names a stale idea in the trace. Spec:
  `docs/superpowers/specs/2026-10-26-cafe-deep-read-upkeep-design.md`.

## 2026-10-26 (Café app: Deep read)

- **Deep read**, a local long-term memory for the Creators' Café app, as an add-on: a title-bar button with a
  progress ring opens a pop-out (what has been read, by kind and by idea; Run · Pause · Continue · Rerun all; why,
  what happens without it, what it reads, privacy). A second, local model (Transformers.js, all-MiniLM-L6-v2,
  downloaded once into `~/.cafe-ai/models`, `CAFE_MODEL_DIR` to move it) reads every idea folder into passages kept in
  `data/memory/`. With an index the assistant gains `search` and `similar` steps and a nearest-label fallback, the
  ideas panel finds by meaning, and extraction reuses the nearest existing star or holds a near one with the existing
  near-duplicate rule. With no index every path behaves exactly as before. `CAFE_EMBED_FAKE=1` stubs the model for
  tests. Spec: `docs/superpowers/specs/2026-10-26-cafe-deep-read-design.md`.

## 2026-10-25 (Copilot Studio agent removed)

- The Copilot Studio agent package is gone: `COPILOT-STUDIO-AGENT.md`,
  `copilot-studio-github-agent/`, `scripts/build-github-agent.sh` and
  `scripts/build.sh`. The skills install for Claude Code and GitHub Copilot with
  `scripts/install-local.sh`; the scenarios run in any chat with them installed.

## 2026-10-14 (Café link)

- The Creators' Café page link, http://cscreatorscafe/ (firm network), is now
  in the Café skill and the start-here reference; the agent gives it for
  "where's the Café page", submissions and "was mine selected?". The form
  link, deadline and design-series dates are still to come from TTIA.

## 2026-10-14 (map, single package)

- **Start-here map shown on request.** The Café reference now has a text
  version of the "How I want to use & Build AI" diagram, posted as-is when
  someone asks to see the map, followed by the link to the original,
  http://ttia-ai-diagram/ (firm network; the agent cannot open it). Scenario
  0j added.
- **Standard agent removed.** `copilot-studio-standard-agent/` and
  `scripts/build-standard-agent.sh` are gone; the GitHub Copilot harness is
  the only Copilot Studio package. Docs, build and scenarios updated
  (12b removed).

## 2026-10-14 (round 4 test fixes)

- **Dead end closed:** a Café idea that needs a live non-Microsoft system, or
  personal or client data, can now hand forward to CSIC once the user says in
  their own words what to build, even if the Café suggested it.
- **Small team-local builds:** the agent offers the CSIC Repository or the
  Café (KEEP AS A CAFÉ PATTERN), and the user chooses.
- **CSIC:** the remaining form fields are asked before the verdict, so a
  required field left UNKNOWN makes the case NOT READY instead of READY. The
  requester, the MD sponsor and the data are confirmed at every stage before
  they can block. A user who leaves for the Café midway gets the verdict as
  it stands. Resuming also asks for audience and pathway.
- **Value story:** a live initiative that never went through CSIC still gets
  its value story; CSIC comes in only for "who owns it". An after figure with
  no before is measured as a level, with no improvement claimed.
  "Nothing live yet" also offers the Café on the standard agent.
- **Assignments:** a value case or value story ends with its closing line,
  then one assignment line, in the same message.
- **Standard agent:** lists all seven Café routes, offers the Café after a
  productivity question, and gives no licence price inside the Café
  (7,908 characters).
- Scenarios 14-19 added.
- **Re-check fixes:** the GitHub instructions also offer both levels for
  team-local builds, and resume there asks for audience and pathway. A user
  who quits CSIC for the Café stays in the Café in that conversation, and
  questions not yet asked are listed as such rather than as blockers. From
  "approved" on, CSIC asks whether the pathway owner has accepted. Resuming
  re-checks the pathway against the data and audience. The CSIC value case
  ends with one assignment line. Route names are spelled the same everywhere.

## 2026-10-14 (later) — three levels, forward only

- **Three skills, three levels.** `ms-cs-ttia-creators-cafe` (find the right
  solution, never measures value), `ms-cs-ttia-csic-repository` (renamed from
  `ms-cs-ttia-office-hours`; identify and measure the AI ROI),
  `ms-cs-ttia-value-story` (renamed from `ms-cs-ttia-value-report`; what a
  live initiative actually delivered). Delete the old skills from Copilot
  Studio before uploading the new zips.
- **New routing test.** "Do you know what you want built and roughly how, who
  would use it, and what you expect it to change?" All three: CSIC
  Repository. Any missing: Café. Sponsorship and stage labels are no longer
  the test.
- **Forward only.** Fixes the dead end where the Café and intake sent the same
  item back and forth. The CSIC Repository never hands back; a missing
  sponsor is a blocker. NOT AN INITIATIVE YET ends with an assignment to the
  Café, not a handoff. The value story never restarts intake.
- **Proof of concept with users, no CSIC record** now has a home: the CSIC
  Repository, as a pilot proposal.
- **Resume rule** in both instruction files and all three skills: memory is
  off, so ask for the last sheet, and if they do not have it re-ask only what
  the level needs.
- **CSIC Repository:** an explicit order for the whole conversation, so the
  measure, five cards and alternatives are always reached; the user chooses
  the value driver; a remaining-fields step before the sheet (FWAI theme is
  picked from the form); READY at proposal no longer needs an accepted
  owner (carry-over risk instead); personal data rules out Citizen-Led and
  Assisted Citizen even as an extract; firm disqualifiers cannot be
  escalated; a blocker type for escalations and a place to raise them.
- **Café:** licence and access questions go to Tech Governance & Enablement;
  unlisted tools are "not on the approved list"; the user writes the two
  submission sentences; the Café page and its button are named; the
  start-here map reference is read explicitly.
- **Value story:** starts from the claim; asks whether the system holds
  history from before go-live before declaring a claim unevidenceable.
- **Standard agent:** instructions rewritten around the three levels (about
  7,100 characters); knowledge file 05 defers to 07 for the value case
  layout; the build no longer turns "this skill" into "this agent".
- Test scenarios rewritten for routing (0a–3e) and added for the dead ends
  (5b, 5c, 11, 13b, 13c).
- **Second test round fixes.** The routing test is applied once, at entry, so
  a well-sharpened Café idea can still reach SUBMIT TO THE CAFÉ. The Café
  hands forward on outgrowth only when the user can say what they want built,
  closing the last Café/CSIC loop; a business case for an undefined idea
  stays in the Café. A user may choose the Café after being told once why
  CSIC fits. New Café routes: KEEP AS A CAFÉ PATTERN, STOP KEEP THE LEARNING,
  and REUSE for an approved tool they lack access to. A handoff is not a
  closing message. CSIC: baseline owner is a hard blocker everywhere; the
  data question is on the proposal bar; the sponsor must be an MD who has
  agreed; OPPORTUNITY DESCRIPTION is asked for and three dropdowns are
  confirmed; an ownership escalation at proposal goes alongside a READY
  sheet; a de-identified extract can reopen Citizen-Led; a Café proof of
  concept is a stage; resume asks the level first and continues from the
  measure. Value story: pasted figures count as evidence. Scenarios 0g–0i
  and 13d added; 0c updated.

## 2026-10-14

- **Creators' Café skill.** New `skills/ms-cs-ttia-creators-cafe/` for the CS
  TTIA Creators' Café, the Corporate Services Advanced AI Community of
  Practice: the start-here map, Café vs TTIA CSIC Repository, the four Café
  stages (Submit Idea, Review and Select, Design series, Launch and Learn),
  tools and pathways at Café depth, and a route instead of a verdict. Ships
  as a third zip for the GitHub Copilot harness agent and as knowledge file
  `08-creators-cafe.md` for the standard agent.
- **Idea stage goes to the Café.** Intake now starts at proposal. The stage
  question sends "idea" to the Café skill and "NOT AN INITIATIVE YET" does
  the same. The test between the two is the map's: defined, validated and
  sponsored.
- **Start-here map ingested** as
  `skills/ms-cs-ttia-creators-cafe/references/how-to-start-ai.md`: approved
  productivity tools, the two doors for a new idea, programs (CS TTIA, CS AI
  Ambassadors, CS Evolve) and learning (AIDP, DeepLearning.AI, MS Employee
  Development).
- **Tool lists aligned to the map.** Dataiku and UiPath now sit on Citizen-Led
  and Assisted Citizen as well as TTIA-Led; the custom app is TTIA-Led only.
  Flagged in the README for TTIA to confirm.
- Both `agent-instructions.md` files route three ways; the standard-agent
  one was trimmed to stay under 8,000 characters. Test scenarios 0a to 0f
  and 3b added for the Café.

## 2026-09-30

- **Value story chat layout.** New `references/value-story-chat.md` gives the
  exact markdown layout for the value case and the value report; generated as
  knowledge file `07-value-story.md` for the standard agent, which cannot make
  files. "Value story" and "business case" are now explicitly in scope.
- **CSLab wording removed**; TTIA-Led is delivered by automator pods.

- **Five pathways.** Tech-Led (was Pro-Dev), Partnered Development, TTIA-Led,
  **Assisted Citizen (new)**, Citizen-Led. The disqualifier test now has four
  steps and runs from the bottom of the ladder up. Every table, the form's
  "alongside the sheet" block and the standard-agent instructions updated.
- **TTIA team ingested.** Correct name (CS Technology Transformation,
  **Innovation** & Analytics), partners (GSS, CSI, CBS, RES) and the five
  pillars with their remits. New `references/ttia-team.md` in the intake skill
  and a generated `00-ttia-team.md` knowledge file for the standard agent.
- **Test scenarios** 4b–4e added: Assisted Citizen routing and misuse, old
  pathway names, team routing.
- **`scripts/install-local.sh`** installs the skills for Claude Code, GitHub
  Copilot in VS Code and Copilot CLI.

## 2026-09-29

- Split into two Copilot Studio packages (GitHub Copilot harness, standard).
- Initial skills: `ms-cs-ttia-office-hours`, `ms-cs-ttia-value-report`.
