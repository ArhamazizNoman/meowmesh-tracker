import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Strip PHP junk prepended before valid JSON (WPCode cache bug).
// PHP snippet always ends with }); — find last }); then scan for [ or {.
function parseWpJson(text: string): any {
  try { return JSON.parse(text); } catch { /* has prefix */ }
  // Find where PHP code ends (last }); before the JSON)
  const phpEnd = text.search(/\}\);\s*[\[{]/);
  if (phpEnd >= 0) {
    const jsonStart = text.slice(phpEnd).search(/[\[{]/);
    return JSON.parse(text.slice(phpEnd + jsonStart));
  }
  // Fallback: find first [ or { that yields valid JSON
  for (const ch of ["\n[", "\n{"]) {
    const i = text.lastIndexOf(ch);
    if (i >= 0) { try { return JSON.parse(text.slice(i + 1)); } catch { /* try next */ } }
  }
  throw new Error("No JSON found in WP response");
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const url    = new URL(req.url);
    const bdtNow = nowBDT();
    const todayStr = fmtDate(bdtNow);
    const from   = url.searchParams.get("from") || todayStr;
    const to     = url.searchParams.get("to")   || todayStr;
    const isToday = from === todayStr && to === todayStr;

    const cfg = {
      wcUrl:         Deno.env.get("WC_URL")!,
      wcKey:         Deno.env.get("WC_KEY")!,
      wcSecret:      Deno.env.get("WC_SECRET")!,
      sfKey:         Deno.env.get("SF_KEY")!,
      sfSecret:      Deno.env.get("SF_SECRET")!,
      metaToken:     Deno.env.get("META_TOKEN")!,
      metaAccountId: Deno.env.get("META_ACCOUNT_ID")!,
    };

    // Fetch WC + consignment IDs in parallel with Meta
    const [wcRes, sfIds, meta] = await Promise.allSettled([
      fetchWooCommerce(cfg, from, to),
      fetchConsignmentIds(cfg.wcUrl, from),
      fetchMeta(cfg, from, to),
    ]);

    const wc = wcRes;
    const cidRows: CidRow[] = sfIds.status === "fulfilled" ? sfIds.value : [];

    const [sf] = await Promise.allSettled([
      fetchSteadfast(cfg, cidRows),
    ]);

    const now    = new Date();
    const data = {
      meta: {
        date: bdtNow.toLocaleDateString("en-GB", { weekday:"short", day:"numeric", month:"short", year:"numeric" }),
        generatedAt: bdtNow.toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" }) + " BDT",
        dateRange: from === to ? from : `${from} → ${to}`,
        live: true,
        currency: "৳",
        errors: {
          woocommerce: wc.status  === "rejected" ? (wc as PromiseRejectedResult).reason?.message  : null,
          steadfast:   sf.status  === "rejected" ? (sf as PromiseRejectedResult).reason?.message  : null,
          meta:        meta.status === "rejected" ? (meta as PromiseRejectedResult).reason?.message : null,
        },
      },
      orders:    wc.status   === "fulfilled" ? wc.value   : defaultOrders(),
      steadfast: sf.status   === "fulfilled" ? sf.value   : defaultSteadfast(),
      ads:       meta.status === "fulfilled" ? meta.value : defaultAds(),
    };

    // Only cache today's snapshot
    if (isToday) {
      await sb.from("dashboard_snapshots").upsert({ id: 1, data, updated_at: now.toISOString() });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

// ── WooCommerce ───────────────────────────────────────────────────────────────

async function wcFetchAllPages(url: string, hdrs: Record<string,string>): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(`${url}&page=${page}`, { headers: hdrs });
    if (!res.ok) { if (page === 1) throw new Error(`WooCommerce ${res.status}`); break; }
    const batch = parseWpJson(await res.text());
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break; // last page
    page++;
  }
  return all;
}

async function fetchWooCommerce({ wcUrl, wcKey, wcSecret }: Record<string,string>, from: string, to: string) {
  const base  = wcUrl.replace(/\/$/, "");
  const auth  = btoa(`${wcKey}:${wcSecret}`);
  const hdrs  = { Authorization: `Basic ${auth}` };
  const after  = encodeURIComponent(dateToISO(from, 0));
  const before = encodeURIComponent(dateToISO(to,   1));

  const [orders, delivered] = await Promise.all([
    wcFetchAllPages(`${base}/wp-json/wc/v3/orders?after=${after}&before=${before}&per_page=100&status=any`, hdrs),
    wcFetchAllPages(`${base}/wp-json/wc/v3/orders?modified_after=${after}&modified_before=${before}&per_page=100&status=completed,wc-delivered`, hdrs).catch(() => []),
  ]);

  return processOrders(orders, delivered);
}

function processOrders(todayOrders: any[], deliveredOrders: any[]) {
  let totalSales = 0, orderCount = 0, itemCount = 0;
  const productMap: Record<string,{qty:number,revenue:number}> = {};
  const channelMap: Record<string,{orders:number,revenue:number}> = {};
  const stageMap:   Record<string,{orders:number,amount:number}>  = {};
  const sourceMap:  Record<string,number> = {};
  const cityMap:    Record<string,number> = {};
  const hours:      number[] = new Array(24).fill(0);
  const dailyMap:   Record<string,number> = {};
  let newOrders = 0, returningOrders = 0;

  for (const o of todayOrders) {
    let orderRevenue = 0;
    orderCount++;
    for (const item of (o.line_items || [])) {
      const itemRevenue = parseFloat(item.total) || 0;
      orderRevenue += itemRevenue;
      itemCount += item.quantity || 0;
      if (!productMap[item.name]) productMap[item.name] = { qty:0, revenue:0 };
      productMap[item.name].qty     += item.quantity || 0;
      productMap[item.name].revenue += itemRevenue;
    }
    totalSales += orderRevenue;
    const src = (o.meta_data||[]).find((m:any)=>m.key==="_order_source")?.value || o.created_via || "unknown";
    const ch  = normalizeChannel(src);
    if (!channelMap[ch]) channelMap[ch] = { orders:0, revenue:0 };
    channelMap[ch].orders++;
    channelMap[ch].revenue += orderRevenue;

    const getMeta = (key: string) => (o.meta_data||[]).find((m:any)=>m.key===key)?.value;
    const origin =
      getMeta("_wc_order_attribution_origin") ||
      getMeta("_wc_order_attribution_utm_source") ||
      getMeta("_wc_order_attribution_source_type") ||
      o.created_via || "unknown";
    sourceMap[String(origin).trim()] = (sourceMap[String(origin).trim()] || 0) + 1;

    const stage = mapStage(o.status);
    if (!stageMap[stage]) stageMap[stage] = { orders:0, amount:0 };
    stageMap[stage].orders++;
    stageMap[stage].amount += orderRevenue;

    // City breakdown
    const city = (o.billing?.city || "Unknown").trim();
    cityMap[city] = (cityMap[city] || 0) + 1;

    // Hour of day in BDT (date_created_gmt + 6h)
    const gmt = o.date_created_gmt || o.date_created || "";
    if (gmt) {
      const utcMs = new Date(gmt.endsWith("Z") ? gmt : gmt + "Z").getTime();
      const bdtHour = new Date(utcMs + 6 * 3600000).getUTCHours();
      hours[bdtHour]++;
      // Daily sales in BDT date
      const bdtDate = new Date(utcMs + 6 * 3600000);
      const dk = `${bdtDate.getUTCFullYear()}-${String(bdtDate.getUTCMonth()+1).padStart(2,"0")}-${String(bdtDate.getUTCDate()).padStart(2,"0")}`;
      dailyMap[dk] = (dailyMap[dk] || 0) + orderRevenue;
    }

    // New vs returning (customer_id=0 means guest/new)
    if (!o.customer_id || o.customer_id === 0) newOrders++;
    else returningOrders++;
  }

  const todayIds = new Set(todayOrders.map((o:any)=>o.id));
  const del = stageMap["Delivered"] || { orders:0, amount:0 };
  for (const o of deliveredOrders.filter((o:any)=>!todayIds.has(o.id))) {
    del.orders++; del.amount += (o.line_items||[]).reduce((s:number,i:any)=>s+(parseFloat(i.total)||0),0);
  }
  stageMap["Delivered"] = del;

  const cancelled = stageMap["Cancelled"] || { orders:0, amount:0 };

  return {
    totalSales: Math.round(totalSales), orderCount, itemCount,
    cancelCount: cancelled.orders,
    cancelAmount: Math.round(cancelled.amount),
    products: Object.entries(productMap).map(([name,v])=>({name,qty:v.qty,revenue:Math.round(v.revenue)})).sort((a,b)=>b.revenue-a.revenue),
    channels: Object.entries(channelMap).map(([name,v])=>({name,orders:v.orders,revenue:Math.round(v.revenue)})).sort((a,b)=>b.orders-a.orders),
    stages: ["Pending","Processing","In Courier","Delivered","Cancelled"].filter(s=>stageMap[s]).map(s=>({name:s,...stageMap[s],amount:Math.round(stageMap[s].amount)})),
    sources: Object.entries(sourceMap).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count),
    cities: Object.entries(cityMap).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count).slice(0,10),
    hours,
    dailySales: Object.entries(dailyMap).map(([date,revenue])=>({date,revenue:Math.round(revenue)})).sort((a,b)=>a.date.localeCompare(b.date)),
    newOrders, returningOrders,
    // Consignment IDs from Steadfast WC plugin meta (_steadfast_consignment_id)
    consignmentIds: [...new Set(
      [...todayOrders, ...deliveredOrders]
        .flatMap((o:any) => (o.meta_data||[])
          .filter((m:any) => (m.key === "steadfast_consignment_id" || m.key === "_steadfast_consignment_id") && m.value)
          .map((m:any) => String(m.value).trim())
        )
        .filter(Boolean)
    )],
  };
}

function mapStage(s: string) {
  s = (s||"").toLowerCase();
  if (["completed","delivered","wc-delivered"].includes(s)) return "Delivered";
  if (["shipped","in-courier","wc-in-courier","out-for-delivery"].includes(s)) return "In Courier";
  if (["cancelled","failed","refunded"].includes(s)) return "Cancelled";
  if (s === "pending") return "Pending";
  return "Processing";
}
function normalizeChannel(r: string) {
  r = (r||"").toLowerCase();
  if (r.includes("facebook")||r.includes("fb")||r==="admin") return "Facebook";
  if (r.includes("reseller")||r.includes("wholesale")) return "Reseller";
  return "Website";
}

// ── Consignment IDs via custom WP endpoint ────────────────────────────────────

type CidRow = { consignment_id: string; cod_amount: number };

async function fetchConsignmentIds(wcUrl: string, from: string): Promise<CidRow[]> {
  const base = wcUrl.replace(/\/$/, "");
  const days = Math.ceil((Date.now() - new Date(from).getTime()) / 86400000) + 1;
  const res  = await fetch(`${base}/wp-json/meowmesh/v1/steadfast-ids?days=${days}`);
  if (!res.ok) return [];
  const rows: any[] = parseWpJson(await res.text());
  return rows
    .filter((r: any) => r.consignment_id)
    .map((r: any) => ({
      consignment_id: String(r.consignment_id).trim(),
      cod_amount: parseFloat(r.cod_amount) || 0,
    }));
}

// ── Steadfast ─────────────────────────────────────────────────────────────────

async function fetchSteadfast({ sfKey, sfSecret }: Record<string,string>, cidRows: CidRow[]) {
  const hdrs = { "Api-Key": sfKey, "Secret-Key": sfSecret };

  // Always fetch balance
  const balHdrs = { "Api-Key": sfKey, "Secret-Key": sfSecret };
  const balRes = await fetch("https://portal.packzy.com/api/v1/get_balance", { headers: balHdrs });
  const balRaw = await balRes.text();
  console.log("SF balance status:", balRes.status, "body:", balRaw.slice(0, 200));
  if (!balRes.ok) throw new Error(`Steadfast balance ${balRes.status}: ${balRaw.slice(0,100)}`);
  let balData: any;
  try { balData = JSON.parse(balRaw); } catch(e) { throw new Error(`SF balance 200 but HTML: ${balRaw.slice(0,200)}`); }
  const balanceAvailable = Math.round(balData.current_balance ?? balData.data?.current_balance ?? 0);

  // If no consignment IDs (plugin not installed), return with zeros
  if (!cidRows.length) {
    return {
      deliveredToday: { parcels: 0, cod: 0 },
      payout: { shipping: 0, codFee: 0, returns: 0, netInHand: 0 },
      balanceAvailable,
      pluginInstalled: false,
    };
  }

  // GET /status_by_cid/{id} per consignment — Steadfast has no bulk endpoint
  // Build a map cid → cod_amount from WooCommerce order data
  const codMap = new Map<string, number>(cidRows.map(r => [r.consignment_id, r.cod_amount]));

  type ParcelStatus = { consignment_id: string; delivery_status: string };
  const statuses: ParcelStatus[] = [];
  await Promise.all(cidRows.map(async ({ consignment_id: cid }) => {
    try {
      const res = await fetch(`https://portal.packzy.com/api/v1/status_by_cid/${cid}`, { headers: hdrs });
      if (!res.ok) return;
      const d = await res.json();
      const ds = (d?.consignment?.delivery_status || d?.delivery_status || "").toLowerCase();
      if (ds) statuses.push({ consignment_id: cid, delivery_status: ds });
    } catch(_) { /* ignore per-ID errors */ }
  }));

  const DELIVERY_CHARGE = 120; // ৳ flat rate per parcel

  const delivered = statuses.filter(p => ["delivered","partial_delivered"].includes(p.delivery_status));
  const grossCOD  = delivered.reduce((s, p) => s + (codMap.get(p.consignment_id) || 0), 0);
  const shipping  = delivered.length * DELIVERY_CHARGE;
  const codFee    = grossCOD * 0.01;
  const netInHand = grossCOD - shipping - codFee;

  const returned    = statuses.filter(p => ["cancelled","hold","unknown"].includes(p.delivery_status));
  const returnedCOD = returned.reduce((s, p) => s + (codMap.get(p.consignment_id) || 0), 0);

  return {
    deliveredToday: { parcels: delivered.length, cod: Math.round(grossCOD) },
    payout: {
      shipping:   Math.round(shipping),
      codFee:     Math.round(codFee),
      returns:    Math.round(returnedCOD),
      netInHand:  Math.round(netInHand),
    },
    balanceAvailable,
    pluginInstalled: true,
    totalParcels: statuses.length,
  };
}

// ── Meta Ads ──────────────────────────────────────────────────────────────────

async function fetchMeta({ metaToken, metaAccountId }: Record<string,string>, from: string, to: string) {
  const timeRange = encodeURIComponent(JSON.stringify({ since: from, until: to }));
  const base      = `https://graph.facebook.com/v19.0/act_${metaAccountId}/insights`;
  const token     = `access_token=${encodeURIComponent(metaToken)}`;

  const fields = "spend,impressions,clicks,cpm,ctr,frequency,actions";
  const [r1, r2] = await Promise.all([
    fetch(`${base}?fields=${fields}&time_range=${timeRange}&${token}`),
    fetch(`${base}?fields=campaign_name,spend&level=campaign&time_range=${timeRange}&${token}`),
  ]);

  if (!r1.ok) {
    const errBody = await r1.text();
    throw new Error(`Meta ${r1.status}: ${errBody.slice(0, 300)}`);
  }
  const d1 = await r1.json();
  if (d1.error) throw new Error(`Meta: ${d1.error.message}`);

  const ins = d1.data?.[0] || {};
  const actions = ins.actions || [];
  const getAction = (type: string) => parseFloat(actions.find((a:any)=>a.action_type===type)?.value || "0");
  const spend = parseFloat(ins.spend || "0");
  const purchases = getAction("purchase") || getAction("omni_purchase");
  const linkClicks = getAction("link_click");

  const d2 = r2.ok ? await r2.json() : { data: [] };
  return {
    spendToday:      spend,
    impressions:     parseInt(ins.impressions || "0"),
    clicks:          parseInt(ins.clicks || "0"),
    cpm:             parseFloat(ins.cpm || "0"),
    ctr:             parseFloat(ins.ctr || "0"),
    frequency:       parseFloat(ins.frequency || "0"),
    linkClicks,
    purchases,
    costPerPurchase: purchases > 0 ? spend / purchases : 0,
    campaigns: (d2.data||[])
      .map((c:any)=>({ name: c.campaign_name, spend: parseFloat(c.spend)||0 }))
      .filter((c:any)=>c.spend>0)
      .sort((a:any,b:any)=>b.spend-a.spend),
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

const TZ = "Asia/Dhaka"; // BDT = UTC+6

function nowBDT() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// Convert YYYY-MM-DD (BDT) + dayOffset to UTC ISO for WooCommerce
function dateToISO(dateStr: string, dayOffset: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  // Build BDT midnight then subtract 6h for UTC
  const bdt = new Date(y, m - 1, d + dayOffset, 0, 0, 0, 0);
  const utc = new Date(bdt.getTime() - 6 * 60 * 60 * 1000);
  return utc.toISOString();
}
function defaultOrders() {
  return { totalSales:0, orderCount:0, itemCount:0, products:[], channels:[], stages:[] };
}
function defaultSteadfast() {
  return { deliveredToday:{parcels:0,cod:0}, payout:{shipping:0,codFee:0,returns:0,netInHand:0}, balanceAvailable:0 };
}
function defaultAds() {
  return { spendToday:0, campaigns:[] };
}
