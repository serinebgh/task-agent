# Task Agent

Extension Chrome alimentée par Claude (Anthropic) pour gérer tes tâches, révisions et planning en langage naturel.

---

## Fonctionnalités

### Deux modes distincts
- **Mode Étudiant** — emploi du temps, révisions par matière, mode exam, stats de progression
- **Mode Pro** — agenda, pipeline kanban, gestion de projets, rapport hebdomadaire

Claude détecte automatiquement le bon mode selon ton métier à l'onboarding. Tu peux switcher à tout moment depuis le profil.

### Planning intelligent
- Calendrier semaine / jour / mois avec blocs fusionnés
- Import d'emploi du temps par PDF ou image (récurrent ou période précise)
- Planification automatique par Claude dans tes créneaux libres
- Heures de travail personnalisables, adaptables jour par jour
- Double planning indépendant si tu cumules les deux modes

### Bulle flottante
- Accessible sur toutes les pages
- Ajout de tâches en langage naturel
- Organiser avec Claude (analyse PDF + texte)
- Mode Exam — chat avec tes cours pour préparer un examen
- Timer focus / Pomodoro

### Mémoire Claude
- Se souvient des informations importantes entre les sessions
- Contexte utilisateur injecté dans chaque requête

---

## Stack

- **Extension** — Chrome Manifest V3, JavaScript vanilla
- **IA** — Claude API (Anthropic) — `claude-opus-4-6` pour les analyses multimodales, `claude-haiku-4-5` pour les actions rapides
- **Voix** — Whisper API (OpenAI) — optionnel
- **Stockage** — `chrome.storage.local`

---

## Installation

### 1. Cloner le repo

```bash
git clone https://github.com/serinebgh/task-agent.git
cd task-agent
```

### 2. Charger l'extension dans Chrome

1. Ouvre `chrome://extensions`
2. Active le **mode développeur** (coin supérieur droit)
3. Clique sur **Charger l'extension non empaquetée**
4. Sélectionne le dossier `chrome-extension/`

### 3. Configurer les clés API

Dans le popup de l'extension, onglet **API** :

- **Clé Anthropic** (obligatoire) — obtenir sur [console.anthropic.com](https://console.anthropic.com)
- **Clé OpenAI** (optionnel) — uniquement pour la saisie vocale Whisper

---

## Utilisation rapide

| Action | Exemple |
|---|---|
| Ajouter une tâche | *"rendre le rapport vendredi"* |
| Ajouter un événement | *"concours le 18 avril à 9h"* |
| Planifier | Onglet Planning → **Planifier avec Claude** |
| Importer ton EDT | Onglet Planning → **Importer EDT** (PDF ou image) |
| Préparer un exam | Bulle → **Mode Exam** |
| Révisions | *"maths 3h/sem, physique 2h/sem pour le 20 juin"* |

---

## Structure du projet

```
chrome-extension/
├── manifest.json       # Config extension (MV3)
├── popup.html          # Interface principale
├── popup.js            # Logique popup (modes, planning, stats)
├── style.css           # Thème dark / light
├── content.js          # Bulle flottante + panels injectés
├── content.css         # Styles bulle
└── background.js       # Service worker (alarmes, focus)
```

---

## Vie privée

Les clés API sont stockées localement dans `chrome.storage.local` et ne transitent jamais par un serveur tiers. Les requêtes sont envoyées directement depuis le navigateur vers l'API Anthropic.
