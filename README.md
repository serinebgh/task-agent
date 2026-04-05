#Task Agent

Un agent IA de gestion de tâches en langage naturel, propulsé par Claude (Anthropic).

Parle à l'agent en français pour gérer des tâches :
- "ajoute faire les courses" → ajoute une tâche
- "montre mes tâches" → liste toutes les tâches
- "la tâche 0 est terminée" → marque comme faite

## Stack
- Python 3.x
- Claude API (Anthropic)
- JSON pour la persistance des données

## Installation
```bash
pip install anthropic python-dotenv
```
Crée un fichier `.env` avec ta clé :
