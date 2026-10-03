-- Mydo only. Routines use the same account/list and remain open indefinitely.
-- Applying this transaction never edits task lists or sends test notifications.
-- Uses the existing admin role to update Mydo functions; no tables are created,
-- no RLS is disabled, no policies/auth configuration are changed, and no direct
-- browser access is granted. Existing service and authenticated RPC grants stay.
-- PostgreSQL requires dropping/recreating mydo_claim_reminders solely because
-- its return signature gains is_routine. That operation removes no task,
-- reminder or device data and happens atomically inside this transaction.
begin;
-- Fail closed if the existing RLS/service-only access differs from the expected
-- Mydo setup. Capture every table ACL and policy without changing security.
do $$ declare relation_name text; privilege_name text; rls_enabled boolean; security_state jsonb; begin
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
  perform set_config('mydo.routines_security_before',security_state::text,true);
end; $$;

alter table public.mydo_reminders add column routine jsonb
  check(routine is null or jsonb_typeof(routine)='object');

create function public.mydo_validate_routine(p_task jsonb)
returns void language plpgsql set search_path='' as $$
declare r jsonb := p_task->'routine'; reminder jsonb := p_task->'reminder'; checked record;
begin
  if jsonb_typeof(r) is distinct from 'object'
    or coalesce(r->>'frequency','') not in ('daily','weekly','monthly')
    or jsonb_typeof(r->'weekdays') is distinct from 'array'
    or jsonb_typeof(r->'start') is distinct from 'string' or r->>'start' !~ '^\d{4}-\d{2}-\d{2}$'
    or jsonb_typeof(r->'timeZone') is distinct from 'string' or length(r->>'timeZone')>80
    or not exists(select 1 from pg_timezone_names where name=r->>'timeZone')
    or jsonb_typeof(r->'paused') is distinct from 'boolean'
    or jsonb_typeof(r->'checks') is distinct from 'object'
    or p_task->'done' is distinct from 'false'::jsonb
    or p_task->>'status' is distinct from 'preparing'
    or p_task->>'due' is distinct from ''
    or p_task->'deps' is distinct from '[]'::jsonb then raise exception 'routine'; end if;
  perform (r->>'start')::date;
  if exists(select 1 from jsonb_array_elements(r->'weekdays') d(value) where jsonb_typeof(d.value) is distinct from 'number')
    or exists(select 1 from jsonb_array_elements_text(r->'weekdays') d(value) where d.value::numeric not between 0 and 6 or d.value::numeric<>trunc(d.value::numeric))
    or (select count(*)<>count(distinct value) from jsonb_array_elements(r->'weekdays'))
    or (r->>'frequency'='weekly' and jsonb_array_length(r->'weekdays')=0)
    or (r->>'frequency'<>'weekly' and jsonb_array_length(r->'weekdays')<>0)
    or (select count(*) from jsonb_object_keys(r->'checks'))>3660 then raise exception 'routine'; end if;
  for checked in select key,value from jsonb_each(r->'checks') loop
    if checked.key !~ '^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(checked.value) is distinct from 'boolean' then raise exception 'routine checks'; end if;
    perform checked.key::date;
  end loop;
  if reminder is not null and reminder<>'null'::jsonb then
    if jsonb_typeof(reminder) is distinct from 'object'
      or reminder->'onDue' is distinct from 'false'::jsonb
      or coalesce(reminder->>'repeat','') not in ('none',r->>'frequency')
      or reminder->'daily' is distinct from to_jsonb(reminder->>'repeat'='daily')
      or reminder->'start' is distinct from r->'start'
      or reminder->'timeZone' is distinct from r->'timeZone' then raise exception 'routine reminder'; end if;
  end if;
end; $$;

-- Pause/checks affect eligibility only; they do not erase future occurrences.
-- Keep paused rows to preserve same-day delivery deduplication when resumed.
create function public.mydo_routine_on_date(p_routine jsonb,p_date date)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(not (p_routine->>'paused')::boolean
    and p_date>=(p_routine->>'start')::date
    and p_routine->'checks'->>p_date::text is distinct from 'true'
    and case p_routine->>'frequency'
      when 'weekly' then p_routine->'weekdays' @> to_jsonb(array[extract(dow from p_date)::int])
      else public.mydo_repeat_on_date(p_routine->>'frequency',(p_routine->>'start')::date,p_date)
    end,false);
$$;

create or replace function public.mydo_upgrade_tasks(p_tasks jsonb,p_before jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare t jsonb; old_task jsonb; r jsonb; result jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_tasks) is distinct from 'array' then raise exception 'tasks format'; end if;
  for t in select value from jsonb_array_elements(p_tasks) loop
    select node.value into old_task from jsonb_array_elements(p_before) node(value) where node.value->>'id'=t->>'id';
    if old_task->>'kind'='routine' then
      -- Earlier clients know only done/status. Retain the routine and its history,
      -- and ignore their permanent-complete toggle. Explicit kind changes fail.
      if t ? 'kind' and t->>'kind' is distinct from 'routine' then raise exception 'task kind is immutable'; end if;
      t:=t||jsonb_build_object('kind','routine','done',false,'status','preparing','due','','deps','[]'::jsonb);
      if not (t ? 'routine') then t:=jsonb_set(t,'{routine}',old_task->'routine');
      elsif jsonb_typeof(t->'routine')='object' then t:=jsonb_set(t,'{routine}',old_task->'routine'||(t->'routine')); end if;
      if not (t ? 'reminder') or (jsonb_typeof(t->'reminder')='object' and not (t->'reminder' ? 'repeat')) then
        t:=jsonb_set(t,'{reminder}',coalesce(old_task->'reminder','null'::jsonb));
      end if;
    else
      if old_task is not null and coalesce(t->>'kind','task')<>coalesce(old_task->>'kind','task') then
        raise exception 'task kind is immutable'; end if;
    if not (t ? 'status') then
      t:=t||jsonb_build_object('status',case when (t->>'done')::boolean then 'complete'
        when coalesce((old_task->>'done')::boolean,false) then 'preparing'
        else coalesce(nullif(old_task->>'status','complete'),'preparing') end);
    elsif t->>'status' in ('preparing','ongoing','almost','complete') then
      t:=t||jsonb_build_object('status',case when (t->>'done')::boolean then 'complete'
        when t->>'status'='complete' then 'preparing' else t->>'status' end);
    end if;
    end if;
    r:=t->'reminder';
    if jsonb_typeof(r)='object' and not (r ? 'repeat') and old_task->'reminder' ? 'repeat'
      and r->'daily'=old_task->'reminder'->'daily' then
      t:=jsonb_set(t,'{reminder,repeat}',old_task->'reminder'->'repeat');
    end if;
    result:=result||jsonb_build_array(t);
  end loop;
  return result;
end; $$;

create or replace function public.mydo_validate_cloud(p_tasks jsonb)
returns void language plpgsql set search_path='' as $$
declare t jsonb; r jsonb; ids text[] := '{}'; dep text; cycles boolean;
begin
  if jsonb_typeof(p_tasks) is distinct from 'array' or jsonb_array_length(p_tasks)>2000
    or octet_length(p_tasks::text)>1000000 then raise exception 'tasks size'; end if;
  for t in select value from jsonb_array_elements(p_tasks) loop
    if jsonb_typeof(t) is distinct from 'object'
      or jsonb_typeof(t->'id') is distinct from 'string' or length(t->>'id') not between 1 and 100
      or (t->>'id')=any(ids)
      or jsonb_typeof(t->'title') is distinct from 'string' or length(trim(t->>'title'))<1 or length(t->>'title')>200
      or jsonb_typeof(t->'project') is distinct from 'string' or length(t->>'project')>80
      or jsonb_typeof(t->'notes') is distinct from 'string' or length(t->>'notes')>5000
      or coalesce(t->>'intent','') not in ('must','want')
      or jsonb_typeof(t->'urgent') is distinct from 'boolean'
      or jsonb_typeof(t->'done') is distinct from 'boolean'
      or (t ? 'kind' and coalesce(t->>'kind','') not in ('task','routine'))
      or (coalesce(t->>'kind','task')<>'routine' and t ? 'routine')
      or (t ? 'status' and coalesce(t->>'status','') not in ('preparing','ongoing','almost','complete'))
      or jsonb_typeof(t->'created') is distinct from 'string'
      or jsonb_typeof(t->'due') is distinct from 'string'
      or jsonb_typeof(t->'deps') is distinct from 'array' then raise exception 'tasks format'; end if;
    perform (t->>'created')::timestamptz;
    if t->>'due'<>'' then
      if t->>'due' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'date'; end if;
      perform (t->>'due')::date;
    end if;
    if exists(select 1 from jsonb_array_elements(t->'deps') d where jsonb_typeof(d) is distinct from 'string')
      or (select count(*)<>count(distinct value) from jsonb_array_elements(t->'deps')) then raise exception 'deps'; end if;
    if t->>'kind'='routine' then perform public.mydo_validate_routine(t); end if;
    ids := array_append(ids,t->>'id');
    r := t->'reminder';
    if r is not null and r<>'null'::jsonb then
      if jsonb_typeof(r) is distinct from 'object'
        or jsonb_typeof(r->'onDue') is distinct from 'boolean'
        or jsonb_typeof(r->'daily') is distinct from 'boolean'
        or (r ? 'repeat' and (coalesce(r->>'repeat','') not in ('none','daily','weekly','monthly')
          or (r->>'daily')::boolean is distinct from (r->>'repeat'='daily')))
        or coalesce(r->>'time','') !~ '^([01]\d|2[0-3]):[0-5]\d$'
        or jsonb_typeof(r->'timeZone') is distinct from 'string'
        or not exists(select 1 from pg_timezone_names where name=r->>'timeZone')
        or jsonb_typeof(r->'start') is distinct from 'string' then raise exception 'reminder'; end if;
      if r->>'start'<>'' then
        if r->>'start' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'start date'; end if;
        perform (r->>'start')::date;
      end if;
      if (r->>'onDue')::boolean and t->>'due'='' then raise exception 'reminder deadline'; end if;
      if coalesce(r->>'repeat',case when (r->>'daily')::boolean then 'daily' else 'none' end)<>'none' and r->>'start'='' then raise exception 'reminder start'; end if;
    end if;
  end loop;
  for t in select value from jsonb_array_elements(p_tasks) loop
    for dep in select jsonb_array_elements_text(t->'deps') loop
      if not dep=any(ids) then raise exception 'missing prerequisite'; end if;
      if exists(select 1 from jsonb_array_elements(p_tasks) node(value) where node.value->>'id'=dep and node.value->>'kind'='routine')
        then raise exception 'routine prerequisite'; end if;
      if (t->>'done')::boolean and exists(select 1 from jsonb_array_elements(p_tasks) x
        where x->>'id'=dep and not (x->>'done')::boolean) then raise exception 'completed prerequisite'; end if;
    end loop;
  end loop;
  with recursive edges as (
    select node.value->>'id' as id, jsonb_array_elements_text(node.value->'deps') as dep from jsonb_array_elements(p_tasks) node(value)
  ), reach as (
    select edges.id,edges.dep from edges
    union select w.id,e.dep from reach w join edges e on e.id=w.dep
  ) select exists(select 1 from reach where reach.id=reach.dep) into cycles;
  if cycles then raise exception 'dependency cycle'; end if;
  if (select count(*) from jsonb_array_elements(p_tasks) node(value) where not (node.value->>'done')::boolean
      and ((node.value->'reminder'->>'onDue')::boolean or coalesce(node.value->'reminder'->>'repeat',case when (node.value->'reminder'->>'daily')::boolean then 'daily' else 'none' end)<>'none'))>100
    then raise exception 'too many reminders'; end if;
end; $$;
create or replace function public.mydo_cloud_project(p_user uuid)
returns void language plpgsql set search_path='' as $$
declare d record; reminders jsonb;
begin
  select coalesce(jsonb_agg(t),'[]'::jsonb) into reminders
    from public.mydo_cloud_lists l, jsonb_array_elements(l.tasks) t
    where l.user_id=p_user and not (t->>'done')::boolean
      and ((t->'reminder'->>'onDue')::boolean or coalesce(t->'reminder'->>'repeat',case when (t->'reminder'->>'daily')::boolean then 'daily' else 'none' end)<>'none');
  for d in select * from public.mydo_push_devices where user_id=p_user and enabled and cloud_enabled loop
    perform public.mydo_sync_reminders(d.user_id,d.id,d.subscription,d.language,reminders);
  end loop;
end; $$;
create or replace function public.mydo_sync_reminders(p_user uuid,p_device uuid,p_subscription jsonb,p_language text,p_tasks jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  -- Linked devices use the canonical cloud list, including tasks added elsewhere.
  if exists(select 1 from public.mydo_push_devices where id=p_device and user_id=p_user and cloud_enabled)
    and exists(select 1 from public.mydo_cloud_lists where user_id=p_user) then
    select coalesce(jsonb_agg(t),'[]'::jsonb) into p_tasks
      from public.mydo_cloud_lists l,jsonb_array_elements(l.tasks) t
      where l.user_id=p_user and not (t->>'done')::boolean
        and ((t->'reminder'->>'onDue')::boolean or coalesce(t->'reminder'->>'repeat',case when (t->'reminder'->>'daily')::boolean then 'daily' else 'none' end)<>'none');
  end if;
  if exists(select 1 from public.mydo_push_devices where id=p_device and user_id<>p_user) then raise exception 'device owner mismatch'; end if;
  if jsonb_array_length(p_tasks)>100 then raise exception 'too many reminders'; end if;
  insert into public.mydo_push_devices(id,user_id,subscription,language,enabled,synced_at)
  values(p_device,p_user,p_subscription,p_language,true,now())
  on conflict(id) do update set subscription=excluded.subscription,language=excluded.language,enabled=true,synced_at=now();
  insert into public.mydo_reminders(user_id,device_id,task_id,title,due,on_due,daily,frequency,start_date,remind_time,time_zone,routine)
  select p_user,p_device,x->>'id',x->>'title',nullif(x->>'due','')::date,
    (x->'reminder'->>'onDue')::boolean,(x->'reminder'->>'daily')::boolean,
    coalesce(x->'reminder'->>'repeat',case when (x->'reminder'->>'daily')::boolean then 'daily' else 'none' end),
    nullif(x->'reminder'->>'start','')::date,(x->'reminder'->>'time')::time,x->'reminder'->>'timeZone',
    case when x->>'kind'='routine' then x->'routine' else null end
  from jsonb_array_elements(p_tasks) x
  on conflict(user_id,device_id,task_id) do update set
    title=excluded.title,due=excluded.due,on_due=excluded.on_due,daily=excluded.daily,frequency=excluded.frequency,
    start_date=excluded.start_date,remind_time=excluded.remind_time,time_zone=excluded.time_zone,routine=excluded.routine,
    claim_id=null,claim_until=null
  where (mydo_reminders.title,mydo_reminders.due,mydo_reminders.on_due,mydo_reminders.daily,mydo_reminders.frequency,mydo_reminders.start_date,mydo_reminders.remind_time,mydo_reminders.time_zone,mydo_reminders.routine)
    is distinct from (excluded.title,excluded.due,excluded.on_due,excluded.daily,excluded.frequency,excluded.start_date,excluded.remind_time,excluded.time_zone,excluded.routine);
  delete from public.mydo_reminders r where user_id=p_user and device_id=p_device
    and not exists(select 1 from jsonb_array_elements(p_tasks) x where x->>'id'=r.task_id);
end; $$;
create or replace function public.mydo_cloud_write(p_revision bigint,p_tasks jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid(); current_row public.mydo_cloud_lists;
begin
  if u is null then raise exception 'authentication required'; end if;
  -- Bound raw input before taking the row lock, then validate after adapting
  -- known old-client routines. New routines still require the full envelope.
  if jsonb_typeof(p_tasks) is distinct from 'array' or jsonb_array_length(p_tasks)>2000
    or octet_length(p_tasks::text)>1000000 then raise exception 'tasks size'; end if;
  if exists(select 1 from jsonb_array_elements(p_tasks) node(value)
    where jsonb_typeof(node.value) is distinct from 'object'
      or jsonb_typeof(node.value->'id') is distinct from 'string'
      or jsonb_typeof(node.value->'done') is distinct from 'boolean'
      or (node.value ? 'kind' and coalesce(node.value->>'kind','') not in ('task','routine'))
      or (node.value ? 'status' and coalesce(node.value->>'status','') not in ('preparing','ongoing','almost','complete')))
    then raise exception 'tasks format'; end if;
  insert into public.mydo_cloud_lists(user_id) values(u) on conflict do nothing;
  select * into current_row from public.mydo_cloud_lists where user_id=u for update;
  if p_revision is distinct from current_row.revision then
    return jsonb_build_object('ok',false,'revision',current_row.revision); end if;
  p_tasks := public.mydo_upgrade_tasks(p_tasks,current_row.tasks);
  perform public.mydo_validate_cloud(p_tasks);
  update public.mydo_cloud_lists set tasks=p_tasks,revision=revision+1,updated_at=now()
    where user_id=u returning * into current_row;
  perform public.mydo_cloud_project(u);
  return jsonb_build_object('ok',true,'revision',current_row.revision,'tasks',current_row.tasks);
end; $$;
drop function public.mydo_claim_reminders(int);
create function public.mydo_claim_reminders(p_limit int default 10)
returns table(user_id uuid,device_id uuid,task_id text,title text,subscription jsonb,language text,claim_id uuid,local_date date,is_due boolean,frequency text,is_routine boolean)
language sql set search_path = '' as $$
  with candidates as (
    select r.user_id,r.device_id,r.task_id
    from public.mydo_reminders r join public.mydo_push_devices d on d.id=r.device_id and d.user_id=r.user_id
    where d.enabled and (r.claim_until is null or r.claim_until<now())
      and r.last_sent_on is distinct from (now() at time zone r.time_zone)::date
      and (now() at time zone r.time_zone)::time >= r.remind_time
      and (case when r.routine is not null then public.mydo_routine_on_date(r.routine,(now() at time zone r.time_zone)::date)
        else ((r.on_due and r.due=(now() at time zone r.time_zone)::date)
        or public.mydo_repeat_on_date(r.frequency,r.start_date,(now() at time zone r.time_zone)::date)) end)
    order by r.remind_time,r.task_id limit least(greatest(p_limit,1),10)
    for update of r skip locked
  ), claimed as (
    update public.mydo_reminders r set claim_id=gen_random_uuid(),claim_until=now()+interval '5 minutes'
    from candidates c where r.user_id=c.user_id and r.device_id=c.device_id and r.task_id=c.task_id
    returning r.*
  )
  select r.user_id,r.device_id,r.task_id,r.title,d.subscription,d.language,r.claim_id,
    (now() at time zone r.time_zone)::date,
    r.on_due and r.due=(now() at time zone r.time_zone)::date,r.frequency,r.routine is not null
  from claimed r join public.mydo_push_devices d on d.id=r.device_id and d.user_id=r.user_id;
$$;
revoke all on function public.mydo_validate_routine(jsonb),public.mydo_routine_on_date(jsonb,date),public.mydo_claim_reminders(int) from public,anon,authenticated;
grant execute on function public.mydo_validate_routine(jsonb),public.mydo_routine_on_date(jsonb,date),public.mydo_claim_reminders(int) to service_role;
-- Re-project existing reminders without changing revisions, subscriptions or
-- last_sent_on. No existing to-do is converted to a routine.
do $$ declare u uuid; begin
  for u in select user_id from public.mydo_cloud_lists loop perform public.mydo_cloud_project(u); end loop;
end; $$;
-- RLS, owners, table grants and policies must be exactly the same afterwards.
do $$ declare relation_name text; privilege_name text; rls_enabled boolean; security_state jsonb; begin
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
  if security_state is distinct from current_setting('mydo.routines_security_before')::jsonb
    then raise exception 'Mydo table security changed during routine migration'; end if;
end; $$;
commit;
