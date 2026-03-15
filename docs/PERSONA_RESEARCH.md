# Veille — Personas sourcées et renforcées

## Portée

Cette note consolide la veille web sur deux axes produit:
- création d'une persona à partir d'un dossier construit depuis le web sur une personne
- renforcement et ajustement d'une persona à partir des interactions du chat

Elle sert de support au cadrage produit de KXKM_Clown. Elle ne décrit pas un état déjà implémenté.

## Ce qui ressort de la veille

### 1. Une persona robuste vient d'un grounding structuré

La littérature récente converge vers la même idée: une bonne persona conversationnelle vient moins d'un simple "grand prompt système" que d'un grounding structuré sur des sources externes ou des représentations explicites.

Sources utiles:
- Kwon et al., "Persona Refinement for Dialogue Generation" ou travaux voisins sur l'injection contrôlée de persona, ACL Industry 2023:
  https://aclanthology.org/2023.acl-industry.68/
- Pal et Traum, SIGDIAL 2025, comparaison de méthodes de grounding de personnage:
  https://aclanthology.org/2025.sigdial-1.31/
- Pal et al., COLING 2025, génération de dialogues riches en persona à partir de journaux longs:
  https://aclanthology.org/2025.coling-main.470/

Implication pour KXKM_Clown:
- il faut un dossier source séparé de la persona active
- ce dossier doit pouvoir conserver faits, oeuvres, citations, thèmes, dates et liens
- la persona runtime ne doit être qu'une synthèse opératoire de ce dossier

### 2. Le chat peut servir à extraire et affiner une persona

Plusieurs travaux montrent qu'on peut déduire ou raffiner des attributs de persona à partir du dialogue, soit par extraction de profils implicites, soit par entretiens structurés, soit par boucles de raffinement guidées par feedback.

Sources utiles:
- Wu et al., LREC 2020, extraction d'attributs utilisateur depuis des dialogues:
  https://aclanthology.org/2020.lrec-1.73/
- Hasegawa et al., IWSDS 2025, collecte semi-structurée d'attributs pilotée par LLM:
  https://aclanthology.org/2025.iwsds-1.5/
- Wang et al., ACL 2025, profils implicites et raffinement conditionné par interaction:
  https://aclanthology.org/2025.acl-long.1025/
- Baskar et al., NAACL SRW 2025, boucle de raffinement guidée par feedback:
  https://aclanthology.org/2025.naacl-srw.42/

Implication pour KXKM_Clown:
- votes, corrections admin, dérives observées et préférences implicites peuvent devenir du signal utile
- ce signal doit être stocké séparément de la persona active
- le renforcement doit produire des propositions de révision, pas des mutations silencieuses

### 3. Le renforcement ne doit pas commencer par du training

L'outillage pour l'optimisation de préférence en ligne existe, mais la veille suggère qu'il faut d'abord stabiliser la qualité et la traçabilité des signaux avant de brancher du training ou du DPO en boucle.

Sources utiles:
- TRL, documentation Online DPO:
  https://huggingface.co/docs/trl/en/online_dpo_trainer
- Calandriello et al., "Human Alignment of Large Language Models through Online Preference Optimisation", 2024:
  https://huggingface.co/papers/2403.08635

Implication pour KXKM_Clown:
- première étape: renforcement éditorial local via overrides et revue humaine
- deuxième étape éventuelle: transformer une partie du signal en données de préférence
- `training/` et `dpo/` doivent rester séparés du pipeline éditorial tant que le rôle de chaque couche n'est pas stabilisé

### 4. Les couches mémoire doivent être séparées

Les systèmes de personnages et de mémoire les plus crédibles distinguent la mémoire du personnage, la mémoire sur l'utilisateur, les faits de contexte partagés et les réglages actifs.

Source utile:
- Letta CharacterPlus, séparation mémoire partagée / mémoire privée:
  https://github.com/letta-ai/characterai-memory

Implication pour KXKM_Clown:
- séparer dossier source de persona, feedback de chat, overrides actifs et éventuelles données d'entraînement
- éviter qu'un simple échange de session devienne automatiquement un fait stable de persona

## Architecture cible suggérée

Le pipeline recommandé pour KXKM_Clown est le suivant:

1. recherche web sourcée sur une personne
2. constitution d'un dossier source local horodaté
3. synthèse d'une persona initiale
4. revue et ajustement via admin local
5. collecte de feedback via le chat
6. proposition de révision par `Pharmacius`
7. validation locale puis mise à jour des overrides actifs

## Structures de données suggérées

- `data/persona-sources/<id>.json`
- `data/persona-feedback/<id>.jsonl`
- `data/persona-proposals/<id>.jsonl`
- `data/personas.overrides.json`

## Garde-fous produits

- toute recherche web doit rester sourcée et datée
- une persona basée sur une personne réelle ne doit pas confondre faits, interprétations et stylisation
- le feedback du chat ne doit pas réécrire une persona sans validation locale
- un override actif doit toujours rester explicable par ses sources, son feedback ou une décision éditoriale

## Décision pratique pour KXKM_Clown

La bonne trajectoire n'est pas:
- "faire un prompt plus long"
- ni "envoyer directement les votes en fine-tuning"

La bonne trajectoire est:
- constituer un dossier source traçable
- dériver une persona runtime claire
- accumuler du feedback distinct
- faire proposer les ajustements par `Pharmacius`
- garder `training/` et `dpo/` comme couches séparées tant que le pipeline éditorial n'est pas solide
