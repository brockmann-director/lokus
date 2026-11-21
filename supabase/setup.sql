-- Lokus – gemeinsame Bewertungen, Notizen und Favoriten der Familie
-- Einmal komplett im SQL Editor des Supabase-Projekts ausführen (läuft im selben Projekt wie
-- NephroWoche, alle Tabellen beginnen mit lk_). Das Skript kann gefahrlos mehrfach laufen.
-- Ganz unten steht danach der Einladungs-Code für die Familie.

create table if not exists lk_invites (
  code text primary key default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  created_at timestamptz not null default now()
);

create table if not exists lk_members (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);

-- place = OSM-Kennung, z. B. 'n123456' (Punkt) oder 'w987' (Fläche)
create table if not exists lk_ratings (
  member_id uuid not null references lk_members(id) on delete cascade,
  place text not null,
  stars smallint check (stars between 1 and 5),
  note text not null default '',
  place_name text not null default '',
  lat double precision, lon double precision,
  updated_at timestamptz not null default now(),
  primary key (member_id, place)
);

create table if not exists lk_favs (
  member_id uuid not null references lk_members(id) on delete cascade,
  place text not null,
  place_name text not null default '',
  lat double precision, lon double precision,
  kind text not null default '',
  created_at timestamptz not null default now(),
  primary key (member_id, place)
);

-- „Gibt's nicht mehr“: blendet eine Toilette für alle aus
create table if not exists lk_gone (
  member_id uuid not null references lk_members(id) on delete cascade,
  place text not null,
  created_at timestamptz not null default now(),
  primary key (member_id, place)
);

create table if not exists lk_wishes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references lk_members(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

alter table lk_invites enable row level security;
alter table lk_members enable row level security;
alter table lk_ratings enable row level security;
alter table lk_favs    enable row level security;
alter table lk_gone    enable row level security;
alter table lk_wishes  enable row level security;
revoke all on lk_invites, lk_members, lk_ratings, lk_favs, lk_gone, lk_wishes from anon, authenticated;
grant all on lk_invites, lk_members, lk_ratings, lk_favs, lk_gone, lk_wishes to service_role;

-- ---------- Funktionen (nur diese sind von außen erreichbar) ----------
create or replace function lk_who(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from lk_members where token = p_token;
  if v is null then raise exception 'Ungültiger Link'; end if;
  return v;
end $$;

-- Mit dem Familien-Code beitreten; liefert den persönlichen Schlüssel
create or replace function lk_join(p_code text, p_name text) returns json
language plpgsql security definer set search_path = public as $$
declare n text := left(trim(p_name), 30); t text;
begin
  if not exists (select 1 from lk_invites where code = p_code) then raise exception 'Einladung ungültig'; end if;
  if length(n) < 2 then raise exception 'Bitte einen Namen eingeben'; end if;
  if exists (select 1 from lk_members where lower(name) = lower(n)) then
    raise exception 'Den Namen gibt es schon. Nimm z. B. „% B.“', n;
  end if;
  insert into lk_members(name) values (n) returning token into t;
  return json_build_object('token', t, 'name', n);
end $$;

-- Alles für die App in einem Rutsch (die Gruppe ist klein)
create or replace function lk_all(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare r uuid := lk_who(p_token);
begin
  return json_build_object(
    'me', (select name from lk_members where id = r),
    'ratings', coalesce((select json_agg(json_build_object('place', x.place, 'who', m.name, 'mine', x.member_id = r,
        'stars', x.stars, 'note', x.note, 'name', x.place_name, 'lat', x.lat, 'lon', x.lon, 'at', x.updated_at) order by x.updated_at desc)
      from lk_ratings x join lk_members m on m.id = x.member_id), '[]'),
    'favs', coalesce((select json_agg(json_build_object('place', f.place, 'name', f.place_name, 'lat', f.lat, 'lon', f.lon, 'kind', f.kind))
      from lk_favs f where f.member_id = r), '[]'),
    'gone', coalesce((select json_agg(json_build_object('place', g.place, 'who', m.name, 'mine', g.member_id = r))
      from lk_gone g join lk_members m on m.id = g.member_id), '[]'));
end $$;

create or replace function lk_rate(p_token text, p_place text, p_stars int, p_note text,
  p_name text, p_lat double precision, p_lon double precision) returns void
language plpgsql security definer set search_path = public as $$
declare r uuid := lk_who(p_token);
begin
  if p_stars is null and coalesce(trim(p_note), '') = '' then
    delete from lk_ratings where member_id = r and place = p_place; return;
  end if;
  insert into lk_ratings(member_id, place, stars, note, place_name, lat, lon)
  values (r, p_place, p_stars, left(coalesce(trim(p_note), ''), 500), left(coalesce(p_name, ''), 80), p_lat, p_lon)
  on conflict (member_id, place) do update set stars = excluded.stars, note = excluded.note,
    place_name = excluded.place_name, lat = excluded.lat, lon = excluded.lon, updated_at = now();
end $$;

create or replace function lk_fav(p_token text, p_place text, p_on boolean,
  p_name text, p_lat double precision, p_lon double precision, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare r uuid := lk_who(p_token);
begin
  if p_on then
    insert into lk_favs(member_id, place, place_name, lat, lon, kind)
    values (r, p_place, left(coalesce(p_name, ''), 80), p_lat, p_lon, left(coalesce(p_kind, ''), 20))
    on conflict (member_id, place) do nothing;
  else
    delete from lk_favs where member_id = r and place = p_place;
  end if;
end $$;

create or replace function lk_set_gone(p_token text, p_place text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r uuid := lk_who(p_token);
begin
  if p_on then insert into lk_gone(member_id, place) values (r, p_place) on conflict do nothing;
  else delete from lk_gone where place = p_place; end if;
end $$;

create or replace function lk_wish(p_token text, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare r uuid := lk_who(p_token);
begin
  if length(trim(p_text)) between 3 and 2000 then insert into lk_wishes(member_id, text) values (r, trim(p_text)); end if;
end $$;

revoke all on function lk_who(text) from public, anon, authenticated;
grant execute on function lk_join(text, text), lk_all(text),
  lk_rate(text, text, int, text, text, double precision, double precision),
  lk_fav(text, text, boolean, text, double precision, double precision, text),
  lk_set_gone(text, text, boolean), lk_wish(text, text) to anon, authenticated;

-- ---------- Einladung ----------
do $$ begin
  if not exists (select 1 from lk_invites) then insert into lk_invites default values; end if;
end $$;
-- Dieser Code kommt in den Familien-Link:  https://lokus.thisisjan.com/?einladung=CODE
select code as einladungs_code from lk_invites;

-- Wünsche der Familie ansehen:
-- select m.name, w.text, w.created_at from lk_wishes w join lk_members m on m.id = w.member_id order by w.created_at desc;
