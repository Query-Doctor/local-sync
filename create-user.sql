create role query_doctor_db_link with login;
grant pg_read_all_data to query_doctor_db_link;
grant execute, trigger to query_doctor_db_link;
