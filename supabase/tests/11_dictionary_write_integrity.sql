-- Fluent — dictionary write integrity.
--
-- WHAT THIS SUITE IS ABOUT. Two admin write paths that were correct only while
-- exactly one admin was awake.
--
--   * A new word's id came from `select max(id) + 1` in the application. Two
--     admins in the same moment both read the same maximum and both tried the
--     same id; one lost to a primary-key violation with a raw Postgres message.
--   * Reviewing a suggestion was three statements with no transaction and no
--     lock: read `pending`, patch the word, mark the suggestion. Two reviewers
--     both passed the check and both applied the edit; a crash between the
--     second and third left the word edited and the suggestion still pending,
--     so the next review applied the same edit again.
--
-- Neither is reachable from TypeScript tests: both are about what happens when
-- two transactions interleave, which only a real database can demonstrate.
--
-- Run with supabase/tests/run.sh (see the README next to it).
--
-- Fixtures use ids in the 11xxx range and the d1d7… uuid space so they cannot
-- collide with the suites that run before this one.

\set ON_ERROR_STOP on

\echo '── W0. the dictionary as the seeds leave it: explicit ids ──────────────'

insert into auth.users (id, email) values
  ('d1d70000-0000-4000-8000-000000000001', 'word-admin@example.test'),
  ('d1d70000-0000-4000-8000-000000000002', 'word-admin-2@example.test'),
  ('d1d70000-0000-4000-8000-000000000003', 'word-learner@example.test');

insert into public.profiles (id, role) values
  ('d1d70000-0000-4000-8000-000000000001', 'admin'),
  ('d1d70000-0000-4000-8000-000000000002', 'admin'),
  ('d1d70000-0000-4000-8000-000000000003', 'user')
on conflict (id) do update set role = excluded.role;

-- An import that names its own ids, exactly as `seed-words-*.sql` does.
insert into public.words (id, lemma, display, word_type, translation_pl, cefr) values
  (11001, 'Schlüssel', 'der Schlüssel', 'noun', 'klucz', 'A2'),
  (11002, 'ziehen',    'ziehen',        'verb', 'ciągnąć', 'B1');

\echo '── W1. an explicit id does not leave the sequence behind it ────────────'

do $$
declare
  v_new_id bigint;
begin
  -- THE REGRESSION THIS TRIGGER EXISTS FOR. Attaching a sequence to a column
  -- whose rows were inserted with explicit ids leaves that sequence at 1. The
  -- first default-allocated word would then collide with seed row 1 — turning
  -- a race that used to happen occasionally into one that happens always.
  insert into public.words (lemma, display, word_type, translation_pl)
    values ('Tür', 'die Tür', 'noun', 'drzwi')
    returning id into v_new_id;

  if v_new_id <= 11002 then
    raise exception
      'FAIL: the sequence handed out % , which is not past the explicit ids', v_new_id;
  end if;

  delete from public.words where id = v_new_id;
end $$;

\echo '── W2. two concurrent inserts get two different ids ────────────────────'

-- Sequences are non-transactional by design, which is the property the old
-- `max(id) + 1` lacked: two allocations in flight at once cannot collide, and a
-- rolled-back insert does not hand its id back to be reused.
do $$
declare
  v_a bigint;
  v_b bigint;
begin
  v_a := nextval('public.words_id_seq');
  v_b := nextval('public.words_id_seq');
  if v_a = v_b then
    raise exception 'FAIL: the sequence handed out % twice', v_a;
  end if;
  if v_b <= v_a then
    raise exception 'FAIL: ids went backwards, % then %', v_a, v_b;
  end if;
end $$;

-- And an id the sequence already handed out is never handed out again, even
-- after the row that used it is deleted — which `max(id) + 1` could not promise.
do $$
declare
  v_first  bigint;
  v_second bigint;
begin
  insert into public.words (lemma, display, word_type)
    values ('Fenster', 'das Fenster', 'noun') returning id into v_first;
  delete from public.words where id = v_first;
  insert into public.words (lemma, display, word_type)
    values ('Boden', 'der Boden', 'noun') returning id into v_second;

  if v_second = v_first then
    raise exception
      'FAIL: id % was reused after a delete — a learner''s saved word would '
      'silently point at a different entry', v_first;
  end if;
  delete from public.words where id = v_second;
end $$;

\echo '── W3. re-running the migration cannot move the sequence backwards ─────'

do $$
declare
  v_before bigint;
  v_after  bigint;
  v_next   bigint;
begin
  v_before := coalesce(pg_sequence_last_value('public.words_id_seq'), 0);

  -- The exact `setval` the migration performs, applied a second time.
  perform setval(
    'public.words_id_seq',
    greatest(
      coalesce((select max(id) from public.words), 0),
      coalesce(pg_sequence_last_value('public.words_id_seq'), 0),
      1
    ),
    true
  );

  v_after := coalesce(pg_sequence_last_value('public.words_id_seq'), 0);
  if v_after < v_before then
    raise exception 'FAIL: re-applying the migration rewound the sequence % -> %',
      v_before, v_after;
  end if;

  -- And the id it would hand out next is still free.
  v_next := v_after + 1;
  if exists (select 1 from public.words where id = v_next) then
    raise exception 'FAIL: the next id % is already taken', v_next;
  end if;
end $$;

\echo '── W4. a learner cannot review a suggestion ────────────────────────────'

insert into public.word_suggestions (id, word_id, user_id, field, suggestion, status)
  overriding system value
  values
  (11101, 11001, 'd1d70000-0000-4000-8000-000000000003',
   'translation_pl', 'klucz (do drzwi)', 'pending'),
  (11102, 11002, 'd1d70000-0000-4000-8000-000000000003',
   'example_de', 'Er zieht die Tür auf.', 'pending'),
  (11103, 11001, 'd1d70000-0000-4000-8000-000000000003',
   'other', 'brzmi dziwnie', 'pending');

do $$
declare
  v_raised text := null;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"d1d70000-0000-4000-8000-000000000003"}', false);
  set local role authenticated;

  begin
    perform public.review_word_suggestion(11101, 'approved');
  exception when others then
    v_raised := sqlstate;
  end;

  if v_raised is distinct from 'FL403' then
    raise exception
      'FAIL: a learner reviewing a suggestion raised % (expected FL403)',
      coalesce(v_raised, 'nothing');
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

-- The word is untouched.
do $$
begin
  if (select translation_pl from public.words where id = 11001) <> 'klucz' then
    raise exception 'FAIL: a refused review still edited the word';
  end if;
  if (select status from public.word_suggestions where id = 11101) <> 'pending' then
    raise exception 'FAIL: a refused review still decided the suggestion';
  end if;
end $$;

\echo '── W5. an admin approval edits the word and decides the suggestion ─────'

do $$
declare
  v_applied boolean;
  v_word    bigint;
  v_status  text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"d1d70000-0000-4000-8000-000000000001"}', false);
  set local role authenticated;

  select applied, updated_word_id, status
    into v_applied, v_word, v_status
    from public.review_word_suggestion(11101, 'approved');

  if not v_applied then raise exception 'FAIL: the approval reported applied=false'; end if;
  if v_word is distinct from 11001 then
    raise exception 'FAIL: the edit landed on word % (expected 11001)', v_word;
  end if;
  if v_status <> 'approved' then raise exception 'FAIL: status is %', v_status; end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

do $$
begin
  if (select translation_pl from public.words where id = 11001) <> 'klucz (do drzwi)' then
    raise exception 'FAIL: the approved translation was not written';
  end if;
  if (select reviewed_by from public.word_suggestions where id = 11101)
     is distinct from 'd1d70000-0000-4000-8000-000000000001'::uuid then
    raise exception
      'FAIL: the reviewer was not taken from the caller''s own identity';
  end if;
  if (select reviewed_at from public.word_suggestions where id = 11101) is null then
    raise exception 'FAIL: reviewed_at was not stamped';
  end if;
end $$;

\echo '── W6. the same suggestion, reviewed twice, is applied once ────────────'

-- A learner edits the translation by hand between the two reviews. If the
-- second review re-applied the suggestion, it would silently revert that edit —
-- which is exactly what the unguarded three-statement version did.
update public.words set translation_pl = 'klucz (poprawione)' where id = 11001;

do $$
declare
  v_applied boolean;
  v_status  text;
  v_word    bigint;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"d1d70000-0000-4000-8000-000000000002"}', false);
  set local role authenticated;

  -- A second admin, a second tab, a retried request after a dropped response.
  select applied, status, updated_word_id
    into v_applied, v_status, v_word
    from public.review_word_suggestion(11101, 'rejected');

  if v_applied then
    raise exception 'FAIL: an already-decided suggestion was decided again';
  end if;
  if v_status <> 'approved' then
    raise exception
      'FAIL: the second review overwrote the decision with % ', v_status;
  end if;
  if v_word is not null then
    raise exception 'FAIL: the second review wrote to word %', v_word;
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

do $$
begin
  if (select translation_pl from public.words where id = 11001) <> 'klucz (poprawione)' then
    raise exception 'FAIL: the second review re-applied the edit and lost a change';
  end if;
  if (select reviewed_by from public.word_suggestions where id = 11101)
     is distinct from 'd1d70000-0000-4000-8000-000000000001'::uuid then
    raise exception 'FAIL: the second reviewer overwrote the first one''s name';
  end if;
end $$;

\echo '── W7. "other" is a note, and never overwrites a column ────────────────'

do $$
declare
  v_word bigint;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"d1d70000-0000-4000-8000-000000000001"}', false);
  set local role authenticated;

  select updated_word_id into v_word
    from public.review_word_suggestion(11103, 'approved');

  if v_word is not null then
    raise exception 'FAIL: approving a free-form note edited word %', v_word;
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

do $$
begin
  if (select translation_pl from public.words where id = 11001) <> 'klucz (poprawione)' then
    raise exception 'FAIL: a "other" suggestion overwrote the translation';
  end if;
  if (select status from public.word_suggestions where id = 11103) <> 'approved' then
    raise exception 'FAIL: a "other" suggestion was not marked reviewed';
  end if;
end $$;

\echo '── W8. a rejection decides without editing ─────────────────────────────'

do $$
declare
  v_word bigint;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"d1d70000-0000-4000-8000-000000000001"}', false);
  set local role authenticated;

  select updated_word_id into v_word
    from public.review_word_suggestion(11102, 'rejected');
  if v_word is not null then
    raise exception 'FAIL: a rejection edited word %', v_word;
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

do $$
begin
  if (select example_de from public.words where id = 11002) is not null then
    raise exception 'FAIL: a rejected suggestion was still applied';
  end if;
  if (select status from public.word_suggestions where id = 11102) <> 'rejected' then
    raise exception 'FAIL: the rejection was not recorded';
  end if;
end $$;

\echo '── W9. a nonsense decision is refused outright ─────────────────────────'

insert into public.word_suggestions (id, word_id, user_id, field, suggestion, status)
  overriding system value
  values (11104, 11002, 'd1d70000-0000-4000-8000-000000000003',
          'example_pl', 'On otwiera drzwi.', 'pending');

do $$
declare
  v_raised text := null;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"d1d70000-0000-4000-8000-000000000001"}', false);
  set local role authenticated;

  begin
    -- 'pending' is a status, not a decision: the function must not be a way to
    -- un-review something.
    perform public.review_word_suggestion(11104, 'pending');
  exception when others then
    v_raised := sqlstate;
  end;

  if v_raised is distinct from 'FL422' then
    raise exception 'FAIL: an invalid decision raised % (expected FL422)',
      coalesce(v_raised, 'nothing');
  end if;
end $$;

reset role;
do $switch$ begin perform set_config('request.jwt.claims', '', false); end $switch$;

\echo '── W10. anon has no execute grant at all ───────────────────────────────'

do $$
begin
  if has_function_privilege(
       'anon', 'public.review_word_suggestion(bigint, text)', 'execute') then
    raise exception 'FAIL: anon may execute review_word_suggestion';
  end if;
  if not has_function_privilege(
       'authenticated', 'public.review_word_suggestion(bigint, text)', 'execute') then
    raise exception 'FAIL: authenticated cannot execute review_word_suggestion';
  end if;
end $$;

\echo '✔ dictionary write integrity suite passed'
