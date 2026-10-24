# Waxloom — pochettes centrées et actions du lecteur
Date : 14 octobre 2026. Branche Git : `fix/discovery-library-pipeline-20261013`, PR #15 (brouillon).

## Demande utilisateur et audit visuel

Les captures Safari mobile montraient une bordure opaque autour de chaque bac qui coupait la partie supérieure du vinyle décoratif et les actions situées sous les pochettes ; le chevauchement négatif collait les disques. Le titre/compteur n'étaient actualisés qu'après un délai de 150 ms sans scroll.

## Changements ciblés

- **`VinylRack.tsx`** : sélection du disque visible à chaque frame `requestAnimationFrame`, mais état React modifié seulement lorsque l'index sélectionné change ; aucune transformation scroll-JS sur les pochettes. Le compteur, le titre et l'artiste changent sans attendre la fin du geste. Le titre long utilise `MarqueeText` et respecte `prefers-reduced-motion`. Les flèches déplacent le disque exactement au centre, une pochette à la fois ; bornes désactivées.
- **`vinyl-focus.css`** : suppression des bordures, fonds et ombres des conteneurs, suppression des façades `::before/::after` du bac, augmentation de l'espace vertical pour laisser émerger les disques noirs derrière les pochettes, et 30 px de séparation entre les pochettes sans marges négatives. Le disque sélectionné est centré sur le viewport, les voisins sont partiellement visibles de chaque côté et restent espacés. Mêmes règles sur mobile et PC. L'image elle-même reste fixe pendant le scroll natif, sans tremblement. `scroll-timeline` existante anime uniquement le disque décoratif.
- **`VinylSongs.tsx`** : plus de cinq boutons répétés et tronqués sous chaque pochette. Taper la pochette joue le morceau ; `Options` sous le carrousel permet les actions contextuelles sur **le disque sélectionné** : Lecture, Like, Playlist, Queue, et supprimer de cette playlist quand disponible. La suppression ne s'applique jamais hors d'une playlist.
- **`DiscoveryView.tsx`** : aucun bouton Télécharger / Like / Less / Report répété sur chaque pochette. Un seul `Options` contextuel sous la sélection donne accès à Télécharger (avec état), Like, Less, et signalement de source non musicale. Le petit indicateur de téléchargement sur une pochette active conserve un feedback discret. Les boutons ne masquent plus les pochettes.
- **`MobilePlayerPanel.tsx`, `Player.tsx`, `api.ts`** : les quatre commandes existantes **Favorite, Playlist, Instant mix, Queue** restent disponibles sur le player plein écran ; un cinquième bouton **Dislike** est ajouté, avec icône dédiée, état pressé et réponse backend. Sur une preview Discovery, le bouton Favorite devient Like, Like/Dislike sont autorisés, tandis que les fonctions nécessitant un fichier local (Playlist, Instant mix) restent désactivées et expliquées. Sur un fichier local, Favorite utilise le système Navidrome. Les Dislikes sont envoyés au système durable de goûts Discovery `/api/discovery/feedback` sous une clé `library:<song_id>` ; n'effacent aucun fichier et orientent les recommandations. La préférence est aussi stockée dans le cache local déjà utilisé par Discovery. Un bouton Dislike est également visible sur le lecteur desktop.

## Validation

- Code TypeScript/Vite : `npm run build`.
- Browser Brave isolé (CDP 9243) contre image Web Docker staging en localhost 8094, jamais contre la production pendant les tests.
- `npm run qa:home` : centre géométrique exact 195px sur écran 390px, écart entre pochettes **30px**, bord **0px**, mise à jour du titre environ **15ms** après déplacement. Vrai clic sur album et retour Home.
- `npm run qa:vinyl` : Albums, Favoris, Recherche, Artistes, Discovery, 320/390/1440px, action contextualisée Télécharger/Like/Less, zone d'options scrollable en paysage/petit écran ; aucune transformation de la pochette ni bandeau qui la masque.
- `npm run qa:parity` : nouveaux morceaux → Next avec anciens modes Shuffle/Repeat One, ouverture playlist/album/artiste, actions contextuelles Favorite/Playlist/Remove, cache de file sauvegardée tardive ; Like/Dislike dans le player Preview (avec audio volontairement bloqué) et formulaires de test sans écriture réelle.
- `npm run qa:mobile` : lecteur plein écran et mini-lecteur, contrôles Next/Seek, boutons **5** et leurs tailles sur 320/375/390/430/768px, Dislike et annulation, menu et contrôle du bas de page.
- Toutes les mutations HTTP pendant les tests navigateur sont interceptées localement et simulées ; audio preview / streaming bloqué où nécessaire ; aucun changement de bibliothèque/favoris réel.
- Backend pytest 13/13, ruff, `scripts/security-gate.ps1`, Git diff check ; image Docker testée avant déploiement, précédente conservée.

## À vérifier sur iPhone physique

L'inertie Safari lors d'un balayage rapide et le mouvement du disque noir en CSS sont simulés mais **pas mesurés sur appareil réel**. Le WebKit du raccourci Safari installé sur l'écran d'accueil peut se comporter différemment. Demander le retour utilisateur sans annoncer les FPS matériels comme vérifiés. La mini-app Safari/Tailscale reste la même adresse.

Pas de merge de PR, pas de changement API serveur ou de musique. Conserver les sauvegardes Docker/Compose.
