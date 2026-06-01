begin;

revoke execute on function public.audit_card_contract_parity_v1(uuid, numeric, text, text, text, integer) from public;
revoke execute on function public.audit_card_contract_parity_v1(uuid, numeric, text, text, text, integer) from anon;
revoke execute on function public.audit_card_contract_parity_v1(uuid, numeric, text, text, text, integer) from authenticated;

revoke execute on function public.get_guest_mode_layers_audit_v1() from public;
revoke execute on function public.get_guest_mode_layers_audit_v1() from anon;
revoke execute on function public.get_guest_mode_layers_audit_v1() from authenticated;

revoke execute on function public.get_guest_oracle_week_contract_audit_v1(text) from public;
revoke execute on function public.get_guest_oracle_week_contract_audit_v1(text) from anon;
revoke execute on function public.get_guest_oracle_week_contract_audit_v1(text) from authenticated;

revoke execute on function public.get_guest_style_overlap_report_v1() from public;
revoke execute on function public.get_guest_style_overlap_report_v1() from anon;
revoke execute on function public.get_guest_style_overlap_report_v1() from authenticated;

commit;
