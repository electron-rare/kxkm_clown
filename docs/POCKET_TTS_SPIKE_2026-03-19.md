# Spike: Evaluation Pocket TTS (Kyutai) — 2026-03-19

## 1. Presentation du projet

| Champ | Valeur |
|---|---|
| **Nom** | Pocket TTS |
| **Editeur** | Kyutai Labs (labo FR, Paris) |
| **URL GitHub** | https://github.com/kyutai-labs/pocket-tts |
| **Stars** | ~3 600 |
| **Derniere version** | v1.1.1 (16 fevrier 2026) |
| **Licence** | MIT |
| **PyPI** | `pip install pocket-tts` |
| **Hugging Face** | https://huggingface.co/kyutai/pocket-tts |
| **Blog** | https://kyutai.org/blog/2026-01-13-pocket-tts |
| **Tech Report** | https://kyutai.org/pocket-tts-technical-report |
| **Python** | 3.10, 3.11, 3.12, 3.13, 3.14 |
| **Deps** | PyTorch 2.5+ (version CPU suffit) |

**Resume**: Pocket TTS est un modele TTS de 100M parametres, concu pour tourner en temps reel sur CPU sans GPU. Il supporte le voice cloning zero-shot a partir de ~5 secondes d'audio de reference. Developpe par Kyutai, le meme labo francais derriere Moshi (IA conversationnelle).

## 2. Architecture

### Composants principaux

```
Texte -> [Normalisation] -> [FlowLMModel] -> [Mimi Decoder] -> Audio PCM
                                  ^
                           [Speaker Encoder]
                           (voice cloning)
```

| Composant | Role | Details |
|---|---|---|
| **FlowLMModel** | Generation de latents audio a partir de texte | Flow Matching avec Lagrangian Self-Distillation (LSD) |
| **MimiModel** | Codec audio neural | Encode/decode entre PCM et latents, base sur Mimi (Kyutai/Moshi) |
| **Speaker Encoder** | Extraction d'embeddings de voix | Zero-shot, ~5s de reference audio |

### Parametres du modele

- **100M parametres** au total (FlowLM + Mimi)
- Le FlowLM genere les latents en **un seul forward pass** (pas de diffusion iterative)
- Regularisation semantique via distillation de WavLM
- Sample rate: 24 kHz (Mimi natif)

### Pourquoi c'est rapide

Contrairement aux modeles de diffusion (Chatterbox Original: 10 steps, Chatterbox Turbo: 1 step), Pocket TTS utilise le **flow matching single-step** via LSD. Le bruit gaussien est converti en latent audio en un seul forward pass. C'est la raison principale de la vitesse CPU.

## 3. Voice cloning

| Critere | Detail |
|---|---|
| **Type** | Zero-shot speaker adaptation |
| **Audio de reference** | ~5 secondes minimum |
| **Format** | WAV (tout format lisible par torchaudio) |
| **Mecanisme** | Speaker encoder extrait un embedding, conditionnement de la generation |
| **Qualite** | Bonne pour 100M params, inferieure aux modeles 500M+ |
| **Voice caching** | Export en `.safetensors` pour chargement rapide |

### Utilisation CLI

```bash
# Voice cloning avec fichier WAV
pocket-tts generate --voice ./reference.wav --text "Bonjour le monde"

# Voix pre-definies Kyutai (HuggingFace)
pocket-tts generate --voice alba --text "Hello world"

# Export du voice state pour reutilisation rapide
pocket-tts export-voice --voice ./reference.wav --output voice_state.safetensors
```

### Voices pre-definies

Kyutai fournit un repertoire de voix sur HuggingFace: https://huggingface.co/kyutai/tts-voices

## 4. Support linguistique

### Etat actuel: anglais uniquement

Pocket TTS v1.1.1 ne supporte que l'anglais. C'est le **point bloquant principal** pour kxkm_clown (33 personas FR).

### Langues planifiees (pas de date)

Issue officielle: https://github.com/kyutai-labs/pocket-tts/issues/118

Langues annoncees (non-exhaustif, sans date de sortie):
- **Francais** (confirme)
- Espagnol
- Allemand
- Portugais
- Italien

### Alternative FR chez Kyutai: tts-1.6b-en_fr

Kyutai a un **autre modele** qui supporte le francais:

| Champ | Valeur |
|---|---|
| **Nom** | kyutai/tts-1.6b-en_fr |
| **HuggingFace** | https://huggingface.co/kyutai/tts-1.6b-en_fr |
| **Params** | 1.8B (backbone 1B + depth transformer 600M) |
| **Langues** | Anglais + Francais |
| **Type** | Streaming TTS (Delayed Streams Modeling) |
| **Training data** | 2.5M heures audio public |
| **Frame rate** | 12.5 Hz, 32 tokens/frame |

Ce modele est bien plus gros (1.8B vs 100M) et n'est **pas** concu pour tourner sur CPU. Il necessite un GPU. Son architecture (Delayed Streams Modeling) est differente de Pocket TTS (Flow Matching).

## 5. Benchmarks de latence

### Pocket TTS sur CPU

| Plateforme | RTF | Vitesse | Cores | Notes |
|---|---|---|---|---|
| MacBook Air M4 | 0.17 | ~6x temps reel | 2 cores | Benchmark officiel |
| CPU x86 generique | ~0.3-0.5 | ~2-3x temps reel | Variable | Estimation communaute |

- **First-chunk latency**: ~200ms (mode streaming)
- **GPU**: Pas d'acceleration observee (modele trop petit, batch=1, overhead kernel launch)

### Comparaison des latences

| Moteur | Latence typique | Hardware | RTF |
|---|---|---|---|
| **Piper** | ~50ms | CPU (ONNX) | <0.1 |
| **Pocket TTS** | ~200ms (streaming) | CPU (PyTorch) | ~0.17 |
| **Chatterbox Turbo** | ~500ms-1.5s | GPU (1 step) | ~0.5 |
| **Chatterbox Multilingual** | ~2-5s | GPU (10 steps) | ~2-5 |

## 6. API Python

### Installation

```bash
pip install pocket-tts
# ou
uvx pocket-tts generate   # zero-install avec uv
```

### Usage basique

```python
from pocket_tts import TTSModel
import scipy.io.wavfile

# Charger le modele (CPU par defaut)
tts_model = TTSModel.load_model()

# Voice state depuis une voix pre-definie
voice_state = tts_model.get_state_for_audio_prompt("alba")

# Voice state depuis un fichier WAV (voice cloning)
voice_state = tts_model.get_state_for_audio_prompt("./reference.wav")

# Generation audio
audio = tts_model.generate_audio(voice_state, "Hello world")
scipy.io.wavfile.write("output.wav", tts_model.sample_rate, audio.numpy())
```

### Streaming

```python
# Generation en streaming (chunks)
for chunk in tts_model.generate_audio_stream(voice_state, "Long text here..."):
    # chunk est un tensor audio, ~200ms pour le premier
    process_audio(chunk)
```

### Voice caching (optimisation)

```python
# Exporter le voice state (evite de re-encoder la reference a chaque appel)
tts_model.export_voice_state(voice_state, "persona.safetensors")

# Recharger rapidement
voice_state = tts_model.load_voice_state("persona.safetensors")
```

### Serveur HTTP integre

```bash
pocket-tts serve
# -> http://localhost:8000 (interface web + API)
```

### Docker

Le repo inclut un `Dockerfile` et `docker-compose.yaml` officiels. Des images communautaires existent aussi (pocket-tts-wyoming pour Home Assistant, OpenAI-compatible servers).

## 7. Comparaison avec le stack actuel (Piper + Chatterbox)

### Tableau comparatif

| Critere | Piper | Pocket TTS | Chatterbox Multilingual | Chatterbox Turbo |
|---|---|---|---|---|
| **Params** | ~15-20M (VITS) | 100M | 500M (LLaMA) | 350M |
| **Qualite** | Moyenne | Bonne | Excellente | Tres bonne |
| **Latence** | ~50ms (CPU) | ~200ms (CPU) | ~2-5s (GPU) | ~0.5-1.5s (GPU) |
| **Hardware** | CPU (ONNX) | CPU (PyTorch) | GPU (CUDA) | GPU (CUDA) |
| **VRAM** | 0 | 0 | ~3-4 GB | ~2 GB |
| **Voice cloning** | Non | Oui (zero-shot, 5s) | Oui (zero-shot, 6-30s) | Oui (zero-shot, 6-30s) |
| **Francais** | Oui (voix pre-faites) | **Non** (EN only) | Oui (natif, 23 langues) | Non (EN only) |
| **Emotion control** | Non | Non | Oui (exaggeration) | Oui (paralinguistics) |
| **Streaming** | Non | Oui (~200ms first chunk) | Non | Non |
| **Licence** | MIT | MIT | MIT | MIT |
| **Deps** | onnxruntime (leger) | torch (CPU only) | torch + CUDA | torch + CUDA |

### Analyse

**Avantages de Pocket TTS par rapport a Piper:**
- Voice cloning zero-shot (Piper n'en a pas)
- Qualite vocale superieure (100M vs ~15M)
- Streaming natif avec faible latence premier chunk
- API Python moderne et bien documentee

**Avantages de Pocket TTS par rapport a Chatterbox:**
- Tourne sur CPU pur (pas de GPU requis)
- Latence ~10x plus faible (~200ms vs ~2-5s)
- Installation triviale (`pip install pocket-tts`)
- Modele leger (100M vs 350-500M)
- Streaming natif

**Inconvenients de Pocket TTS:**
- **Pas de francais** (bloquant pour 32/33 personas)
- Qualite inferieure a Chatterbox (100M vs 500M)
- Pas de controle d'emotion/expressivite
- Pas de tags paralinguistiques (`[laugh]`, `[cough]`)
- Communaute plus petite (3.6k stars vs 23.7k pour Chatterbox)

## 8. Plan d'integration pour kxkm_clown

### Verdict: NE PAS INTEGRER MAINTENANT

L'absence de support francais est **redhibitoire** pour le projet. 32 des 33 personas parlent francais. Pocket TTS ne peut pas remplacer ni Piper ni Chatterbox dans l'etat actuel.

### Plan conditionnel (si/quand le francais arrive)

#### Phase 1: Veille et test EN (0.5 jour, quand FR annonce)

1. Installer Pocket TTS sur kxkm-ai: `pip install pocket-tts`
2. Tester la voix clonee de Moorcock (seule persona EN)
3. Comparer qualite/latence avec Chatterbox Turbo pour cette persona
4. Tester le serveur integre (`pocket-tts serve`) sur :9300

#### Phase 2: Migration persona EN (1 jour, apres validation Phase 1)

1. Integrer Pocket TTS comme backend supplementaire dans `tts-server.py`
2. Router Moorcock vers Pocket TTS (CPU, ~200ms) au lieu de Chatterbox Turbo (GPU, ~500ms)
3. Avantage: liberer de la VRAM GPU pour Chatterbox Multilingual (FR)

```
Docker (API)  --HTTP :9100-->  tts-server.py
                                  |
                    persona.lang == "en" ?
                       /                 \
              Pocket TTS (CPU)      Chatterbox Multilingual (GPU)
              :9300                  :9200
                       \
                    Piper (fallback CPU, FR)
```

#### Phase 3: Migration complete FR (2-3 jours, quand FR disponible et valide)

1. Tester Pocket TTS FR sur les 5 personas representatives (Schaeffer, Batty, Radigue, Merzbow, Pharmacius)
2. Comparer qualite/latence avec Chatterbox Multilingual
3. Si qualite acceptable:
   - Migrer toutes les personas FR vers Pocket TTS (CPU)
   - Avantage massif: **liberation totale de la VRAM GPU** pour Ollama
   - Chatterbox en fallback pour les personas necessitant le controle d'emotion
4. Exporter tous les voice states en `.safetensors` pour chargement rapide

### Scenario ideal (post-FR)

```
Docker (API)  --HTTP :9100-->  tts-server.py
                                  |
                         Pocket TTS (CPU, defaut)
                         :9300, toutes langues
                              |
                    qualite insuffisante ?
                       /                 \
              Chatterbox (GPU)      Piper (fallback leger)
              :9200 (emotion+)      ONNX, CPU
```

Budget VRAM libere: **3-4 GB** (Chatterbox decharge). Ollama peut utiliser des modeles plus gros.

## 9. Risques et limitations

| Risque | Impact | Probabilite | Mitigation |
|---|---|---|---|
| **Pas de francais** | Bloquant, inutilisable pour 32/33 personas | Certaine (etat actuel) | Attendre la release FR. Surveiller issue #118. |
| **Date FR inconnue** | Pas de planning possible | Elevee | Aucune date annoncee. Pourrait etre des semaines ou des mois. |
| **Qualite FR** incertaine | Voice cloning FR peut etre inferieur a Chatterbox | Moyenne | Kyutai est un labo FR, bon signe. Mais 100M vs 500M, gap probable. |
| **Pas d'emotion control** | Personas expressives (Merzbow, Batty) moins differenciees | Certaine | Garder Chatterbox pour les personas a forte expressivite. |
| **Modele 100M** limites expressives | Moins de nuances que Chatterbox | Certaine | Acceptable pour la majorite des personas "calmes". |
| **PyTorch CPU** plus lourd qu'ONNX | RAM superieure a Piper (~400 MB vs ~100 MB) | Certaine | kxkm-ai a 64 GB RAM, non bloquant. |
| **Pas de support GPU accelere** | Pas d'interet a utiliser le GPU | Certaine | C'est aussi un avantage: libere le GPU pour autre chose. |
| **API serveur basique** | Pas d'OpenAI-compat natif (a verifier) | Moyenne | Le serveur integre suffit. Wrapper possible. |

## 10. Recommandation

### Court terme (maintenant): ne rien faire, surveiller

- **Ne pas integrer Pocket TTS** dans kxkm_clown tant que le francais n'est pas supporte
- **Ajouter une alerte** sur le repo GitHub (Watch > Releases) et l'issue #118
- **Continuer avec le stack actuel**: Chatterbox Multilingual (FR, GPU) + Piper (fallback CPU)

### Moyen terme (quand FR sort): evaluer pour les personas EN

- Tester Pocket TTS pour la persona Moorcock (EN)
- Si ok: remplacer Chatterbox Turbo pour les cas EN, liberer de la VRAM

### Long terme (si FR + qualite OK): migration CPU-first

- Pocket TTS pourrait devenir le moteur TTS par defaut, liberant le GPU pour Ollama
- L'architecture CPU-first simplifie le deploiement (pas de CUDA, pas de VRAM management)
- Le streaming natif (~200ms first chunk) ameliore l'UX du chat temps reel

### Comparaison avec le modele kyutai/tts-1.6b-en_fr

Le modele 1.8B de Kyutai **supporte deja le francais** mais:
- Necessite un GPU (1.8B params, ~4-6 GB VRAM)
- Architecture differente (Delayed Streams, pas Flow Matching)
- Pas emballe dans Pocket TTS (API differente)
- Rivalise avec Chatterbox Multilingual sur le meme creneau (GPU, gros modele)
- Pas d'avantage clair par rapport a Chatterbox pour notre cas d'usage

A surveiller mais **pas prioritaire** par rapport a Chatterbox deja en place.

---

## Sources

- [Pocket TTS GitHub](https://github.com/kyutai-labs/pocket-tts) (3.6k stars, MIT, v1.1.1)
- [Pocket TTS Blog](https://kyutai.org/blog/2026-01-13-pocket-tts)
- [Pocket TTS Technical Report](https://kyutai.org/pocket-tts-technical-report)
- [Pocket TTS Python API](https://kyutai-labs.github.io/pocket-tts/API%20Reference/python-api/)
- [Pocket TTS HuggingFace](https://huggingface.co/kyutai/pocket-tts)
- [Kyutai TTS Voices](https://huggingface.co/kyutai/tts-voices)
- [kyutai/tts-1.6b-en_fr](https://huggingface.co/kyutai/tts-1.6b-en_fr) (modele FR, 1.8B)
- [Issue #118: More languages](https://github.com/kyutai-labs/pocket-tts/issues/118)
- [Pocket TTS Dockerfile](https://github.com/kyutai-labs/pocket-tts/blob/main/Dockerfile)
- [DeepWiki: pocket-tts](https://deepwiki.com/kyutai-labs/pocket-tts)
- [HN Discussion](https://news.ycombinator.com/item?id=46628329)
- [Chatterbox Spike (ce projet)](./CHATTERBOX_SPIKE_2026-03-19.md)
