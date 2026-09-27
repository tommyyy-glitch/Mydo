-- One project scheduler; uses the server-only Mydo dispatch credential.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('mydo-reminders-every-minute','* * * * *', $job$
 select net.http_post(
   url := 'https://wmjbbuplqvxjcqevggux.supabase.co/functions/v1/mydo-push',
   headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select cron_secret from public.mydo_push_config where id)),
   body := '{"action":"dispatch"}'::jsonb,
   timeout_milliseconds := 60000
 );
$job$);
