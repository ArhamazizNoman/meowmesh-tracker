// Service worker — handles all API fetching (avoids CORS by running in extension context)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FETCH_ALL") {
    fetchAll(msg.config)
      .then(result => sendResponse({ ok: true, data: result }))
      .catch(err  => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

// ── helpers ──────────────────────────────────────────────────────────────────

function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function todayDateStr() {
  const d = new Date();
  return d.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short", year:"numeric" });
}

function nowTimeStr() {
  const d = new Date();
  return d.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });
}

// ── orchestrator ─────────────────────────────────────────────────────────────

async function fetchAll(cfg) {
  const [wc, sf, meta] = await Promise.allSettled([
    fetchWooCommerce(cfg),
    fetchSteadfast(cfg),
    fetchMeta(cfg),
  ]);

  const orders    = wc.status   === "fulfilled" ? wc.value   : defaultOrders(wc.reason?.message);
  const steadfast = sf.status   === "fulfilled" ? sf.value   : defaultSteadfast(sf.reason?.message);
  const ads       = meta.status === "fulfilled" ? meta.value : defaultAds(meta.reason?.message);

  return {
    meta: {
      date: todayDateStr(),
      generatedAt: nowTimeStr(),
      live: true,
      currency: "৳",
      errors: {
        woocommerce: wc.status  === "rejected" ? wc.reason?.message  : null,
        steadfast:   sf.status  === "rejected" ? sf.reason?.message  : null,
        meta:        meta.status === "rejected" ? meta.reason?.message : null,
      },
    },
    orders,
    steadfast,
    ads,
  };
}

// ── WooCommerce ───────────────────────────────────────────────────────────────

async function fetchWooCommerce({ wcUrl, wcKey, wcSecret }) {
  if (!wcUrl || !wcKey || !wcSecret) throw new Error("WooCommerce credentials missing");

  const base    = wcUrl.replace(/\/$/, "");
  const auth    = btoa(`${wcKey}:${wcSecret}`);
  const headers = { Authorization: `Basic ${auth}` };
  const after   = todayISO();

  // Today's orders (all statuses, up to 100)
  const res = await fetch(`${base}/wp-json/wc/v3/orders?after=${encodeURIComponent(after)}&per_page=100&status=any`, { headers });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`WooCommerce ${res.status}: ${txt.slice(0, 120)}`);
  }
  const orders = await res.json();

  // Also fetch orders modified today (catches prior orders now delivered)
  const modRes = await fetch(`${base}/wp-json/wc/v3/orders?modified_after=${encodeURIComponent(after)}&per_page=100&status=completed,wc-delivered`, { headers });
  const deliveredOrders = modRes.ok ? await modRes.json() : [];

  return processOrders(orders, deliveredOrders);
}

function processOrders(todayOrders, deliveredOrders) {
  let totalSales = 0, orderCount = 0, itemCount = 0;
  const productMap = {}, channelMap = {}, stageMap = {};

  for (const o of todayOrders) {
    totalSales += parseFloat(o.total) || 0;
    orderCount++;

    for (const item of (o.line_items || [])) {
      itemCount += item.quantity || 0;
      const key = item.name;
      if (!productMap[key]) productMap[key] = { qty: 0, revenue: 0 };
      productMap[key].qty      += item.quantity || 0;
      productMap[key].revenue  += parseFloat(item.total) || 0;
    }

    // Channel: check order meta for _order_source, else fall back to created_via
    const sourceMeta = (o.meta_data || []).find(m => m.key === "_order_source");
    const raw = sourceMeta?.value || o.created_via || "website";
    const channel = normalizeChannel(raw);
    if (!channelMap[channel]) channelMap[channel] = { orders: 0, revenue: 0 };
    channelMap[channel].orders++;
    channelMap[channel].revenue += parseFloat(o.total) || 0;

    // Stage
    const stage = mapStage(o.status);
    if (!stageMap[stage]) stageMap[stage] = { orders: 0, amount: 0 };
    stageMap[stage].orders++;
    stageMap[stage].amount += parseFloat(o.total) || 0;
  }

  // Deduplicate delivered-today (may overlap with todayOrders)
  const todayIds = new Set(todayOrders.map(o => o.id));
  const extraDelivered = deliveredOrders.filter(o => !todayIds.has(o.id));
  const deliveredStage = stageMap["Delivered"] || { orders: 0, amount: 0 };
  for (const o of extraDelivered) {
    deliveredStage.orders++;
    deliveredStage.amount += parseFloat(o.total) || 0;
  }
  stageMap["Delivered"] = deliveredStage;

  return {
    totalSales:  Math.round(totalSales),
    orderCount,
    itemCount,
    products: Object.entries(productMap)
      .map(([name, v]) => ({ name, qty: v.qty, revenue: Math.round(v.revenue) }))
      .sort((a, b) => b.revenue - a.revenue),
    channels: Object.entries(channelMap)
      .map(([name, v]) => ({ name, orders: v.orders, revenue: Math.round(v.revenue) }))
      .sort((a, b) => b.orders - a.orders),
    stages: ["Processing", "In Courier", "Delivered"]
      .filter(s => stageMap[s])
      .map(s => ({ name: s, orders: stageMap[s].orders, amount: Math.round(stageMap[s].amount) })),
  };
}

function mapStage(status) {
  const s = (status || "").toLowerCase();
  if (["completed", "delivered", "wc-delivered"].includes(s)) return "Delivered";
  if (["shipped", "in-courier", "wc-in-courier", "out-for-delivery"].includes(s)) return "In Courier";
  return "Processing";
}

function normalizeChannel(raw) {
  const r = (raw || "").toLowerCase();
  if (r.includes("facebook") || r.includes("fb") || r === "admin") return "Facebook";
  if (r.includes("reseller") || r.includes("wholesale")) return "Reseller";
  return "Website";
}

// ── Steadfast ─────────────────────────────────────────────────────────────────

async function fetchSteadfast({ sfKey, sfSecret }) {
  if (!sfKey || !sfSecret) throw new Error("Steadfast credentials missing");

  const headers = {
    "Api-Key":    sfKey,
    "Secret-Key": sfSecret,
    "Content-Type": "application/json",
  };

  const balRes = await fetch("https://portal.packzy.com/api/v1/get_balance", { headers });
  if (!balRes.ok) {
    const txt = await balRes.text().catch(() => "");
    throw new Error(`Steadfast ${balRes.status}: ${txt.slice(0, 120)}`);
  }
  const balData = await balRes.json();
  const balance = balData.current_balance ?? balData.data?.current_balance ?? 0;

  // Delivered today: requires consignment IDs from WooCommerce meta (_steadfast_consignment_id).
  // The Steadfast WooCommerce plugin stores these. Without them we return zeros here.
  // Full implementation: fetch WC orders with that meta, then batch-call status_by_cid.
  return {
    deliveredToday: { parcels: 0, cod: 0 },
    payout:         { shipping: 0, codFee: 0, returns: 0, netInHand: 0 },
    balanceAvailable: Math.round(balance),
    _note: "Delivered-today requires Steadfast WooCommerce plugin (consignment IDs in order meta)",
  };
}

// ── Meta Ads ──────────────────────────────────────────────────────────────────

async function fetchMeta({ metaToken, metaAccountId }) {
  if (!metaToken || !metaAccountId) throw new Error("Meta credentials missing");

  const accountId = metaAccountId.replace(/^act_/, "");
  const today = new Date().toISOString().split("T")[0];
  const timeRange = encodeURIComponent(JSON.stringify({ since: today, until: today }));
  const base = `https://graph.facebook.com/v19.0/act_${accountId}/insights`;
  const token = `access_token=${encodeURIComponent(metaToken)}`;

  // Total spend
  const totalRes = await fetch(`${base}?fields=spend&time_range=${timeRange}&${token}`);
  if (!totalRes.ok) {
    const txt = await totalRes.text().catch(() => "");
    throw new Error(`Meta ${totalRes.status}: ${txt.slice(0, 120)}`);
  }
  const totalData = await totalRes.json();
  if (totalData.error) throw new Error(`Meta API: ${totalData.error.message}`);
  const spendToday = parseFloat((totalData.data?.[0]?.spend) || 0);

  // Campaign-level spend
  const campRes = await fetch(`${base}?fields=campaign_name,spend&level=campaign&time_range=${timeRange}&${token}`);
  const campData = campRes.ok ? await campRes.json() : { data: [] };
  const campaigns = (campData.data || [])
    .map(c => ({ name: c.campaign_name, spend: parseFloat(c.spend) || 0 }))
    .filter(c => c.spend > 0)
    .sort((a, b) => b.spend - a.spend);

  return { spendToday, campaigns };
}

// ── fallback shapes (so dashboard still renders on partial failure) ────────────

function defaultOrders(errMsg) {
  return {
    totalSales: 0, orderCount: 0, itemCount: 0,
    products: [], channels: [], stages: [],
    _error: errMsg,
  };
}
function defaultSteadfast(errMsg) {
  return {
    deliveredToday: { parcels: 0, cod: 0 },
    payout: { shipping: 0, codFee: 0, returns: 0, netInHand: 0 },
    balanceAvailable: 0,
    _error: errMsg,
  };
}
function defaultAds(errMsg) {
  return { spendToday: 0, campaigns: [], _error: errMsg };
}
