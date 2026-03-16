# Memoire Projet - KXKM_Clown

## Intention centrale

Produit prive multi-utilisateur, architecture locale, identite IRC forte, Node Engine central.

## Decisions actives

- V1 reste reference fonctionnelle
- V2 est active (api/web/worker + domaines packages)
- Exploitation preferee en TUI avec logs lisibles puis purge controlee
- Pas d exposition internet publique

## Memo operationnel 2026-03-16

- Incoherence detectee docs vs code: plusieurs items marques prevu etaient deja operationnels
- Correctif applique: pipeline ops/v2 quoting PATH pour compatibilite chemins macOS avec espaces
- Correctif applique: apps/api exige DATABASE_URL en production
- Validation operee: lot-2-domaines relance et passe en done
- Hygiene appliquee: logs lot-2 analyses puis purges, outputs CSV conserves

## Prochain focus

- lot-3-surfaces
- lot-4-bascule
- rehearsal migration Postgres + parity end-to-end
