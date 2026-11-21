# Veylo (simple anonymous SMS)
Login, type a foreign number, send an anonymous SMS, see delivery status and replies.
- public/            front-end (deployed by Netlify)
- supabase/migrations/002_simple_sms.sql   run in Supabase SQL Editor
- supabase/functions/send-sms, sms-webhook  Edge Functions
Secrets (Supabase > Edge Functions > Secrets): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, optional DAILY_LIMIT
Twilio number webhook (incoming messages): https://xtdidexbrgwkhczokhen.supabase.co/functions/v1/sms-webhook
