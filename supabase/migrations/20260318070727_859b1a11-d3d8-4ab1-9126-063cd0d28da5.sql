
-- Create increment_points function for the quiz/game system
CREATE OR REPLACE FUNCTION public.increment_points(p_user_id BIGINT, p_chat_id BIGINT)
RETURNS void AS $$
BEGIN
  UPDATE public.telegram_users
  SET points = points + 10,
      level = CASE
        WHEN points + 10 >= 500 THEN 5
        WHEN points + 10 >= 200 THEN 4
        WHEN points + 10 >= 100 THEN 3
        WHEN points + 10 >= 50 THEN 2
        ELSE 1
      END
  WHERE user_id = p_user_id AND chat_id = p_chat_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
