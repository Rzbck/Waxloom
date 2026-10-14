# Waxloom — Correction de lecture Discovery et téléchargement direct
Date : 14 octobre 2026. Branche : `fix/discovery-library-pipeline-20261013` / PR #15 (brouillon).

## Incident réel

Capture Safari iPhone de **Up — Benjamin Damage** : écran NOW PLAYING à 0:00, message « The cached Discovery preview could not be played. Press next or try again. ». Le bouton téléchargement était dissimulé derrière **Options**, depuis la refonte esthétique.

Audit sur API Docker en production, sans modification des médias :
- Journaux : **4 requêtes `GET /api/discovery/previews/{recording_mbid}` en HTTP 404** et plusieurs lectures Range en **206**, lors de l'utilisation iPhone.
- `/api/discovery/previews/status` : 34 éléments actifs, 32 prêts, 2 en échec récent. Rotation de recommandations toutes les 20 minutes ; la grâce serveur des anciens candidats ne dure que 15 minutes ; l'app Safari peut conserver un ancien feed local plus longtemps.
- Régression précise : `playPreviewTracks` assignait systématiquement `/api/discovery/previews/{mbid}` même après disparition du candidat de la rotation. L'ancien endpoint répondait 404, sans alternative ; `onError` laissait le lecteur bloqué à 0:00.
- Le serveur sait déjà produire des M4A compatibles Apple avec FFmpeg et les requêtes Range. Le flux de bibliothèque et plusieurs aperçus prêts fonctionnent.

## Corrections

1. **Backend** `apps/api/src/waxloom_api/main.py` : l'endpoint d'aperçu accepte les paramètres contrôlés `artist` et `title` en complément d'un identifiant. Si le candidat n'est plus actif, il peut le préparer à nouveau via une identité UUID valide ou un identifiant YouTube validé de 11 caractères. Aucun lien arbitraire provenant du client n'est utilisé. Le comportement sans ces paramètres conserve le 404 explicite.
2. **Frontend** `api.ts` + `Player.tsx` : génération centralisée d'une URL d'aperçu conservant identifiant/artist/title et restant **same-origin**, compatible PC `:8091` et MagicDNS Tailscale `:8445`. Lors d'un échec de source, saut automatique vers l'aperçu suivant, avec borne de 3 sauts consécutifs, et message compréhensible si la suite échoue ; aucune boucle de demandes illimitée. Ce mécanisme ne touche pas aux flux Navidrome locaux.
3. **Cache navigateur** `DiscoveryView.tsx` : les recommandations sauvegardées n'ont qu'une durée de conservation de 5 minutes. L'écran se synchronise aussi quand Safari revient au premier plan. Les anciens feeds sans horodatage interne sont invalidés. Le cache audio serveur et les fichiers musicaux ne sont pas effacés.
4. **Téléchargements sur pochettes** : un **bouton ↓** indépendant de Lecture, en haut à droite de chaque pochette Discovery, 39×39px, avec états en cours, sauvegardé (✓), relance en cas d'échec. Le composant de la file existante gère deux imports en parallèle et expose leur progression discrètement.
5. **Télécharger dans NOW PLAYING Discovery** : bouton « Download to library » au-dessous des cinq actions, uniquement pour les previews, avec état visible. Reprend le même gestionnaire de téléchargement, y compris l'ouverture du choix manuel de source si nécessaire. Playlist et Instant Mix restent réservés aux morceaux déjà indexés ; une preview non enregistrée ne propose pas faussement ces fonctions.
6. **Tests nouvellement ajoutés** : `apps/api/tests/test_preview_playback.py` couvre 404 initial, récupération en 206 avec Range, UUID et ID `yt:`, rejets d'identifiants invalides, échec 502 quand la source reste absente. `apps/web/scripts/discovery-playback-smoke.mjs` simule les échecs audio, deux imports simultanés avec étapes d'UI, et le bouton du lecteur agrandi ; toutes ses requêtes d'écriture sont interceptées et ne touchent pas aux médias.

## Contrôles réellement effectués avant la mise en ligne

- Backend : `15 passed`, lint sélectif E4/E7/E9/F/I OK ; TypeScript/Vite OK ; `git diff --check`.
- Client QA Chrome/Brave isolé sur `:8094` avec CDP isolé : `qa:discovery` PASS, **32 pochettes / 32 boutons Télécharger**, taille 39px, deux imports simultanés (pic 2) puis ✓, aperçu cassé simulé → 4 appels maximum, métadonnées présentes dans chaque URL, bouton Télécharger dans le plein écran, largeur 320px / 390px / PC 1440px sans débordement.
- `qa:home`, `qa:mobile`, `qa:vinyl` et `qa:parity` sont conservés et à relancer après reconstruction finale. Un épisode de lenteur asynchrone au premier `qa:vinyl` a disparu lors de la seconde exécution : pas de preuve d'une régression visuelle.
- **Contrôle sur les flux réels sans écouter ni importer** : 4 morceaux locaux récents (**ANVIL, Opal (Four Tet remix), Alter Ego, Hometown**) et 3 previews déjà en cache (**Resist, ACID RAIN, Tetrapod**) répondent tous en **206**, Range `bytes=0-1023` avec exactement 1024 octets lus.

## Limites

- Une source YouTube réellement supprimée, géobloquée ou impossible à récupérer peut toujours échouer ; le correctif fournit un saut automatique borné au lieu de bloquer l'app. On ne prétend pas garantir 100 % des vidéos externes.
- La fluidité et la lecture réelle sur le WebKit de l'iPhone de l'utilisateur demandent confirmation sur appareil physique ; les tests Chrome CDP ne le remplacent pas.
- Ne supprimer aucun média, playlist ou cache de l'utilisateur et ne pas fusionner la PR sans instruction. Sauvegarder Compose et les deux images Docker précédentes avant la mise à jour, et vérifier `:8091`, MagicDNS `:8445`, `/api/health` et Range à la fin.
