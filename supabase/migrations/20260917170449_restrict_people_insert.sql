-- R-20 containment: people rows must be created through the controlled RPCs.
REVOKE INSERT ON TABLE public.people FROM authenticated;
