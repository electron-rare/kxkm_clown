# Spike: Integration Chatterbox TTS — 2026-03-19

## 1. Resume de Chatterbox

[Chatterbox](https://github.com/resemble-ai/chatterbox) est un moteur TTS open-source (MIT) de Resemble AI, 23 700+ stars GitHub. Package PyPI `chatterbox-tts` v0.1.6, Python >= 3.10.

### Trois variantes

| Variante | Params | Langues | Diffusion steps | Voice cloning | Emotion control | Paralinguistics |
|---|---|---|---|---|---|---|
| **Original** | 0.5B (LLaMA) | EN uniquement | 10 | Oui (zero-shot) | Oui (exaggeration) | Non |
| **Multilingual** | 0.5B | 23 langues (FR, EN, DE, ES, JP...) | 10 | Oui (zero-shot) | Oui (exaggeration) | Non |
| **Turbo** | 350M | EN uniquement | 1 (distille) | Oui (zero-shot) | Non | Oui: `[laugh]`, `[cough]`, `[chuckle]` |

Points cles :
- Zero-shot voice cloning via audio prompt (WAV/MP3, 6-30s de reference)
- Entraine sur 0.5M heures de donnees nettoyees
- Hot-swap entre les trois moteurs sans redemarrage
- Licence MIT (pas de CPML comme XTTS-v2/Coqui)

### API Python native

```python
from chatterbox.tts import ChatterboxTTS
model = ChatterboxTTS.from_pretrained(device="cuda")
wav = model.generate("Bonjour le monde", audio_prompt_path="ref.wav")

# Multilingual
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
model = ChatterboxMultilingualTTS.from_pretrained(device="cuda")
wav = model.generate("Bonjour", audio_prompt_path="ref.wav", language_id="fr")

# Turbo
from chatterbox.turbo_tts import ChatterboxTurboTTS
model = ChatterboxTurboTTS.from_pretrained(device="cuda")
wav = model.generate("Hello [laugh] world", audio_prompt_path="ref.wav")
```

## 2. Comparaison avec Piper

| Critere | Piper | Chatterbox Multilingual | Chatterbox Turbo |
|---|---|---|---|
| **Qualite vocale** | Moyenne (synthe VITS) | Excellente (LLaMA + diffusion) | Tres bonne (distille) |
| **Latence** | ~50ms (CPU) | ~2-5s (GPU, 10 steps) | ~0.5-1.5s (GPU, 1 step) |
| **VRAM** | 0 (CPU pur, ONNX) | ~3-4 GB | ~2 GB |
| **Voice cloning** | Non (voix pre-entrainee) | Oui (zero-shot, audio ref) | Oui (zero-shot, audio ref) |
| **Francais** | Oui (fr_FR-siwis, fr_FR-gilles) | Oui (natif, 23 langues) | Non (EN uniquement) |
| **Emotion/expressivite** | Non | Oui (exaggeration slider) | Oui (tags paralinguistiques) |
| **Licence** | MIT | MIT | MIT |
| **Deps** | onnxruntime (leger) | torch, torchaudio (~2 GB) | torch, torchaudio (~2 GB) |
| **Deployment** | Trivial, CPU anywhere | GPU requis (CUDA) | GPU requis (CUDA) |

### Verdict

- **Piper** reste indispensable comme fallback CPU (Docker, CI, machines sans GPU)
- **Chatterbox Multilingual** est le choix principal pour la prod GPU: francais natif + voice cloning
- **Chatterbox Turbo** interessant pour les personas EN uniquement (Batty, Moorcock, Sherlock) grace aux paralinguistics

## 3. Serveurs OpenAI-compatibles existants

### Option A: devnen/Chatterbox-TTS-Server (recommande)

- FastAPI, support complet des 3 moteurs (Original + Multilingual + Turbo)
- Hot-swap entre moteurs via API
- Endpoint principal: `POST /tts` avec params: text, voice mode, reference audio, temperature, exaggeration, cfg_weight, seed, speed_factor, language
- OpenAI-compatible: `POST /v1/audio/speech` (drop-in)
- Docker support natif, CUDA 12.8 compatible
- Voices predefinies + voice cloning
- Chunking intelligent pour textes longs
- MIT License

### Option B: travisvn/chatterbox-tts-api

- FastAPI, OpenAI-compatible (`POST /v1/audio/speech`)
- Voice library management (`GET /voices`, upload/delete)
- Multilingual support (22 langues)
- Streaming SSE pour audio progressif
- Docker + docker-compose avec GPU
- Note: support Turbo "coming soon" (pas encore integre)

### Recommandation

**devnen/Chatterbox-TTS-Server** est le choix optimal:
- Support complet des 3 moteurs
- CUDA 12.8 teste (RTX 4090/5090)
- Hot-swap sans redemarrage
- Plus mature et actif

## 4. Plan de migration du TTS sidecar

### Etat actuel

```
Docker (API)  --HTTP :9100-->  tts-server.py (host)
                                  |
                    TTS_BACKEND="chatterbox" ?
                       /                 \
              Chatterbox MTL           Piper (fallback)
              (from_pretrained)        (ONNX, CPU)
```

Le `tts-server.py` actuel charge deja Chatterbox Multilingual via `chatterbox.mtl_tts.ChatterboxMultilingualTTS`. L'integration est donc a mi-chemin.

### Phase 1: Deployer Chatterbox-TTS-Server standalone (1-2 jours)

**Objectif**: Avoir un serveur TTS OpenAI-compatible sur kxkm-ai, testable independamment.

1. Cloner `devnen/Chatterbox-TTS-Server` sur kxkm-ai
2. Creer un venv dedie `/home/kxkm/.venvs/chatterbox-server`
3. Installer avec CUDA 12.8: `pip install chatterbox-tts torch torchaudio --index-url https://download.pytorch.org/whl/cu128`
4. Configurer `config.yaml`:
   - `server.host: 127.0.0.1`
   - `server.port: 9200` (a cote du :9100 existant)
   - `model.engine: multilingual` (defaut pour le francais)
   - `paths.predefined_voices: /home/kxkm/kxkm_clown/data/voice-samples`
5. Lancer via tmux: `tmux new-session -d -s chatterbox-server 'python server.py'`
6. Tester: `curl -X POST http://127.0.0.1:9200/tts -H 'Content-Type: application/json' -d '{"text":"Bonjour"}'`
7. Tester OpenAI-compat: `curl -X POST http://127.0.0.1:9200/v1/audio/speech -d '{"model":"chatterbox","input":"Bonjour","voice":"default"}'`

**Validation**: health check vert, audio genere, latence < 5s pour 100 chars.

### Phase 2: Migrer tts-server.py vers Chatterbox-TTS-Server (1-2 jours)

**Objectif**: Router les requetes TTS du conteneur Docker vers Chatterbox par defaut, Piper en fallback.

Option A (proxy simple, recommande):
```
Docker (API)  --HTTP :9100-->  tts-server.py (inchange)
                                  |
                    TTS_BACKEND="chatterbox" ?
                       /                 \
              HTTP :9200              Piper (fallback CPU)
              (Chatterbox-TTS-Server)
```

- Modifier `synthesize_chatterbox()` dans tts-server.py pour faire un `requests.post("http://127.0.0.1:9200/tts", ...)` au lieu de charger le modele en processus
- Avantage: le modele tourne dans un processus dedie, pas de conflit memoire
- Le fallback Piper reste en local dans tts-server.py

Option B (remplacement direct):
- Exposer directement le Chatterbox-TTS-Server sur :9100
- Ajouter un endpoint `/synthesize` compatible avec le contrat actuel
- Plus propre mais plus de travail d'adaptation

**Recommandation**: Option A d'abord, migration vers B si stable.

### Phase 3: Voice cloning per-persona (2-3 jours)

**Objectif**: Chaque persona a sa propre voix clonee via Chatterbox.

1. Generer des samples de reference de haute qualite pour chaque persona:
   - Utiliser les samples Piper existants (`data/voice-samples/*.wav`) comme point de depart
   - Re-generer avec Chatterbox Multilingual pour une meilleure qualite
   - Ajuster manuellement: intonation, debit, expressivite
2. Uploader les samples dans la voice library du Chatterbox-TTS-Server:
   - `POST /voices` pour chaque persona
   - Nommer les voix par basename persona (schaeffer, batty, etc.)
3. Mettre a jour le `VOICE_MAP` dans tts-server.py pour mapper persona -> voix Chatterbox
4. Tester chaque persona avec un texte representatif
5. Valider la coherence de voix entre requetes (seed fixe)

## 5. Configuration recommandee pour kxkm-ai

### Hardware

- GPU: RTX 4090 (24 GB VRAM)
- CUDA: 12.8
- OS: Ubuntu 24.04

### Budget VRAM estime

| Composant | VRAM |
|---|---|
| Chatterbox Multilingual (0.5B) | ~3-4 GB |
| Chatterbox Turbo (350M) | ~2 GB |
| Ollama (qwen3:8b, quantise) | ~6-8 GB |
| Total en usage parallele | ~10-12 GB |
| Marge disponible RTX 4090 | ~12-14 GB |

Le budget VRAM est confortable. Les deux modeles Chatterbox peuvent coexister avec Ollama.

### Modeles a pre-telecharger

```bash
# Le premier appel from_pretrained() telecharge depuis HuggingFace Hub
# Cache: ~/.cache/huggingface/hub/
python3 -c "from chatterbox.mtl_tts import ChatterboxMultilingualTTS; ChatterboxMultilingualTTS.from_pretrained(device='cuda')"
python3 -c "from chatterbox.turbo_tts import ChatterboxTurboTTS; ChatterboxTurboTTS.from_pretrained(device='cuda')"
```

### Config serveur recommandee

```yaml
server:
  host: 127.0.0.1
  port: 9200
  log_file_max_size_mb: 10

model:
  engine: multilingual          # defaut FR
  device: cuda

generation_defaults:
  temperature: 0.7
  exaggeration: 0.3             # leger pour naturalite
  cfg_weight: 0.5
  speed_factor: 1.0
  seed: -1                       # aleatoire par defaut

paths:
  predefined_voices: ./voices
  reference_audio: ./reference
  output: ./output
```

## 6. Mapping des 33 personas vers des voix Chatterbox

### Strategie

- **FR personas (majorite)**: Chatterbox Multilingual, `language_id="fr"`
- **EN personas**: Chatterbox Turbo (paralinguistics) ou Multilingual `language_id="en"`
- Chaque persona utilise son propre sample de reference pour le voice cloning

### Mapping complet

| # | ID | Nick | Langue | Moteur recommande | Voice sample ref | Notes |
|---|---|---|---|---|---|---|
| 1 | schaeffer | Schaeffer | FR | Multilingual | schaeffer.wav | Precis, technique |
| 2 | batty | Batty | FR | Multilingual | batty.wav | Lyrique, sombre |
| 3 | radigue | Radigue | FR | Multilingual | radigue.wav | Calme, meditatif |
| 4 | oliveros | Oliveros | FR | Multilingual | oliveros.wav | Profond, posee |
| 5 | sunra | SunRa | FR | Multilingual | sunra.wav | Cosmique, mystique |
| 6 | haraway | Haraway | FR | Multilingual | haraway.wav | Intellectuel, militant |
| 7 | pharmacius | Pharmacius | FR | Multilingual | pharmacius.wav | Orchestrateur, neutre |
| 8 | turing | Turing | FR | Multilingual | turing.wav | Logique, questionneur |
| 9 | swartz | Swartz | FR | Multilingual | swartz.wav | Passionne, activiste |
| 10 | merzbow | Merzbow | FR | Multilingual | merzbow.wav | Bruit, intense |
| 11 | hypatia | Hypatia | FR | Multilingual | hypatia.wav | Savante, posee |
| 12 | decroux | Decroux | FR | Multilingual | decroux.wav | Corps, tension |
| 13 | mnouchkine | Mnouchkine | FR | Multilingual | mnouchkine.wav | Theatre, collectif |
| 14 | royaldlx | RoyalDeLuxe | FR | Multilingual | royaldeluxe.wav | Rue, populaire |
| 15 | ikeda | Ikeda | FR | Multilingual | ikeda.wav | Donnees, minimal |
| 16 | teamlab | TeamLab | FR | Multilingual | teamlab.wav | Ecologie numerique |
| 17 | demoscene | Demoscene | FR | Multilingual | demoscene.wav | Code, contrainte |
| 18 | pina | Pina | FR | Multilingual | pina.wav | Danse, emotion |
| 19 | grotowski | Grotowski | FR | Multilingual | grotowski.wav | Theatre, rituel |
| 20 | cirque | Fratellini | FR | Multilingual | fratellini.wav | Cirque, joie |
| 21 | curie | Curie | FR | Multilingual | curie.wav | Science, aventure |
| 22 | foucault | Foucault | FR | Multilingual | foucault.wav | Pouvoir, analyse |
| 23 | deleuze | Deleuze | FR | Multilingual | deleuze.wav | Rhizome, multiplicite |
| 24 | bookchin | Bookchin | FR | Multilingual | bookchin.wav | Ecologie sociale |
| 25 | leguin | LeGuin | FR | Multilingual | leguin.wav | Utopie, recit |
| 26 | cage | Cage | FR | Multilingual | cage.wav | Silence, hasard |
| 27 | bjork | Bjork | FR | Multilingual | bjork.wav | Voix, nature, machine |
| 28 | fuller | Fuller | FR | Multilingual | fuller.wav | Geodesique, systeme |
| 29 | tarkovski | Tarkovski | FR | Multilingual | tarkovski.wav | Temps, image |
| 30 | oram | Oram | FR | Multilingual | oram.wav | Electronique, decouverte |
| 31 | sherlock | Sherlock | FR | Multilingual | sherlock.wav | Indices, deduction |
| 32 | picasso | Picasso | FR | Multilingual | picasso.wav | Image, creation |
| 33 | eno | Eno | FR | Multilingual | eno.wav | Systemes, surprise |
| - | moorcock | Moorcock | EN | Turbo | moorcock.wav | `[laugh]` possible, multivers |

Notes:
- Toutes les personas parlent FR par defaut (systemPrompt en francais)
- Moorcock est la seule persona avec `en_GB-alan-medium` dans le VOICE_MAP actuel, candidate naturelle pour Turbo EN
- Les tags paralinguistiques (`[laugh]`, `[cough]`) sont a injecter dans le systemPrompt ou le post-processing pour les personas EN/Turbo
- L'exaggeration slider permet de differencier les tonalites: faible pour Radigue (calme), fort pour Merzbow (intense)

### Parametres d'expressivite par persona (suggestion)

| Persona | exaggeration | temperature | Notes |
|---|---|---|---|
| Pharmacius | 0.1 | 0.5 | Neutre, orchestrateur |
| Radigue | 0.1 | 0.4 | Calme, meditatif |
| Merzbow | 0.8 | 0.9 | Intense, bruitiste |
| Batty | 0.6 | 0.7 | Lyrique, emotif |
| SunRa | 0.5 | 0.8 | Cosmique, exalte |
| Schaeffer | 0.2 | 0.5 | Precis, technique |
| Sherlock | 0.3 | 0.5 | Analytique |
| Grotowski | 0.5 | 0.6 | Rituel, intense |
| Autres | 0.3 | 0.6 | Defaut equilibre |

## 7. API endpoints necessaires

### Endpoints existants dans tts-server.py (contrat actuel)

```
POST /synthesize   { text, voice, persona }  -> audio/wav
POST /compose      { prompt, duration }       -> audio/wav
GET  /health       -> { ok, backend }
```

### Endpoints cibles (Chatterbox-TTS-Server)

```
# OpenAI-compatible (drop-in pour clients OpenAI)
POST /v1/audio/speech
  Body: { model, input, voice, response_format, speed, seed }
  Response: audio/wav | audio/mp3 | audio/opus

# Endpoint natif (controle fin)
POST /tts
  Body: {
    text, voice_mode ("predefined"|"clone"),
    predefined_voice, reference_audio,
    split_text, chunk_size,
    temperature, exaggeration, cfg_weight,
    seed, speed_factor, language
  }
  Response: audio/wav

# Voice management
GET    /voices               -> liste des voix
POST   /voices               -> upload voice sample
DELETE /voices/{name}         -> supprimer voix
GET    /languages             -> langues supportees

# Health
GET    /health               -> status serveur
GET    /api/ui/initial-data   -> status complet + config

# Engine switching (devnen)
POST   /api/engine/switch     -> { engine: "multilingual"|"turbo"|"original" }
```

### Adaptation du contrat /synthesize

Pour la Phase 2 (proxy), le `tts-server.py` doit mapper:

```python
# Requete entrante (contrat actuel)
{ "text": "Bonjour", "persona": "schaeffer", "voice": "fr_FR-siwis-medium" }

# Requete sortante vers Chatterbox-TTS-Server
POST http://127.0.0.1:9200/tts
{
  "text": "Bonjour",
  "voice_mode": "predefined",
  "predefined_voice": "schaeffer",
  "temperature": 0.5,
  "exaggeration": 0.2,
  "language": "fr"
}
```

## 8. Risques et mitigations

| Risque | Impact | Probabilite | Mitigation |
|---|---|---|---|
| **VRAM OOM** avec Ollama + Chatterbox simultanes | Service down | Moyenne | Budget VRAM valide (~12 GB sur 24). Monitor `nvidia-smi`. Unload moteur non utilise. |
| **Latence Chatterbox** trop elevee pour chat temps reel | UX degradee | Moyenne | Utiliser Turbo (1-step) pour les cas sensibles a la latence. Piper fallback pour < 200ms. |
| **Qualite voice cloning FR** insuffisante | Voix non naturelle | Faible | Chatterbox Multilingual entraine sur FR. Tester avec les 33 personas. Ajuster exaggeration/temperature. |
| **Chatterbox Turbo** ne supporte pas le FR | Personas FR limitees | Certaine | Turbo = EN only. Utiliser Multilingual pour FR (toutes sauf Moorcock). |
| **Regression API** lors de la migration | Breaking change | Faible | Phase 2 en proxy: le contrat /synthesize reste identique. Tests smoke avant deploy. |
| **Deps Python** en conflit avec venv existant | Installation bloquee | Faible | Venv dedie `/home/kxkm/.venvs/chatterbox-server`, isole de `/home/kxkm/venv`. |
| **Licence Coqui CPML** (XTTS-v2) vs MIT (Chatterbox) | Legal | N/A | Migration vers Chatterbox = sortie du regime CPML. Bonus juridique. |
| **Modele HuggingFace** non disponible offline | Premiere utilisation | Faible | Pre-telecharger les modeles pendant le provisioning. Cache HF persistant. |
| **Coexistence mascarade** sur kxkm-ai | Conflit ports/GPU | Faible | Ports distincts (9200 vs 3000+). VRAM suffisante pour coexister. |

## 9. Estimation d'effort

| Phase | Tache | Effort | Prerequis |
|---|---|---|---|
| **Phase 1** | Deployer Chatterbox-TTS-Server standalone | 1-2 jours | Acces SSH kxkm-ai |
| | Configurer, tester, valider health | | |
| **Phase 2** | Modifier tts-server.py (proxy HTTP) | 1-2 jours | Phase 1 validee |
| | Tests smoke end-to-end | | |
| **Phase 3** | Voice cloning 33 personas | 2-3 jours | Phase 2 validee |
| | Upload samples, tuning expressivite | | |
| | Validation qualite par persona | | |
| **Total** | | **4-7 jours** | |

### Dependances externes

- Aucun cout cloud (tout on-prem sur kxkm-ai)
- Modeles HuggingFace gratuits (MIT)
- Pas de TOS/CPML a accepter (contrairement a XTTS-v2)

### Quick wins

1. Le `tts-server.py` charge deja `chatterbox.mtl_tts.ChatterboxMultilingualTTS` -- l'integration est a mi-chemin
2. Les voice samples existent deja dans `data/voice-samples/`
3. Le deploy script `scripts/deploy.sh --tts` est deja en place (tmux session)
4. Le contrat API `/synthesize` n'a pas besoin de changer cote client

## 10. Decision et prochaines etapes

### Recommandation

Adopter **devnen/Chatterbox-TTS-Server** comme serveur TTS principal, en remplacement progressif de l'integration directe dans tts-server.py.

### Prochaines etapes

1. [ ] Valider le spike avec l'equipe
2. [ ] Phase 1: deployer sur kxkm-ai (:9200)
3. [ ] Benchmark latence/qualite sur 5 personas representatives
4. [ ] Phase 2: modifier tts-server.py en mode proxy
5. [ ] Phase 3: voice cloning complet des 33 personas
6. [ ] Retirer la dependance XTTS-v2/Coqui (simplification, exit CPML)

---

## Sources

- https://github.com/resemble-ai/chatterbox (23 700+ stars, MIT)
- https://pypi.org/project/chatterbox-tts/ (v0.1.6)
- https://github.com/devnen/Chatterbox-TTS-Server (FastAPI, OpenAI-compat, 3 moteurs)
- https://github.com/travisvn/chatterbox-tts-api (FastAPI, OpenAI-compat, voice library)
- Code existant: `scripts/tts-server.py`, `scripts/generate-voice-samples.js`, `scripts/tts_clone_voice.py`
- Validation precedente: `docs/VOICE_CLONING_VALIDATION_2026-03-17.md`
