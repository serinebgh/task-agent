// ── Helpers (définis en premier) ──────────────────────────────────────────────
function loadTasks(cb) { chrome.storage.local.get(['tasks'], r => cb(r.tasks || [])); }
function saveTasks(tasks) { chrome.storage.local.set({ tasks }); }
function getStoredKey() { return new Promise(r => chrome.storage.local.get(['apiKey'], d => r(d.apiKey || ''))); }
function getProfile() { return new Promise(r => chrome.storage.local.get(['userProfile'], d => r(d.userProfile || null))); }

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
    initPlanning();
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




// ── Memory helpers ────────────────────────────────────────────────────────────
function getMemory() {
  return new Promise(r => chrome.storage.local.get(['claudeMemory'], d => r(d.claudeMemory || [])));
}
function saveMemory(m) { return new Promise(r => chrome.storage.local.set({ claudeMemory: m }, r)); }
async function addMemory(text) {
  const memories = await getMemory();
  memories.push({ text: text.trim(), date: new Date().toLocaleDateString('fr-FR', { day:'numeric', month:'short', year:'numeric' }), timestamp: Date.now() });
  await saveMemory(memories);
  renderMemoryList();
}
async function deleteMemory(index) {
  const memories = await getMemory(); memories.splice(index, 1);
  await saveMemory(memories); renderMemoryList();
}
async function renderMemoryList() {
  const memories = await getMemory();
  const list = document.getElementById('memory-list');
  const empty = document.getElementById('memory-empty');
  if (!list) return;
  if (!memories.length) { list.innerHTML = ''; if (empty) empty.style.display = 'block'; return; }
  if (empty) empty.style.display = 'none';
  list.innerHTML = memories.map((m, i) =>
    '<div class="memory-item"><div class="memory-text">' + m.text + '</div><div class="memory-meta"><span class="memory-date">' + m.date + '</span><span class="memory-delete" data-index="' + i + '">x</span></div></div>'
  ).join('');
  list.querySelectorAll('.memory-delete').forEach(btn => btn.addEventListener('click', () => deleteMemory(parseInt(btn.dataset.index))));
}
async function getMemoryContext() {
  const memories = await getMemory();
  if (!memories.length) return '';
  return ' Memoire: ' + memories.slice(-5).map(m => m.text).join('; ') + '.';
}

async function askToSaveMemory(userInput) {
  const apiKey = await getStoredKey();
  if (!apiKey) return;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system: "Analyse ce message et decide s'il contient une info importante a retenir pour les sessions futures. Si oui, resume en une phrase courte (max 80 chars). Si non, reponds exactement: NON",
        messages: [{ role: 'user', content: 'Message: "' + userInput + '"' }]
      })
    });
    const data = await response.json();
    const suggestion = data.content?.[0]?.text?.trim();
    if (suggestion && suggestion !== 'NON' && !suggestion.startsWith('NON')) {
      showMemoryModal(suggestion);
    }
  } catch(e) {}
}

function showMemoryModal(suggestion) {
  const modal = document.getElementById('memory-modal');
  if (!modal) return;
  document.getElementById('memory-modal-suggestion').textContent = suggestion || '';
  document.getElementById('memory-modal-input').value = suggestion || '';
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('memory-modal-input')?.focus(), 100);
}

function hideMemoryModal() {
  const modal = document.getElementById('memory-modal');
  if (modal) modal.style.display = 'none';
}

document.getElementById('memory-modal-skip')?.addEventListener('click', hideMemoryModal);
document.getElementById('memory-modal-save')?.addEventListener('click', () => {
  const text = document.getElementById('memory-modal-input')?.value.trim();
  if (text) addMemory(text);
  hideMemoryModal();
});
document.getElementById('memory-modal-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('memory-modal-save')?.click(); }
  if (e.key === 'Escape') hideMemoryModal();
});

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

document.getElementById('send-btn') && document.getElementById('send-btn').addEventListener('click', () => {
  const input = document.getElementById('user-input');
  if (input.value.trim()) { runAgent(input.value.trim()); input.value = ''; }
});
document.getElementById('user-input') && document.getElementById('user-input').addEventListener('keydown', e => {
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
    initPlanning();
    renderRevisionGoalsPanel();
    if (r.apiKey) document.getElementById('api-key').value = r.apiKey;
    if (r.openaiKey) document.getElementById('openai-key').value = r.openaiKey;
  }
});


// ── PLANNING ──────────────────────────────────────────────────────────────────
const HOURS_START = 7;
const HOURS_END = 22;
const DAYS = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
let planState = { view:'week', currentDate:new Date(), schedule:{} };

function initPlanning() {
  chrome.storage.local.get(['planSchedule'], r => { planState.schedule = r.planSchedule || {}; renderPlanning(); });
}
function saveSchedule() { chrome.storage.local.set({ planSchedule: planState.schedule }); }
function getWeekStart(date) {
  const d = new Date(date); const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); d.setHours(0,0,0,0); return d;
}
function formatDate(date) { return date.toISOString().slice(0,10); }
function formatWeekLabel(ws) {
  const e = new Date(ws); e.setDate(e.getDate()+6); const o={day:'numeric',month:'short'};
  return ws.toLocaleDateString('fr-FR',o) + ' - ' + e.toLocaleDateString('fr-FR',o);
}
function renderPlanning() {
  if (!document.getElementById('planning-grid')) return;
  if (planState.view==='week') renderWeekView();
  else if (planState.view==='day') renderDayView();
  else renderMonthView();
  renderUnscheduledTasks();
}
function makeCellTask(key) {
  const s = planState.schedule[key]; if (!s) return null;
  const div = document.createElement('div');
  div.className = 'cell-task' + (s.isEvent?' is-event':s.isBlocked?' is-blocked':s.isRevision?' is-revision':'');
  div.draggable = !s.isBlocked && !s.isEvent; div.dataset.key = key;
  const ns = document.createElement('span'); ns.className='cell-task-name'; ns.textContent=s.taskName; div.appendChild(ns);
  if (!s.isBlocked) {
    const rs = document.createElement('span'); rs.className='cell-task-remove'; rs.textContent='x';
    rs.addEventListener('click', () => { delete planState.schedule[key]; saveSchedule(); renderPlanning(); });
    div.appendChild(rs);
  }
  if (!s.isBlocked && !s.isEvent) {
    div.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', JSON.stringify(Object.assign({}, planState.schedule[key], {fromKey:key}))); });
  }
  return div;
}
function makeDroppable(cell, key) {
  cell.addEventListener('dragover', e => { e.preventDefault(); cell.classList.add('drag-over'); });
  cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
  cell.addEventListener('drop', e => {
    e.preventDefault(); cell.classList.remove('drag-over');
    try {
      const d = JSON.parse(e.dataTransfer.getData('text/plain') || '{}');
      if (d.taskName) { if (d.fromKey) delete planState.schedule[d.fromKey]; planState.schedule[key]={taskName:d.taskName,taskIndex:d.taskIndex}; saveSchedule(); renderPlanning(); }
    } catch(err) {}
  });
}
function renderWeekView() {
  const ws = getWeekStart(planState.currentDate);
  const lbl = document.getElementById('plan-week-label'); if (lbl) lbl.textContent = formatWeekLabel(ws);
  const grid = document.getElementById('planning-grid'); if (!grid) return;
  grid.innerHTML = ''; grid.className = 'grid-week';
  const hdr = document.createElement('div'); hdr.className='grid-header';
  const tc = document.createElement('div'); tc.className='grid-time-col'; hdr.appendChild(tc);
  DAYS.forEach((d,i) => {
    const date = new Date(ws); date.setDate(date.getDate()+i);
    const today = formatDate(new Date()) === formatDate(date);
    const col = document.createElement('div'); col.className='grid-day-col'+(today?' today':''); col.textContent=d;
    const ds = document.createElement('span'); ds.className='grid-date'; ds.textContent=date.getDate(); col.appendChild(ds); hdr.appendChild(col);
  });
  grid.appendChild(hdr);
  for (let h=HOURS_START; h<HOURS_END; h++) {
    const row = document.createElement('div'); row.className='grid-row';
    const tc2 = document.createElement('div'); tc2.className='grid-time-col'; tc2.textContent=h+'h'; row.appendChild(tc2);
    DAYS.forEach((d,i) => {
      const date = new Date(ws); date.setDate(date.getDate()+i);
      const key = formatDate(date)+'_'+String(h).padStart(2,'0');
      const s = planState.schedule[key];
      const cell = document.createElement('div');
      cell.className = 'grid-cell'+(s?(s.isBlocked?' is-blocked-cell':s.isEvent?' is-event-cell':s.isRevision?' is-revision-cell has-task':' has-task'):'');
      cell.dataset.key = key;
      if (s) { const te = makeCellTask(key); if (te) cell.appendChild(te); }
      if (!s || !s.isBlocked) makeDroppable(cell, key);
      row.appendChild(cell);
    });
    grid.appendChild(row);
  }
}
function renderDayView() {
  const date = planState.currentDate;
  const lbl = document.getElementById('plan-week-label'); if (lbl) lbl.textContent = date.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
  const grid = document.getElementById('planning-grid'); if (!grid) return;
  grid.innerHTML = ''; grid.className = 'grid-day';
  for (let h=HOURS_START; h<HOURS_END; h++) {
    const key = formatDate(date)+'_'+String(h).padStart(2,'0');
    const row = document.createElement('div'); row.className='grid-row';
    const tc = document.createElement('div'); tc.className='grid-time-col'; tc.textContent=h+'h';
    const s = planState.schedule[key];
    const cell = document.createElement('div');
    cell.className='grid-cell grid-cell-day'+(s?(s.isBlocked?' is-blocked-cell':s.isEvent?' is-event-cell':s.isRevision?' is-revision-cell has-task':' has-task'):'');
    cell.dataset.key=key;
    if (s) { const te=makeCellTask(key); if (te) cell.appendChild(te); }
    if (!s || !s.isBlocked) makeDroppable(cell, key);
    row.appendChild(tc); row.appendChild(cell); grid.appendChild(row);
  }
}
function renderMonthView() {
  const date = planState.currentDate; const year=date.getFullYear(); const month=date.getMonth();
  const lbl = document.getElementById('plan-week-label'); if (lbl) lbl.textContent=date.toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
  const grid = document.getElementById('planning-grid'); if (!grid) return;
  grid.innerHTML=''; grid.className='grid-month';
  DAYS.forEach(d => { const h=document.createElement('div'); h.className='month-day-header'; h.textContent=d; grid.appendChild(h); });
  const fd=new Date(year,month,1); const so=(fd.getDay()===0?6:fd.getDay()-1); const dim=new Date(year,month+1,0).getDate();
  for (let i=0;i<so;i++) { const e=document.createElement('div'); e.className='month-cell empty'; grid.appendChild(e); }
  for (let d=1;d<=dim;d++) {
    const cd=new Date(year,month,d); const ds=formatDate(cd); const isT=ds===formatDate(new Date());
    const cell=document.createElement('div'); cell.className='month-cell'+(isT?' today':'');
    const dk=Object.keys(planState.schedule).filter(k=>k.startsWith(ds));
    const ns=document.createElement('span'); ns.className='month-day-num'; ns.textContent=d; cell.appendChild(ns);
    if (dk.length>0) { const cs=document.createElement('span'); cs.className='month-task-count'; cs.textContent=dk.length; cell.appendChild(cs); }
    cell.addEventListener('click', () => { planState.currentDate=cd; planState.view='day'; document.querySelectorAll('.view-tab').forEach(t=>t.classList.toggle('active',t.dataset.view==='day')); renderPlanning(); });
    grid.appendChild(cell);
  }
}
function renderUnscheduledTasks() {
  loadTasks(tasks => {
    const div = document.getElementById('unscheduled-tasks'); if (!div) return;
    const pending = tasks.filter(function(t){return !t.done;});
    if (!pending.length) { div.innerHTML='<p class="no-tasks">Aucune tache.</p>'; return; }
    const pm = {high:'!',medium:'-',low:'.'};
    div.innerHTML = pending.map((t,i) => {
      const mark=t.priority?pm[t.priority]:'.'; const name=t.task.trim();
      return '<div class="sidebar-task" draggable="true" data-index="'+i+'" data-name="'+name.replace(/"/g,'&quot;')+'">' +
        '<span class="sidebar-task-mark '+(t.priority||'')+'">'+mark+'</span>' +
        '<span class="sidebar-task-name">'+name+'</span>' +
        (t.estimatedTime?'<span class="sidebar-task-time">'+t.estimatedTime+'</span>':'') + '</div>';
    }).join('');
    div.querySelectorAll('.sidebar-task').forEach(el => {
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', JSON.stringify({taskName:el.dataset.name,taskIndex:parseInt(el.dataset.index)})); el.classList.add('dragging'); });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    });
  });
}
document.getElementById('plan-prev') && document.getElementById('plan-prev').addEventListener('click', () => {
  if (planState.view==='week') planState.currentDate.setDate(planState.currentDate.getDate()-7);
  else if (planState.view==='day') planState.currentDate.setDate(planState.currentDate.getDate()-1);
  else planState.currentDate.setMonth(planState.currentDate.getMonth()-1);
  renderPlanning();
});
document.getElementById('plan-next') && document.getElementById('plan-next').addEventListener('click', () => {
  if (planState.view==='week') planState.currentDate.setDate(planState.currentDate.getDate()+7);
  else if (planState.view==='day') planState.currentDate.setDate(planState.currentDate.getDate()+1);
  else planState.currentDate.setMonth(planState.currentDate.getMonth()+1);
  renderPlanning();
});
document.querySelectorAll('.view-tab').forEach(tab => {
  tab.addEventListener('click', () => { planState.view=tab.dataset.view; document.querySelectorAll('.view-tab').forEach(t=>t.classList.toggle('active',t.dataset.view===planState.view)); renderPlanning(); });
});
document.getElementById('plan-ai-btn') && document.getElementById('plan-ai-btn').addEventListener('click', planWithClaudeOrSmart);

async function planWithClaude() {
  const btn=document.getElementById('plan-ai-btn'); const st=document.getElementById('plan-ai-status');
  btn.disabled=true; btn.textContent='...'; st.textContent='Claude organise...';
  const apiKey=await getStoredKey(); if (!apiKey) { st.textContent='Cle manquante.'; btn.disabled=false; btn.textContent='Planifier avec Claude'; return; }
  const profile=await getProfile(); const ws=getWeekStart(planState.currentDate);
  loadTasks(async tasks => {
    const pending=tasks.filter(function(t){return !t.done;});
    if (!pending.length) { st.textContent='Aucune tache.'; btn.disabled=false; btn.textContent='Planifier avec Claude'; return; }
    const weekDays=DAYS.map((d,i)=>{const date=new Date(ws);date.setDate(date.getDate()+i);return formatDate(date);});
    const tl=pending.map((t,i)=>i+'. "'+t.task.trim()+'" priorite:'+(t.priority||'medium')+(t.estimatedTime?' duree:'+t.estimatedTime:'')).join('; ');
    const bl=Object.entries(planState.schedule).filter(([k,v])=>v.isBlocked||v.isEvent).map(([k,v])=>k+'('+v.taskName+')').join(', ');
    const pCtx=profile?'Profil:'+profile.name+(profile.job?','+profile.job:'')+(profile.workStyle?' style:'+profile.workStyle:''):'';
    const SYS='Tu es assistant planification. JSON uniquement. Format:{"schedule":[{"date":"YYYY-MM-DD","hour":9,"taskIndex":0,"taskName":"..."}]} Regles: heures '+HOURS_START+'h-'+(HOURS_END-1)+'h, jours '+weekDays.join(',')+', max 1/creneau, high en premier, max 6/jour, eviter:'+bl;
    try {
      const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:1000,system:SYS,messages:[{role:'user',content:pCtx+' Taches:'+tl}]})});
      const data=await r.json(); if (!data.content||!data.content[0]) throw new Error('vide');
      let raw=data.content[0].text.trim(); if (raw.startsWith('```')) raw=raw.split('```')[1].replace(/^json/,'').trim();
      const parsed=JSON.parse(raw); let placed=0;
      parsed.schedule.forEach(item=>{const key=item.date+'_'+String(item.hour).padStart(2,'0');if(!planState.schedule[key]){planState.schedule[key]={taskName:item.taskName,taskIndex:item.taskIndex};placed++;}});
      saveSchedule(); renderPlanning();
      st.textContent=placed+' tache'+(placed>1?'s':'')+' placee'+(placed>1?'s':'')+'.';
      setTimeout(()=>{st.textContent='';},3000);
    } catch(err) { st.textContent='Erreur:'+err.message; }
    btn.disabled=false; btn.textContent='Planifier avec Claude';
  });
}

// Import emploi du temps
document.getElementById('import-schedule-btn') && document.getElementById('import-schedule-btn').addEventListener('click', () => { document.getElementById('schedule-file-input').click(); });
document.getElementById('schedule-file-input') && document.getElementById('schedule-file-input').addEventListener('change', async e => {
  const file=e.target.files[0]; if (!file) return;
  const st=document.getElementById('plan-ai-status'); st.textContent='Lecture emploi du temps...';
  const apiKey=await getStoredKey(); if (!apiKey) { st.textContent='Cle manquante.'; return; }
  const reader=new FileReader();
  reader.onload=async()=>{
    const b64=reader.result.split(',')[1]; const isPDF=file.type==='application/pdf'; const isImg=file.type.startsWith('image/');
    if (!isPDF&&!isImg) { st.textContent='Format non supporte.'; return; }
    const cb=isPDF?{type:'document',source:{type:'base64',media_type:'application/pdf',data:b64}}:{type:'image',source:{type:'base64',media_type:file.type,data:b64}};
    const ws=getWeekStart(planState.currentDate);
    const wd=DAYS.map((d,i)=>{const date=new Date(ws);date.setDate(date.getDate()+i);return{label:d,date:formatDate(date)};});
    const SYS='Tu analyses un emploi du temps. JSON uniquement. Format:{"slots":[{"day":"Lundi","hour_start":8,"hour_end":13,"label":"Cours maths"}]} Regles: hour_start=heure de debut ARRONDIE AU BAS (ex: 8h45->8), hour_end=heure de fin ARRONDIE AU HAUT (ex: 12h45->13). Jours: Lundi Mardi Mercredi Jeudi Vendredi Samedi Dimanche. Extrait TOUS les creneaux y compris le matin.';
    try {
      const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-opus-4-6',max_tokens:1500,system:SYS,messages:[{role:'user',content:[cb,{type:'text',text:'Extrait tous les creneaux.'}]}]})});
      const data=await r.json(); if (!data.content||!data.content[0]) throw new Error('vide');
      let raw=data.content[0].text.trim(); if (raw.startsWith('```')) raw=raw.split('```')[1].replace(/^json/,'').trim();
      const parsed=JSON.parse(raw);
      const dm={'Lundi':0,'Mardi':1,'Mercredi':2,'Jeudi':3,'Vendredi':4,'Samedi':5,'Dimanche':6};
      let blocked=0;
      parsed.slots.forEach(slot=>{const di=dm[slot.day];if(di===undefined)return;const d=wd[di];if(!d)return;for(let h=slot.hour_start;h<slot.hour_end;h++){const key=d.date+'_'+String(h).padStart(2,'0');if(!planState.schedule[key]){planState.schedule[key]={taskName:slot.label,isBlocked:true};blocked++;}}});
      saveSchedule(); renderPlanning();
      st.textContent=blocked+' creneau'+(blocked>1?'x':'')+' bloque'+(blocked>1?'s':'')+'.';
      setTimeout(()=>{st.textContent='';},4000);
    } catch(err) { st.textContent='Erreur:'+err.message; }
  };
  reader.readAsDataURL(file); e.target.value='';
});

// Upload docs preparation
document.getElementById('planning-docs-input') && document.getElementById('planning-docs-input').addEventListener('change', async e => {
  const files=Array.from(e.target.files); if (!files.length) return;
  const st=document.getElementById('plan-ai-status'); st.textContent='Analyse des documents...';
  const apiKey=await getStoredKey(); if (!apiKey) { st.textContent='Cle manquante.'; return; }
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  const pt=document.querySelector('[data-tab="planning"]'); if (pt) pt.classList.add('active');
  const ptt=document.getElementById('tab-planning'); if (ptt) ptt.classList.add('active');
  try {
    const cbs=[];
    for (const file of files.slice(0,3)) {
      const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(file);});
      if (file.type==='application/pdf') cbs.push({type:'document',source:{type:'base64',media_type:'application/pdf',data:b64}});
      else cbs.push({type:'image',source:{type:'base64',media_type:file.type,data:b64}});
    }
    const ws=getWeekStart(planState.currentDate);
    const wd=DAYS.map((d,i)=>{const date=new Date(ws);date.setDate(date.getDate()+i);return formatDate(date);});
    const bl=Object.entries(planState.schedule).filter(([k,v])=>v.isBlocked||v.isEvent).map(([k,v])=>k+'('+v.taskName+')').join(', ');
    cbs.push({type:'text',text:'Jours dispo:'+wd.join(',')+'. Bloques:'+(bl||'aucun')+'. Max 3h/jour.'});
    const SYS='Tu analyses des documents et crees un planning. JSON uniquement. Format:{"tasks":[{"taskName":"...","date":"YYYY-MM-DD","hour":9}],"reply":"..."} Sessions 1-2h reparties.';
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-opus-4-6',max_tokens:1500,system:SYS,messages:[{role:'user',content:cbs}]})});
    const data=await r.json(); if (!data.content||!data.content[0]) throw new Error('vide');
    let raw=data.content[0].text.trim(); if (raw.startsWith('```')) raw=raw.split('```')[1].replace(/^json/,'').trim();
    const parsed=JSON.parse(raw); let placed=0;
    parsed.tasks.forEach(item=>{const key=item.date+'_'+String(item.hour).padStart(2,'0');if(!planState.schedule[key]){planState.schedule[key]={taskName:item.taskName};placed++;}});
    saveSchedule(); renderPlanning();
    st.textContent=placed+' session'+(placed>1?'s':'')+' planifiee'+(placed>1?'s':'')+'.';
    if (parsed.reply) setStatus(parsed.reply);
    setTimeout(()=>{st.textContent='';},4000);
  } catch(err) { st.textContent='Erreur:'+err.message; }
  e.target.value='';
});

function showAskDocsModal(eventName) {
  const ex=document.getElementById('ask-docs-modal'); if (ex) ex.remove();
  const modal=document.createElement('div'); modal.id='ask-docs-modal';
  modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;';
  const inner=document.createElement('div');
  inner.style.cssText='background:#111118;border:1px solid #2a2a3e;border-top:2px solid #7c6fcd;border-radius:8px;padding:24px;width:320px;';
  const title=document.createElement('div'); title.style.cssText='font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#5a5a7a;font-weight:600;margin-bottom:12px;'; title.textContent='Preparer avec des documents'; inner.appendChild(title);
  const body=document.createElement('div'); body.style.cssText='font-size:13px;color:#c0c0d8;margin-bottom:18px;line-height:1.5;';
  body.innerHTML='Envoie-moi des documents pour preparer <strong style="color:#9088c8;">'+(eventName||'cet evenement')+'</strong> et je reorganiserai ton planning.';
  inner.appendChild(body);
  const btns=document.createElement('div'); btns.style.cssText='display:flex;gap:8px;justify-content:flex-end;';
  const no=document.createElement('button'); no.style.cssText='padding:7px 16px;background:transparent;border:1px solid #2a2a3e;border-radius:4px;color:#5a5a7a;font-size:12px;cursor:pointer;'; no.textContent='Pas maintenant'; no.addEventListener('click',()=>modal.remove()); btns.appendChild(no);
  const yes=document.createElement('button'); yes.style.cssText='padding:7px 16px;background:#7c6fcd;border:none;border-radius:4px;color:white;font-size:12px;font-weight:500;cursor:pointer;'; yes.textContent='Oui, envoyer'; yes.addEventListener('click',()=>{modal.remove();const inp=document.getElementById('planning-docs-input');if(inp)inp.click();}); btns.appendChild(yes);
  inner.appendChild(btns); modal.appendChild(inner); document.body.appendChild(modal);
}

// ── SMART PLANNING ENGINE ────────────────────────────────────────────────────

function getTodayISO() {
  // Use local date, NOT UTC (toISOString uses UTC which can shift the day)
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function getRevisionGoals() {
  return new Promise(r => chrome.storage.local.get(['revisionGoals'], d => r(d.revisionGoals || [])));
}
function saveRevisionGoals(goals) { chrome.storage.local.set({ revisionGoals: goals }); }

// Wipe ALL revision sessions, keep blocked (cours) and events
function clearRevisionSessions(schedule) {
  const cleaned = {};
  Object.entries(schedule).forEach(([k, v]) => {
    if (!v.isRevision) cleaned[k] = v;
  });
  return cleaned;
}

// Get free slots FROM TODAY for N weeks, skipping blocked/event slots
function getFreeSlots(schedule, weeks) {
  const slots = [];
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + weeks * 7);
  const cur = new Date(start);
  while (cur < end) {
    // Always use local date parts to avoid UTC shift
    const ds = cur.getFullYear() + '-'
      + String(cur.getMonth() + 1).padStart(2, '0') + '-'
      + String(cur.getDate()).padStart(2, '0');
    for (let h = HOURS_START; h < HOURS_END; h++) {
      const key = ds + '_' + String(h).padStart(2, '0');
      if (!schedule[key]) slots.push({ date: ds, hour: h, key });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return slots;
}

// ── MAIN SMART AGENT ─────────────────────────────────────────────────────────
async function runAgent(userInput) {
  const apiKey = await getStoredKey();
  if (!apiKey) { setStatus('Cle Anthropic manquante.'); return; }
  setStatus('...');

  const profile = await getProfile();
  const memCtx = await getMemoryContext();
  const revisionGoals = await getRevisionGoals();

  let pCtx = '';
  if (profile && profile.name) {
    pCtx = 'Utilisateur: ' + profile.name
      + (profile.job ? ', ' + profile.job : '')
      + (profile.workStyle ? ', style: ' + profile.workStyle : '') + '.';
    if (profile.projects) pCtx += ' Projets: ' + profile.projects + '.';
  }
  if (memCtx) pCtx += memCtx;

  const todayISO = getTodayISO();
  console.log('[SmartReplan] Today:', todayISO, '| Goals:', revisionGoals.length);
  const todayLabel = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  // Current schedule summary
  const schedule = planState.schedule;
  const blockedStr = Object.entries(schedule)
    .filter(([k,v]) => v.isBlocked)
    .slice(0, 40)
    .map(([k,v]) => k + '(' + v.taskName + ')').join(', ');
  const eventsStr = Object.entries(schedule)
    .filter(([k,v]) => v.isEvent)
    .slice(0, 20)
    .map(([k,v]) => k + '(' + v.taskName + ')').join(', ');
  const goalsStr = revisionGoals.length
    ? revisionGoals.map(g => g.subject + ':' + g.hoursPerWeek + 'h/sem' + (g.deadline ? ' deadline:' + g.deadline : '')).join(', ')
    : 'aucun';

  const SYS = pCtx
    + ' AUJOURD HUI: ' + todayISO + ' (' + todayLabel + ').'
    + ' NE JAMAIS planifier avant ' + todayISO + '.'
    + ' Cours bloques: ' + (blockedStr || 'aucun') + '.'
    + ' Evenements: ' + (eventsStr || 'aucun') + '.'
    + ' Objectifs revision actuels: ' + goalsStr + '.'
    + ' Tu es un assistant planning intelligent. Reponds UNIQUEMENT JSON valide.'
    + ' Format: {"action":"add_task|add_event|add_both|set_revision_goals|replan|list|unknown",'
    + '"task":"nom",'
    + '"event":{"name":"...","date":"YYYY-MM-DD","hour":9,"duration_hours":1},'
    + '"revision_goals":[{"subject":"maths","hours_per_week":3,"priority":"high|medium|low","deadline":"YYYY-MM-DD ou null"}],'
    + '"ask_docs":false,'
    + '"replan_after":false,'
    + '"reply":"phrase naturelle"}'
    + ' Regles: si date/echeance -> add_event; tache+date -> add_both; si parle de revisions/matieres/concours -> set_revision_goals ET replan_after=true ET ask_docs=true; reply=phrase naturelle.';

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, system: SYS, messages: [{ role: 'user', content: userInput }] })
    });
    const data = await resp.json();
    if (!data.content || !data.content[0]) { setStatus('Erreur'); return; }
    let raw = data.content[0].text.trim();
    if (raw.startsWith('```')) raw = raw.split('```')[1].replace(/^json/, '').trim();
    const cmd = JSON.parse(raw);

    // Add event to calendar
    if ((cmd.action === 'add_event' || cmd.action === 'add_both') && cmd.event) {
      const ev = cmd.event;
      if (ev.date && ev.hour !== undefined) {
        const dur = ev.duration_hours || 1;
        for (let h = ev.hour; h < ev.hour + dur; h++) {
          planState.schedule[ev.date + '_' + String(h).padStart(2,'0')] = { taskName: ev.name, isEvent: true };
        }
        saveSchedule();
        try { planState.currentDate = new Date(ev.date + 'T12:00:00'); planState.view = 'week'; } catch(e2) {}
        if (document.getElementById('tab-planning') && document.getElementById('tab-planning').classList.contains('active')) renderPlanning();
      }
    }

    // Add task
    if ((cmd.action === 'add_task' || cmd.action === 'add_both') && cmd.task) {
      loadTasks(tasks => { tasks.push({ task: cmd.task, done: false, priority: 'medium' }); saveTasks(tasks); renderTasks(tasks); });
    }

    // Set revision goals → always triggers full replan
    if (cmd.action === 'set_revision_goals' && cmd.revision_goals && cmd.revision_goals.length) {
      const incoming = cmd.revision_goals.map(g => ({
        subject: g.subject,
        hoursPerWeek: g.hours_per_week || 2,
        priority: g.priority || 'medium',
        deadline: g.deadline || null,
        addedAt: Date.now()
      }));
      const existing = await getRevisionGoals();
      const merged = [...existing];
      incoming.forEach(g => {
        const idx = merged.findIndex(e => e.subject.toLowerCase() === g.subject.toLowerCase());
        if (idx >= 0) merged[idx] = g; else merged.push(g);
      });
      saveRevisionGoals(merged);
      renderRevisionGoalsPanel();
      if (cmd.reply) setStatus(cmd.reply);
      setTimeout(() => smartReplan(), 800);
      if (cmd.ask_docs) setTimeout(() => showAskDocsModal(incoming.map(g => g.subject).join(', ')), 2500);
      if (userInput.length > 20) askToSaveMemory(userInput);
      return;
    }

    if (cmd.action === 'list') {
      loadTasks(tasks => { setStatus(tasks.length + ' tache' + (tasks.length > 1 ? 's' : '')); renderTasks(tasks); });
    }

    if (cmd.reply && cmd.action !== 'list') setStatus(cmd.reply);

    // Ask docs for events too
    if (cmd.ask_docs) {
      const evtName = cmd.event ? cmd.event.name : cmd.task;
      setTimeout(() => showAskDocsModal(evtName), 1500);
    }

    // Replan if new event added (to avoid scheduling revisions during the event)
    if (cmd.replan_after || cmd.action === 'replan') {
      setTimeout(() => smartReplan(), 1000);
    }

    if (userInput.length > 20) askToSaveMemory(userInput);

  } catch(err) { setStatus('Erreur: ' + err.message); }
}

// ── SMART REPLAN ──────────────────────────────────────────────────────────────
// Called after: goals change, EDT import, event added, docs uploaded
async function smartReplan() {
  const st = document.getElementById('plan-ai-status');
  if (st) st.textContent = 'Claude replanie les revisions...';

  const apiKey = await getStoredKey();
  if (!apiKey) { if (st) st.textContent = 'Cle manquante.'; return; }

  const revisionGoals = await getRevisionGoals();
  if (!revisionGoals.length) {
    planWithClaude(); return;
  }

  // 1. Wipe old revision sessions
  let schedule = clearRevisionSessions(planState.schedule);

  // 2. Get free slots from TODAY
  const todayISO = getTodayISO();
  const freeSlots = getFreeSlots(schedule, 4); // 4 weeks
  // Only keep slots from today onwards
  const futureFree = freeSlots.filter(s => s.date >= todayISO);

  // 3. Build blocked/event summary
  const blockedList = Object.entries(schedule)
    .filter(([k, v]) => (v.isBlocked || v.isEvent) && k.split('_')[0] >= todayISO)
    .map(([k, v]) => k + '(' + v.taskName + ')').join(', ');

  const eventsList = Object.entries(schedule)
    .filter(([k, v]) => v.isEvent && k.split('_')[0] >= todayISO)
    .map(([k, v]) => ({ date: k.split('_')[0], hour: parseInt(k.split('_')[1]), name: v.taskName }));

  // Deadlines from events (for context)
  const deadlineContext = eventsList
    .map(e => e.date + ': ' + e.name).join(', ');

  // 4. Goals string
  const goalsStr = revisionGoals.map(g =>
    g.subject + ' ' + g.hoursPerWeek + 'h/semaine priorite:' + g.priority
    + (g.deadline ? ' deadline:' + g.deadline : '')
  ).join('; ');

  // 5. Free slots string (compact)
  const freeSlotsStr = futureFree.slice(0, 120).map(s => s.date + ' ' + s.hour + 'h').join(', ');

  const SYS = 'Tu es un planificateur de revisions intelligent.'
    + ' Reponds UNIQUEMENT JSON valide.'
    + ' Format: {"sessions":[{"subject":"maths","date":"YYYY-MM-DD","hour":9,"duration":1,"label":"Rev. maths - algebre"}],"reply":"..."}'
    + ' Regles ABSOLUES:'
    + ' 1. Ne jamais placer de session avant ' + todayISO
    + ' 2. Ne jamais placer sur un creneau bloque ou event'
    + ' 3. Respecter exactement les heures/semaine demandees'
    + ' 4. Sessions de 1-2h max, bien reparties dans la semaine'
    + ' 5. Prioriser les matieres avec deadline proche'
    + ' 6. Equilibrer: pas plus de 4h de revision par jour'
    + ' 7. Utiliser UNIQUEMENT les creneaux libres fournis';

  const userMsg = 'Aujourd hui: ' + todayISO + '.'
    + ' Objectifs: ' + goalsStr + '.'
    + ' Echeances/concours: ' + (deadlineContext || 'aucun') + '.'
    + ' Cours et events (INTERDIT de planifier dessus): ' + (blockedList || 'aucun') + '.'
    + ' Creneaux libres disponibles: ' + (freeSlotsStr || 'aucun') + '.'
    + ' Place les sessions de revision sur les 4 prochaines semaines.';

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: 'claude-opus-4-6', max_tokens: 2000, system: SYS, messages: [{ role: 'user', content: userMsg }] })
    });
    const data = await resp.json();
    if (!data.content || !data.content[0]) throw new Error('Reponse vide');
    let raw = data.content[0].text.trim();
    if (raw.startsWith('```')) raw = raw.split('```')[1].replace(/^json/, '').trim();
    const parsed = JSON.parse(raw);

    let placed = 0;
    parsed.sessions.forEach(s => {
      // Safety check: never place before today
      if (s.date < todayISO) return;
      const dur = s.duration || 1;
      for (let h = s.hour; h < s.hour + dur; h++) {
        const key = s.date + '_' + String(h).padStart(2,'0');
        // Never overwrite blocked/event slots
        if (!schedule[key]) {
          schedule[key] = { taskName: s.label || ('Rev. ' + s.subject), isRevision: true, subject: s.subject };
          placed++;
        }
      }
    });

    planState.schedule = schedule;
    saveSchedule();
    renderPlanning();
    renderRevisionGoalsPanel();

    if (st) {
      st.textContent = placed + ' session' + (placed > 1 ? 's' : '') + ' planifiee' + (placed > 1 ? 's' : '') + '.';
      if (parsed.reply) st.textContent += ' ' + parsed.reply;
      setTimeout(() => { if (st) st.textContent = ''; }, 5000);
    }
  } catch(err) {
    if (st) st.textContent = 'Erreur: ' + err.message;
    console.error('smartReplan error:', err);
  }
}

async function planWithClaudeOrSmart() {
  const goals = await getRevisionGoals();
  if (goals.length > 0) smartReplan(); else planWithClaude();
}

// ── REVISION GOALS PANEL ──────────────────────────────────────────────────────
function renderRevisionGoalsPanel() {
  getRevisionGoals().then(goals => {
    const panel = document.getElementById('revision-goals-panel');
    if (!panel) return;
    if (!goals.length) {
      panel.innerHTML = '<div class="rg-empty">Dis-moi ce que tu veux reviser (ex: "je dois reviser maths 3h/sem et physique 2h/sem pour le 20 juin")</div>';
      return;
    }
    const pm = { high:'!', medium:'-', low:'.' };
    panel.innerHTML = '<div class="rg-title">Objectifs de revision</div>'
      + goals.map((g, i) =>
        '<div class="rg-item">'
        + '<span class="rg-priority ' + g.priority + '">' + (pm[g.priority]||'-') + '</span>'
        + '<span class="rg-subject">' + g.subject + '</span>'
        + '<span class="rg-hours">' + g.hoursPerWeek + 'h/sem</span>'
        + (g.deadline ? '<span class="rg-deadline">' + new Date(g.deadline + 'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'}) + '</span>' : '')
        + '<span class="rg-delete" data-index="' + i + '">x</span>'
        + '</div>'
      ).join('')
      + '<button id="rg-replan-btn">Replanner maintenant</button>';

    panel.querySelectorAll('.rg-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const goals2 = await getRevisionGoals();
        goals2.splice(parseInt(btn.dataset.index), 1);
        saveRevisionGoals(goals2);
        renderRevisionGoalsPanel();
        if (goals2.length > 0) setTimeout(() => smartReplan(), 300);
      });
    });
    const rb = panel.querySelector('#rg-replan-btn');
    if (rb) rb.addEventListener('click', () => smartReplan());
  });
}



setInterval(() => loadTasks(renderTasks), 30000);