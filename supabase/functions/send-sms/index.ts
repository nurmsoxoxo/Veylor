import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const sha = async (t: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const FOOT = "\n\nSent anonymously via Veylo. Reply STOP to opt out.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user } } = await db.auth.getUser(jwt);
    if (!user) return json({ error: "Please log in again." }, 401);
    const { data: prof } = await db.from("profiles").select("role,can_send").eq("id", user.id).single();
    if (!prof || !(prof.can_send || prof.role === "admin")) return json({ error: "Your account is not approved to send yet." }, 403);

    const { to, message } = await req.json();
    if (!/^\+[1-9]\d{6,14}$/.test(to || "")) return json({ error: "Enter a valid international number." }, 400);
    if (to.startsWith("+234")) return json({ error: "Nigerian numbers (+234) are not supported." }, 400);
    const msg = String(message || "").trim();
    if (msg.length < 1 || msg.length > 320) return json({ error: "Message must be 1 to 320 characters." }, 400);

    const { data: oo } = await db.from("opt_outs").select("phone_hash").eq("phone_hash", await sha(to)).maybeSingle();
    if (oo) return json({ error: "This number has opted out and cannot be texted." }, 403);

    const limit = Number(Deno.env.get("DAILY_LIMIT") || "20");
    const since = new Date(Date.now() - 864e5).toISOString();
    const { count } = await db.from("sms_messages").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("direction", "out").gte("created_at", since);
    if ((count ?? 0) >= limit) return json({ error: `Daily limit of ${limit} messages reached.` }, 429);

    const { data: row, error: ie } = await db.from("sms_messages").insert({ user_id: user.id, direction: "out", to_phone: to, body: msg, status: "queued" }).select("id").single();
    if (ie) return json({ error: "Could not save the message." }, 500);

    const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!, tok = Deno.env.get("TWILIO_AUTH_TOKEN")!;
    const body = new URLSearchParams({ To: to, From: Deno.env.get("TWILIO_FROM")!, Body: msg + FOOT, StatusCallback: `${Deno.env.get("SUPABASE_URL")}/functions/v1/sms-webhook?type=status` });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${sid}:${tok}`), "Content-Type": "application/x-www-form-urlencoded" }, body });
    const t = await r.json();
    if (!r.ok) {
      await db.from("sms_messages").update({ status: "failed", error: t.message || "Twilio error" }).eq("id", row.id);
      return json({ error: t.message || "The SMS provider rejected the message." }, 502);
    }
    await db.from("sms_messages").update({ status: t.status || "sent", twilio_sid: t.sid }).eq("id", row.id);
    return json({ ok: true, status: t.status });
  } catch (_e) {
    return json({ error: "Unexpected error." }, 500);
  }
});
