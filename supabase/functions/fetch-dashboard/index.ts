import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const [wc, sf, meta] = await Promise.allSettled([
      fetchWooCommerce(cfg, from, to),
      fetchSteadfast(cfg),
      fetchMeta(cfg, from, to),
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

async function fetchWooCommerce({ wcUrl, wcKey, wcSecret }: Record<string,string>, from: string, to: string) {
  const base  = wcUrl.replace(/\/$/, "");
  const auth  = btoa(`${wcKey}:${wcSecret}`);
  const hdrs  = { Authorization: `Basic ${auth}` };
  const after  = dateToISO(from, 0);
  const before = dateToISO(to,   1); // exclusive end = next day midnight

  const [r1, r2] = await Promise.all([
    fetch(`${base}/wp-json/wc/v3/orders?after=${encodeURIComponent(after)}&before=${encodeURIComponent(before)}&per_page=100&status=any`, { headers: hdrs }),
    fetch(`${base}/wp-json/wc/v3/orders?modified_after=${encodeURIComponent(after)}&modified_before=${encodeURIComponent(before)}&per_page=100&status=completed,wc-delivered`, { headers: hdrs }),
  ]);

  if (!r1.ok) throw new Error(`WooCommerce ${r1.status}`);
  const orders    = await r1.json();
  const delivered = r2.ok ? await r2.json() : [];
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

  for (const o of todayOrders) {
    totalSales += parseFloat(o.total) || 0;
    orderCount++;
    for (const item of (o.line_items || [])) {
      itemCount += item.quantity || 0;
      if (!productMap[item.name]) productMap[item.name] = { qty:0, revenue:0 };
      productMap[item.name].qty     += item.quantity || 0;
      productMap[item.name].revenue += parseFloat(item.total) || 0;
    }
    const src = (o.meta_data||[]).find((m:any)=>m.key==="_order_source")?.value || o.created_via || "unknown";
    const ch  = normalizeChannel(src);
    if (!channelMap[ch]) channelMap[ch] = { orders:0, revenue:0 };
    channelMap[ch].orders++;
    channelMap[ch].revenue += parseFloat(o.total) || 0;

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
    stageMap[stage].amount += parseFloat(o.total) || 0;

    // City breakdown
    const city = (o.billing?.city || "Unknown").trim();
    cityMap[city] = (cityMap[city] || 0) + 1;

    // Hour of day in BDT (date_created_gmt + 6h)
    const gmt = o.date_created_gmt || o.date_created || "";
    if (gmt) {
      const utcMs = new Date(gmt.endsWith("Z") ? gmt : gmt + "Z").getTime();
      const bdtHour = new Date(utcMs + 6 * 3600000).getUTCHours();
      hours[bdtHour]++;
    }
  }

  const todayIds = new Set(todayOrders.map((o:any)=>o.id));
  const del = stageMap["Delivered"] || { orders:0, amount:0 };
  for (const o of deliveredOrders.filter((o:any)=>!todayIds.has(o.id))) {
    del.orders++; del.amount += parseFloat(o.total)||0;
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

// ── Steadfast ─────────────────────────────────────────────────────────────────

async function fetchSteadfast({ sfKey, sfSecret }: Record<string,string>) {
  const hdrs = { "Api-Key": sfKey, "Secret-Key": sfSecret, "Content-Type": "application/json" };
  const res  = await fetch("https://portal.packzy.com/api/v1/get_balance", { headers: hdrs });
  if (!res.ok) throw new Error(`Steadfast ${res.status}`);
  const d = await res.json();
  return {
    deliveredToday: { parcels:0, cod:0 },
    payout: { shipping:0, codFee:0, returns:0, netInHand:0 },
    balanceAvailable: Math.round(d.current_balance ?? d.data?.current_balance ?? 0),
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

  if (!r1.ok) throw new Error(`Meta ${r1.status}`);
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
