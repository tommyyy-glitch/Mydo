-- Mydo only: preserve old schedules and keep the existing phone subscription.
begin;
alter table public.mydo_reminders add column frequency text not null default 'none'
  check(frequency in ('none','daily','weekly','monthly'));
update public.mydo_reminders set frequency=case when daily then 'daily' else 'none' end;
alter table public.mydo_reminders add constraint mydo_repeat_start check(frequency='none' or start_date is not null);
alter table public.mydo_reminders add constraint mydo_repeat_daily check(daily=(frequency='daily'));

create function public.mydo_repeat_on_date(p_frequency text,p_start date,p_date date)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(p_date>=p_start and case p_frequency
    when 'daily' then true
    when 'weekly' then (p_date-p_start)%7=0
    when 'monthly' then extract(day from p_date)=least(extract(day from p_start),
      extract(day from (date_trunc('month',p_date)::date+interval '1 month - 1 day')))
    else false end,false);
$$;

-- Old clients spread task fields, but rebuild reminders and toggle only done.
-- Preserve fields they cannot edit; honour their completion/reopen and daily edits.
create function public.mydo_upgrade_tasks(p_tasks jsonb,p_before jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare t jsonb; old_task jsonb; r jsonb; result jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_tasks) is distinct from 'array' then raise exception 'tasks format'; end if;
  for t in select value from jsonb_array_elements(p_tasks) loop
    select node.value into old_task from jsonb_array_elements(p_before) node(value) where node.value->>'id'=t->>'id';
    if not (t ? 'status') then
      t:=t||jsonb_build_object('status',case when (t->>'done')::boolean then 'complete'
        when coalesce((old_task->>'done')::boolean,false) then 'preparing'
        else coalesce(nullif(old_task->>'status','complete'),'preparing') end);
    elsif t->>'status' in ('preparing','ongoing','almost','complete') then
      t:=t||jsonb_build_object('status',case when (t->>'done')::boolean then 'complete'
        when t->>'status'='complete' then 'preparing' else t->>'status' end);
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
  insert into public.mydo_reminders(user_id,device_id,task_id,title,due,on_due,daily,frequency,start_date,remind_time,time_zone)
  select p_user,p_device,x->>'id',x->>'title',nullif(x->>'due','')::date,
    (x->'reminder'->>'onDue')::boolean,(x->'reminder'->>'daily')::boolean,
    coalesce(x->'reminder'->>'repeat',case when (x->'reminder'->>'daily')::boolean then 'daily' else 'none' end),
    nullif(x->'reminder'->>'start','')::date,(x->'reminder'->>'time')::time,x->'reminder'->>'timeZone'
  from jsonb_array_elements(p_tasks) x
  on conflict(user_id,device_id,task_id) do update set
    title=excluded.title,due=excluded.due,on_due=excluded.on_due,daily=excluded.daily,frequency=excluded.frequency,
    start_date=excluded.start_date,remind_time=excluded.remind_time,time_zone=excluded.time_zone,
    claim_id=null,claim_until=null
  where (mydo_reminders.title,mydo_reminders.due,mydo_reminders.on_due,mydo_reminders.daily,mydo_reminders.frequency,mydo_reminders.start_date,mydo_reminders.remind_time,mydo_reminders.time_zone)
    is distinct from (excluded.title,excluded.due,excluded.on_due,excluded.daily,excluded.frequency,excluded.start_date,excluded.remind_time,excluded.time_zone);
  delete from public.mydo_reminders r where user_id=p_user and device_id=p_device
    and not exists(select 1 from jsonb_array_elements(p_tasks) x where x->>'id'=r.task_id);
end; $$;
create or replace function public.mydo_cloud_write(p_revision bigint,p_tasks jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid(); current_row public.mydo_cloud_lists;
begin
  if u is null then raise exception 'authentication required'; end if;
  perform public.mydo_validate_cloud(p_tasks);
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
returns table(user_id uuid,device_id uuid,task_id text,title text,subscription jsonb,language text,claim_id uuid,local_date date,is_due boolean,frequency text)
language sql set search_path = '' as $$
  with candidates as (
    select r.user_id,r.device_id,r.task_id
    from public.mydo_reminders r join public.mydo_push_devices d on d.id=r.device_id and d.user_id=r.user_id
    where d.enabled and (r.claim_until is null or r.claim_until<now())
      and r.last_sent_on is distinct from (now() at time zone r.time_zone)::date
      and (now() at time zone r.time_zone)::time >= r.remind_time
      and ((r.on_due and r.due=(now() at time zone r.time_zone)::date)
        or public.mydo_repeat_on_date(r.frequency,r.start_date,(now() at time zone r.time_zone)::date))
    order by r.remind_time,r.task_id limit least(greatest(p_limit,1),10)
    for update of r skip locked
  ), claimed as (
    update public.mydo_reminders r set claim_id=gen_random_uuid(),claim_until=now()+interval '5 minutes'
    from candidates c where r.user_id=c.user_id and r.device_id=c.device_id and r.task_id=c.task_id
    returning r.*
  )
  select r.user_id,r.device_id,r.task_id,r.title,d.subscription,d.language,r.claim_id,
    (now() at time zone r.time_zone)::date,
    r.on_due and r.due=(now() at time zone r.time_zone)::date,r.frequency
  from claimed r join public.mydo_push_devices d on d.id=r.device_id and d.user_id=r.user_id;
$$;
revoke all on function public.mydo_repeat_on_date(text,date,date),public.mydo_upgrade_tasks(jsonb,jsonb),public.mydo_claim_reminders(int) from public,anon,authenticated;
grant execute on function public.mydo_repeat_on_date(text,date,date),public.mydo_upgrade_tasks(jsonb,jsonb),public.mydo_claim_reminders(int) to service_role;
-- Re-project without changing task lists, revisions, last-sent dates or subscriptions.
do $$ declare u uuid; begin
  for u in select user_id from public.mydo_cloud_lists loop perform public.mydo_cloud_project(u); end loop;
end; $$;
commit;
