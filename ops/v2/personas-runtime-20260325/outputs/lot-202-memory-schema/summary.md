# lot-202-memory-schema

- Date: 2026-03-25T19:34:59Z
- Owner: Personas
- Status: in_progress

## Etat actuel

- La memoire persona active reste hors runtime v2-local:
  - stockage: `data/persona-memory/{Nick}.json`
  - schema: `{ nick, facts[], summary, lastUpdated }`
- Les consommateurs actifs sont encore couples a ce schema:
  - `apps/api/src/ws-persona-router.ts`
  - `apps/api/src/ws-conversation-router.ts`
  - `apps/api/src/ws-commands-info.ts`
  - `apps/api/src/ws-commands-chat.ts` (`/memory-wipe`)
- Le stockage est adresse par `nick`, pas par `personaId`.

## Schema cible v2

```ts
interface PersonaMemoryRecordV2 {
  version: 2;
  personaId: string;
  personaNick: string;
  updatedAt: string;
  workingMemory: {
    facts: string[];
    summary: string;
    lastSourceMessages: string[];
  };
  archivalMemory: {
    facts: Array<{
      text: string;
      firstSeenAt: string;
      lastSeenAt: string;
      source: "chat";
    }>;
    summaries: Array<{
      text: string;
      createdAt: string;
    }>;
  };
  compat: {
    facts: string[];
    summary: string;
    lastUpdated: string;
  };
}
```

## Layout cible

- Nouveau dossier: `data/v2-local/persona-memory/`
- Un fichier par persona: `data/v2-local/persona-memory/{personaId}.json`
- La vue `compat` sert de pont temporaire pour `/memory`, `/stats` et `withPersonaMemory()`

## Migration douce recommandee

1. Introduire un repo/shared module `persona-memory-store.ts`
2. Faire lire ce module a `ws-persona-router.ts`
3. Migrer automatiquement `data/persona-memory/{Nick}.json` vers `data/v2-local/persona-memory/{personaId}.json` au premier load
4. Basculer `/memory-wipe` vers ce module au lieu d ecrire le fichier a la main
5. Garder la vue `compat` pendant la transition puis retirer l ancien schema

## Sous-taches cloturees

- `schema-v2`: done
- `storage-layout`: done

## Sous-tache restante

- `migration-soft`: pending
