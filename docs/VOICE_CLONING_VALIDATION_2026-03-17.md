# Voice Cloning Validation - 2026-03-17

## Etat local confirme

- Le runtime principal sait deja basculer vers XTTS-v2 quand un sample voix existe: `apps/api/src/ws-multimodal.ts`.
- L'upload et le statut des samples voix existent deja cote admin: `apps/api/src/routes/personas.ts`, `apps/web/src/api.ts`, `apps/web/src/components/PersonaDetail.tsx`.
- Le repo contient deja les scripts XTTS `scripts/tts_clone_voice.py` et `scripts/xtts_clone.py`, plus le fallback Piper `scripts/tts_synthesize.py`.
- Le helper `apps/api/src/voice-samples.ts` unifie maintenant la resolution du nom de fichier entre upload admin et runtime TTS.
- Le health check `scripts/health-voice-clone.sh` fournit un probe non destructif des deps XTTS et des samples.

## Etat machine observe

- `npm run -s smoke:voice-clone` passe et sonde maintenant le meme interpreteur que le runtime API.
- Le runtime local `.venvs/voice-clone` est provisionne en `python3.12` avec `torch`, `coqui-tts`, `piper-tts` et `transformers<5`.
- `scripts/generate-voice-samples.js` consomme maintenant le roster canonique de `apps/api/src/personas-default.ts` et le meme contrat de nommage que le runtime.
- `data/voice-samples/pharmacius.wav` a ete genere avec Piper, et `data/piper-voices/fr_FR-gilles-low.onnx` est present localement.
- Sur `kxkm-ai`, `ffmpeg` est present, `bash scripts/health-voice-clone.sh --json --verbose` remonte `torch=true`, `tts=true`, `piper_module=true`, `coqui_tos_agreed=true`, `cuda=true` et `persona_sample_present=true`.
- Le smoke XTTS non interactif passe maintenant sur `kxkm-ai` avec `COQUI_TOS_AGREED=1 bash scripts/setup-voice-clone.sh all --persona pharmacius --yes --verbose`, et produit un rendu audio valide via `scripts/tts_clone_voice.py`.

## Commandes utiles

- `npm run -s smoke:voice-clone`
- `bash scripts/health-voice-clone.sh --json --verbose`
- `bash scripts/setup-voice-clone.sh bootstrap --yes`
- `bash scripts/setup-voice-clone.sh sample --persona pharmacius --yes`
- `COQUI_TOS_AGREED=1 bash scripts/setup-voice-clone.sh smoke --persona pharmacius --yes`
- `node scripts/generate-voice-samples.js --dry-run --persona SunRa`

## Decision actuelle

1. Garder Piper comme fallback immediat.
2. Considerer le runtime XTTS comme valide sur `kxkm-ai`, avec garde-fous scripts, sample local valide et smoke final vert sous `COQUI_TOS_AGREED=1`.
3. Fermer `voice-cloning-validation` et `lot-13-voice-mcp`; garder Piper comme voie de repli operationnelle.

## Sources officielles

- Coqui XTTS-v2 model card: https://huggingface.co/coqui/XTTS-v2
- Coqui TTS repository: https://github.com/coqui-ai/TTS
- Coqui XTTS streaming server note on `COQUI_TOS_AGREED=1`: https://github.com/coqui-ai/xtts-streaming-server
