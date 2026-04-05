import os
import json
from dotenv import load_dotenv
import anthropic

# --- 1. CHARGEMENT DE LA CLÉ API ---
load_dotenv()
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# --- 2. MÉMOIRE : lecture/écriture des tâches ---
def load_tasks():
    with open("tasks.json", "r") as f:
        return json.load(f)

def save_tasks(data):
    with open("tasks.json", "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

# --- 3. LE SYSTEM PROMPT : la personnalité de l'agent ---
SYSTEM_PROMPT = """
Tu es un agent de gestion de tâches. Tu reçois une commande en langage naturel et tu réponds UNIQUEMENT avec un JSON valide, rien d'autre.

Les actions possibles sont :
- {"action": "add", "task": "nom de la tâche"}
- {"action": "list"}
- {"action": "done", "index": 0}
- {"action": "unknown"}

Exemples :
- "ajoute faire la vaisselle" → {"action": "add", "task": "faire la vaisselle"}
- "montre mes tâches" → {"action": "list"}
- "la tâche 1 est terminée" → {"action": "done", "index": 0}
"""

# --- 4. L'AGENT : il comprend et agit ---
def run_agent(user_input):
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=200,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_input}]
    )

    raw = response.content[0].text.strip()
    print(f"[DEBUG] Réponse Claude : {raw}")  # on voit ce que Claude dit

    # Nettoyer si Claude met des backticks autour du JSON
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    if not raw:
        print(" Réponse vide de Claude.")
        return

    command = json.loads(raw)

    data = load_tasks()
    tasks = data["tasks"]

    if command["action"] == "add":
        tasks.append({"task": command["task"], "done": False})
        save_tasks(data)
        print(f" Tâche ajoutée : {command['task']}")

    elif command["action"] == "list":
        if not tasks:
            print(" Aucune tâche pour l'instant.")
        else:
            print(" Tes tâches :")
            for i, t in enumerate(tasks):
                status = "✔" if t["done"] else "○"
                print(f"  {i}. [{status}] {t['task']}")

    elif command["action"] == "done":
        idx = command["index"]
        tasks[idx]["done"] = True
        save_tasks(data)
        print(f" Tâche {idx} marquée comme terminée !")

    else:
        print(" Je n'ai pas compris.")
# --- 5. LA BOUCLE : l'agent tourne en continu ---
print("Task Agent démarré. Tape 'quit' pour quitter.\n")
while True:
    user_input = input("Toi > ")
    if user_input.lower() == "quit":
        print("À bientôt !")
        break
    run_agent(user_input)