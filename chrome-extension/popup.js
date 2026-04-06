function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

function renderTasks(tasks) {
  const list = document.getElementById('task-list');

  if (tasks.length === 0) {
    list.innerHTML = '<p style="opacity:0.5;font-size:13px">Aucune tâche pour l\'instant.</p>';
    return;
  }

  list.innerHTML = tasks.map((t, i) => `
    <div class="task-item ${t.done ? 'done' : ''}" data-index="${i}">
      <span class="check-btn">${t.done ? '✔' : '○'}</span>
      ${t.task}
      ${t.deadline ? '<span class="deadline-tag">' + formatDeadline(t.deadline) + '</span>' : ''}
    </div>
  `).join('');

  list.querySelectorAll('.check-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.parentElement.dataset.index);
      markDone(index);
    });
  });
}

function formatDeadline(ts) {
  const diff = ts - Date.now();
  if (diff <= 0) return 'Expiree';
  const min = Math.floor(diff / 60000);
  if (min < 60) return 'dans ' + min + ' min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return 'dans ' + h + 'h' + (m > 0 ? m + 'min' : '');
}

const SYSTEM_PROMPT = `
Tu es un agent de gestion de tâches. Tu reçois une commande en langage naturel 
et tu réponds UNIQUEMENT avec un JSON valide, rien d'autre.
Les actions possibles sont :
- {"action": "add", "task": "nom de la tâche"}
- {"action": "list"}
- {"action": "done", "index": 0}
- {"action": "unknown"}

Règles STRICTES :
- "add" uniquement si l'utilisateur veut AJOUTER une nouvelle tâche (ajoute, je dois faire, rappelle-moi de, n'oublie pas)
- "done" uniquement si l'utilisateur dit explicitement qu'une tâche est TERMINÉE/FINIE/COMPLÉTÉE + précise laquelle
- "list" si l'utilisateur veut VOIR ses tâches
- "unknown" dans tous les autres cas

Exemples ADD :
- "ajoute faire la vaisselle" → {"action": "add", "task": "faire la vaisselle"}
- "je dois faire un projet" → {"action": "add", "task": "faire un projet"}
- "n'oublie pas la réunion" → {"action": "add", "task": "réunion"}

Exemples DONE :
- "la tâche 1 est terminée" → {"action": "done", "index": 0}
- "j'ai fini la tâche 2" → {"action": "done", "index": 1}
- "marquer la tâche 0 comme faite" → {"action": "done", "index": 0}

Exemples UNKNOWN :
- "bonjour" → {"action": "unknown"}
- "merci" → {"action": "unknown"}
`;

function loadTasks(callback) {
  chrome.storage.local.get(['tasks'], (result) => {
    callback(result.tasks || []);
  });
}

function saveTasks(tasks) {
  chrome.storage.local.set({ tasks });
}

function getStoredKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['apiKey'], (r) => resolve(r.apiKey || ''));
  });
}

async function runAgent(userInput) {
  const apiKey = document.getElementById('api-key').value || (await getStoredKey());

  if (!apiKey) {
    setStatus('Entre ta clé API Anthropic ci-dessous.');
    return;
  }

  setStatus('Claude réfléchit...');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userInput }]
      })
    });

    const data = await response.json();

    if (!data.content || !data.content[0]) {
      setStatus('Erreur API : ' + (data.error?.message || 'réponse vide'));
      return;
    }

    let jsonText = data.content[0].text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.split('```')[1].replace(/^json/, '').trim();
    }

    const command = JSON.parse(jsonText);

    loadTasks((tasks) => {
      if (command.action === 'add') {
        tasks.push({ task: command.task, done: false });
        saveTasks(tasks);
        setStatus('Tâche ajoutée : ' + command.task);

      } else if (command.action === 'list') {
        setStatus(tasks.length + ' tâche(s)');

      } else if (command.action === 'done') {
        if (tasks[command.index] !== undefined) {
          tasks[command.index].done = true;
          saveTasks(tasks);
          setStatus('Tâche ' + command.index + ' terminée !');
        } else {
          setStatus('Tâche introuvable.');
        }

      } else {
        setStatus("Je n'ai pas compris.");
      }

      renderTasks(tasks);
    });

  } catch (err) {
    setStatus('Erreur : ' + err.message);
  }
}

function markDone(index) {
  loadTasks((tasks) => {
    tasks[index].done = !tasks[index].done;
    saveTasks(tasks);
    renderTasks(tasks);
  });
}

// Clé API
document.getElementById('save-key-btn').addEventListener('click', () => {
  const key = document.getElementById('api-key').value;
  if (key.trim()) {
    chrome.storage.local.set({ apiKey: key });
    setStatus('Clé sauvegardée.');
    document.querySelector('.api-key-area').style.display = 'none';
  }
});

document.getElementById('send-btn').addEventListener('click', () => {
  const input = document.getElementById('user-input');
  if (input.value.trim()) {
    runAgent(input.value.trim());
    input.value = '';
  }
});

document.getElementById('user-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('send-btn').click();
});

// Chargement initial
loadTasks(renderTasks);

getStoredKey().then((key) => {
  if (key) {
    document.getElementById('api-key').value = key;
    document.querySelector('.api-key-area').style.display = 'none';
  }
});

// Bouton ON/OFF bulle
const toggleBtn = document.getElementById('toggle-bubble-btn');

function updateToggleBtn(visible) {
  toggleBtn.textContent = visible ? 'Visible' : 'Cachee';
  toggleBtn.style.background = visible ? '#a78bfa' : '#16213e';
  toggleBtn.style.color = visible ? 'white' : '#555';
  toggleBtn.style.borderColor = visible ? '#a78bfa' : '#555';
}

chrome.storage.local.get(['bubbleVisible'], (r) => {
  const visible = r.bubbleVisible !== false;
  updateToggleBtn(visible);
});

toggleBtn.addEventListener('click', () => {
  chrome.storage.local.get(['bubbleVisible'], (r) => {
    const newVal = r.bubbleVisible === false;
    chrome.storage.local.set({ bubbleVisible: newVal });
    updateToggleBtn(newVal);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0] || !tabs[0].id) return;
      const url = tabs[0].url || '';
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'toggle-bubble',
        visible: newVal
      }).catch(() => {});
    });
  });
});

// Rafraichit le compte a rebours toutes les 30 secondes
setInterval(() => {
  loadTasks(renderTasks);
}, 30000);