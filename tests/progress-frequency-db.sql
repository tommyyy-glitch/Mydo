-- Run after the migration inside a transaction, then ROLLBACK. No pushes sent.
do $$
declare u uuid; d uuid; state public.mydo_cloud_lists; tasks jsonb; response jsonb; legacy jsonb; row_count int;
begin
  if not public.mydo_repeat_on_date('weekly','2026-12-28','2027-01-04')
    or public.mydo_repeat_on_date('weekly','2026-12-28','2027-01-03')
    or not public.mydo_repeat_on_date('monthly','2026-01-31','2026-02-28')
    or public.mydo_repeat_on_date('monthly','2026-01-31','2026-03-28')
    or not public.mydo_repeat_on_date('monthly','2026-01-31','2026-03-31')
    or not public.mydo_repeat_on_date('monthly','2026-01-31','2028-02-29')
    or public.mydo_repeat_on_date('monthly','2026-01-31','2028-02-28') then raise exception 'calendar recurrence failed'; end if;
  select distinct user_id into strict u from public.mydo_cloud_lists;
  select id into strict d from public.mydo_push_devices where user_id=u and enabled and cloud_enabled;
  perform set_config('request.jwt.claim.sub',u::text,true);
  select * into state from public.mydo_cloud_lists where user_id=u for update;
  tasks := jsonb_build_array(jsonb_build_object('id','__mydo_qa_progress_weekly__','title','Rollback-only weekly QA',
    'project','QA','notes','','intent','must','urgent',false,'due','','done',false,'status','ongoing',
    'deps','[]'::jsonb,'created','2026-10-02T00:00:00Z',
    'reminder',jsonb_build_object('onDue',false,'daily',false,'repeat','weekly','start',(now() at time zone 'Asia/Hong_Kong')::date::text,'time','00:00','timeZone','Asia/Hong_Kong')),
    jsonb_build_object('id','__mydo_qa_progress_monthly__','title','Rollback-only monthly QA',
    'project','QA','notes','','intent','want','urgent',false,'due','','done',false,'status','almost',
    'deps','[]'::jsonb,'created','2026-10-02T00:00:00Z',
    'reminder',jsonb_build_object('onDue',false,'daily',false,'repeat','monthly','start',(now() at time zone 'Asia/Hong_Kong')::date::text,'time','00:00','timeZone','Asia/Hong_Kong')));
  response:=public.mydo_cloud_write(state.revision,tasks);
  if not (response->>'ok')::boolean then raise exception 'CAS write failed'; end if;
  if (select count(*) from public.mydo_reminders where user_id=u and frequency in ('weekly','monthly'))<>2 then raise exception 'projection failed'; end if;
  select count(*) into row_count from public.mydo_claim_reminders(10) where task_id like '__mydo_qa_progress_%';
  if row_count<>2 then raise exception 'scheduler failed'; end if;
  -- Old client note edit strips repeat: server must preserve weekly and progress.
  legacy:=jsonb_set(tasks,'{0,notes}','"Edited by legacy client"'::jsonb);
  legacy:=jsonb_set(legacy,'{0}',(legacy->0)-'status');
  legacy:=jsonb_set(legacy,'{0,reminder}',(legacy->0->'reminder')-'repeat');
  response:=public.mydo_cloud_write((response->>'revision')::bigint,legacy);
  if response->'tasks'->0->>'status'<>'ongoing' or response->'tasks'->0->'reminder'->>'repeat'<>'weekly' then raise exception 'legacy preservation failed'; end if;
  -- Due+weekly share a local-day deduplication record.
  update public.mydo_reminders set claim_id=null,claim_until=null,last_sent_on=(now() at time zone time_zone)::date,on_due=true,due=(now() at time zone time_zone)::date where user_id=u;
  if exists(select 1 from public.mydo_claim_reminders(10) where task_id like '__mydo_qa_progress_%') then raise exception 'dedup failed'; end if;
  tasks:=response->'tasks';
  tasks:=jsonb_set(jsonb_set(tasks,'{0,done}','true'::jsonb),'{0,status}','"complete"'::jsonb);
  response:=public.mydo_cloud_write((response->>'revision')::bigint,tasks);
  if exists(select 1 from public.mydo_reminders where user_id=u and task_id='__mydo_qa_progress_weekly__') then raise exception 'completion cancellation failed'; end if;
  if not exists(select 1 from public.mydo_reminders where user_id=u and task_id='__mydo_qa_progress_monthly__') then raise exception 'almost-complete reminder lost'; end if;
  if has_function_privilege('anon','public.mydo_repeat_on_date(text,date,date)','execute')
    or has_function_privilege('authenticated','public.mydo_upgrade_tasks(jsonb,jsonb)','execute') then raise exception 'helper exposed'; end if;
end; $$;
