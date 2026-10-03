create type app_role as enum ('admin','user');
create type post_status as enum ('draft','published');
create type notification_type as enum ('post_published','game_published','new_message','system');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  role app_role not null default 'user',
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name, avatar_url) values (
    new.id,
    coalesce(new.raw_user_meta_data->>'user_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1), 'user'),
    new.raw_user_meta_data->>'avatar_url');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create function public.protect_role() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and new.role <> old.role and not is_admin() then new.role := old.role; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger profiles_protect_role before update on profiles for each row execute function protect_role();

create table posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  body text not null check (length(trim(body)) > 0),
  banner_path text not null,
  status post_status not null default 'draft',
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  is_group boolean not null default false,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table conversation_members (
  conversation_id uuid references conversations(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index messages_conv_created on messages (conversation_id, created_at);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type notification_type not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_created on notifications (user_id, created_at desc);
create index notifications_unread on notifications (user_id) where read_at is null;

create function public.is_member(conv uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversation_members where conversation_id = conv and user_id = auth.uid());
$$;

-- publishing a post notifies everyone who allows notifications
create function public.on_post_publish() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    new.published_at := now();
  end if;
  return new;
end $$;
create trigger posts_publish_stamp before insert or update on posts for each row execute function on_post_publish();

create function public.notify_post() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status <> 'published') then
    insert into notifications (user_id, type, title, body, entity_type, entity_id)
    select id, 'post_published', new.title, left(new.body, 140), 'post', new.id
    from profiles where notifications_enabled and id <> new.created_by;
  end if;
  return null;
end $$;
create trigger posts_notify after insert or update on posts for each row execute function notify_post();

create function public.notify_message() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, type, title, body, entity_type, entity_id)
  select p.id, 'new_message', (select display_name from profiles where id = new.sender_id), left(new.body, 140), 'conversation', new.conversation_id
  from conversation_members m join profiles p on p.id = m.user_id
  where m.conversation_id = new.conversation_id and m.user_id <> new.sender_id and p.notifications_enabled;
  update conversations set updated_at = now() where id = new.conversation_id;
  return null;
end $$;
create trigger messages_notify after insert on messages for each row execute function notify_message();

-- find or create a 1:1 conversation with another user
create function public.start_conversation(other uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if auth.uid() is null or other = auth.uid() then raise exception 'invalid'; end if;
  select c.id into cid from conversations c
   where not c.is_group
     and (select count(*) from conversation_members where conversation_id = c.id) = 2
     and exists (select 1 from conversation_members where conversation_id = c.id and user_id = auth.uid())
     and exists (select 1 from conversation_members where conversation_id = c.id and user_id = other)
   limit 1;
  if cid is null then
    insert into conversations (created_by) values (auth.uid()) returning id into cid;
    insert into conversation_members values (cid, auth.uid(), now()), (cid, other, now());
  end if;
  return cid;
end $$;

alter table profiles enable row level security;
alter table posts enable row level security;
alter table conversations enable row level security;
alter table conversation_members enable row level security;
alter table messages enable row level security;
alter table notifications enable row level security;

create policy "profiles read" on profiles for select to authenticated using (true);
create policy "profiles update own" on profiles for update to authenticated using (id = auth.uid() or is_admin()) with check (id = auth.uid() or is_admin());
create policy "posts read" on posts for select to authenticated using (status = 'published' or is_admin());
create policy "posts admin write" on posts for all to authenticated using (is_admin()) with check (is_admin() and created_by = auth.uid());
create policy "conversations read" on conversations for select to authenticated using (is_member(id));
create policy "members read" on conversation_members for select to authenticated using (is_member(conversation_id));
create policy "messages read" on messages for select to authenticated using (is_member(conversation_id));
create policy "messages send" on messages for insert to authenticated with check (sender_id = auth.uid() and is_member(conversation_id));
create policy "notifications own" on notifications for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter publication supabase_realtime add table messages, notifications;

insert into storage.buckets (id, name, public) values ('post-banners', 'post-banners', true) on conflict do nothing;
create policy "banners admin write" on storage.objects for insert to authenticated with check (bucket_id = 'post-banners' and public.is_admin());
create policy "banners admin update" on storage.objects for update to authenticated using (bucket_id = 'post-banners' and public.is_admin());
create policy "banners admin delete" on storage.objects for delete to authenticated using (bucket_id = 'post-banners' and public.is_admin());
