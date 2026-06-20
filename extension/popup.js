const FIELDS = ["wcUrl","wcKey","wcSecret","sfKey","sfSecret","metaAccountId","metaToken"];

// ── wire up all event listeners (no inline onclick — blocked by extension CSP) ──

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("tabFetch").addEventListener("click", () => showTab("fetch"));
  document.getElementById("tabCreds").addEventListener("click", () => showTab("creds"));
  document.getElementById("btnFetch").addEventListener("click", doFetch);
  document.getElementById("btnSave").addEventListener("click",  saveCreds);
  loadCreds();
});

// ── tab switch ────────────────────────────────────────────────────────────────

function showTab(name) {
  document.getElementById("paneFetch").style.display = name === "fetch" ? "" : "none";
  document.getElementById("paneCreds").style.display = name === "creds" ? "" : "none";
  document.getElementById("tabFetch").className = "tab" + (name === "fetch" ? " active" : "");
  document.getElementById("tabCreds").className = "tab" + (name === "creds" ? " active" : "");
}

// ── load saved creds into settings form ───────────────────────────────────────

function loadCreds() {
  chrome.storage.sync.get(FIELDS, (data) => {
    FIELDS.forEach(f => {
      const el = document.getElementById(f);
      if (el && data[f]) el.value = data[f];
    });
  });
}

// ── save credentials ──────────────────────────────────────────────────────────

function saveCreds() {
  const data = {};
  FIELDS.forEach(f => { data[f] = document.getElementById(f)?.value.trim() || ""; });
  chrome.storage.sync.set(data, () => {
    const msg = document.getElementById("saveMsg");
    msg.style.display = "";
    setTimeout(() => { msg.style.display = "none"; }, 2000);
  });
}

// ── fetch & inject ────────────────────────────────────────────────────────────

async function doFetch() {
  const btn = document.getElementById("btnFetch");
  btn.disabled = true;
  setStatus("loading", "Fetching from all 3 sources…");
  document.getElementById("apiStatus").style.display = "none";

  // Load saved config
  const config = await new Promise(res => chrome.storage.sync.get(FIELDS, res));

  // Check at least WooCommerce is configured
  if (!config.wcUrl) {
    setStatus("err", "No credentials saved — go to Settings first");
    btn.disabled = false;
    return;
  }

  // Ask background worker to fetch
  const reply = await new Promise(res => {
    chrome.runtime.sendMessage({ type: "FETCH_ALL", config }, res);
  });

  if (!reply || !reply.ok) {
    setStatus("err", reply?.error || "Unknown error");
    btn.disabled = false;
    return;
  }

  const D = reply.data;

  // Inject into active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    setStatus("err", "No active tab found");
    btn.disabled = false;
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectData,
      args: [D],
      world: "MAIN",
    });
  } catch (e) {
    setStatus("err", `Cannot inject into this tab: ${e.message}`);
    btn.disabled = false;
    return;
  }

  // Show per-source status
  const errors = D.meta.errors || {};
  showApiStatus({
    WooCommerce: errors.woocommerce,
    Steadfast:   errors.steadfast,
    "Meta Ads":  errors.meta,
  });

  const anyErr = Object.values(errors).some(Boolean);
  setStatus(anyErr ? "err" : "ok", anyErr ? "Partial data — check API status below" : "Live data injected ✓");
  btn.disabled = false;
}

// Runs in the page context — sets window.MEOWMESH_DATA and re-renders
function injectData(data) {
  window.MEOWMESH_DATA = data;
  if (typeof initDashboard === "function") initDashboard();
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function setStatus(type, text) {
  const row  = document.getElementById("statusRow");
  const dot  = document.getElementById("statusDot");
  const span = document.getElementById("statusText");
  row.className  = `status-row status-${type}`;
  dot.className  = `dot dot-${type}`;
  span.textContent = text;
}

function showApiStatus(sources) {
  const el = document.getElementById("apiStatus");
  el.style.display = "";
  el.innerHTML = Object.entries(sources).map(([name, err]) => `
    <div class="api-row">
      <span>${name}</span>
      ${err
        ? `<span class="err" title="${err.replace(/"/g,"&quot;")}">✗ ${err.slice(0, 35)}${err.length > 35 ? "…" : ""}</span>`
        : `<span class="ok">✓ OK</span>`
      }
    </div>`).join("");
}
