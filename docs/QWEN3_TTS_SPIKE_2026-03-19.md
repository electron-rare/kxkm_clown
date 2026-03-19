# Spike: Integration Qwen3-TTS (lot-30) — 2026-03-19

**Date**: 2026-03-19
**Auteur**: Claude (spike automatise)
**Statut**: DRAFT
**Lot**: 30

---

## 1. Resume du projet

| Champ | Valeur |
|---|---|
| **Nom** | Qwen3-TTS |
| **Editeur** | Qwen team, Alibaba Cloud |
| **URL GitHub** | https://github.com/QwenLM/Qwen3-TTS |
| **Stars** | ~9 700 (mars 2026) |
| **Forks** | ~1 200 |
| **Licence** | Apache-2.0 |
| **Cree** | 2026-01-21 |
| **Derniere MAJ** | 2026-03-19 (actif) |
| **Langage** | Python |
| **Issues ouvertes** | ~85 |
| **ArXiv** | 2601.15621 |

Qwen3-TTS est une famille de modeles TTS open-source de pointe, supportant la generation
vocale stable, expressive et en streaming, le voice design par prompt en langage naturel,
et le clonage vocal zero-shot a partir de 3 secondes de reference audio.

---

## 2. Architecture et modeles

### Architecture interne

```
Texte + [Instructions vocales / Audio reference]
    |
    v
[Qwen3-TTS LM] -- Discrete Multi-Codebook Language Model
    |                Architecture non-DiT, end-to-end
    v
[Qwen3-TTS-Tokenizer-12Hz] -- Codec audio basse frequence
    |                           Compression acoustique efficace
    v
[Decodeur audio] --> WAV 24kHz
```

- **Dual-Track Hybrid Streaming**: architecture innovante supportant streaming et non-streaming
- **Latence end-to-end**: aussi basse que 97ms en mode streaming
- **Codec 12Hz**: tokenisation audio a 12 tokens/seconde (vs 50-75 Hz pour la plupart des codecs)
- **Multi-codebook LM**: modelisation full-information end-to-end des signaux vocaux

### Modeles disponibles (Hugging Face)

| Modele | Params | Telecharges | Usage |
|---|---|---|---|
| **Qwen3-TTS-12Hz-1.7B-Base** | 1.7B | ~1.96M | TTS general + clonage vocal |
| **Qwen3-TTS-12Hz-1.7B-CustomVoice** | 1.7B | ~1.10M | Voix preset + controle par instruction |
| **Qwen3-TTS-12Hz-1.7B-VoiceDesign** | 1.7B | ~494K | Creation de nouvelles voix par prompt NL |
| **Qwen3-TTS-12Hz-0.6B-Base** | 0.6B | ~379K | Version legere, TTS + clonage |
| **Qwen3-TTS-12Hz-0.6B-CustomVoice** | 0.6B | ~270K | Version legere, voix preset |
| **Qwen3-TTS-Tokenizer-12Hz** | - | ~84K | Codec audio (composant partage) |

### Estimation VRAM

| Modele | VRAM estime (fp16) | VRAM estime (int8) |
|---|---|---|
| 1.7B | ~4-5 GB | ~2.5-3 GB |
| 0.6B | ~1.5-2 GB | ~1 GB |

Sur le RTX 4090 (24 GB), le modele 1.7B tient facilement avec marge pour batch/streaming.

---

## 3. Capacites cles pour kxkm_clown

### 3.1. Voice Design par langage naturel (VoiceDesign)

Le modele VoiceDesign permet de creer des voix entierement nouvelles via des descriptions
en langage naturel. Exemples de prompts :

- "Voix d'un vieux professeur fatigue, avec un timbre grave et une diction lente"
- "Jeune femme energique, legere intonation du sud de la France"
- "Voix robotique, metallique, sans emotion"

Cela s'integre directement avec les personas de kxkm_clown : chaque persona pourrait
avoir une description vocale en langage naturel, transformee automatiquement en voix unique.

```python
# Exemple d'API (VoiceDesign)
voice = model.generate_voice_design(
    text="Bonjour, je suis Merzbow le clown.",
    instruct="A deep, gravelly voice with a sardonic tone and slow, deliberate pacing"
)
```

### 3.2. Voice Cloning zero-shot (Base / CustomVoice)

- Clonage a partir de 3 secondes d'audio de reference
- Supporte WAV, MP3
- Fonctionne en mode streaming

### 3.3. Langues supportees

| Langue | Code | Support |
|---|---|---|
| Chinois | zh | Natif (meilleur support, dialectes inclus) |
| Anglais | en | Excellent |
| **Francais** | **fr** | **Oui, natif** |
| Japonais | ja | Oui |
| Coreen | ko | Oui |
| Allemand | de | Oui |
| Russe | ru | Oui |
| Portugais | pt | Oui |
| Espagnol | es | Oui |
| Italien | it | Oui |

Le francais est dans les 10 langues nativement supportees. Selon les benchmarks communautaires,
la qualite est "consistante" sur le francais, bien que le chinois reste la langue la plus
forte du modele.

### 3.4. Streaming

- Dual-Track Hybrid Streaming: TTFA (time-to-first-audio) de 97ms
- Compatible avec des use-cases conversationnels en temps reel

---

## 4. Performance RTX 4090

### Inference officielle (QwenLM/Qwen3-TTS)

| Metrique | Valeur |
|---|---|
| TTFA (streaming) | ~97ms |
| Sessions concurrentes (1.7B) | 15-20 sessions temps reel |
| Performance vs RTX 5090 | ~65% du throughput, moitie du prix |

### faster-qwen3-tts (andimarafioti, 676 stars)

Implementation optimisee avec CUDA graphs, sans Flash Attention, vLLM ni Triton :

| Metrique | RTX 4090 | H100 |
|---|---|---|
| **RTF (Real-Time Factor)** | **5.6x temps reel** | 4.2x temps reel |
| **TTFA (streaming)** | **~152ms** | - |
| Overhead | Zero custom attention code | - |

Un RTF de 5.6x signifie que 1 seconde d'audio est generee en ~0.18s. Excellent pour le
temps reel conversationnel de kxkm_clown.

### Qwen3-TTS-streaming (dffdeeq)

Fork alternatif revendiquant ~6x d'acceleration sur l'inference.

---

## 5. Deploiement Docker / API

### Option A : Qwen3-TTS-Openai-Fastapi (groxaxo)

Serveur FastAPI drop-in compatible avec l'API OpenAI `/v1/audio/speech` :

- Docker GPU, CPU, et vLLM disponibles
- Port 8880
- Streaming via `stream=true`
- Formats audio : MP3, Opus, AAC, FLAC, WAV, PCM
- 28 voix custom preconfigures
- Cache modeles HuggingFace

```bash
# Deploiement Docker GPU
docker build -t qwen3-tts-api --target gpu-production .
docker run --gpus all -p 8880:8880 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  qwen3-tts-api
```

### Option B : faster-qwen3-tts (pour perf max)

Implementation legere, CUDA graphs, RTF 5.6x :

```bash
pip install faster-qwen3-tts
```

### Option C : Integration directe dans tts-server.py existant

Le projet kxkm_clown a deja un `tts-server.py` avec dual backend Chatterbox/Piper.
Qwen3-TTS pourrait devenir un troisieme backend.

---

## 6. Comparaison Qwen3-TTS vs Chatterbox Multilingual

| Critere | Qwen3-TTS 1.7B | Chatterbox Multilingual | Avantage |
|---|---|---|---|
| **Qualite globale** | SOTA | Excellente (bat ElevenLabs 63.75%) | Comparable |
| **Voice Design (NL prompt)** | Oui (VoiceDesign model) | Non (exaggeration slider) | **Qwen3** |
| **Voice Cloning** | 3s ref audio | 6-30s ref audio | **Qwen3** (moins de ref) |
| **Facilite d'usage** | Complexe (seed pinning, tuning) | Simple (plug & play) | **Chatterbox** |
| **Francais** | Natif (10 langues) | Natif (23 langues) | Chatterbox (plus de langues) |
| **Controle emotion** | Via prompt NL | Slider exaggeration (0-1) | Qwen3 (plus fin) |
| **Latence streaming** | 97-152ms TTFA | ~2-5s (10 diffusion steps) | **Qwen3** |
| **VRAM** | ~4-5 GB (1.7B) | ~3-4 GB (0.5B) | Comparable |
| **Licence** | Apache-2.0 | MIT | Les deux permissives |
| **Paralinguistique** | Non | Oui (Turbo: [laugh], [cough]) | **Chatterbox** |
| **Ecosysteme** | 9.7K stars, Alibaba | 23.7K stars, Resemble AI | Les deux solides |
| **Modele leger** | 0.6B disponible | 350M Turbo (EN only) | Qwen3 (multilingue leger) |

### Verdict comparatif

- **Chatterbox** : meilleur pour le clonage vocal simple et fiable, plug & play
- **Qwen3-TTS** : meilleur pour le voice design creatif, le streaming basse latence, et les personas dynamiques
- **Recommandation** : les deux sont complementaires. Qwen3-TTS pour les personas generees dynamiquement, Chatterbox pour le clonage de voix reelles.

---

## 7. Plan d'integration (3 phases)

### Phase 1 : PoC local (1-2 jours)

1. Installer Qwen3-TTS 0.6B-Base sur kxkm-ai (RTX 4090)
2. Tester inference francaise : qualite, latence, artefacts
3. Tester voice design avec descriptions de personas existantes (Merzbow, etc.)
4. Benchmarker RTF et TTFA avec faster-qwen3-tts
5. Comparer sortie audio vs Chatterbox Multilingual sur memes phrases FR

### Phase 2 : Integration backend (2-3 jours)

1. Ajouter backend `qwen3-tts` dans `tts-server.py` (3e backend apres Chatterbox/Piper)
2. Exposer via API OpenAI-compatible (FastAPI, `/v1/audio/speech`)
3. Mapper chaque persona a un profil vocal :
   - `voice_design_prompt` : description NL pour VoiceDesign
   - `voice_ref_audio` : fichier WAV pour clonage (CustomVoice/Base)
   - `voice_preset` : nom de voix preset (CustomVoice)
4. Hot-swap entre backends (Piper CPU / Chatterbox GPU / Qwen3 GPU)
5. Ajouter route streaming WebSocket pour TTFA < 200ms

### Phase 3 : Production + fine-tuning (3-5 jours)

1. Deployer via Docker compose sur kxkm-ai
2. Optimiser cohabitation GPU : Ollama (LLM) + Qwen3-TTS + Chatterbox
3. Tester charge : sessions concurrentes, stabilite long-terme
4. Explorer fine-tuning 0.6B sur corpus vocal francais specifique
5. Dashboard monitoring VRAM / latence dans OPS TUI

---

## 8. Risques et bloqueurs

| Risque | Severite | Mitigation |
|---|---|---|
| **Qualite francaise inferieure au chinois/anglais** | Moyenne | PoC Phase 1 : benchmark FR avant engagement |
| **Complexite de tuning** | Moyenne | Utiliser faster-qwen3-tts (simplifie) ; fallback sur Chatterbox |
| **VRAM partagee avec Ollama** | Moyenne | 24 GB suffisants (LLM ~8-12GB + TTS ~4-5GB) ; swap si besoin |
| **85 issues ouvertes** | Faible | Projet tres actif, Alibaba maintient |
| **Seed pinning requis pour consistance** | Moyenne | CustomVoice presets evitent ce probleme |
| **Pas de paralinguistiques** | Faible | Chatterbox Turbo disponible en complement |
| **Dependance PyTorch lourde** | Faible | Deja installe sur kxkm-ai pour Chatterbox |

---

## 9. Recommandation

### INTEGRER MAINTENANT (Phase 1-2)

**Justification** :

1. **Voice Design par prompt NL** est un game-changer pour les personas dynamiques de kxkm_clown.
   Chaque clown pourrait avoir sa voix unique generee a la volee par description textuelle.
2. **Streaming basse latence** (97-152ms TTFA) est nettement superieur a Chatterbox (2-5s),
   critique pour le conversationnel temps reel du spectacle.
3. **Francais natif** dans les 10 langues supportees.
4. **RTX 4090 ideale** : RTF 5.6x avec faster-qwen3-tts, 15-20 sessions concurrentes.
5. **Complementaire** avec Chatterbox (pas un remplacement) : Qwen3 pour le creatif,
   Chatterbox pour le fiable.
6. **Apache-2.0** : licence permissive, pas de restriction commerciale.
7. **Modele 0.6B** disponible pour economiser VRAM si necessaire.

Le PoC Phase 1 (1-2 jours) est a faible risque et haut potentiel.

---

## Sources

- [QwenLM/Qwen3-TTS (GitHub)](https://github.com/QwenLM/Qwen3-TTS)
- [Qwen3-TTS Model Cards (Hugging Face)](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base)
- [faster-qwen3-tts (GitHub)](https://github.com/andimarafioti/faster-qwen3-tts)
- [Qwen3-TTS-Openai-Fastapi (GitHub)](https://github.com/groxaxo/Qwen3-TTS-Openai-Fastapi)
- [Qwen3-TTS Performance Benchmarks](https://qwen3-tts.app/blog/qwen3-tts-performance-benchmarks-hardware-guide-2026)
- [Qwen3-TTS Complete 2026 Guide (DEV Community)](https://dev.to/czmilo/qwen3-tts-the-complete-2026-guide-to-open-source-voice-cloning-and-ai-speech-generation-1in6)
- [Qwen3-TTS vs Chatterbox (Archy.net)](https://www.archy.net/from-qwen3-tts-to-chatterbox-finally-getting-voice-cloning-right/)
- [ArXiv Paper 2601.15621](https://arxiv.org/abs/2601.15621)
