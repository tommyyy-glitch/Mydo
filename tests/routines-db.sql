-- Append after the migration while its transaction is open, then ROLLBACK.
-- Uses only an existing linked Mydo test context; never sends a notification.
do $$
declare u uuid; d public.mydo_push_devices; state public.mydo_cloud_lists;
  tasks jsonb; response jsonb; legacy jsonb; updated jsonb; sample jsonb;
  local_today date := (now() at time zone 'Asia/Hong_Kong')::date;
  today_dow int := extract(dow from (now() at time zone 'Asia/Hong_Kong')::date)::int;
  row_count int; lease uuid; failure boolean;
  relation_name text; privilege_name text; rls_enabled boolean; security_state jsonb; security_before jsonb;
begin
  for relation_name in select unnest(array['mydo_cloud_lists','mydo_push_devices','mydo_reminders']) loop
    select c.relrowsecurity into rls_enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=relation_name and c.relkind='r';
    if rls_enabled is distinct from true then raise exception 'Mydo RLS must remain enabled: %',relation_name; end if;
    foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role','public.'||relation_name,privilege_name)
        then raise exception 'existing Mydo service grant missing: %.%',relation_name,privilege_name; end if;
    end loop;
    if has_table_privilege('anon','public.'||relation_name,'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('authenticated','public.'||relation_name,'SELECT,INSERT,UPDATE,DELETE')
      then raise exception 'Mydo direct table access must stay private: %',relation_name; end if;
  end loop;
  if not has_function_privilege('authenticated','public.mydo_cloud_write(bigint,jsonb)','execute')
    or not has_function_privilege('service_role','public.mydo_sync_reminders(uuid,uuid,jsonb,text,jsonb)','execute')
    or not has_function_privilege('service_role','public.mydo_claim_reminders(int)','execute')
    or has_function_privilege('anon','public.mydo_claim_reminders(int)','execute')
    or has_function_privilege('authenticated','public.mydo_claim_reminders(int)','execute')
    then raise exception 'existing Mydo function grants must stay scoped'; end if;
  select jsonb_build_object('tables',(
    select jsonb_object_agg(c.relname,jsonb_build_object('rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
      'owner',c.relowner,'acl',c.relacl::text,
      'policies',(select coalesce(jsonb_agg(to_jsonb(policy) order by policy.polname),'[]'::jsonb) from pg_policy policy where policy.polrelid=c.oid)))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('mydo_cloud_lists','mydo_push_devices','mydo_reminders')),
    'functions',(
    select jsonb_object_agg(p.proname,jsonb_build_object('owner',p.proowner,'definer',p.prosecdef,'config',p.proconfig,
      'acl',(select jsonb_agg(to_jsonb(a) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable)
        from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)))
    from pg_proc p where p.oid in (
      'public.mydo_cloud_read()'::regprocedure,'public.mydo_cloud_write(bigint,jsonb)'::regprocedure,
      'public.mydo_validate_cloud(jsonb)'::regprocedure,'public.mydo_upgrade_tasks(jsonb,jsonb)'::regprocedure,
      'public.mydo_cloud_project(uuid)'::regprocedure,'public.mydo_sync_reminders(uuid,uuid,jsonb,text,jsonb)'::regprocedure,
      'public.mydo_claim_reminders(int)'::regprocedure))) into security_state;
  security_before:=security_state;
  sample := jsonb_build_object('frequency','weekly','weekdays',jsonb_build_array(1,3,5),
    'start','2026-10-01','timeZone','Asia/Hong_Kong','paused',false,'checks','{}'::jsonb);
  if not public.mydo_routine_on_date(sample,'2026-10-02')
    or not public.mydo_routine_on_date(sample,'2026-10-05')
    or public.mydo_routine_on_date(sample,'2026-10-03')
    or public.mydo_routine_on_date(sample,'2026-09-30') then raise exception 'selected weekdays failed'; end if;
  sample:=sample||'{"frequency":"monthly","weekdays":[],"start":"2026-01-31"}'::jsonb;
  if not public.mydo_routine_on_date(sample,'2026-02-28')
    or public.mydo_routine_on_date(sample,'2026-03-28')
    or not public.mydo_routine_on_date(sample,'2026-03-31')
    or not public.mydo_routine_on_date(sample,'2028-02-29') then raise exception 'monthly anchor failed'; end if;

  select l.user_id into u from public.mydo_cloud_lists l
    where exists(select 1 from public.mydo_push_devices p where p.user_id=l.user_id and p.enabled and p.cloud_enabled)
    order by l.user_id limit 1;
  if u is null then raise exception 'linked Mydo fixture context required'; end if;
  select * into d from public.mydo_push_devices where user_id=u and enabled and cloud_enabled order by id limit 1;
  perform set_config('request.jwt.claim.sub',u::text,true);
  select * into state from public.mydo_cloud_lists where user_id=u for update;
  tasks := '[]'::jsonb;
  for sample in select jsonb_build_object('id','__mydo_qa_routine_'||frequency||'__',
    'title','Rollback-only routine QA','project','QA','notes','','intent','must','urgent',false,
    'kind','routine','done',false,'status','preparing','due','','deps','[]'::jsonb,'created','2026-10-03T00:00:00Z',
    'routine',jsonb_build_object('frequency',frequency,'weekdays',case when frequency='weekly' then jsonb_build_array(today_dow,(today_dow+2)%7) else '[]'::jsonb end,
      'start',local_today::text,'timeZone','Asia/Hong_Kong','paused',false,'checks','{}'::jsonb),
    'reminder',jsonb_build_object('onDue',false,'daily',frequency='daily','repeat',frequency,
      'start',local_today::text,'time','00:00','timeZone','Asia/Hong_Kong'))
    from (values ('daily',0),('weekly',1),('monthly',2)) modes(frequency,position)
    order by position loop
    tasks:=tasks||jsonb_build_array(sample);
  end loop;
  sample:=jsonb_build_object('id','__mydo_qa_routine_normal__','title','Rollback-only normal task QA',
    'project','QA','notes','','intent','want','urgent',false,'done',false,'status','ongoing',
    'due','2099-01-01','deps','[]'::jsonb,'created','2026-10-03T00:00:00Z',
    'reminder',jsonb_build_object('onDue',true,'daily',false,'repeat','none','start','','time','00:00','timeZone','Asia/Hong_Kong'));
  tasks:=tasks||jsonb_build_array(sample);
  response:=public.mydo_cloud_write(state.revision,tasks);
  if not (response->>'ok')::boolean then raise exception 'CAS write failed'; end if;
  if (select count(*) from public.mydo_reminders where user_id=u and device_id=d.id and routine is not null)<>3
    or not exists(select 1 from public.mydo_reminders where user_id=u and device_id=d.id and task_id='__mydo_qa_routine_normal__' and routine is null)
    then raise exception 'routine/normal projection failed'; end if;
  select count(*) into row_count from public.mydo_claim_reminders(10) where task_id like '__mydo_qa_routine_%' and is_routine;
  if row_count<>3 then raise exception 'routine scheduler failed'; end if;
  select claim_id into lease from public.mydo_reminders where user_id=u and device_id=d.id and task_id='__mydo_qa_routine_daily__';
  perform public.mydo_cloud_project(u);
  if not exists(select 1 from public.mydo_reminders where user_id=u and device_id=d.id and task_id='__mydo_qa_routine_daily__' and claim_id=lease)
    then raise exception 'unchanged sync invalidated lease'; end if;
  if exists(select 1 from public.mydo_claim_reminders(10) where task_id like '__mydo_qa_routine_%') then raise exception 'claim lease failed'; end if;

  -- Completing one local occurrence cancels its in-flight job, leaves the
  -- routine open, and permits the next scheduled day without creating tasks.
  updated:=jsonb_set(response->'tasks',array['0','routine','checks',local_today::text],'true'::jsonb);
  response:=public.mydo_cloud_write((response->>'revision')::bigint,updated);
  if response->'tasks'->0->'done'<>'false'::jsonb or response->'tasks'->0->>'status'<>'preparing'
    or not exists(select 1 from public.mydo_reminders where user_id=u and device_id=d.id and task_id='__mydo_qa_routine_daily__' and claim_id is null)
    or exists(select 1 from public.mydo_claim_reminders(10) where task_id='__mydo_qa_routine_daily__')
    or not public.mydo_routine_on_date(response->'tasks'->0->'routine',local_today+1) then raise exception 'occurrence check cancellation failed'; end if;

  -- An earlier client may strip kind/routine/repeat and toggle done=true.
  -- Preserve its routine history rather than completing it permanently.
  legacy:=response->'tasks';
  legacy:=jsonb_set(legacy,'{0}',(legacy->0)-'kind'-'routine'-'status');
  legacy:=jsonb_set(legacy,'{0,done}','true'::jsonb);
  legacy:=jsonb_set(legacy,'{0,reminder}',(legacy->0->'reminder')-'repeat');
  response:=public.mydo_cloud_write((response->>'revision')::bigint,legacy);
  if response->'tasks'->0->>'kind'<>'routine' or response->'tasks'->0->'done'<>'false'::jsonb
    or response->'tasks'->0->'routine'->'checks'->>local_today::text<>'true'
    or response->'tasks'->0->'reminder'->>'repeat'<>'daily' then raise exception 'legacy routine preservation failed'; end if;
  legacy:=jsonb_set(response->'tasks','{0,routine}',(response->'tasks'->0->'routine')-'checks');
  response:=public.mydo_cloud_write((response->>'revision')::bigint,legacy);
  if response->'tasks'->0->'routine'->'checks'->>local_today::text<>'true' then raise exception 'missing checks preservation failed'; end if;

  updated:=jsonb_set(response->'tasks',array['0','routine','checks',local_today::text],'false'::jsonb);
  response:=public.mydo_cloud_write((response->>'revision')::bigint,updated);
  if not public.mydo_routine_on_date(response->'tasks'->0->'routine',local_today)
    or not exists(select 1 from public.mydo_claim_reminders(10) where task_id='__mydo_qa_routine_daily__') then raise exception 'occurrence undo failed'; end if;
  update public.mydo_reminders set last_sent_on=local_today,claim_id=null,claim_until=null
    where user_id=u and device_id=d.id and task_id='__mydo_qa_routine_daily__';
  updated:=jsonb_set(response->'tasks','{0,routine,paused}','true'::jsonb);
  response:=public.mydo_cloud_write((response->>'revision')::bigint,updated);
  if public.mydo_routine_on_date(response->'tasks'->0->'routine',local_today+1)
    or not exists(select 1 from public.mydo_reminders where user_id=u and device_id=d.id and task_id='__mydo_qa_routine_daily__' and last_sent_on=local_today)
    then raise exception 'pause lost schedule/delivery history'; end if;
  -- Pausing a currently claimed weekly routine invalidates that job too.
  updated:=jsonb_set(response->'tasks','{1,routine,paused}','true'::jsonb);
  response:=public.mydo_cloud_write((response->>'revision')::bigint,updated);
  if not exists(select 1 from public.mydo_reminders where user_id=u and device_id=d.id and task_id='__mydo_qa_routine_weekly__' and claim_id is null)
    or exists(select 1 from public.mydo_claim_reminders(10) where task_id='__mydo_qa_routine_weekly__') then raise exception 'pause claim invalidation failed'; end if;
  updated:=jsonb_set(response->'tasks','{0,routine,paused}','false'::jsonb);
  response:=public.mydo_cloud_write((response->>'revision')::bigint,updated);
  if not public.mydo_routine_on_date(response->'tasks'->0->'routine',local_today)
    or exists(select 1 from public.mydo_claim_reminders(10) where task_id='__mydo_qa_routine_daily__') then raise exception 'resume same-day dedup failed'; end if;
  updated:=jsonb_set(response->'tasks','{1,routine,paused}','false'::jsonb);
  response:=public.mydo_cloud_write((response->>'revision')::bigint,updated);
  if not exists(select 1 from public.mydo_claim_reminders(10) where task_id='__mydo_qa_routine_weekly__')
    then raise exception 'resume unsent scheduled occurrence failed'; end if;
  select claim_id into lease from public.mydo_reminders where user_id=u and device_id=d.id and task_id='__mydo_qa_routine_weekly__';
  response:=public.mydo_cloud_write((response->>'revision')::bigint,response->'tasks');
  if not exists(select 1 from public.mydo_reminders where user_id=u and device_id=d.id and task_id='__mydo_qa_routine_weekly__' and claim_id=lease)
    then raise exception 'identical routine write reset live claim'; end if;

  failure:=false;
  begin
    perform public.mydo_cloud_write((response->>'revision')::bigint,jsonb_set(response->'tasks','{0,kind}','"task"'::jsonb));
  exception when others then failure:=true; end;
  if not failure then raise exception 'routine kind switch accepted'; end if;
  failure:=false;
  begin
    perform public.mydo_cloud_write((response->>'revision')::bigint,jsonb_set(response->'tasks','{3}',
      (response->'tasks'->0)||jsonb_build_object('id','__mydo_qa_routine_normal__')));
  exception when others then failure:=true; end;
  if not failure then raise exception 'normal kind switch accepted'; end if;
  failure:=false;
  begin
    perform public.mydo_validate_cloud(jsonb_set(response->'tasks','{3,deps}','["__mydo_qa_routine_daily__"]'::jsonb));
  exception when others then failure:=true; end;
  if not failure then raise exception 'routine prerequisite accepted'; end if;
  failure:=false;
  begin
    perform public.mydo_validate_cloud(jsonb_set(response->'tasks','{0,routine,weekdays}','[1]'::jsonb));
  exception when others then failure:=true; end;
  if not failure then raise exception 'invalid routine accepted'; end if;
  failure:=false;
  begin
    perform public.mydo_cloud_write((response->>'revision')::bigint,jsonb_set(response->'tasks','{0,done}','null'::jsonb));
  exception when others then failure:=true; end;
  if not failure then raise exception 'invalid raw done accepted'; end if;
  if has_function_privilege('anon','public.mydo_validate_routine(jsonb)','execute')
    or has_function_privilege('authenticated','public.mydo_routine_on_date(jsonb,date)','execute')
    or has_function_privilege('authenticated','public.mydo_claim_reminders(int)','execute') then raise exception 'helper exposed'; end if;
  for relation_name in select unnest(array['mydo_cloud_lists','mydo_push_devices','mydo_reminders']) loop
    select c.relrowsecurity into rls_enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=relation_name and c.relkind='r';
    if rls_enabled is distinct from true then raise exception 'Mydo RLS must remain enabled: %',relation_name; end if;
    foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role','public.'||relation_name,privilege_name)
        then raise exception 'existing Mydo service grant missing: %.%',relation_name,privilege_name; end if;
    end loop;
    if has_table_privilege('anon','public.'||relation_name,'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('authenticated','public.'||relation_name,'SELECT,INSERT,UPDATE,DELETE')
      then raise exception 'Mydo direct table access must stay private: %',relation_name; end if;
  end loop;
  if not has_function_privilege('authenticated','public.mydo_cloud_write(bigint,jsonb)','execute')
    or not has_function_privilege('service_role','public.mydo_sync_reminders(uuid,uuid,jsonb,text,jsonb)','execute')
    or not has_function_privilege('service_role','public.mydo_claim_reminders(int)','execute')
    or has_function_privilege('anon','public.mydo_claim_reminders(int)','execute')
    or has_function_privilege('authenticated','public.mydo_claim_reminders(int)','execute')
    then raise exception 'existing Mydo function grants must stay scoped'; end if;
  select jsonb_build_object('tables',(
    select jsonb_object_agg(c.relname,jsonb_build_object('rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
      'owner',c.relowner,'acl',c.relacl::text,
      'policies',(select coalesce(jsonb_agg(to_jsonb(policy) order by policy.polname),'[]'::jsonb) from pg_policy policy where policy.polrelid=c.oid)))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('mydo_cloud_lists','mydo_push_devices','mydo_reminders')),
    'functions',(
    select jsonb_object_agg(p.proname,jsonb_build_object('owner',p.proowner,'definer',p.prosecdef,'config',p.proconfig,
      'acl',(select jsonb_agg(to_jsonb(a) order by a.grantee,a.grantor,a.privilege_type,a.is_grantable)
        from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)))
    from pg_proc p where p.oid in (
      'public.mydo_cloud_read()'::regprocedure,'public.mydo_cloud_write(bigint,jsonb)'::regprocedure,
      'public.mydo_validate_cloud(jsonb)'::regprocedure,'public.mydo_upgrade_tasks(jsonb,jsonb)'::regprocedure,
      'public.mydo_cloud_project(uuid)'::regprocedure,'public.mydo_sync_reminders(uuid,uuid,jsonb,text,jsonb)'::regprocedure,
      'public.mydo_claim_reminders(int)'::regprocedure))) into security_state;
  if security_state is distinct from security_before then raise exception 'Mydo table security changed in fixture'; end if;
end; $$;
