
-- Table to store accepted picks
CREATE TABLE IF NOT EXISTS public.oracle_accepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  fragrance_id uuid NOT NULL,
  context text NOT NULL DEFAULT 'casual',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.oracle_accepts ENABLE ROW LEVEL SECURITY;

-- Table to store skipped picks
CREATE TABLE IF NOT EXISTS public.oracle_skips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  fragrance_id uuid NOT NULL,
  context text NOT NULL DEFAULT 'casual',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.oracle_skips ENABLE ROW LEVEL SECURITY;

-- Table to store disliked fragrances
CREATE TABLE IF NOT EXISTS public.oracle_dislikes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  fragrance_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.oracle_dislikes ENABLE ROW LEVEL SECURITY;

-- RLS: users can only insert/read their own rows
CREATE POLICY "Users insert own accepts" ON public.oracle_accepts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users read own accepts" ON public.oracle_accepts FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own skips" ON public.oracle_skips FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users read own skips" ON public.oracle_skips FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own dislikes" ON public.oracle_dislikes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users read own dislikes" ON public.oracle_dislikes FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- accept_today_pick_v1
CREATE OR REPLACE FUNCTION public.accept_today_pick_v1(
  p_user uuid,
  p_fragrance_id uuid,
  p_context text DEFAULT 'casual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.oracle_accepts (user_id, fragrance_id, context)
  VALUES (p_user, p_fragrance_id, p_context);

  RETURN jsonb_build_object('status', 'accepted');
END;
$function$;

-- skip_today_pick_v1
CREATE OR REPLACE FUNCTION public.skip_today_pick_v1(
  p_user uuid,
  p_fragrance_id uuid,
  p_context text DEFAULT 'casual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.oracle_skips (user_id, fragrance_id, context)
  VALUES (p_user, p_fragrance_id, p_context);

  RETURN jsonb_build_object('status', 'skipped');
END;
$function$;

-- dislike_fragrance_v1
CREATE OR REPLACE FUNCTION public.dislike_fragrance_v1(
  p_user uuid,
  p_fragrance_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.oracle_dislikes (user_id, fragrance_id)
  VALUES (p_user, p_fragrance_id)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('status', 'disliked');
END;
$function$;
