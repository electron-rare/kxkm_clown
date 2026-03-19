# Timing & Ordering Recommendations (2026-03-19)

## Context
Analyse des patterns de timing pour les pipelines LLM + TTS + music gen + image gen en temps reel.

## Recommandations

### P1 — Sentence-boundary TTS chunking
Au lieu d'attendre la reponse complete avant TTS, decoupe en phrases pendant le streaming.
Latence percue: 6s → 1s avec Piper, ~1.5s avec Chatterbox.

### P1 — Placeholder-then-resolve pour tasks longues
Envoyer media_pending immediatement, puis media_ready quand le resultat est pret.
Pattern valide par ChatGPT, Midjourney, Discord bots.

### P2 — Sequence numbers WS (seq + replyTo)
Garantir l'ordre d'affichage cote client. Attacher audio/image au bon message via replyTo.

### P2 — Async handler ordering guard  
Promise chain sur ws.on(message) pour eviter le reordonnement des messages async.

### P2 — Per-persona task queues
Remplacer le mutex global TTS par des queues per-persona avec concurrence bornee.
TTS et image gen peuvent tourner en parallele (ressources GPU differentes).

### P3 — Protocol enrichi
Types: message_chunk, media_pending, media_ready, media_error.
Client affiche skeleton loader pour pending, swap sur ready.

## Latences cibles (RTX 4090)

| Pipeline | Cible |
|----------|-------|
| Ollama TTFB | 200-500ms |
| Piper TTS/phrase | 200-400ms |
| Chatterbox first chunk | ~470ms |
| ACE-Step 1 min musique | ~2-5s |
| Total texte+audio percu | <2s |

## Sources
- Pipecat, LLMVoX (sentence chunking)
- ACE-Step 1.5 benchmarks (34x RTF sur A100)
- WebSocket ordering: sitongpeng.com
- LiveKit + Piper low-latency pattern
