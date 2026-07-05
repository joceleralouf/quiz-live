# Quiz Live

Quiz en temps réel type Kahoot, avec une différence clé : le téléphone du joueur affiche la question complète, les 4 réponses en texte (avec les formes/couleurs classiques), le timer et un feedback immédiat. Jouable en groupe avec écran hôte projeté, ou entièrement à distance chacun sur son téléphone.

## Lancer en local (même wifi)

```bash
npm install
npm start
```

- Hôte : `http://localhost:3000/host.html` — créer/éditer le quiz, lancer la partie
- Joueurs : scanner le QR code affiché dans le lobby, ou taper l'IP locale affichée au démarrage du serveur (ex. `http://192.168.1.42:3000`) et entrer le PIN

Le pare-feu de la machine hôte doit autoriser les connexions entrantes sur le port 3000.

## Jouer à distance (sans écran partagé)

GitHub Pages ne convient pas (site statique, pas de serveur websocket). Options gratuites :

- **Render** (render.com) : nouveau Web Service depuis le repo GitHub, build `npm install`, start `npm start`. Le port est géré via `process.env.PORT` (déjà pris en charge).
- **Railway** ou **Glitch** : même principe.

Une fois déployé, le QR code et l'URL de join utilisent automatiquement le domaine public.

## Architecture

- `server.js` — Express + Socket.io, état de partie en mémoire, **une seule room à la fois** (une nouvelle partie ferme la précédente)
- `public/host.html` — éditeur de quiz (brouillon en localStorage, import/export JSON), lobby avec PIN + QR, déroulé, classement intermédiaire, podium
- `public/index.html` — interface joueur mobile, plein écran sans scroll
- `public/style.css` — styles communs
- `test-e2e.js` — test automatisé (1 hôte + 3 joueurs, partie complète) : `node server.js &` puis `node test-e2e.js`

## Scoring

Formule Kahoot : `points = round(1000 × (1 − (t / durée) / 2))` si la réponse est correcte, 0 sinon. Réponse instantanée ≈ 1000 pts, réponse à la dernière seconde ≈ 500 pts.

S'y ajoutent : un **bonus de série** (+100 par bonne réponse consécutive au-delà de la première, plafonné à +500) et des **points doublés sur la dernière question**.

## Ambiance et expérience joueur

- **Lobby vivant** : les joueurs envoient des réactions emoji (pluie d'emojis sur tous les écrans) et des petits messages (60 caractères max), anti-spam côté serveur. Les réactions sont aussi ouvertes pendant la révélation des réponses et sur le podium.
- **Avatars** : chaque joueur choisit un avatar emoji à l'inscription, affiché dans le lobby et les classements.
- **Compte à rebours 3-2-1** synchronisé avant chaque question, avec badge "points doublés" sur la finale.
- **Sons** générés en WebAudio (aucun fichier) : bips du décompte, tic-tac des 3 dernières secondes, jingle bonne/mauvaise réponse, fanfare du podium. Bouton mute en haut à droite, mémorisé par appareil.
- **Feedback enrichi** : série en cours (🔥), flèches de progression au classement (▲/▼), et affichage de la bonne réponse en cas d'erreur.
- **Écran hôte** : joueur le plus rapide affiché entre les questions, podium à révélation progressive (3e, 2e, puis 1er avec confettis).
- Toutes les animations respectent le réglage système "réduire les animations".

## Banque de quiz

Les hôtes peuvent enregistrer leurs quiz dans une banque partagée (bouton "Enregistrer dans la banque" dans l'éditeur). L'option **Quiz privé** rend le quiz visible uniquement depuis l'appareil qui l'a créé (identifiant stocké dans le navigateur). La banque est stockée dans `data/quizzes.json` côté serveur.

**Limite sur Render Free** : le système de fichiers est éphémère — la banque est effacée à chaque redéploiement ou mise en veille du serveur. Pour une banque vraiment permanente, il faut soit un plan payant avec disque persistant, soit une base de données externe. En attendant, le bouton "Exporter JSON" reste le moyen fiable de garder un quiz pour de bon.

## Règles de partie

- La question se termine quand le timer expire **ou** quand tous les joueurs ont répondu
- L'hôte peut passer une question en cours (bouton Passer)
- Si l'hôte se déconnecte, la partie est fermée pour tout le monde
- Les joueurs ne peuvent rejoindre que pendant le lobby (pas en cours de partie)

## Évolutions prévues (hors MVP)

- Multi-parties simultanées (remplacer le singleton `game` par une `Map<pin, game>`)
- Persistance durable de la banque de quiz (base de données)
- Reconnexion d'un joueur en cours de partie
- Images dans les questions, mode duo/équipes
