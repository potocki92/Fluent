-- Fluent — the four daily-review columns that never had an upgrade path.
--
-- THE BUG. `daily_word_goal`, `word_streak_days`, `words_reviewed_today` and
-- `last_word_review` arrived with the daily-goal feature and were declared in
-- exactly one place: inside
--
--     create table if not exists public.profiles ( … );
--
-- On a database where `profiles` already existed — i.e. every project
-- provisioned before that feature — the CREATE is skipped in its entirety and
-- the columns are simply never added. Re-running `schema.sql` does not help,
-- because `schema.sql` is where the omission lives. Every other later addition
-- (`profiles.promotion_streak`, `attempts.response_ms`, the `words.*`
-- enrichment) carries an `add column if not exists` in the "MIGRATIONS for
-- already-provisioned databases" section; these four were forgotten.
--
-- WHY IT SURFACED NOW, AND NOT A YEAR AGO. The daily counter used to be a
-- separate call the review path made and then ignored:
--
--     const { data: count } = await supabase.rpc("bump_word_review");
--
-- `error` was destructured away, so on an affected database the counter failed
-- silently on every review for months. The card still got scheduled; the goal
-- ring just sat at zero.
--
-- The learning-engine work then folded that counter into `apply_review`, where
-- it belongs — one educational interaction, one transaction. That is the right
-- design, and it converted a silent, invisible schema gap into a hard failure:
-- `apply_word_review_counter` raises 42703, the whole transaction rolls back,
-- and grading a card returns "Coś poszło nie tak". Nothing about the review
-- logic was wrong; it simply stopped tolerating a broken schema, which is what
-- a transaction is for.
--
-- Defaults match the CREATE TABLE exactly, so a fresh install and an upgraded
-- one are indistinguishable afterwards — which `supabase/tests/run.sh` now
-- asserts directly rather than leaving to inspection.

alter table public.profiles add column if not exists daily_word_goal      int  not null default 20;
alter table public.profiles add column if not exists word_streak_days     int  not null default 0;
alter table public.profiles add column if not exists words_reviewed_today int  not null default 0;
alter table public.profiles add column if not exists last_word_review     date;
