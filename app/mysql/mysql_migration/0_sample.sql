ALTER TABLE match_group_member ADD INDEX user_id_midex_idx(user_id);
ALTER TABLE department ADD INDEX department_id_midex_idx(department_id);
ALTER TABLE department_role_member ADD INDEX user_id_mixed_idx(user_id, belong);
ALTER TABLE department_role_member ADD INDEX role_id_mixed_idx(role_id, belong);
ALTER TABLE user ADD INDEX office_file_idx(office_id, user_icon_id);
ALTER TABLE user ADD INDEX mail_pass_idx(mail, password);
-- ALTER TABLE session ADD INDEX linked_user_id_idx(linked_user_id);
-- ALTER TABLE session ADD INDEX session_id_idx(session_id);
