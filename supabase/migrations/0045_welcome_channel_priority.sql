-- Приоритет каналов для приветственных цепочек: если контакт одновременно
-- активен на нескольких каналах (например подписался на push и уже состоял
-- в SMS-рассылке), при включённой приоритизации запускается цепочка только
-- канала с наивысшим приоритетом — остальные каналы для этого контакта
-- пропускаются (см. fireWelcomeAutomations в lib/sender.ts).
alter table public.projects add column if not exists welcome_priority_enabled boolean not null default false;
alter table public.projects add column if not exists welcome_channel_priority text[] not null default '{push,sms,email}';
