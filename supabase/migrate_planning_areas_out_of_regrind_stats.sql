begin;

-- Only correct regrind statistics flags set by the earlier planning migration.
-- Keep inventory visibility, activity, locations and all recorded data unchanged.
update public.warehouses
set include_in_stats = false
where id in ('bakoma', 'lakiernia')
  and include_in_stats is distinct from false;

commit;
