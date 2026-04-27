// ═══════════════════════════════════════════════════════════════════════════
// TASK AGENT — popup.js v3
// Fixes: JSON truncated, EDT import, double planning, no emojis
// ═══════════════════════════════════════════════════════════════════════════

// ── Helpers ───────────────────────────────────────────────────────────────
function loadTasks(cb) { chrome.storage.local.get(['tasks'], r => cb(r.tasks || [])); }
function saveTasks(tasks) { chrome.storage.local.set({ tasks }); }
function getStoredKey() { return new Promise(r => chrome.storage.local.get(['apiKey'], d => r(d.apiKey || ''))); }
function getProfile() { return new Promise(r => chrome.storage.local.get(['userProfile'], d => r(d.userProfile || null))); }

// Date locale correcte (évite décalage UTC)
function getTodayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function formatDateLocal(date) {
  return date.getFullYear() + '-' + String(date.getMonth()+1).padStart(2,'0') + '-' + String(date.getDate()).padStart(2,'0');
}
function formatHour(h) { return h === 0 ? '00h' : h + 'h'; }

// ── Double planning ───────────────────────────────────────────────────────
// Clé de stockage selon le planning actif : 'planSchedule' (student) ou 'planSchedulePro'
let activePlanKey = 'planSchedule'; // 'planSchedule' | 'planSchedulePro'

function getScheduleKey() { return activePlanKey; }
function saveSchedule() { chrome.storage.local.set({ [getScheduleKey()]: planState.schedule }); }
function loadScheduleForKey(key, cb) { chrome.storage.local.get([key], r => cb(r[key] || {})); }

function switchActivePlan(planType) {
  activePlanKey = planType === 'pro' ? 'planSchedulePro' : 'planSchedule';
  loadScheduleForKey(activePlanKey, schedule => {
    planState.schedule = schedule;
    planState.currentDate = new Date();
    renderPlanning();
  });
  // Mettre à jour boutons
  document.querySelectorAll('.ps-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.plan === planType);
    b.classList.toggle('pro-plan', b.dataset.plan === 'pro');
  });
}

document.querySelectorAll('.ps-btn').forEach(btn => {
  btn.addEventListener('click', () => switchActivePlan(btn.dataset.plan));
});

// ── Heures de travail ─────────────────────────────────────────────────────
function buildHoursArray(start, end) {
  const h = [];
  if (end >= start) { for (let i = start; i <= end; i++) h.push(i); }
  else { for (let i = start; i <= 23; i++) h.push(i); for (let i = 0; i <= end; i++) h.push(i); }
  return h;
}
let _cachedWorkHours = { start: 19, end: 23, overrides: {} };
function refreshWorkHoursCache(cb) {
  chrome.storage.local.get(['userProfile','workHoursOverrides'], d => {
    const p = d.userProfile || {};
    _cachedWorkHours = { start: p.workHoursStart ?? 19, end: p.workHoursEnd ?? 23, overrides: d.workHoursOverrides || {} };
    if (cb) cb();
  });
}
function isWorkHour(dateISO, hour) {
  const ov = _cachedWorkHours.overrides[dateISO];
  return buildHoursArray(ov ? ov.start : _cachedWorkHours.start, ov ? ov.end : _cachedWorkHours.end).includes(hour);
}
async function getFreeSlotsFull(schedule, weeks, fromISO) {
  return new Promise(resolve => {
    chrome.storage.local.get(['userProfile','workHoursOverrides'], d => {
      const p = d.userProfile || {}; const ov = d.workHoursOverrides || {};
      const ds = p.workHoursStart ?? 19; const de = p.workHoursEnd ?? 23;
      const slots = []; const seen = new Set();
      const cur = new Date(); cur.setHours(0,0,0,0);
      const end = new Date(cur); end.setDate(end.getDate() + weeks*7);
      while (cur < end) {
        const iso = formatDateLocal(cur);
        if (!fromISO || iso >= fromISO) {
          const o = ov[iso]; const s = o ? o.start : ds; const e = o ? o.end : de;
          buildHoursArray(s, e).forEach(h => {
            let sd = iso;
            if (h <= 2 && s > 12) { const nd = new Date(cur); nd.setDate(nd.getDate()+1); sd = formatDateLocal(nd); }
            const key = sd + '_' + String(h).padStart(2,'0');
            if (!schedule[key] && !seen.has(key)) { seen.add(key); slots.push({ date: sd, hour: h, key }); }
          });
        }
        cur.setDate(cur.getDate()+1);
      }
      resolve(slots);
    });
  });
}

// ── Features ──────────────────────────────────────────────────────────────
const ALL_FEATURES = [
  { id:'planning',        label:'Planning calendrier',      desc:'Vue semaine/jour/mois',                  ds:true,  dp:true  },
  { id:'ai_planning',     label:'Planification par Claude', desc:'Claude place les tâches automatiquement', ds:true,  dp:true  },
  { id:'import_edt',      label:'Import emploi du temps',   desc:'PDF/image → créneaux bloqués',           ds:true,  dp:false },
  { id:'revision_goals',  label:'Objectifs de révision',    desc:'Par matière, h/semaine, deadline',       ds:true,  dp:false },
  { id:'stats_revision',  label:'Stats et progression',     desc:'Streak, rapport de travail',             ds:true,  dp:false },
  { id:'pipeline',        label:'Pipeline tâches',           desc:'Kanban À faire / En cours / Terminé',   ds:false, dp:true  },
  { id:'focus_timer',     label:'Timer focus',               desc:'Sessions de travail concentré',          ds:true,  dp:true  },
  { id:'memory',          label:'Mémoire Claude',            desc:'Se souvient entre les sessions',         ds:true,  dp:true  },
  { id:'double_planning', label:'Double planning',           desc:'Un planning séparé par mode',            ds:false, dp:false },
];
function getDefaultFeatures(mode) {
  const f = {};
  ALL_FEATURES.forEach(feat => { f[feat.id] = mode === 'student' ? feat.ds : feat.dp; });
  return f;
}
function isFeatureOn(features, id) { return !!features?.[id]; }

// ── Onglets ───────────────────────────────────────────────────────────────
function getTabsForMode(mode, features) {
  const tabs = [{ id:'tasks', label: mode === 'pro' ? 'Agenda' : 'Tâches' }];
  if (isFeatureOn(features,'planning')) tabs.push({ id:'planning', label:'Planning' });
  if (mode === 'pro' && isFeatureOn(features,'pipeline')) tabs.push({ id:'pipeline', label:'Pipeline' });
  if (isFeatureOn(features,'stats_revision')) tabs.push({ id:'stats', label: mode === 'pro' ? 'Rapport' : 'Stats' });
  tabs.push({ id:'profile', label:'Profil' });
  tabs.push({ id:'keys', label:'API' });
  return tabs;
}
function buildNavTabs(mode, features) {
  const nav = document.getElementById('nav-tabs'); nav.innerHTML = '';
  getTabsForMode(mode, features).forEach((tab, i) => {
    const btn = document.createElement('button');
    btn.className = 'nav-tab' + (i === 0 ? ' active' : '');
    btn.dataset.tab = tab.id; btn.textContent = tab.label;
    btn.addEventListener('click', () => switchTab(tab.id));
    nav.appendChild(btn);
  });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-tasks')?.classList.add('active');
}
function switchTab(tabId) {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-' + tabId)?.classList.add('active');
  if (tabId === 'stats') renderStatsTab();
  if (tabId === 'planning') { renderRevisionGoalsPanel(); renderPlanning(); }
  if (tabId === 'profile') { renderMemoryList(); renderFeaturesToggleList(); }
}

// ── Mode & thème ──────────────────────────────────────────────────────────
function updateModeBadge(mode, dualMode) {
  const badge = document.getElementById('app-mode-badge');
  if (dualMode) { badge.textContent = 'Dual'; badge.className = 'dual'; }
  else if (mode === 'pro') { badge.textContent = 'Pro'; badge.className = 'pro'; }
  else { badge.textContent = 'Étudiant'; badge.className = 'student'; }
  document.body.classList.toggle('mode-pro', mode === 'pro' && !dualMode);
}
function applyTheme(theme) {
  document.body.classList.toggle('theme-light', theme === 'light');
  document.querySelectorAll('.theme-pick-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
}
document.querySelectorAll('.theme-pick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    applyTheme(btn.dataset.theme);
    chrome.storage.local.get(['userProfile'], d => {
      chrome.storage.local.set({ userProfile: Object.assign({}, d.userProfile||{}, { theme: btn.dataset.theme }) });
    });
  });
});
function updateModeButtons(mode, dualMode) {
  document.getElementById('pms-student').className = 'pms-btn' + (mode === 'student' && !dualMode ? ' active-student' : '');
  document.getElementById('pms-pro').className = 'pms-btn' + (mode === 'pro' && !dualMode ? ' active-pro' : '');
  document.getElementById('pms-double-mode').checked = !!dualMode;
}
function applyMode(profile) {
  const mode = profile.mode || 'student';
  const dual = !!profile.dualMode;
  const features = profile.features || getDefaultFeatures(mode);
  updateModeBadge(mode, dual);
  buildNavTabs(mode, features);
  updateModeButtons(mode, dual);
  applyTheme(profile.theme || 'dark');
  // Planning switcher visible seulement en mode dual
  const switcher = document.getElementById('planning-switcher');
  if (switcher) switcher.style.display = dual ? '' : 'none';
  // Import EDT visible selon feature
  const importBtn = document.getElementById('import-schedule-btn');
  if (importBtn) importBtn.style.display = isFeatureOn(features,'import_edt') ? '' : 'none';
  // Révision panel
  const revPanel = document.getElementById('revision-goals-panel');
  if (revPanel) revPanel.style.display = (mode === 'student' && isFeatureOn(features,'revision_goals')) ? '' : 'none';
  // Toggle label
  const toggleLabel = document.querySelector('.plan-toggle-btn[data-filter="focus"]');
  if (toggleLabel) toggleLabel.textContent = mode === 'student' ? 'Révisions' : 'Focus';
  if (!dual) activePlanKey = 'planSchedule';
}

// ── Switch de mode ────────────────────────────────────────────────────────
document.getElementById('pms-student').addEventListener('click', () => doSwitchMode('student'));
document.getElementById('pms-pro').addEventListener('click', () => doSwitchMode('pro'));
document.getElementById('pms-double-mode').addEventListener('change', e => {
  chrome.storage.local.get(['userProfile'], d => {
    const p = Object.assign({}, d.userProfile||{}, { dualMode: e.target.checked });
    chrome.storage.local.set({ userProfile: p }, () => { applyMode(p); loadProfileIntoForm(p); });
  });
});
function doSwitchMode(newMode) {
  chrome.storage.local.get(['userProfile'], d => {
    const p = Object.assign({}, d.userProfile||{}, { mode: newMode, features: getDefaultFeatures(newMode), dualMode: false });
    chrome.storage.local.set({ userProfile: p }, () => {
      applyMode(p); renderFeaturesToggleList();
      const s = document.getElementById('profile-status');
      s.textContent = 'Mode ' + (newMode === 'student' ? 'Étudiant' : 'Pro') + ' activé.';
      setTimeout(() => { s.textContent = ''; }, 2500);
    });
  });
}

// ── Features toggles ──────────────────────────────────────────────────────
function renderFeaturesToggleList() {
  chrome.storage.local.get(['userProfile'], d => {
    const p = d.userProfile||{}; const features = p.features || getDefaultFeatures(p.mode||'student');
    const container = document.getElementById('features-toggles-list'); if (!container) return;
    container.innerHTML = '';
    ALL_FEATURES.forEach(feat => {
      const row = document.createElement('div'); row.className = 'feature-toggle-row';
      const isOn = !!features[feat.id];
      row.innerHTML = `<div class="feature-toggle-info"><div class="feature-toggle-name">${feat.label}</div><div class="feature-toggle-desc">${feat.desc}</div></div><label class="feature-toggle-switch"><input type="checkbox" data-feat="${feat.id}" ${isOn?'checked':''}><span class="toggle-slider"></span></label>`;
      container.appendChild(row);
    });
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        chrome.storage.local.get(['userProfile'], d2 => {
          const p2 = d2.userProfile||{}; if (!p2.features) p2.features = getDefaultFeatures(p2.mode||'student');
          p2.features[cb.dataset.feat] = cb.checked;
          chrome.storage.local.set({ userProfile: p2 }, () => { buildNavTabs(p2.mode||'student', p2.features); applyMode(p2); });
        });
      });
    });
  });
}

// ── Onboarding ────────────────────────────────────────────────────────────
let currentStep = 1; const totalSteps = 6; let detectedMode = 'student';
function showOnboarding() { document.getElementById('onboarding').style.display='flex'; document.getElementById('app').style.display='none'; updateObProgress(); setTimeout(()=>document.getElementById('ob-name')?.focus(),100); }
function showApp() { document.getElementById('onboarding').style.display='none'; document.getElementById('app').style.display='block'; }
function updateObProgress() {
  document.getElementById('ob-progress-bar').style.width = ((currentStep-1)/totalSteps*100) + '%';
  document.getElementById('ob-step-label').textContent = String(currentStep).padStart(2,'0') + ' / ' + String(totalSteps).padStart(2,'0');
  document.querySelectorAll('.ob-question').forEach(q => q.classList.toggle('active', parseInt(q.dataset.step)===currentStep));
  document.querySelectorAll('.ob-step-dot').forEach(dot => { const s=parseInt(dot.dataset.step); dot.classList.toggle('active',s===currentStep); dot.classList.toggle('done',s<currentStep); });
  document.getElementById('ob-back').style.visibility = currentStep > 1 ? 'visible' : 'hidden';
  document.getElementById('ob-next').textContent = currentStep === totalSteps ? 'Terminer' : 'Continuer';
}
document.querySelectorAll('.ob-input').forEach(input => { input.addEventListener('keydown', e => { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); goNext(); } }); });
document.getElementById('ob-next').addEventListener('click', goNext);
document.getElementById('ob-back').addEventListener('click', () => { if (currentStep>1) { currentStep--; updateObProgress(); focusActiveInput(); } });
function focusActiveInput() { setTimeout(()=>{ const a=document.querySelector('.ob-question.active'); const i=a?.querySelector('input:not([type=hidden]):not([type=date]):not([type=number]),textarea'); if(i&&i.tagName!=='SELECT') i.focus(); },50); }
async function goNext() {
  if (currentStep===2) { const job=document.getElementById('ob-job').value.trim(); if (job) await detectModeFromJob(job); currentStep++; updateObProgress(); renderModeCard(); return; }
  if (currentStep===totalSteps) { finishOnboarding(); return; }
  currentStep++; updateObProgress(); focusActiveInput();
}
async function detectModeFromJob(job) {
  const sKw=['étudiant','student','lycée','université','fac','bts','prépa','iut','formation','apprenti','élève','école'];
  const pKw=['manager','directeur','chef','ceo','responsable','freelance','consultant','entrepreneur','fondateur','ingénieur','développeur','designer','commercial','avocat','médecin','comptable','architecte','directrice'];
  const jl=job.toLowerCase();
  if (sKw.some(k=>jl.includes(k))) { detectedMode='student'; return; }
  if (pKw.some(k=>jl.includes(k))) { detectedMode='pro'; return; }
  const apiKey=await getStoredKey(); if (!apiKey) return;
  try {
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:10,system:'Réponds uniquement "student" ou "pro". Cette situation est-elle celle d\'un étudiant ou d\'un professionnel ?',messages:[{role:'user',content:job}]})});
    const data=await r.json(); const ans=data.content?.[0]?.text?.trim().toLowerCase()||'';
    detectedMode=ans.includes('pro')?'pro':'student';
  } catch(e) {}
}
function renderModeCard() {
  const card=document.getElementById('ob-mode-card'); const title=document.getElementById('ob-mode-title'); const isPro=detectedMode==='pro';
  title.textContent=isPro?'Mode Professionnel':'Mode Étudiant'; card.className=isPro?'mode-pro':'';
  const features=isPro?['Agenda et planning journée','Pipeline tâches (Kanban)','Gestion de projets','Résumé de réunion par Claude','Rapport hebdomadaire']:['Import emploi du temps (PDF)','Objectifs de révision par matière','Mode Exam avec analyse de cours','Stats et streak de progression','Bilan de journée'];
  card.innerHTML=`<div class="ob-mode-card-tag">${isPro?'Mode Pro':'Mode Étudiant'} détecté</div><div class="ob-mode-card-features">${features.map(f=>`<div class="ob-mode-card-feat"><div class="ob-mode-card-dot"></div>${f}</div>`).join('')}</div><span class="ob-mode-change" id="ob-mode-toggle">Ce n'est pas le bon mode ? Changer</span>`;
  document.getElementById('ob-mode-toggle').addEventListener('click',()=>{ detectedMode=detectedMode==='student'?'pro':'student'; renderModeCard(); });
}
function finishOnboarding() {
  const profile={ name:document.getElementById('ob-name').value.trim()||'Utilisateur', job:document.getElementById('ob-job').value.trim(), projects:document.getElementById('ob-projects').value.trim(), extra:document.getElementById('ob-extra').value.trim(), workHoursStart:parseInt(document.getElementById('ob-work-start').value), workHoursEnd:parseInt(document.getElementById('ob-work-end').value), mode:detectedMode, features:getDefaultFeatures(detectedMode), theme:'dark', createdAt:Date.now() };
  chrome.storage.local.set({userProfile:profile,onboardingDone:true},()=>{ loadProfileIntoForm(profile); applyMode(profile); showApp(); refreshWorkHoursCache(()=>{ loadTasks(renderTasks); initPlanning(); }); });
}

// ── Profil form ───────────────────────────────────────────────────────────
function loadProfileIntoForm(profile) {
  if (!profile) return;
  document.getElementById('p-name').value=profile.name||'';
  document.getElementById('p-job').value=profile.job||'';
  document.getElementById('p-projects').value=profile.projects||'';
  document.getElementById('p-extra').value=profile.extra||'';
  const ss=document.getElementById('p-work-start'); const se=document.getElementById('p-work-end');
  if (ss&&profile.workHoursStart!==undefined) ss.value=String(profile.workHoursStart);
  if (se&&profile.workHoursEnd!==undefined) se.value=String(profile.workHoursEnd);
  const g=document.getElementById('profile-greeting');
  if (g&&profile.name) { g.textContent=profile.name+' — '+(profile.mode==='pro'?'Mode Pro':'Mode Étudiant')+' · '+formatHour(profile.workHoursStart??19)+' → '+formatHour(profile.workHoursEnd??23); g.style.display='block'; }
  updateModeButtons(profile.mode||'student', !!profile.dualMode);
}
document.getElementById('save-profile-btn').addEventListener('click',()=>{
  chrome.storage.local.get(['userProfile'],d=>{
    const p=Object.assign({},d.userProfile||{},{name:document.getElementById('p-name').value.trim(),job:document.getElementById('p-job').value.trim(),projects:document.getElementById('p-projects').value.trim(),extra:document.getElementById('p-extra').value.trim(),workHoursStart:parseInt(document.getElementById('p-work-start').value),workHoursEnd:parseInt(document.getElementById('p-work-end').value),updatedAt:Date.now()});
    chrome.storage.local.set({userProfile:p},()=>{ loadProfileIntoForm(p); refreshWorkHoursCache(); const s=document.getElementById('profile-status'); s.textContent='Profil enregistré.'; setTimeout(()=>{s.textContent='';},2500); });
  });
});

// ── Init ──────────────────────────────────────────────────────────────────
chrome.storage.local.get(['onboardingDone','userProfile','apiKey','openaiKey'],r=>{
  if (!r.onboardingDone) { showOnboarding(); }
  else {
    showApp(); const profile=r.userProfile||{};
    loadProfileIntoForm(profile); applyMode(profile);
    refreshWorkHoursCache(()=>{ loadTasks(renderTasks); initPlanning(); renderRevisionGoalsPanel(); });
    if (r.apiKey) document.getElementById('api-key').value=r.apiKey;
    if (r.openaiKey) document.getElementById('openai-key').value=r.openaiKey;
  }
});

// ── Tasks ─────────────────────────────────────────────────────────────────
function setStatus(msg) { const el=document.getElementById('status'); if(el) el.textContent=msg; }
function renderTasks(tasks) {
  const list=document.getElementById('task-list');
  if (!tasks.length) { list.innerHTML='<p style="color:var(--text3);font-size:12px;padding:8px 0">Aucune tâche pour l\'instant.</p>'; return; }
  const pm={high:'— ',medium:'– ',low:'· '};
  list.innerHTML=tasks.map((t,i)=>`<div class="task-item ${t.done?'done':''}" data-index="${i}"><span class="check-btn">${t.done?'✓':'○'}</span><span>${t.priority?pm[t.priority]:''}${t.task}</span>${t.deadline?`<span class="deadline-tag">${fmtDL(t.deadline)}</span>`:''}</div>`).join('');
  list.querySelectorAll('.check-btn').forEach(btn=>{ btn.addEventListener('click',()=>markDone(parseInt(btn.parentElement.dataset.index))); });
}
function fmtDL(ts) { const d=ts-Date.now(); if(d<=0) return 'expiré'; const m=Math.floor(d/60000); if(m<60) return m+'min'; return Math.floor(m/60)+'h'+(m%60>0?m%60+'m':''); }
function markDone(i) { loadTasks(tasks=>{ tasks[i].done=!tasks[i].done; saveTasks(tasks); renderTasks(tasks); }); }

// ── Agent ─────────────────────────────────────────────────────────────────
async function runAgent(userInput) {
  const apiKey=await getStoredKey(); if (!apiKey) { setStatus('Clé API manquante.'); return; }
  setStatus('...'); const profile=await getProfile(); const memCtx=await getMemoryContext();
  const today=getTodayISO(); const mode=profile?.mode||'student';
  let pCtx=profile?.name?'Assistant de '+profile.name+(profile.job?', '+profile.job:'')+'.':'';
  if (memCtx) pCtx+=memCtx;
  const SYS=pCtx+' Aujourd hui:'+today+'. JSON uniquement. Format:{"action":"add_task|add_event|add_both|list|done|unknown","task":"nom","event":{"name":"...","date":"YYYY-MM-DD","hour":9,"duration_hours":1},"reply":"phrase courte","ask_docs":false}';
  try {
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:300,system:SYS,messages:[{role:'user',content:userInput}]})});
    const data=await r.json(); if (!data.content?.[0]) { setStatus('Erreur'); return; }
    let raw=data.content[0].text.trim(); if(raw.startsWith('```')) raw=raw.split('```')[1].replace(/^json/,'').trim();
    const cmd=JSON.parse(raw);
    if ((cmd.action==='add_event'||cmd.action==='add_both')&&cmd.event) {
      const ev=cmd.event;
      if (ev.date&&ev.hour!==undefined) { const dur=ev.duration_hours||1; for(let h=ev.hour;h<ev.hour+dur;h++) planState.schedule[ev.date+'_'+String(h).padStart(2,'0')]={taskName:ev.name,isEvent:true}; saveSchedule(); }
    }
    if ((cmd.action==='add_task'||cmd.action==='add_both')&&cmd.task) loadTasks(tasks=>{tasks.push({task:cmd.task,done:false,priority:'medium'});saveTasks(tasks);renderTasks(tasks);});
    if (cmd.action==='list') loadTasks(tasks=>{setStatus(tasks.length+' tâche(s)');renderTasks(tasks);});
    if (cmd.reply&&cmd.action!=='list') setStatus(cmd.reply);
    if (cmd.ask_docs) setTimeout(()=>showAskDocsModal(cmd.event?.name||cmd.task),1500);
    if (userInput.length>20) askToSaveMemory(userInput);
  } catch(err) { setStatus('Erreur: '+err.message); }
}
document.getElementById('send-btn')?.addEventListener('click',()=>{ const i=document.getElementById('user-input'); if(i.value.trim()){runAgent(i.value.trim());i.value='';} });
document.getElementById('user-input')?.addEventListener('keydown',e=>{ if(e.key==='Enter') document.getElementById('send-btn').click(); });

// ── API keys ──────────────────────────────────────────────────────────────
document.getElementById('save-key-btn').addEventListener('click',()=>{ const k=document.getElementById('api-key').value.trim(); if(k){chrome.storage.local.set({apiKey:k});document.getElementById('keys-status').textContent='Clé Anthropic enregistrée.';setTimeout(()=>{document.getElementById('keys-status').textContent='';},2500);} });
document.getElementById('save-openai-key-btn').addEventListener('click',()=>{ const k=document.getElementById('openai-key').value.trim(); if(k){chrome.storage.local.set({openaiKey:k});document.getElementById('keys-status').textContent='Clé OpenAI enregistrée.';setTimeout(()=>{document.getElementById('keys-status').textContent='';},2500);} });
const toggleBtn=document.getElementById('toggle-bubble-btn');
function updateToggleBtn(v){toggleBtn.textContent=v?'Active':'Inactive';toggleBtn.classList.toggle('inactive',!v);}
chrome.storage.local.get(['bubbleVisible'],r=>updateToggleBtn(r.bubbleVisible!==false));
toggleBtn.addEventListener('click',()=>{ chrome.storage.local.get(['bubbleVisible'],r=>{ const nv=r.bubbleVisible===false; chrome.storage.local.set({bubbleVisible:nv}); updateToggleBtn(nv); chrome.tabs.query({active:true,currentWindow:true},tabs=>{ if(!tabs?.[0]?.id) return; const url=tabs[0].url||''; if(url.startsWith('chrome://')||url.startsWith('chrome-extension://')) return; chrome.tabs.sendMessage(tabs[0].id,{type:'toggle-bubble',visible:nv}).catch(()=>{}); }); }); });

// ══════════════════════════════════════════════════════════════════════════
// PLANNING
// ══════════════════════════════════════════════════════════════════════════
const HOURS_START=7; const HOURS_END=24;
const DAYS=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
let planState={view:'week',currentDate:new Date(),schedule:{}};
let planFilter='all';

function initPlanning() {
  chrome.storage.local.get([activePlanKey],r=>{ planState.schedule=r[activePlanKey]||{}; renderPlanning(); });
}
function getWeekStart(date) { const d=new Date(date); const day=d.getDay(); d.setDate(d.getDate()+(day===0?-6:1-day)); d.setHours(0,0,0,0); return d; }
function formatWeekLabel(ws) { const e=new Date(ws); e.setDate(e.getDate()+6); const o={day:'numeric',month:'short'}; return ws.toLocaleDateString('fr-FR',o)+' - '+e.toLocaleDateString('fr-FR',o); }

function renderPlanning() {
  if (!document.getElementById('planning-grid')) return;
  refreshWorkHoursCache(()=>{
    if (planState.view==='week') renderWeekView();
    else if (planState.view==='day') renderDayView();
    else renderMonthView();
    renderUnscheduledTasks();
  });
}

// Toggle Tout / Révisions
document.querySelectorAll('.plan-toggle-btn').forEach(btn=>{ btn.addEventListener('click',()=>{ planFilter=btn.dataset.filter; document.querySelectorAll('.plan-toggle-btn').forEach(b=>b.classList.toggle('active',b.dataset.filter===planFilter)); renderPlanning(); }); });

// ── Blocs fusionnés ───────────────────────────────────────────────────────
function buildBlocks(dateISO) {
  const blocks=new Map(); const processed=new Set();
  for (let h=HOURS_START;h<HOURS_END;h++) {
    const key=dateISO+'_'+String(h).padStart(2,'0');
    if (processed.has(key)) continue;
    const s=planState.schedule[key]; if (!s) continue;
    if (planFilter==='revisions'&&!s.isRevision&&!s.isEvent&&!s.isBlocked) continue;
    let span=1;
    for (let nh=h+1;nh<HOURS_END;nh++) {
      const nk=dateISO+'_'+String(nh).padStart(2,'0'); const ns=planState.schedule[nk];
      if (!ns||ns.taskName!==s.taskName) break;
      if (!!ns.isBlocked!==!!s.isBlocked||!!ns.isEvent!==!!s.isEvent||!!ns.isRevision!==!!s.isRevision) break;
      span++; processed.add(nk);
    }
    processed.add(key); blocks.set(key,{item:s,span,startHour:h});
  }
  return blocks;
}
function getBlockClass(item) { if(item.isBlocked) return 'type-cours'; if(item.isEvent) return 'type-event'; if(item.isRevision) return 'type-revision'; return 'type-task'; }
function getBlockTypeLabel(item) { if(item.isBlocked) return 'cours'; if(item.isEvent) return 'événement'; if(item.isRevision) return 'révision'; return 'tâche'; }

function makeBlock(key,item,span) {
  const CELL_H=32; const block=document.createElement('div');
  block.className='cell-block '+getBlockClass(item);
  block.style.height=(span*CELL_H-3)+'px';
  block.draggable=!item.isBlocked&&!item.isEvent;
  block.title=item.taskName;
  const nameEl=document.createElement('div'); nameEl.className='cell-block-name'; nameEl.textContent=item.taskName; block.appendChild(nameEl);
  if (span>=2) { const typeEl=document.createElement('div'); typeEl.className='cell-block-type'; typeEl.textContent=getBlockTypeLabel(item); block.appendChild(typeEl); }
  if (!item.isBlocked) { const rm=document.createElement('span'); rm.className='cell-block-remove'; rm.textContent='×'; rm.addEventListener('click',e=>{e.stopPropagation();deleteBlock(key,item,span);}); block.appendChild(rm); }
  if (!item.isBlocked&&!item.isEvent) { block.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',JSON.stringify(Object.assign({},item,{fromKey:key,span})));});}
  return block;
}
function deleteBlock(startKey,item,span) {
  const dateISO=startKey.split('_')[0]; const startH=parseInt(startKey.split('_')[1]);
  for(let h=startH;h<startH+span;h++) delete planState.schedule[dateISO+'_'+String(h).padStart(2,'0')];
  saveSchedule(); renderPlanning();
}
function makeDroppable(cell,key) {
  cell.addEventListener('dragover',e=>{e.preventDefault();cell.classList.add('drag-over');});
  cell.addEventListener('dragleave',()=>cell.classList.remove('drag-over'));
  cell.addEventListener('drop',e=>{
    e.preventDefault(); cell.classList.remove('drag-over');
    try {
      const d=JSON.parse(e.dataTransfer.getData('text/plain')||'{}'); if(!d.taskName) return;
      const dateISO=key.split('_')[0]; const startH=parseInt(key.split('_')[1]); const span=d.span||1;
      if(d.fromKey){const fD=d.fromKey.split('_')[0];const fH=parseInt(d.fromKey.split('_')[1]);for(let h=fH;h<fH+span;h++) delete planState.schedule[fD+'_'+String(h).padStart(2,'0')];}
      for(let h=startH;h<startH+span;h++) planState.schedule[dateISO+'_'+String(h).padStart(2,'0')]={taskName:d.taskName,isEvent:d.isEvent,isRevision:d.isRevision,isTask:d.isTask,subject:d.subject};
      saveSchedule(); renderPlanning();
    } catch(err){}
  });
}

function renderWeekView() {
  const ws=getWeekStart(planState.currentDate);
  const lbl=document.getElementById('plan-week-label'); if(lbl) lbl.textContent=formatWeekLabel(ws);
  const grid=document.getElementById('planning-grid'); if(!grid) return;
  grid.innerHTML=''; grid.className='grid-week';
  const hdr=document.createElement('div'); hdr.className='grid-header';
  const th=document.createElement('div'); th.className='grid-time-col'; hdr.appendChild(th);
  DAYS.forEach((d,i)=>{ const date=new Date(ws); date.setDate(date.getDate()+i); const today=getTodayISO()===formatDateLocal(date); const col=document.createElement('div'); col.className='grid-day-col'+(today?' today':''); col.textContent=d; const ds=document.createElement('span'); ds.className='grid-date'; ds.textContent=date.getDate(); col.appendChild(ds); hdr.appendChild(col); });
  grid.appendChild(hdr);
  const colBlocks=DAYS.map((_,i)=>{const date=new Date(ws);date.setDate(date.getDate()+i);return buildBlocks(formatDateLocal(date));});
  const colCont=DAYS.map(()=>new Set());
  colBlocks.forEach((blocks,i)=>{ blocks.forEach(({span,startHour})=>{for(let s=1;s<span;s++) colCont[i].add(startHour+s);}); });
  for(let h=HOURS_START;h<HOURS_END;h++) {
    const row=document.createElement('div'); row.className='grid-row';
    const tc=document.createElement('div'); tc.className='grid-time-col'; tc.textContent=h+'h'; row.appendChild(tc);
    DAYS.forEach((_,i)=>{
      const date=new Date(ws); date.setDate(date.getDate()+i); const dateISO=formatDateLocal(date);
      const key=dateISO+'_'+String(h).padStart(2,'0'); const s=planState.schedule[key];
      const workH=isWorkHour(dateISO,h); const isCont=colCont[i].has(h);
      const cell=document.createElement('div');
      let cls='grid-cell';
      if(isCont) cls+=' block-continuation';
      else if(!s&&workH) cls+=' work-hour-free';
      else if(s?.isBlocked) cls+=' is-blocked-cell';
      else if(s?.isEvent) cls+=' is-event-cell';
      else if(s?.isRevision) cls+=' is-revision-cell';
      else if(s) cls+=' has-task';
      cell.className=cls; cell.dataset.key=key;
      if(!isCont&&colBlocks[i].has(key)){const{item,span}=colBlocks[i].get(key);cell.appendChild(makeBlock(key,item,span));}
      if(!s||!s.isBlocked) makeDroppable(cell,key);
      row.appendChild(cell);
    });
    grid.appendChild(row);
  }
}
function renderDayView() {
  const dateISO=formatDateLocal(planState.currentDate);
  const lbl=document.getElementById('plan-week-label'); if(lbl) lbl.textContent=planState.currentDate.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
  const grid=document.getElementById('planning-grid'); if(!grid) return;
  grid.innerHTML=''; grid.className='grid-day';
  const blocks=buildBlocks(dateISO); const cont=new Set();
  blocks.forEach(({span,startHour})=>{for(let s=1;s<span;s++) cont.add(startHour+s);});
  for(let h=HOURS_START;h<HOURS_END;h++) {
    const key=dateISO+'_'+String(h).padStart(2,'0'); const s=planState.schedule[key]; const workH=isWorkHour(dateISO,h); const isCont=cont.has(h);
    const row=document.createElement('div'); row.className='grid-row';
    const tc=document.createElement('div'); tc.className='grid-time-col'; tc.textContent=h+'h';
    const cell=document.createElement('div');
    let cls='grid-cell grid-cell-day';
    if(isCont) cls+=' block-continuation';
    else if(!s&&workH) cls+=' work-hour-free';
    else if(s?.isBlocked) cls+=' is-blocked-cell';
    else if(s?.isEvent) cls+=' is-event-cell';
    else if(s?.isRevision) cls+=' is-revision-cell';
    else if(s) cls+=' has-task';
    cell.className=cls; cell.dataset.key=key;
    if(!isCont&&blocks.has(key)){const{item,span}=blocks.get(key);cell.appendChild(makeBlock(key,item,span));}
    if(!s||!s.isBlocked) makeDroppable(cell,key);
    row.appendChild(tc); row.appendChild(cell); grid.appendChild(row);
  }
}
function renderMonthView() {
  const date=planState.currentDate; const year=date.getFullYear(); const month=date.getMonth();
  const lbl=document.getElementById('plan-week-label'); if(lbl) lbl.textContent=date.toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
  const grid=document.getElementById('planning-grid'); if(!grid) return;
  grid.innerHTML=''; grid.className='grid-month';
  DAYS.forEach(d=>{const h=document.createElement('div');h.className='month-day-header';h.textContent=d;grid.appendChild(h);});
  const fd=new Date(year,month,1); const so=fd.getDay()===0?6:fd.getDay()-1; const dim=new Date(year,month+1,0).getDate();
  for(let i=0;i<so;i++){const e=document.createElement('div');e.className='month-cell empty';grid.appendChild(e);}
  for(let d=1;d<=dim;d++){
    const cd=new Date(year,month,d); const ds=formatDateLocal(cd); const isT=ds===getTodayISO();
    const cell=document.createElement('div'); cell.className='month-cell'+(isT?' today':'');
    const dk=Object.keys(planState.schedule).filter(k=>k.startsWith(ds));
    const ns=document.createElement('span'); ns.className='month-day-num'; ns.textContent=d; cell.appendChild(ns);
    if(dk.length>0){const cs=document.createElement('span');cs.className='month-task-count';cs.textContent=dk.length;cell.appendChild(cs);}
    cell.addEventListener('click',()=>{planState.currentDate=cd;planState.view='day';document.querySelectorAll('.view-tab').forEach(t=>t.classList.toggle('active',t.dataset.view==='day'));renderPlanning();});
    grid.appendChild(cell);
  }
}
function renderUnscheduledTasks() {
  loadTasks(tasks=>{
    const div=document.getElementById('unscheduled-tasks'); if(!div) return;
    const pending=tasks.filter(t=>!t.done);
    if(!pending.length){div.innerHTML='<p class="no-tasks">Aucune tâche.</p>';return;}
    const pm={high:'!',medium:'-',low:'·'};
    div.innerHTML=pending.map((t,i)=>`<div class="sidebar-task" draggable="true" data-index="${i}" data-name="${t.task.trim().replace(/"/g,'&quot;')}"><span class="sidebar-task-mark ${t.priority||''}">${pm[t.priority]||'-'}</span><span class="sidebar-task-name">${t.task.trim()}</span></div>`).join('');
    div.querySelectorAll('.sidebar-task').forEach(el=>{el.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',JSON.stringify({taskName:el.dataset.name,taskIndex:parseInt(el.dataset.index)}));el.classList.add('dragging');});el.addEventListener('dragend',()=>el.classList.remove('dragging'));});
  });
}

document.getElementById('plan-prev')?.addEventListener('click',()=>{if(planState.view==='week')planState.currentDate.setDate(planState.currentDate.getDate()-7);else if(planState.view==='day')planState.currentDate.setDate(planState.currentDate.getDate()-1);else planState.currentDate.setMonth(planState.currentDate.getMonth()-1);renderPlanning();});
document.getElementById('plan-next')?.addEventListener('click',()=>{if(planState.view==='week')planState.currentDate.setDate(planState.currentDate.getDate()+7);else if(planState.view==='day')planState.currentDate.setDate(planState.currentDate.getDate()+1);else planState.currentDate.setMonth(planState.currentDate.getMonth()+1);renderPlanning();});
document.querySelectorAll('.view-tab').forEach(tab=>{tab.addEventListener('click',()=>{planState.view=tab.dataset.view;document.querySelectorAll('.view-tab').forEach(t=>t.classList.toggle('active',t.dataset.view===planState.view));renderPlanning();});});
document.getElementById('plan-ai-btn')?.addEventListener('click',planWithClaudeOrSmart);

// ── Adapt hours modal ─────────────────────────────────────────────────────
document.getElementById('adapt-hours-btn')?.addEventListener('click',openAdaptHoursModal);
function openAdaptHoursModal(){chrome.storage.local.get(['userProfile'],d=>{const p=d.userProfile||{};const s=p.workHoursStart??19;const e=p.workHoursEnd??23;document.getElementById('adapt-hours-default').textContent=formatHour(s)+' → '+formatHour(e);document.getElementById('adapt-start').value=String(s);document.getElementById('adapt-end').value=String(e);document.getElementById('adapt-days').value='1';updateAdaptPreview();document.getElementById('adapt-hours-modal').style.display='flex';});}
function updateAdaptPreview(){const days=parseInt(document.getElementById('adapt-days').value)||1;const s=parseInt(document.getElementById('adapt-start').value);const e=parseInt(document.getElementById('adapt-end').value);const now=new Date();const labels=[];for(let i=0;i<Math.min(days,3);i++){const d=new Date(now);d.setDate(now.getDate()+i);labels.push(d.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric'}));}document.getElementById('adapt-scope-preview').textContent=labels.join(', ')+(days>3?' + '+(days-3)+' autres':'')+' — '+formatHour(s)+' → '+formatHour(e);}
document.getElementById('adapt-days')?.addEventListener('input',updateAdaptPreview);
document.getElementById('adapt-start')?.addEventListener('change',updateAdaptPreview);
document.getElementById('adapt-end')?.addEventListener('change',updateAdaptPreview);
document.getElementById('adapt-hours-cancel')?.addEventListener('click',()=>{document.getElementById('adapt-hours-modal').style.display='none';});
document.getElementById('adapt-hours-save')?.addEventListener('click',()=>{
  const ns=parseInt(document.getElementById('adapt-start').value);const ne=parseInt(document.getElementById('adapt-end').value);const days=parseInt(document.getElementById('adapt-days').value)||1;
  chrome.storage.local.get(['workHoursOverrides'],d=>{const ov=d.workHoursOverrides||{};const now=new Date();for(let i=0;i<days;i++){const dt=new Date(now);dt.setDate(now.getDate()+i);ov[formatDateLocal(dt)]={start:ns,end:ne};}chrome.storage.local.set({workHoursOverrides:ov},()=>{document.getElementById('adapt-hours-modal').style.display='none';const st=document.getElementById('plan-ai-status');if(st){st.textContent='Heures adaptées pour '+days+' jour(s).';setTimeout(()=>{st.textContent='';},3000);}refreshWorkHoursCache(()=>{renderPlanning();setTimeout(()=>planWithClaudeOrSmart(),500);});});});
});
document.getElementById('adapt-hours-modal')?.addEventListener('click',e=>{if(e.target===document.getElementById('adapt-hours-modal'))document.getElementById('adapt-hours-modal').style.display='none';});

// ── EDT Import ────────────────────────────────────────────────────────────
document.getElementById('import-schedule-btn')?.addEventListener('click',()=>document.getElementById('schedule-file-input').click());
let _pendingEdtFile=null;
document.getElementById('schedule-file-input')?.addEventListener('change',e=>{
  const file=e.target.files[0]; if(!file) return; _pendingEdtFile=file; e.target.value='';
  // Init dates
  const today=getTodayISO();
  document.getElementById('edt-date-start').value=today;
  const end=new Date(); end.setDate(end.getDate()+84);
  document.getElementById('edt-date-end').value=formatDateLocal(end);
  document.getElementById('edt-dates-row').style.display='none';
  document.getElementById('edt-recurring').classList.remove('selected');
  document.getElementById('edt-oneshot').classList.remove('selected');
  document.getElementById('edt-modal').style.display='flex';
});
document.getElementById('edt-recurring')?.addEventListener('click',()=>{document.getElementById('edt-recurring').classList.add('selected');document.getElementById('edt-oneshot').classList.remove('selected');document.getElementById('edt-dates-row').style.display='none';});
document.getElementById('edt-oneshot')?.addEventListener('click',()=>{document.getElementById('edt-oneshot').classList.add('selected');document.getElementById('edt-recurring').classList.remove('selected');document.getElementById('edt-dates-row').style.display='flex';});
document.getElementById('edt-cancel')?.addEventListener('click',()=>{document.getElementById('edt-modal').style.display='none';_pendingEdtFile=null;});
document.getElementById('edt-confirm')?.addEventListener('click',()=>{
  const isR=document.getElementById('edt-recurring').classList.contains('selected');
  const isO=document.getElementById('edt-oneshot').classList.contains('selected');
  if(!isR&&!isO){alert('Choisis un type de planning.');return;}
  document.getElementById('edt-modal').style.display='none';
  if(isR) importEDT(_pendingEdtFile,true,null,null);
  else { const ds=document.getElementById('edt-date-start').value; const de=document.getElementById('edt-date-end').value; if(!ds||!de){alert('Choisis les dates.');return;} importEDT(_pendingEdtFile,false,ds,de); }
  _pendingEdtFile=null;
});

async function importEDT(file,recurring,dateStart,dateEnd) {
  const st=document.getElementById('plan-ai-status'); st.textContent='Analyse de l\'emploi du temps...';
  const apiKey=await getStoredKey(); if(!apiKey){st.textContent='Clé manquante.';return;}
  const reader=new FileReader();
  reader.onload=async()=>{
    const b64=reader.result.split(',')[1]; const isPDF=file.type==='application/pdf';
    if(!isPDF&&!file.type.startsWith('image/')){st.textContent='Format non supporté.';return;}
    const cb=isPDF?{type:'document',source:{type:'base64',media_type:'application/pdf',data:b64}}:{type:'image',source:{type:'base64',media_type:file.type,data:b64}};
    const SYS='Tu analyses un emploi du temps. JSON uniquement. Format:{"slots":[{"day":"Lundi","hour_start":8,"hour_end":13,"label":"Cours maths"}]} Jours: Lundi Mardi Mercredi Jeudi Vendredi Samedi Dimanche. hour_start/end arrondis vers le bas/haut. Extrait ABSOLUMENT TOUS les créneaux.';
    try {
      const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-opus-4-6',max_tokens:3000,system:SYS,messages:[{role:'user',content:[cb,{type:'text',text:'Extrait tous les créneaux de cet emploi du temps.'}]}]})});
      const data=await r.json(); if(!data.content?.[0]) throw new Error('Réponse vide');
      let raw=data.content[0].text.trim(); if(raw.startsWith('```')) raw=raw.split('```')[1].replace(/^json/,'').trim();
      const parsed=JSON.parse(raw);
      // Map jour → index (0=Lundi ... 6=Dimanche)
      const dm={'Lundi':0,'Mardi':1,'Mercredi':2,'Jeudi':3,'Vendredi':4,'Samedi':5,'Dimanche':6};
      let blocked=0;

      if(recurring) {
        // 12 semaines depuis lundi de cette semaine
        const todayBase=new Date(); todayBase.setHours(0,0,0,0);
        const dow=todayBase.getDay(); const mondayOff=dow===0?-6:1-dow;
        for(let w=0;w<12;w++) {
          const wMon=new Date(todayBase); wMon.setDate(todayBase.getDate()+mondayOff+w*7);
          parsed.slots.forEach(slot=>{
            const di=dm[slot.day]; if(di===undefined) return;
            const sd=new Date(wMon); sd.setDate(wMon.getDate()+di);
            const ds=formatDateLocal(sd);
            for(let h=slot.hour_start;h<slot.hour_end;h++){
              const key=ds+'_'+String(h).padStart(2,'0');
              if(!planState.schedule[key]){planState.schedule[key]={taskName:slot.label,isBlocked:true};blocked++;}
            }
          });
        }
        st.textContent=blocked+' créneaux bloqués (12 semaines).';
      } else {
        // Période précise : parcourir chaque jour entre dateStart et dateEnd
        const cur=new Date(dateStart+'T00:00:00'); // CORRECTION : T00:00:00 pour éviter décalage UTC
        const endDate=new Date(dateEnd+'T23:59:59');
        while(cur<=endDate) {
          const curDay=cur.getDay(); // 0=dim,1=lun...6=sam
          // Convertir en index Mon=0...Sun=6
          const dayIdx=curDay===0?6:curDay-1;
          const dayName=Object.keys(dm).find(k=>dm[k]===dayIdx);
          if(dayName) {
            const ds=formatDateLocal(cur);
            parsed.slots.filter(s=>s.day===dayName).forEach(slot=>{
              for(let h=slot.hour_start;h<slot.hour_end;h++){
                const key=ds+'_'+String(h).padStart(2,'0');
                if(!planState.schedule[key]){planState.schedule[key]={taskName:slot.label,isBlocked:true};blocked++;}
              }
            });
          }
          cur.setDate(cur.getDate()+1);
        }
        st.textContent=blocked+' créneaux bloqués (du '+dateStart+' au '+dateEnd+').';
      }

      saveSchedule(); renderPlanning();
      // Naviguer vers la semaine courante pour voir le résultat
      planState.currentDate=new Date(); planState.view='week';
      document.querySelectorAll('.view-tab').forEach(t=>t.classList.toggle('active',t.dataset.view==='week'));
      renderPlanning();
      setTimeout(()=>{st.textContent='';planWithClaudeOrSmart();},2000);
    } catch(err){st.textContent='Erreur: '+err.message;}
  };
  reader.readAsDataURL(file);
}

// ── Planification ─────────────────────────────────────────────────────────
async function planWithClaude(){
  const btn=document.getElementById('plan-ai-btn');const st=document.getElementById('plan-ai-status');
  btn.disabled=true;btn.textContent='...';st.textContent='Claude organise...';
  const apiKey=await getStoredKey();if(!apiKey){st.textContent='Clé manquante.';btn.disabled=false;btn.textContent='Planifier avec Claude';return;}
  const todayISO=getTodayISO();const freeSlots=await getFreeSlotsFull(planState.schedule,2,todayISO);
  loadTasks(async tasks=>{
    const pending=tasks.filter(t=>!t.done);
    if(!pending.length){st.textContent='Aucune tâche.';btn.disabled=false;btn.textContent='Planifier avec Claude';return;}
    const tl=pending.map((t,i)=>i+'."'+t.task.trim()+'" priorite:'+(t.priority||'medium')).join('; ');
    const bl=Object.entries(planState.schedule).filter(([k,v])=>v.isBlocked||v.isEvent).map(([k,v])=>k+'('+v.taskName+')').join(', ');
    const freeSlotsStr=freeSlots.slice(0,80).map(s=>s.date+' '+s.hour+'h').join(', ');
    const SYS='JSON uniquement. Format:{"schedule":[{"date":"YYYY-MM-DD","hour":9,"taskIndex":0,"taskName":"..."}]} Creneaux UNIQUEMENT:'+freeSlotsStr+'. Eviter:'+(bl||'aucun');
    try{const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:1000,system:SYS,messages:[{role:'user',content:'Taches:'+tl}]})});
    const data=await r.json();if(!data.content?.[0]) throw new Error('vide');
    let raw=data.content[0].text.trim();if(raw.startsWith('```')) raw=raw.split('```')[1].replace(/^json/,'').trim();
    const parsed=JSON.parse(raw);let placed=0;
    parsed.schedule.forEach(item=>{const key=item.date+'_'+String(item.hour).padStart(2,'0');if(!planState.schedule[key]){planState.schedule[key]={taskName:item.taskName,taskIndex:item.taskIndex};placed++;}});
    saveSchedule();renderPlanning();st.textContent=placed+' tâche(s) placée(s).';setTimeout(()=>{st.textContent='';},3000);
    }catch(err){st.textContent='Erreur: '+err.message;}
    btn.disabled=false;btn.textContent='Planifier avec Claude';
  });
}

function getRevisionGoals(){return new Promise(r=>chrome.storage.local.get(['revisionGoals'],d=>r(d.revisionGoals||[])));}
function saveRevisionGoals(goals){chrome.storage.local.set({revisionGoals:goals});}
function clearRevisionSessions(schedule){const c={};Object.entries(schedule).forEach(([k,v])=>{if(!v.isRevision)c[k]=v;});return c;}

async function smartReplan(){
  const st=document.getElementById('plan-ai-status');if(st) st.textContent='Replanification...';
  const apiKey=await getStoredKey();if(!apiKey){if(st)st.textContent='Clé manquante.';return;}
  const goals=await getRevisionGoals();if(!goals.length){planWithClaude();return;}
  let schedule=clearRevisionSessions(planState.schedule);
  const todayISO=getTodayISO();
  const futureFree=await getFreeSlotsFull(schedule,4,todayISO);
  const blockedList=Object.entries(schedule).filter(([k,v])=>(v.isBlocked||v.isEvent)&&k.split('_')[0]>=todayISO).map(([k,v])=>k+'('+v.taskName+')').join(', ');
  const goalsStr=goals.map(g=>g.subject+' '+g.hoursPerWeek+'h/sem priorite:'+g.priority+(g.deadline?' deadline:'+g.deadline:'')).join('; ');
  const freeSlotsStr=futureFree.slice(0,120).map(s=>s.date+' '+s.hour+'h').join(', ');
  const SYS='Planificateur revisions. JSON uniquement. Format:{"sessions":[{"subject":"maths","date":"YYYY-MM-DD","hour":19,"duration":1,"label":"Rev. maths"}]} REGLES: jamais avant '+todayISO+', creneaux UNIQUEMENT:'+freeSlotsStr+', sessions 1-2h, max 4h/nuit.';
  try{const resp=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-opus-4-6',max_tokens:2000,system:SYS,messages:[{role:'user',content:'Aujourd hui: '+todayISO+'. Objectifs: '+goalsStr+'. INTERDITS: '+(blockedList||'aucun')}]})});
  const data=await resp.json();if(!data.content?.[0]) throw new Error('vide');
  let raw=data.content[0].text.trim();if(raw.startsWith('```')) raw=raw.split('```')[1].replace(/^json/,'').trim();
  const parsed=JSON.parse(raw);let placed=0;
  parsed.sessions.forEach(s=>{if(s.date<todayISO)return;const dur=s.duration||1;for(let h=s.hour;h<s.hour+dur;h++){const key=s.date+'_'+String(h).padStart(2,'0');if(!schedule[key]){schedule[key]={taskName:s.label||'Rev. '+s.subject,isRevision:true,subject:s.subject};placed++;}}});
  planState.schedule=schedule;saveSchedule();renderPlanning();renderRevisionGoalsPanel();
  if(st){st.textContent=placed+' session(s) planifiée(s).';setTimeout(()=>{if(st)st.textContent='';},5000);}
  }catch(err){if(st)st.textContent='Erreur: '+err.message;}
}

async function planWithClaudeOrSmart(){const goals=await getRevisionGoals();goals.length>0?smartReplan():planWithClaude();}

function renderRevisionGoalsPanel(){
  chrome.storage.local.get(['userProfile'],d=>{
    const p=d.userProfile||{};const mode=p.mode||'student';const features=p.features||getDefaultFeatures(mode);
    const panel=document.getElementById('revision-goals-panel');if(!panel)return;
    if(mode!=='student'||!isFeatureOn(features,'revision_goals')){panel.style.display='none';return;}
    panel.style.display='';
    getRevisionGoals().then(goals=>{
      if(!goals.length){panel.innerHTML='<div class="rg-empty">Dis-moi ce que tu veux réviser (ex: "maths 3h/sem, physique 2h/sem pour le 20 juin")</div>';return;}
      const pm={high:'!',medium:'-',low:'·'};
      panel.innerHTML='<div class="rg-title">Objectifs de révision</div>'+goals.map((g,i)=>`<div class="rg-item"><span class="rg-priority">${pm[g.priority]||'-'}</span><span class="rg-subject">${g.subject}</span><span class="rg-hours">${g.hoursPerWeek}h/sem</span>${g.deadline?`<span class="rg-deadline">${new Date(g.deadline+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}</span>`:''}<span class="rg-delete" data-index="${i}">×</span></div>`).join('')+'<button id="rg-replan-btn">Replanifier maintenant</button>';
      panel.querySelectorAll('.rg-delete').forEach(btn=>{btn.addEventListener('click',async()=>{const g2=await getRevisionGoals();g2.splice(parseInt(btn.dataset.index),1);saveRevisionGoals(g2);renderRevisionGoalsPanel();if(g2.length>0)setTimeout(()=>smartReplan(),300);});});
      const rb=panel.querySelector('#rg-replan-btn');if(rb) rb.addEventListener('click',()=>smartReplan());
    });
  });
}

// ── Organiser avec Claude — FIX JSON truncated ────────────────────────────
// (appelé depuis content.js — on augmente max_tokens et on gère la troncature)
// Cette fonction est dans content.js mais on expose le fix ici pour popup
// Le vrai fix est dans content.js : max_tokens: 4000 au lieu de 2000

// ── Stats ─────────────────────────────────────────────────────────────────
function getProgressLog(){return new Promise(r=>chrome.storage.local.get(['progressLog'],d=>r(d.progressLog||[])));}
function saveProgressLog(log){chrome.storage.local.set({progressLog:log});}
function countWeekRevisionHours(schedule){const ws=getWeekStart(new Date());const we=new Date(ws);we.setDate(we.getDate()+7);const wsI=formatDateLocal(ws);const weI=formatDateLocal(we);const b={};Object.entries(schedule).forEach(([k,v])=>{if(!v.isRevision)return;const d=k.split('_')[0];if(d>=wsI&&d<weI){const s=v.subject||'Autre';b[s]=(b[s]||0)+1;}});return b;}
function computeStreak(schedule){const dd={};Object.entries(schedule).forEach(([k,v])=>{if(!v.isRevision||!v.done)return;dd[k.split('_')[0]]=true;});let s=0;const c=new Date();while(true){const d=formatDateLocal(c);if(dd[d]){s++;c.setDate(c.getDate()-1);}else break;}return s;}

async function renderStatsTab(){
  const container=document.getElementById('tab-stats');if(!container)return;
  const schedule=planState.schedule;const goals=await getRevisionGoals();const log=await getProgressLog();
  const wh=countWeekRevisionHours(schedule);const streak=computeStreak(schedule);
  const todayISO=getTodayISO();
  const todayItems=Object.entries(schedule).filter(([k,v])=>k.startsWith(todayISO)&&(v.isTask||v.isRevision)&&!v.isBlocked&&!v.isEvent);
  const todayDone=todayItems.filter(([,v])=>v.done).length;const todayTotal=todayItems.length;const todayPct=todayTotal>0?Math.round(todayDone/todayTotal*100):0;
  const recent=log.slice(-5).reverse();
  let html='<div class="stats-wrap">';
  if(todayTotal>0) html+=`<div class="stats-today-block"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><span class="stats-title">Aujourd'hui</span><span style="font-size:11px;color:var(--accent);font-weight:600;">${todayDone}/${todayTotal} — ${todayPct}%</span></div><div class="stats-bar-wrap" style="height:6px;"><div class="stats-bar" style="width:${todayPct}%"></div></div></div>`;
  html+=`<div class="stats-header"><div class="stats-title">Progression</div>${streak>0?`<div class="stats-streak">${streak} jour${streak>1?'s':''} d\'affilée</div>`:''}</div>`;
  if(goals.length>0){html+='<div class="stats-section-label">Par matière</div>';goals.forEach(g=>{const w=wh[g.subject]||0;const t=g.hoursPerWeek||2;const pct=Math.min(100,Math.round(w/t*100));html+=`<div class="stats-subject-card"><div class="stats-subject-header"><span class="stats-subject-name">${g.subject}</span><span class="stats-subject-hours">${w}h / ${t}h sem.</span></div><div class="stats-bar-wrap"><div class="stats-bar" style="width:${pct}%"></div></div></div>`;});}
  html+='<div class="stats-section-label" style="margin-top:12px">Rapport de travail</div><div class="stats-log-input-wrap"><textarea id="stats-log-input" placeholder="Ce que tu as fait aujourd\'hui..."></textarea><button id="stats-log-btn">Enregistrer et adapter le planning</button></div>';
  if(recent.length>0){html+='<div class="stats-log-list">';recent.forEach(e=>{html+=`<div class="stats-log-entry"><div class="stats-log-date">${e.date}</div><div class="stats-log-text">${e.summary}</div>${e.adjustments?`<div class="stats-log-adj">${e.adjustments}</div>`:''}</div>`;});html+='</div>';}else html+='<div class="stats-log-empty">Raconte-moi ce que tu as fait.</div>';
  html+='</div>';container.innerHTML=html;
  document.getElementById('stats-log-btn')?.addEventListener('click',processProgressReport);
}

async function processProgressReport(){
  const input=document.getElementById('stats-log-input');const text=input?.value.trim();if(!text)return;
  const btn=document.getElementById('stats-log-btn');if(btn){btn.disabled=true;btn.textContent='Analyse...';}
  const apiKey=await getStoredKey();if(!apiKey){if(btn){btn.disabled=false;btn.textContent='Enregistrer et adapter le planning';}return;}
  const goals=await getRevisionGoals();const todayISO=getTodayISO();
  const goalsStr=goals.map(g=>g.subject+':'+g.hoursPerWeek+'h/sem').join(', ');
  const SYS='JSON uniquement. Format:{"summary":"resume","adjustments":"...","replan":true}';
  try{const resp=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:300,system:SYS,messages:[{role:'user',content:'Aujourd hui: '+todayISO+'. Objectifs: '+goalsStr+'. Rapport: "'+text+'"'}]})});
  const data=await resp.json();if(!data.content?.[0]) throw new Error('vide');
  let raw=data.content[0].text.trim();if(raw.startsWith('```')) raw=raw.split('```')[1].replace(/^json/,'').trim();
  const parsed=JSON.parse(raw);
  const log=await getProgressLog();log.push({date:new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'short'}),dateISO:todayISO,summary:parsed.summary||text.slice(0,80),adjustments:parsed.adjustments||'',timestamp:Date.now()});
  saveProgressLog(log);if(parsed.replan) setTimeout(()=>smartReplan(),500);if(input)input.value='';renderStatsTab();
  }catch(err){console.error(err);}
  if(btn){btn.disabled=false;btn.textContent='Enregistrer et adapter le planning';}
}

// ── Mémoire ───────────────────────────────────────────────────────────────
function getMemory(){return new Promise(r=>chrome.storage.local.get(['claudeMemory'],d=>r(d.claudeMemory||[])));}
async function getMemoryContext(){const m=await getMemory();if(!m.length)return '';return '\nMémoire: '+m.map(x=>x.text).join('; ');}
async function addMemory(text){const m=await getMemory();m.push({text:text.trim(),date:new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}),timestamp:Date.now()});chrome.storage.local.set({claudeMemory:m});}
async function askToSaveMemory(userInput){
  const apiKey=await getStoredKey();if(!apiKey)return;
  try{const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:80,system:"Réponds par une phrase courte (max 80 chars) si le message contient une info importante à retenir. Sinon réponds exactement: NON",messages:[{role:'user',content:'Message: "'+userInput+'"'}]})});
  const data=await r.json();const s=data.content?.[0]?.text?.trim();
  if(s&&s!=='NON'&&!s.startsWith('NON')) showMemoryModal(s);
  }catch(e){}
}
function showMemoryModal(suggestion){const modal=document.getElementById('memory-modal');if(!modal)return;document.getElementById('memory-modal-suggestion').textContent=suggestion||'';document.getElementById('memory-modal-input').value=suggestion||'';modal.style.display='flex';setTimeout(()=>document.getElementById('memory-modal-input')?.focus(),100);}
function hideMemoryModal(){const m=document.getElementById('memory-modal');if(m)m.style.display='none';}
document.getElementById('memory-modal-skip')?.addEventListener('click',hideMemoryModal);
document.getElementById('memory-modal-save')?.addEventListener('click',()=>{const t=document.getElementById('memory-modal-input')?.value.trim();if(t)addMemory(t);hideMemoryModal();});
document.getElementById('memory-modal-input')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();document.getElementById('memory-modal-save')?.click();}if(e.key==='Escape')hideMemoryModal();});
function renderMemoryList(){getMemory().then(memories=>{const list=document.getElementById('memory-list');const empty=document.getElementById('memory-empty');if(!memories.length){if(list)list.innerHTML='';if(empty)empty.style.display='block';return;}if(empty)empty.style.display='none';if(!list)return;list.innerHTML=memories.map((m,i)=>`<div class="memory-item"><div class="memory-text">${m.text}</div><div class="memory-meta"><span class="memory-date">${m.date}</span><span class="memory-delete" data-index="${i}">supprimer</span></div></div>`).join('');list.querySelectorAll('.memory-delete').forEach(btn=>{btn.addEventListener('click',async()=>{const mems=await getMemory();mems.splice(parseInt(btn.dataset.index),1);chrome.storage.local.set({claudeMemory:mems},renderMemoryList);});});}); }

// ── Ask docs ──────────────────────────────────────────────────────────────
function showAskDocsModal(eventName){const ex=document.getElementById('ask-docs-modal');if(ex)ex.remove();const modal=document.createElement('div');modal.id='ask-docs-modal';modal.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;';const inner=document.createElement('div');inner.style.cssText='background:var(--bg);border:1px solid var(--border2);border-top:2px solid var(--accent);border-radius:8px;padding:24px;width:320px;';inner.innerHTML=`<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.12em;color:var(--text2);font-weight:600;margin-bottom:12px;">Préparer avec des documents</div><div style="font-size:13px;color:var(--text);margin-bottom:18px;line-height:1.5;">Des documents pour préparer <strong style="color:var(--accent2);">${eventName||'cet événement'}</strong> ?</div><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="adm-no" style="padding:7px 16px;background:transparent;border:1px solid var(--border2);border-radius:4px;color:var(--text2);font-size:12px;cursor:pointer;">Pas maintenant</button><button id="adm-yes" style="padding:7px 16px;background:var(--accent);border:none;border-radius:4px;color:white;font-size:12px;font-weight:500;cursor:pointer;">Envoyer</button></div>`;
modal.appendChild(inner);document.body.appendChild(modal);
document.getElementById('adm-no').addEventListener('click',()=>modal.remove());
document.getElementById('adm-yes').addEventListener('click',()=>{modal.remove();document.getElementById('planning-docs-input')?.click();});}

setInterval(()=>loadTasks(renderTasks),30000);