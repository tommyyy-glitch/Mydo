-- Independent Mydo objects. Does not alter Myfin tables or Auth configuration.
create table public.mydo_push_devices (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription jsonb not null,
  language text not null default 'en' check(language in ('en','zh')),
  enabled boolean not null default true,
  synced_at timestamptz not null default now(),
  test_after timestamptz not null default now(),
  unique(user_id,id)
);
create table public.mydo_reminders (
  user_id uuid not null,
  device_id uuid not null,
  task_id text not null check(length(task_id) between 1 and 100),
  title text not null check(length(title) between 1 and 200),
  due date,
  on_due boolean not null,
  daily boolean not null,
  start_date date,
  remind_time time not null,
  time_zone text not null,
  last_sent_on date,
  claim_id uuid,
  claim_until timestamptz,
  primary key(user_id,device_id,task_id),
  foreign key(user_id,device_id) references public.mydo_push_devices(user_id,id) on delete cascade,
  check(not on_due or due is not null),
  check(not daily or start_date is not null)
);
alter table public.mydo_push_devices enable row level security;
alter table public.mydo_reminders enable row level security;
-- All access goes through the verified and user-scoped Edge Function.
revoke all on public.mydo_push_devices,public.mydo_reminders from anon,authenticated;
grant all on public.mydo_push_devices,public.mydo_reminders to service_role;

create function public.mydo_sync_reminders(p_user uuid,p_device uuid,p_subscription jsonb,p_language text,p_tasks jsonb)
returns void language plpgsql set search_path = '' as $$
begin
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

create function public.mydo_claim_reminders(p_limit int default 10)
returns table(user_id uuid,device_id uuid,task_id text,title text,subscription jsonb,language text,claim_id uuid,local_date date,is_due boolean)
language sql set search_path = '' as $$
  with candidates as (
    select r.user_id,r.device_id,r.task_id
    from public.mydo_reminders r join public.mydo_push_devices d on d.id=r.device_id and d.user_id=r.user_id
    where d.enabled and (r.claim_until is null or r.claim_until<now())
      and r.last_sent_on is distinct from (now() at time zone r.time_zone)::date
      and (now() at time zone r.time_zone)::time >= r.remind_time
      and ((r.on_due and r.due=(now() at time zone r.time_zone)::date)
        or (r.daily and r.start_date<=(now() at time zone r.time_zone)::date))
    order by r.remind_time,r.task_id limit least(greatest(p_limit,1),10)
    for update of r skip locked
  ), claimed as (
    update public.mydo_reminders r set claim_id=gen_random_uuid(),claim_until=now()+interval '5 minutes'
    from candidates c where r.user_id=c.user_id and r.device_id=c.device_id and r.task_id=c.task_id
    returning r.*
  )
  select r.user_id,r.device_id,r.task_id,r.title,d.subscription,d.language,r.claim_id,
    (now() at time zone r.time_zone)::date,
    r.on_due and r.due=(now() at time zone r.time_zone)::date
  from claimed r join public.mydo_push_devices d on d.id=r.device_id and d.user_id=r.user_id;
$$;
create function public.mydo_test_slot(p_user uuid,p_device uuid)
returns boolean language sql set search_path='' as $$
 with updated as (update public.mydo_push_devices set test_after=now()+interval '1 minute'
 where user_id=p_user and id=p_device and enabled and test_after<=now() returning id)
 select exists(select 1 from updated);
$$;
revoke all on function public.mydo_sync_reminders(uuid,uuid,jsonb,text,jsonb) from public,anon,authenticated;
revoke all on function public.mydo_claim_reminders(int) from public,anon,authenticated;
revoke all on function public.mydo_test_slot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mydo_sync_reminders(uuid,uuid,jsonb,text,jsonb) to service_role;
grant execute on function public.mydo_claim_reminders(int) to service_role;
grant execute on function public.mydo_test_slot(uuid,uuid) to service_role;

-- Server-only signing configuration, generated without exporting private keys.
create table public.mydo_push_config (
 id boolean primary key default true check(id),
 cron_secret text not null default (gen_random_uuid()::text || gen_random_uuid()::text),
 vapid jsonb
);
alter table public.mydo_push_config enable row level security;
revoke all on public.mydo_push_config from public,anon,authenticated;
grant all on public.mydo_push_config to service_role;
insert into public.mydo_push_config(id) values(true);
