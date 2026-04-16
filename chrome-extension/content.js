// Ignore extension context errors silently
window.addEventListener('error', e => {
  if (e.message?.includes('Extension context') || e.message?.includes('context invalidated')) {
    e.preventDefault(); e.stopPropagation(); return true;
  }
});
window.addEventListener('unhandledrejection', e => {
  if (e.reason?.message?.includes('Extension context') || e.reason?.message?.includes('context invalidated')) {
    e.preventDefault(); return;
  }
});


// ── Guard contre "Extension context invalidated" ─────────────────────────────
function isChromeContextValid() {
  try { return !!chrome.runtime?.id; } catch(e) { return false; }
}

function safeChrome(fn) {
  if (!isChromeContextValid()) return;
  try { fn(); } catch(e) {
    if (!e.message?.includes('Extension context')) console.error(e);
  }
}

let isDragging = false;
let offsetX = 0;
let offsetY = 0;
let hasMoved = false;
let pendingReminders = [];
let firedReminders = {};
let attachedFiles = [];

// ── Focus mode state ─────────────────────────────────────────────────────────
let focusState = {
  active: false,
  taskName: '',
  mode: 'pomodoro',
  phase: 'work',
  totalSeconds: 25 * 60,
  remainingSeconds: 25 * 60,
  running: false,
  interval: null,
  pomodoroCount: 0,
  freeMinutes: 25
};

// ── Focus check popup ─────────────────────────────────────────────────────────
const focusCheckPopup = document.createElement('div');
focusCheckPopup.id = 'focus-check-popup';
focusCheckPopup.innerHTML = `
  <div id="fcp-inner">
    <div id="fcp-icon">TA</div>
    <div id="fcp-title">Session focus en cours</div>
    <div id="fcp-task"></div>
    <p id="fcp-question">Cette page fait partie de ton focus ?</p>
    <div id="fcp-btns">
      <button id="fcp-yes">Oui, c'est lié</button>
      <button id="fcp-no">Non, distraction</button>
    </div>
    <div id="fcp-timer-zone" style="display:none">
      <p id="fcp-timer-question">Combien de temps tu as besoin ?</p>
      <div id="fcp-timer-btns">
        <button class="fcp-duration" data-min="0">Juste regarder</button>
        <button class="fcp-duration" data-min="1">1 min</button>
        <button class="fcp-duration" data-min="2">2 min</button>
        <button class="fcp-duration" data-min="5">5 min</button>
      </div>
      <div id="fcp-countdown" style="display:none"></div>
    </div>
  </div>
`;
document.body.appendChild(focusCheckPopup);

document.getElementById('fcp-yes').addEventListener('click', () => {
  focusCheckPopup.classList.remove('open');
});

document.getElementById('fcp-no').addEventListener('click', () => {
  document.getElementById('fcp-btns').style.display = 'none';
  document.getElementById('fcp-question').style.display = 'none';
  document.getElementById('fcp-timer-zone').style.display = 'block';
});

document.querySelectorAll('.fcp-duration').forEach(btn => {
  btn.addEventListener('click', () => {
    const mins = parseInt(btn.dataset.min);
    document.getElementById('fcp-timer-btns').style.display = 'none';
    document.getElementById('fcp-timer-question').style.display = 'none';

    if (mins === 0) {
      focusCheckPopup.classList.remove('open');
      scheduleFocusReturn(focusCheckPopup.dataset.task, 0.5);
      return;
    }

    const countdown = document.getElementById('fcp-countdown');
    countdown.style.display = 'block';
    let remaining = mins * 60;

    const tick = () => {
      const m = Math.floor(remaining / 60).toString().padStart(2, '0');
      const s = (remaining % 60).toString().padStart(2, '0');
      countdown.innerHTML = `
        <div class="fcp-countdown-label">Retour au focus dans</div>
        <div class="fcp-countdown-timer">${m}:${s}</div>
        <button id="fcp-back-now">Retourner maintenant</button>
      `;
      document.getElementById('fcp-back-now')?.addEventListener('click', () => {
        clearInterval(countInterval);
        focusCheckPopup.classList.remove('open');
      });
      if (remaining <= 0) {
        clearInterval(countInterval);
        showFocusReturnAlert(focusCheckPopup.dataset.task);
        focusCheckPopup.classList.remove('open');
      }
      remaining--;
    };

    tick();
    const countInterval = setInterval(tick, 1000);
    scheduleFocusReturn(focusCheckPopup.dataset.task, mins);
  });
});

function scheduleFocusReturn(taskName, mins) {
  if (mins <= 0) return;
  chrome.runtime.sendMessage({
    type: 'set-alarm',
    name: 'focus-return|' + taskName,
    when: Date.now() + mins * 60 * 1000
  }).catch(() => {});
}

function showFocusReturnAlert(taskName) {
  const alert = document.createElement('div');
  alert.id = 'focus-return-alert';
  alert.innerHTML = `
    <span>Retourne sur <strong>${taskName}</strong></span>
    <button id="fra-close">×</button>
  `;
  document.body.appendChild(alert);
  document.getElementById('fra-close')?.addEventListener('click', () => alert.remove());
  setTimeout(() => alert?.remove(), 8000);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'focus-check') {
    focusCheckPopup.dataset.task = msg.taskName;
    document.getElementById('fcp-task').textContent = msg.taskName;
    document.getElementById('fcp-btns').style.display = 'flex';
    document.getElementById('fcp-question').style.display = 'block';
    document.getElementById('fcp-timer-zone').style.display = 'none';
    document.getElementById('fcp-countdown').style.display = 'none';
    focusCheckPopup.classList.add('open');
  }
  if (msg.type === 'focus-return-alert') showFocusReturnAlert(msg.taskName);
  if (msg.type === 'toggle-bubble') {
    bubble.style.visibility = msg.visible ? 'visible' : 'hidden';
    if (!msg.visible) panel.classList.remove('open');
  }
  if (msg.type === 'reminder') { showNotification(msg.text); renderBubbleTasks(); }
});

// ── Bulle ────────────────────────────────────────────────────────────────────
const bubble = document.createElement('div');
bubble.id = 'task-bubble';
bubble.textContent = 'TA';
document.body.appendChild(bubble);

// ── Panel principal ──────────────────────────────────────────────────────────
const panel = document.createElement('div');
panel.id = 'task-panel';
panel.innerHTML = `
  <div id="task-panel-header">
    <span>Tâches</span>
    <span id="task-panel-close">×</span>
  </div>
  <div id="bubble-task-list"></div>
  <div id="task-input-area">
    <div class="input-with-mic">
      <input type="text" id="bubble-input" placeholder="Dis-moi ce que tu as à faire..." />
      <button class="mic-btn" id="mic-btn-main" title="Dicter">🎙️</button>
    </div>
    <div id="mic-status-main" class="mic-status"></div>
    <input type="number" id="bubble-deadline" placeholder="Deadline dans X min (optionnel)" min="1" />
    <input type="text" id="bubble-reminders" placeholder="Rappels : 60, 30, 10 min avant (optionnel)" />
    <button id="bubble-add-btn">Ajouter</button>
    <button id="bubble-organize-btn">Organiser avec Claude</button>
  </div>
  <div id="bubble-status"></div>
`;
document.body.appendChild(panel);

// ── Panel Organiser ──────────────────────────────────────────────────────────
const organizePanel = document.createElement('div');
organizePanel.id = 'organize-panel';
organizePanel.innerHTML = `
  <div id="organize-header">
    <span>Organiser avec Claude</span>
    <span id="organize-close">×</span>
  </div>
  <div id="organize-scrollable">
    <p id="organize-hint">Décris ta situation à l'écrit ou à voix haute, ajoute des PDF ou images.</p>
    <div class="input-with-mic">
      <textarea id="organize-input" placeholder="Ex : projet dev à rendre vendredi, réunion demain matin, courses ce soir..."></textarea>
      <button class="mic-btn mic-btn-top" id="mic-btn-organize" title="Dicter">🎙️</button>
    </div>
    <div id="mic-status-organize" class="mic-status"></div>
    <div id="drop-zone">
      <span id="drop-icon">+</span>
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
  </div>
  <div id="organize-actions" style="display:none">
    <button id="organize-add-group-btn">+ Groupe</button>
    <button id="organize-import-btn">Importer les tâches</button>
  </div>
`;
document.body.appendChild(organizePanel);

// ── Focus overlay ─────────────────────────────────────────────────────────────
const focusOverlay = document.createElement('div');
focusOverlay.id = 'focus-overlay';
focusOverlay.innerHTML = `
  <div id="focus-card">
    <div id="focus-phase-label">Session de focus</div>
    <div id="focus-task-name">Tâche</div>
    <div id="focus-pomodoro-dots"></div>
    <div id="focus-timer-display">25:00</div>
    <div id="focus-mode-tabs">
      <button class="focus-tab active" data-mode="pomodoro">Pomodoro</button>
      <button class="focus-tab" data-mode="free">Timer libre</button>
    </div>
    <div id="focus-free-input" style="display:none">
      <input type="number" id="focus-free-minutes" value="25" min="1" max="180" />
      <span>minutes</span>
    </div>
    <div id="focus-controls">
      <button id="focus-start-btn">Démarrer</button>
      <button id="focus-pause-btn" style="display:none">Pause</button>
      <button id="focus-skip-btn" style="display:none">Passer</button>
    </div>
    <div id="focus-actions">
      <button id="focus-done-btn">Terminée</button>
      <button id="focus-exit-btn">Quitter</button>
    </div>
    <div id="focus-tab-warning" style="display:none"></div>
  </div>
`;
document.body.appendChild(focusOverlay);

// ── Modale rappel ────────────────────────────────────────────────────────────
const overlay = document.createElement('div');
overlay.id = 'task-modal-overlay';
overlay.innerHTML = `
  <div id="task-modal">
    <div id="task-modal-title">Rappel</div>
    <div id="task-modal-list"></div>
    <button id="task-modal-close">OK</button>
  </div>
`;
document.body.appendChild(overlay);

document.getElementById('task-modal-close').addEventListener('click', () => {
  overlay.classList.remove('open');
  pendingReminders = [];
});

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

// ── Drag bulle ───────────────────────────────────────────────────────────────
bubble.addEventListener('mousedown', (e) => {
  isDragging = true; hasMoved = false;
  bubble.classList.add('dragging');
  const rect = bubble.getBoundingClientRect();
  offsetX = e.clientX - rect.left; offsetY = e.clientY - rect.top;
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  hasMoved = true;
  const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - 44));
  const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - 44));
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

// ── FOCUS MODE ───────────────────────────────────────────────────────────────
function startFocusMode(taskName) {
  focusState.active = true;
  focusState.taskName = taskName;
  focusState.phase = 'work';
  focusState.running = false;
  focusState.pomodoroCount = 0;
  chrome.runtime.sendMessage({ type: 'focus-start', taskName }).catch(() => {});
  panel.classList.remove('open');
  organizePanel.classList.remove('open');
  setFocusMode('pomodoro');
  focusOverlay.classList.add('open');
  document.getElementById('focus-task-name').textContent = taskName;
  updateFocusDots();
  resetFocusButtons();
}

function setFocusMode(mode) {
  focusState.mode = mode;
  document.querySelectorAll('.focus-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  const freeInput = document.getElementById('focus-free-input');
  if (mode === 'pomodoro') {
    freeInput.style.display = 'none';
    focusState.totalSeconds = 25 * 60;
  } else {
    freeInput.style.display = 'flex';
    focusState.totalSeconds = (parseInt(document.getElementById('focus-free-minutes').value) || 25) * 60;
  }
  focusState.remainingSeconds = focusState.totalSeconds;
  updateTimerDisplay();
  updatePhaseLabel();
}

function updatePhaseLabel() {
  const label = document.getElementById('focus-phase-label');
  if (focusState.mode === 'pomodoro') {
    label.textContent = focusState.phase === 'work' ? 'Session de focus' : 'Pause';
    label.className = focusState.phase === 'work' ? '' : 'break-phase';
  } else {
    label.textContent = 'Timer libre';
    label.className = '';
  }
}

function updateFocusDots() {
  const dots = document.getElementById('focus-pomodoro-dots');
  if (focusState.mode !== 'pomodoro') { dots.innerHTML = ''; return; }
  dots.innerHTML = Array.from({ length: 4 }, (_, i) =>
    `<span class="focus-dot ${i < focusState.pomodoroCount ? 'done' : ''}"></span>`
  ).join('');
}

function updateTimerDisplay() {
  const m = Math.floor(focusState.remainingSeconds / 60).toString().padStart(2, '0');
  const s = (focusState.remainingSeconds % 60).toString().padStart(2, '0');
  document.getElementById('focus-timer-display').textContent = m + ':' + s;
}

function resetFocusButtons() {
  document.getElementById('focus-start-btn').style.display = 'inline-flex';
  document.getElementById('focus-pause-btn').style.display = 'none';
  document.getElementById('focus-skip-btn').style.display = 'none';
}

function tickFocus() {
  if (focusState.remainingSeconds <= 0) {
    clearInterval(focusState.interval);
    focusState.running = false;
    onTimerEnd();
    return;
  }
  focusState.remainingSeconds--;
  updateTimerDisplay();
}

function onTimerEnd() {
  resetFocusButtons();
  if (focusState.mode === 'pomodoro') {
    if (focusState.phase === 'work') {
      focusState.pomodoroCount++;
      updateFocusDots();
      focusState.phase = 'break';
      focusState.totalSeconds = focusState.pomodoroCount % 4 === 0 ? 15 * 60 : 5 * 60;
      focusState.remainingSeconds = focusState.totalSeconds;
      showFocusMsg('Pomodoro terminé. Prends une pause.', '#6a9a7a');
    } else {
      focusState.phase = 'work';
      focusState.totalSeconds = 25 * 60;
      focusState.remainingSeconds = focusState.totalSeconds;
      showFocusMsg('Pause terminée. Retour au travail.', '#9088c8');
    }
    updatePhaseLabel();
    updateTimerDisplay();
  } else {
    showFocusMsg('Timer terminé.', '#6a9a7a');
  }
}

function showFocusMsg(msg, color) {
  const warn = document.getElementById('focus-tab-warning');
  warn.textContent = msg;
  warn.style.color = color || '#6a9a7a';
  warn.style.display = 'block';
  setTimeout(() => { warn.style.display = 'none'; }, 4000);
}

function exitFocusMode() {
  clearInterval(focusState.interval);
  focusState.active = false;
  focusState.running = false;
  focusOverlay.classList.remove('open');
  chrome.runtime.sendMessage({ type: 'focus-end' }).catch(() => {});
}

document.querySelectorAll('.focus-tab').forEach(tab => {
  tab.addEventListener('click', () => { if (!focusState.running) setFocusMode(tab.dataset.mode); });
});

document.getElementById('focus-free-minutes').addEventListener('input', (e) => {
  if (focusState.running) return;
  focusState.totalSeconds = (parseInt(e.target.value) || 25) * 60;
  focusState.remainingSeconds = focusState.totalSeconds;
  updateTimerDisplay();
});

document.getElementById('focus-start-btn').addEventListener('click', () => {
  focusState.running = true;
  focusState.interval = setInterval(tickFocus, 1000);
  document.getElementById('focus-start-btn').style.display = 'none';
  document.getElementById('focus-pause-btn').style.display = 'inline-flex';
  document.getElementById('focus-skip-btn').style.display = 'inline-flex';
  updatePhaseLabel();
});

document.getElementById('focus-pause-btn').addEventListener('click', () => {
  if (focusState.running) {
    clearInterval(focusState.interval); focusState.running = false;
    document.getElementById('focus-pause-btn').textContent = 'Reprendre';
  } else {
    focusState.interval = setInterval(tickFocus, 1000); focusState.running = true;
    document.getElementById('focus-pause-btn').textContent = 'Pause';
  }
});

document.getElementById('focus-skip-btn').addEventListener('click', () => {
  clearInterval(focusState.interval); focusState.running = false;
  focusState.remainingSeconds = 0; onTimerEnd();
});

document.getElementById('focus-done-btn').addEventListener('click', () => {
  chrome.storage.local.get(['tasks'], (result) => {
    const tasks = result.tasks || [];
    const idx = tasks.findIndex(t => t.task === focusState.taskName || t.task.replace('  └ ', '') === focusState.taskName);
    if (idx !== -1) { tasks[idx].done = true; chrome.storage.local.set({ tasks }); }
  });
  exitFocusMode();
  setBubbleStatus('Tâche terminée.');
});

document.getElementById('focus-exit-btn').addEventListener('click', exitFocusMode);

// ── Whisper ──────────────────────────────────────────────────────────────────
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

async function startRecording(micBtn, statusEl, targetInputId) {
  if (isRecording) { stopRecording(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    mediaRecorder.addEventListener('dataavailable', (e) => { if (e.data.size > 0) audioChunks.push(e.data); });
    mediaRecorder.addEventListener('stop', async () => {
      stream.getTracks().forEach(t => t.stop());
      await transcribeWithWhisper(new Blob(audioChunks, { type: 'audio/webm' }), targetInputId, statusEl);
    });
    mediaRecorder.start(); isRecording = true;
    micBtn.classList.add('recording'); micBtn.textContent = '⏹️';
    statusEl.textContent = 'Enregistrement en cours...'; statusEl.classList.add('active');
  } catch (err) { statusEl.textContent = 'Micro inaccessible : ' + err.message; }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  isRecording = false;
}

async function transcribeWithWhisper(audioBlob, targetInputId, statusEl) {
  const micBtn = targetInputId === 'bubble-input'
    ? document.getElementById('mic-btn-main')
    : document.getElementById('mic-btn-organize');
  micBtn.textContent = '⏳'; statusEl.textContent = 'Transcription...';
  const openaiKey = await getOpenAIKey();
  if (!openaiKey) {
    statusEl.textContent = 'Clé OpenAI manquante.';
    micBtn.textContent = '🎙️'; micBtn.classList.remove('recording'); return;
  }
  try {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', 'whisper-1');
    formData.append('language', 'fr');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + openaiKey }, body: formData
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    const t = data.text.trim();
    const el = document.getElementById(targetInputId);
    if (el) { el.value = el.value.trim() ? el.value + ' ' + t : t; el.focus(); }
    statusEl.textContent = t.substring(0, 60) + (t.length > 60 ? '…' : '');
    setTimeout(() => { statusEl.textContent = ''; statusEl.classList.remove('active'); }, 4000);
  } catch (err) {
    statusEl.textContent = 'Erreur : ' + err.message;
    setTimeout(() => { statusEl.textContent = ''; statusEl.classList.remove('active'); }, 4000);
  }
  micBtn.textContent = '🎙️'; micBtn.classList.remove('recording');
}

document.getElementById('mic-btn-main').addEventListener('click', () => {
  const s = document.getElementById('mic-status-main');
  if (isRecording) {
    stopRecording();
    document.getElementById('mic-btn-main').textContent = '🎙️';
    document.getElementById('mic-btn-main').classList.remove('recording');
    s.textContent = '';
  } else startRecording(document.getElementById('mic-btn-main'), s, 'bubble-input');
});

document.getElementById('mic-btn-organize').addEventListener('click', () => {
  const s = document.getElementById('mic-status-organize');
  if (isRecording) {
    stopRecording();
    document.getElementById('mic-btn-organize').textContent = '🎙️';
    document.getElementById('mic-btn-organize').classList.remove('recording');
    s.textContent = '';
  } else startRecording(document.getElementById('mic-btn-organize'), s, 'organize-input');
});

// ── Fichiers ─────────────────────────────────────────────────────────────────
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); addFiles(Array.from(e.dataTransfer.files)); });
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
    const type = f.type.startsWith('image/') ? 'img' : 'pdf';
    const size = f.size < 1024 * 1024
      ? Math.round(f.size / 1024) + ' Ko'
      : (f.size / (1024 * 1024)).toFixed(1) + ' Mo';
    return `<div class="file-preview-item">
      <span class="fp-icon">${type}</span>
      <span class="fp-name">${f.name}</span>
      <span class="fp-size">${size}</span>
      <span class="fp-remove" data-index="${i}">×</span>
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

// ── Analyse Claude ────────────────────────────────────────────────────────────
let generatedTasks = [];
document.getElementById('organize-send-btn').addEventListener('click', runOrganize);

async function runOrganize() {
  const textInput = document.getElementById('organize-input').value.trim();
  if (!textInput && attachedFiles.length === 0) return;
  const resultDiv = document.getElementById('organize-result');
  const actionsDiv = document.getElementById('organize-actions');
  const btn = document.getElementById('organize-send-btn');
  btn.textContent = 'Analyse en cours...'; btn.disabled = true;
  resultDiv.innerHTML = '<div class="organize-loading">Analyse en cours...</div>';
  actionsDiv.style.display = 'none';
  const apiKey = await getApiKey();
  if (!apiKey) {
    resultDiv.innerHTML = '<div class="organize-error">Clé Anthropic introuvable.</div>';
    btn.textContent = 'Analyser et organiser'; btn.disabled = false; return;
  }
  const memCtx = await getMemoryContext();
  const SYSTEM = `Tu es un expert en gestion de taches.${memCtx ? memCtx + '\n\n' : ''}Retourne UNIQUEMENT un JSON valide.
Format : {"summary":"...","groups":[{"name":"...","priority":"high|medium|low","deadline":"...ou null","estimated_time":"...ou null","subtasks":[{"name":"...","time":"..."}]}],"recommended_order":["..."],"total_estimated":"..."}`;
  try {
    const contentBlocks = [];
    if (textInput) contentBlocks.push({ type: 'text', text: textInput });
    for (const file of attachedFiles) {
      const base64 = await fileToBase64(file);
      if (file.type === 'application/pdf')
        contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
      else
        contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } });
    }
    if (!contentBlocks.length) return;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 2000, system: SYSTEM, messages: [{ role: 'user', content: contentBlocks }] })
    });
    const data = await response.json();
    if (!data.content?.[0]) throw new Error('Réponse vide');
    let raw = data.content[0].text.trim();
    if (raw.startsWith('```')) raw = raw.split('```')[1].replace(/^json/, '').trim();
    const parsed = JSON.parse(raw);
    generatedTasks = parsed.groups || [];
    renderOrganizeResult(parsed);
    actionsDiv.style.display = 'flex';
    // Scroll automatique vers les actions
    setTimeout(() => {
      actionsDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  } catch (err) {
    resultDiv.innerHTML = '<div class="organize-error">Erreur : ' + err.message + '</div>';
  }
  btn.textContent = 'Analyser et organiser'; btn.disabled = false;
}

function renderOrganizeResult(parsed) {
  const resultDiv = document.getElementById('organize-result');
  const groups = parsed.groups || [];
  if (!groups.length) { resultDiv.innerHTML = '<div class="organize-error">Aucune tâche détectée.</div>'; return; }
  let html = '';
  if (parsed.summary) html += `<div class="org-summary">${parsed.summary}</div>`;
  if (parsed.total_estimated) html += `<div class="org-total">Total estimé : <strong>${parsed.total_estimated}</strong></div>`;
  html += groups.map((g, gi) => renderGroupHTML(g, gi)).join('');
  resultDiv.innerHTML = html;
  attachGroupListeners(resultDiv);
}

function renderGroupHTML(g, gi) {
  const priorityLabel = { high: '!', medium: '–', low: '·' };
  return `<div class="org-group priority-${g.priority}" data-group="${gi}">
    <div class="org-group-header">
      <span class="org-priority-toggle" data-group="${gi}" title="Changer la priorité">${priorityLabel[g.priority] || '–'}</span>
      <span class="org-group-name editable" data-group="${gi}" data-field="name" contenteditable="true" spellcheck="false">${g.name}</span>
      <span class="org-group-time editable-small" data-group="${gi}" data-field="estimated_time" contenteditable="true" spellcheck="false">${g.estimated_time || '—'}</span>
      <span class="org-delete-group" data-group="${gi}" title="Supprimer">×</span>
    </div>
    ${g.deadline ? `<div class="org-deadline-edit"><span class="editable-small" data-group="${gi}" data-field="deadline" contenteditable="true" spellcheck="false">${g.deadline}</span></div>` : ''}
    <ul class="org-subtasks" data-group="${gi}">${(g.subtasks || []).map((s, si) => renderSubtaskHTML(s, gi, si)).join('')}</ul>
    <button class="org-add-subtask" data-group="${gi}">+ sous-tâche</button>
  </div>`;
}

function renderSubtaskHTML(s, gi, si) {
  const name = typeof s === 'string' ? s : s.name;
  const time = typeof s === 'string' ? '' : (s.time || '');
  return `<li class="org-subtask" data-group="${gi}" data-sub="${si}">
    <span class="org-subtask-check">—</span>
    <span class="org-subtask-name editable-small" data-group="${gi}" data-sub="${si}" data-field="name" contenteditable="true" spellcheck="false">${name}</span>
    <span class="org-subtask-time editable-small" data-group="${gi}" data-sub="${si}" data-field="time" contenteditable="true" spellcheck="false">${time || '—'}</span>
    <span class="org-delete-sub" data-group="${gi}" data-sub="${si}" title="Supprimer">×</span>
  </li>`;
}

function attachGroupListeners(container) {
  container.querySelectorAll('[contenteditable]').forEach(el => {
    el.addEventListener('blur', () => syncEditToData(el));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
  });
  container.querySelectorAll('.org-priority-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const gi = parseInt(btn.dataset.group);
      const cycle = { high: 'medium', medium: 'low', low: 'high' };
      generatedTasks[gi].priority = cycle[generatedTasks[gi].priority] || 'medium';
      refreshGroup(gi);
    });
  });
  container.querySelectorAll('.org-delete-group').forEach(btn => {
    btn.addEventListener('click', () => { generatedTasks.splice(parseInt(btn.dataset.group), 1); refreshAllGroups(); });
  });
  container.querySelectorAll('.org-delete-sub').forEach(btn => {
    btn.addEventListener('click', () => {
      generatedTasks[parseInt(btn.dataset.group)].subtasks.splice(parseInt(btn.dataset.sub), 1);
      refreshGroup(parseInt(btn.dataset.group));
    });
  });
  container.querySelectorAll('.org-add-subtask').forEach(btn => {
    btn.addEventListener('click', () => {
      const gi = parseInt(btn.dataset.group);
      if (!generatedTasks[gi].subtasks) generatedTasks[gi].subtasks = [];
      generatedTasks[gi].subtasks.push({ name: 'Nouvelle sous-tâche', time: '' });
      refreshGroup(gi);
      setTimeout(() => {
        const items = document.querySelectorAll(`.org-group[data-group="${gi}"] .org-subtask-name`);
        if (items.length) {
          const last = items[items.length - 1];
          last.focus();
          const r = document.createRange();
          r.selectNodeContents(last);
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(r);
        }
      }, 50);
    });
  });
}

function syncEditToData(el) {
  const gi = parseInt(el.dataset.group);
  const si = el.dataset.sub !== undefined ? parseInt(el.dataset.sub) : null;
  const field = el.dataset.field;
  const value = el.textContent.trim();
  if (si !== null) {
    if (!generatedTasks[gi]?.subtasks[si]) return;
    if (typeof generatedTasks[gi].subtasks[si] === 'string')
      generatedTasks[gi].subtasks[si] = { name: generatedTasks[gi].subtasks[si], time: '' };
    generatedTasks[gi].subtasks[si][field] = value;
  } else {
    generatedTasks[gi][field] = value;
  }
}

function refreshGroup(gi) {
  const groupEl = document.querySelector(`.org-group[data-group="${gi}"]`);
  if (!groupEl) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderGroupHTML(generatedTasks[gi], gi);
  groupEl.replaceWith(tmp.firstElementChild);
  attachGroupListeners(document.getElementById('organize-result'));
}

function refreshAllGroups() {
  const resultDiv = document.getElementById('organize-result');
  const s = resultDiv.querySelector('.org-summary');
  const t = resultDiv.querySelector('.org-total');
  let html = (s ? s.outerHTML : '') + (t ? t.outerHTML : '');
  html += generatedTasks.map((g, gi) => renderGroupHTML(g, gi)).join('');
  resultDiv.innerHTML = html;
  attachGroupListeners(resultDiv);
}

document.getElementById('organize-add-group-btn').addEventListener('click', () => {
  generatedTasks.push({ name: 'Nouveau groupe', priority: 'medium', deadline: null, estimated_time: null, subtasks: [] });
  refreshAllGroups();
  document.getElementById('organize-actions').style.display = 'flex';
  setTimeout(() => {
    const groups = document.querySelectorAll('.org-group-name');
    if (groups.length) {
      const last = groups[groups.length - 1];
      last.focus();
      const r = document.createRange();
      r.selectNodeContents(last);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(r);
    }
  }, 50);
});

document.getElementById('organize-import-btn').addEventListener('click', () => {
  if (!generatedTasks.length) return;
  document.querySelectorAll('[contenteditable]:focus').forEach(el => syncEditToData(el));
  chrome.storage.local.get(['tasks'], (result) => {
    const tasks = result.tasks || [];
    generatedTasks.forEach(group => {
      tasks.push({ task: group.name, done: false, deadline: null, reminders: [], isGroup: true, priority: group.priority, estimatedTime: group.estimated_time || null });
      (group.subtasks || []).forEach(sub => {
        const subName = typeof sub === 'string' ? sub : sub.name;
        if (subName) tasks.push({ task: '  ' + subName, done: false, deadline: null, reminders: [], parentGroup: group.name });
      });
    });
    chrome.storage.local.set({ tasks }, () => {
      setBubbleStatus('Tâches importées.');
      organizePanel.classList.remove('open');
      resetOrganizePanel();
      panel.classList.add('open');
      positionPanel();
      renderBubbleTasks();
      const orgInput = document.getElementById('organize-input')?.value || '';
      if (orgInput.length > 20) {
        getApiKey().then(key => { if (key) checkAndAskMemory(orgInput, key); });
      }
    });
  });
});

function resetOrganizePanel() {
  attachedFiles = []; renderFilePreviews(); generatedTasks = [];
  document.getElementById('organize-result').innerHTML = '';
  document.getElementById('organize-actions').style.display = 'none';
  document.getElementById('organize-input').value = '';
  document.getElementById('mic-status-organize').textContent = '';
}

// ── Positionnement ───────────────────────────────────────────────────────────
function positionPanel() {
  const rect = bubble.getBoundingClientRect();
  const panelW = 300, panelH = panel.offsetHeight || 380;
  let top = rect.bottom + 8;
  if (top + panelH > window.innerHeight - 10) top = rect.top - panelH - 8;
  let left = rect.left;
  if (left + panelW > window.innerWidth - 10) left = window.innerWidth - panelW - 10;
  if (left < 10) left = 10;
  panel.style.top = top + 'px'; panel.style.left = left + 'px';
}

function positionOrganizePanel() {
  const rect = bubble.getBoundingClientRect();
  const w = 360, h = 580;
  let top = rect.bottom + 8;
  if (top + h > window.innerHeight - 10) top = rect.top - h - 8;
  let left = rect.left;
  if (left + w > window.innerWidth - 10) left = window.innerWidth - w - 10;
  if (left < 10) left = 10;
  organizePanel.style.top = top + 'px'; organizePanel.style.left = left + 'px';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// ── Memory ────────────────────────────────────────────────────────────────────

function getMemory() {
  return new Promise(r => chrome.storage.local.get(['claudeMemory'], d => r(d.claudeMemory || [])));
}

async function getMemoryContext() {
  const memories = await getMemory();
  if (memories.length === 0) return '';
  return '\n\nMémoire (sessions précédentes) :\n' +
    memories.map(m => `- ${m.text} (${m.date})`).join('\n');
}

async function addMemoryEntry(text) {
  const memories = await getMemory();
  memories.push({
    text: text.trim(),
    date: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }),
    timestamp: Date.now()
  });
  chrome.storage.local.set({ claudeMemory: memories });
}

const memoryBubbleModal = document.createElement('div');
memoryBubbleModal.id = 'bubble-memory-modal';
memoryBubbleModal.innerHTML = `
  <div id="bmm-inner">
    <div id="bmm-title">Retenir quelque chose ?</div>
    <div id="bmm-suggestion"></div>
    <textarea id="bmm-input" placeholder="Ce que tu veux que je retienne..."></textarea>
    <div id="bmm-btns">
      <button id="bmm-skip">Passer</button>
      <button id="bmm-save">Retenir</button>
    </div>
  </div>
`;
document.body.appendChild(memoryBubbleModal);

document.getElementById('bmm-skip').addEventListener('click', () => {
  memoryBubbleModal.classList.remove('open');
});
document.getElementById('bmm-save').addEventListener('click', () => {
  const text = document.getElementById('bmm-input').value.trim();
  if (text) addMemoryEntry(text);
  memoryBubbleModal.classList.remove('open');
});
document.getElementById('bmm-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('bmm-save').click(); }
  if (e.key === 'Escape') memoryBubbleModal.classList.remove('open');
});

function showBubbleMemoryModal(suggestion) {
  document.getElementById('bmm-suggestion').textContent = suggestion;
  document.getElementById('bmm-input').value = suggestion;
  memoryBubbleModal.classList.add('open');
  setTimeout(() => document.getElementById('bmm-input').focus(), 100);
}

async function checkAndAskMemory(userInput, apiKey) {
  if (userInput.length < 20) return;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 80,
        system: "Tu analyses un message et decides s'il y a quelque chose d'important a retenir pour les sessions futures. Si oui, reponds avec une phrase courte (max 80 chars). Si non, reponds exactement: NON",
        messages: [{ role: 'user', content: 'Message: "' + userInput + '"' }]
      })
    });
    const data = await response.json();
    const suggestion = data.content?.[0]?.text?.trim();
    if (suggestion && suggestion !== 'NON' && !suggestion.startsWith('NON')) {
      showBubbleMemoryModal(suggestion);
    }
  } catch(e) {}
}

function getApiKey() { return new Promise(r => chrome.storage.local.get(['apiKey'], d => r(d.apiKey || ''))); }
function getOpenAIKey() { return new Promise(r => chrome.storage.local.get(['openaiKey'], d => r(d.openaiKey || ''))); }


async function addTask() {
  const input = document.getElementById('bubble-input');
  const deadlineInput = document.getElementById('bubble-deadline');
  const remindersInput = document.getElementById('bubble-reminders');
  const text = input.value.trim();
  if (!text) return;

  const btn = document.getElementById('bubble-add-btn');
  btn.disabled = true;
  btn.textContent = '...';

  const apiKey = await getApiKey();

  // Si pas de clé API ou message court → ajout direct sans Claude
  if (!apiKey || text.length < 15) {
    addTasksDirectly([{ task: text, deadline_minutes: null, priority: 'medium' }], deadlineInput, remindersInput, input);
    btn.disabled = false; btn.textContent = 'Ajouter';
    return;
  }

  try {
    const memCtx = await getMemoryContext();
    const profile = await new Promise(r => chrome.storage.local.get(['userProfile'], d => r(d.userProfile || null)));
    const profileCtx = profile ? `Utilisateur : ${profile.name || ''}${profile.job ? ', ' + profile.job : ''}.${profile.projects ? ' Projets : ' + profile.projects + '.' : ''}` : '';

    const SYSTEM = `Tu es un assistant de gestion de tâches.${profileCtx ? ' ' + profileCtx : ''}${memCtx}
Quand l'utilisateur te parle, extrait les tâches mentionnées et retourne UNIQUEMENT un JSON valide.
Format : {"tasks":[{"task":"nom de la tâche","deadline_minutes":null,"priority":"high|medium|low","message":"..."}],"reply":"réponse courte et naturelle"}
- deadline_minutes : nombre de minutes jusqu'à la deadline (ex: "dans 2 semaines" → 20160), ou null
- priority : "high" si urgent/important, "medium" par défaut, "low" si secondaire
- reply : phrase courte confirmant ce que tu as compris et ajouté
Si l'utilisateur dit juste une phrase de contexte sans tâche claire, crée quand même les tâches logiques qui en découlent.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: 'user', content: text }]
      })
    });

    const data = await response.json();
    let raw = data.content?.[0]?.text?.trim() || '';
    if (raw.startsWith('```')) raw = raw.split('```')[1].replace(/^json/, '').trim();
    const parsed = JSON.parse(raw);

    addTasksDirectly(parsed.tasks || [], deadlineInput, remindersInput, input);
    if (parsed.reply) setBubbleStatus(parsed.reply);

    // Vérifier si quelque chose vaut la peine d'être mémorisé
    if (text.length > 20) checkAndAskMemory(text, apiKey);

  } catch (e) {
    // Fallback : ajout direct si Claude échoue
    addTasksDirectly([{ task: text, deadline_minutes: null, priority: 'medium' }], deadlineInput, remindersInput, input);
  }

  btn.disabled = false; btn.textContent = 'Ajouter';
}

function addTasksDirectly(newTasks, deadlineInput, remindersInput, input) {
  const deadlineMinutes = deadlineInput ? parseInt(deadlineInput.value) : NaN;
  let reminders = [];
  if (!isNaN(deadlineMinutes) && deadlineMinutes > 0 && remindersInput?.value.trim())
    reminders = remindersInput.value.split(',').map(r => parseInt(r.trim())).filter(r => !isNaN(r) && r > 0);

  chrome.storage.local.get(['tasks'], (result) => {
    const tasks = result.tasks || [];
    newTasks.forEach(t => {
      const deadlineMins = t.deadline_minutes || (!isNaN(deadlineMinutes) && deadlineMinutes > 0 ? deadlineMinutes : null);
      const deadline = deadlineMins ? Date.now() + deadlineMins * 60 * 1000 : null;
      tasks.push({ task: t.task, done: false, deadline, reminders, priority: t.priority || 'medium' });
      if (deadline) {
        const alarmList = reminders.length > 0 ? reminders : [5];
        alarmList.forEach(m => { const w = deadline - m * 60 * 1000; if (w > Date.now()) safeChrome(() => chrome.runtime.sendMessage({ type: 'set-alarm', name: t.task + '|' + m, when: w }).catch(() => {})); });
      }
    });
    chrome.storage.local.set({ tasks }, () => {
      if (input) input.value = '';
      if (deadlineInput) deadlineInput.value = '';
      if (remindersInput) remindersInput.value = '';
      if (!newTasks.length || !newTasks[0]?.task) setBubbleStatus('Aucune tâche détectée.');
      renderBubbleTasks();
    });
  });
}

function formatDeadline(ts) {
  const diff = ts - Date.now(); if (diff <= 0) return 'expirée';
  const min = Math.floor(diff / 60000), sec = Math.floor((diff % 60000) / 1000);
  if (min === 0) return sec + 's';
  if (min < 60) return min + 'min';
  const h = Math.floor(min / 60), m = min % 60;
  return h + 'h' + (m > 0 ? m + 'm' : '');
}

function renderBubbleTasks() {
  // Load both tasks and today's schedule
  chrome.storage.local.get(['tasks', 'planSchedule'], (result) => {
    const tasks = result.tasks || [];
    const schedule = result.planSchedule || {};
    const list = document.getElementById('bubble-task-list');
    if (!list) return;

    // Get today's scheduled items
    const todayStr = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const currentHour = now.getHours();

    const todaySchedule = Object.entries(schedule)
      .filter(([key]) => key.startsWith(todayStr))
      .map(([key, val]) => ({
        hour: parseInt(key.split('_')[1]),
        taskName: val.taskName,
        isEvent: val.isEvent,
        isBlocked: val.isBlocked
      }))
      .filter(s => !s.isBlocked)
      .sort((a, b) => a.hour - b.hour);

    const pendingTasks = tasks.filter(t => !t.done && !t.isGroup);

    if (todaySchedule.length === 0 && pendingTasks.length === 0) {
      list.innerHTML = '<p class="bubble-task-empty">Rien de prevu aujourd hui.</p>';
      return;
    }

    let html = '';

    // Today's schedule first
    if (todaySchedule.length > 0) {
      html += '<div class="bubble-today-header">Aujourd hui</div>';
      todaySchedule.forEach(s => {
        const isPast = s.hour < currentHour;
        const isCurrent = s.hour === currentHour;
        html += '<div class="bubble-schedule-item' + (isPast ? ' past' : '') + (isCurrent ? ' current' : '') + '">' +
          '<span class="bubble-schedule-hour">' + s.hour + 'h</span>' +
          '<span class="bubble-schedule-name">' + s.taskName + '</span>' +
          (s.isEvent ? '<span class="bubble-event-tag">evt</span>' : '') +
          '</div>';
      });
    }

    // Pending tasks (compact)
    if (pendingTasks.length > 0) {
      if (todaySchedule.length > 0) html += '<div class="bubble-today-header" style="margin-top:6px">A faire</div>';
      const priorityMark = { high: '! ', medium: '- ', low: '  ' };
      pendingTasks.slice(0, 5).forEach((t, i) => {
        const realIdx = tasks.indexOf(t);
        const mark = t.priority ? priorityMark[t.priority] : '';
        const taskLabel = t.task.startsWith('  ') ? t.task.trim() : t.task;
        html += '<div class="bubble-task-item" data-index="' + realIdx + '">' +
          '<span class="bubble-check">' + (t.done ? 'x' : '.') + '</span>' +
          '<span class="bubble-task-text">' + mark + t.task.trim() + '</span>' +
          '<span class="bubble-focus-btn" data-task="' + taskLabel + '" title="Focus">F</span>' +
          '<span class="bubble-delete" data-index="' + realIdx + '" title="Supprimer">x</span>' +
          '</div>';
      });
      if (pendingTasks.length > 5) {
        html += '<div class="bubble-more">+' + (pendingTasks.length - 5) + ' autres</div>';
      }
    }

    list.innerHTML = html;
    list.querySelectorAll('.bubble-check').forEach(btn =>
      btn.addEventListener('click', () => toggleTask(parseInt(btn.closest('.bubble-task-item').dataset.index))));
    list.querySelectorAll('.bubble-delete').forEach(btn =>
      btn.addEventListener('click', () => deleteTask(parseInt(btn.dataset.index))));
    list.querySelectorAll('.bubble-focus-btn').forEach(btn =>
      btn.addEventListener('click', () => { panel.classList.remove('open'); startFocusMode(btn.dataset.task); }));
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
  const s = document.getElementById('bubble-status'); if (!s) return;
  s.textContent = msg; setTimeout(() => { s.textContent = ''; }, 2500);
}

function showNotification(msg) {
  pendingReminders.push(msg);
  document.getElementById('task-modal-list').innerHTML =
    pendingReminders.map(r => '<div class="modal-reminder-item">' + r + '</div>').join('');
  overlay.classList.add('open');
}

setInterval(() => {
  if (!isChromeContextValid()) return;
  if (panel.classList.contains('open')) renderBubbleTasks();
}, 1000);

setInterval(() => {
  if (!isChromeContextValid()) return;
  chrome.storage.local.get(['tasks'], (result) => {
    const tasks = result.tasks || [], now = Date.now();
    tasks.forEach(t => {
      if (t.done || !t.deadline) return;
      const reminders = t.reminders?.length > 0 ? t.reminders : [5];
      reminders.forEach(minBefore => {
        const triggerTime = t.deadline - minBefore * 60 * 1000;
        const key = t.task + '|' + minBefore;
        if (!firedReminders[key] && now >= triggerTime && now < triggerTime + 30000) {
          firedReminders[key] = true;
          const diff = t.deadline - now;
          const minLeft = Math.round(diff / 60000);
          showNotification(t.task + ' — ' + (minLeft > 0 ? minLeft + ' min' : 'moins d\'1 min') + ' restante(s)');
        }
      });
    });
  });
}, 30000);