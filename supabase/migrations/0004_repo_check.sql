-- GitHub repo guideline checks (Hackurity 2026 Submission Guidelines, section 3)
create extension if not exists http with schema extensions;

alter table settings add column coding_window_opens_at timestamptz;
alter table settings add column coding_window_closes_at timestamptz;

alter table teams add column repo_check jsonb;
alter table teams add column repo_checked_at timestamptz;

-- GitHub token, readable only by security-definer functions owned by the
-- migration role (RLS enabled, no policies => denied to anon/authenticated).
create table app_secrets (
  key text primary key,
  value text not null
);
alter table app_secrets enable row level security;
revoke all on app_secrets from public, anon, authenticated;

create or replace function check_team_repo(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token text;
  v_team teams;
  v_url text;
  v_owner text; v_repo text; v_branch text;
  v_resp extensions.http_response;
  v_repo_json jsonb;
  v_public boolean;
  v_created_at timestamptz;
  v_readme_json jsonb;
  v_readme_content text;
  v_line text;
  v_headings_found text[] := '{}';
  v_heading text;
  v_headings text[] := array['Problem','What it does','Architecture','How to run it','How to run the demo','Tech stack','Team members'];
  v_commits_json jsonb;
  v_commit_dates timestamptz[];
  v_earliest timestamptz; v_latest timestamptz;
  v_tags_json jsonb;
  v_has_tag boolean := false;
  v_has_license boolean := false;
  v_tree_json jsonb;
  v_has_dotenv boolean := false;
  v_opens timestamptz; v_closes timestamptz;
  v_result jsonb;
  v_auth_headers extensions.http_header[];
begin
  if not is_admin() then raise exception 'admins only'; end if;

  select * into v_team from teams where id = p_team;
  if v_team.id is null then raise exception 'team not found'; end if;

  select value into v_token from app_secrets where key = 'github_token';
  v_url := v_team.repo_url;

  if v_token is null then
    v_result := jsonb_build_object('error', 'no github_token configured in app_secrets');
  elsif v_url is null or trim(v_url) = '' then
    v_result := jsonb_build_object('error', 'no repo_url set for this team');
  else
    select m[1], m[2] into v_owner, v_repo
      from regexp_matches(v_url, 'github\.com[:/]+([^/]+)/([^/.]+)') m;
    if v_owner is null or v_repo is null then
      v_result := jsonb_build_object('error', 'repo_url is not a recognizable github.com URL', 'repo_url', v_url);
    else
      select coding_window_opens_at, coding_window_closes_at into v_opens, v_closes from settings where id = 1;
      v_auth_headers := ARRAY[
        extensions.http_header('Authorization', 'token ' || v_token),
        extensions.http_header('User-Agent', 'hackurity-portal')
      ]::extensions.http_header[];

      begin
        select * into v_resp from extensions.http(
          ('GET', format('https://api.github.com/repos/%s/%s', v_owner, v_repo), v_auth_headers, NULL, NULL)::extensions.http_request
        );

        if v_resp.status = 404 then
          v_result := jsonb_build_object('error', 'repo not found or private', 'status', v_resp.status);
        elsif v_resp.status <> 200 then
          v_result := jsonb_build_object('error', 'github api error', 'status', v_resp.status);
        else
      v_repo_json := v_resp.content::jsonb;
      v_public := not coalesce((v_repo_json->>'private')::boolean, true);
      v_created_at := (v_repo_json->>'created_at')::timestamptz;
      v_branch := coalesce(v_repo_json->>'default_branch', 'main');

      select * into v_resp from extensions.http(
        ('GET', format('https://api.github.com/repos/%s/%s/readme', v_owner, v_repo), v_auth_headers, NULL, NULL)::extensions.http_request
      );
      if v_resp.status = 200 then
        v_readme_json := v_resp.content::jsonb;
        v_readme_content := convert_from(decode(replace(coalesce(v_readme_json->>'content', ''), E'\n', ''), 'base64'), 'UTF8');
        for v_line in select regexp_split_to_table(v_readme_content, E'\n') loop
          if v_line ~ '^\s*#{1,6}\s' then
            foreach v_heading in array v_headings loop
              if v_line ~* v_heading and not (v_heading = any(v_headings_found)) then
                v_headings_found := array_append(v_headings_found, v_heading);
              end if;
            end loop;
          end if;
        end loop;
      end if;

      select * into v_resp from extensions.http(
        ('GET', format('https://api.github.com/repos/%s/%s/commits?per_page=100', v_owner, v_repo), v_auth_headers, NULL, NULL)::extensions.http_request
      );
      if v_resp.status = 200 then
        v_commits_json := v_resp.content::jsonb;
        select array_agg((c->'commit'->'author'->>'date')::timestamptz) into v_commit_dates
          from jsonb_array_elements(v_commits_json) c;
        if v_commit_dates is not null and array_length(v_commit_dates, 1) > 0 then
          select min(x), max(x) into v_earliest, v_latest from unnest(v_commit_dates) x;
        end if;
      end if;

      select * into v_resp from extensions.http(
        ('GET', format('https://api.github.com/repos/%s/%s/tags?per_page=100', v_owner, v_repo), v_auth_headers, NULL, NULL)::extensions.http_request
      );
      if v_resp.status = 200 then
        v_tags_json := v_resp.content::jsonb;
        select exists(select 1 from jsonb_array_elements(v_tags_json) t where t->>'name' = 'submission') into v_has_tag;
      end if;

      select * into v_resp from extensions.http(
        ('GET', format('https://api.github.com/repos/%s/%s/license', v_owner, v_repo), v_auth_headers, NULL, NULL)::extensions.http_request
      );
      v_has_license := (v_resp.status = 200);

      select * into v_resp from extensions.http(
        ('GET', format('https://api.github.com/repos/%s/%s/git/trees/%s?recursive=1', v_owner, v_repo, v_branch), v_auth_headers, NULL, NULL)::extensions.http_request
      );
      if v_resp.status = 200 then
        v_tree_json := v_resp.content::jsonb;
        select exists(select 1 from jsonb_array_elements(v_tree_json->'tree') f where f->>'path' ~ '(^|/)\.env$') into v_has_dotenv;
      end if;

      v_result := jsonb_build_object(
        'public', v_public,
        'created_at', v_created_at,
        'created_after_window', case when v_opens is null then null else v_created_at >= v_opens end,
        'commits_earliest', v_earliest,
        'commits_latest', v_latest,
        'commits_in_window', case when v_opens is null or v_closes is null or v_earliest is null then null
          else (v_earliest >= v_opens and v_latest <= v_closes) end,
        'has_submission_tag', v_has_tag,
        'readme_headings_found', to_jsonb(v_headings_found),
        'readme_headings_missing', to_jsonb(array(select unnest(v_headings) except select unnest(v_headings_found))),
        'has_license', v_has_license,
        'has_committed_dotenv', v_has_dotenv
      );
        end if;
      exception when others then
        v_result := jsonb_build_object('error', sqlerrm);
      end;
    end if;
  end if;

  v_result := v_result || jsonb_build_object('checked_at', now());
  update teams set repo_check = v_result, repo_checked_at = now() where id = p_team;
  return v_result;
end $$;

revoke all on function check_team_repo(uuid) from public;
grant execute on function check_team_repo(uuid) to authenticated;
