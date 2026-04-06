chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'set-alarm') {
    chrome.alarms.create(msg.name, { when: msg.when });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  chrome.storage.local.get(['tasks'], (result) => {
    const tasks = result.tasks || [];
    const task = tasks.find(t => t.task === alarm.name && !t.done);
    if (!task) return;

    // Notification systeme (ne necessite pas d'icone obligatoire)
    chrome.notifications.create({
      type: 'basic',
      title: 'Task Agent - Rappel',
      message: task.task,
      iconUrl: 'icon.png'
    });

    // Envoie le rappel a l'onglet actif en verifiant qu'il existe
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      const tab = tabs[0];
      if (!tab.id || !tab.url) return;

      // Ne pas envoyer sur les pages internes de Chrome
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

      chrome.tabs.sendMessage(tab.id, {
        type: 'reminder',
        text: 'Rappel : ' + task.task
      }).catch(() => {
        // Si la page n'est pas prete, on ignore silencieusement
      });
    });
  });
});