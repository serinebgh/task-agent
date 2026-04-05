import os
import json
from dotenv import load_dotenv
import anthropic

load_dotenv()
client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

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


def load_tasks():
    with open("tasks.json", "r") as f:
        return json.load(f)


def save_tasks(data):
    with open("tasks.json", "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def parse_response(raw):
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


def run_agent(user_input):
    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=200,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_input}]
    )

    raw = parse_response(response.content[0].text.strip())

    if not raw:
        print("Je n'ai pas compris.")
        return

    command = json.loads(raw)
    data = load_tasks()
    tasks = data["tasks"]

    if command["action"] == "add":
        tasks.append({"task": command["task"], "done": False})
        save_tasks(data)
        print(f"Tâche ajoutée : {command['task']}")

    elif command["action"] == "list":
        if not tasks:
            print("Aucune tâche pour l'instant.")
        else:
            for i, t in enumerate(tasks):
                status = "✔" if t["done"] else "○"
                print(f"  {i}. [{status}] {t['task']}")

    elif command["action"] == "done":
        idx = command["index"]
        tasks[idx]["done"] = True
        save_tasks(data)
        print(f"Tâche {idx} terminée !")

    else:
        print("Je n'ai pas compris.")


if __name__ == "__main__":
    print("Task Agent — tape 'quit' pour quitter.\n")
    while True:
        user_input = input("› ")
        if user_input.lower() == "quit":
            break
        run_agent(user_input)