-- Внутреннее название рассылки — для организации в списке, не уходит
-- получателям (в отличие от title/subject, которые и есть контент).
alter table public.campaigns add column if not exists internal_title text;
