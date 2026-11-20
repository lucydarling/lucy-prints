-- Photo Lab usage summary (table photo_lab_events, migration 018).
-- Run in the Supabase SQL editor. Every query excludes @lucydarling.com sessions.
-- Downloads are counted from the rows (one zip_downloaded row = one ZIP),
-- never from props.download_number (a per-browser convenience).
-- Events exist only from the day migration 018 went live (2026-11-20).

-- 1. ZIP downloads per week
select date_trunc('week', e.created_at)::date as week,
       count(*)                       as downloads,
       count(distinct e.session_id)   as sessions_downloading
from photo_lab_events e
join sessions s on s.id = e.session_id
where e.event = 'zip_downloaded' and s.email not ilike '%@lucydarling.com'
group by 1 order by 1;

-- 2. % of saved sessions (created since events began) that downloaded at least once
with cohort as (
  select s.id from sessions s
  where s.created_at >= '2026-11-20' and s.email not ilike '%@lucydarling.com'
)
select count(*)                                                       as saved_sessions,
       count(*) filter (where exists (
         select 1 from photo_lab_events e where e.session_id = c.id and e.event = 'zip_downloaded')) as downloaded,
       round(100.0 * count(*) filter (where exists (
         select 1 from photo_lab_events e where e.session_id = c.id and e.event = 'zip_downloaded'))
         / nullif(count(*), 0), 1)                                    as pct_downloaded
from cohort c;

-- 3. Downloads by print option (and book)
select e.props->>'book_product' as book, e.props->>'print_option' as print_option, count(*) as downloads
from photo_lab_events e
join sessions s on s.id = e.session_id
where e.event = 'zip_downloaded' and s.email not ilike '%@lucydarling.com'
group by 1, 2 order by downloads desc;

-- 4. New sessions by source
select coalesce(e.props->>'utm_source', e.props->>'referrer_host', '(direct / none)') as source,
       e.props->>'utm_medium' as medium,
       count(*) as sessions
from photo_lab_events e
join sessions s on s.id = e.session_id
where e.event = 'session_started' and s.email not ilike '%@lucydarling.com'
group by 1, 2 order by sessions desc;
