-- A user's first cycle usually starts mid-cycle (spec 2.1). It is budgeted from the day it started being
-- budgeted (setup day), not from the cycle's first day: spends before that day do not count against it and
-- the pool is pro-rated live from this date. Null means budgeted from the cycle's own first day.
alter table cycles add column budget_from date;
