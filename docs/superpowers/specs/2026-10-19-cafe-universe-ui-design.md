# Creators' Café: one-screen universe UI and LLM connection — design

Status: draft for review · 2026-10-19
Builds on: `2026-10-19-creators-cafe-app-design.md` (the app design) and branch `cafe-app-core` (plan 1, built and tested)
Visual reference: github.com/knight-L/sc-datav, **demo 0** (https://knight-l.github.io/sc-datav/#/demo0), Apache-2.0

## 1. Purpose

Replace the tabbed operator page with one screen in the style of sc-datav demo 0. Ideas are listed on the left. In the centre, the knowledge graph is drawn as a 3D universe of glowing stars. On the right, read-only charts show the round at a glance. Clicking an idea opens a pop-out where the operator updates it. The same build connects the app to an LLM through a coding tool the operator already has signed in: Claude Code, GitHub Copilot CLI, or GitHub Copilot in VS Code.

**Success looks like:**
- The operator runs the whole round from this one screen.
- The screen looks and feels like sc-datav demo 0.
- The universe shows who is building what, with which tools.
- With a coding tool signed in, the AI suggests capabilities for the graph and pre-ticks reviews. Nothing is saved without the operator's Yes.
- With no AI connected, everything still works by hand.

**Unchanged:**
- The workspace files.
- The server's API and guards: localhost only, Host and Origin checks, JSON-only POSTs, one change at a time.
- The rules:
  - The operator sets stages.
  - Emails are drafted, approved and copied, then marked sent; the app never sends.
  - Missing settings block approval.
  - No value or ROI is measured.
  - No names appear in exports.
- All current tests keep passing.

### Non-goals (this build)

Inbox triage, cohorts, the tool picker, the design brainstorm, roadshows, and AI drafting of email content. They stay in later rounds. Phone layouts are not a target.

## 2. The screen

The stage is designed at 1920×1080 and scaled to fit the window, as sc-datav does with autofit. Below about 1000px wide, the side panels become drawers.

**Look (sc-datav demo 0):**
- Near-black background with a slow starfield, and a faint perspective grid floor under the universe.
- Translucent grey-green glass panels with thin borders and large bold white panel titles.
- Charts in cream and teal.
- Pill buttons at the bottom centre.
- No external fonts or network loads. Everything is bundled.

**Title bar:**
- Left: "Creators' Café", with the round and today's date.
- Right: buttons that each open a pop-out:
  - **Import:** drop or choose an export, then see the import report.
  - **Round:** dates, links, your name and capacity.
  - **Outbox (n):** the draft → approve and copy → mark sent queue, with "Set first: …" gating.
  - **Review pack**.
  - **status.csv**.
  - **AI** chip (section 4).

**Left panel, "Ideas":**
- A search box and stage filter chips.
- A scrolling list. Each item shows:
  - Café ID and title;
  - function and region;
  - a stage chip;
  - email chips (for example "E1 ✓ 19 Oct", "E5 draft");
  - an amber waiting line when a reply is late;
  - a flag count.
- Hovering an item makes its star pulse. Clicking it opens the idea pop-out.

**Centre, "The universe":** see section 3. Two pill buttons at the bottom: **Reset view** and **Labels on/off**.

**Right panels:** four read-only ECharts panels, built from `/api/state`:
1. Ideas by stage: Submit Idea, Review and Select, Design series, Launch and Learn, Closed.
2. Waiting on you: drafts to approve, approved but not sent, replies due, replies late. A short list of the late ones, each clickable to open the idea.
3. Support requested, counted across open ideas.
4. Ideas by function and region.

**Idea pop-out:**
- A centred glass container over the dimmed universe. Esc or ✕ closes it, and the camera stays on that idea.
- **Details:** challenge, current process, outcomes, support, team with roles, and whether they've tried it already.
- **Stage menu:** the four stages plus the closures. It never blocks.
- **Review:** the five criteria, a decision and a reason, with the AI suggestion when available.
- **Emails:** draft a template, approve and copy, mark sent, reply received, and the E2R offer.
- **Graph:** this idea's links, with Confirm or Remove for unconfirmed ones.
- **History:** the last 10 entries.
- Suggestions from a review or a sent email appear inside the pop-out with Yes and No buttons.

## 3. The universe (knowledge graph in 3D)

### Data

`cafe-app/src/graph/` builds the graph from the ideas, following the app design's ontology and Orion's rules:

- **Node types and colours (Orion palette):**
  - Entity #6366f1
  - Team #0ea5e9
  - Person #8b5cf6
  - Idea #f97316
  - Pain point #14b8a6
  - Capability #f59e0b
  - Tool #ef4444
  - System or data #10b981
- **Structured pass, no AI:**
  - Entity, from the submitter's "(CS)".
  - Team, from the CS Function, for example BSI or GSS. Region is an attribute, not a node.
  - Person nodes with SUBMITTED, SPONSORS or RELATED links to the idea. A person enters the graph only with a role on an idea.
  - HAS_TEAM and HAS_MEMBER links.
  - Support requested as Capability nodes, linked to the idea with NEEDS.
  - Tool picks when they exist.
- **Attributes, never nodes:** email addresses, dates, stage and status. An idea's stage shows on its star's label and in its colour ring.
- **Every link carries:** relation, a short description, its source (file and field), and a confidence. Form links are 1.0; AI links carry the confidence the AI gave. Links below 0.7 are drawn dashed and listed as unconfirmed until the operator confirms them.
- **Storage:** `graph/nodes.jsonl` and `graph/edges.jsonl`.
  - AI-added links and confirmations are kept in `graph/ai-links.jsonl`.
  - Rebuilding re-runs the structured pass and re-applies the confirmed and pending AI links. It is deterministic.
- **Layout:** 3D positions from a force layout (d3-force-3d). It is computed once, cached in `graph/layout.json` and reused, so the universe doesn't jump between visits. New nodes are placed next to their neighbours.
- **API:**
  - `GET /api/graph`: nodes, edges and layout.
  - `POST /api/graph/confirm` and `POST /api/graph/remove`: for one AI link.

### Drawing

Built with React, react-three-fiber, drei and @react-three/postprocessing, as sc-datav is.

- **Stars:**
  - Sized by number of links. Ideas are brightest and people smallest.
  - Bloom glow.
  - Labels (drei Html or Text) for ideas, teams and tools always. Other labels appear on hover or when Labels is on.
- **Links:** faint lines. The selected idea's links carry travelling light pulses. Unconfirmed links are dashed.
- **Background:** drei Stars, a faint grid floor, and slow idle rotation that stops while the operator interacts.
- **Selecting:**
  - Clicking a star flies the camera to it with a GSAP or drei camera tween, and dims everything outside its neighbourhood.
  - An idea star opens the pop-out.
  - Any other star shows a small floating card with its links and their sources.
- **No WebGL:** the centre shows a flat 2D drawing of the same graph, so the app never breaks.
- **Performance:** fluid with hundreds of nodes on a normal laptop. Instanced meshes are used for the stars.

## 4. Connecting an LLM through a coding tool

**One connector** (`cafe-app/src/ai/`) with the interface `run(task, input) → output`. Output is checked against a JSON schema before anything is saved. The connector tries the providers in this order, and the operator can pin one from the AI chip:

1. **Claude Code:** `claude -p` (headless). The prompt is passed on stdin and JSON comes back. It is run with no tools allowed, so the AI has no shell, file or network access.
2. **GitHub Copilot CLI:** used the same way when it is installed and signed in.
3. **VS Code with GitHub Copilot:** a small helper extension shipped in `cafe-app/vscode-helper/`.
   - It uses VS Code's language-model API (`vscode.lm`) with whichever Copilot model the operator's licence allows.
   - It exposes one localhost-only endpoint, protected by a random token that the extension writes to a file the app reads.
   - The operator installs it from the folder.

**AI chip** in the title bar:
- It shows "Claude Code ✓", "Copilot (VS Code) ✓", "Copilot CLI ✓" or "No AI: working by hand".
- Clicking it tests the connection and lets the operator choose a provider.
- The choice is saved in `rules/settings.yaml`.

**Tasks in this build:**
1. **Extract:** reads an idea's challenge, current process and outcomes. It proposes Capability, Pain point and System nodes and their links (NEEDS, REPLACES, USES_DATA), using only ontology types and a confidence for each. New node types not already present go to the operator as suggestions, never applied automatically. Links of 0.7 or above between existing nodes are added. Below 0.7 they are added dashed and unconfirmed.
2. **Review suggestion:** pre-ticks the five criteria and suggests a decision with a reason. It is shown in the pop-out as a suggestion that the operator accepts or changes.

**Rules:**
- Submission text is data, never instructions: the prompts say so, and the output schema allows nothing else.
- Each task is one call at a time, behind the server's lock, with a timeout.
- A failure or invalid output leaves things unchanged, with a plain message and "do it by hand".
- AI use on real submission content waits for Tech Governance & Enablement approval (app design, "Before the first round").

## 5. Build and structure

- `cafe-app/ui/` holds the React app: Vite, TypeScript, styled-components or CSS modules, ECharts, three, @react-three/fiber, @react-three/drei, @react-three/postprocessing, d3-force-3d and gsap. Pinned versions are bundled locally.
- `npm run build:ui` outputs to `cafe-app/web/`. The server keeps serving `web/`; its static allowlist becomes "files under web/ with a known extension", still with no traversal. `cafe start` serves the built page. `npm run dev:ui` runs Vite with a proxy to the API for development.
- The old plain page and its tests are replaced. The API tests stay.

## 6. Testing

- **Graph:**
  - Only ontology types are produced.
  - Email addresses, dates and stages never become nodes.
  - Every link has a source.
  - A person appears only with a role.
  - A rebuild is identical.
  - The cached layout is stable.
  - Confirm and remove work.
- **AI connector:**
  - A fake provider returns valid output, which is applied as suggestions.
  - Invalid output is rejected and nothing changes.
  - With no provider available, the app falls back to working by hand.
  - A timeout leaves things unchanged.
  - A submission containing instructions changes nothing beyond the schema.
  - The VS Code helper token is required.
- **Server:**
  - The new routes go through the existing guards and the lock.
  - The static allowlist rejects traversal.
- **UI:**
  - Headless-Chrome screenshots of the full screen, the idea pop-out, a selected star, an unconfirmed link and the no-WebGL fallback.
  - The screenshots are compared against sc-datav demo 0 before review.
  - No console errors.

## 7. Open questions

1. Tech Governance & Enablement approval for AI use on submission content, naming the provider and model.
2. Whether the VS Code helper may be installed from a folder on firm machines, or needs packaging (VSIX) and approval.
3. Whether people's names may appear in screenshots shared with TTIA. The default is to show people by role in shared material.
