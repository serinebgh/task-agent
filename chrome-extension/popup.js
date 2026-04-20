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
    if (tab.dataset.tab === 'stats') renderStatsTab();
    if (tab.dataset.tab === 'planning') renderRevisionGoalsPanel();
    if (tab.dataset.tab === 'profile') renderMemoryList();
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
const HOURS_END = 24;
// Work hours for scheduling: 19h-01h
const WORK_HOURS_START = 19;
const WORK_HOURS_END_NEXT = 2; // goes to 02h next day
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
  div.className = 'cell-task' + (s.isEvent?' is-event':s.isBlocked?' is-blocked':'');
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
      cell.className = 'grid-cell'+(s?(s.isBlocked?' is-blocked-cell':s.isEvent?' is-event-cell':' has-task'):'');
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
    cell.className='grid-cell grid-cell-day'+(s?(s.isBlocked?' is-blocked-cell':s.isEvent?' is-event-cell':' has-task'):'');
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

// Smart runAgent with calendar detection
const _origAgent = runAgent;
async function runAgent(userInput) {
  const apiKey=await getStoredKey(); if (!apiKey) { setStatus('Cle manquante.'); return; }
  setStatus('...');
  const profile=await getProfile(); const memCtx=await getMemoryContext();
  let pCtx='';
  if (profile&&profile.name) { pCtx='Assistant de '+profile.name+(profile.job?','+profile.job:'')+(profile.workStyle?' style:'+profile.workStyle:'')+(profile.projects?' projets:'+profile.projects:'')+'.'; }
  if (memCtx) pCtx+=memCtx;
  const today=new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const SYS=pCtx+' Aujourd hui:'+today+'. Tu es assistant gestion taches et planning. Reponds JSON uniquement. Format:{"action":"add_task|add_event|add_both|list|done|unknown","task":"nom","event":{"name":"...","date":"YYYY-MM-DD","hour":9,"duration_hours":1},"schedule_tasks":false,"reply":"reponse courte","ask_docs":false} Regles: date/echeance->add_event, tache+date->add_both, ask_docs=true si examen/concours/projet, reply phrase naturelle.';
  try {
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:300,system:SYS,messages:[{role:'user',content:userInput}]})});
    const data=await r.json(); if (!data.content||!data.content[0]) { setStatus('Erreur'); return; }
    let raw=data.content[0].text.trim(); if (raw.startsWith('```')) raw=raw.split('```')[1].replace(/^json/,'').trim();
    const cmd=JSON.parse(raw);
    if ((cmd.action==='add_event'||cmd.action==='add_both')&&cmd.event) {
      const ev=cmd.event;
      if (ev.date&&ev.hour!==undefined) {
        const dur=ev.duration_hours||1;
        for (let h=ev.hour;h<ev.hour+dur;h++) { const key=ev.date+'_'+String(h).padStart(2,'0'); planState.schedule[key]={taskName:ev.name,isEvent:true}; }
        saveSchedule();
        try { planState.currentDate=new Date(ev.date+'T12:00:00'); planState.view='week'; } catch(e2) {}
        const pt=document.getElementById('tab-planning'); if (pt&&pt.classList.contains('active')) renderPlanning();
      }
    }
    if ((cmd.action==='add_task'||cmd.action==='add_both')&&cmd.task) { loadTasks(tasks=>{tasks.push({task:cmd.task,done:false,priority:'medium'});saveTasks(tasks);renderTasks(tasks);}); }
    if (cmd.action==='list') { loadTasks(tasks=>{setStatus(tasks.length+' tache'+(tasks.length>1?'s':''));renderTasks(tasks);}); }
    if (cmd.reply&&cmd.action!=='list') setStatus(cmd.reply);
    if (cmd.ask_docs) setTimeout(()=>showAskDocsModal(cmd.event?cmd.event.name:cmd.task),1500);
    if (cmd.schedule_tasks) setTimeout(()=>{const pt=document.getElementById('tab-planning');if(pt&&pt.classList.contains('active'))planWithClaude();},2000);
    if (userInput.length>20) askToSaveMemory(userInput);
  } catch(err) { setStatus('Erreur:'+err.message); }
}



// ── SMART PLANNING ENGINE ─────────────────────────────────────────────────────
function getTodayISO() {
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function getRevisionGoals() { return new Promise(r => chrome.storage.local.get(['revisionGoals'], d => r(d.revisionGoals || []))); }
function saveRevisionGoals(goals) { chrome.storage.local.set({ revisionGoals: goals }); }
function clearRevisionSessions(schedule) {
  const c = {}; Object.entries(schedule).forEach(([k,v]) => { if (!v.isRevision) c[k]=v; }); return c;
}
function getFreeSlots(schedule, weeks) {
  // Work hours: 19h-02h (next day). Split into evening same day + early morning next day.
  const WORK_HOURS = [19,20,21,22,23,0,1]; // 19h to 01h
  const slots = []; const start = new Date(); start.setHours(0,0,0,0);
  const end = new Date(start); end.setDate(end.getDate()+weeks*7); const cur = new Date(start);
  while (cur < end) {
    const ds = cur.getFullYear()+'-'+String(cur.getMonth()+1).padStart(2,'0')+'-'+String(cur.getDate()).padStart(2,'0');
    WORK_HOURS.forEach(h => {
      // Hours 0,1 belong to the NEXT calendar day
      let slotDate = ds;
      if (h <= 1) {
        const nextDay = new Date(cur); nextDay.setDate(cur.getDate()+1);
        slotDate = nextDay.getFullYear()+'-'+String(nextDay.getMonth()+1).padStart(2,'0')+'-'+String(nextDay.getDate()).padStart(2,'0');
      }
      const key = slotDate+'_'+String(h).padStart(2,'0');
      if (!schedule[key]) slots.push({date:slotDate,hour:h,key});
    });
    cur.setDate(cur.getDate()+1);
  }
  // Deduplicate
  const seen = new Set();
  return slots.filter(s => { const k=s.key; if(seen.has(k))return false; seen.add(k); return true; });
}

// ── SMART REPLAN ──────────────────────────────────────────────────────────────
async function smartReplan() {
  const st = document.getElementById('plan-ai-status');
  if (st) st.textContent = 'Claude replanie...';
  const apiKey = await getStoredKey(); if (!apiKey) { if(st) st.textContent='Cle manquante.'; return; }
  const revisionGoals = await getRevisionGoals();
  if (!revisionGoals.length) { planWithClaude(); return; }
  let schedule = clearRevisionSessions(planState.schedule);
  const todayISO = getTodayISO();
  const futureFree = getFreeSlots(schedule,4).filter(s => s.date >= todayISO);
  const blockedList = Object.entries(schedule).filter(([k,v])=>(v.isBlocked||v.isEvent)&&k.split('_')[0]>=todayISO).map(([k,v])=>k+'('+v.taskName+')').join(', ');
  const deadlineCtx = Object.entries(schedule).filter(([k,v])=>v.isEvent&&k.split('_')[0]>=todayISO).map(([k,v])=>k.split('_')[0]+': '+v.taskName).join(', ');
  const goalsStr = revisionGoals.map(g=>g.subject+' '+g.hoursPerWeek+'h/semaine priorite:'+g.priority+(g.deadline?' deadline:'+g.deadline:'')).join('; ');
  const freeSlotsStr = futureFree.slice(0,120).map(s=>s.date+' '+s.hour+'h').join(', ');
  const SYS = 'Tu es planificateur revisions. JSON uniquement. Format:{"sessions":[{"subject":"maths","date":"YYYY-MM-DD","hour":19,"duration":1,"label":"Rev. maths - algebre"}],"reply":"..."} REGLES ABSOLUES: 1.jamais avant '+todayISO+' 2.jamais sur bloque/event 3.heures de travail: 19h-01h UNIQUEMENT (pas avant 19h) 4.sessions 1-2h max 5.max 4h/nuit 6.utiliser UNIQUEMENT creneaux libres fournis';
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-opus-4-6',max_tokens:2000,system:SYS,messages:[{role:'user',content:'Aujourd hui: '+todayISO+'. Objectifs: '+goalsStr+'. Echeances: '+(deadlineCtx||'aucun')+'. Cours INTERDIT: '+(blockedList||'aucun')+'. Creneaux libres: '+(freeSlotsStr||'aucun')+'.'}]})});
    const data = await resp.json(); if (!data.content||!data.content[0]) throw new Error('vide');
    let raw = data.content[0].text.trim(); if (raw.startsWith('```')) raw=raw.split('```')[1].replace(/^json/,'').trim();
    const parsed = JSON.parse(raw); let placed = 0;
    parsed.sessions.forEach(s => {
      if (s.date < todayISO) return; const dur=s.duration||1;
      for (let h=s.hour; h<s.hour+dur; h++) {
        const key=s.date+'_'+String(h).padStart(2,'0');
        if (!schedule[key]) { schedule[key]={taskName:s.label||('Rev. '+s.subject),isRevision:true,subject:s.subject}; placed++; }
      }
    });
    planState.schedule=schedule; saveSchedule(); renderPlanning(); renderRevisionGoalsPanel();
    if (st) { st.textContent=placed+' session'+(placed>1?'s':'')+' planifiee'+(placed>1?'s':'')+'.'; setTimeout(()=>{if(st)st.textContent='';},5000); }
  } catch(err) { if(st) st.textContent='Erreur: '+err.message; }
}

async function planWithClaudeOrSmart() {
  const goals = await getRevisionGoals(); if (goals.length>0) smartReplan(); else planWithClaude();
}

function renderRevisionGoalsPanel() {
  getRevisionGoals().then(goals => {
    const panel = document.getElementById('revision-goals-panel'); if (!panel) return;
    if (!goals.length) { panel.innerHTML='<div class="rg-empty">Dis-moi ce que tu veux reviser (ex: "maths 3h/sem, physique 2h/sem pour le 20 juin")</div>'; return; }
    const pm={high:'!',medium:'-',low:'.'};
    panel.innerHTML='<div class="rg-title">Objectifs de revision</div>'+goals.map((g,i)=>'<div class="rg-item"><span class="rg-priority '+g.priority+'">'+(pm[g.priority]||'-')+'</span><span class="rg-subject">'+g.subject+'</span><span class="rg-hours">'+g.hoursPerWeek+'h/sem</span>'+(g.deadline?'<span class="rg-deadline">'+new Date(g.deadline+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'})+'</span>':'')+'<span class="rg-delete" data-index="'+i+'">x</span></div>').join('')+'<button id="rg-replan-btn">Replanner maintenant</button>';
    panel.querySelectorAll('.rg-delete').forEach(btn=>{ btn.addEventListener('click',async()=>{ const g2=await getRevisionGoals(); g2.splice(parseInt(btn.dataset.index),1); saveRevisionGoals(g2); renderRevisionGoalsPanel(); if(g2.length>0) setTimeout(()=>smartReplan(),300); }); });
    const rb=panel.querySelector('#rg-replan-btn'); if(rb) rb.addEventListener('click',()=>smartReplan());
  });
}

// ── EDT IMPORT RECURRING 12 SEMAINES ─────────────────────────────────────────
document.getElementById('import-schedule-btn') && document.getElementById('import-schedule-btn').addEventListener('click', () => { document.getElementById('schedule-file-input').click(); });
document.getElementById('schedule-file-input') && document.getElementById('schedule-file-input').addEventListener('change', async e => {
  const file=e.target.files[0]; if(!file) return;
  const st=document.getElementById('plan-ai-status'); st.textContent='Lecture emploi du temps...';
  const apiKey=await getStoredKey(); if(!apiKey){st.textContent='Cle manquante.';return;}
  const reader=new FileReader();
  reader.onload=async()=>{
    const b64=reader.result.split(',')[1]; const isPDF=file.type==='application/pdf'; const isImg=file.type.startsWith('image/');
    if(!isPDF&&!isImg){st.textContent='Format non supporte.';return;}
    const cb=isPDF?{type:'document',source:{type:'base64',media_type:'application/pdf',data:b64}}:{type:'image',source:{type:'base64',media_type:file.type,data:b64}};
    const SYS='Tu analyses un emploi du temps HEBDOMADAIRE RECURRENT. JSON uniquement. Format:{"slots":[{"day":"Lundi","hour_start":8,"hour_end":13,"label":"Cours maths"}]} Regles: hour_start=heure debut ARRONDIE AU BAS (8h45->8), hour_end=heure fin ARRONDIE AU HAUT (12h45->13). Jours: Lundi Mardi Mercredi Jeudi Vendredi Samedi Dimanche. Extrait ABSOLUMENT TOUS les creneaux y compris le matin.';
    try {
      const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-opus-4-6',max_tokens:2000,system:SYS,messages:[{role:'user',content:[cb,{type:'text',text:'Extrait tous les creneaux. Inclus les cours du matin.'}]}]})});
      const data=await r.json(); if(!data.content||!data.content[0]) throw new Error('vide');
      let raw=data.content[0].text.trim(); if(raw.startsWith('```')) raw=raw.split('```')[1].replace(/^json/,'').trim();
      const parsed=JSON.parse(raw);
      const dm={'Lundi':0,'Mardi':1,'Mercredi':2,'Jeudi':3,'Vendredi':4,'Samedi':5,'Dimanche':6};
      const WEEKS_AHEAD=12; let blocked=0;
      const todayBase=new Date(); todayBase.setHours(0,0,0,0);
      const dow=todayBase.getDay(); const mondayOff=dow===0?-6:1-dow;
      for(let w=0;w<WEEKS_AHEAD;w++){
        const wMon=new Date(todayBase); wMon.setDate(todayBase.getDate()+mondayOff+w*7);
        parsed.slots.forEach(function(slot){
          const di=dm[slot.day]; if(di===undefined)return;
          const sd=new Date(wMon); sd.setDate(wMon.getDate()+di);
          const ds=sd.getFullYear()+'-'+String(sd.getMonth()+1).padStart(2,'0')+'-'+String(sd.getDate()).padStart(2,'0');
          for(let h=slot.hour_start;h<slot.hour_end;h++){
            const key=ds+'_'+String(h).padStart(2,'0');
            if(!planState.schedule[key]){planState.schedule[key]={taskName:slot.label,isBlocked:true};blocked++;}
          }
        });
      }
      saveSchedule(); renderPlanning();
      st.textContent=blocked+' creneaux bloques (12 semaines).';
      setTimeout(function(){st.textContent='';smartReplan();},1500);
    } catch(err){st.textContent='Erreur: '+err.message;}
  };
  reader.readAsDataURL(file); e.target.value='';
});

// ── IMPORT ORGANISER → PLANNING AVEC DEMANDE HEURES/JOUR ─────────────────────
// Remplace l'import basique qui met tout en "à faire"
function showHoursPerDayModal(tasksToSchedule) {
  const ex = document.getElementById('hours-modal'); if (ex) ex.remove();
  const modal = document.createElement('div'); modal.id = 'hours-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;';
  const inner = document.createElement('div');
  inner.style.cssText = 'background:#111118;border:1px solid #2a2a3e;border-top:2px solid #7c6fcd;border-radius:8px;padding:24px;width:320px;';
  inner.innerHTML = '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#5a5a7a;font-weight:600;margin-bottom:12px;">Planifier dans le calendrier</div>'
    + '<div style="font-size:13px;color:#c0c0d8;margin-bottom:16px;line-height:1.5;">Combien d\'heures veux-tu travailler par jour sur ces taches ?</div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">'
    + ['1h','2h','3h','4h'].map(h => '<button class="hours-btn" data-hours="'+h.replace('h','')+'" style="flex:1;padding:8px;background:#16161f;border:1px solid #2a2a3e;border-radius:4px;color:#7070a0;font-size:12px;cursor:pointer;font-family:Inter,sans-serif;transition:all 0.15s;">'+h+'</button>').join('')
    + '</div>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
    + '<button id="hours-skip" style="padding:7px 16px;background:transparent;border:1px solid #2a2a3e;border-radius:4px;color:#5a5a7a;font-size:12px;cursor:pointer;">Juste ajouter aux taches</button>'
    + '</div>';
  modal.appendChild(inner); document.body.appendChild(modal);

  inner.querySelectorAll('.hours-btn').forEach(btn => {
    btn.addEventListener('mouseover', () => { btn.style.borderColor='#7c6fcd'; btn.style.color='#9088c8'; });
    btn.addEventListener('mouseout', () => { btn.style.borderColor='#2a2a3e'; btn.style.color='#7070a0'; });
    btn.addEventListener('click', () => {
      modal.remove();
      scheduleTasksInCalendar(tasksToSchedule, parseInt(btn.dataset.hours));
    });
  });
  document.getElementById('hours-skip').addEventListener('click', () => {
    modal.remove();
    addTasksToListOnly(tasksToSchedule);
  });
}

async function scheduleTasksInCalendar(groups, hoursPerDay) {
  const st = document.getElementById('plan-ai-status');
  if (st) st.textContent = 'Claude planifie dans le calendrier...';

  // Switch to planning tab
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  const pt=document.querySelector('[data-tab="planning"]'); if(pt) pt.classList.add('active');
  const ptt=document.getElementById('tab-planning'); if(ptt) ptt.classList.add('active');

  const apiKey = await getStoredKey();
  if (!apiKey) { addTasksToListOnly(groups); return; }

  const todayISO = getTodayISO();
  const freeSlots = getFreeSlots(planState.schedule, 3).filter(s => s.date >= todayISO);
  const blockedList = Object.entries(planState.schedule)
    .filter(([k,v]) => (v.isBlocked||v.isEvent) && k.split('_')[0] >= todayISO)
    .map(([k,v]) => k+'('+v.taskName+')').join(', ');
  const freeSlotsStr = freeSlots.slice(0,100).map(s=>s.date+' '+s.hour+'h').join(', ');

  const tasksList = groups.map(g => {
    const subtasks = (g.subtasks||[]).map(s => typeof s === 'string' ? s : s.name).join(', ');
    return g.name + (g.estimated_time ? ' ('+g.estimated_time+')' : '') + (subtasks ? ': '+subtasks : '') + ' priorite:'+g.priority;
  }).join('; ');

  const SYS = 'Tu es planificateur de taches. JSON uniquement.'
    + ' Format: {"schedule":[{"taskName":"...","date":"YYYY-MM-DD","hour":9,"duration":1,"groupIndex":0}],"reply":"..."}'
    + ' REGLES: max '+hoursPerDay+'h de travail par nuit, UNIQUEMENT entre 19h et 01h, jamais avant '+todayISO
    + ', jamais sur creneaux bloques, etaler selon priorite et deadline, pas de tache avant 19h.';

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:1500,system:SYS,
        messages:[{role:'user',content:'Aujourd hui: '+todayISO+'. Max '+hoursPerDay+'h/jour. Taches: '+tasksList+'. Cours/events INTERDITS: '+(blockedList||'aucun')+'. Creneaux libres: '+freeSlotsStr+'.'}]})
    });
    const data = await resp.json();
    if (!data.content||!data.content[0]) throw new Error('vide');
    let raw = data.content[0].text.trim();
    if (raw.startsWith('```')) raw = raw.split('```')[1].replace(/^json/,'').trim();
    const parsed = JSON.parse(raw);

    // Add tasks to storage AND place in calendar
    chrome.storage.local.get(['tasks'], result => {
      const tasks = result.tasks || [];
      // Add all tasks to the list
      groups.forEach((group, gi) => {
        tasks.push({ task: group.name, done: false, priority: group.priority, estimatedTime: group.estimated_time || null, isGroup: true });
        (group.subtasks||[]).forEach(sub => {
          const subName = typeof sub === 'string' ? sub : sub.name;
          if (subName) tasks.push({ task: '  ' + subName, done: false, priority: group.priority, parentGroup: group.name });
        });
      });
      chrome.storage.local.set({ tasks }, () => {
        // Place in calendar
        let placed = 0;
        parsed.schedule.forEach(item => {
          if (item.date < todayISO) return;
          const dur = item.duration || 1;
          for (let h = item.hour; h < item.hour + dur; h++) {
            const key = item.date+'_'+String(h).padStart(2,'0');
            if (!planState.schedule[key]) {
              planState.schedule[key] = { taskName: item.taskName, isTask: true };
              placed++;
            }
          }
        });
        saveSchedule(); renderPlanning();
        if (st) {
          st.textContent = placed + ' creneaux planifies.';
          if (parsed.reply) st.textContent += ' ' + parsed.reply;
          setTimeout(() => { if(st) st.textContent = ''; }, 4000);
        }
      });
    });
  } catch(err) {
    if (st) st.textContent = 'Erreur: '+err.message;
    addTasksToListOnly(groups);
  }
}

function addTasksToListOnly(groups) {
  chrome.storage.local.get(['tasks'], result => {
    const tasks = result.tasks || [];
    groups.forEach(group => {
      tasks.push({ task: group.name, done: false, priority: group.priority, estimatedTime: group.estimated_time || null, isGroup: true });
      (group.subtasks||[]).forEach(sub => {
        const subName = typeof sub === 'string' ? sub : sub.name;
        if (subName) tasks.push({ task: '  ' + subName, done: false, priority: group.priority, parentGroup: group.name });
      });
    });
    chrome.storage.local.set({ tasks });
  });
}

// ── DAILY UPDATE - Fin de journée / Mise à jour planning ──────────────────────
let dailyCheckDone = false;

function checkDailyUpdate() {
  if (!chrome.runtime?.id) return;
  const now = new Date();
  const hour = now.getHours();
  const todayISO = getTodayISO();

  chrome.storage.local.get(['lastDailyCheck'], r => {
    if (r.lastDailyCheck === todayISO) return; // Already done today
    if (hour < 21) return; // Only after 9pm

    chrome.storage.local.set({ lastDailyCheck: todayISO });
    showDailyCheckModal(todayISO);
  });
}

function showDailyCheckModal(todayISO) {
  const ex = document.getElementById('daily-check-modal'); if (ex) ex.remove();

  // Get today's tasks from schedule
  chrome.storage.local.get(['planSchedule', 'tasks'], async r => {
    const schedule = r.planSchedule || {};
    const tasks = r.tasks || [];

    const todayItems = Object.entries(schedule)
      .filter(([k,v]) => k.startsWith(todayISO) && (v.isTask || v.isRevision) && !v.isBlocked && !v.isEvent)
      .map(([k,v]) => ({ key: k, taskName: v.taskName, done: v.done || false }));

    if (!todayItems.length) return; // Nothing to check

    const modal = document.createElement('div'); modal.id = 'daily-check-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;';

    const inner = document.createElement('div');
    inner.style.cssText = 'background:#111118;border:1px solid #2a2a3e;border-top:2px solid #7c6fcd;border-radius:8px;padding:24px;width:340px;max-height:80vh;overflow-y:auto;';

    let html = '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:#5a5a7a;font-weight:600;margin-bottom:12px;">Bilan de la journee</div>'
      + '<div style="font-size:13px;color:#c0c0d8;margin-bottom:16px;">Qu\'est-ce que tu as fait aujourd\'hui ?</div>'
      + '<div id="daily-items">';

    todayItems.forEach((item, i) => {
      html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #1a1a28;">'
        + '<input type="checkbox" id="dc-'+i+'" data-key="'+item.key+'" '+(item.done?'checked':'')+' style="accent-color:#7c6fcd;cursor:pointer;">'
        + '<label for="dc-'+i+'" style="font-size:12px;color:#c0c0d8;cursor:pointer;flex:1;">'+item.taskName+'</label>'
        + '</div>';
    });

    html += '</div>'
      + '<div style="margin-top:12px;"><textarea id="dc-notes" placeholder="Remarques optionnelles..." style="width:100%;min-height:50px;background:#16161f;border:1px solid #2a2a3e;border-radius:4px;color:#d4d4e0;font-size:12px;padding:8px;resize:none;outline:none;font-family:Inter,sans-serif;box-sizing:border-box;"></textarea></div>'
      + '<div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">'
      + '<button id="dc-skip" style="padding:7px 14px;background:transparent;border:1px solid #2a2a3e;border-radius:4px;color:#5a5a7a;font-size:12px;cursor:pointer;">Plus tard</button>'
      + '<button id="dc-save" style="padding:7px 16px;background:#7c6fcd;border:none;border-radius:4px;color:white;font-size:12px;font-weight:500;cursor:pointer;">Enregistrer et mettre a jour</button>'
      + '</div>';

    inner.innerHTML = html;
    modal.appendChild(inner);
    document.body.appendChild(modal);

    document.getElementById('dc-skip').addEventListener('click', () => modal.remove());
    document.getElementById('dc-save').addEventListener('click', async () => {
      const checkboxes = inner.querySelectorAll('input[type="checkbox"]');
      const notes = document.getElementById('dc-notes').value.trim();
      const doneKeys = [];
      const missedKeys = [];

      checkboxes.forEach(cb => {
        if (cb.checked) doneKeys.push(cb.dataset.key);
        else missedKeys.push(cb.dataset.key);
      });

      // Mark done items
      doneKeys.forEach(key => {
        if (planState.schedule[key]) {
          planState.schedule[key] = Object.assign({}, planState.schedule[key], { done: true });
        }
      });

      // Report missed items + reschedule
      if (missedKeys.length > 0) {
        await rescheduleMissedItems(missedKeys, notes);
      } else {
        saveSchedule();
        renderPlanning();
      }

      modal.remove();

      // Send browser notification
      if (Notification && Notification.permission === 'granted') {
        new Notification('Planning mis a jour', {
          body: doneKeys.length + ' tache' + (doneKeys.length>1?'s':'') + ' terminees. Planning ajuste.',
          icon: chrome.runtime.getURL('icon128.png')
        });
      }
    });
  });
}

async function rescheduleMissedItems(missedKeys, notes) {
  const apiKey = await getStoredKey();
  if (!apiKey) { saveSchedule(); renderPlanning(); return; }

  const todayISO = getTodayISO();
  const missedTasks = missedKeys.map(k => planState.schedule[k]?.taskName || k).join(', ');

  // Remove missed items from today
  missedKeys.forEach(k => { delete planState.schedule[k]; });

  // Get free slots from tomorrow
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = tomorrow.getFullYear()+'-'+String(tomorrow.getMonth()+1).padStart(2,'0')+'-'+String(tomorrow.getDate()).padStart(2,'0');
  const freeSlots = getFreeSlots(planState.schedule, 2).filter(s => s.date >= tomorrowISO);
  const blockedList = Object.entries(planState.schedule).filter(([k,v])=>(v.isBlocked||v.isEvent)&&k.split('_')[0]>=tomorrowISO).map(([k,v])=>k+'('+v.taskName+')').join(', ');
  const freeSlotsStr = freeSlots.slice(0,60).map(s=>s.date+' '+s.hour+'h').join(', ');

  const SYS = 'Tu replaces des taches non terminees. JSON uniquement. Format:{"schedule":[{"taskName":"...","date":"YYYY-MM-DD","hour":19,"duration":1}],"reply":"..."} REGLES: heures 19h-01h UNIQUEMENT, max 3h/nuit, dans les prochains jours, respecter creneaux libres.';

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:800,system:SYS,
        messages:[{role:'user',content:'Taches a replacer: '+missedTasks+'. Notes: "'+notes+'". A partir du: '+tomorrowISO+'. Cours INTERDITS: '+(blockedList||'aucun')+'. Creneaux libres: '+freeSlotsStr+'.'}]})
    });
    const data = await resp.json();
    if (!data.content||!data.content[0]) throw new Error('vide');
    let raw = data.content[0].text.trim();
    if (raw.startsWith('```')) raw = raw.split('```')[1].replace(/^json/,'').trim();
    const parsed = JSON.parse(raw);

    parsed.schedule.forEach(item => {
      const key = item.date+'_'+String(item.hour).padStart(2,'0');
      if (!planState.schedule[key]) {
        planState.schedule[key] = { taskName: item.taskName, isTask: true };
      }
    });
  } catch(err) {
    // Fallback: place tomorrow
    const key = tomorrowISO+'_14';
    missedKeys.forEach((mk, i) => {
      const taskName = planState.schedule[mk]?.taskName || 'Tache reportee';
      const k2 = tomorrowISO+'_'+String(14+i).padStart(2,'0');
      if (!planState.schedule[k2]) planState.schedule[k2] = { taskName, isTask: true };
    });
  }

  saveSchedule(); renderPlanning();
}

// Request notification permission
if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
  Notification.requestPermission();
}

// Check daily at 21h, 23h, 01h
setInterval(checkDailyUpdate, 60 * 60 * 1000); // Check every hour
checkDailyUpdate(); // Check on load too

// ── STATS ─────────────────────────────────────────────────────────────────────
function getProgressLog(){return new Promise(r=>chrome.storage.local.get(['progressLog'],d=>r(d.progressLog||[])));}
function saveProgressLog(log){chrome.storage.local.set({progressLog:log});}
function countRevisionHours(schedule){const b={};const t=getTodayISO();Object.entries(schedule).forEach(([k,v])=>{if(!v.isRevision)return;const d=k.split('_')[0];const s=v.subject||'Autre';if(!b[s])b[s]={total:0,past:0,future:0};b[s].total++;if(d<t)b[s].past++;else b[s].future++;});return b;}
function countWeekRevisionHours(schedule){const ws=getWeekStart(new Date());const we=new Date(ws);we.setDate(we.getDate()+7);const wsI=ws.getFullYear()+'-'+String(ws.getMonth()+1).padStart(2,'0')+'-'+String(ws.getDate()).padStart(2,'0');const weI=we.getFullYear()+'-'+String(we.getMonth()+1).padStart(2,'0')+'-'+String(we.getDate()).padStart(2,'0');const b={};Object.entries(schedule).forEach(([k,v])=>{if(!v.isRevision)return;const d=k.split('_')[0];if(d>=wsI&&d<weI){const s=v.subject||'Autre';b[s]=(b[s]||0)+1;}});return b;}
function computeStreak(schedule){const dd={};Object.entries(schedule).forEach(([k,v])=>{if(!v.isRevision||!v.done)return;dd[k.split('_')[0]]=true;});let s=0;const c=new Date();while(true){const d=c.getFullYear()+'-'+String(c.getMonth()+1).padStart(2,'0')+'-'+String(c.getDate()).padStart(2,'0');if(dd[d]){s++;c.setDate(c.getDate()-1);}else break;}return s;}

async function renderStatsTab(){
  const container=document.getElementById('tab-stats'); if(!container)return;
  const schedule=planState.schedule; const goals=await getRevisionGoals(); const log=await getProgressLog();
  const hs=countRevisionHours(schedule); const wh=countWeekRevisionHours(schedule); const streak=computeStreak(schedule);

  // Compute today's progress
  const todayISO = getTodayISO();
  const todayItems = Object.entries(schedule).filter(([k,v])=>k.startsWith(todayISO)&&(v.isTask||v.isRevision)&&!v.isBlocked&&!v.isEvent);
  const todayDone = todayItems.filter(([k,v])=>v.done).length;
  const todayTotal = todayItems.length;
  const todayPct = todayTotal > 0 ? Math.round((todayDone/todayTotal)*100) : 0;

  const recent=log.slice(-5).reverse();
  let html='<div class="stats-wrap">';

  // Today progress bar
  if (todayTotal > 0) {
    html += '<div class="stats-today-block">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
    html += '<span class="stats-title">Aujourd hui</span>';
    html += '<span style="font-size:11px;color:#7c6fcd;font-weight:600;">'+todayDone+'/'+todayTotal+' — '+todayPct+'%</span>';
    html += '</div>';
    html += '<div class="stats-bar-wrap" style="height:6px;"><div class="stats-bar" style="width:'+todayPct+'%;background:linear-gradient(90deg,#7c6fcd,#9088c8);"></div></div>';
    html += '</div>';
  }

  html += '<div class="stats-header"><div class="stats-title">Progression generale</div>';
  if(streak>0) html+='<div class="stats-streak">'+streak+' jour'+(streak>1?'s':'')+' consecutifs 🔥</div>';
  html+='</div>';
  if(goals.length>0){
    html+='<div class="stats-section-label">Par matiere</div>';
    goals.forEach(g=>{
      const h=hs[g.subject]||{total:0,past:0,future:0}; const w=wh[g.subject]||0; const t=g.hoursPerWeek||2;
      const pct=Math.min(100,Math.round((w/t)*100));
      const ln=log.filter(e=>e.subject&&e.subject.toLowerCase()===g.subject.toLowerCase()).slice(-1)[0];
      html+='<div class="stats-subject-card"><div class="stats-subject-header"><span class="stats-subject-name">'+g.subject+'</span><span class="stats-subject-hours">'+w+'h / '+t+'h sem.</span></div><div class="stats-bar-wrap"><div class="stats-bar" style="width:'+pct+'%"></div></div>';
      if(h.past>0) html+='<div class="stats-subject-total">'+h.past+'h au total</div>';
      if(ln) html+='<div class="stats-subject-note">'+ln.summary+'</div>';
      html+='</div>';
    });
  }
  html+='<div class="stats-section-label" style="margin-top:12px">Rapport de travail</div>';
  html+='<div class="stats-log-input-wrap"><textarea id="stats-log-input" placeholder="Ex: j ai fait les integrales maths, pas compris les limites. Physique pas touchee."></textarea><button id="stats-log-btn">Enregistrer + adapter planning</button></div>';
  if(recent.length>0){html+='<div class="stats-log-list">';recent.forEach(e=>{html+='<div class="stats-log-entry"><div class="stats-log-date">'+e.date+'</div><div class="stats-log-text">'+e.summary+'</div>'+(e.adjustments?'<div class="stats-log-adj">'+e.adjustments+'</div>':'')+'</div>';});html+='</div>';}
  else html+='<div class="stats-log-empty">Raconte-moi ce que tu as fait pour que j adapte le planning.</div>';
  html+='</div>';
  container.innerHTML=html;
  const lb=document.getElementById('stats-log-btn'); if(lb) lb.addEventListener('click',processProgressReport);
}

async function processProgressReport(){
  const input=document.getElementById('stats-log-input'); const text=input?input.value.trim():''; if(!text)return;
  const btn=document.getElementById('stats-log-btn'); if(btn){btn.disabled=true;btn.textContent='Claude analyse...';}
  const apiKey=await getStoredKey(); if(!apiKey){if(btn){btn.disabled=false;btn.textContent='Enregistrer + adapter planning';}return;}
  const goals=await getRevisionGoals(); const todayISO=getTodayISO();
  const goalsStr=goals.map(g=>g.subject+':'+g.hoursPerWeek+'h/sem'+(g.deadline?' deadline:'+g.deadline:'')).join(', ');
  const SYS='Tu analyses un rapport de progression. JSON uniquement. Format:{"summary":"resume","subjects_done":[{"subject":"maths","hours":2,"notes":"compris X, pas Y"}],"subjects_missed":["physique"],"adjustments":"ce qu on va faire","replan":true,"boost_subjects":["maths"],"skip_subjects":[]} replan=true si besoin changer planning.';
  try{
    const resp=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:400,system:SYS,messages:[{role:'user',content:'Aujourd hui: '+todayISO+'. Objectifs: '+goalsStr+'. Rapport: "'+text+'"'}]})});
    const data=await resp.json(); if(!data.content||!data.content[0]) throw new Error('vide');
    let raw=data.content[0].text.trim(); if(raw.startsWith('```')) raw=raw.split('```')[1].replace(/^json/,'').trim();
    const parsed=JSON.parse(raw);
    const log=await getProgressLog();
    const entry={date:new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'short'}),dateISO:todayISO,rawText:text,summary:parsed.summary||text.slice(0,80),adjustments:parsed.adjustments||'',timestamp:Date.now()};
    if(parsed.subjects_done){parsed.subjects_done.forEach(s=>{log.push({subject:s.subject,summary:s.notes||s.subject+' fait',date:entry.date,dateISO:todayISO,timestamp:Date.now()});});}
    log.push(entry); saveProgressLog(log);
    if(parsed.subjects_done&&parsed.subjects_done.length>0){
      const ds=parsed.subjects_done.map(s=>s.subject.toLowerCase()); let changed=false;
      Object.entries(planState.schedule).forEach(([k,v])=>{if(v.isRevision&&k.startsWith(todayISO)&&ds.includes((v.subject||'').toLowerCase())){planState.schedule[k]=Object.assign({},v,{done:true});changed=true;}});
      if(changed)saveSchedule();
    }
    if(parsed.replan) setTimeout(()=>smartReplanWithContext(parsed),500);
    if(input)input.value=''; renderStatsTab();
  }catch(err){console.error(err);}
  if(btn){btn.disabled=false;btn.textContent='Enregistrer + adapter planning';}
}

async function smartReplanWithContext(ctx){
  const st=document.getElementById('plan-ai-status'); if(st)st.textContent='Adaptation planning...';
  const apiKey=await getStoredKey(); if(!apiKey)return;
  let goals=await getRevisionGoals(); if(!goals.length)return;
  if(ctx&&ctx.boost_subjects){goals=goals.map(g=>{if(ctx.boost_subjects.map(s=>s.toLowerCase()).includes(g.subject.toLowerCase()))return Object.assign({},g,{hoursPerWeek:Math.min(g.hoursPerWeek+1,6),boost:true});return g;});}
  const todayISO=getTodayISO();
  let schedule=clearRevisionSessions(planState.schedule);
  const futureFree=getFreeSlots(schedule,4).filter(s=>s.date>=todayISO);
  const blockedList=Object.entries(schedule).filter(([k,v])=>(v.isBlocked||v.isEvent)&&k.split('_')[0]>=todayISO).map(([k,v])=>k+'('+v.taskName+')').join(', ');
  const goalsStr=goals.map(g=>g.subject+' '+g.hoursPerWeek+'h/sem priorite:'+g.priority+(g.deadline?' deadline:'+g.deadline:'')+(g.boost?' RENFORCER':'')).join('; ');
  const ctxStr=ctx?' Renforcer: '+(ctx.boost_subjects||[]).join(',')+'. Acquis: '+(ctx.skip_subjects||[]).join(',')+'.':'';
  const freeSlotsStr=futureFree.slice(0,120).map(s=>s.date+' '+s.hour+'h').join(', ');
  const SYS='Planificateur revisions. JSON uniquement. Format:{"sessions":[{"subject":"maths","date":"YYYY-MM-DD","hour":19,"duration":1,"label":"Rev. maths - limites"}],"reply":"..."} Regles ABSOLUES: jamais avant '+todayISO+', jamais sur bloque/event, heures 19h-01h UNIQUEMENT, plus de sessions RENFORCER, max 4h/nuit.';
  try{
    const resp=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-opus-4-6',max_tokens:2000,system:SYS,messages:[{role:'user',content:'Aujourd hui: '+todayISO+'. Objectifs: '+goalsStr+'.'+ctxStr+' Cours INTERDIT: '+(blockedList||'aucun')+'. Creneaux libres: '+(freeSlotsStr||'aucun')+'.'}]})});
    const data=await resp.json(); if(!data.content||!data.content[0])throw new Error('vide');
    let raw=data.content[0].text.trim(); if(raw.startsWith('```'))raw=raw.split('```')[1].replace(/^json/,'').trim();
    const parsed=JSON.parse(raw); let placed=0;
    parsed.sessions.forEach(s=>{if(s.date<todayISO)return;const dur=s.duration||1;for(let h=s.hour;h<s.hour+dur;h++){const k=s.date+'_'+String(h).padStart(2,'0');if(!schedule[k]){schedule[k]={taskName:s.label||('Rev. '+s.subject),isRevision:true,subject:s.subject};placed++;}}});
    planState.schedule=schedule;saveSchedule();renderPlanning();renderRevisionGoalsPanel();renderStatsTab();
    if(st){st.textContent=placed+' sessions replannees.';setTimeout(()=>{if(st)st.textContent='';},5000);}
  }catch(err){if(st)st.textContent='Erreur: '+err.message;}
}

setInterval(() => loadTasks(renderTasks), 30000);