# The model shipped with the app

`Xenova/all-MiniLM-L6-v2` is an ONNX conversion (by Xenova, for Transformers.js) of
`sentence-transformers/all-MiniLM-L6-v2`, a sentence-embedding model trained by the Sentence-Transformers project
(Nils Reimers and contributors) on top of Microsoft's MiniLM. Both the original model and the conversion are
published under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0

Model cards: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 and
https://huggingface.co/Xenova/all-MiniLM-L6-v2

Only the four files the app's quantised load reads are here (`config.json`, `tokenizer.json`,
`tokenizer_config.json`, `onnx/model_quantized.onnx`); `MANIFEST.json` records their SHA-256 and the download date.
The files are unmodified. The app reads this folder and never writes to it.
