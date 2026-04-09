// ── Alarmes tâches ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'set-alarm') {
    chrome.alarms.create(msg.name, { when: msg.when });
  }

  // Sauvegarde l'état focus globalement
  if (msg.type === 'focus-start') {
    chrome.storage.local.set({ focusSession: { active: true, taskName: msg.taskName, tabId: sender.tab?.id } });
  }
  if (msg.type === 'focus-end') {
    chrome.storage.local.set({ focusSession: { active: false, taskName: '', tabId: null } });
  }
});

// ── Détection nouvel onglet pendant focus ────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

  chrome.storage.local.get(['focusSession'], (result) => {
    const session = result.focusSession;
    if (!session || !session.active) return;

    // Ne pas envoyer sur l'onglet d'origine du focus
    if (session.tabId && tabId === session.tabId) return;

    // Envoie le message au nouvel onglet
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, {
        type: 'focus-check',
        taskName: session.taskName
      }).catch(() => {});
    }, 800);
  });
});

// ── Alarmes tâches ───────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
  // Alarme retour focus
  if (alarm.name.startsWith('focus-return|')) {
    const taskName = alarm.name.replace('focus-return|', '');
    chrome.notifications.create('focus-return-' + Date.now(), {
      type: 'basic',
      title: '🎯 Retour au focus !',
      message: 'Ton timer est terminé — retourne sur "' + taskName + '"',
      iconUrl: 'icon.png'
    });

    // Envoie aussi un message à tous les onglets actifs
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) return;
      const url = tabs[0].url || '';
      if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;
      chrome.tabs.sendMessage(tabs[0].id, {
        type: 'focus-return-alert',
        taskName
      }).catch(() => {});
    });
    return;
  }

  // Alarmes tâches normales
  chrome.storage.local.get(['tasks'], (result) => {
    const tasks = result.tasks || [];
    const task = tasks.find(t => t.task === alarm.name && !t.done);
    if (!task) return;

    chrome.notifications.create({
      type: 'basic',
      title: 'Task Agent - Rappel',
      message: task.task,
      iconUrl: 'icon.png'
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      const tab = tabs[0];
      if (!tab.id || !tab.url) return;
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
      chrome.tabs.sendMessage(tab.id, {
        type: 'reminder',
        text: 'Rappel : ' + task.task
      }).catch(() => {});
    });
  });
});