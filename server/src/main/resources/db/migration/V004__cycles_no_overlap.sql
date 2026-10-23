-- One user can never have two cycles covering the same day. The unique (user_id, start_date) key
-- alone let two racing first requests insert overlapping cycles, which broke Home until the overlap passed.
create extension if not exists btree_gist;

alter table cycles add constraint cycles_no_overlap
    exclude using gist (user_id with =, daterange(start_date, end_date, '[]') with &&);
