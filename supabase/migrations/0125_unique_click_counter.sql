-- Счётчик кликов рассылки считает людей, а не нажатия: повторные переходы одного получателя
-- не увеличивают campaigns.clicked_count. Их по-прежнему видно в campaign_recipients.click_count.

-- record_recipient_click теперь возвращает: true — первый переход этого получателя, false — повторный,
-- null — получатель не найден (нет персональной метки, считаем как раньше).
drop function if exists record_recipient_click(uuid, text, text);
create function record_recipient_click(p_campaign uuid, p_token text, p_subscriber text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  first_click boolean;
begin
  update campaign_recipients set
    clicked_at = coalesce(clicked_at, now()),
    last_clicked_at = now(),
    click_count = click_count + 1
  where campaign_id = p_campaign
    and (
      (p_token is not null and token = p_token)
      or (p_token is null and p_subscriber is not null and channel = 'push' and contact = p_subscriber)
    )
  returning (click_count = 1) into first_click;
  return first_click;
end;
$$;
revoke all on function record_recipient_click(uuid, text, text) from public, anon, authenticated;
grant execute on function record_recipient_click(uuid, text, text) to service_role;

-- Исправление прошлых данных: у рассылок, где есть получатели, счётчик = число получателей с переходом
update campaigns c set clicked_count = s.n
from (select campaign_id, count(*) filter (where clicked_at is not null) as n from campaign_recipients group by campaign_id) s
where s.campaign_id = c.id and c.clicked_count <> s.n;
