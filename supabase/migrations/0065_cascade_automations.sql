-- Каскадная отправка: одна карточка welcome/event автоматизации вместо
-- одного канала+шаблона хранит шаблон под КАЖДЫЙ канал сразу — реальный
-- канал резолвится в момент отправки по общему «Приоритету каналов»,
-- см. resolveCascadeChannel в lib/sender.ts. Раньше то же самое собиралось
-- вручную из нескольких однонаправленных карточек (по одной на канал) с
-- одинаковым триггером/задержкой/отменой — ничего не мешало им разъехаться
-- (разная задержка по ошибке, забыли добавить cancel_event на одну из трёх)
-- и физически не давало гарантии «эта волна уйдёт максимум по одному
-- каналу»: 3 отдельных automation_jobs на одну волну не скоординированы
-- между собой.
alter table public.automations add column if not exists cascade boolean not null default false;
alter table public.automations add column if not exists channel_templates jsonb not null default '{}';
