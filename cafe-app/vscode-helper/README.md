# Creators' Café AI helper (VS Code)

A tiny VS Code extension that lets the local Creators' Café app ask the GitHub Copilot model you are already signed in to for suggestions (extract graph links, suggest a review). The app still checks every answer against a schema and saves nothing without the operator's Yes.

## Install

1. In this folder run `npx @vscode/vsce package` (accept the missing-repository prompts), then in VS Code open Extensions, the `...` menu, **Install from VSIX...** and pick the `.vsix`.
2. Or, without packaging: run **Developer: Install Extension from Location...** and pick this `vscode-helper` folder.

Reload VS Code. Run **Creators' Café: AI helper status** to see the port, the model and whether the helper file exists. VS Code may ask once to allow the extension to use language models.

## How the app finds it

On start the extension listens on `127.0.0.1` (random port) and writes `~/.cafe-ai/vscode-helper.json` as `{ port, token, model }` (file mode 0600). The Café app reads that file, calls `GET /health`, and sends `POST /complete` with the `x-cafe-token` header and `{ "prompt": "..." }`; the reply is `{ "text": "..." }`. The file is removed when the extension stops. If VS Code is closed, the app works by hand as before.

## Security notes

- Localhost only: binds 127.0.0.1, refuses non-loopback peers and any Host header other than localhost or 127.0.0.1.
- A fresh 32-byte random token per run, compared in constant time; wrong token gives 403. Bodies over 200 KB give 413.
- It sends the prompt text to the model and returns the text. It never reads workspace files, never runs commands, and gives the model no tools.

## Open question

Does the firm approve using the Copilot language-model API from an extension, and sending Café submission text to the Copilot model? Until that is confirmed, treat this helper as optional and off by default; the app works without it.
