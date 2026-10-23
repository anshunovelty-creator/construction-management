-- App users. Logins live in Supabase Auth (email + password, created by the owner);
-- profiles hold the role, language and assignments.

create type app_role as enum ('owner', 'office', 'supervisor');
create type app_language as enum ('en', 'hi');

create table profiles (
  user_id uuid primary key references auth.users (id),
  email text not null unique check (btrim(email) <> ''),
  full_name text not null check (btrim(full_name) <> ''),
  role app_role not null,
  language app_language not null default 'en',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Office staff work for assigned firms; supervisors work at assigned sites. The owner sees everything.
create table user_firms (
  user_id uuid not null references profiles (user_id),
  firm_id uuid not null references firms (id),
  primary key (user_id, firm_id)
);

create table user_sites (
  user_id uuid not null references profiles (user_id),
  site_id uuid not null references sites (id),
  primary key (user_id, site_id)
);

alter table money_accounts
  add constraint money_accounts_holder_fk foreign key (holder_user_id) references profiles (user_id);

-- Role of the signed-in user; null when signed out or deactivated.
create function app_my_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where user_id = auth.uid() and is_active
$$;

create function app_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_my_role() = 'owner', false)
$$;

-- Owner: every firm. Office: assigned firms. Supervisor: none.
create function app_has_firm(p_firm_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case app_my_role()
    when 'owner' then true
    when 'office' then exists (select 1 from user_firms where user_id = auth.uid() and firm_id = p_firm_id)
    else false
  end
$$;

-- Owner and office: every site. Supervisor: assigned sites.
create function app_has_site(p_site_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case app_my_role()
    when 'owner' then true
    when 'office' then true
    when 'supervisor' then exists (select 1 from user_sites where user_id = auth.uid() and site_id = p_site_id)
    else false
  end
$$;

-- Users choose their own language; everything else on a profile is changed by the owner.
create function app_set_my_language(p_language app_language) returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set language = p_language where user_id = auth.uid() and is_active;
  if not found then
    raise exception 'not signed in, or this account is deactivated';
  end if;
end $$;
