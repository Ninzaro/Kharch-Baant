ALTER TABLE public.payment_sources DROP CONSTRAINT IF EXISTS payment_sources_type_check;
ALTER TABLE public.payment_sources
  ADD CONSTRAINT payment_sources_type_check
  CHECK (type IN ('Credit Card', 'Debit Card', 'UPI', 'Cash', 'Other'));
