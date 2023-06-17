ALTER TABLE match_group_member ADD INDEX user_id_midex_idx(user_id, match_group_id);
ALTER TABLE department_role_member ADD INDEX user_id_mixed_idx(user_id, belong);
ALTER TABLE department_role_member ADD INDEX role_id_mixed_idx(role_id, belong);
ALTER TABLE user ADD INDEX office_file_idx(office_id, user_icon_id);
