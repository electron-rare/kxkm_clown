# Voice / MCP Spike - 2026-03-17

## Etat local confirme

- `apps/web/src/components/VoiceChat.tsx` est un chat vocal browser-side base sur `MediaRecorder`, `WebSocket` et un flux upload STT.
- `apps/api/src/ws-multimodal.ts` fournit deja le TTS, la synthese vocale par persona et les garde-fous de concurrence.
- `scripts/discord-voice.js` est un rail voice externe distinct, centre Discord, STT Python et TTS Python.
- `scripts/mcp-server.js` utilise maintenant le SDK MCP officiel sur stdio.
- `@modelcontextprotocol/sdk` est actif dans le runtime local et valide par smoke autonome.
- Aucun paquet `@livekit/*` n'est installe dans le workspace pour l'instant.

## Gaps reels

- Pas de runtime LiveKit agent dans le repo.
- Pas de transport browser WebRTC/room/agent pour remplacer le chat vocal WebSocket.
- Pas de health check dedicated pour valider le serveur MCP local de maniere autonome.

## Recommandation minimale

1. Garder `VoiceChat` comme experience browser actuelle tant que le spike LiveKit n'a pas montre un vrai gain.
2. Introduire un agent LiveKit dans un script adjoint seulement apres preuve de valeur, sans toucher au chat WebSocket principal.
3. Conserver le serveur MCP sur le SDK officiel et garder le smoke stdio comme garde-fou de protocole.
4. N'ajouter LiveKit/voice-cloning qu'apres validation d'un vrai besoin runtime.

## Commandes utiles

- `node scripts/mcp-server-smoke.js`
- `node scripts/mcp-server-smoke.js --with-tool-call`
- `node scripts/mcp-server.js`
- `npm run smoke:voice-mcp`

## Etat machine observe

- Le smoke MCP valide `initialize` + `tools/list` sans API locale demarree, avec le SDK officiel.
- Le `tools/call` peut etre force avec `--with-tool-call`, mais il depend alors de `KXKM_API_URL`.

## Sources officielles

- LiveKit Agents JS: https://github.com/livekit/agents-js
- LiveKit Agents docs: https://docs.livekit.io/agents/
- MCP SDK officiel: https://github.com/modelcontextprotocol/typescript-sdk
- MCP SDK docs: https://modelcontextprotocol.io/docs/sdk
