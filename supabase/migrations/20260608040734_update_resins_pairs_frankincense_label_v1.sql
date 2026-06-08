update public.scent_terms
set
  pairs_well_with = array[
    'Amber',
    'Incense',
    'Benzoin',
    'Labdanum',
    'Frankincense',
    'Myrrh',
    'Vanilla',
    'Woods'
  ],
  updated_at = now()
where slug = 'resins';
