let isDragging = false;
let offsetX = 0;
let offsetY = 0;
let hasMoved = false;
let pendingReminders = [];
let firedReminders = {};
let attachedFiles = [];

// ── Bulle ────────────────────────────────────────────────────────────────────
const bubble = document.createElement('div');
bubble.id = 'task-bubble';
bubble.textContent = '✓';
document.body.appendChild(bubble);

// ── Panel principal ──────────────────────────────────────────────────────────
const panel = document.createElement('div');
panel.id = 'task-panel';
panel.innerHTML = `
  <div id="task-panel-header">
    <span>Mes tâches</span>
    <span id="task-panel-close">✕</span>
  </div>
  <div id="bubble-task-list"></div>
  <div id="task-input-area">
    <div class="input-with-mic">
      <input type="text" id="bubble-input" placeholder="Nom de la tâche..." />
      <button class="mic-btn" id="mic-btn-main" title="Dicter la tâche">🎙️</button>
    </div>
    <div id="mic-status-main" class="mic-status"></div>
    <input type="number" id="bubble-deadline" placeholder="Deadline dans X min (optionnel)" min="1" />
    <input type="text" id="bubble-reminders" placeholder="Rappels : 60, 30, 10 min avant (optionnel)" />
    <button id="bubble-add-btn">Ajouter</button>
    <button id="bubble-organize-btn">✦ Organiser avec Claude</button>
  </div>
  <div id="bubble-status"></div>
`;
document.body.appendChild(panel);

// ── Panel Organiser multimodal ───────────────────────────────────────────────
const organizePanel = document.createElement('div');
organizePanel.id = 'organize-panel';
organizePanel.innerHTML = `
  <div id="organize-header">
    <span>✦ Organiser avec Claude</span>
    <span id="organize-close">✕</span>
  </div>
  <p id="organize-hint">Décris ta situation à l'écrit ou à voix haute, ajoute des PDF ou images — Claude organise tout.</p>
  <div class="input-with-mic">
    <textarea id="organize-input" placeholder="Ex: J'ai un projet dev à rendre vendredi avec la doc, les tests et le déploiement..."></textarea>
    <button class="mic-btn mic-btn-top" id="mic-btn-organize" title="Dicter ta situation">🎙️</button>
  </div>
  <div id="mic-status-organize" class="mic-status"></div>
  <div id="drop-zone">
    <span id="drop-icon">📎</span>
    <span id="drop-label">Glisse tes fichiers ici<br><small>ou</small></span>
    <label id="drop-btn-label">
      Choisir des fichiers
      <input type="file" id="file-input" accept=".pdf,image/*" multiple style="display:none" />
    </label>
    <span id="drop-formats">PDF · PNG · JPG · WEBP</span>
  </div>
  <div id="file-preview-list"></div>
  <button id="organize-send-btn">Analyser et organiser</button>
  <div id="organize-result"></div>
  <div id="organize-actions" style="display:none">
    <button id="organize-import-btn">✓ Importer toutes les tâches</button>
  </div>
`;
document.body.appendChild(organizePanel);

// ── Modale rappel ────────────────────────────────────────────────────────────
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

// Init bulle
bubble.style.bottom = '30px';
bubble.style.right = '30px';
bubble.style.top = 'auto';
bubble.style.left = 'auto';

chrome.storage.local.get(['bubbleVisible'], (r) => {
  if (r.bubbleVisible === false) { bubble.style.visibility = 'hidden'; panel.classList.remove('open'); }
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
  if (msg.type === 'reminder') { showNotification(msg.text); renderBubbleTasks(); }
});

// ── Drag bulle ───────────────────────────────────────────────────────────────
bubble.addEventListener('mousedown', (e) => {
  isDragging = true; hasMoved = false;
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
  bubble.style.left = x + 'px'; bubble.style.top = y + 'px';
  bubble.style.right = 'auto'; bubble.style.bottom = 'auto';
  if (panel.classList.contains('open')) positionPanel();
});
document.addEventListener('mouseup', () => {
  if (isDragging) { isDragging = false; bubble.classList.remove('dragging'); }
});

bubble.addEventListener('click', () => {
  if (hasMoved) return;
  panel.classList.toggle('open');
  if (panel.classList.contains('open')) {
    renderBubbleTasks(); positionPanel();
    setTimeout(() => document.getElementById('bubble-input')?.focus(), 50);
  }
});

document.getElementById('task-panel-close').addEventListener('click', () => panel.classList.remove('open'));
document.getElementById('bubble-add-btn').addEventListener('click', addTask);
document.getElementById('bubble-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTask(); });
document.getElementById('bubble-organize-btn').addEventListener('click', () => {
  panel.classList.remove('open');
  organizePanel.classList.toggle('open');
  if (organizePanel.classList.contains('open')) {
    positionOrganizePanel();
    setTimeout(() => document.getElementById('organize-input')?.focus(), 50);
  }
});
document.getElementById('organize-close').addEventListener('click', () => {
  organizePanel.classList.remove('open');
  resetOrganizePanel();
});

// ── Whisper — enregistrement audio ──────────────────────────────────────────

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

async function startRecording(micBtn, statusEl, targetInputId) {
  if (isRecording) {
    stopRecording();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

    mediaRecorder.addEventListener('dataavailable', (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    });

    mediaRecorder.addEventListener('stop', async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      await transcribeWithWhisper(blob, targetInputId, statusEl);
    });

    mediaRecorder.start();
    isRecording = true;
    micBtn.classList.add('recording');
    micBtn.textContent = '⏹️';
    statusEl.textContent = '🔴 Enregistrement... (clic pour arrêter)';
    statusEl.classList.add('active');

  } catch (err) {
    statusEl.textContent = 'Micro inaccessible : ' + err.message;
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
}

async function transcribeWithWhisper(audioBlob, targetInputId, statusEl) {
  const micBtn = targetInputId === 'bubble-input'
    ? document.getElementById('mic-btn-main')
    : document.getElementById('mic-btn-organize');

  micBtn.textContent = '⏳';
  statusEl.textContent = 'Transcription en cours...';

  const openaiKey = await getOpenAIKey();
  if (!openaiKey) {
    statusEl.textContent = '⚠️ Clé OpenAI manquante — configure-la dans le popup.';
    micBtn.textContent = '🎙️';
    micBtn.classList.remove('recording');
    return;
  }

  try {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', 'whisper-1');
    formData.append('language', 'fr');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + openaiKey },
      body: formData
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    const transcription = data.text.trim();
    const targetInput = document.getElementById(targetInputId);

    if (targetInput) {
      // Ajoute au texte existant si déjà du contenu
      if (targetInput.value.trim()) {
        targetInput.value += ' ' + transcription;
      } else {
        targetInput.value = transcription;
      }
      targetInput.focus();
    }

    statusEl.textContent = '✓ Transcrit : "' + transcription.substring(0, 60) + (transcription.length > 60 ? '…' : '') + '"';
    setTimeout(() => { statusEl.textContent = ''; statusEl.classList.remove('active'); }, 4000);

  } catch (err) {
    statusEl.textContent = '⚠️ Erreur Whisper : ' + err.message;
    setTimeout(() => { statusEl.textContent = ''; statusEl.classList.remove('active'); }, 4000);
  }

  micBtn.textContent = '🎙️';
  micBtn.classList.remove('recording');
}

// Bouton micro panel principal
document.getElementById('mic-btn-main').addEventListener('click', () => {
  const statusEl = document.getElementById('mic-status-main');
  if (isRecording) {
    stopRecording();
    document.getElementById('mic-btn-main').textContent = '🎙️';
    document.getElementById('mic-btn-main').classList.remove('recording');
    statusEl.textContent = 'Arrêt...';
  } else {
    startRecording(document.getElementById('mic-btn-main'), statusEl, 'bubble-input');
  }
});

// Bouton micro panel organiser
document.getElementById('mic-btn-organize').addEventListener('click', () => {
  const statusEl = document.getElementById('mic-status-organize');
  if (isRecording) {
    stopRecording();
    document.getElementById('mic-btn-organize').textContent = '🎙️';
    document.getElementById('mic-btn-organize').classList.remove('recording');
    statusEl.textContent = 'Arrêt...';
  } else {
    startRecording(document.getElementById('mic-btn-organize'), statusEl, 'organize-input');
  }
});

// ── Gestion fichiers ─────────────────────────────────────────────────────────
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  addFiles(Array.from(e.dataTransfer.files));
});
fileInput.addEventListener('change', () => { addFiles(Array.from(fileInput.files)); fileInput.value = ''; });

function addFiles(files) {
  const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  files.forEach(f => {
    if (!allowed.includes(f.type)) return;
    if (attachedFiles.length >= 5) { setBubbleStatus('Max 5 fichiers.'); return; }
    attachedFiles.push(f);
  });
  renderFilePreviews();
}

function renderFilePreviews() {
  const list = document.getElementById('file-preview-list');
  if (attachedFiles.length === 0) { list.innerHTML = ''; return; }
  list.innerHTML = attachedFiles.map((f, i) => {
    const icon = f.type.startsWith('image/') ? '🖼️' : '📄';
    const size = f.size < 1024 * 1024 ? Math.round(f.size / 1024) + ' Ko' : (f.size / (1024 * 1024)).toFixed(1) + ' Mo';
    return `
      <div class="file-preview-item">
        <span class="fp-icon">${icon}</span>
        <span class="fp-name">${f.name}</span>
        <span class="fp-size">${size}</span>
        <span class="fp-remove" data-index="${i}">✕</span>
      </div>`;
  }).join('');
  list.querySelectorAll('.fp-remove').forEach(btn => {
    btn.addEventListener('click', () => { attachedFiles.splice(parseInt(btn.dataset.index), 1); renderFilePreviews(); });
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Analyse Claude multimodal ────────────────────────────────────────────────
let generatedTasks = [];

document.getElementById('organize-send-btn').addEventListener('click', runOrganize);

async function runOrganize() {
  const textInput = document.getElementById('organize-input').value.trim();
  if (!textInput && attachedFiles.length === 0) return;

  const resultDiv = document.getElementById('organize-result');
  const actionsDiv = document.getElementById('organize-actions');
  const btn = document.getElementById('organize-send-btn');

  btn.textContent = 'Analyse en cours...';
  btn.disabled = true;
  resultDiv.innerHTML = '<div class="organize-loading">⏳ Claude analyse ta situation...</div>';
  actionsDiv.style.display = 'none';

  const apiKey = await getApiKey();
  if (!apiKey) {
    resultDiv.innerHTML = '<div class="organize-error">Clé Anthropic introuvable. Configure-la dans le popup.</div>';
    btn.textContent = 'Analyser et organiser'; btn.disabled = false;
    return;
  }

  const SYSTEM = `Tu es un expert en gestion de tâches et organisation du travail.
L'utilisateur te décrit sa situation en texte, et peut aussi joindre des PDF ou images.

Analyse TOUT le contenu fourni et retourne UNIQUEMENT un JSON valide, sans markdown, sans texte avant ou après.

Format attendu :
{
  "summary": "Résumé très court de la situation analysée",
  "groups": [
    {
      "name": "Nom du groupe/projet",
      "priority": "high|medium|low",
      "deadline": "description courte si mentionnée, sinon null",
      "estimated_time": "ex: 2h30, 45min, null si inconnu",
      "subtasks": [
        { "name": "sous-tâche", "time": "30min" }
      ]
    }
  ],
  "recommended_order": ["nom groupe 1", "nom groupe 2"],
  "total_estimated": "temps total estimé"
}

Règles :
- priority "high" = urgent (aujourd'hui, demain, deadline très proche)
- priority "medium" = cette semaine
- priority "low" = pas de deadline précise
- Déduis les sous-tâches intelligemment même si non mentionnées
- Si un PDF ou une image est fourni, extrait les tâches qu'il implique
- Estime des temps réalistes`;

  try {
    const contentBlocks = [];
    if (textInput) contentBlocks.push({ type: 'text', text: textInput });
    for (const file of attachedFiles) {
      const base64 = await fileToBase64(file);
      if (file.type === 'application/pdf') {
        contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
      } else {
        contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } });
      }
    }
    if (contentBlocks.length === 0) return;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 2000,
        system: SYSTEM,
        messages: [{ role: 'user', content: contentBlocks }]
      })
    });

    const data = await response.json();
    if (!data.content || !data.content[0]) throw new Error('Réponse vide');
    let raw = data.content[0].text.trim();
    if (raw.startsWith('```')) raw = raw.split('```')[1].replace(/^json/, '').trim();
    const parsed = JSON.parse(raw);
    generatedTasks = parsed.groups || [];
    renderOrganizeResult(parsed);
    actionsDiv.style.display = 'block';

  } catch (err) {
    resultDiv.innerHTML = '<div class="organize-error">Erreur : ' + err.message + '</div>';
  }

  btn.textContent = 'Analyser et organiser'; btn.disabled = false;
}

function renderOrganizeResult(parsed) {
  const resultDiv = document.getElementById('organize-result');
  const groups = parsed.groups || [];
  if (!groups.length) { resultDiv.innerHTML = '<div class="organize-error">Aucune tâche détectée.</div>'; return; }

  const priorityLabel = { high: '🔴 Urgent', medium: '🟡 Cette semaine', low: '🟢 Flexible' };
  let html = '';
  if (parsed.summary) html += `<div class="org-summary">${parsed.summary}</div>`;
  if (parsed.total_estimated) html += `<div class="org-total">⏱ Total estimé : <strong>${parsed.total_estimated}</strong></div>`;
  if (parsed.recommended_order && parsed.recommended_order.length > 1) {
    html += `<div class="org-order">📋 Ordre : ${parsed.recommended_order.map((n, i) => `<span class="ord-num">${i+1}</span>${n}`).join(' → ')}</div>`;
  }
  html += groups.map(g => `
    <div class="org-group priority-${g.priority}">
      <div class="org-group-header">
        <span class="org-priority-badge ${g.priority}">${priorityLabel[g.priority] || g.priority}</span>
        <span class="org-group-name">${g.name}</span>
      </div>
      <div class="org-group-meta">
        ${g.deadline ? '<span class="org-deadline">📅 ' + g.deadline + '</span>' : ''}
        ${g.estimated_time ? '<span class="org-time">⏱ ' + g.estimated_time + '</span>' : ''}
      </div>
      <ul class="org-subtasks">
        ${(g.subtasks || []).map(s => `
          <li class="org-subtask">
            <span class="org-subtask-check">└</span>
            <span class="org-subtask-name">${typeof s === 'string' ? s : s.name}</span>
            ${s.time ? '<span class="org-subtask-time">' + s.time + '</span>' : ''}
          </li>`).join('')}
      </ul>
    </div>
  `).join('');
  resultDiv.innerHTML = html;
}

document.getElementById('organize-import-btn').addEventListener('click', () => {
  if (!generatedTasks.length) return;
  chrome.storage.local.get(['tasks'], (result) => {
    const tasks = result.tasks || [];
    generatedTasks.forEach(group => {
      tasks.push({ task: group.name, done: false, deadline: null, reminders: [], isGroup: true, priority: group.priority, estimatedTime: group.estimated_time || null });
      (group.subtasks || []).forEach(sub => {
        const subName = typeof sub === 'string' ? sub : sub.name;
        tasks.push({ task: '  └ ' + subName, done: false, deadline: null, reminders: [], parentGroup: group.name });
      });
    });
    chrome.storage.local.set({ tasks }, () => {
      setBubbleStatus('✓ Tâches importées !');
      organizePanel.classList.remove('open');
      resetOrganizePanel();
      panel.classList.add('open');
      positionPanel();
      renderBubbleTasks();
    });
  });
});

function resetOrganizePanel() {
  attachedFiles = []; renderFilePreviews();
  generatedTasks = [];
  document.getElementById('organize-result').innerHTML = '';
  document.getElementById('organize-actions').style.display = 'none';
  document.getElementById('organize-input').value = '';
  document.getElementById('mic-status-organize').textContent = '';
}

// ── Positionnement ───────────────────────────────────────────────────────────
function positionPanel() {
  const rect = bubble.getBoundingClientRect();
  const panelW = 310, panelH = panel.offsetHeight || 380;
  let top = rect.bottom + 8;
  if (top + panelH > window.innerHeight - 10) top = rect.top - panelH - 8;
  let left = rect.left;
  if (left + panelW > window.innerWidth - 10) left = window.innerWidth - panelW - 10;
  if (left < 10) left = 10;
  panel.style.top = top + 'px'; panel.style.left = left + 'px';
}

function positionOrganizePanel() {
  const rect = bubble.getBoundingClientRect();
  const w = 360, h = 560;
  let top = rect.bottom + 8;
  if (top + h > window.innerHeight - 10) top = rect.top - h - 8;
  let left = rect.left;
  if (left + w > window.innerWidth - 10) left = window.innerWidth - w - 10;
  if (left < 10) left = 10;
  organizePanel.style.top = top + 'px'; organizePanel.style.left = left + 'px';
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function getApiKey() {
  return new Promise((resolve) => chrome.storage.local.get(['apiKey'], (r) => resolve(r.apiKey || '')));
}
function getOpenAIKey() {
  return new Promise((resolve) => chrome.storage.local.get(['openaiKey'], (r) => resolve(r.openaiKey || '')));
}

function addTask() {
  const input = document.getElementById('bubble-input');
  const deadlineInput = document.getElementById('bubble-deadline');
  const remindersInput = document.getElementById('bubble-reminders');
  const text = input.value.trim();
  if (!text) return;
  const deadlineMinutes = parseInt(deadlineInput.value);
  const deadline = (!isNaN(deadlineMinutes) && deadlineMinutes > 0) ? Date.now() + deadlineMinutes * 60 * 1000 : null;
  let reminders = [];
  if (deadline && remindersInput.value.trim()) {
    reminders = remindersInput.value.split(',').map(r => parseInt(r.trim())).filter(r => !isNaN(r) && r > 0);
  }
  chrome.storage.local.get(['tasks'], (result) => {
    const tasks = result.tasks || [];
    tasks.push({ task: text, done: false, deadline, reminders });
    chrome.storage.local.set({ tasks }, () => {
      input.value = ''; deadlineInput.value = ''; remindersInput.value = '';
      setBubbleStatus('Tâche ajoutée.');
      renderBubbleTasks();
      if (deadline && reminders.length > 0) {
        reminders.forEach(minBefore => {
          const when = deadline - minBefore * 60 * 1000;
          if (when > Date.now()) chrome.runtime.sendMessage({ type: 'set-alarm', name: text + '|' + minBefore, when });
        });
      } else if (deadline) {
        const when = deadline - 5 * 60 * 1000;
        if (when > Date.now()) chrome.runtime.sendMessage({ type: 'set-alarm', name: text + '|5', when });
      }
    });
  });
}

function formatDeadline(ts) {
  const diff = ts - Date.now();
  if (diff <= 0) return 'Expirée';
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
    if (tasks.length === 0) { list.innerHTML = '<p class="bubble-task-empty">Aucune tâche pour l\'instant.</p>'; return; }
    const priorityDot = { high: '🔴 ', medium: '🟡 ', low: '🟢 ' };
    list.innerHTML = tasks.map((t, i) => {
      const deadlineHtml = t.deadline ? '<span class="bubble-deadline">Deadline : ' + formatDeadline(t.deadline) + '</span>' : '';
      const remindersHtml = (t.reminders && t.reminders.length > 0) ? '<span class="bubble-reminders-tag">Rappels : ' + t.reminders.join(', ') + ' min</span>' : '';
      const timeHtml = t.estimatedTime ? '<span class="bubble-time">⏱ ' + t.estimatedTime + '</span>' : '';
      const dot = t.priority ? priorityDot[t.priority] : '';
      return `
        <div class="bubble-task-item ${t.done ? 'done' : ''} ${t.isGroup ? 'is-group' : ''} ${t.task.startsWith('  └') ? 'is-sub' : ''}" data-index="${i}">
          <span class="bubble-check">${t.done ? '✔' : '○'}</span>
          <span class="bubble-task-text">${dot}${t.task}${deadlineHtml}${remindersHtml}${timeHtml}</span>
          <span class="bubble-delete" data-index="${i}">✕</span>
        </div>`;
    }).join('');
    list.querySelectorAll('.bubble-check').forEach(btn => btn.addEventListener('click', () => toggleTask(parseInt(btn.closest('.bubble-task-item').dataset.index))));
    list.querySelectorAll('.bubble-delete').forEach(btn => btn.addEventListener('click', () => deleteTask(parseInt(btn.dataset.index))));
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
  list.innerHTML = pendingReminders.map(r => '<div class="modal-reminder-item">' + r + '</div>').join('');
  overlay.classList.add('open');
}

setInterval(() => { if (panel.classList.contains('open')) renderBubbleTasks(); }, 1000);
setInterval(() => {
  chrome.storage.local.get(['tasks'], (result) => {
    const tasks = result.tasks || [];
    const now = Date.now();
    tasks.forEach(t => {
      if (t.done || !t.deadline) return;
      const reminders = t.reminders && t.reminders.length > 0 ? t.reminders : [5];
      reminders.forEach(minBefore => {
        const triggerTime = t.deadline - minBefore * 60 * 1000;
        const key = t.task + '|' + minBefore;
        if (!firedReminders[key] && now >= triggerTime && now < triggerTime + 30000) {
          firedReminders[key] = true;
          const diff = t.deadline - now;
          const minLeft = Math.round(diff / 60000);
          showNotification(t.task + ' — il reste ' + (minLeft > 0 ? minLeft + ' min' : 'moins d\'1 min') + ' avant la deadline');
        }
      });
    });
  });
}, 30000);