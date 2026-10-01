-- Run after the migration in the same transaction, then ROLLBACK.
do $$
declare u uuid; device public.mydo_push_devices; result jsonb; a jsonb; b jsonb;
begin
  select * into device from public.mydo_push_devices limit 1;
  u:=device.user_id;
  if u is null then raise exception 'Need an existing Mydo device for this rollback test'; end if;
  perform set_config('request.jwt.claim.sub',u::text,true);
  a := jsonb_build_object('id','qa-cloud-a','title','Cloud sync QA','project','QA','notes','',
    'intent','must','urgent',false,'done',false,'due','','deps','[]'::jsonb,'created',now()::text,
    'reminder',jsonb_build_object('onDue',false,'daily',true,'start',(current_date+1)::text,'time','09:00','timeZone','Asia/Hong_Kong'));
  b := a||'{"id":"qa-cloud-b","deps":["qa-cloud-a"]}'::jsonb;
  result:=public.mydo_cloud_write(0,jsonb_build_array(a,b));
  if not (result->>'ok')::boolean then raise exception 'CAS initial write'; end if;
  result:=public.mydo_cloud_write(0,'[]'::jsonb);
  if (result->>'ok')::boolean then raise exception 'stale CAS accepted'; end if;
  if jsonb_array_length(public.mydo_cloud_read()->'tasks')<>2 then raise exception 'stale CAS erased tasks'; end if;
  perform public.mydo_cloud_link_device(device.id);
  if not exists(select 1 from public.mydo_reminders where device_id=device.id and task_id='qa-cloud-a') then
    raise exception 'cloud task did not schedule a phone reminder'; end if;
  perform public.mydo_sync_reminders(u,device.id,device.subscription,device.language,'[]'::jsonb);
  if not exists(select 1 from public.mydo_reminders where device_id=device.id and task_id='qa-cloud-a') then
    raise exception 'stale phone sync erased cloud reminder'; end if;
  perform public.mydo_cloud_write(1,jsonb_build_array(a||'{"done":true}'::jsonb,b||'{"done":true}'::jsonb));
  if exists(select 1 from public.mydo_reminders where device_id=device.id and task_id like 'qa-cloud-%') then
    raise exception 'cloud completion did not cancel phone reminders'; end if;
  begin
    perform public.mydo_validate_cloud(jsonb_build_array(a||'{"deps":["qa-cloud-b"]}'::jsonb,b));
    raise exception 'cycle accepted';
  exception when others then if sqlerrm='cycle accepted' then raise; end if; end;
  begin
    perform public.mydo_validate_cloud(jsonb_build_array(b));
    raise exception 'missing dependency accepted';
  exception when others then if sqlerrm='missing dependency accepted' then raise; end if; end;
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
  if jsonb_array_length(public.mydo_cloud_read()->'tasks')<>0 then raise exception 'other user read tasks'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform public.mydo_cloud_read(); raise exception 'anonymous read accepted';
  exception when others then if sqlerrm='anonymous read accepted' then raise; end if; end;
  if has_table_privilege('authenticated','public.mydo_cloud_lists','SELECT')
    or has_function_privilege('anon','public.mydo_cloud_read()','EXECUTE')
    or has_function_privilege('authenticated','public.mydo_admin_add_task(uuid,jsonb)','EXECUTE')
    then raise exception 'unexpected privileges'; end if;
end $$;
select 'cloud database tests passed; all QA changes rolled back' as result;
