const apiKeyEl = document.getElementById('apiKey');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

// Load saved key on page open
chrome.storage.local.get(['groqApiKey'], result => {
  if (result.groqApiKey) {
    apiKeyEl.value = result.groqApiKey;
    statusEl.textContent = '\u2713 API key already saved';
    statusEl.className = 'status ok';
  }
});

saveBtn.addEventListener('click', () => {
  const key = apiKeyEl.value.trim();
  if (!key || key.length < 20 || !key.startsWith('gsk_')) {
    statusEl.textContent = '\u2717 Invalid key. Groq keys start with gsk_';
    statusEl.className = 'status err';
    return;
  }
  chrome.storage.local.set({ groqApiKey: key }, () => {
    statusEl.textContent = '\u2713 API key saved successfully!';
    statusEl.className = 'status ok';
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  });
});
