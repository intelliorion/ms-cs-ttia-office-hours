# Creators' Café AI helper (VS Code)

A tiny VS Code extension that lets the local Creators' Café app ask the GitHub Copilot model you are already signed in to for suggestions (extract graph links, suggest a review). The app still checks every answer against a schema and saves nothing without the operator's Yes.

## Install

1. In this folder run `npx @vscode/vsce package` (accept the missing-repository prompts), then in VS Code open Extensions, the `...` menu, **Install from VSIX...** and pick the `.vsix`.
2. Or, without packaging: run **Developer: Install Extension from Location...** and pick this `vscode-helper` folder.

Reload VS Code. Run **Creators' Café: AI helper status** to see the port, the model and whether the helper file exists. VS Code may ask once to allow the extension to use language models.

## How the app finds it

On start the extension listens on `127.0.0.1` (random port) and writes `~/.cafe-ai/vscode-helper.json` as `{ port, token, model }` (file mode 0600). The Café app reads that file, calls `GET /health` (200 `{ ok: true, model, vendor }`, or 503 `{ ok: false, reason }` when no model is available), and sends `POST /complete` with the `x-cafe-token` header and `{ "prompt": "..." }`; the reply is `{ "text": "..." }`. The file is removed when the extension stops. If VS Code is closed, the app works by hand as before.

## Security notes

- Localhost only: binds 127.0.0.1, refuses non-loopback peers and any Host header other than localhost, 127.0.0.1 or [::1].
- A fresh 32-byte random token per run, compared in constant time; wrong token gives 403. Bodies over 200 KB give 413.
- It sends the prompt text to the model and returns the text. It never reads workspace files, never runs commands, and gives the model no tools.

## Open question

Does the firm approve using the Copilot language-model API from an extension, and sending Café submission text to the Copilot model? Until that is confirmed, do not install it on firm machines. Once installed it starts automatically whenever VS Code starts (`onStartupFinished`) and writes the token file; to stop it, disable or uninstall the extension (the file is removed when it stops). The app works without it.

## Integration test (real VS Code extension host)

`lib.js` has unit tests in the root suite. To run the extension itself inside a real VS Code:

```
cd cafe-app/vscode-helper && npm install && npm run test:vscode
```

This downloads a stable VS Code (about 300 MB, once) into a cache folder, never into your own VS Code, and uses throwaway user-data and extension folders. The helper file goes to a temp folder via the `CAFE_AI_HELPER_DIR` override (honoured by `extension.js` only when set), so `~/.cafe-ai` is never touched. A VS Code window may flash; xvfb is not needed on macOS. Set `CAFE_VSCODE_TEST_DIR` to move the cache.

It proves: the extension activates; `vscode-helper.json` appears with `{port, token, model}` (mode 0600); `GET /health` answers (200 with a model, else 503 with a reason); a wrong token gives 403; a right token with no model gives 503; a foreign Host header gives 403; the status command runs; deactivating removes the file and stops the server.

It cannot prove a real Copilot completion: the test host has no signed-in Copilot, so the model-present path (`/complete` returning text) is not exercised. Check that by hand in your own VS Code.
