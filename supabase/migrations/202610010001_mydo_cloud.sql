-- Full task sync is isolated from Myfin. Existing device reminders keep working.
create table public.mydo_cloud_lists (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0,
  tasks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.mydo_cloud_lists enable row level security;
revoke all on public.mydo_cloud_lists from public, anon, authenticated;
grant all on public.mydo_cloud_lists to service_role;
alter table public.mydo_push_devices add column cloud_enabled boolean not null default false;

create function public.mydo_validate_cloud(p_tasks jsonb)
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
        or coalesce(r->>'time','') !~ '^([01]\d|2[0-3]):[0-5]\d$'
        or jsonb_typeof(r->'timeZone') is distinct from 'string'
        or not exists(select 1 from pg_timezone_names where name=r->>'timeZone')
        or jsonb_typeof(r->'start') is distinct from 'string' then raise exception 'reminder'; end if;
      if r->>'start'<>'' then
        if r->>'start' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'start date'; end if;
        perform (r->>'start')::date;
      end if;
      if (r->>'onDue')::boolean and t->>'due'='' then raise exception 'reminder deadline'; end if;
      if (r->>'daily')::boolean and r->>'start'='' then raise exception 'reminder start'; end if;
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
      and ((node.value->'reminder'->>'onDue')::boolean or (node.value->'reminder'->>'daily')::boolean))>100
    then raise exception 'too many reminders'; end if;
end; $$;

-- Keep all linked phone projections up to date even while the phones are closed.
create function public.mydo_cloud_project(p_user uuid)
returns void language plpgsql set search_path='' as $$
declare d record; reminders jsonb;
begin
  select coalesce(jsonb_agg(t),'[]'::jsonb) into reminders
    from public.mydo_cloud_lists l, jsonb_array_elements(l.tasks) t
    where l.user_id=p_user and not (t->>'done')::boolean
      and ((t->'reminder'->>'onDue')::boolean or (t->'reminder'->>'daily')::boolean);
  for d in select * from public.mydo_push_devices where user_id=p_user and enabled and cloud_enabled loop
    perform public.mydo_sync_reminders(d.user_id,d.id,d.subscription,d.language,reminders);
  end loop;
end; $$;

create function public.mydo_cloud_read()
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid(); state jsonb;
begin
  if u is null then raise exception 'authentication required'; end if;
  select jsonb_build_object('revision',revision,'tasks',tasks,'updatedAt',updated_at) into state
    from public.mydo_cloud_lists where user_id=u;
  return coalesce(state,jsonb_build_object('revision',0,'tasks','[]'::jsonb));
end; $$;
create function public.mydo_cloud_write(p_revision bigint,p_tasks jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid(); current_row public.mydo_cloud_lists;
begin
  if u is null then raise exception 'authentication required'; end if;
  perform public.mydo_validate_cloud(p_tasks);
  insert into public.mydo_cloud_lists(user_id) values(u) on conflict do nothing;
  select * into current_row from public.mydo_cloud_lists where user_id=u for update;
  if p_revision is distinct from current_row.revision then
    return jsonb_build_object('ok',false,'revision',current_row.revision); end if;
  update public.mydo_cloud_lists set tasks=p_tasks,revision=revision+1,updated_at=now()
    where user_id=u returning * into current_row;
  perform public.mydo_cloud_project(u);
  return jsonb_build_object('ok',true,'revision',current_row.revision,'tasks',current_row.tasks);
end; $$;
create function public.mydo_cloud_link_device(p_device uuid)
returns void language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'authentication required'; end if;
  if not exists(select 1 from public.mydo_cloud_lists where user_id=u) then raise exception 'sync first'; end if;
  update public.mydo_push_devices set cloud_enabled=true where id=p_device and user_id=u and enabled;
  perform public.mydo_cloud_project(u);
end; $$;
create function public.mydo_cloud_unlink_device(p_device uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  update public.mydo_push_devices set cloud_enabled=false where id=p_device and user_id=auth.uid();
end; $$;

-- A task created from this chat uses the existing signed-in admin UI, never a
-- service key in git. This callable is restricted to server/admin roles.
create function public.mydo_admin_add_task(p_user uuid,p_task jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare state public.mydo_cloud_lists; next_tasks jsonb;
begin
  insert into public.mydo_cloud_lists(user_id) values(p_user) on conflict do nothing;
  select * into state from public.mydo_cloud_lists where user_id=p_user for update;
  if exists(select 1 from jsonb_array_elements(state.tasks) t where t->>'id'=p_task->>'id') then
    if exists(select 1 from jsonb_array_elements(state.tasks) t where t=p_task) then
      return jsonb_build_object('ok',true,'revision',state.revision); end if;
    raise exception 'task id already exists';
  end if;
  next_tasks:=state.tasks||jsonb_build_array(p_task);
  perform public.mydo_validate_cloud(next_tasks);
  update public.mydo_cloud_lists set tasks=next_tasks,revision=revision+1,updated_at=now() where user_id=p_user;
  perform public.mydo_cloud_project(p_user);
  return jsonb_build_object('ok',true,'revision',state.revision+1);
end; $$;

revoke all on function public.mydo_validate_cloud(jsonb),public.mydo_cloud_project(uuid),
 public.mydo_admin_add_task(uuid,jsonb),public.mydo_cloud_read(),public.mydo_cloud_write(bigint,jsonb),
 public.mydo_cloud_link_device(uuid),public.mydo_cloud_unlink_device(uuid) from public,anon,authenticated;
grant execute on function public.mydo_cloud_read(),public.mydo_cloud_write(bigint,jsonb),
 public.mydo_cloud_link_device(uuid),public.mydo_cloud_unlink_device(uuid) to authenticated;
grant execute on function public.mydo_validate_cloud(jsonb),public.mydo_cloud_project(uuid),
 public.mydo_admin_add_task(uuid,jsonb) to service_role;

create or replace function public.mydo_sync_reminders(p_user uuid,p_device uuid,p_subscription jsonb,p_language text,p_tasks jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  -- Linked devices use the canonical cloud list, including tasks added elsewhere.
  if exists(select 1 from public.mydo_push_devices where id=p_device and user_id=p_user and cloud_enabled)
    and exists(select 1 from public.mydo_cloud_lists where user_id=p_user) then
    select coalesce(jsonb_agg(t),'[]'::jsonb) into p_tasks
      from public.mydo_cloud_lists l,jsonb_array_elements(l.tasks) t
      where l.user_id=p_user and not (t->>'done')::boolean
        and ((t->'reminder'->>'onDue')::boolean or (t->'reminder'->>'daily')::boolean);
  end if;
  if exists(select 1 from public.mydo_push_devices where id=p_device and user_id<>p_user) then raise exception 'device owner mismatch'; end if;
  if jsonb_array_length(p_tasks)>100 then raise exception 'too many reminders'; end if;
  insert into public.mydo_push_devices(id,user_id,subscription,language,enabled,synced_at)
  values(p_device,p_user,p_subscription,p_language,true,now())
  on conflict(id) do update set subscription=excluded.subscription,language=excluded.language,enabled=true,synced_at=now();
  insert into public.mydo_reminders(user_id,device_id,task_id,title,due,on_due,daily,start_date,remind_time,time_zone)
  select p_user,p_device,x->>'id',x->>'title',nullif(x->>'due','')::date,
    (x->'reminder'->>'onDue')::boolean,(x->'reminder'->>'daily')::boolean,
    nullif(x->'reminder'->>'start','')::date,(x->'reminder'->>'time')::time,x->'reminder'->>'timeZone'
  from jsonb_array_elements(p_tasks) x
  on conflict(user_id,device_id,task_id) do update set
    title=excluded.title,due=excluded.due,on_due=excluded.on_due,daily=excluded.daily,
    start_date=excluded.start_date,remind_time=excluded.remind_time,time_zone=excluded.time_zone,
    claim_id=null,claim_until=null
  where (mydo_reminders.title,mydo_reminders.due,mydo_reminders.on_due,mydo_reminders.daily,mydo_reminders.start_date,mydo_reminders.remind_time,mydo_reminders.time_zone)
    is distinct from (excluded.title,excluded.due,excluded.on_due,excluded.daily,excluded.start_date,excluded.remind_time,excluded.time_zone);
  delete from public.mydo_reminders r where user_id=p_user and device_id=p_device
    and not exists(select 1 from jsonb_array_elements(p_tasks) x where x->>'id'=r.task_id);
end; $$;

