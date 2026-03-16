# Veille Modèles HuggingFace & OSS — Mars 2026

Recherche ciblée sur les modèles adaptés aux thématiques de KXKM_Clown :
musique concrète, arts de la rue, arts numériques, spectacle vivant, philosophie,
cyberfeminisme, afrofuturisme, écologie, hacking.

---

## 1. Modèles de chat/persona pour Ollama

### Modèles français

| Modèle | Taille | Description | Pertinence KXKM |
| --- | --- | --- | --- |
| **Qwen3.5:9b** | 5.5 GB | Nativement multimodal (texte+image+vidéo), early fusion, 70.1 MMMU-Pro | **TOP PICK** — remplace qwen3:8b, vision native sans modèle séparé |
| **Qwen3:8b** | 5.2 GB | Texte seul, excellent chat français | Actuel, bon fallback |
| **Mistral Small 3** | ~8 GB | Très bon en français, rapide | Alternative pour Pharmacius |
| **CroissantLLM** | 1.3B | Bilingue FR/EN natif, très léger | Persona rapide, mobile |
| **Vigogne** (bofenghuang) | 7-13B | Fine-tuné français sur Mistral/Llama | Référence historique FR |
| **OpenEuroLLM-French** | variable | Modèle européen multilingue | Pour diversité linguistique |

### Modèles roleplay/persona

| Modèle | Taille | Description | Pertinence KXKM |
| --- | --- | --- | --- |
| **Pantheon-RP 1.6** | 8-22B | Personas activables par phrase, personnalités distinctes | **Très pertinent** — architecture multi-persona native |
| **Qwen3-4B-rpg-roleplay** | 2.5 GB | Fine-tuné roleplay/storytelling | Personas créatives légères |
| **MythoMakiseMerged-13B** | 7.9 GB | Excellentconversation et banter | Personas expressives |
| **Kappa-20B** | ~12 GB | 9 personas distinctes pré-entraînées | Inspiration multi-persona |
| **L3.1-RP-Hero-8B** | 4.9 GB | Roleplay + instruction following fort | Personas obéissantes |

### Recommandation immédiate

**Upgrade vers Qwen3.5:9b** — vision native intégrée, plus besoin de modèle séparé pour l'analyse d'images. Performance 22.5% supérieure à GPT-5-Nano en vision.

---

## 2. Modèles audio/musique

### Text-to-Music (génération musicale)

| Modèle | Auteur | Description | Pertinence KXKM |
| --- | --- | --- | --- |
| **ACE-Step 1.5** | ace-step | Full-song, 10s→10min, 1000+ styles, qualité commerciale | **TOP PICK** — musique concrète, noise, expérimental |
| **MusicGen** | Meta/Facebook | Text-to-music, auto-régressif, conditionné par texte | Référence, bien documenté |
| **YuE** | - | Lyrics-to-song, voix synchronisées, 5min | Pour personas qui chantent |
| **Stable Audio Open 1.0** | Stability AI | Sound design, textures, fragments audio courts | Pour effets sonores Minitel |
| **MusicGPT** | gabotechs | Génération musicale via LLM local | Intégration pipeline Node Engine |

### Text-to-Speech (TTS)

| Modèle | Description | Voix FR | Pertinence KXKM |
| --- | --- | --- | --- |
| **Coqui XTTS-v2** | Voice cloning, 17 langues, 6s de sample | Oui | **TOP PICK** — cloner des voix pour chaque persona |
| **Piper TTS** | Rapide, offline, ONNX | Oui (siwis, upmc) | Actuel, bon pour temps réel |
| **MeloTTS** | MyShell/MIT, multilingual | Oui | Alternative légère |
| **Fish Speech S2-Pro** | 526 likes, multilingual, instruction-following | Oui | Nouveau, trending, expressif |
| **HumeAI TADA-3B-ML** | Expressif, émotions, multilingual | Oui | Pour personas émotionnelles |
| **Granite-4.0-1B-Speech** | IBM, ASR+TTS, léger | Oui | Léger, bon pour STT |

### Speech-to-Text (STT)

| Modèle | Description | Pertinence KXKM |
| --- | --- | --- |
| **faster-whisper** | CTranslate2, très rapide sur GPU | Actuel, fonctionne bien |
| **Granite-4.0-1B-Speech** | IBM, léger, multilingual | Alternative légère |

---

## 3. Modèles vision / analyse d'art

| Modèle | Taille | Description | Pertinence KXKM |
| --- | --- | --- | --- |
| **Qwen3.5:9b** | 5.5 GB | Vision native early-fusion, MMMU-Pro 70.1 | **TOP PICK** — remplace qwen3-vl:8b |
| **Qwen3-VL:8b** | 6.1 GB | Vision Qwen3, bon en analyse d'images | Actuel, solide |
| **GLM-OCR** | variable | OCR universel (1285 likes, 2.6M downloads) | Pour extraction texte d'images |
| **minicpm-v** | 5.5 GB | Vision légère | Fallback |

---

## 4. Datasets pertinents

### Datasets créatifs / arts

| Dataset | Description | Pertinence KXKM |
| --- | --- | --- |
| **Creative-Professionals-Agentic-Tasks-1M** | 1M tâches créatives (art, musique, design, son, vidéo, 3D) | **TOP PICK** — training personas créatives |
| **ASID-1M** | 1M captions audiovisuelles structurées | Pour personas multimodales |
| **Edge-Agent-Reasoning-WebSearch-260K** | Raisonnement agent + web search, multi-domaines | Pour Pharmacius routeur |

### Datasets DPO / alignement

| Dataset | Description | Pertinence KXKM |
| --- | --- | --- |
| **Opus-4.6-Reasoning-3000x-filtered** | 3K examples raisonnement distillé Claude Opus | **TOP PICK** — améliorer le raisonnement de Pharmacius |
| **Open-RL** | Raisonnement sciences multi-domaines | Pour personas scientifiques |

---

## 5. Recherche académique pertinente

| Paper | Date | Résumé | Application KXKM |
| --- | --- | --- | --- |
| **Two Tales of Persona in LLMs** | Jun 2024 | Survey role-playing + personalisation LLM | Référence architecturale |
| **LLM Discussion** | Mai 2024 | Multi-LLM discussion créative avec rôles | Modèle pour inter-persona |
| **HER: Human-like Reasoning for RP** | Jan 2026 | Dual-layer thinking pour roleplay | Améliorer profondeur personas |
| **OpenCharacter** | Jan 2025 | Training personas à grande échelle | Pipeline training personas |
| **Ditto: Self-Alignment for RP** | Jan 2024 | Self-alignment pour roleplay, comparable GPT-4 | Fine-tuning personas |
| **PsyPlay** | Feb 2025 | Personnalité persistante dans les dialogues | Mémoire persona |

---

## 6. Plan d'action recommandé

### Court terme (immédiat)

1. **Pull qwen3.5:9b** sur Ollama — vision native, remplace qwen3:8b ET qwen3-vl:8b
2. **Tester Pantheon-RP** — architecture multi-persona native, inspiration
3. **Dataset Opus-4.6-Reasoning** — fine-tuner Pharmacius pour meilleur raisonnement

### Moyen terme

4. **Coqui XTTS-v2** pour voice cloning — voix unique par persona depuis un sample audio
5. **ACE-Step 1.5** pour génération musicale — intégrer au Node Engine
6. **Creative-Professionals-1M** dataset — enrichir les personas arts

### Long terme

7. **Fine-tuner un modèle persona dédié** avec Ditto/OpenCharacter methodology
8. **Intégrer MusicGen** dans le pipeline Node Engine pour génération audio
9. **Fish Speech S2-Pro** pour TTS expressif et émotionnel

---

Sources:
- [Best Local LLM Models 2026](https://www.sitepoint.com/best-local-llm-models-2026/)
- [Best Open Source Music Generation 2026](https://www.siliconflow.com/articles/en/best-open-source-music-generation-models)
- [Best Open Source TTS 2026](https://www.bentoml.com/blog/exploring-the-world-of-open-source-text-to-speech-models)
- [Qwen3.5 on Ollama](https://ollama.com/library/qwen3.5:9b)
- [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5)
- [Pantheon-RP](https://huggingface.co/Gryphe/Pantheon-RP-1.0-8b-Llama-3)
- [CroissantLLM](https://huggingface.co/blog/manu/croissant-llm-blog)
- [Vigogne](https://github.com/bofenghuang/vigogne)
- [Fish Speech S2-Pro](https://huggingface.co/fishaudio/s2-pro)
- [Creative-Professionals-1M](https://huggingface.co/datasets/yatin-superintelligence/Creative-Professionals-Agentic-Tasks-1M)
- [Opus-4.6-Reasoning](https://huggingface.co/datasets/nohurry/Opus-4.6-Reasoning-3000x-filtered)
- [HER Paper](https://hf.co/papers/2601.21459)
- [OpenCharacter Paper](https://hf.co/papers/2501.15427)
