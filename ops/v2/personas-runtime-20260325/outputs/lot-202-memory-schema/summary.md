# lot-202-memory-schema

- Date: 2026-03-25T20:06:53Z
- Owner: Personas
- Status: done

## Etat actuel

- La memoire persona active est maintenant servie par `apps/api/src/persona-memory-store.ts`
- Le store actif est `data/v2-local/persona-memory/{personaId}.json`
- La projection legacy `data/persona-memory/{Nick}.json` est maintenue en miroir de compatibilite
- Les consommateurs runtime bascules:
  - `apps/api/src/ws-persona-router.ts`
  - `apps/api/src/ws-conversation-router.ts`
  - `apps/api/src/ws-commands-info.ts`
  - `apps/api/src/ws-commands-chat.ts` (`/memory-wipe`)

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

## Mise en oeuvre

1. Module partage ajoute: `apps/api/src/persona-memory-store.ts`
2. Migration automatique V1 -> V2 au premier `loadPersonaMemory()`
3. Ecriture V2 per-file par `personaId`
4. Miroir compat legacy par `nick`
5. `/memory-wipe` bascule sur `resetPersonaMemory()`
6. Tests cibles ajoutes:
   - `apps/api/src/persona-memory-store.test.ts`
   - `apps/api/src/ws-conversation-router.test.ts`
   - isolation legacy memory dans `apps/api/src/app.test.ts`

## Validation

- `node --test --import tsx apps/api/src/persona-memory-store.test.ts` OK
- `node --test --import tsx apps/api/src/ws-conversation-router.test.ts` OK
- `node --test --import tsx apps/api/src/app.test.ts` OK
- `npm run check` OK
- `npm run test:v2` OK

## Sous-taches cloturees

- `schema-v2`: done
- `storage-layout`: done
- `migration-soft`: done
