// api/scan.js  押し目スキャン → Discord通知
const WATCHLIST = (process.env.WATCHLIST || "6758.T,9432.T,7203.T").split(",").map(s=>s.trim());

// ---- 指標計算ユーティリティ ----
const sma = (arr, n) => arr.slice(-n).reduce((a,b)=>a+b,0)/n;
const ema = (arr, n) => {
  const k = 2/(n+1);
  let e = arr[0];
  for (let i=1;i<arr.length;i++) e = arr[i]*k + e*(1-k);
  return e;
};
const rsi14 = (closes) => {
  const period = 14;
  if (closes.length < period+1) return null;
  let gains=0, losses=0;
  for (let i=1;i<=period;i++){
    const diff = closes[i]-closes[i-1];
    if (diff>=0) gains+=diff; else losses+=-diff;
  }
  let avgG = gains/period, avgL = losses/period;
  for (let i=period+1;i<closes.length;i++){
    const diff = closes[i]-closes[i-1];
    avgG = (avgG*(period-1) + Math.max(diff,0))/period;
    avgL = (avgL*(period-1) + Math.max(-diff,0))/period;
  }
  const rs = avgL === 0 ? 100 : avgG/avgL;
  return 100 - (100/(1+rs));
};
const macd = (closes) => {
  if (closes.length < 35) return {macd:null, signal:null, hist:null};
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const m = ema12 - ema26;
  // signalはラスト35本のMACD近似で計算（簡易）
  const macdSeries = [];
  for (let i=closes.length-35;i<closes.length;i++){
    const sub = closes.slice(0, i+1);
    macdSeries.push(ema(sub,12)-ema(sub,26));
  }
  const s = ema(macdSeries, 9);
  return { macd: m, signal: s, hist: m - s };
};

// ---- データ取得（Yahoo Finance） ----
// 例: 6758.T / 7203.T など。6ヶ月・日足。
async function fetchDaily(symbol){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d`;
  const r = await fetch(url);
  if(!r.ok) throw new Error(`fetch failed ${symbol}: ${r.status}`);
  const j = await r.json();
  const result = j.chart?.result?.[0];
  if(!result) throw new Error(`no data ${symbol}`);
  const closes = result.indicators.quote[0].close.filter(x=>x!=null);
  const volumes = result.indicators.quote[0].volume.filter(x=>x!=null);
  return {
    close: closes.at(-1),
    closes,
    volumes,
    sma25: sma(closes, Math.min(25, closes.length)),
    sma75: sma(closes, Math.min(75, closes.length)),
    vol: volumes.at(-1),
    volAvg20: sma(volumes, Math.min(20, volumes.length)),
  };
}

// ---- 押し目判定（しきい値は好みに合わせて後で調整OK） ----
function judge(data){
  const rsi = rsi14(data.closes);
  const {macd: m, signal: s, hist} = macd(data.closes);
  const near25 = data.close >= data.sma25*0.98 && data.close <= data.sma25*1.02; // 25日線±2%
  const rsiZone = rsi !== null && rsi >= 28 && rsi <= 45;                       // RSIやや売られ過ぎ回復帯
  const macdUp  = m!==null && s!==null && hist>0;                                // MACDが上向き/ヒストグラム+
  const volOK   = data.volAvg20 ? (data.vol >= data.volAvg20*0.9) : true;        // 出来高が細り過ぎてない
  const score = [near25, rsiZone, macdUp, volOK].filter(Boolean).length;
  const pass = score >= 3; // 4点満点中3点以上で「押し目候補」
  return { rsi, m, s, hist, near25, rsiZone, macdUp, volOK, score, pass };
}

// ---- Discord送信 ----
async function sendDiscord(content){
  const url = process.env.DISCORD_WEBHOOK_URL;
  if(!url) throw new Error("DISCORD_WEBHOOK_URL 未設定");
  await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ content })});
}

export default async function handler(req, res){
  try{
    const list = WATCHLIST.filter(Boolean);
    const results = [];
    for (const sym of list){
      try{
        const d = await fetchDaily(sym);
        const j = judge(d);
        results.push({ sym, ...d, ...j });
      }catch(e){
        results.push({ sym, error: String(e) });
      }
    }

    // 通知メッセージ作成
    const hits = results.filter(r => r.pass && !r.error);
    const lines = [];
    lines.push(`📉 **押し目スキャン結果** (${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })})`);
    for (const r of hits){
      lines.push(
        `• **${r.sym}** 終値:${r.close?.toFixed(2)}  25MA:${r.sma25?.toFixed(2)}  RSI14:${r.rsi?.toFixed(1)}  ` +
        `MACD:${r.m?.toFixed(3)} vs Sig:${r.s?.toFixed(3)}  Score:${r.score}/4`
      );
    }
    if (hits.length===0) lines.push("該当なし（条件をゆるめる/銘柄を増やすと当たりやすくなります）");

    // Discordへ送信（GETでもPOSTでもOK）
    await sendDiscord(lines.join("\n"));

    res.status(200).json({ ok:true, count: hits.length, results });
  }catch(e){
    res.status(500).json({ ok:false, error: String(e) });
  }
}
// 送信直前のところを以下に差し替え（api/scan.js）
const text = lines.length
  ? lines.join("\n")
  : "📭 本日の押し目候補は 0 件でした";
await sendDiscord(text);
