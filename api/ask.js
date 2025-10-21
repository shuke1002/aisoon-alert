// api/ask.js
export default async function handler(req, res) {
  try {
    const url = process.env.DISCORD_WEBHOOK_URL;
    if (!url) return res.status(500).json({ ok:false, error:"DISCORD_WEBHOOK_URL 未設定" });

    // ブラウザのGETでもツールのPOSTでもOK
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ ok:false, error:"Method Not Allowed" });
    }

    // Discordにテスト通知
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ content: "🟢 テスト：aisoon-alert からDiscord通知成功！" })
    });

    return res.status(200).json({ ok: r.ok, status: r.status });
  } catch (e) {
    return res.status(500).json({ ok:false, error: String(e) });
  }
}
