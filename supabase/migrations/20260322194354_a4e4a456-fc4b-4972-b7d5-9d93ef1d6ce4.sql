
CREATE TABLE public.fragrances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  brand text,
  family_key text,
  notes text[],
  accords text[],
  projection integer DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fragrances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read fragrances" ON public.fragrances
  FOR SELECT TO anon, authenticated
  USING (true);

INSERT INTO public.fragrances (id, name, brand, family_key, notes, accords, projection) VALUES
('550e8400-e29b-41d4-a716-446655440001', 'Valley of the Kings', 'Memo Paris', 'oud-amber', ARRAY['oud','amber','incense','saffron','rose'], ARRAY['woody','oriental','smoky'], 8),
('550e8400-e29b-41d4-a716-446655440002', 'Mystere 28', 'Lattafa', 'sweet-gourmand', ARRAY['vanilla','caramel','tonka','praline','musk'], ARRAY['sweet','warm','gourmand'], 7),
('550e8400-e29b-41d4-a716-446655440003', 'Agar', 'Montale', 'oud-amber', ARRAY['agarwood','cedar','vetiver','leather','patchouli'], ARRAY['woody','smoky','earthy'], 9),
('550e8400-e29b-41d4-a716-446655440004', 'Hafez 1984', 'Nishane', 'spicy-warm', ARRAY['cardamom','cinnamon','rose','oud','amber'], ARRAY['spicy','oriental','floral'], 8),
('550e8400-e29b-41d4-a716-446655440005', 'Oasis Elixir', 'Swiss Arabian', 'fresh-aquatic', ARRAY['bergamot','sea salt','driftwood','ambergris','musk'], ARRAY['fresh','aquatic','clean'], 5),
('550e8400-e29b-41d4-a716-446655440006', 'Noire Absolu', 'Lattafa', 'dark-leather', ARRAY['leather','black pepper','tobacco','vetiver','labdanum'], ARRAY['leather','dark','intense'], 9),
('550e8400-e29b-41d4-a716-446655440007', 'Santal Sérénade', 'Dior', 'woody-clean', ARRAY['sandalwood','cream','iris','cedar','white musk'], ARRAY['woody','creamy','soft'], 4),
('550e8400-e29b-41d4-a716-446655440008', 'Cuir Sauvage', 'Hermès', 'dark-leather', ARRAY['raw leather','smoke','birch tar','pepper','moss'], ARRAY['leather','animalic','raw'], 8),
('550e8400-e29b-41d4-a716-446655440009', 'Paradigme', 'Prada', 'woody-clean', ARRAY['iris','neroli','cedar','white woods','musk'], ARRAY['woody','clean','modern'], 6),
('550e8400-e29b-41d4-a716-44665544000a', 'Ember Oud', 'Tom Ford', 'oud-amber', ARRAY['oud','smoky embers','labdanum','benzoin','cinnamon'], ARRAY['smoky','resinous','warm'], 9),
('550e8400-e29b-41d4-a716-44665544000b', 'Citrus Absolue', 'Acqua di Parma', 'fresh-citrus', ARRAY['bergamot','lemon','grapefruit','neroli','petitgrain'], ARRAY['citrus','bright','sparkling'], 4),
('550e8400-e29b-41d4-a716-44665544000c', 'Rose Impériale', 'Amouage', 'floral-rich', ARRAY['damascus rose','oud','saffron','patchouli','amber'], ARRAY['floral','opulent','oriental'], 7),
('550e8400-e29b-41d4-a716-44665544000d', 'Tonka Fumée', 'Maison Margiela', 'sweet-gourmand', ARRAY['tonka bean','tobacco','vanilla','honey','smoky woods'], ARRAY['gourmand','smoky','sweet'], 6),
('550e8400-e29b-41d4-a716-44665544000e', 'Vetiver Nocturne', 'Guerlain', 'green-earthy', ARRAY['vetiver','oakmoss','galbanum','green tea','earth'], ARRAY['green','earthy','masculine'], 5),
('550e8400-e29b-41d4-a716-44665544000f', 'Ambre Sacrée', 'Serge Lutens', 'oud-amber', ARRAY['amber','frankincense','myrrh','benzoin','vanilla'], ARRAY['resinous','sacred','warm'], 7),
('550e8400-e29b-41d4-a716-446655440010', 'Fougère Royale', 'Houbigant', 'aromatic-fougere', ARRAY['lavender','coumarin','oakmoss','geranium','tonka'], ARRAY['aromatic','classic','green'], 5),
('550e8400-e29b-41d4-a716-446655440011', 'Patchouli Absolu', 'Byredo', 'earthy-patchouli', ARRAY['patchouli','cocoa','vanilla','sandalwood','amber'], ARRAY['earthy','dark','sweet'], 6),
('550e8400-e29b-41d4-a716-446655440012', 'Lavande Extrême', 'Chanel', 'aromatic-fougere', ARRAY['lavender','vanilla','tonka','amber','musk'], ARRAY['aromatic','warm','smooth'], 5),
('550e8400-e29b-41d4-a716-446655440013', 'Bois Noir', 'YSL', 'dark-leather', ARRAY['ebony','leather','black amber','incense','pepper'], ARRAY['dark','woody','intense'], 8),
('550e8400-e29b-41d4-a716-446655440014', 'Jasmin Céleste', 'Dior', 'floral-rich', ARRAY['jasmine','tuberose','ylang ylang','vanilla','musk'], ARRAY['floral','heady','sensual'], 6);
