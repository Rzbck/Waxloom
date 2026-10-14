# Waxloom — audit complet de parité iPhone / PC et bacs à vinyles
Date : 13 octobre 2026. Branche : `fix/discovery-library-pipeline-20261013` (PR #15, brouillon).

## Périmètre et méthode

- Ancienne production : `waxloom-web:cba23e4`, Docker PC `:8091`, Tailscale HTTPS MagicDNS `:8445`.
- Toutes les modifications testées sur un conteneur Web **isolé** sur `127.0.0.1:8094`, navigateur Brave headless isolé avec CDP `:9243`. API Navidrome lue pour alimenter les écrans ; mutations API et lectures audio interceptées pour ne pas modifier la bibliothèque, les favoris ou les playlists et ne pas interrompre l'écoute de l'utilisateur.
- Résolutions vérifiées : 320×568, 375×812, 390×844, 430×932, 768×1024, 812×375 (paysage) et 1440×900.
- Les captures avant/après et les tests couvrent l'accueil, Albums, un album ouvert, Artistes, un artiste ouvert, Playlists, une playlist ouverte, Favoris, Recherche et Discovery, avec vérification des contrôles, du menu, de la mini-lecture et de la lecture plein écran. La version physique Safari iOS ne peut pas être pilotée par ce navigateur headless.

## Problèmes démontrés et corrections

1. **Next ne suivait pas les nouveautés.** Le lecteur conservait parfois Shuffle ou Repeat One lorsqu'une sélection de nouveautés démarrait. Plus rarement, une réponse tardive de récupération de file persistante écrasait une sélection déjà faite. Solution : `playSongs(..., { ordered: true })` pour la collection Nouveautés, neutralisation de Shuffle et Repeat One dans ce contexte, signalement immédiat d'une file choisie par l'utilisateur pour que la récupération initiale asynchrone ne l'écrase pas. Fonctionnement démontré sur iPhone et PC : `Alter Ego → Hometown`, et `Opal (Four Tet remix) → Alter Ego` après activation préalable de Shuffle et Repeat One. Les autres contextes peuvent garder Shuffle selon le choix explicite de l'utilisateur.
2. **Listes et grilles incohérentes entre appareils.** Un même moteur de `VinylRack` sert désormais aux Albums, aux artistes, aux playlists, aux albums d'artiste, aux Favoris, aux titres des playlists et albums ouverts, aux résultats de recherche et à Discovery, sur PC et mobile. Les listes de titres sont remplacées par `VinylSongs` avec Lecture, Favori, File, Playlist, Suppression si applicable. `VinylEntities` unifie Artistes et Playlists. Les 101 titres d'une playlist sont montrés 24 à la fois, avec chargement suivant sans remettre le bac à la première pochette. Le raccourci Fresh tracks mobile reste volontairement compact pour ne pas allonger l'accueil ; il reprend une profondeur de bac.
3. **Effet vinyle perdu ou saccadé.** Ancien système : transformation et rotation JavaScript des pochettes elles-mêmes lors du scroll, jusqu'à 25,37 px de déplacement parasite mesuré. Nouveau système : pochettes fixes dans le défilement natif, fentes de rangement **uniquement aux bords**, vinyle noir indépendant derrière chaque pochette qui monte et redescend. Quand `animation-timeline: view(inline)` est pris en charge, le disque décoratif suit le scroll **en CSS sans JS par frame** ; Safari 26.4 prend en charge l'exécution de ces animations sur son thread compositeur. Sinon, animation au repos de la pochette sélectionnée. `prefers-reduced-motion` préserve l'accessibilité. Le bandeau `WAXLOOM / RECORDS` ne revient pas.
4. **Débordement horizontal desktop détecté.** Le passage aux rails vinyles a fait grandir une colonne de grille CSS à sa largeur intrinsèque (>3000 px). Contrainte explicite `grid-template-columns:minmax(0,1fr)`, `min-width:0`, `max-width:100%` et vérification de la largeur de document par le navigateur.
5. **Rendus cachés en doublon.** Des cartes de grilles album et Discovery, cachées via CSS, étaient encore montées en parallèle et dupliquaient composants et images. Les doubles arbres React sont supprimés : un seul rendu vinyle par collection. Le code obsolète `AlbumCard` et `ArtistCard` n'est plus utilisé.
6. **Footer et petites hauteurs.** Vérification de l'absence de recouvrement des derniers éléments par le menu ou la mini-lecture. Discovery en paysage très bas conserve un défilement **interne** permettant d'atteindre actions et compteur sans sortir du plein écran.
7. **Actions et navigation.** Vérification de l'ouverture réelle des albums/artistes/playlists, visibilité et hit target du Play, clic Favori et réponse visuelle, choix Playlist et fermeture par clic extérieur. Toutes les mutations ont été interceptées ; pas de changement réel aux données.

## Commandes de validation

- `cd apps/web && npm run build` — compilation TypeScript/Vite.
- `npm run qa:vinyl` — bacs, images fixes, touche Play, défilement rapide, menu et contenus de fin de page.
- `npm run qa:home` — accueil compact, pochettes et pied de page, compatibilité bureau.
- `npm run qa:mobile` — mini-lecture, lecture plein écran, taille des commandes, favoris/playlists/file et menus.
- `npm run qa:parity` — audit indépendant mobile/PC, routes, navigation, Next/Shuffle/Repeat/restauration tardive, rendu vinyle, pagination, paysage et interactions de playlist.
- Python `pytest` pour API et `ruff`, puis `scripts/security-gate.ps1`, `git diff --check`.
- Après déploiement, comparer l'empreinte JS du Web PC local `:8091` et de Tailscale `:8445`, vérifier `/api/health`, conserver l'ancienne image et la configuration Compose en sauvegarde.

## Limites et décision

- Le comportement **réel** du scroll inertiel et des contrôles multimédias sur l'iPhone de l'utilisateur reste à confirmer sur Safari/PWA. L'émulation Chrome/Brave ne mesure pas les FPS du matériel ou les différences exactes entre versions de WebKit. Le navigateur n'a pas de droit de piloter Safari sur le téléphone.
- Pas de migration, re-tag de musique, suppression de playlists, modification de compte ou fusion sur main. Cette tranche est strictement frontend et tests ; PR #15 reste brouillon.
- Pas de réintroduction d'une grande façade ou d'un texte superposé au bas des pochettes. Les transformations scroll-continues des images ne doivent pas revenir sans un test physique iOS probant.

Références WebKit (documentation constructeur) : `https://webkit.org/blog/17862/webkit-features-for-safari-26-4/` et `https://webkit.org/blog/17333/webkit-features-in-safari-26-0/`.
