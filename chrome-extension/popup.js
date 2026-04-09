// ── Onboarding ───────────────────────────────────────────────────────────────
let currentStep = 1;
const totalSteps = 5;

function showOnboarding() {
  document.getElementById('onboarding').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  updateObProgress();
  setTimeout(() => document.getElementById('ob-name')?.focus(), 100);
}

function showApp() {
  document.getElementById('onboarding').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}

function updateObProgress() {
  const pct = ((currentStep - 1) / totalSteps) * 100;
  document.getElementById('ob-progress-bar').style.width = pct + '%';
  document.getElementById('ob-step-label').textContent =
    String(currentStep).padStart(2, '0') + ' / ' + String(totalSteps).padStart(2, '0');

  document.querySelectorAll('.ob-question').forEach(q => {
    q.classList.toggle('active', parseInt(q.dataset.step) === currentStep);
  });

  document.querySelectorAll('.ob-step-dot').forEach(dot => {
    const s = parseInt(dot.dataset.step);
    dot.classList.toggle('active', s === currentStep);
    dot.classList.toggle('done', s < currentStep);
  });

  const backBtn = document.getElementById('ob-back');
  backBtn.style.visibility = currentStep > 1 ? 'visible' : 'hidden';
  document.getElementById('ob-next').textContent =
    currentStep === totalSteps ? 'Terminer' : 'Continuer';
}

// Chips
document.querySelectorAll('.ob-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    chip.classList.toggle('selected');
    const selected = [...document.querySelectorAll('.ob-chip.selected')].map(c => c.dataset.val);
    document.getElementById('ob-style-value').value = selected.join(', ');
  });
});

// Enter pour avancer
document.querySelectorAll('.ob-input').forEach(input => {
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); goNext(); }
  });
});

document.getElementById('ob-next').addEventListener('click', goNext);
document.getElementById('ob-back').addEventListener('click', () => {
  if (currentStep > 1) { currentStep--; updateObProgress(); focusActiveInput(); }
});

function focusActiveInput() {
  setTimeout(() => {
    const active = document.querySelector('.ob-question.active');
    const input = active?.querySelector('input:not([type=hidden]), textarea');
    if (input) input.focus();
  }, 50);
}

function goNext() {
  if (currentStep === totalSteps) {
    finishOnboarding();
  } else {
    currentStep++;
    updateObProgress();
    focusActiveInput();
  }
}

function finishOnboarding() {
  const profile = {
    name: document.getElementById('ob-name').value.trim() || 'Utilisateur',
    job: document.getElementById('ob-job').value.trim(),
    projects: document.getElementById('ob-projects').value.trim(),
    workStyle: document.getElementById('ob-style-value').value,
    extra: document.getElementById('ob-extra').value.trim(),
    createdAt: Date.now()
  };
  chrome.storage.local.set({ userProfile: profile, onboardingDone: true }, () => {
    loadProfileIntoForm(profile);
    showApp();
    loadTasks(renderTasks);
  });
}

// ── Profil ───────────────────────────────────────────────────────────────────
function loadProfileIntoForm(profile) {
  if (!profile) return;
  document.getElementById('p-name').value = profile.name || '';
  document.getElementById('p-job').value = profile.job || '';
  document.getElementById('p-projects').value = profile.projects || '';
  document.getElementById('p-style').value = profile.workStyle || '';
  document.getElementById('p-extra').value = profile.extra || '';

  const greeting = document.getElementById('profile-greeting');
  if (profile.name) {
    greeting.textContent = profile.name + ' — profil actif. Claude utilise ce contexte dans toutes ses analyses.';
    greeting.style.display = 'block';
  } else {
    greeting.style.display = 'none';
  }
}

document.getElementById('save-profile-btn').addEventListener('click', () => {
  const profile = {
    name: document.getElementById('p-name').value.trim(),
    job: document.getElementById('p-job').value.trim(),
    projects: document.getElementById('p-projects').value.trim(),
    workStyle: document.getElementById('p-style').value.trim(),
    extra: document.getElementById('p-extra').value.trim(),
    updatedAt: Date.now()
  };
  chrome.storage.local.set({ userProfile: profile }, () => {
    loadProfileIntoForm(profile);
    const s = document.getElementById('profile-status');
    s.textContent = 'Profil enregistré.';
    setTimeout(() => { s.textContent = ''; }, 2500);
  });
});

// ── Navigation tabs ──────────────────────────────────────────────────────────
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

// ── System prompt avec profil ─────────────────────────────────────────────────
function buildSystemPrompt(profile) {
  const base = `Tu es un agent de gestion de tâches. Réponds UNIQUEMENT avec un JSON valide, rien d'autre.
Actions possibles :
- {"action": "add", "task": "nom de la tâche"}
- {"action": "list"}
- {"action": "done", "index": 0}
- {"action": "unknown"}`;

  if (!profile?.name) return base;

  return `Tu es l'assistant personnel de ${profile.name}.
${profile.job ? `${profile.name} travaille en tant que ${profile.job}.` : ''}
${profile.projects ? `Projets actuels : ${profile.projects}.` : ''}
${profile.workStyle ? `Style de travail : ${profile.workStyle}.` : ''}
${profile.extra ? `À savoir : ${profile.extra}.` : ''}

${base}

Adapte le libellé des tâches au contexte de ${profile.name} si pertinent.`;
}

// ── Agent ─────────────────────────────────────────────────────────────────────
function setStatus(msg) {
  document.getElementById('status').textContent = msg;
}

function renderTasks(tasks) {
  const list = document.getElementById('task-list');
  if (!tasks.length) {
    list.innerHTML = '<p style="color:#3d3d5c;font-size:12px;padding:8px 0">Aucune tâche pour l\'instant.</p>';
    return;
  }
  const priorityDot = { high: '— ', medium: '– ', low: '· ' };
  list.innerHTML = tasks.map((t, i) => `
    <div class="task-item ${t.done ? 'done' : ''}" data-index="${i}">
      <span class="check-btn">${t.done ? '✓' : '○'}</span>
      <span>${t.priority ? priorityDot[t.priority] : ''}${t.task}</span>
      ${t.deadline ? '<span class="deadline-tag">' + formatDeadline(t.deadline) + '</span>' : ''}
      ${t.estimatedTime ? '<span class="time-tag">' + t.estimatedTime + '</span>' : ''}
    </div>
  `).join('');
  list.querySelectorAll('.check-btn').forEach(btn => {
    btn.addEventListener('click', () => markDone(parseInt(btn.parentElement.dataset.index)));
  });
}

function formatDeadline(ts) {
  const diff = ts - Date.now();
  if (diff <= 0) return 'expiré';
  const min = Math.floor(diff / 60000);
  if (min < 60) return min + 'min';
  return Math.floor(min / 60) + 'h' + (min % 60 > 0 ? (min % 60) + 'm' : '');
}

function loadTasks(cb) { chrome.storage.local.get(['tasks'], r => cb(r.tasks || [])); }
function saveTasks(tasks) { chrome.storage.local.set({ tasks }); }
function getStoredKey() { return new Promise(r => chrome.storage.local.get(['apiKey'], d => r(d.apiKey || ''))); }
function getProfile() { return new Promise(r => chrome.storage.local.get(['userProfile'], d => r(d.userProfile || null))); }

async function runAgent(userInput) {
  const apiKey = document.getElementById('api-key').value || await getStoredKey();
  if (!apiKey) { setStatus('Clé Anthropic manquante — onglet API.'); return; }

  setStatus('...');
  const profile = await getProfile();

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
        system: buildSystemPrompt(profile),
        messages: [{ role: 'user', content: userInput }]
      })
    });

    const data = await response.json();
    if (!data.content?.[0]) { setStatus('Erreur : ' + (data.error?.message || 'réponse vide')); return; }

    let raw = data.content[0].text.trim();
    if (raw.startsWith('```')) raw = raw.split('```')[1].replace(/^json/, '').trim();
    const command = JSON.parse(raw);

    loadTasks(tasks => {
      if (command.action === 'add') {
        tasks.push({ task: command.task, done: false });
        saveTasks(tasks);
        setStatus('Ajouté : ' + command.task);
      } else if (command.action === 'list') {
        setStatus(tasks.length + ' tâche' + (tasks.length > 1 ? 's' : ''));
      } else if (command.action === 'done') {
        if (tasks[command.index]) {
          tasks[command.index].done = true;
          saveTasks(tasks);
          setStatus('Tâche ' + command.index + ' terminée.');
        } else {
          setStatus('Index introuvable.');
        }
      } else {
        setStatus('Commande non reconnue.');
      }
      renderTasks(tasks);
    });
  } catch (err) {
    setStatus('Erreur : ' + err.message);
  }
}

function markDone(index) {
  loadTasks(tasks => {
    tasks[index].done = !tasks[index].done;
    saveTasks(tasks);
    renderTasks(tasks);
  });
}

// ── Clés API ──────────────────────────────────────────────────────────────────
document.getElementById('save-key-btn').addEventListener('click', () => {
  const key = document.getElementById('api-key').value.trim();
  if (key) {
    chrome.storage.local.set({ apiKey: key });
    document.getElementById('keys-status').textContent = 'Clé Anthropic enregistrée.';
    setTimeout(() => { document.getElementById('keys-status').textContent = ''; }, 2500);
  }
});

document.getElementById('save-openai-key-btn').addEventListener('click', () => {
  const key = document.getElementById('openai-key').value.trim();
  if (key) {
    chrome.storage.local.set({ openaiKey: key });
    document.getElementById('keys-status').textContent = 'Clé OpenAI enregistrée.';
    setTimeout(() => { document.getElementById('keys-status').textContent = ''; }, 2500);
  }
});

document.getElementById('send-btn').addEventListener('click', () => {
  const input = document.getElementById('user-input');
  if (input.value.trim()) { runAgent(input.value.trim()); input.value = ''; }
});
document.getElementById('user-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('send-btn').click();
});

// ── Toggle bulle ──────────────────────────────────────────────────────────────
const toggleBtn = document.getElementById('toggle-bubble-btn');

function updateToggleBtn(visible) {
  toggleBtn.textContent = visible ? 'Active' : 'Inactive';
  toggleBtn.classList.toggle('inactive', !visible);
}

chrome.storage.local.get(['bubbleVisible'], r => updateToggleBtn(r.bubbleVisible !== false));

toggleBtn.addEventListener('click', () => {
  chrome.storage.local.get(['bubbleVisible'], r => {
    const newVal = r.bubbleVisible === false;
    chrome.storage.local.set({ bubbleVisible: newVal });
    updateToggleBtn(newVal);
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs?.[0]?.id) return;
      const url = tabs[0].url || '';
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: 'toggle-bubble', visible: newVal }).catch(() => {});
    });
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────
chrome.storage.local.get(['onboardingDone', 'userProfile', 'apiKey', 'openaiKey'], r => {
  if (!r.onboardingDone) {
    showOnboarding();
  } else {
    showApp();
    loadProfileIntoForm(r.userProfile);
    loadTasks(renderTasks);
    if (r.apiKey) document.getElementById('api-key').value = r.apiKey;
    if (r.openaiKey) document.getElementById('openai-key').value = r.openaiKey;
  }
});

setInterval(() => loadTasks(renderTasks), 30000);