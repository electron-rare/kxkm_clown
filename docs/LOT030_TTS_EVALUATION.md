# LOT-030 — Evaluation TTS : Pocket TTS vs Stack KXKM

**Date**: 2026-03-26
**Lot**: lot-30-pocket-tts
**Owner**: Multimodal
**Status**: EVALUATED — recommendation: **SURVEILLER, ne pas integrer maintenant**

---

## 1. Stack TTS actuel de KXKM

### Architecture en production

```
Docker (API)  --HTTP :9100-->  scripts/tts-server.py (host)
                                    |
                     TTS_BACKEND env var
                        /        |         \
          chatterbox-remote  qwen3      piper (fallback)
          :9200 (GPU)        :9300 (GPU)  CPU ONNX
```

### Trois backends actifs

| Backend | Port | Hardware | Modele | Usage |
|---|---|---|---|---|
| **Chatterbox Multilingual** | :9200 | GPU (RTX 4090) | 0.5B LLaMA, 23 langues | Principal FR, voice cloning |
| **Qwen3-TTS CustomVoice** | :9300 | GPU (RTX 4090) | 0.6B / 1.7B, 9 speakers | Personas via instruct style |
| **Piper** | :9100 (fallback) | CPU (ONNX) | ~15-20M VITS | Fallback leger, pre-voices FR |

### Caracteristiques cles du stack actuel

- **33 personas, 32 parlent francais** (Moorcock = seule persona EN)
- `persona-voices.ts`: mapping persona → (speaker, instruct) pour Qwen3-TTS
- `tts-server.py`: proxy HTTP vers Chatterbox/Qwen3, fallback Piper local
- Voice cloning zero-shot disponible via Chatterbox (WAV reference 6-30s) et Qwen3-TTS Base (`/clone`)
- Pas de POCKET_TTS ni de `pockettts` dans le codebase (verifie par grep)
- Budget VRAM actuel: Chatterbox ~3-4 GB + Qwen3 ~2 GB + Ollama ~6-8 GB = ~12-14 GB / 24 GB RTX 4090

---

## 2. Pocket TTS — Etat du projet

### Identite

| Champ | Valeur |
|---|---|
| **Nom** | Pocket TTS |
| **Editeur** | Kyutai Labs (labo FR, Paris — meme equipe que Moshi) |
| **GitHub** | https://github.com/kyutai-labs/pocket-tts |
| **Stars** | ~3 600 |
| **Version** | v1.1.1 (16 fevrier 2026) — 68 commits |
| **Licence** | MIT |
| **PyPI** | `pip install pocket-tts` |
| **HuggingFace** | https://huggingface.co/kyutai/pocket-tts |
| **Python** | 3.10 → 3.14 |
| **Deps** | PyTorch 2.5+ (CPU version suffisante) |

### Architecture technique

```
Texte  ->  [Normalisation]  ->  [FlowLMModel]  ->  [Mimi Decoder]  ->  Audio 24kHz
                                      ^
                              [Speaker Encoder]
                              (voice cloning 5s)
```

- **100M parametres** (FlowLM + Mimi), distillation depuis un modele 300M
- **Flow Matching single-step** via Lagrangian Self-Distillation (LSD) — pas de diffusion iterative
- **Continuous Audio Language Models (CALM)** — pas de tokens audio discrets, latents continus
- Sample rate natif: **24 kHz** (Mimi codec, meme que Moshi)
- Architecture causale → streaming natif

### Performance CPU

| Plateforme | RTF | Vitesse | Cores CPU | First chunk |
|---|---|---|---|---|
| MacBook Air M4 | 0.17 | ~6x temps reel | 2 cores | ~200ms |
| Intel Core Ultra 7 165H | ~0.3 | ~3x temps reel | variable | ~300ms |
| x86 generique (estimation) | ~0.3-0.5 | ~2-3x temps reel | variable | ~350ms |

- **GPU**: aucun gain observe (modele trop petit, batch=1, overhead kernel launch l'annule)
- **RAM**: ~400 MB (vs ~100 MB Piper ONNX)

### Voice cloning

| Critere | Detail |
|---|---|
| **Type** | Zero-shot speaker adaptation |
| **Audio de reference** | ~5 secondes minimum (WAV, tout format torchaudio) |
| **Mecanisme** | Speaker encoder → embedding → conditionnement du FlowLM |
| **Voice caching** | Export en `.safetensors` pour chargement rapide (evite re-encodage) |
| **Qualite** | Bonne pour 100M params, inferieure aux modeles 500M+ (Chatterbox) |

Voix pre-definies Kyutai: alba, marius, javert, jean, fantine, cosette, eponine, azelma

### Support linguistique — POINT BLOQUANT

**Pocket TTS v1.1.1 supporte uniquement l'anglais.**

- Issue officielle pour le FR: https://github.com/kyutai-labs/pocket-tts/issues/118
- Langues annoncees (sans date): francais, espagnol, allemand, portugais, italien
- Kyutai est un labo parisien — bon signe pour la qualite future du FR
- Pas de date de release annoncee

### Alternative FR chez Kyutai: kyutai/tts-1.6b-en_fr

Kyutai dispose d'un **autre modele** supportant le francais:
- 1.8B params (backbone 1B + depth transformer 600M)
- Architecture Delayed Streams Modeling (differente de Pocket TTS)
- Necessite un GPU (~4-6 GB VRAM)
- Competing directement avec Chatterbox Multilingual — pas d'avantage clair pour KXKM

---

## 3. Matrice de comparaison

| Critere | Piper :9100 | **Pocket TTS** | Chatterbox MTL :9200 | Qwen3-TTS :9300 |
|---|---|---|---|---|
| **Parametres** | ~15-20M (VITS) | **100M** | 500M (LLaMA) | 600M / 1.7B |
| **Qualite** | Moyenne | Bonne | Excellente | Tres bonne |
| **Latence CPU** | ~50ms | **~200ms** | N/A | N/A |
| **Latence GPU** | N/A | (pas de gain) | ~2-5s | ~1-3s |
| **Hardware** | CPU (ONNX) | **CPU (PyTorch)** | GPU CUDA | GPU CUDA |
| **VRAM** | 0 | **0** | ~3-4 GB | ~2 GB |
| **Francais** | Oui (pre-voices) | **Non (EN only)** | Oui (23 langues) | Oui (instruct) |
| **Voice cloning** | Non | **Oui (5s ref)** | Oui (6-30s ref) | Oui (Base model) |
| **Emotion control** | Non | Non | Oui (exaggeration) | Oui (instruct text) |
| **Paralinguistiques** | Non | Non | Non (MTL) | Non |
| **Streaming** | Non | **Oui (~200ms first chunk)** | Non | Non |
| **Licence** | MIT | **MIT** | MIT | Apache 2.0 |
| **Installation** | trivial (ONNX) | `pip install pocket-tts` | `pip + CUDA` | `pip + CUDA` |
| **Infinitely long text** | Non | **Oui (chunking natif)** | Partiel | Partiel |
| **Stars GitHub** | ~4k | ~3.6k | ~23.7k | N/A (Qwen/HF) |

### Analyse comparative

**Pocket TTS gagne sur:**
- Latence CPU (~200ms vs Piper ~50ms, mais avec voice cloning)
- CPU-only sans GPU (libere ~3-6 GB VRAM si migre)
- Streaming natif avec 200ms first-chunk (UX temps reel meilleure)
- Installation triviale (`pip install pocket-tts`, pas de CUDA)
- Modele leger en RAM (~400 MB)

**Pocket TTS perd sur:**
- **Francais absent** — bloquant pour 32/33 personas KXKM
- Qualite vocale (100M vs 500M+)
- Pas de controle d'emotion/expressivite (Merzbow, Batty affectes)
- Communaute plus petite (3.6k vs 23.7k pour Chatterbox)
- Pas de paralinguistiques (`[laugh]`, `[cough]`)

---

## 4. Plan de test — Spike 5 personas

### Prerequis (disponible quand FR sera supporte)

```bash
pip install pocket-tts
# ou: uv add pocket-tts
```

### Personas selectionnees pour le spike

| Persona | Langue | Caractere vocal | Interet du test |
|---|---|---|---|
| **Pharmacius** | FR | Neutre, orchestrateur | Persona principale, reference |
| **Sherlock** | FR | Analytique, precis | Tool-calling, deduction |
| **Schaeffer** | FR | Academique, mesure | Voix intellectuelle |
| **Merzbow** | FR | Intense, agressif | Stress test expressivite |
| **Moorcock** | EN | Riche narrateur EN | Seule persona EN — test immediat possible |

### Phase 0 (maintenant) — Test Moorcock EN uniquement

```bash
# Installation
pip install pocket-tts

# Test voice cloning Moorcock (seule persona EN)
pocket-tts generate \
  --voice data/voice-samples/moorcock.wav \
  --text "The eternal champion wanders through the multiverse, seeking the balance."

# Export voice state pour reutilisation rapide
pocket-tts export-voice \
  --voice data/voice-samples/moorcock.wav \
  --output data/pocket-tts-voices/moorcock.safetensors

# Serveur integre sur port de test
pocket-tts serve --port 9350
```

### Phase 1 (quand FR disponible) — Benchmark latence

```python
import time
from pocket_tts import TTSModel

tts = TTSModel.load_model()

test_personas = {
    "pharmacius": "Je suis l'orchestrateur de ce dispositif. Mes freres pensent, je coordonne.",
    "sherlock": "Les indices ne mentent pas. La solution est evidente pour qui sait observer.",
    "schaeffer": "L'objet sonore se detache de sa cause. C'est le fondement de l'acousmatique.",
    "merzbow": "Le bruit est la verite brutale du monde. Rien ne peut l'attenuer.",
}

for persona, text in test_personas.items():
    voice_path = f"data/pocket-tts-voices/{persona}.safetensors"
    voice_state = tts.load_voice_state(voice_path)
    t0 = time.time()
    audio = tts.generate_audio(voice_state, text)
    latency = (time.time() - t0) * 1000
    print(f"{persona}: {latency:.0f}ms, {len(text)} chars")
```

### Phase 2 — Integration conditionnelle dans tts-server.py

Si Phase 1 valide (FR OK + qualite acceptable):

```
Docker (API) --HTTP :9100--> tts-server.py
                                  |
                       persona.lang == "en" ?
                         /                    \
               Pocket TTS (CPU :9350)     Qwen3-TTS (GPU :9300)
               ~200ms, 0 VRAM             ~1-3s, ~2 GB VRAM
                                               |
                                    qualite insuffisante ?
                                              |
                                       Piper (fallback)
```

Budget VRAM libere si migration complete FR → CPU: **~3-6 GB** disponibles pour Ollama.

### Metriques de validation

| Metrique | Seuil acceptation | Methode |
|---|---|---|
| Latence first-chunk | < 500ms (CPU kxkm-ai) | Benchmark Python |
| RTF | < 1.0 (temps reel minimum) | `len(audio) / sr / duration` |
| Qualite FR | MOS > 3.5 / 5 (subjectif) | Ecoute 5 personas |
| Voice cloning | Voix reconnaissable | Ecoute comparative |
| Stabilite | 0 crash sur 50 appels | Stress test |

---

## 5. Recommandation

### Verdict global: SURVEILLER — integrer conditionnellement quand FR disponible

#### Maintenant (2026-03-26): ne rien changer, surveiller

- **Ne pas integrer Pocket TTS** dans le stack de production
- **Action immediate**: Watch GitHub release sur `kyutai-labs/pocket-tts` + issue #118
- **Stack actuel optimal**: Qwen3-TTS :9300 (primary, qualite + instruct FR) + Chatterbox :9200 (voice cloning, emotion) + Piper (fallback CPU)
- **Exception**: tester Pocket TTS sur Moorcock (EN) si latence Chatterbox Turbo est problematique

#### Moyen terme (quand FR annonce): spike immediat

1. Installer Pocket TTS sur kxkm-ai
2. Tester les 5 personas du plan ci-dessus
3. Comparer qualite avec Qwen3-TTS (reference actuelle)
4. Si qualite >= Piper + latence < 400ms: integrer comme backend `pocket-tts` dans tts-server.py
5. Router les personas "calmes" (Schaeffer, Pharmacius, Sherlock) vers Pocket TTS CPU
6. Garder Chatterbox/Qwen3 pour personas expressives (Merzbow, Batty) et voice cloning avance

#### Long terme (si FR + qualite validee): migration CPU-first

- Pocket TTS devient backend TTS par defaut pour FR
- **~3-6 GB VRAM liberes** → Ollama peut charger modeles plus gros (qwen3:32b, etc.)
- Architecture CPU-first simplifie le deploiement (pas de CUDA, pas de gestion VRAM)
- Streaming natif 200ms ameliore l'UX temps reel
- Chatterbox reste en standby pour emotion control et voice cloning haute qualite

### Comparaison avec Kokoro TTS (reference complementaire)

| | Pocket TTS | Kokoro-82M |
|---|---|---|
| Params | 100M | 82M |
| CPU RTF | ~0.17 (M4) | comparable |
| Langues | EN only (FR planifie) | EN primarily |
| Voice cloning | Oui (zero-shot 5s) | Non (voix fixes) |
| VRAM | 0 | 0 |
| FR | Non | Non (limites) |
| Avantage KXKM | Meilleur pour voice cloning | Plus leger |

Pocket TTS est prefere a Kokoro pour KXKM grace au voice cloning zero-shot et aux 29 langues planifiees.

---

## 6. Liens et references

- [Pocket TTS GitHub](https://github.com/kyutai-labs/pocket-tts) (MIT, v1.1.1)
- [Pocket TTS HuggingFace](https://huggingface.co/kyutai/pocket-tts)
- [Pocket TTS Official Page](https://kyutai-labs.github.io/pocket-tts/)
- [Issue #118: More languages](https://github.com/kyutai-labs/pocket-tts/issues/118)
- [kyutai/tts-1.6b-en_fr](https://huggingface.co/kyutai/tts-1.6b-en_fr) (modele FR Kyutai, 1.8B, GPU)
- [Build a Voice Agent with Pocket TTS](https://getstream.io/blog/pocket-tts-voice-agent/)
- [Technical Report: CALM](https://arxiv.org/html/2509.06926v3)
- [Spike precedent 2026-03-19](./POCKET_TTS_SPIKE_2026-03-19.md) — analyse initiale
- [Chatterbox Spike 2026-03-19](./CHATTERBOX_SPIKE_2026-03-19.md) — stack actuel
- [Qwen3-TTS Server](../scripts/qwen3-tts-server.py) — backend GPU principal
- [Persona Voices mapping](../apps/api/src/persona-voices.ts) — 33 personas FR/EN

---

*Genere: 2026-03-26 — lot-30-pocket-tts — Session deep research TTS*
