# Vues éclatées, écrites par Claude

Une série de vidéos de motion design en 3D isométrique (une serrure, une montre mécanique, une carte graphique, une manette), entièrement écrites en code par Claude, avec [Remotion](https://github.com/remotion-dev/remotion).

- Pas de Blender, pas d'After Effects.
- Le moteur 3D (projection, tri en profondeur, traits) est écrit à la main dans chaque dossier : `engine.ts`.
- La musique et les sons aussi : `make-audio.mjs` fabrique un WAV sans aucun échantillon.
- Chaque vidéo part d'un seul brief créatif, dans [`prompts/`](prompts/).

Format : 1080×1350 (4:5), 30 images/s, 15 secondes, 120 BPM.

## Refaire les vidéos

Il faut Node 18 ou plus récent.

```bash
npm install
npm run audio          # fabrique les sons dans public/
npm run studio         # ouvre l'aperçu dans le navigateur
npm run render:serrure # ou :montre, :carte-graphique, :manette
```

Les vidéos sortent dans `out/`. Au premier rendu, Remotion télécharge son propre navigateur de rendu.

## Ce qu'il y a dedans

| Dossier | Vidéo | Composition |
|---|---|---|
| `src/anatomy/` | Manette (FIG. 01) | `Manette` |
| `src/lock/` | Serrure à goupilles, en coupe puis éclatée (FIG. 02) | `Serrure` |
| `src/watch/` | Montre mécanique (FIG. 03) | `Montre` |
| `src/gpu/` | Carte graphique (FIG. 04) | `CarteGraphique` |

Dans chaque dossier :
- `model.ts` : l'objet, pièce par pièce ;
- `engine.ts` : le petit moteur 3D ;
- `[Nom].tsx` : l'animation ;
- `make-audio.mjs` : la musique et les sons.

## Comment je les fais faire à Claude

Deux briefs séparés :

1. **Le brief créatif** : court, visuel, une seule idée. Exemple dans [`prompts/02-serrure.md`](prompts/02-serrure.md).
2. **Le brief technique** : l'outillage et une règle qui change tout, « regarde tes propres images clés et corrige ce qui est faible ». Claude rend des images fixes, les relit, voit ses défauts et les corrige seul. Le texte complet est dans [`prompts/00-brief-technique.md`](prompts/00-brief-technique.md).

Pour faire ta propre vue éclatée : copie un dossier, change l'objet dans le brief créatif, et donne les deux briefs à Claude Code dans ce projet.

## Licence

Le code de ce dépôt est sous licence MIT (voir `LICENSE`).

Remotion a sa propre licence : gratuite pour les particuliers et les petites entreprises, payante au-delà. Vérifie [les conditions de Remotion](https://www.remotion.dev/license) avant un usage commercial.
