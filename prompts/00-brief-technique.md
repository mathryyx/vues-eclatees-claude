# Le brief technique

Donné à Claude en plus du brief créatif, dans un projet Remotion déjà installé. C'est lui qui fait la différence.

```
Contexte technique (outillage seulement) :
- Projet Remotion dans [dossier]. Ta composition est `[Nom]` (1080×1350, 30 fps, 450 images),
  composant `src/[nom]/[Nom].tsx` (vide, à remplacer). Tu travailles uniquement dans `src/[nom]/`.
- Paquets disponibles : remotion, @remotion/cli, react, react-dom. N'installe rien, ne télécharge rien.
  Polices système, SVG, CSS, canvas, 3D faite à la main en code.
- Les étiquettes doivent être techniquement exactes. Objet générique, aucune marque.
- Son : script Node sans dépendance qui écrit un WAV dans `public/[nom]/`, joué avec
  `Html5Audio` + `staticFile('[nom]/….wav')`. Cale les mouvements sur le rythme.
- Animation déterministe, pilotée par useCurrentFrame() / interpolate / spring / Sequence.
- Pour regarder une image : `npx remotion still src/index.ts [Nom] out/work/f-NNN.png --frame=NNN --scale=0.5`,
  puis lis le PNG. Regarde beaucoup d'images clés et corrige tout ce qui est faible, faux en perspective,
  mal trié en profondeur, chevauché ou illisible sur téléphone, autant de fois que nécessaire.
- Rendu final : `npx remotion render src/index.ts [Nom] out/[nom].mp4 --crf=20`, avec le son.
```

Pour les vidéos suivantes de la série, une ligne en plus : « Tu peux lire `src/anatomy/` (moteur 3D et script audio) et copier ce qui t'est utile pour garder la même identité de série. »
