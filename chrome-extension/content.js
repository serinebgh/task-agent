let isDragging = false;
let offsetX = 0;
let offsetY = 0;
let hasMoved = false;
let pendingReminders = [];
let firedReminders = {};

// Bulle
const bubble = document.createElement('div');
bubble.id = 'task-bubble';
bubble.textContent = '✓';
document.body.appendChild(bubble);

// Panel
const panel = document.createElement('div');
panel.id = 'task-panel';
panel.innerHTML = `
  <div id="task-panel-header">
    <span>Mes tâches</span>
    <span id="task-panel-close">✕</span>
  </div>
  <div id="bubble-task-list"></div>
  <div id="task-input-area">
    <input type="text" id="bubble-input" placeholder="Nom de la tâche..." />
    <input type="number" id="bubble-deadline" placeholder="Deadline dans X min (optionnel)" min="1" />
    <input type="text" id="bubble-reminders" placeholder="Rappels : 60, 30, 10 min avant (optionnel)" />
    <button id="bubble-add-btn">Ajouter</button>
  </div>
  <div id="bubble-status"></div>
`;
document.body.appendChild(panel);

// Modale de rappel
const overlay = document.createElement('div');
overlay.id = 'task-modal-overlay';
overlay.innerHTML = `
  <div id="task-modal">
    <div id="task-modal-title">Rappel</div>
    <div id="task-modal-list"></div>
    <button id="task-modal-close">OK, compris</button>
  </div>
`;
document.body.appendChild(overlay);

document.getElementById('task-modal-close').addEventListener('click', () => {
  overlay.classList.remove('open');
  pendingReminders = [];
});

// Position initiale
bubble.style.bottom = '30px';
bubble.style.right = '30px';
bubble.style.top = 'auto';
bubble.style.left = 'auto';

// ON/OFF au chargement
chrome.storage.local.get(['bubbleVisible'], (r) => {
  if (r.bubbleVisible === false) {
    bubble.style.visibility = 'hidden';
    panel.classList.remove('open');
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.bubbleVisible) {
    const visible = changes.bubbleVisible.newValue !== false;
    bubble.style.visibility = visible ? 'visible' : 'hidden';
    if (!visible) panel.classList.remove('open');
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'toggle-bubble') {
    bubble.style.visibility = msg.visible ? 'visible' : 'hidden';
    if (!msg.visible) panel.classList.remove('open');
  }
  if (msg.type === 'reminder') {
    showNotification(msg.text);
    renderBubbleTasks();
  }
});

// Drag
bubble.addEventListener('mousedown', (e) => {
  isDragging = true;
  hasMoved = false;
  bubble.classList.add('dragging');
  const rect = bubble.getBoundingClientRect();
  offsetX = e.clientX - rect.left;
  offsetY = e.clientY - rect.top;
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  hasMoved = true;
  const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - 52));
  const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - 52));
  bubble.style.left = x + 'px';
  bubble.style.top = y + 'px';
  bubble.style.right = 'auto';
  bubble.style.bottom = 'auto';
  if (panel.classList.contains('open')) positionPanel();
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    bubble.classList.remove('dragging');
  }
});

// Ouvre / ferme
bubble.addEventListener('click', () => {
  if (hasMoved) return;
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) {
    renderBubbleTasks();
    positionPanel();
    setTimeout(() => {
      const input = document.getElementById('bubble-input');
      if (input) input.focus();
    }, 50);
  }
});

document.getElementById('task-panel-close').addEventListener('click', () => {
  panel.classList.remove('open');
});

document.getElementById('bubble-add-btn').addEventListener('click', addTask);
document.getElementById('bubble-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTask();
});

function addTask() {
  const input = document.getElementById('bubble-input');
  const deadlineInput = document.getElementById('bubble-deadline');
  const remindersInput = document.getElementById('bubble-reminders');

  const text = input.value.trim();
  if (!text) return;

  const deadlineMinutes = parseInt(deadlineInput.value);
  const deadline = (!isNaN(deadlineMinutes) && deadlineMinutes > 0)
    ? Date.now() + deadlineMinutes * 60 * 1000
    : null;

  // Parse les rappels : "60, 30, 10" → [60, 30, 10]
  let reminders = [];
  if (deadline && remindersInput.value.trim()) {
    reminders = remindersInput.value
      .split(',')
      .map(r => parseInt(r.trim()))
      .filter(r => !isNaN(r) && r > 0);
  }

  chrome.storage.local.get(['tasks'], (result) => {
    const tasks = result.tasks || [];
    tasks.push({ task: text, done: false, deadline, reminders });
    chrome.storage.local.set({ tasks }, () => {
      input.value = '';
      deadlineInput.value = '';
      remindersInput.value = '';
      setBubbleStatus('Tâche ajoutée.');
      renderBubbleTasks();

      // Crée une alarme par rappel
      if (deadline && reminders.length > 0) {
        reminders.forEach((minBefore) => {
          const when = deadline - minBefore * 60 * 1000;
          if (when > Date.now()) {
            chrome.runtime.sendMessage({
              type: 'set-alarm',
              name: text + '|' + minBefore,
              label: text,
              minutesBefore: minBefore,
              when
            });
          }
        });
      } else if (deadline) {
        // Pas de rappels définis → rappel automatique 5 min avant
        const when = deadline - 5 * 60 * 1000;
        if (when > Date.now()) {
          chrome.runtime.sendMessage({
            type: 'set-alarm',
            name: text + '|5',
            label: text,
            minutesBefore: 5,
            when
          });
        }
      }
    });
  });
}

function positionPanel() {
  const rect = bubble.getBoundingClientRect();
  const panelW = 300;
  const panelH = panel.offsetHeight || 380;

  let top = rect.bottom + 8;
  if (top + panelH > window.innerHeight - 10) top = rect.top - panelH - 8;

  let left = rect.left;
  if (left + panelW > window.innerWidth - 10) left = window.innerWidth - panelW - 10;
  if (left < 10) left = 10;

  panel.style.top = top + 'px';
  panel.style.left = left + 'px';
}

function formatDeadline(ts) {
  const diff = ts - Date.now();
  if (diff <= 0) return 'Expiree';
  const min = Math.floor(diff / 60000);
  const sec = Math.floor((diff % 60000) / 1000);
  if (min === 0) return 'dans ' + sec + 's';
  if (min < 60) return 'dans ' + min + 'min ' + sec + 's';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return 'dans ' + h + 'h' + (m > 0 ? m + 'min' : '');
}

function renderBubbleTasks() {
  chrome.storage.local.get(['tasks'], (result) => {
    const tasks = result.tasks || [];
    const list = document.getElementById('bubble-task-list');
    if (!list) return;

    if (tasks.length === 0) {
      list.innerHTML = '<p class="bubble-task-empty">Aucune tâche pour l\'instant.</p>';
      return;
    }

    list.innerHTML = tasks.map((t, i) => {
      let deadlineHtml = '';
      if (t.deadline) {
        deadlineHtml = '<span class="bubble-deadline">Deadline : ' + formatDeadline(t.deadline) + '</span>';
      }
      let remindersHtml = '';
      if (t.reminders && t.reminders.length > 0) {
        remindersHtml = '<span class="bubble-reminders-tag">Rappels : ' + t.reminders.join(', ') + ' min avant</span>';
      }
      return `
        <div class="bubble-task-item ${t.done ? 'done' : ''}" data-index="${i}">
          <span class="bubble-check">${t.done ? '✔' : '○'}</span>
          <span class="bubble-task-text">
            ${t.task}
            ${deadlineHtml}
            ${remindersHtml}
          </span>
          <span class="bubble-delete" data-index="${i}">✕</span>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.bubble-check').forEach((btn) => {
      btn.addEventListener('click', () => {
        toggleTask(parseInt(btn.closest('.bubble-task-item').dataset.index));
      });
    });

    list.querySelectorAll('.bubble-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        deleteTask(parseInt(btn.dataset.index));
      });
    });
  });
}

function toggleTask(index) {
  chrome.storage.local.get(['tasks'], (result) => {
    const tasks = result.tasks || [];
    tasks[index].done = !tasks[index].done;
    chrome.storage.local.set({ tasks }, renderBubbleTasks);
  });
}

function deleteTask(index) {
  chrome.storage.local.get(['tasks'], (result) => {
    const tasks = result.tasks || [];
    tasks.splice(index, 1);
    chrome.storage.local.set({ tasks }, renderBubbleTasks);
  });
}

function setBubbleStatus(msg) {
  const s = document.getElementById('bubble-status');
  if (!s) return;
  s.textContent = msg;
  setTimeout(() => { s.textContent = ''; }, 2500);
}

function showNotification(msg) {
  pendingReminders.push(msg);
  const list = document.getElementById('task-modal-list');
  list.innerHTML = pendingReminders.map(r =>
    '<div class="modal-reminder-item">' + r + '</div>'
  ).join('');
  overlay.classList.add('open');
}

// Compte a rebours en direct
setInterval(() => {
  if (panel.classList.contains('open')) renderBubbleTasks();
}, 1000);

// Verifie les rappels toutes les 30 secondes
setInterval(() => {
  chrome.storage.local.get(['tasks'], (result) => {
    const tasks = result.tasks || [];
    const now = Date.now();

    tasks.forEach((t) => {
      if (t.done || !t.deadline) return;
      const reminders = t.reminders && t.reminders.length > 0 ? t.reminders : [5];

      reminders.forEach((minBefore) => {
        const triggerTime = t.deadline - minBefore * 60 * 1000;
        const key = t.task + '|' + minBefore;

        // Declenche si on est dans la fenetre de 30s autour du moment prevu
        if (!firedReminders[key] && now >= triggerTime && now < triggerTime + 30000) {
          firedReminders[key] = true;
          const diff = t.deadline - now;
          const minLeft = Math.round(diff / 60000);
          showNotification(
            t.task + ' — il reste ' + (minLeft > 0 ? minLeft + ' min' : 'moins d\'1 min') + ' avant la deadline'
          );
        }
      });
    });
  });
}, 30000);