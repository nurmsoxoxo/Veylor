// Deploy with "Verify JWT" turned OFF. Twilio calls this for delivery status and inbound replies.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const sha = async (t: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function valid(req: Request, p: Record<string, string>) {
  let data = `${Deno.env.get("SUPABASE_URL")}/functions/v1/sms-webhook${new URL(req.url).search}`;
  for (const k of Object.keys(p).sort()) data += k + p[k];
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(Deno.env.get("TWILIO_AUTH_TOKEN")!), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)))));
  return sig === req.headers.get("X-Twilio-Signature");
}

Deno.serve(async (req) => {
  const form = await req.formData();
  const p: Record<string, string> = {};
  form.forEach((v, k) => (p[k] = String(v)));
  if (!(await valid(req, p))) return new Response("forbidden", { status: 403 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (new URL(req.url).searchParams.get("type") === "status") {
    await db.from("sms_messages").update({ status: p.MessageStatus, error: p.ErrorCode ? `Twilio error ${p.ErrorCode}` : null }).eq("twilio_sid", p.MessageSid);
  } else {
    const from = p.From, body = (p.Body || "").trim(), kw = body.toUpperCase();
    if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(kw)) await db.from("opt_outs").upsert({ phone_hash: await sha(from) });
    else if (["START", "UNSTOP"].includes(kw)) await db.from("opt_outs").delete().eq("phone_hash", await sha(from));
    const { data: last } = await db.from("sms_messages").select("user_id").eq("direction", "out").eq("to_phone", from).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (last) await db.from("sms_messages").insert({ user_id: last.user_id, direction: "in", to_phone: from, body, status: "received" });
  }
  return new Response("<Response></Response>", { headers: { "Content-Type": "text/xml" } });
});
