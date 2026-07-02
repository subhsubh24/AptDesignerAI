-- 028: handle_new_user() must NEVER be able to block account creation.
--
-- Real outage (2026-07-02): the on_auth_user_created trigger's insert into
-- public.profiles threw in prod (RLS/drift), which rolled back the auth.users
-- insert — so NEITHER the app signup NOR the Supabase dashboard "Add user" could
-- create ANY account. A non-essential side effect (creating the profile row) was
-- allowed to hard-block the core action (creating the account). It surfaced only
-- as a generic "Something went wrong."
--
-- Fix: wrap the profile insert so a failure is logged (raise warning) and
-- swallowed. The user is still created; the profile can be backfilled. Keeps the
-- 024 hardening (search_path = '') and the fully-qualified insert.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.profiles (id, full_name, avatar_url)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
      new.raw_user_meta_data ->> 'avatar_url'
    );
  exception when others then
    -- Never let a profile-insert problem abort account creation. Log loudly (§28)
    -- so the underlying issue still gets fixed; degrade the SIDE EFFECT, not the CORE.
    raise warning 'handle_new_user: profile insert failed for % (%): %', new.id, sqlstate, sqlerrm;
  end;
  return new;
end;
$$;
