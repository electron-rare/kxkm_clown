# LOT-204 — Training Spike: OpenCharacter + PCL sur les Personas KXKM

> Spike de recherche — session 2026-03-26
> Objectif: évaluer la faisabilité de fine-tuner un LLM open-source sur les 17 personas
> actuelles du projet pour en faire un modèle deployable sous Ollama.

---

## 1. OpenCharacter — Vue d'ensemble

### Qu'est-ce que c'est

OpenCharacter (arxiv 2501.15427, janvier 2025) est un framework de recherche pour
entraîner des LLMs à jouer des personnages customisables avec une généralisation forte
entre personnages. L'approche clé est la synthèse massive de données à partir de
**Persona Hub** (1 milliard de profils synthétiques issus du web) pour créer des
dialogues d'instruction alignés sur chaque personnage.

### Architecture et méthode

Deux stratégies de génération de données :

1. **Response Rewriting** — prendre des réponses génériques existantes et les réécrire
   dans le style du personnage (plus rapide, moins de données fraîches)
2. **Response Generation** — générer de zéro des dialogues instruction-tuning complets
   à partir du profil de personnage (meilleure couverture stylistique)

Pipeline complet :
```
Persona Hub profiles
      ↓
Character profile synthesis (traits, style, valeurs, catchphrases)
      ↓
Dialogue generation (rewriting OU generation)
      ↓
SFT sur LLaMA-3 8B Instruct
      ↓
Modèle capable de jouer N personnages différents sans réentraînement
```

### Résultats publiés

- Base : LLaMA-3 8B Instruct
- Résultat : comparable à GPT-4o sur les benchmarks de role-playing dialogue
- Dataset public : `xywang1/OpenCharacter` sur HuggingFace
- Code public : `github.com/maiush/OpenCharacterTraining` (OpenRLHF + vLLM)

### Projet connexe — OpenCharacterTraining (arxiv 2511.01689)

Même logique mais approche Constitutional AI :
- 11 personas entraînées (sarcasme, humour, poétisme, mathématiques, etc.)
- Modèles : LLaMA 3.1 8B, Qwen 2.5 72B, Gemma 3 4B
- Adapters LoRA publiés sur HuggingFace
- Framework : OpenRLHF (nécessite multi-GPU pour 72B, RTX 4090 suffit pour 8B/4B)

### Requirements GitHub (OpenCharacterTraining)

```
Python >= 3.10
CUDA GPU (RTX 3090/4090 suffisant pour les petits modèles)
PyTorch + Flash Attention (optionnel)
vLLM (inférence teacher model)
OpenRLHF (fine-tuning SFT/DPO)
```

---

## 2. PCL — Persona-Aware Contrastive Learning

### Référence

Arxiv 2503.17662 — "Enhancing Persona Consistency for LLMs' Role-Playing using
Persona-Aware Contrastive Learning" — ACL Findings 2025.
Auteurs : Ke Ji, Yixin Lian et al.

### Problème adressé

Les LLMs manquent de **cohérence de persona** sur les échanges longs : ils dérivent
du style, oublient les traits de personnage, perdent l'affect émotionnel. Le SFT
standard corrige le comportement moyen mais ne garantit pas la consistance.

### Méthode — deux composants

**1. Role Chain Method**
Le modèle est entraîné à se **poser des questions sur son propre rôle** avant de
répondre. Mécanisme de self-questioning structuré :
```
[Prompt utilisateur]
  → "Étant donné mon rôle de [persona], quels traits dois-je exprimer ici ?"
  → "Ma réponse précédente était-elle cohérente avec ce rôle ?"
  → [Réponse finale alignée sur la persona]
```

**2. Iterative Contrastive Learning**
Génération de paires contrastives automatiques :
- Réponse "avec conscience du rôle" (chosen)
- Réponse "sans conscience du rôle" (rejected)

Ces paires alimentent un entraînement DPO ou contrastive loss itératif.

### Différence fondamentale avec SFT standard

| Aspect | SFT standard | PCL |
|--------|-------------|-----|
| Annotation | Manuelle (coûteuse) | Automatique (annotation-free) |
| Cible | Comportement moyen correct | Cohérence de persona sur la durée |
| Mécanisme | Imitation de exemples | Contraste chose/rejeté + self-questioning |
| Multi-tour | Pas garanti | Optimisé pour multi-turn |
| Coût données | Élevé | Faible (synthèse automatique) |

### Résultats

Surpasse les LLMs vanilla sur CharEval et GPT-4 auto-evaluation, à la fois sur les
modèles black-box (via prompting) et white-box (via fine-tuning). Publié dans ACL 2025
Findings — méthode peer-reviewed.

---

## 3. Inventaire des Personas KXKM disponibles pour l'entraînement

Le projet dispose de **17 personas** dans `data/v2-local/personas/` avec systemPrompt,
model assigné et summary. Voici les 5 candidates prioritaires pour un premier run :

### Persona 1 — Leary (Timothy Leary)
```json
{
  "id": "leary",
  "model": "mythalion:latest",
  "summary": "Timothy Leary — psychédélique, expansion de conscience",
  "systemPrompt": "Tu es psychédélique, expansif, tu explores les états de conscience..."
}
```
Style : expansif, références psychédéliques, perception altérée. Style oral fort.

### Persona 2 — Gibson (William Gibson)
```json
{
  "id": "gibson",
  "model": "nollama/mythomax-l2-13b:Q4_K_M",
  "summary": "William Gibson — cyberpunk, neuromancien, street tech",
  "systemPrompt": "Tu es cyberpunk, street-level. 'The sky above the port...' Tu parles de hacking, de la rue..."
}
```
Style : street-level, dense, imagerie visuelle forte. Bon candidat SFT (style très distinct).

### Persona 3 — Herbert (Frank Herbert)
```json
{
  "id": "herbert",
  "model": "nollama/mythomax-l2-13b:Q4_K_M",
  "summary": "Frank Herbert — Dune, écologie, prescience, pouvoir",
  "systemPrompt": "Tu es prescient et écologiste. 'Fear is the mind-killer.' Tu parles de pouvoir..."
}
```
Style : aphoristique, systémique, sentences courtes et denses.

### Persona 4 — Pharmacius (orchestrateur)
```json
{
  "id": "pharmacius",
  "model": "qwen2.5:14b",
  "summary": "Pharmacius — orchestrateur, ajuste les personas, maintient leur cohérence",
  "systemPrompt": "...directeur éditorial technique: précis, concret, sans folklore inutile, toujours en français."
}
```
Style : méta-persona, ton éditorial technique. Idéal pour valider la PCL (cohérence fonctionnelle).

### Persona 5 — Batty (Roy Batty / Blade Runner)
```json
{
  "id": "batty",
  "model": "mistral:7b",
  "summary": "Roy Batty — Blade Runner, rapide, poétique, intense",
  "systemPrompt": "Tu es intense, poétique, tu parles avec urgence. 'J'ai vu des choses...' Références Blade Runner, Philip K. Dick."
}
```
Style : urgent, poétique, IA existentielle. Fort signal stylistique, bon pour évaluation humaine.

### Autres personas disponibles (12 restantes)

`anarchiste`, `ikeda`, `leckie`, `lessig`, `mistral`, `moorcock`, `oliveros`,
`radigue`, `russell`, `schaeffer`, `sunra`, `tolkien`

---

## 4. Pipeline Proposé

### Vue globale

```
[Personas KXKM JSON]
       ↓
Step 1: Génération de dialogues synthétiques (Ollama local)
       ↓
Step 2: Formatting dataset SFT + DPO (JSONL)
       ↓
Step 3: Fine-tuning Unsloth/TRL (LoRA QLoRA)
       ↓
Step 4: Export GGUF → Ollama
       ↓
[Modèle persona-aware deployé]
```

---

### Step 1 — Génération de dialogues synthétiques

**Outil** : Ollama local (qwen2.5:14b ou mistral:7b comme teacher model)

**Approche OpenCharacter adaptée** :
- Pour chaque persona, générer 200-500 paires `(question, réponse_in_style)`
- Couvrir 5-8 domaines thématiques par persona (en-dehors de son domaine "naturel"
  pour forcer la généralisation stylistique)
- Utiliser le systemPrompt existant comme "constitution" de la persona

**Script de génération (pseudo-logique)** :
```js
// Pour chaque persona dans data/v2-local/personas/
// Pour chaque topic dans ["philosophie", "technologie", "art", "quotidien", ...]
//   Prompt teacher_model:
//   "Génère une question naturelle sur le sujet [TOPIC].
//    Puis génère une réponse comme si tu étais [PERSONA] avec ce style :
//    [SYSTEM_PROMPT]"
// Output : { prompt, chosen, persona_id }
```

**Approche PCL — paires contrastives automatiques** :
```js
// Pour chaque dialogue généré avec persona-awareness :
//   Générer une version "sans persona" (réponse générique)
//   → pair { prompt, chosen: persona_response, rejected: generic_response }
```

**Volume estimé** : 5 personas × 300 paires = 1500 exemples SFT + ~800 paires DPO.
Suffisant pour un LoRA de qualité démontrable.

**Temps de génération** : ~2-4h avec qwen2.5:14b sur RTX 4090 local.

---

### Step 2 — Format dataset SFT + DPO

**Format SFT (JSONL — compatible TRL/Unsloth)** :
```json
{
  "instruction": "Parle-moi de l'intelligence artificielle.",
  "input": "",
  "output": "L'IA ? Un nouveau psychédélique cognitif. Turn on, tune in, drop out — mais dans le code cette fois. [style Leary]",
  "persona": "leary"
}
```

**Format DPO (JSONL — compatible TRL DPOTrainer)** :
```json
{
  "prompt": "Parle-moi de l'intelligence artificielle.",
  "chosen": "L'IA ? Un nouveau psychédélique cognitif... [réponse in-persona]",
  "rejected": "L'intelligence artificielle est un domaine de l'informatique... [réponse générique]",
  "persona": "leary"
}
```

**Format multi-tour (pour PCL role-chain)** :
```json
{
  "conversations": [
    { "role": "system", "content": "[SYSTEM_PROMPT de la persona]" },
    { "role": "user", "content": "Question..." },
    { "role": "assistant", "content": "Réponse in-persona..." }
  ],
  "persona": "leary"
}
```

**Script existant** : `scripts/dpo-pipeline.js` génère déjà le format
`{ instruction, chosen, rejected, persona }` — compatible avec une légère adaptation
vers le format TRL.

---

### Step 3 — Entraînement avec Unsloth + TRL

**Modèle de base recommandé** : `Qwen2.5-7B-Instruct` ou `Mistral-7B-Instruct-v0.3`

Justification :
- Qwen2.5-7B : déjà utilisé dans le projet (qwen2.5:14b en prod), familier
- 7B >> 3B pour la qualité stylistique, < 13B pour tenir en VRAM avec LoRA
- Mistral 7B : déjà utilisé par batty/sunra — bonne baseline style

**Config LoRA recommandée** :
```python
# Unsloth + TRL
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name = "unsloth/Qwen2.5-7B-Instruct",
    max_seq_length = 2048,
    load_in_4bit = True,  # QLoRA
)

model = FastLanguageModel.get_peft_model(
    model,
    r = 16,           # LoRA rank
    lora_alpha = 32,
    lora_dropout = 0.1,
    target_modules = ["q_proj", "v_proj", "k_proj", "o_proj",
                      "gate_proj", "up_proj", "down_proj"],
)
```

**Phase 1 — SFT** (dialogues synthétiques) :
```python
trainer = SFTTrainer(
    model = model,
    train_dataset = persona_dataset,   # 1500 exemples
    dataset_text_field = "text",
    max_seq_length = 2048,
    num_train_epochs = 3,
    per_device_train_batch_size = 4,
    gradient_accumulation_steps = 4,   # effective batch 16
    learning_rate = 2e-4,
)
```

**Phase 2 — DPO** (paires contrastives PCL-style) :
```python
dpo_trainer = DPOTrainer(
    model = model,
    ref_model = ref_model,
    beta = 0.1,
    train_dataset = dpo_dataset,       # ~800 paires
    tokenizer = tokenizer,
    max_length = 1024,
)
```

**GPU requirements** :
- RTX 4090 (24GB VRAM) : **OK** pour Qwen2.5-7B QLoRA + batch 4
- VRAM utilisée : ~14-16GB en QLoRA 4-bit
- Temps SFT : ~45-90 min pour 1500 exemples × 3 epochs
- Temps DPO : ~30-60 min pour 800 paires × 1 epoch
- **Total estimé** : 2-3h d'entraînement sur la machine locale (i7-14700KF + RTX 4090)

---

### Step 4 — Merge + Deploy vers Ollama

**Export GGUF** (Unsloth natif) :
```python
# Merge LoRA adapter dans le modèle de base
model.save_pretrained_merged("kxkm-personas-7b", tokenizer)

# Export GGUF Q4_K_M pour Ollama
model.save_pretrained_gguf("kxkm-personas-7b-gguf",
                            tokenizer,
                            quantization_method = "q4_k_m")
```

**Modelfile Ollama** :
```
FROM ./kxkm-personas-7b-gguf/kxkm-personas-7b-q4_k_m.gguf

SYSTEM """Tu es un modèle multi-persona. Adopte le style de la persona demandée."""

PARAMETER temperature 0.8
PARAMETER top_p 0.9
```

**Deploy** :
```bash
ollama create kxkm-personas:v1 -f Modelfile
ollama run kxkm-personas:v1
```

**Intégration KXKM** : remplacer le modèle assigné à chaque persona dans
`data/v2-local/personas/*.json` par `kxkm-personas:v1` + system prompt custom.

---

## 5. Évaluation de Faisabilité

### Hardware disponible

| Composant | Disponible | Suffisant |
|-----------|-----------|-----------|
| GPU | RTX 4090 24GB | Oui (QLoRA 7B) |
| VRAM libre | ~22GB | Oui |
| RAM système | 62GB | Oui |
| Stockage | Non mesuré | Probablement OK (modèle ~4-8GB) |

### Estimation du temps total

| Étape | Durée estimée |
|-------|-------------|
| Installation dépendances (unsloth, trl, vllm) | 1-2h |
| Génération dialogues synthétiques (Ollama) | 2-4h |
| Formatting + validation dataset | 1h |
| SFT training (3 epochs, 1500 ex) | 1-2h |
| DPO training (1 epoch, 800 pairs) | 30-60 min |
| Export GGUF + test Ollama | 30 min |
| Évaluation qualitative 5 personas | 1h |
| **Total** | **7-12h** |

### Risques identifiés

**R1 — Qualité des données synthétiques** (MOYEN)
Les systemPrompts actuels sont courts (2-3 phrases). Les dialogues synthétiques générés
par un modèle 14B depuis ces prompts courts risquent d'être stylistiquement trop génériques.
Mitigation : enrichir les profils de persona avant génération (ajouter exemples de phrases,
traits négatifs, catchphrases supplémentaires).

**R2 — Catastrophic forgetting** (FAIBLE-MOYEN)
Le LoRA sur 7B avec 1500 exemples peut dégrader les capacités générales du modèle
(raisonnement, factuel). Mitigation : garder un alpha/rank modéré (r=16), conserver
le modèle de base pour les tasks non-persona.

**R3 — Collapsing styles** (MOYEN)
Avec 5 personas dans un seul modèle, le modèle peut moyenner les styles au lieu de
les distinguer nettement. Mitigation : inclure l'ID de persona dans le system prompt
au format structuré + utiliser des exemples inter-persona contrastifs dans le dataset.

**R4 — Dépendances Python lourdes** (FAIBLE)
Unsloth + TRL + Flash Attention = env Python complexe. Version conflicts possibles.
Mitigation : utiliser un venv isolé ou Docker (image `unsloth/unsloth:latest`).

**R5 — Données insuffisantes pour DPO** (FAIBLE-MOYEN)
Aucune paire feedback humain n'existe dans `data/feedback/` (répertoire vide).
Les paires DPO seront 100% synthétiques. La qualité du signal DPO dépend de la
qualité du modèle "rejected" (réponse sans persona).

### Compatibilité avec l'architecture existante

- `scripts/dpo-pipeline.js` fournit déjà la structure de données — adapter vers
  format TRL est une modification mineure (renommer `instruction` → `prompt`,
  ajout `conversations` multi-turn)
- `packages/node-engine/src/training.ts` définit déjà les hyperparamètres
  (`loraRank`, `loraAlpha`, `learningRate`) — alignés avec les valeurs recommandées
- Les modèles Ollama sont déjà gérés via `ollama-js` SDK — le déploiement d'un
  nouveau modèle GGUF s'intègre nativement

---

## 6. Recommandation — Go / No-Go pour lot-204

### Verdict : **GO (conditionnel)**

Les conditions sont réunies :
- Hardware suffisant (RTX 4090, 24GB VRAM)
- 17 personas avec systemPrompts exploitables
- Framework mature (Unsloth + TRL, docs à jour mars 2026)
- Pipeline DPO déjà partiellement codé dans le projet
- Méthodes de référence publiées et validées (OpenCharacter ACL, PCL ACL 2025)

### Conditions et périmètre recommandé

- **Périmètre réduit** : commencer avec 5 personas (Leary, Gibson, Herbert, Pharmacius, Batty)
  sur Qwen2.5-7B — pas 17 personas d'un coup
- **Enrichissement obligatoire des profils** avant génération synthétique (3-5 exemples
  de phrases par persona, liste de sujets à éviter)
- **SFT seulement pour un premier run** (pas de DPO avant validation SFT) — DPO en lot-204b
- **Évaluation humaine** avant toute intégration en production (risque de drift stylistique)

### Prochaines étapes si Go

1. **lot-204a** (1-2j) : Enrichir les 5 profils de persona + écrire script de génération
   synthétique (`scripts/generate-persona-dialogues.js`) — 300 paires par persona
2. **lot-204b** (1j) : Formatter dataset + lancer SFT Unsloth (notebook ou script Python)
3. **lot-204c** (0.5j) : Export GGUF + test Ollama + évaluation qualitative 5 personas
4. **lot-204d** (0.5j) : Si résultats satisfaisants, ajouter phase DPO (PCL contrastif)
   et documenter métriques CharEval

### Baseline de succès (Go/No-Go post-entraînement)

- Le modèle maintient le style de la persona sur 5+ tours sans dériver
- Évaluation humaine : 4/5 personas "reconnaissables" sans lire le system prompt
- Pas de dégradation notable sur les tasks de base (raisonnement simple, factuel)

---

## Références

- [OpenCharacter arxiv 2501.15427](https://arxiv.org/abs/2501.15427)
- [OpenCharacterTraining GitHub](https://github.com/maiush/OpenCharacterTraining)
- [PCL — Persona-Aware Contrastive Learning arxiv 2503.17662](https://arxiv.org/abs/2503.17662)
- [PCL — ACL 2025 Findings](https://aclanthology.org/2025.findings-acl.1344/)
- [Unsloth Qwen3 fine-tuning](https://unsloth.ai/docs/models/qwen3-how-to-run-and-fine-tune)
- [Persona Hub — 1B personas](https://arxiv.org/abs/2406.20094)
- [HuggingFace dataset xywang1/OpenCharacter](https://huggingface.co/datasets/xywang1/OpenCharacter)
- [OpenCharacterTraining arxiv 2511.01689](https://arxiv.org/pdf/2511.01689)
