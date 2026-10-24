-- The first cycle after setup usually starts mid-cycle (spec 2.1). Its pool is pinned here: pro-rated by
-- the server when the cycle is created, or replaced by the user's "money left until payday" answer.
-- Null means the normal formula (income - fixed costs - savings) applies.
alter table cycles add column pool_override_paise bigint check (pool_override_paise >= 0);
